import fs from 'fs';
import path from 'path';
import { getPersistenceStore, IPersistenceStore } from '../server/persistence/index';
import { FirestoreStore } from '../server/persistence/FirestoreStore';
import fallbackConfig from '../firebase-applet-config.json';

export interface MigrationSummary {
  users: number;
  organizations: number;
  memberships: number;
  invitations: number;
  clusters: number;
  clusterTokens: number;
  clusterResources: number;
  incidents: number;
  incidentTimeline: number;
  incidentNotes: number;
  remediations: number;
  remediationActions: number;
  aiAnalyses: number;
  policies: number;
  auditEvents: number;
  webhooks: number;
  webhookDeliveries: number;
  subscriptions: number;
  invoices: number;
  supportTickets: number;
  userNotificationSettings: number;
  errors: Array<{ collection: string; id: string; error: string }>;
}

export async function runMigration(options?: {
  dataDir?: string;
  dryRun?: boolean;
  store?: IPersistenceStore;
}): Promise<MigrationSummary> {
  const dataDir = options?.dataDir || process.env.SKYOPS_DATA_DIR || path.join(process.cwd(), 'data');
  const dryRun = options?.dryRun ?? (process.argv.includes('--dry-run'));

  console.log(`[SkyOps Migration] Starting JSON to Firestore migration...`);
  console.log(`[SkyOps Migration] Data directory: ${dataDir}`);
  console.log(`[SkyOps Migration] Mode: ${dryRun ? 'DRY RUN (no database writes)' : 'LIVE EXECUTION'}`);

  const summary: MigrationSummary = {
    users: 0,
    organizations: 0,
    memberships: 0,
    invitations: 0,
    clusters: 0,
    clusterTokens: 0,
    clusterResources: 0,
    incidents: 0,
    incidentTimeline: 0,
    incidentNotes: 0,
    remediations: 0,
    remediationActions: 0,
    aiAnalyses: 0,
    policies: 0,
    auditEvents: 0,
    webhooks: 0,
    webhookDeliveries: 0,
    subscriptions: 0,
    invoices: 0,
    supportTickets: 0,
    userNotificationSettings: 0,
    errors: []
  };

  const store: IPersistenceStore =
    options?.store ||
    (dryRun
      ? getPersistenceStore()
      : new FirestoreStore({
          projectId: process.env.SKYOPS_FIRESTORE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || fallbackConfig.projectId,
          databaseId: process.env.SKYOPS_FIRESTORE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID || (fallbackConfig as any).firestoreDatabaseId || '(default)'
        }));

  if (!dryRun) {
    await store.init();
  }

  // 1. Migrate skyops_store.json
  const storeFilePath = path.join(dataDir, 'skyops_store.json');
  if (fs.existsSync(storeFilePath)) {
    console.log(`[SkyOps Migration] Reading ${storeFilePath}...`);
    try {
      const raw = fs.readFileSync(storeFilePath, 'utf8');
      const storeData = JSON.parse(raw);

      // Organizations
      if (storeData.orgs) {
        for (const [id, org] of Object.entries<any>(storeData.orgs)) {
          try {
            if (!dryRun) await store.upsertOrganization({ ...org, id });
            summary.organizations++;
          } catch (e: any) {
            summary.errors.push({ collection: 'organizations', id, error: e?.message });
          }
        }
      }

      // Users
      if (storeData.users) {
        for (const [id, user] of Object.entries<any>(storeData.users)) {
          try {
            if (!dryRun) await store.upsertUser({ ...user, id });
            summary.users++;
          } catch (e: any) {
            summary.errors.push({ collection: 'users', id, error: e?.message });
          }
        }
      }

      // Memberships
      if (storeData.members) {
        for (const [orgId, memberList] of Object.entries<any>(storeData.members)) {
          if (Array.isArray(memberList)) {
            for (const member of memberList) {
              try {
                if (!dryRun) await store.addOrgMember(orgId, { ...member, orgId });
                summary.memberships++;
              } catch (e: any) {
                summary.errors.push({ collection: 'memberships', id: `${orgId}_${member.userId}`, error: e?.message });
              }
            }
          }
        }
      }

      // Invitations
      if (storeData.invitations) {
        for (const [id, inv] of Object.entries<any>(storeData.invitations)) {
          try {
            if (!dryRun) await store.saveInvitation({ ...inv, id });
            summary.invitations++;
          } catch (e: any) {
            summary.errors.push({ collection: 'invitations', id, error: e?.message });
          }
        }
      }

      // Clusters
      if (storeData.clusters) {
        for (const [id, cluster] of Object.entries<any>(storeData.clusters)) {
          try {
            if (!dryRun) await store.upsertCluster({ ...cluster, id });
            summary.clusters++;
          } catch (e: any) {
            summary.errors.push({ collection: 'clusters', id, error: e?.message });
          }
        }
      }

      // Cluster Tokens
      if (storeData.clusterTokens) {
        for (const [hash, tokenRecord] of Object.entries<any>(storeData.clusterTokens)) {
          try {
            if (!dryRun) await store.saveClusterToken({ ...tokenRecord, tokenHash: hash });
            summary.clusterTokens++;
          } catch (e: any) {
            summary.errors.push({ collection: 'clusterTokens', id: hash, error: e?.message });
          }
        }
      }

      // Cluster Resources
      if (storeData.resources) {
        for (const [clusterId, resList] of Object.entries<any>(storeData.resources)) {
          try {
            if (Array.isArray(resList)) {
              const cluster = storeData.clusters?.[clusterId];
              const orgId = cluster?.orgId || 'org-migrated-default';
              if (!dryRun) await store.saveClusterResources(clusterId, orgId, resList);
              summary.clusterResources++;
            }
          } catch (e: any) {
            summary.errors.push({ collection: 'clusterResources', id: clusterId, error: e?.message });
          }
        }
      }

      // Incidents
      if (storeData.incidents) {
        for (const [id, incident] of Object.entries<any>(storeData.incidents)) {
          try {
            if (!dryRun) await store.upsertIncident({ ...incident, id });
            summary.incidents++;
          } catch (e: any) {
            summary.errors.push({ collection: 'incidents', id, error: e?.message });
          }
        }
      }

      // Incident Timeline
      if (storeData.incidentTimeline) {
        for (const [incidentId, events] of Object.entries<any>(storeData.incidentTimeline)) {
          if (Array.isArray(events)) {
            const inc = storeData.incidents?.[incidentId];
            const orgId = inc?.orgId || 'org-migrated-default';
            for (const ev of events) {
              try {
                if (!dryRun) await store.addTimelineEvent(incidentId, ev, orgId);
                summary.incidentTimeline++;
              } catch (e: any) {
                summary.errors.push({ collection: 'incidentTimeline', id: `${incidentId}_${ev.id}`, error: e?.message });
              }
            }
          }
        }
      }

      // Incident Notes
      if (storeData.incidentNotes) {
        for (const [incidentId, notes] of Object.entries<any>(storeData.incidentNotes)) {
          if (Array.isArray(notes)) {
            const inc = storeData.incidents?.[incidentId];
            const orgId = inc?.orgId || 'org-migrated-default';
            for (const note of notes) {
              try {
                if (!dryRun) await store.addIncidentNote(incidentId, note, orgId);
                summary.incidentNotes++;
              } catch (e: any) {
                summary.errors.push({ collection: 'incidentNotes', id: note.id, error: e?.message });
              }
            }
          }
        }
      }

      // Remediations
      if (storeData.remediations) {
        for (const [incidentId, rem] of Object.entries<any>(storeData.remediations)) {
          try {
            const inc = storeData.incidents?.[incidentId];
            const orgId = inc?.orgId || 'org-migrated-default';
            if (!dryRun) await store.saveRemediation(incidentId, rem, orgId);
            summary.remediations++;
          } catch (e: any) {
            summary.errors.push({ collection: 'remediations', id: incidentId, error: e?.message });
          }
        }
      }

      // Remediation Actions
      if (storeData.remediationActions) {
        for (const [id, action] of Object.entries<any>(storeData.remediationActions)) {
          try {
            if (!dryRun) await store.saveRemediationAction({ ...action, id });
            summary.remediationActions++;
          } catch (e: any) {
            summary.errors.push({ collection: 'remediationActions', id, error: e?.message });
          }
        }
      }

      // AI Analyses
      if (storeData.aiAnalyses) {
        for (const [incidentId, analysis] of Object.entries<any>(storeData.aiAnalyses)) {
          try {
            const inc = storeData.incidents?.[incidentId];
            const orgId = inc?.orgId || 'org-migrated-default';
            if (!dryRun) await store.saveAIAnalysis(incidentId, analysis, orgId);
            summary.aiAnalyses++;
          } catch (e: any) {
            summary.errors.push({ collection: 'aiAnalyses', id: incidentId, error: e?.message });
          }
        }
      }

      // Policies
      if (storeData.policies) {
        for (const [id, policy] of Object.entries<any>(storeData.policies)) {
          try {
            if (!dryRun) await store.savePolicy({ ...policy, id });
            summary.policies++;
          } catch (e: any) {
            summary.errors.push({ collection: 'policies', id, error: e?.message });
          }
        }
      }

      // Subscriptions
      if (storeData.subscriptions) {
        for (const [orgId, sub] of Object.entries<any>(storeData.subscriptions)) {
          try {
            if (!dryRun) await store.saveSubscription({ ...sub, orgId });
            summary.subscriptions++;
          } catch (e: any) {
            summary.errors.push({ collection: 'subscriptions', id: orgId, error: e?.message });
          }
        }
      }

      // Invoices
      if (storeData.invoices) {
        for (const [id, inv] of Object.entries<any>(storeData.invoices)) {
          try {
            if (!dryRun) await store.saveInvoice({ ...inv, id });
            summary.invoices++;
          } catch (e: any) {
            summary.errors.push({ collection: 'invoices', id, error: e?.message });
          }
        }
      }

      // Support Tickets
      if (storeData.supportTickets) {
        for (const [id, ticket] of Object.entries<any>(storeData.supportTickets)) {
          try {
            if (!dryRun) await store.saveSupportTicket({ ...ticket, id });
            summary.supportTickets++;
          } catch (e: any) {
            summary.errors.push({ collection: 'supportTickets', id, error: e?.message });
          }
        }
      }

      // User Notification Settings
      if (storeData.userNotificationSettings) {
        for (const [userId, settings] of Object.entries<any>(storeData.userNotificationSettings)) {
          try {
            if (!dryRun) await store.saveUserNotificationSettings(userId, settings);
            summary.userNotificationSettings++;
          } catch (e: any) {
            summary.errors.push({ collection: 'userNotificationSettings', id: userId, error: e?.message });
          }
        }
      }
    } catch (err: any) {
      console.error(`[SkyOps Migration] Error parsing store file:`, err?.message || err);
      summary.errors.push({ collection: 'skyops_store.json', id: 'root', error: err?.message || String(err) });
    }
  } else {
    console.log(`[SkyOps Migration] No skyops_store.json found at ${storeFilePath}. Skipping.`);
  }

  // 2. Migrate skyops_audit.json
  const auditFilePath = path.join(dataDir, 'skyops_audit.json');
  if (fs.existsSync(auditFilePath)) {
    console.log(`[SkyOps Migration] Reading ${auditFilePath}...`);
    try {
      const raw = fs.readFileSync(auditFilePath, 'utf8');
      const auditList = JSON.parse(raw);
      if (Array.isArray(auditList)) {
        for (const event of auditList) {
          try {
            if (!dryRun) await store.recordAuditEvent(event);
            summary.auditEvents++;
          } catch (e: any) {
            summary.errors.push({ collection: 'auditEvents', id: event.id, error: e?.message });
          }
        }
      }
    } catch (err: any) {
      summary.errors.push({ collection: 'skyops_audit.json', id: 'root', error: err?.message || String(err) });
    }
  }

  // 3. Migrate skyops_webhooks.json
  const webhooksFilePath = path.join(dataDir, 'skyops_webhooks.json');
  if (fs.existsSync(webhooksFilePath)) {
    console.log(`[SkyOps Migration] Reading ${webhooksFilePath}...`);
    try {
      const raw = fs.readFileSync(webhooksFilePath, 'utf8');
      const whData = JSON.parse(raw);
      if (whData.webhooks && Array.isArray(whData.webhooks)) {
        for (const wh of whData.webhooks) {
          try {
            if (!dryRun) await store.saveWebhook(wh);
            summary.webhooks++;
          } catch (e: any) {
            summary.errors.push({ collection: 'webhooks', id: wh.id, error: e?.message });
          }
        }
      }
      if (whData.deliveryHistory && Array.isArray(whData.deliveryHistory)) {
        for (const delivery of whData.deliveryHistory) {
          try {
            if (!dryRun) await store.recordWebhookDelivery(delivery);
            summary.webhookDeliveries++;
          } catch (e: any) {
            summary.errors.push({ collection: 'webhookDeliveries', id: delivery.id, error: e?.message });
          }
        }
      }
    } catch (err: any) {
      summary.errors.push({ collection: 'skyops_webhooks.json', id: 'root', error: err?.message || String(err) });
    }
  }

  // Print Migration Report
  console.log('\n==================================================');
  console.log('         SKYOPS PERSISTENCE MIGRATION REPORT       ');
  console.log('==================================================');
  console.log(`Organizations:            ${summary.organizations}`);
  console.log(`Users:                    ${summary.users}`);
  console.log(`Memberships:              ${summary.memberships}`);
  console.log(`Invitations:              ${summary.invitations}`);
  console.log(`Clusters:                 ${summary.clusters}`);
  console.log(`Cluster Tokens:           ${summary.clusterTokens}`);
  console.log(`Cluster Resources:        ${summary.clusterResources}`);
  console.log(`Incidents:                ${summary.incidents}`);
  console.log(`Incident Timeline:        ${summary.incidentTimeline}`);
  console.log(`Incident Notes:           ${summary.incidentNotes}`);
  console.log(`Remediations:             ${summary.remediations}`);
  console.log(`Remediation Actions:      ${summary.remediationActions}`);
  console.log(`AI Analyses:              ${summary.aiAnalyses}`);
  console.log(`Policies:                 ${summary.policies}`);
  console.log(`Audit Events:             ${summary.auditEvents}`);
  console.log(`Webhooks:                 ${summary.webhooks}`);
  console.log(`Webhook Deliveries:       ${summary.webhookDeliveries}`);
  console.log(`Subscriptions:            ${summary.subscriptions}`);
  console.log(`Invoices:                 ${summary.invoices}`);
  console.log(`Support Tickets:          ${summary.supportTickets}`);
  console.log(`Notification Settings:    ${summary.userNotificationSettings}`);
  console.log('--------------------------------------------------');
  console.log(`Total Errors Encountered: ${summary.errors.length}`);
  if (summary.errors.length > 0) {
    console.error('Migration Errors:');
    for (const err of summary.errors) {
      console.error(`- [${err.collection}] ID: ${err.id} -> ${err.error}`);
    }
  }
  console.log('==================================================\n');

  return summary;
}

// If run directly from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration()
    .then((summary) => {
      if (summary.errors.length > 0) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('[SkyOps Migration] Fatal migration script error:', err);
      process.exit(1);
    });
}
