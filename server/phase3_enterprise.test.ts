import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from './store';
import { auditService } from './audit';
import { OrgMemberStatus, Role, TicketCategory, TicketSeverity } from '../src/types/index';

test('Phase 3 Enterprise Foundation: Multi-Tenancy, RBAC, Invitations, and Support', async (t) => {
  const testRunId = Date.now().toString();

  const userOwnerA = { id: `owner-a-${testRunId}`, email: `owner-a@corp.com`, name: 'Owner A', role: 'OWNER' as Role };
  const userAdminA = { id: `admin-a-${testRunId}`, email: `admin-a@corp.com`, name: 'Admin A', role: 'ADMIN' as Role };
  const userOperatorA = { id: `op-a-${testRunId}`, email: `operator-a@corp.com`, name: 'Operator A', role: 'OPERATOR' as Role };
  const userEngineerA = { id: `eng-a-${testRunId}`, email: `eng-a@corp.com`, name: 'Engineer A', role: 'ENGINEER' as Role };
  const userViewerA = { id: `view-a-${testRunId}`, email: `view-a@corp.com`, name: 'Viewer A', role: 'VIEWER' as Role };

  const userOwnerB = { id: `owner-b-${testRunId}`, email: `owner-b@acme.com`, name: 'Owner B', role: 'OWNER' as Role };

  await t.test('1. Organization Creation & Isolation', async () => {
    // Create Org A
    const orgA = store.createOrganization(
      'Acme Alpha Corp',
      userOwnerA.id,
      userOwnerA.email,
      userOwnerA.name
    );
    assert.ok(orgA.id, 'Org A should have a valid ID');
    assert.equal(orgA.name, 'Acme Alpha Corp');

    // Create Org B
    const orgB = store.createOrganization(
      'Beta Dynamics',
      userOwnerB.id,
      userOwnerB.email,
      userOwnerB.name
    );
    assert.ok(orgB.id, 'Org B should have a valid ID');

    // User A should only see Org A
    const orgsForA = store.getOrganizationsForUser(userOwnerA.id, userOwnerA.email);
    assert.ok(orgsForA.some((o) => o.id === orgA.id), 'User A should see Org A');
    assert.ok(!orgsForA.some((o) => o.id === orgB.id), 'User A must NOT see Org B');

    // User B should only see Org B
    const orgsForB = store.getOrganizationsForUser(userOwnerB.id, userOwnerB.email);
    assert.ok(orgsForB.some((o) => o.id === orgB.id), 'User B should see Org B');
    assert.ok(!orgsForB.some((o) => o.id === orgA.id), 'User B must NOT see Org A');

    // Update Org A settings
    const updatedOrgA = store.updateOrganization(
      orgA.id,
      {
        name: 'Acme Alpha Enterprise',
        settings: {
          general: { name: 'Acme Alpha Enterprise', timezone: 'America/New_York' },
          security: { enforceMfa: true, sessionTimeoutMinutes: 720 }
        }
      },
      { id: userOwnerA.id, name: userOwnerA.name }
    );
    assert.equal(updatedOrgA.name, 'Acme Alpha Enterprise');
    assert.equal(updatedOrgA.settings?.security?.enforceMfa, true);
    assert.equal(updatedOrgA.settings?.security?.sessionTimeoutMinutes, 720);
  });

  await t.test('2. Member Management & Least-Privilege RBAC', async () => {
    const orgA = store.getOrganizationsForUser(userOwnerA.id)[0];
    assert.ok(orgA);

    // Add Admin A via invitation flow
    const invAdmin = store.inviteMember(orgA.id, userAdminA.email, 'ADMIN', userOwnerA);
    store.acceptInvitation(invAdmin.token, userAdminA);

    // Add Operator A via invitation flow
    const invOp = store.inviteMember(orgA.id, userOperatorA.email, 'OPERATOR', userAdminA);
    store.acceptInvitation(invOp.token, userOperatorA);

    // Add Engineer A via invitation flow
    const invEng = store.inviteMember(orgA.id, userEngineerA.email, 'ENGINEER', userAdminA);
    store.acceptInvitation(invEng.token, userEngineerA);

    // Add Viewer A via invitation flow
    const invView = store.inviteMember(orgA.id, userViewerA.email, 'VIEWER', userAdminA);
    store.acceptInvitation(invView.token, userViewerA);

    // Fetch members with filters
    const allMembers = store.getOrgMembers(orgA.id);
    assert.equal(allMembers.length, 5, 'Should have 5 total active members');

    const engineers = store.getOrgMembers(orgA.id, { role: 'ENGINEER' });
    assert.equal(engineers.length, 1);
    assert.equal(engineers[0].userId, userEngineerA.id);

    // Update Role: Promote Engineer to Operator
    const updatedMember = store.updateMemberRole(orgA.id, userEngineerA.id, 'OPERATOR', userAdminA);
    assert.equal(updatedMember.role, 'OPERATOR');

    // Prevent demoting last active owner
    assert.throws(
      () => {
        store.updateMemberRole(orgA.id, userOwnerA.id, 'ENGINEER', userAdminA);
      },
      /Cannot demote the final active owner/
    );

    // Member status toggle: Suspend and Reactivate
    const suspended = store.updateMemberStatus(orgA.id, userViewerA.id, 'SUSPENDED', userAdminA);
    assert.equal(suspended.status, 'SUSPENDED');

    const active = store.updateMemberStatus(orgA.id, userViewerA.id, 'ACTIVE', userAdminA);
    assert.equal(active.status, 'ACTIVE');

    // Prevent removing last active owner
    assert.throws(
      () => {
        store.removeMember(orgA.id, userOwnerA.id, userAdminA);
      },
      /Cannot remove the final active owner/
    );

    // Remove Operator A
    const removeSuccess = store.removeMember(orgA.id, userOperatorA.id, userAdminA);
    assert.equal(removeSuccess, true);

    const membersAfterRemoval = store.getOrgMembers(orgA.id);
    assert.ok(!membersAfterRemoval.some((m) => m.userId === userOperatorA.id), 'Removed member must not appear in active members');
  });

  await t.test('3. Organization Cryptographic Invitation Lifecycle', async () => {
    const orgA = store.getOrganizationsForUser(userOwnerA.id)[0];
    assert.ok(orgA);

    const inviteeEmail = `newbie-${testRunId}@corp.com`;

    // Create Invitation
    const invitation = store.inviteMember(orgA.id, inviteeEmail, 'ENGINEER', userAdminA);
    assert.ok(invitation.token, 'Must produce a secure token');
    assert.equal(invitation.email, inviteeEmail);
    assert.equal(invitation.role, 'ENGINEER');
    assert.equal(invitation.status, 'PENDING');
    assert.ok(invitation.expiresAt > Date.now(), 'Expires in future');

    // Duplicate pending invitation refreshes expiration & role
    const duplicateInv = store.inviteMember(orgA.id, inviteeEmail, 'OPERATOR', userAdminA);
    assert.equal(duplicateInv.id, invitation.id);
    assert.equal(duplicateInv.role, 'OPERATOR');

    // Verify invitation token
    const verification = store.verifyInvitation(invitation.token);
    assert.equal(verification.valid, true);
    assert.equal(verification.email, inviteeEmail);
    assert.equal(verification.role, 'OPERATOR');
    assert.equal(verification.orgName, orgA.name);

    // Resend / Renew invitation
    const resent = store.resendInvitation(orgA.id, invitation.id, userAdminA);
    assert.ok(resent.expiresAt >= invitation.expiresAt, 'Resending should extend or preserve valid expiration');

    // Accept invitation as a new user
    const newUser = { id: `joined-${testRunId}`, email: inviteeEmail, name: 'Newbie Engineer' };
    const accepted = store.acceptInvitation(invitation.token, newUser);
    assert.equal(accepted.org.id, orgA.id);
    assert.equal(accepted.role, 'OPERATOR');

    // Verify member is now in the organization
    const orgMembers = store.getOrgMembers(orgA.id);
    const joined = orgMembers.find((m) => m.userId === newUser.id);
    assert.ok(joined, 'New user must now be registered as active org member');
    assert.equal(joined?.role, 'OPERATOR');

    // Inviting an existing active member should throw
    assert.throws(
      () => {
        store.inviteMember(orgA.id, inviteeEmail, 'ENGINEER', userAdminA);
      },
      /already a member/
    );

    // Reusing the accepted token should fail
    assert.throws(
      () => {
        store.acceptInvitation(invitation.token, { id: 'another-user', email: 'another@corp.com', name: 'Another' });
      },
      /no longer valid/
    );

    const emailMismatchInvitation = store.inviteMember(orgA.id, `alice-${testRunId}@corp.com`, 'VIEWER', userAdminA);
    assert.throws(
      () => store.acceptInvitation(emailMismatchInvitation.token, {
        id: `bob-${testRunId}`,
        email: `bob-${testRunId}@corp.com`,
        name: 'Bob'
      }),
      /does not match the authenticated user/
    );
    assert.equal(store.verifyInvitation(emailMismatchInvitation.token).valid, true);

    // Revoking an invitation test
    const revokeInv = store.inviteMember(orgA.id, `revokeme-${testRunId}@corp.com`, 'VIEWER', userAdminA);
    const revokeSuccess = store.revokeInvitation(orgA.id, revokeInv.id, userAdminA);
    assert.equal(revokeSuccess, true);

    assert.throws(
      () => {
        store.acceptInvitation(revokeInv.token, { id: 'user3', email: 'user3@corp.com', name: 'User 3' });
      },
      /no longer valid/
    );
  });

  await t.test('4. Enterprise Support Ticket Dispatch & Isolation', async () => {
    const orgA = store.getOrganizationsForUser(userOwnerA.id)[0];
    const orgB = store.getOrganizationsForUser(userOwnerB.id)[0];
    assert.ok(orgA);
    assert.ok(orgB);

    // Create ticket in Org A
    const ticketA = store.createSupportTicket({
      orgId: orgA.id,
      userId: userAdminA.id,
      userEmail: userAdminA.email,
      userName: userAdminA.name,
      subject: 'Investigate Ingestion Latency on payments-cluster',
      category: 'INCIDENT',
      severity: 'HIGH',
      description: 'P99 telemetry scrape latency exceeded 1500ms during morning traffic spike.'
    });
    assert.ok(ticketA.id);
    assert.equal(ticketA.orgId, orgA.id);
    assert.equal(ticketA.status, 'OPEN');

    // Create ticket in Org B
    const ticketB = store.createSupportTicket({
      orgId: orgB.id,
      userId: userOwnerB.id,
      userEmail: userOwnerB.email,
      userName: userOwnerB.name,
      subject: 'General Question on Node Baselines',
      category: 'GENERAL',
      severity: 'LOW',
      description: 'How is the EWMA alpha coefficient weighted across rolling 24-hour windows?'
    });
    assert.ok(ticketB.id);
    assert.equal(ticketB.orgId, orgB.id);

    // Org A query should only return ticket A
    const ticketsA = store.getSupportTickets(orgA.id);
    assert.ok(ticketsA.some((t) => t.id === ticketA.id));
    assert.ok(!ticketsA.some((t) => t.id === ticketB.id), 'Cross-tenant support tickets must be strictly quarantined');

    // Org B query should only return ticket B
    const ticketsB = store.getSupportTickets(orgB.id);
    assert.ok(ticketsB.some((t) => t.id === ticketB.id));
    assert.ok(!ticketsB.some((t) => t.id === ticketA.id), 'Cross-tenant support tickets must be strictly quarantined');
  });

  await t.test('5. Audit Trail Verification for Enterprise Operations', async () => {
    const orgA = store.getOrganizationsForUser(userOwnerA.id)[0];
    assert.ok(orgA);

    const auditResult = auditService.query({ orgId: orgA.id, limit: 50 });
    const auditLogs = auditResult.items;
    assert.ok(auditLogs.length > 0, 'Audit logs must capture enterprise actions');

    const actions = auditLogs.map((l) => l.action);
    assert.ok(actions.includes('organization.create'), 'Should audit org creation');
    assert.ok(actions.includes('member.invite'), 'Should audit member invitation');
    assert.ok(actions.includes('invitation.accept'), 'Should audit invitation acceptance');
    assert.ok(actions.includes('member.role_change'), 'Should audit role change');
    assert.ok(actions.includes('support.ticket_create'), 'Should audit support ticket submission');
  });
});
