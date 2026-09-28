import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKubernetesManifest,
  generateInstallScript,
  generateOneCommandInstall,
  generateHelmCommand
} from './manifestGenerator';

test('Manifest & Installer Generator Suite', async (t) => {
  const config = {
    clusterId: 'cls-test-123456',
    clusterName: 'production-us-east',
    token: 'sky_agent_secret_token_abcdef123456',
    serverUrl: 'https://skyops.example.com',
    agentVersion: 'v1.5.0'
  };

  await t.test('generateKubernetesManifest creates valid, complete Kubernetes resources', () => {
    const yaml = generateKubernetesManifest(config);

    assert.ok(yaml.includes('kind: Namespace'));
    assert.ok(yaml.includes('kind: ServiceAccount'));
    assert.ok(yaml.includes('kind: ClusterRole'));
    assert.ok(yaml.includes('kind: ClusterRoleBinding'));
    assert.ok(yaml.includes('kind: Secret'));
    assert.ok(yaml.includes('kind: Deployment'));

    // Check namespace and service account
    assert.ok(yaml.includes('name: skyops-agent'));

    // Verify token is base64-encoded in Secret data and not in plain text in the deployment spec
    const expectedBase64Token = Buffer.from(config.token).toString('base64');
    assert.ok(yaml.includes(expectedBase64Token));
    assert.ok(!yaml.includes(`value: ${config.token}`)); // Token must only be referenced from Secret

    // Verify securityContext for hardened non-root execution
    assert.ok(yaml.includes('runAsNonRoot: true'));
    assert.ok(yaml.includes('readOnlyRootFilesystem: true'));
    assert.ok(yaml.includes('allowPrivilegeEscalation: false'));

    // Verify minimal pods/log RBAC permission
    assert.ok(yaml.includes('pods/log'));
  });

  await t.test('generateInstallScript contains robust preflight checks and clean output', () => {
    const script = generateInstallScript({
      ...config,
      installKey: 'sky_inst_test_session_987'
    });

    assert.ok(script.startsWith('#!/usr/bin/env bash'));
    assert.ok(script.includes('set -euo pipefail'));

    // Verify preflight checks
    assert.ok(script.includes('command -v kubectl'));
    assert.ok(script.includes('kubectl cluster-info') || script.includes('kubectl get nodes'));
    assert.ok(script.includes('kubectl auth can-i'));

    // Verify manifest application
    assert.ok(script.includes('kubectl apply -f -'));
    assert.ok(script.includes('kubectl rollout status deployment/skyops-agent'));

    // Token must not be echo'd directly to terminal
    assert.ok(!script.includes(`echo "${config.token}"`));
    assert.ok(!script.includes(`echo -e "${config.token}"`));
  });

  await t.test('generateOneCommandInstall and generateHelmCommand produce valid invocation strings', () => {
    const oneCmd = generateOneCommandInstall('https://skyops.example.com', 'sky_inst_abc123');
    assert.equal(oneCmd, 'curl -fsSL "https://skyops.example.com/api/v1/install/sky_inst_abc123" | bash');

    const helmCmd = generateHelmCommand(config);
    assert.ok(helmCmd.includes('helm upgrade --install skyops-agent'));
    assert.ok(helmCmd.includes(config.clusterId));
  });
});
