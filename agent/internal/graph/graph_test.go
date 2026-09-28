package graph

import (
	"testing"

	"github.com/skyops-io/skyops/agent/internal/types"
)

func TestGraphWorkloadResolution(t *testing.T) {
	resources := []types.ResourceObservation{
		{
			Kind:      "Deployment",
			Namespace: "prod",
			Name:      "api-gateway",
			ID:        "uid-deploy-1",
		},
		{
			Kind:      "ReplicaSet",
			Namespace: "prod",
			Name:      "api-gateway-7b949f5",
			ID:        "uid-rs-1",
			OwnerReferences: []types.OwnerReference{
				{
					Kind: "Deployment",
					Name: "api-gateway",
				},
			},
		},
		{
			Kind:      "Pod",
			Namespace: "prod",
			Name:      "api-gateway-7b949f5-xk92m",
			ID:        "uid-pod-1",
			NodeName:  "node-worker-1",
			OwnerReferences: []types.OwnerReference{
				{
					Kind: "ReplicaSet",
					Name: "api-gateway-7b949f5",
				},
			},
		},
		{
			Kind: "Node",
			Name: "node-worker-1",
			ID:   "uid-node-1",
		},
	}

	g := NewGraph()
	g.BuildFromObservations(resources)

	rootKind, rootName := g.FindRootWorkload("prod", "api-gateway-7b949f5-xk92m")
	if rootKind != "Deployment" || rootName != "api-gateway" {
		t.Fatalf("expected Deployment api-gateway, got %s %s", rootKind, rootName)
	}

	podsOnNode := g.FindPodsForNode("node-worker-1")
	if len(podsOnNode) != 1 || podsOnNode[0] != "prod/api-gateway-7b949f5-xk92m" {
		t.Fatalf("expected prod/api-gateway-7b949f5-xk92m, got %+v", podsOnNode)
	}
}
