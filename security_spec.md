# Security Specification (Firestore Cloud Backup & Profile Sync)

## 1. Data Invariants
1. Every document under `/users/{userId}/profile/{docId}` must belong exclusively to the authenticated, email-verified user whose `request.auth.uid == userId`, with `docId == 'main'`, `uid == userId`, and server-enforced `updatedAt == request.time`.
2. Every document under `/users/{userId}/backups/{backupId}` must belong exclusively to `request.auth.uid == userId` with `ownerUid == userId`, immutable `createdAt` and `ownerUid`, bounded numeric counts, and strict `hasAll` / `hasOnly` key allowlists.
3. All other Firestore paths are denied by default (`match /{document=**} { allow read, write: if false; }`).

## 2. Dirty Dozen Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read/write to `/users/u1/profile/main`.
2. Verified user `u1` attempting to read `/users/u2/profile/main` (cross-tenant PII access).
3. Verified user `u1` attempting to write `/users/u1/profile/main` with `email_verified == false`.
4. Shadow field injection on create: `/users/u1/profile/main` containing `{ ..., isAdmin: true }`.
5. Identity spoofing on create: `/users/u1/profile/main` with `uid: "u2"`.
6. Invalid username format: `username: "Invalid Handle!"` or length < 3 or > 30.
7. Oversized bio poisoning (> 200 chars) on `/users/u1/profile/main`.
8. Client-forged `updatedAt` timestamp not equal to `request.time`.
9. Document ID poisoning: `/users/u1/backups/bad$id!` failing `isValidId()`.
10. Immutable field mutation on update: changing `createdAt` or `ownerUid` on `/users/u1/backups/b1`.
11. Negative or absurd `messageCount: -5` on `/users/u1/backups/b1`.
12. Blanket `list` query by `u1` against `/users/u2/backups`.
