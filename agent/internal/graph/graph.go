package graph

import (
	"fmt"
	"sync"

	"github.com/skyops-io/skyops/agent/internal/types"
)

// Edge represents a typed directed relationship between two resources
type Edge struct {
	Type       string `json:"type"`
	TargetKind string `json:"targetKind"`
	TargetNS   string `json:"targetNamespace,omitempty"`
	TargetName string `json:"targetName"`
	TargetUID  string `json:"targetUid,omitempty"`
}

// Node represents a resource in the graph
type Node struct {
	Key       string `json:"key"` // Kind:Namespace:Name or Kind::Name
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	UID       string `json:"uid"`
	OutEdges  []Edge `json:"outEdges"`
	InEdges   []Edge `json:"inEdges"`
}

// Graph holds the cluster state relationship model
type Graph struct {
	mu    sync.RWMutex
	nodes map[string]*Node
}

func NewGraph() *Graph {
	return &Graph{
		nodes: make(map[string]*Node),
	}
}

func MakeKey(kind, namespace, name string) string {
	return fmt.Sprintf("%s:%s:%s", kind, namespace, name)
}

func (g *Graph) addNodeLocked(kind, namespace, name, uid string) *Node {
	key := MakeKey(kind, namespace, name)
	n, exists := g.nodes[key]
	if !exists {
		n = &Node{
			Key:       key,
			Kind:      kind,
			Namespace: namespace,
			Name:      name,
			UID:       uid,
		}
		g.nodes[key] = n
	} else if uid != "" && n.UID == "" {
		n.UID = uid
	}
	return n
}

func (g *Graph) addEdgeLocked(fromKind, fromNS, fromName string, edgeType, toKind, toNS, toName, toUID string) {
	fromNode := g.addNodeLocked(fromKind, fromNS, fromName, "")
	toNode := g.addNodeLocked(toKind, toNS, toName, toUID)

	// Check if edge already exists
	for _, e := range fromNode.OutEdges {
		if e.Type == edgeType && e.TargetKind == toKind && e.TargetNS == toNS && e.TargetName == toName {
			return
		}
	}

	fromNode.OutEdges = append(fromNode.OutEdges, Edge{
		Type:       edgeType,
		TargetKind: toKind,
		TargetNS:   toNS,
		TargetName: toName,
		TargetUID:  toUID,
	})

	toNode.InEdges = append(toNode.InEdges, Edge{
		Type:       edgeType,
		TargetKind: fromKind,
		TargetNS:   fromNS,
		TargetName: fromName,
	})
}

// BuildFromObservations constructs relationships from observed resources
func (g *Graph) BuildFromObservations(resources []types.ResourceObservation) {
	g.mu.Lock()
	defer g.mu.Unlock()

	g.nodes = make(map[string]*Node)

	// First pass: register all nodes
	for _, res := range resources {
		g.addNodeLocked(res.Kind, res.Namespace, res.Name, res.ID)
	}

	// Second pass: establish relationships
	for _, res := range resources {
		// 1. Owner References (e.g. Deployment -> ReplicaSet -> Pod, Job -> Pod)
		for _, owner := range res.OwnerReferences {
			// Owner OWNS child
			g.addEdgeLocked(owner.Kind, res.Namespace, owner.Name, "OWNS", res.Kind, res.Namespace, res.Name, res.ID)
		}

		// 2. Pod -> Node (SCHEDULED_ON)
		if res.Kind == "Pod" && res.NodeName != "" {
			g.addEdgeLocked("Pod", res.Namespace, res.Name, "SCHEDULED_ON", "Node", "", res.NodeName, "")
		}

		// 3. Pod -> PVC (MOUNTS_PVC)
		if res.Kind == "Pod" && res.SpecSummary != nil {
			if volumes, ok := res.SpecSummary["volumes"].([]interface{}); ok {
				for _, v := range volumes {
					if vm, ok := v.(map[string]interface{}); ok {
						if pvc, ok := vm["persistentVolumeClaim"].(map[string]interface{}); ok {
							if claimName, ok := pvc["claimName"].(string); ok && claimName != "" {
								g.addEdgeLocked("Pod", res.Namespace, res.Name, "MOUNTS_PVC", "PersistentVolumeClaim", res.Namespace, claimName, "")
							}
						}
					}
				}
			}

			// ServiceAccount
			if sa, ok := res.SpecSummary["serviceAccountName"].(string); ok && sa != "" {
				g.addEdgeLocked("Pod", res.Namespace, res.Name, "USES_SERVICEACCOUNT", "ServiceAccount", res.Namespace, sa, "")
			}
		}

		// 4. PVC -> PV (BOUND_TO)
		if res.Kind == "PersistentVolumeClaim" && res.SpecSummary != nil {
			if volName, ok := res.SpecSummary["volumeName"].(string); ok && volName != "" {
				g.addEdgeLocked("PersistentVolumeClaim", res.Namespace, res.Name, "BOUND_TO", "PersistentVolume", "", volName, "")
			}
			if scName, ok := res.SpecSummary["storageClassName"].(string); ok && scName != "" {
				g.addEdgeLocked("PersistentVolumeClaim", res.Namespace, res.Name, "USES_STORAGECLASS", "StorageClass", "", scName, "")
			}
		}

		// 5. Ingress -> Service (ROUTES_TO)
		if res.Kind == "Ingress" && res.SpecSummary != nil {
			if rules, ok := res.SpecSummary["rules"].([]interface{}); ok {
				for _, r := range rules {
					if rm, ok := r.(map[string]interface{}); ok {
						if http, ok := rm["http"].(map[string]interface{}); ok {
							if paths, ok := http["paths"].([]interface{}); ok {
								for _, p := range paths {
									if pm, ok := p.(map[string]interface{}); ok {
										if backend, ok := pm["backend"].(map[string]interface{}); ok {
											if svc, ok := backend["service"].(map[string]interface{}); ok {
												if svcName, ok := svc["name"].(string); ok && svcName != "" {
													g.addEdgeLocked("Ingress", res.Namespace, res.Name, "ROUTES_TO", "Service", res.Namespace, svcName, "")
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}

		// 6. EndpointSlice -> Pod (ROUTES_TO)
		if res.Kind == "EndpointSlice" && res.Labels != nil {
			svcName := res.Labels["kubernetes.io/service-name"]
			if svcName != "" {
				g.addEdgeLocked("Service", res.Namespace, svcName, "ENDPOINTS_IN", "EndpointSlice", res.Namespace, res.Name, res.ID)
			}
		}
	}
}

// GetRelationships returns outbound edges for a given resource
func (g *Graph) GetRelationships(kind, namespace, name string) []Edge {
	g.mu.RLock()
	defer g.mu.RUnlock()

	node, exists := g.nodes[MakeKey(kind, namespace, name)]
	if !exists || node == nil {
		return nil
	}
	edges := make([]Edge, len(node.OutEdges))
	copy(edges, node.OutEdges)
	return edges
}

// FindRootWorkload resolves top-level workload from a Pod (e.g. Pod -> ReplicaSet -> Deployment)
func (g *Graph) FindRootWorkload(namespace, podName string) (kind, name string) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	currKind := "Pod"
	currName := podName

	for depth := 0; depth < 5; depth++ {
		node, exists := g.nodes[MakeKey(currKind, namespace, currName)]
		if !exists || node == nil {
			break
		}

		// Look for incoming OWNS edges
		foundParent := false
		for _, in := range node.InEdges {
			if in.Type == "OWNS" {
				currKind = in.TargetKind
				currName = in.TargetName
				foundParent = true
				break
			}
		}

		if !foundParent {
			break
		}

		// If we reached Deployment, StatefulSet, DaemonSet, Job, or CronJob, that is the root workload
		if currKind == "Deployment" || currKind == "StatefulSet" || currKind == "DaemonSet" || currKind == "CronJob" {
			return currKind, currName
		}
	}

	if currKind == "Pod" {
		return "", ""
	}
	return currKind, currName
}

// FindPodsForNode returns all pods scheduled on a specific node
func (g *Graph) FindPodsForNode(nodeName string) []string {
	g.mu.RLock()
	defer g.mu.RUnlock()

	nodeKey := MakeKey("Node", "", nodeName)
	node, exists := g.nodes[nodeKey]
	if !exists || node == nil {
		return nil
	}

	var pods []string
	for _, in := range node.InEdges {
		if in.Type == "SCHEDULED_ON" && in.TargetKind == "Pod" {
			pods = append(pods, fmt.Sprintf("%s/%s", in.TargetNS, in.TargetName))
		}
	}
	return pods
}

// NodeCount returns total registered resources
func (g *Graph) NodeCount() int {
	g.mu.RLock()
	defer g.mu.RUnlock()
	return len(g.nodes)
}
