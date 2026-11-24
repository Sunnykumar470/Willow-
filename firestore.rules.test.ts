/**
 * Security Rule Adversarial Verification Suite (Dirty Dozen Payloads)
 * Documents expected PERMISSION_DENIED outcomes against firestore.rules.
 */
export const dirtyDozenPayloads = [
  { name: 'unauthenticated_read', path: 'users/u1/profile/main', auth: null, expected: 'PERMISSION_DENIED' },
  { name: 'cross_tenant_read', path: 'users/u2/profile/main', auth: { uid: 'u1', email_verified: true }, expected: 'PERMISSION_DENIED' },
  { name: 'unverified_email_write', path: 'users/u1/profile/main', auth: { uid: 'u1', email_verified: false }, expected: 'PERMISSION_DENIED' },
  { name: 'shadow_field_injection', path: 'users/u1/profile/main', data: { uid: 'u1', username: 'alex', displayName: 'Alex', bio: '', isAdmin: true }, expected: 'PERMISSION_DENIED' },
  { name: 'uid_spoofing', path: 'users/u1/profile/main', data: { uid: 'u2', username: 'alex', displayName: 'Alex', bio: '' }, expected: 'PERMISSION_DENIED' },
  { name: 'invalid_username_pattern', path: 'users/u1/profile/main', data: { uid: 'u1', username: 'Bad Name!', displayName: 'Alex', bio: '' }, expected: 'PERMISSION_DENIED' },
  { name: 'oversized_bio', path: 'users/u1/profile/main', data: { uid: 'u1', username: 'alex', displayName: 'Alex', bio: 'x'.repeat(201) }, expected: 'PERMISSION_DENIED' },
  { name: 'forged_timestamp', path: 'users/u1/profile/main', data: { uid: 'u1', username: 'alex', displayName: 'Alex', bio: '', updatedAt: '2020-01-01T00:00:00Z' }, expected: 'PERMISSION_DENIED' },
  { name: 'invalid_doc_id', path: 'users/u1/backups/bad$id!', auth: { uid: 'u1', email_verified: true }, expected: 'PERMISSION_DENIED' },
  { name: 'immutable_created_at_update', path: 'users/u1/backups/b1', auth: { uid: 'u1', email_verified: true }, expected: 'PERMISSION_DENIED' },
  { name: 'negative_message_count', path: 'users/u1/backups/b1', data: { ownerUid: 'u1', username: 'alex', backupLabel: 'test', conversationCount: 1, messageCount: -5 }, expected: 'PERMISSION_DENIED' },
  { name: 'cross_tenant_list', path: 'users/u2/backups', auth: { uid: 'u1', email_verified: true }, expected: 'PERMISSION_DENIED' },
];
