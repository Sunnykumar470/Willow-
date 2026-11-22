import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'willow.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    is_online INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT NOT NULL DEFAULT 'Hey there! I am using Willow.',
    privacy_last_seen TEXT NOT NULL DEFAULT 'everyone',
    privacy_profile_photo TEXT NOT NULL DEFAULT 'everyone',
    privacy_online TEXT NOT NULL DEFAULT 'everyone',
    privacy_read_receipts INTEGER NOT NULL DEFAULT 1,
    privacy_status TEXT NOT NULL DEFAULT 'everyone',
    theme TEXT NOT NULL DEFAULT 'light',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
    archived INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    last_read_at TEXT,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
    added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('text', 'image', 'video', 'document', 'audio', 'system')),
    content TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    media_name TEXT,
    media_mime TEXT,
    media_size INTEGER,
    media_duration INTEGER,
    reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    forwarded_from_id TEXT,
    is_edited INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS message_receipts (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TEXT,
    read_at TEXT,
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS starred_messages (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS contacts (
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, contact_user_id)
  );

  CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_updates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('text', 'image', 'video')),
    content TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    bg_color TEXT NOT NULL DEFAULT '#00A884',
    visibility TEXT NOT NULL DEFAULT 'everyone' CHECK(visibility IN ('everyone', 'contacts')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_views (
    status_id TEXT NOT NULL REFERENCES status_updates(id) ON DELETE CASCADE,
    viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TEXT NOT NULL,
    PRIMARY KEY (status_id, viewer_id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_status_expires ON status_updates(expires_at);
`);

// Reset stale online flags on fresh server start
db.prepare('UPDATE users SET is_online = 0').run();

export function nowIso(): string {
  return new Date().toISOString();
}

export function isBlockedBetween(userA: string, userB: string): { aBlockedB: boolean; bBlockedA: boolean } {
  const rowA = db
    .prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?')
    .get(userA, userB);
  const rowB = db
    .prepare('SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?')
    .get(userB, userA);
  return {
    aBlockedB: Boolean(rowA),
    bBlockedA: Boolean(rowB),
  };
}

export function isContactOf(ownerId: string, targetUserId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM contacts WHERE owner_id = ? AND contact_user_id = ?')
    .get(ownerId, targetUserId);
  return Boolean(row);
}

export function sanitizePeerProfile(viewerId: string, targetUserId: string) {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.is_online, u.last_seen_at,
              p.display_name, p.avatar_url, p.bio,
              p.privacy_last_seen, p.privacy_profile_photo, p.privacy_online
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.id = ?`
    )
    .get(targetUserId) as
    | {
        id: string;
        username: string;
        is_online: number;
        last_seen_at: string;
        display_name: string;
        avatar_url: string | null;
        bio: string;
        privacy_last_seen: string;
        privacy_profile_photo: string;
        privacy_online: string;
      }
    | undefined;

  if (!row) return null;

  const { aBlockedB, bBlockedA } = isBlockedBetween(viewerId, targetUserId);
  const viewerIsSelf = viewerId === targetUserId;
  const targetSavedViewer = isContactOf(targetUserId, viewerId);
  const viewerSavedTarget = isContactOf(viewerId, targetUserId);

  const canSeePhoto =
    viewerIsSelf ||
    (!bBlockedA &&
      (row.privacy_profile_photo === 'everyone' ||
        (row.privacy_profile_photo === 'contacts' && targetSavedViewer)));

  const canSeeOnline =
    viewerIsSelf || (!bBlockedA && !aBlockedB && row.privacy_online === 'everyone');

  const canSeeLastSeen =
    viewerIsSelf ||
    (!bBlockedA &&
      !aBlockedB &&
      (row.privacy_last_seen === 'everyone' ||
        (row.privacy_last_seen === 'contacts' && targetSavedViewer)));

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: canSeePhoto ? row.avatar_url : null,
    bio: bBlockedA ? '' : row.bio,
    isOnline: canSeeOnline ? Boolean(row.is_online) : false,
    lastSeenAt: canSeeLastSeen ? row.last_seen_at : null,
    isContact: viewerSavedTarget,
    isBlocked: aBlockedB,
    blockedByPeer: bBlockedA,
  };
}
