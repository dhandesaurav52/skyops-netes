import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('SkyOps Service Topology Graph & ResourceRelationshipTree Verification Suite', async (t) => {
  const serviceModalPath = path.resolve(
    process.cwd(),
    'src/components/resources/ServiceDetailModal.tsx'
  );
  const serviceModalSource = fs.readFileSync(serviceModalPath, 'utf-8');

  const relationshipTreePath = path.resolve(
    process.cwd(),
    'src/components/resources/ResourceRelationshipTree.tsx'
  );
  const relationshipTreeSource = fs.readFileSync(relationshipTreePath, 'utf-8');

  await t.test('1. Prop Contract: ServiceDetailModal passes primaryResource and allClusterResources', () => {
    // Must NOT use target= or allResources=
    assert.doesNotMatch(
      serviceModalSource,
      /<ResourceRelationshipTree[^>]*\btarget\s*=/s,
      'ServiceDetailModal must not pass target prop to ResourceRelationshipTree'
    );
    assert.doesNotMatch(
      serviceModalSource,
      /<ResourceRelationshipTree[^>]*\ballResources\s*=/s,
      'ServiceDetailModal must not pass allResources prop to ResourceRelationshipTree'
    );

    // Must use primaryResource and allClusterResources
    assert.match(
      serviceModalSource,
      /primaryResource=\{service\}/,
      'ServiceDetailModal must pass primaryResource={service}'
    );
    assert.match(
      serviceModalSource,
      /allClusterResources=\{clusterResources\}/,
      'ServiceDetailModal must pass allClusterResources={clusterResources}'
    );
  });

  await t.test('2. UI Requirements: Mandated status notices exist in source', () => {
    assert.ok(
      relationshipTreeSource.includes('No verified topology relationships found.'),
      'Must contain exact message: "No verified topology relationships found."'
    );
    assert.ok(
      relationshipTreeSource.includes(
        'Topology is partially available — some cluster resources have not been reported by the agent.'
      ),
      'Must contain exact message: "Topology is partially available — some cluster resources have not been reported by the agent."'
    );
  });

  await t.test('3. Resilience: Error boundary and null primaryResource protection', () => {
    assert.match(
      relationshipTreeSource,
      /TopologyErrorBoundary/,
      'Must wrap ResourceRelationshipTree in an error boundary'
    );
    assert.match(
      relationshipTreeSource,
      /if\s*\(!primaryResource/,
      'Must check if primaryResource is defined before reading properties'
    );
  });

  await t.test('4. Service Topology: EndpointSlice discovery and address resolution', () => {
    assert.match(
      relationshipTreeSource,
      /kubernetes\.io\/service-name/,
      'Must discover EndpointSlices using standard kubernetes.io/service-name label'
    );
    assert.match(
      relationshipTreeSource,
      /EndpointSlices/,
      'Must render EndpointSlices section when available'
    );
  });

  await t.test('5. Service Topology: Backing Pods, Parent Workload, and Scheduled Node links', () => {
    assert.match(
      relationshipTreeSource,
      /findParentWorkload/,
      'Must resolve parent workload (Deployment/ReplicaSet) for backing pods'
    );
    assert.match(
      relationshipTreeSource,
      /findPodNode/,
      'Must resolve scheduled node for backing pods'
    );
    assert.match(
      relationshipTreeSource,
      /isUnhealthy/,
      'Must identify and highlight unhealthy backing pods'
    );
  });

  await t.test('6. Other Modal Usages: PodDetailModal and WorkloadDetailModal remain valid', () => {
    const podModalPath = path.resolve(process.cwd(), 'src/components/resources/PodDetailModal.tsx');
    const podModalSource = fs.readFileSync(podModalPath, 'utf-8');
    assert.match(
      podModalSource,
      /<ResourceRelationshipTree\s+primaryResource=\{pod\}\s+allClusterResources=\{safeClusterResources\}/,
      'PodDetailModal must pass primaryResource and allClusterResources'
    );

    const workloadModalPath = path.resolve(
      process.cwd(),
      'src/components/resources/WorkloadDetailModal.tsx'
    );
    const workloadModalSource = fs.readFileSync(workloadModalPath, 'utf-8');
    assert.match(
      workloadModalSource,
      /<ResourceRelationshipTree\s+primaryResource=\{workload\}\s+allClusterResources=\{clusterResources\}/,
      'WorkloadDetailModal must pass primaryResource and allClusterResources'
    );
  });
});
