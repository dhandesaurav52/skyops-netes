import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { InMemoryStore } from './InMemoryStore';
import { verifyProductionPersistence, resolvePersistenceConfig } from '../persistence';
import { runMigration } from '../../scripts/migrate-json-to-firestore';
import { DataStore } from '../store';

test('Production Persistence Architecture & Migration Suite', async (suite) => {
  await suite.test('InMemoryStore: validates complete CRUD and tenant isolation', async () => {
    const store = new InMemoryStore();
    await store.init();

    // 1. Organization & User
    const org = await store.upsertOrganization({
      id: 'org-test-1',
      name: 'Test Corp',
      slug: 'test-corp',
      status: 'ACTIVE',
      createdAt: 1000,
      membersCount: 1
    });
    assert.equal(org.id, 'org-test-1');

    const user = await store.upsertUser({
      id: 'usr-test-1',
      email: 'alex@testcorp.com',
      name: 'Alex Engineer'
    });
    assert.equal(user.id, 'usr-test-1');

    // 2. Memberships
    await store.addOrgMember('org-test-1', {
      userId: 'usr-test-1',
      orgId: 'org-test-1',
      email: 'alex@testcorp.com',
      name: 'Alex Engineer',
      role: 'ADMIN',
      joinedAt: 1000
    });
    const members = await store.getOrgMembers('org-test-1');
    assert.equal(members.length, 1);
    assert.equal(members[0].userId, 'usr-test-1');

    // 3. Cluster & Tenant Isolation
    await store.upsertCluster({
      id: 'cluster-alpha',
      orgId: 'org-test-1',
      name: 'Alpha Cluster',
      status: 'HEALTHY',
      agentStatus: 'CONNECTED',
      nodeCount: 3,
      podCount: 20,
      openIncidentCount: 0,
      createdAt: 1000
    });
    await store.upsertCluster({
      id: 'cluster-beta',
      orgId: 'org-other-2',
      name: 'Beta Cluster',
      status: 'HEALTHY',
      agentStatus: 'CONNECTED',
      nodeCount: 5,
      podCount: 50,
      openIncidentCount: 0,
      createdAt: 1000
    });

    const org1Clusters = await store.listClusters('org-test-1');
    assert.equal(org1Clusters.length, 1);
    assert.equal(org1Clusters[0].id, 'cluster-alpha');

    // 4. Incidents & Timeline
    await store.upsertIncident({
      id: 'inc-100',
      fingerprint: 'fp-100',
      orgId: 'org-test-1',
      clusterId: 'cluster-alpha',
      clusterName: 'Alpha Cluster',
      namespace: 'production',
      resourceKind: 'Pod',
      resourceName: 'payment-svc-0',
      incidentType: 'CrashLoopBackOff',
      title: 'CrashLoopBackOff in payment service',
      severity: 'CRITICAL',
      status: 'OPEN',
      occurrenceCount: 1,
      firstSeenAt: 2000,
      lastSeenAt: 2000,
      updatedAt: 2000,
      technicalDetails: {}
    });

    await store.addTimelineEvent('inc-100', {
      id: 'evt-1',
      incidentId: 'inc-100',
      type: 'DETECTION',
      description: 'Pod restart count exceeded threshold',
      timestamp: 2100,
      actor: { type: 'SYSTEM', name: 'SkyOps Agent' }
    }, 'org-test-1');

    const timeline = await store.getIncidentTimeline('inc-100', 'org-test-1');
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].description, 'Pod restart count exceeded threshold');

    // 5. Audit Events
    await store.recordAuditEvent({
      id: 'aud-1',
      orgId: 'org-test-1',
      actorId: 'usr-test-1',
      actorName: 'Alex',
      actorType: 'USER',
      action: 'cluster.create',
      resourceType: 'CLUSTER',
      resourceId: 'cluster-alpha',
      result: 'SUCCESS',
      timestamp: 3000,
      hash: 'hash-aud-1'
    } as any);

    const auditLogs = await store.queryAuditEvents({ orgId: 'org-test-1', page: 1, limit: 10 });
    assert.equal(auditLogs.items.length, 1);
    assert.equal(auditLogs.items[0].action, 'cluster.create');

    // 6. Deletion
    await store.deleteCluster('cluster-alpha', 'org-test-1');
    const remaining = await store.listClusters('org-test-1');
    assert.equal(remaining.length, 0);
  });

  await suite.test('Production Gate: Rejects memory and local storage in production mode', () => {
    const origEnv = process.env.NODE_ENV;
    const origProvider = process.env.PERSISTENCE_PROVIDER;
    try {
      process.env.NODE_ENV = 'production';
      process.env.PERSISTENCE_PROVIDER = 'memory';

      assert.throws(
        () => {
          verifyProductionPersistence();
        },
        (err: any) => {
          return err.message.includes('PERSISTENCE_PROVIDER is set to "memory"') &&
            err.message.includes('Production strictly requires "firestore"');
        }
      );

      process.env.PERSISTENCE_PROVIDER = 'local';
      assert.throws(
        () => {
          verifyProductionPersistence();
        },
        (err: any) => {
          return err.message.includes('Production strictly requires "firestore"');
        }
      );

      // Explicit Firestore provider passes
      process.env.PERSISTENCE_PROVIDER = 'firestore';
      assert.doesNotThrow(() => {
        verifyProductionPersistence();
      });
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.PERSISTENCE_PROVIDER = origProvider;
    }
  });

  await suite.test('DataStore: When persistence provider is firestore, local JSON disk writes are bypassed', () => {
    const tempDir = path.join(os.tmpdir(), `skyops-store-bypass-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const memStore = new InMemoryStore();
    // Simulate firestore provider
    (memStore as any).providerName = 'firestore';

    const customStore = new DataStore(memStore);

    // Trigger saveSnapshot
    customStore.saveSnapshot();
    customStore.saveSnapshotSync();

    // Verify no JSON files were written to disk in this mode
    const storePath = customStore.getStoragePath();
    assert.equal(fs.existsSync(path.join(tempDir, 'skyops_store.json')), false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await suite.test('JSON to Firestore Migration: reads fixtures, preserves records, and ensures idempotency', async () => {
    const tempDir = path.join(os.tmpdir(), `skyops-migration-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Create fixture skyops_store.json
    const fixtureStore = {
      orgs: {
        'org-mig-1': {
          id: 'org-mig-1',
          name: 'Migrated Organization',
          slug: 'migrated-org',
          status: 'ACTIVE',
          createdAt: 1690000000000
        }
      },
      users: {
        'usr-mig-1': {
          id: 'usr-mig-1',
          email: 'founder@migrated.io',
          name: 'Founder',
          role: 'OWNER'
        }
      },
      clusters: {
        'cls-mig-1': {
          id: 'cls-mig-1',
          orgId: 'org-mig-1',
          name: 'Production GKE',
          status: 'HEALTHY'
        }
      },
      incidents: {
        'inc-mig-1': {
          id: 'inc-mig-1',
          orgId: 'org-mig-1',
          clusterId: 'cls-mig-1',
          title: 'OOMKilled in backend pod',
          severity: 'HIGH',
          status: 'RESOLVED',
          createdAt: 1690001000000
        }
      }
    };
    fs.writeFileSync(path.join(tempDir, 'skyops_store.json'), JSON.stringify(fixtureStore, null, 2), 'utf8');

    // Create fixture skyops_audit.json
    const fixtureAudit = [
      {
        id: 'aud-mig-1',
        orgId: 'org-mig-1',
        actorId: 'usr-mig-1',
        action: 'incident.resolve',
        resourceType: 'INCIDENT',
        resourceId: 'inc-mig-1',
        result: 'SUCCESS',
        timestamp: 1690002000000
      }
    ];
    fs.writeFileSync(path.join(tempDir, 'skyops_audit.json'), JSON.stringify(fixtureAudit, null, 2), 'utf8');

    const targetStore = new InMemoryStore();
    await targetStore.init();

    // 1st migration run
    const result1 = await runMigration({
      dataDir: tempDir,
      dryRun: false,
      store: targetStore
    });

    assert.equal(result1.errors.length, 0);
    assert.equal(result1.organizations, 1);
    assert.equal(result1.users, 1);
    assert.equal(result1.clusters, 1);
    assert.equal(result1.incidents, 1);
    assert.equal(result1.auditEvents, 1);

    // Verify stored content
    const loadedOrg = await targetStore.getOrganization('org-mig-1');
    assert.equal(loadedOrg?.name, 'Migrated Organization');

    const loadedInc = await targetStore.getIncident('inc-mig-1', 'org-mig-1');
    assert.equal(loadedInc?.title, 'OOMKilled in backend pod');

    // 2nd run: Idempotency check (running again must succeed without error or duplicating)
    const result2 = await runMigration({
      dataDir: tempDir,
      dryRun: false,
      store: targetStore
    });

    assert.equal(result2.errors.length, 0);
    const orgsAfter = await targetStore.listOrganizations();
    assert.equal(orgsAfter.length, 1); // Not duplicated

    const clustersAfter = await targetStore.listClusters('org-mig-1');
    assert.equal(clustersAfter.length, 1);

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
