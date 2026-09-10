// Package executor applies only SkyOps' typed remediation contract through client-go.
package executor

import (
	"context"
	"fmt"

	"github.com/skyops-io/skyops/agent/internal/transport"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

type Executor struct{ client kubernetes.Interface }

func NewInCluster() (*Executor, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return nil, err
	}
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	return &Executor{client: client}, nil
}

// Execute refuses command strings and unknown types. A standalone kubectl-run Pod
// cannot have its image patched (PodSpec is immutable), so it is replaced from its
// current API object only after checking the expected image value.
func (e *Executor) Execute(ctx context.Context, action transport.RemediationAction) error {
	if action.Type != "ReplacePodImage" || action.Target.Kind != "Pod" || action.Target.Namespace == "" || action.Target.Name == "" || action.Target.Container == "" || action.ExpectedCurrentValue == "" || action.ProposedValue == "" {
		return fmt.Errorf("unsupported or malformed typed remediation action")
	}
	if action.FieldPath != "/spec/containers/"+action.Target.Container+"/image" {
		return fmt.Errorf("field path does not match target container")
	}
	pods := e.client.CoreV1().Pods(action.Target.Namespace)
	pod, err := pods.Get(ctx, action.Target.Name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("read target pod: %w", err)
	}
	if len(pod.OwnerReferences) != 0 {
		return fmt.Errorf("refusing to replace controller-owned Pod; update the owning workload instead")
	}
	found := false
	for i := range pod.Spec.Containers {
		if pod.Spec.Containers[i].Name == action.Target.Container {
			found = true
			if pod.Spec.Containers[i].Image == action.ProposedValue {
				// Idempotency: Pod container already has the proposed target image
				return nil
			}
			if pod.Spec.Containers[i].Image != action.ExpectedCurrentValue {
				return fmt.Errorf("expected image %q does not match live value %q", action.ExpectedCurrentValue, pod.Spec.Containers[i].Image)
			}
			pod.Spec.Containers[i].Image = action.ProposedValue
		}
	}
	if !found {
		return fmt.Errorf("target container not found")
	}
	pod.ResourceVersion = ""
	pod.UID = ""
	pod.CreationTimestamp = metav1.Time{}
	pod.ManagedFields = nil
	pod.Status = corev1.PodStatus{}
	pod.OwnerReferences = nil
	if err := pods.Delete(ctx, action.Target.Name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("delete immutable pod: %w", err)
	}
	if _, err := pods.Create(ctx, pod, metav1.CreateOptions{}); err != nil {
		return fmt.Errorf("create replacement pod: %w", err)
	}
	return nil
}
