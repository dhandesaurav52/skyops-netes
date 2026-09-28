import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';

import {
  Cluster,
  Incident,
  IncidentNote,
  KubernetesResource,
  Organization,
  OrgInvitation,
  OrgMember,
  RemediationAction,
  RemediationPolicy,
  SkyOpsAIAnalysis,
  StructuredRemediation,
  SupportTicket,
  TimelineEvent,
  User,
  UserNotificationSettings,
  Subscription,
  Invoice,
  StoredArtifact,
  StoredArtifactFilters,
  StoredArtifactLifecycleStatus,
  StorageUsageSummary
} from '../../src/types/index';
import {
  AuditEvent,
  AuditQueryFilters,
  PaginatedResult,
  WebhookConfig,
  WebhookDeliveryRecord,
  OrgUsageSummary
} from '../repositories/types';
import { ClusterResourcesRecord, ClusterTokenRecord, IPersistenceStore } from './types';
import fallbackConfig from '../../firebase-applet-config.json';

class DocRefWrapper {
  constructor(private docRef: any, public id: string) {}

  public async get(): Promise<{ exists: boolean; data: () => any }> {
    const snap = await this.docRef.get();
    return { exists: snap.exists, data: () => snap.data() };
  }

  public async set(data: any, options?: { merge?: boolean }): Promise<void> {
    await this.docRef.set(data, options || {});
  }

  public async update(data: any): Promise<void> {
    await this.docRef.update(data);
  }

  public async delete(): Promise<void> {
    await this.docRef.delete();
  }

  public raw(): any { return this.docRef; }
}

class CollectionRefWrapper {
  constructor(private db: any, private name: string, private constraints: any[] = []) {}

  public doc(id?: string): DocRefWrapper {
    const docId = id || crypto.randomUUID();
    return new DocRefWrapper(this.db.collection(this.name).doc(docId), docId);
  }

  public where(field: string, op: any, val: any): CollectionRefWrapper {
    if (val === undefined) return this;
    return new CollectionRefWrapper(this.db, this.name, [...this.constraints, { type: 'where', field, op, val }]);
  }

  public orderBy(field: string, direction?: 'asc' | 'desc'): CollectionRefWrapper {
    return new CollectionRefWrapper(this.db, this.name, [...this.constraints, { type: 'orderBy', field, direction: direction || 'asc' }]);
  }

  public limit(n: number): CollectionRefWrapper {
    return new CollectionRefWrapper(this.db, this.name, [...this.constraints, { type: 'limit', n }]);
  }

  private buildQuery(): any {
    let q: any = this.db.collection(this.name);
    for (const constraint of this.constraints) {
      if (constraint.type === 'where') q = q.where(constraint.field, constraint.op, constraint.val);
      else if (constraint.type === 'orderBy') q = q.orderBy(constraint.field, constraint.direction);
      else if (constraint.type === 'limit') q = q.limit(constraint.n);
    }
    return q;
  }

  public async get(): Promise<{
    empty: boolean;
    size: number;
    docs: Array<{ id: string; ref: { delete: () => Promise<void> }; data: () => any }>;
  }> {
    const snap = await this.buildQuery().get();
    return {
      empty: snap.empty,
      size: snap.size,
      docs: snap.docs.map((d: any) => ({ id: d.id, ref: { delete: () => d.ref.delete() }, data: () => d.data() }))
    };
  }
}

class FirebaseAdminWrapper {
  constructor(private db: any) {}
  public collection(name: string): CollectionRefWrapper { return new CollectionRefWrapper(this.db, name); }
  public batch(): any { return this.db.batch(); }
  public runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> { return this.db.runTransaction(fn); }
  public async terminate(): Promise<void> { /* shared Admin client remains process-scoped */ }
}

export interface FirestoreStoreConfig {
  projectId?: string;
  databaseId?: string;
  keyFilename?: string;
}

export class FirestoreStore implements IPersistenceStore {
  public readonly providerName = 'firestore';
  private firestore: FirebaseAdminWrapper;
  private readonly projectId: string;
  private readonly databaseId: string;
  public connected: boolean = false;

  constructor(config?: FirestoreStoreConfig) {
    this.projectId = config?.projectId || process.env.SKYOPS_FIRESTORE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || fallbackConfig.projectId || '';
    this.databaseId = config?.databaseId || process.env.SKYOPS_FIRESTORE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || (fallbackConfig as any).firestoreDatabaseId || '';

    if (!this.projectId) throw new Error('[FirestoreStore] Fatal Startup Error: Missing Firestore project ID. Set SKYOPS_FIRESTORE_PROJECT_ID.');
    if (!this.databaseId) throw new Error('[FirestoreStore] Fatal Startup Error: Missing Firestore database ID. Set SKYOPS_FIRESTORE_DATABASE_ID.');

    const apps = getApps();
    const app = apps.length > 0 ? apps[0] : initializeApp({ projectId: this.projectId, credential: applicationDefault() });
    const firestoreInstance = this.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, this.databaseId);
    this.firestore = new FirebaseAdminWrapper(firestoreInstance);
  }

  public getDatabaseId(): string { return this.databaseId; }
  public getProjectId(): string { return this.projectId; }

  public async init(): Promise<void> {
    try {
      await this.firestore.collection('organizations').limit(1).get();
      this.connected = true;
      console.log(`[FirestoreStore] Connected to Firestore project="${this.projectId}", database="${this.databaseId}" using server credentials`);
    } catch (err: any) {
      this.connected = false;
      throw new Error(
        `[FirestoreStore] Fatal persistence initialization failure for project="${this.projectId}", database="${this.databaseId}": ${err?.message || err}`
      );
    }
  }

  public async close(): Promise<void> {
    this.connected = false;
    await this.firestore.terminate();
  }

  public isHealthySync(): boolean { return this.connected; }

  public async isHealthy(): Promise<boolean> {
    if (!this.connected) return false;
    try {
      await this.firestore.collection('organizations').limit(1).get();
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  // Helper to remove undefined fields before writing to Firestore
  private sanitize<T extends Record<string, any>>(data: T): T {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        clean[key] = value;
      }
    }
    return clean as T;
  }

  // --- Users ---
  public async getUser(userId: string): Promise<User | null> {
    try {
      const snap = await this.firestore.collection('users').doc(userId).get();
      if (!snap.exists) return null;
      return snap.data() as User;
    } catch (err: any) {
      throw err;
    }
  }

  public async upsertUser(user: User): Promise<User> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docRef = this.firestore.collection('users').doc(user.id);
      const existing = await docRef.get();
      const updated: User = {
        ...(existing.exists ? (existing.data() as User) : {}),
        ...user
      };
      await docRef.set(this.sanitize(updated), { merge: true });
      return updated;
    } catch (err: any) {
      throw err;
    }
  }

  public async listUsers(): Promise<User[]> {
    try {
      const snap = await this.firestore.collection('users').get();
      const docs = snap.docs.map((d) => d.data() as User);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  // --- User Notification Settings ---
  public async getUserNotificationSettings(userId: string): Promise<UserNotificationSettings | null> {
    try {
      const snap = await this.firestore.collection('userNotificationSettings').doc(userId).get();
      if (!snap.exists) return null;
      return snap.data() as UserNotificationSettings;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveUserNotificationSettings(userId: string, settings: UserNotificationSettings): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('userNotificationSettings')
        .doc(userId)
        .set(this.sanitize({ ...settings, updatedAt: Date.now() }), { merge: true });
    } catch (err: any) {
      throw err;
    }
  }

  // --- Organizations ---
  public async getOrganization(orgId: string): Promise<Organization | null> {
    try {
      const snap = await this.firestore.collection('organizations').doc(orgId).get();
      if (!snap.exists) return null;
      return snap.data() as Organization;
    } catch (err: any) {
      throw err;
    }
  }

  public async upsertOrganization(org: Organization): Promise<Organization> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docRef = this.firestore.collection('organizations').doc(org.id);
      const existing = await docRef.get();
      const updated: Organization = {
        ...(existing.exists ? (existing.data() as Organization) : {}),
        ...org,
        createdAt: existing.exists ? (existing.data() as Organization).createdAt : org.createdAt || Date.now()
      };
      await docRef.set(this.sanitize(updated), { merge: true });
      return updated;
    } catch (err: any) {
      throw err;
    }
  }

  public async listOrganizations(): Promise<Organization[]> {
    try {
      const snap = await this.firestore.collection('organizations').get();
      const docs = snap.docs.map((d) => d.data() as Organization);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteOrganization(orgId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const batch = this.firestore.batch();
      batch.delete(this.firestore.collection('organizations').doc(orgId));

      const membersSnap = await this.firestore.collection('memberships').where('orgId', '==', orgId).get();
      for (const d of membersSnap.docs) {
        batch.delete(d.ref);
      }
      await batch.commit();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Organization Memberships ---
  public async getOrgMembers(orgId: string): Promise<OrgMember[]> {
    try {
      const snap = await this.firestore.collection('memberships').where('orgId', '==', orgId).get();
      const docs = snap.docs.map((d) => d.data() as OrgMember);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async setOrgMembers(orgId: string, members: OrgMember[]): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const batch = this.firestore.batch();
      const existing = await this.firestore.collection('memberships').where('orgId', '==', orgId).get();
      for (const d of existing.docs) {
        batch.delete(d.ref);
      }
      for (const m of members) {
        const docId = `${orgId}_${m.userId}`;
        batch.set(this.firestore.collection('memberships').doc(docId), this.sanitize({ ...m, orgId }));
      }
      await batch.commit();
    } catch (err: any) {
      throw err;
    }
  }

  public async addOrgMember(orgId: string, member: OrgMember): Promise<OrgMember> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docId = `${orgId}_${member.userId}`;
      const payload = this.sanitize({ ...member, orgId });
      await this.firestore.collection('memberships').doc(docId).set(payload, { merge: true });
      return member;
    } catch (err: any) {
      throw err;
    }
  }

  public async removeOrgMember(orgId: string, userId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docId = `${orgId}_${userId}`;
      await this.firestore.collection('memberships').doc(docId).delete();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  public async getUserOrganizations(userId: string, email?: string): Promise<Organization[]> {
    try {
      const orgIds = new Set<string>();
      const userMemberships = await this.firestore
        .collection('memberships')
        .where('userId', '==', userId)
        .get();

      for (const d of userMemberships.docs) {
        const data = d.data();
        if (data.orgId) orgIds.add(data.orgId);
      }

      if (email) {
        const emailMemberships = await this.firestore
          .collection('memberships')
          .where('email', '==', email.toLowerCase())
          .get();
        for (const d of emailMemberships.docs) {
          const data = d.data();
          if (data.orgId) orgIds.add(data.orgId);
        }
      }

      const orgs: Organization[] = [];
      for (const orgId of orgIds) {
        const org = await this.getOrganization(orgId);
        if (org) orgs.push(org);
      }
      return orgs;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Invitations ---
  public async getInvitation(invitationId: string): Promise<OrgInvitation | null> {
    try {
      const snap = await this.firestore.collection('invitations').doc(invitationId).get();
      if (!snap.exists) return null;
      return snap.data() as OrgInvitation;
    } catch (err: any) {
      throw err;
    }
  }

  public async getInvitationByToken(token: string): Promise<OrgInvitation | null> {
    try {
      const snap = await this.firestore.collection('invitations').where('token', '==', token).limit(1).get();
      if (snap.empty) return null;
      return snap.docs[0].data() as OrgInvitation;
    } catch (err: any) {
      throw err;
    }
  }

  public async listOrgInvitations(orgId: string): Promise<OrgInvitation[]> {
    try {
      const snap = await this.firestore.collection('invitations').where('orgId', '==', orgId).get();
      const docs = snap.docs.map((d) => d.data() as OrgInvitation);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveInvitation(invitation: OrgInvitation): Promise<OrgInvitation> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('invitations')
        .doc(invitation.id)
        .set(this.sanitize(invitation), { merge: true });
      return invitation;
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteInvitation(invitationId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore.collection('invitations').doc(invitationId).delete();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Support Tickets ---
  public async getSupportTicket(ticketId: string): Promise<SupportTicket | null> {
    try {
      const snap = await this.firestore.collection('supportTickets').doc(ticketId).get();
      if (!snap.exists) return null;
      return snap.data() as SupportTicket;
    } catch (err: any) {
      throw err;
    }
  }

  public async listSupportTickets(orgId: string): Promise<SupportTicket[]> {
    try {
      const snap = await this.firestore.collection('supportTickets').where('orgId', '==', orgId).get();
      const docs = snap.docs.map((d) => d.data() as SupportTicket);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveSupportTicket(ticket: SupportTicket): Promise<SupportTicket> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('supportTickets')
        .doc(ticket.id)
        .set(this.sanitize(ticket), { merge: true });
      return ticket;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Clusters ---
  public async getCluster(clusterId: string, orgId?: string): Promise<Cluster | null> {
    try {
      const snap = await this.firestore.collection('clusters').doc(clusterId).get();
      if (!snap.exists) return null;
      const cluster = snap.data() as Cluster;
      if (orgId && cluster.orgId !== orgId) return null;
      return cluster;
    } catch (err: any) {
      throw err;
    }
  }

  public async listClusters(orgId?: string): Promise<Cluster[]> {
    try {
      let query: any = this.firestore.collection('clusters');
      if (orgId) {
        query = query.where('orgId', '==', orgId);
      }
      const snap = await query.get();
      const docs = snap.docs.map((d) => d.data() as Cluster);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async upsertCluster(cluster: Cluster): Promise<Cluster> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore.collection('clusters').doc(cluster.id).set(this.sanitize(cluster), { merge: true });
      return cluster;
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteCluster(clusterId: string, orgId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const cluster = await this.getCluster(clusterId, orgId);
      if (!cluster) return false;

      const batch = this.firestore.batch();
      batch.delete(this.firestore.collection('clusters').doc(clusterId));
      batch.delete(this.firestore.collection('clusterResources').doc(clusterId));

      const tokens = await this.firestore.collection('clusterTokens').where('clusterId', '==', clusterId).get();
      for (const d of tokens.docs) {
        batch.delete(d.ref);
      }

      await batch.commit();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Cluster Tokens ---
  public async getClusterTokenByHash(tokenHash: string): Promise<ClusterTokenRecord | null> {
    try {
      const snap = await this.firestore.collection('clusterTokens').doc(tokenHash).get();
      if (!snap.exists) return null;
      return snap.data() as ClusterTokenRecord;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveClusterToken(record: ClusterTokenRecord): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore.collection('clusterTokens').doc(record.tokenHash).set(this.sanitize(record), { merge: true });
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteClusterToken(tokenHash: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore.collection('clusterTokens').doc(tokenHash).delete();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Cluster Resources ---
  public async getClusterResources(clusterId: string, orgId?: string): Promise<KubernetesResource[]> {
    try {
      const snap = await this.firestore.collection('clusterResources').doc(clusterId).get();
      if (!snap.exists) return [];
      const record = snap.data() as ClusterResourcesRecord;
      if (orgId && record.orgId !== orgId) return [];
      return record.resources || [];
    } catch (err: any) {
      throw err;
    }
  }

  public async saveClusterResources(clusterId: string, orgId: string, resources: KubernetesResource[]): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const payload: ClusterResourcesRecord = {
        clusterId,
        orgId,
        resources,
        updatedAt: Date.now()
      };
      await this.firestore.collection('clusterResources').doc(clusterId).set(this.sanitize(payload), { merge: true });
    } catch (err: any) {
      throw err;
    }
  }

  // --- Incidents ---
  public async getIncident(incidentId: string, orgId?: string): Promise<Incident | null> {
    try {
      const snap = await this.firestore.collection('incidents').doc(incidentId).get();
      if (!snap.exists) return null;
      const inc = snap.data() as Incident;
      if (orgId && inc.orgId !== orgId) return null;
      return inc;
    } catch (err: any) {
      throw err;
    }
  }

  public async listIncidents(orgId?: string, clusterId?: string): Promise<Incident[]> {
    try {
      let query: any = this.firestore.collection('incidents');
      if (orgId) query = query.where('orgId', '==', orgId);
      if (clusterId) query = query.where('clusterId', '==', clusterId);
      const snap = await query.get();
      const docs = snap.docs.map((d) => d.data() as Incident);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async upsertIncident(incident: Incident): Promise<Incident> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore.collection('incidents').doc(incident.id).set(this.sanitize(incident), { merge: true });
      return incident;
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteIncident(incidentId: string, orgId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const inc = await this.getIncident(incidentId, orgId);
      if (!inc) return false;

      const batch = this.firestore.batch();
      batch.delete(this.firestore.collection('incidents').doc(incidentId));
      batch.delete(this.firestore.collection('remediations').doc(incidentId));
      batch.delete(this.firestore.collection('aiAnalyses').doc(incidentId));

      const notes = await this.firestore.collection('incidentNotes').where('incidentId', '==', incidentId).get();
      for (const d of notes.docs) batch.delete(d.ref);

      const timeline = await this.firestore.collection('incidentTimeline').where('incidentId', '==', incidentId).get();
      for (const d of timeline.docs) batch.delete(d.ref);

      await batch.commit();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Incident Timeline ---
  public async getIncidentTimeline(incidentId: string, orgId?: string): Promise<TimelineEvent[]> {
    try {
      const snap = await this.firestore
        .collection('incidentTimeline')
        .where('incidentId', '==', incidentId)
        .get();

      const items = snap.docs.map((d) => d.data() as TimelineEvent);
      items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      return items;
    } catch (err: any) {
      throw err;
    }
  }

  public async addTimelineEvent(incidentId: string, event: TimelineEvent, orgId: string): Promise<TimelineEvent> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docId = event.id || `${incidentId}_${event.timestamp}_${Math.random().toString(36).substring(2, 7)}`;
      const fullEvent: TimelineEvent = {
        ...event,
        id: docId
      };
      await this.firestore
        .collection('incidentTimeline')
        .doc(docId)
        .set(this.sanitize({ ...fullEvent, incidentId, orgId }), { merge: true });
      return fullEvent;
    } catch (err: any) {
      throw err;
    }
  }

  public async setIncidentTimeline(incidentId: string, events: TimelineEvent[], orgId: string): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const batch = this.firestore.batch();
      const existing = await this.firestore.collection('incidentTimeline').where('incidentId', '==', incidentId).get();
      for (const d of existing.docs) batch.delete(d.ref);

      for (const ev of events) {
        const docId = ev.id || `${incidentId}_${ev.timestamp}_${Math.random().toString(36).substring(2, 7)}`;
        batch.set(
          this.firestore.collection('incidentTimeline').doc(docId),
          this.sanitize({ ...ev, id: docId, incidentId, orgId })
        );
      }
      await batch.commit();
    } catch (err: any) {
      throw err;
    }
  }

  // --- Incident Notes ---
  public async getIncidentNotes(incidentId: string, orgId?: string): Promise<IncidentNote[]> {
    try {
      const snap = await this.firestore
        .collection('incidentNotes')
        .where('incidentId', '==', incidentId)
        .get();
      const items = snap.docs.map((d) => d.data() as IncidentNote);
      items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      return items;
    } catch (err: any) {
      throw err;
    }
  }

  public async addIncidentNote(incidentId: string, note: IncidentNote, orgId: string): Promise<IncidentNote> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('incidentNotes')
        .doc(note.id)
        .set(this.sanitize({ ...note, incidentId, orgId }), { merge: true });
      return note;
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteIncidentNote(incidentId: string, noteId: string, orgId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore.collection('incidentNotes').doc(noteId).delete();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Remediations ---
  public async getRemediation(incidentId: string, orgId?: string): Promise<StructuredRemediation | null> {
    try {
      const snap = await this.firestore.collection('remediations').doc(incidentId).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (orgId && data?.orgId !== orgId) return null;
      return data?.remediation as StructuredRemediation;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveRemediation(incidentId: string, remediation: StructuredRemediation, orgId: string): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('remediations')
        .doc(incidentId)
        .set(this.sanitize({ incidentId, orgId, remediation, updatedAt: Date.now() }), { merge: true });
    } catch (err: any) {
      throw err;
    }
  }

  // --- Remediation Actions ---
  public async getRemediationAction(actionId: string, orgId?: string): Promise<RemediationAction | null> {
    try {
      const snap = await this.firestore.collection('remediationActions').doc(actionId).get();
      if (!snap.exists) return null;
      const action = snap.data() as RemediationAction;
      if (orgId && action.orgId !== orgId) return null;
      return action;
    } catch (err: any) {
      throw err;
    }
  }

  public async listRemediationActions(orgId?: string, incidentId?: string): Promise<RemediationAction[]> {
    try {
      let query: any = this.firestore.collection('remediationActions');
      if (orgId) query = query.where('orgId', '==', orgId);
      if (incidentId) query = query.where('incidentId', '==', incidentId);
      const snap = await query.get();
      const docs = snap.docs.map((d) => d.data() as RemediationAction);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveRemediationAction(action: RemediationAction): Promise<RemediationAction> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('remediationActions')
        .doc(action.id)
        .set(this.sanitize(action), { merge: true });
      return action;
    } catch (err: any) {
      throw err;
    }
  }

  // --- AI Analyses ---
  public async getAIAnalysis(incidentId: string, orgId?: string): Promise<SkyOpsAIAnalysis | null> {
    try {
      const snap = await this.firestore.collection('aiAnalyses').doc(incidentId).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (orgId && data?.orgId !== orgId) return null;
      return data?.analysis as SkyOpsAIAnalysis;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveAIAnalysis(incidentId: string, analysis: SkyOpsAIAnalysis, orgId: string): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('aiAnalyses')
        .doc(incidentId)
        .set(this.sanitize({ incidentId, orgId, analysis, analyzedAt: Date.now() }), { merge: true });
    } catch (err: any) {
      throw err;
    }
  }

  // --- Policies ---
  public async getPolicy(policyId: string, orgId?: string): Promise<RemediationPolicy | null> {
    try {
      const snap = await this.firestore.collection('policies').doc(policyId).get();
      if (!snap.exists) return null;
      const pol = snap.data() as RemediationPolicy;
      if (orgId && pol.orgId !== orgId) return null;
      return pol;
    } catch (err: any) {
      throw err;
    }
  }

  public async listPolicies(orgId: string): Promise<RemediationPolicy[]> {
    try {
      const snap = await this.firestore.collection('policies').where('orgId', '==', orgId).get();
      const docs = snap.docs.map((d) => d.data() as RemediationPolicy);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async savePolicy(policy: RemediationPolicy): Promise<RemediationPolicy> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docId = (policy as any).id || (policy.clusterId ? `${policy.orgId}_${policy.clusterId}` : policy.orgId);
      await this.firestore.collection('policies').doc(docId).set(this.sanitize(policy), { merge: true });
      return policy;
    } catch (err: any) {
      throw err;
    }
  }

  public async deletePolicy(policyId: string, orgId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const pol = await this.getPolicy(policyId, orgId);
      if (!pol) return false;
      await this.firestore.collection('policies').doc(policyId).delete();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Audit Events ---
  public async recordAuditEvent(event: AuditEvent): Promise<AuditEvent> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('auditEvents')
        .doc(event.id)
        .set(this.sanitize(event), { merge: true });
      return event;
    } catch (err: any) {
      throw err;
    }
  }

  public async queryAuditEvents(filters: AuditQueryFilters): Promise<PaginatedResult<AuditEvent>> {
    try {
      const snap = await this.firestore
        .collection('auditEvents')
        .where('orgId', '==', filters.orgId)
        .get();

      let list = snap.docs.map((d) => d.data() as AuditEvent);

      if (filters.actorId) list = list.filter((e) => e.actorId === filters.actorId);
      if (filters.actorType) {
        const targetType = filters.actorType.toUpperCase();
        list = list.filter((e) => {
          const itemType = (e.actorType || '').toUpperCase();
          if (targetType === 'USER' || targetType === 'HUMAN') {
            return itemType === 'USER' || itemType === 'HUMAN';
          }
          return itemType === targetType;
        });
      }
      if (filters.action) list = list.filter((e) => e.action.toLowerCase() === filters.action?.toLowerCase());
      if (filters.resourceType) list = list.filter((e) => e.resourceType.toUpperCase() === filters.resourceType?.toUpperCase());
      if (filters.resourceId) list = list.filter((e) => e.resourceId === filters.resourceId);
      if (filters.result) list = list.filter((e) => e.result === filters.result);
      if (filters.fromTimestamp) list = list.filter((e) => e.timestamp >= filters.fromTimestamp!);
      if (filters.toTimestamp) list = list.filter((e) => e.timestamp <= filters.toTimestamp!);
      if (filters.search) {
        const q = filters.search.toLowerCase();
        list = list.filter(
          (e) =>
            (e.action && e.action.toLowerCase().includes(q)) ||
            (e.actorName && e.actorName.toLowerCase().includes(q)) ||
            (e.actorId && e.actorId.toLowerCase().includes(q)) ||
            (e.resourceId && e.resourceId.toLowerCase().includes(q)) ||
            (e.resourceType && e.resourceType.toLowerCase().includes(q)) ||
            (e.details && JSON.stringify(e.details).toLowerCase().includes(q))
        );
      }

      list.sort((a, b) => b.timestamp - a.timestamp);

      const total = list.length;
      const page = Math.max(1, filters.page || 1);
      const limit = Math.max(1, Math.min(100, filters.limit || 50));
      const totalPages = Math.ceil(total / limit) || 1;
      const startIndex = (page - 1) * limit;
      const items = list.slice(startIndex, startIndex + limit);

      return { items, total, page, totalPages, limit };
    } catch (err: any) {
      throw err;
    }
  }

  // --- Webhooks ---
  public async getWebhook(webhookId: string, orgId?: string): Promise<WebhookConfig | null> {
    try {
      const snap = await this.firestore.collection('webhooks').doc(webhookId).get();
      if (!snap.exists) return null;
      const wh = snap.data() as WebhookConfig;
      if (orgId && wh.orgId !== orgId) return null;
      return wh;
    } catch (err: any) {
      throw err;
    }
  }

  public async listWebhooks(orgId: string): Promise<WebhookConfig[]> {
    try {
      const snap = await this.firestore.collection('webhooks').where('orgId', '==', orgId).get();
      const docs = snap.docs.map((d) => d.data() as WebhookConfig);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveWebhook(webhook: WebhookConfig): Promise<WebhookConfig> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('webhooks')
        .doc(webhook.id)
        .set(this.sanitize(webhook), { merge: true });
      return webhook;
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteWebhook(webhookId: string, orgId: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const wh = await this.getWebhook(webhookId, orgId);
      if (!wh) return false;
      await this.firestore.collection('webhooks').doc(webhookId).delete();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Webhook Deliveries ---
  public async recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<WebhookDeliveryRecord> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('webhookDeliveries')
        .doc(delivery.id)
        .set(this.sanitize(delivery), { merge: true });
      return delivery;
    } catch (err: any) {
      throw err;
    }
  }

  public async listWebhookDeliveries(orgId: string, webhookId?: string, limit = 100): Promise<WebhookDeliveryRecord[]> {
    try {
      let query: any = this.firestore
        .collection('webhookDeliveries')
        .where('orgId', '==', orgId);

      if (webhookId) query = query.where('webhookId', '==', webhookId);

      const snap = await query.get();
      const list = snap.docs.map((d) => d.data() as WebhookDeliveryRecord);
      list.sort((a, b) => b.timestamp - a.timestamp);
      return list.slice(0, limit);
    } catch (err: any) {
      throw err;
    }
  }

  // --- Subscriptions & Invoices ---
  public async getSubscription(orgId: string): Promise<Subscription | null> {
    try {
      const snap = await this.firestore.collection('subscriptions').doc(orgId).get();
      if (!snap.exists) return null;
      return snap.data() as Subscription;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveSubscription(subscription: Subscription): Promise<Subscription> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const orgId = subscription.organizationId || (subscription as any).orgId;
      await this.firestore
        .collection('subscriptions')
        .doc(orgId)
        .set(this.sanitize(subscription), { merge: true });
      return subscription;
    } catch (err: any) {
      throw err;
    }
  }

  public async getInvoice(invoiceId: string, orgId?: string): Promise<Invoice | null> {
    try {
      const snap = await this.firestore.collection('invoices').doc(invoiceId).get();
      if (!snap.exists) return null;
      const inv = snap.data() as Invoice;
      const invOrg = inv.organizationId || (inv as any).orgId;
      if (orgId && invOrg !== orgId) return null;
      return inv;
    } catch (err: any) {
      throw err;
    }
  }

  public async listInvoices(orgId: string): Promise<Invoice[]> {
    try {
      const snap = await this.firestore.collection('invoices').where('organizationId', '==', orgId).get();
      const docs = snap.docs.map((d) => d.data() as Invoice);
      return docs;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveInvoice(invoice: Invoice): Promise<Invoice> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('invoices')
        .doc(invoice.id)
        .set(this.sanitize(invoice), { merge: true });
      return invoice;
    } catch (err: any) {
      throw err;
    }
  }

  // --- Usage Summaries ---
  public async getUsage(orgId: string, period: string): Promise<OrgUsageSummary | null> {
    try {
      const docId = `${orgId}_${period}`;
      const snap = await this.firestore.collection('usage').doc(docId).get();
      if (!snap.exists) return null;
      return snap.data() as OrgUsageSummary;
    } catch (err: any) {
      throw err;
    }
  }

  public async saveUsage(summary: OrgUsageSummary): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docId = `${summary.orgId}_${summary.period}`;
      await this.firestore.collection('usage').doc(docId).set(this.sanitize(summary), { merge: true });
    } catch (err: any) {
      throw err;
    }
  }

  // --- Processed Webhook IDs ---
  public async isWebhookProcessed(webhookId: string): Promise<boolean> {
    try {
      const snap = await this.firestore.collection('processedWebhooks').doc(webhookId).get();
      return snap.exists;
    } catch (err: any) {
      throw err;
    }
  }

  public async markWebhookProcessed(webhookId: string): Promise<void> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('processedWebhooks')
        .doc(webhookId)
        .set({ processedAt: Date.now() }, { merge: true });
    } catch (err: any) {
      throw err;
    }
  }

  /**
   * Atomically claims a telemetry batch for idempotent processing.
   * Returns false when the exact cluster/agent/batch identity was already accepted.
   */
  public async claimTelemetryBatch(batchKey: string, metadata?: Record<string, unknown>): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    const docId = crypto.createHash('sha256').update(batchKey).digest('hex');
    const ref = this.firestore.collection('processedTelemetryBatches').doc(docId);
    return this.firestore.runTransaction(async (tx: any) => {
      const rawRef = ref.raw();
      const snap = await tx.get(rawRef);
      if (snap.exists) return false;
      tx.create(rawRef, {
        batchKey,
        ...this.sanitize(metadata || {}),
        processedAt: Date.now()
      });
      return true;
    });
  }

  // --- Stored Artifacts ---
  public async saveStoredArtifact(artifact: StoredArtifact): Promise<StoredArtifact> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      await this.firestore
        .collection('storedArtifacts')
        .doc(artifact.id)
        .set(this.sanitize(artifact), { merge: true });
      return artifact;
    } catch (err: any) {
      throw err;
    }
  }

  public async getStoredArtifact(orgId: string, id: string): Promise<StoredArtifact | null> {
    try {
      const snap = await this.firestore.collection('storedArtifacts').doc(id).get();
      if (!snap.exists) return null;
      const data = snap.data() as StoredArtifact;
      if (data.orgId !== orgId) return null;
      return data;
    } catch (err: any) {
      throw err;
    }
  }

  public async listStoredArtifacts(
    orgId: string,
    filters?: StoredArtifactFilters
  ): Promise<PaginatedResult<StoredArtifact>> {
    try {
      let query: any = this.firestore
        .collection('storedArtifacts')
        .where('orgId', '==', orgId);

      if (filters?.category) {
        query = query.where('category', '==', filters.category);
      }
      if (filters?.lifecycleStatus) {
        query = query.where('lifecycleStatus', '==', filters.lifecycleStatus);
      }

      const snap = await query.get();
      let list = snap.docs.map((d) => d.data() as StoredArtifact);

      if (filters?.fromTimestamp) {
        list = list.filter((a) => a.createdAt >= filters.fromTimestamp!);
      }
      if (filters?.toTimestamp) {
        list = list.filter((a) => a.createdAt <= filters.toTimestamp!);
      }
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        list = list.filter(
          (a) =>
            a.filename.toLowerCase().includes(q) ||
            a.storagePath.toLowerCase().includes(q) ||
            (a.tags && a.tags.some((t) => t.toLowerCase().includes(q)))
        );
      }

      list.sort((a, b) => b.createdAt - a.createdAt);

      const total = list.length;
      const offset = filters?.offset || 0;
      const limit = filters?.limit || 50;
      const items = list.slice(offset, offset + limit);

      return {
        items,
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (err: any) {
      throw err;
    }
  }

  public async updateStoredArtifactStatus(
    orgId: string,
    id: string,
    status: StoredArtifactLifecycleStatus
  ): Promise<StoredArtifact | null> {
    try {
      const docRef = this.firestore.collection('storedArtifacts').doc(id);
      const snap = await docRef.get();
      if (!snap.exists) return null;
      const data = snap.data() as StoredArtifact;
      if (data.orgId !== orgId) return null;

      const updated: Partial<StoredArtifact> = {
        lifecycleStatus: status,
        updatedAt: Date.now()
      };
      await docRef.update(updated);
      return { ...data, ...updated };
    } catch (err: any) {
      throw err;
    }
  }

  public async deleteStoredArtifact(orgId: string, id: string): Promise<boolean> {
    if (!this.connected) throw new Error('[FirestoreStore] Persistence is not connected');
    try {
      const docRef = this.firestore.collection('storedArtifacts').doc(id);
      const snap = await docRef.get();
      if (!snap.exists) return false;
      const data = snap.data() as StoredArtifact;
      if (data.orgId !== orgId) return false;
      await docRef.delete();
      return true;
    } catch (err: any) {
      throw err;
    }
  }

  public async getStorageUsageSummary(orgId: string): Promise<StorageUsageSummary> {
    try {
      const snap = await this.firestore
        .collection('storedArtifacts')
        .where('orgId', '==', orgId)
        .get();

      const artifacts = snap.docs
        .map((d) => d.data() as StoredArtifact)
        .filter((a) => a.lifecycleStatus !== 'DELETED');

      const categoryBreakdown: any = {
        'audit-exports': { sizeBytes: 0, count: 0 },
        'incident-artifacts': { sizeBytes: 0, count: 0 },
        'remediation-manifests': { sizeBytes: 0, count: 0 },
        'cluster-snapshots': { sizeBytes: 0, count: 0 },
        'ai-diagnostics': { sizeBytes: 0, count: 0 },
        'user-uploads': { sizeBytes: 0, count: 0 },
        'logs': { sizeBytes: 0, count: 0 }
      };

      let totalSizeBytes = 0;
      let totalArtifactsCount = 0;

      for (const art of artifacts) {
        totalSizeBytes += art.sizeBytes;
        totalArtifactsCount += 1;
        if (categoryBreakdown[art.category]) {
          categoryBreakdown[art.category].sizeBytes += art.sizeBytes;
          categoryBreakdown[art.category].count += 1;
        }
      }

      return {
        orgId,
        totalSizeBytes,
        totalArtifactsCount,
        categoryBreakdown,
        lastUpdatedAt: Date.now()
      };
    } catch (err: any) {
      throw err;
    }
  }
}
