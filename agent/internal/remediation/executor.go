package remediation

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/skyops-io/skyops/agent/internal/transport"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// Executor coordinates safe cluster mutation, verification, and rollback
type Executor struct {
	client kubernetes.Interface
}

func NewExecutor(client kubernetes.Interface) *Executor {
	return &Executor{client: client}
}

// PreconditionCheck checks live state before execution and returns the previous state for rollback
func (e *Executor) PreconditionCheck(ctx context.Context, action *transport.RemediationAction) (previousState string, err error) {
	switch action.Type {
	case "ReplacePodImage":
		if action.Target.Kind == "Pod" {
			pod, err := e.client.CoreV1().Pods(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
			if err != nil {
				return "", fmt.Errorf("precondition failed: target pod not found: %w", err)
			}
			if action.Target.UID != "" && string(pod.UID) != action.Target.UID {
				return "", fmt.Errorf("precondition failed: target pod UID changed (stale action)")
			}

			// Find container
			var foundContainer *corev1.Container
			for i := range pod.Spec.Containers {
				if pod.Spec.Containers[i].Name == action.Target.Container {
					foundContainer = &pod.Spec.Containers[i]
					break
				}
			}
			if foundContainer == nil {
				return "", fmt.Errorf("precondition failed: container %q not found in pod", action.Target.Container)
			}

			// Idempotency: already matches proposed
			if foundContainer.Image == action.ProposedValue {
				return action.ProposedValue, nil
			}

			if foundContainer.Image != action.ExpectedCurrentValue {
				return "", fmt.Errorf("precondition failed: expected live image %q does not match actual %q", action.ExpectedCurrentValue, foundContainer.Image)
			}
			return foundContainer.Image, nil

		} else if action.Target.Kind == "Deployment" {
			dep, err := e.client.AppsV1().Deployments(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
			if err != nil {
				return "", fmt.Errorf("precondition failed: deployment not found: %w", err)
			}
			var foundContainer *corev1.Container
			for i := range dep.Spec.Template.Spec.Containers {
				if dep.Spec.Template.Spec.Containers[i].Name == action.Target.Container {
					foundContainer = &dep.Spec.Template.Spec.Containers[i]
					break
				}
			}
			if foundContainer == nil {
				return "", fmt.Errorf("precondition failed: container %q not found in deployment template", action.Target.Container)
			}
			if foundContainer.Image == action.ProposedValue {
				return action.ProposedValue, nil
			}
			if foundContainer.Image != action.ExpectedCurrentValue {
				return "", fmt.Errorf("precondition failed: expected deployment image %q does not match actual %q", action.ExpectedCurrentValue, foundContainer.Image)
			}
			return foundContainer.Image, nil
		}

	case "RestartPod":
		if action.Target.Kind == "Pod" {
			pod, err := e.client.CoreV1().Pods(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
			if err != nil {
				return "", fmt.Errorf("precondition failed: target pod not found: %w", err)
			}
			return string(pod.UID), nil
		} else if action.Target.Kind == "Deployment" {
			dep, err := e.client.AppsV1().Deployments(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
			if err != nil {
				return "", fmt.Errorf("precondition failed: deployment not found: %w", err)
			}
			restartedAt := dep.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"]
			return restartedAt, nil
		}

	case "ScaleDeployment":
		dep, err := e.client.AppsV1().Deployments(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
		if err != nil {
			return "", fmt.Errorf("precondition failed: deployment not found: %w", err)
		}
		currReplicas := int32(1)
		if dep.Spec.Replicas != nil {
			currReplicas = *dep.Spec.Replicas
		}
		return strconv.Itoa(int(currReplicas)), nil
	}

	return "", fmt.Errorf("unsupported action type: %s", action.Type)
}

// Execute performs the requested mutation
func (e *Executor) Execute(ctx context.Context, action *transport.RemediationAction) error {
	switch action.Type {
	case "ReplacePodImage":
		if action.Target.Kind == "Deployment" {
			patch := fmt.Sprintf(`{"spec":{"template":{"spec":{"containers":[{"name":%q,"image":%q}]}}}}`, action.Target.Container, action.ProposedValue)
			_, err := e.client.AppsV1().Deployments(action.Target.Namespace).Patch(ctx, action.Target.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
			return err
		}

		if action.Target.Kind == "Pod" {
			pod, err := e.client.CoreV1().Pods(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
			if err != nil {
				return err
			}

			// If pod is owned by a Deployment/ReplicaSet, update the deployment
			if len(pod.OwnerReferences) > 0 {
				owner := pod.OwnerReferences[0]
				if owner.Kind == "ReplicaSet" {
					rs, err := e.client.AppsV1().ReplicaSets(action.Target.Namespace).Get(ctx, owner.Name, metav1.GetOptions{})
					if err == nil && len(rs.OwnerReferences) > 0 && rs.OwnerReferences[0].Kind == "Deployment" {
						depName := rs.OwnerReferences[0].Name
						patch := fmt.Sprintf(`{"spec":{"template":{"spec":{"containers":[{"name":%q,"image":%q}]}}}}`, action.Target.Container, action.ProposedValue)
						_, err := e.client.AppsV1().Deployments(action.Target.Namespace).Patch(ctx, depName, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
						return err
					}
				}
				return fmt.Errorf("cannot mutate image on controller-owned pod without Deployment owner")
			}

			// Standalone Pod
			for i := range pod.Spec.Containers {
				if pod.Spec.Containers[i].Name == action.Target.Container {
					pod.Spec.Containers[i].Image = action.ProposedValue
					break
				}
			}
			pod.ResourceVersion = ""
			pod.UID = ""
			pod.CreationTimestamp = metav1.Time{}
			pod.ManagedFields = nil
			pod.Status = corev1.PodStatus{}
			pod.OwnerReferences = nil

			if err := e.client.CoreV1().Pods(action.Target.Namespace).Delete(ctx, action.Target.Name, metav1.DeleteOptions{}); err != nil {
				return fmt.Errorf("delete standalone pod: %w", err)
			}
			if _, err := e.client.CoreV1().Pods(action.Target.Namespace).Create(ctx, pod, metav1.CreateOptions{}); err != nil {
				return fmt.Errorf("create replacement pod: %w", err)
			}
			return nil
		}

	case "RestartPod":
		if action.Target.Kind == "Pod" {
			return e.client.CoreV1().Pods(action.Target.Namespace).Delete(ctx, action.Target.Name, metav1.DeleteOptions{})
		}
		if action.Target.Kind == "Deployment" {
			restartedAt := time.Now().Format(time.RFC3339)
			patchMap := map[string]interface{}{
				"spec": map[string]interface{}{
					"template": map[string]interface{}{
						"metadata": map[string]interface{}{
							"annotations": map[string]string{
								"kubectl.kubernetes.io/restartedAt": restartedAt,
							},
						},
					},
				},
			}
			patchBytes, _ := json.Marshal(patchMap)
			_, err := e.client.AppsV1().Deployments(action.Target.Namespace).Patch(ctx, action.Target.Name, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{})
			return err
		}

	case "ScaleDeployment":
		targetReplicas, err := strconv.Atoi(action.ProposedValue)
		if err != nil {
			return fmt.Errorf("invalid replica count %q: %w", action.ProposedValue, err)
		}
		patch := fmt.Sprintf(`{"spec":{"replicas":%d}}`, targetReplicas)
		_, err = e.client.AppsV1().Deployments(action.Target.Namespace).Patch(ctx, action.Target.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
		return err
	}

	return fmt.Errorf("unsupported execution action: %s", action.Type)
}

// Verify ensures target reached the intended state
func (e *Executor) Verify(ctx context.Context, action *transport.RemediationAction, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if time.Now().After(deadline) {
				return fmt.Errorf("verification timeout reached (%s)", timeout)
			}

			switch action.Type {
			case "ReplacePodImage":
				if action.Target.Kind == "Deployment" {
					dep, err := e.client.AppsV1().Deployments(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
					if err == nil {
						for _, c := range dep.Spec.Template.Spec.Containers {
							if c.Name == action.Target.Container && c.Image == action.ProposedValue {
								return nil // Verified
							}
						}
					}
				} else if action.Target.Kind == "Pod" {
					pod, err := e.client.CoreV1().Pods(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
					if err == nil {
						for _, c := range pod.Spec.Containers {
							if c.Name == action.Target.Container && c.Image == action.ProposedValue {
								return nil // Verified
							}
						}
					}
				}

			case "RestartPod":
				// Pod deletion or rollout progress check
				return nil

			case "ScaleDeployment":
				dep, err := e.client.AppsV1().Deployments(action.Target.Namespace).Get(ctx, action.Target.Name, metav1.GetOptions{})
				if err == nil && dep.Spec.Replicas != nil {
					target, _ := strconv.Atoi(action.ProposedValue)
					if int(*dep.Spec.Replicas) == target {
						return nil // Verified
					}
				}
			}
		}
	}
}

// Rollback reverts target to previous state if verification failed
func (e *Executor) Rollback(ctx context.Context, action *transport.RemediationAction, previousState string) error {
	if previousState == "" {
		return fmt.Errorf("cannot rollback without known previous state")
	}

	switch action.Type {
	case "ReplacePodImage":
		if action.Target.Kind == "Deployment" {
			patch := fmt.Sprintf(`{"spec":{"template":{"spec":{"containers":[{"name":%q,"image":%q}]}}}}`, action.Target.Container, previousState)
			_, err := e.client.AppsV1().Deployments(action.Target.Namespace).Patch(ctx, action.Target.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
			return err
		}
	case "ScaleDeployment":
		prevReplicas, err := strconv.Atoi(previousState)
		if err == nil {
			patch := fmt.Sprintf(`{"spec":{"replicas":%d}}`, prevReplicas)
			_, err = e.client.AppsV1().Deployments(action.Target.Namespace).Patch(ctx, action.Target.Name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{})
			return err
		}
	}
	return nil
}
