import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  clearSessionCookie,
  createSessionForUser,
  extractSessionToken,
  hashSecret,
  hashToken,
  normalizeUsername,
  rateLimitMiddleware,
  requireAuth,
  setSessionCookie,
  validatePassword,
  verifyCsrfOrigin,
  verifySecret,
  type AuthedRequest,
} from './auth.ts';
import {
  db,
  isBlockedBetween,
  isContactOf,
  nowIso,
  sanitizePeerProfile,
  uploadsDir,
} from './db.ts';
import {
  broadcastToConversation,
  broadcastToUsers,
  getConversationMemberIds,
  isUserConnected,
  sendToUser,
} from './realtime.ts';
import type { ChatMessage, ConversationSummary, MessageReaction, ReplyPreview } from '../types.ts';

const ALLOWED_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.mp4',
  '.webm',
  '.mov',
  '.ogg',
  '.mp3',
  '.wav',
  '.m4a',
  '.pdf',
  '.txt',
  '.csv',
  '.json',
  '.md',
  '.zip',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ALLOWED_EXTS.has(ext) ? ext : '.bin';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (mime === 'image/svg+xml' || ext === '.svg' || ext === '.html' || ext === '.htm' || ext === '.js') {
      cb(new Error('Unsupported file type for security reasons.'));
      return;
    }
    if (!ALLOWED_EXTS.has(ext) && !mime.startsWith('image/') && !mime.startsWith('video/') && !mime.startsWith('audio/')) {
      cb(new Error('File type is not allowed.'));
      return;
    }
    cb(null, true);
  },
});

function buildOwnAccount(userId: string) {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.created_at, u.last_seen_at, u.is_online,
              p.display_name, p.avatar_url, p.bio,
              p.privacy_last_seen, p.privacy_profile_photo, p.privacy_online,
              p.privacy_read_receipts, p.privacy_status, p.theme
       FROM users u
       JOIN profiles p ON p.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: string;
        username: string;
        created_at: string;
        last_seen_at: string;
        is_online: number;
        display_name: string;
        avatar_url: string | null;
        bio: string;
        privacy_last_seen: string;
        privacy_profile_photo: string;
        privacy_online: string;
        privacy_read_receipts: number;
        privacy_status: string;
        theme: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    isOnline: Boolean(row.is_online),
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    privacyLastSeen: row.privacy_last_seen,
    privacyProfilePhoto: row.privacy_profile_photo,
    privacyOnline: row.privacy_online,
    privacyReadReceipts: Boolean(row.privacy_read_receipts),
    privacyStatus: row.privacy_status,
    theme: row.theme,
  };
}

interface RawMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_url: string | null;
  type: ChatMessage['type'];
  content: string;
  media_url: string | null;
  media_name: string | null;
  media_mime: string | null;
  media_size: number | null;
  media_duration: number | null;
  reply_to_id: string | null;
  forwarded_from_id: string | null;
  is_edited: number;
  is_deleted: number;
  status: ChatMessage['status'];
  created_at: string;
  updated_at: string;
}

function hydrateMessages(rows: RawMessageRow[], viewerId: string): ChatMessage[] {
  if (rows.length === 0) return [];
  const msgIds = rows.map((r) => r.id);
  const placeholders = msgIds.map(() => '?').join(',');

  const reactionRows = db
    .prepare(
      `SELECT mr.message_id, mr.emoji, mr.user_id, mr.created_at,
              u.username, p.display_name
       FROM message_reactions mr
       JOIN users u ON u.id = mr.user_id
       JOIN profiles p ON p.user_id = u.id
       WHERE mr.message_id IN (${placeholders})
       ORDER BY mr.created_at ASC`
    )
    .all(...msgIds) as {
    message_id: string;
    emoji: string;
    user_id: string;
    created_at: string;
    username: string;
    display_name: string;
  }[];

  const reactionsByMsg = new Map<string, MessageReaction[]>();
  for (const r of reactionRows) {
    const list = reactionsByMsg.get(r.message_id) || [];
    list.push({
      emoji: r.emoji,
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      createdAt: r.created_at,
    });
    reactionsByMsg.set(r.message_id, list);
  }

  const starredRows = db
    .prepare(`SELECT message_id FROM starred_messages WHERE user_id = ? AND message_id IN (${placeholders})`)
    .all(viewerId, ...msgIds) as { message_id: string }[];
  const starredSet = new Set(starredRows.map((r) => r.message_id));

  const replyIds = Array.from(new Set(rows.map((r) => r.reply_to_id).filter((id): id is string => Boolean(id))));
  const replyMap = new Map<string, ReplyPreview>();
  if (replyIds.length > 0) {
    const rPlaceholders = replyIds.map(() => '?').join(',');
    const replyRows = db
      .prepare(
        `SELECT m.id, m.sender_id, m.type, m.content, m.media_name, m.is_deleted,
                u.username AS sender_username, p.display_name AS sender_display_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         JOIN profiles p ON p.user_id = u.id
         WHERE m.id IN (${rPlaceholders})`
      )
      .all(...replyIds) as {
      id: string;
      sender_id: string;
      type: ChatMessage['type'];
      content: string;
      media_name: string | null;
      is_deleted: number;
      sender_username: string;
      sender_display_name: string;
    }[];

    for (const rr of replyRows) {
      replyMap.set(rr.id, {
        id: rr.id,
        senderId: rr.sender_id,
        senderUsername: rr.sender_username,
        senderDisplayName: rr.sender_display_name,
        type: rr.type,
        content: rr.is_deleted ? 'This message was deleted' : rr.content,
        mediaName: rr.is_deleted ? null : rr.media_name,
        isDeleted: Boolean(rr.is_deleted),
      });
    }
  }

  return rows.map((row) => {
    const deleted = Boolean(row.is_deleted);
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderUsername: row.sender_username,
      senderDisplayName: row.sender_display_name,
      senderAvatarUrl: row.sender_avatar_url,
      type: row.type,
      content: deleted ? '' : row.content,
      mediaUrl: deleted ? null : row.media_url,
      mediaName: deleted ? null : row.media_name,
      mediaMime: deleted ? null : row.media_mime,
      mediaSize: deleted ? null : row.media_size,
      mediaDuration: deleted ? null : row.media_duration,
      replyToId: row.reply_to_id,
      replyTo: row.reply_to_id ? replyMap.get(row.reply_to_id) || null : null,
      forwardedFromId: row.forwarded_from_id,
      isEdited: Boolean(row.is_edited),
      isDeleted: deleted,
      status: row.status,
      reactions: reactionsByMsg.get(row.id) || [],
      isStarred: starredSet.has(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function fetchHydratedMessageById(messageId: string, viewerId: string): ChatMessage | null {
  const row = db
    .prepare(
      `SELECT m.*, u.username AS sender_username, p.display_name AS sender_display_name, p.avatar_url AS sender_avatar_url
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       JOIN profiles p ON p.user_id = u.id
       WHERE m.id = ?`
    )
    .get(messageId) as RawMessageRow | undefined;
  if (!row) return null;
  return hydrateMessages([row], viewerId)[0] || null;
}

function ensureDirectConversation(userId: string, peerId: string): { convId: string; created: boolean } {
  return db.transaction(() => {
    const existingConv = db
      .prepare(
        `SELECT c.id
         FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
         WHERE c.type = 'direct'
         LIMIT 1`
      )
      .get(userId, peerId) as { id: string } | undefined;

    if (existingConv) {
      db.prepare('UPDATE conversation_members SET archived = 0 WHERE conversation_id = ? AND user_id = ?').run(
        existingConv.id,
        userId
      );
      return { convId: existingConv.id, created: false };
    }

    const convId = `conv_${crypto.randomUUID()}`;
    const ts = nowIso();
    db.prepare('INSERT INTO conversations (id, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      convId,
      'direct',
      userId,
      ts,
      ts
    );
    db.prepare(
      'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(convId, userId, 'member', ts);
    db.prepare(
      'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(convId, peerId, 'member', ts);

    return { convId, created: true };
  })();
}

function buildConversationSummaries(userId: string): ConversationSummary[] {
  const convRows = db
    .prepare(
      `SELECT c.id, c.type, c.created_by, c.updated_at,
              cm.role AS my_role, cm.archived, cm.muted, cm.pinned, cm.last_read_at,
              g.name AS group_name, g.description AS group_description, g.avatar_url AS group_avatar_url
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       LEFT JOIN groups g ON g.conversation_id = c.id
       WHERE cm.user_id = ?
       ORDER BY cm.pinned DESC, c.updated_at DESC`
    )
    .all(userId) as {
    id: string;
    type: 'direct' | 'group';
    created_by: string | null;
    updated_at: string;
    my_role: 'admin' | 'member';
    archived: number;
    muted: number;
    pinned: number;
    last_read_at: string | null;
    group_name: string | null;
    group_description: string | null;
    group_avatar_url: string | null;
  }[];

  const summaries: ConversationSummary[] = [];
  const seenPeerIds = new Set<string>();

  for (const conv of convRows) {
    let peer = null;
    let peerId: string | null = null;
    let title = conv.group_name || 'Group';
    let subtitle = '';
    let avatarUrl = conv.group_avatar_url;
    let groupInfo: ConversationSummary['group'] = null;

    if (conv.type === 'direct') {
      const peerRow = db
        .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?')
        .get(conv.id, userId) as { user_id: string } | undefined;
      if (!peerRow) continue;
      peerId = peerRow.user_id;
      if (seenPeerIds.has(peerId)) continue;
      peer = sanitizePeerProfile(userId, peerId);
      if (peer) {
        title = peer.displayName;
        subtitle = `@${peer.username}`;
        avatarUrl = peer.avatarUrl;
      }
    } else {
      const countRow = db
        .prepare('SELECT COUNT(*) AS cnt FROM conversation_members WHERE conversation_id = ?')
        .get(conv.id) as { cnt: number };
      subtitle = `${countRow.cnt} members`;
      groupInfo = {
        name: conv.group_name || 'Group',
        description: conv.group_description || '',
        avatarUrl: conv.group_avatar_url,
        memberCount: countRow.cnt,
        myRole: conv.my_role,
      };
    }

    const lastMsgRow = db
      .prepare(
        `SELECT m.*, u.username AS sender_username, p.display_name AS sender_display_name, p.avatar_url AS sender_avatar_url
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         JOIN profiles p ON p.user_id = u.id
         WHERE m.conversation_id = ?
         ORDER BY m.created_at DESC
         LIMIT 1`
      )
      .get(conv.id) as RawMessageRow | undefined;

    const lastMessage = lastMsgRow ? hydrateMessages([lastMsgRow], userId)[0] : null;

    // For direct chats with no messages yet, show only if initiated by this user or saved as a friend
    if (conv.type === 'direct' && !lastMessage) {
      const isSavedFriend = peerId ? isContactOf(userId, peerId) : false;
      if (conv.created_by !== userId && !isSavedFriend) {
        continue;
      }
    }

    if (peerId) {
      seenPeerIds.add(peerId);
    }

    const unreadRow = conv.last_read_at
      ? (db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM messages
             WHERE conversation_id = ? AND sender_id != ? AND created_at > ? AND is_deleted = 0`
          )
          .get(conv.id, userId, conv.last_read_at) as { cnt: number })
      : (db
          .prepare(
            `SELECT COUNT(*) AS cnt FROM messages
             WHERE conversation_id = ? AND sender_id != ? AND is_deleted = 0`
          )
          .get(conv.id, userId) as { cnt: number });

    summaries.push({
      id: conv.id,
      type: conv.type,
      title,
      subtitle,
      avatarUrl,
      peer,
      group: groupInfo,
      lastMessage,
      unreadCount: unreadRow?.cnt || 0,
      archived: Boolean(conv.archived),
      muted: Boolean(conv.muted),
      pinned: Boolean(conv.pinned),
      updatedAt: lastMessage ? lastMessage.createdAt : conv.updated_at,
    });
  }

  summaries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return summaries;
}

export function createApiRouter() {
  const router = express.Router();

  // CSRF check on mutating API calls
  router.use(verifyCsrfOrigin);

  // ---------------- AUTH ROUTES ----------------
  router.get('/auth/check-username', rateLimitMiddleware('chkuser', 60, 60_000), (req, res) => {
    const parsed = normalizeUsername(req.query.username);
    if (!parsed.valid) {
      res.json({ available: false, valid: false, normalized: parsed.username, reason: parsed.reason });
      return;
    }
    const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(parsed.username);
    res.json({
      available: !existing,
      valid: true,
      normalized: parsed.username,
      reason: existing ? 'Username is already taken.' : 'Username is available.',
    });
  });

  router.post('/auth/register', rateLimitMiddleware('register', 20, 60_000), (req, res) => {
    const { username, password, displayName, avatarUrl, bio } = req.body || {};
    const parsed = normalizeUsername(username);
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.reason });
      return;
    }

    const parsedPass = validatePassword(password);
    if (!parsedPass.valid) {
      res.status(400).json({ error: parsedPass.reason });
      return;
    }

    const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(parsed.username);
    if (existing) {
      res.status(409).json({ error: 'This username is already taken. Please choose another.' });
      return;
    }

    const cleanDisplayName =
      typeof displayName === 'string' && displayName.trim().length > 0
        ? displayName.trim().slice(0, 60)
        : parsed.username;
    const cleanBio =
      typeof bio === 'string' ? bio.trim().slice(0, 200) : 'Hey there! I am using Willow.';
    const cleanAvatar =
      typeof avatarUrl === 'string' &&
      (avatarUrl.startsWith('/uploads/') || avatarUrl.startsWith('/src/assets/images/'))
        ? avatarUrl
        : null;

    const userId = `usr_${crypto.randomUUID()}`;
    const passwordHash = hashSecret(parsedPass.password);
    const ts = nowIso();

    try {
      const tx = db.transaction(() => {
        db.prepare(
          'INSERT INTO users (id, username, password_hash, created_at, last_seen_at, is_online) VALUES (?, ?, ?, ?, ?, 1)'
        ).run(userId, parsed.username, passwordHash, ts, ts);

        db.prepare(
          `INSERT INTO profiles (user_id, display_name, avatar_url, bio, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        ).run(userId, cleanDisplayName, cleanAvatar, cleanBio, ts);
      });
      tx();
    } catch {
      res.status(409).json({ error: 'Username already registered.' });
      return;
    }

    const token = createSessionForUser(userId);
    setSessionCookie(req, res, token);
    res.status(201).json({
      user: buildOwnAccount(userId),
      sessionToken: token,
    });
  });

  router.post('/auth/login', rateLimitMiddleware('login', 20, 60_000), (req, res) => {
    const { username, password } = req.body || {};
    const parsed = normalizeUsername(username);
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.reason });
      return;
    }
    if (typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }

    const row = db
      .prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .get(parsed.username) as { id: string; password_hash: string } | undefined;

    if (!row || !verifySecret(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = createSessionForUser(row.id);
    setSessionCookie(req, res, token);
    res.json({ user: buildOwnAccount(row.id), sessionToken: token });
  });

  router.get('/auth/me', requireAuth, (req: AuthedRequest, res) => {
    const account = buildOwnAccount(req.userId!);
    if (!account) {
      res.status(401).json({ error: 'Account not found' });
      return;
    }
    res.json({ user: account });
  });

  router.post('/auth/logout', (req, res) => {
    const token = extractSessionToken(req);
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.post('/auth/change-password', requireAuth, rateLimitMiddleware('chgpass', 10, 60_000), (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      res.status(400).json({ error: 'Current password is required.' });
      return;
    }
    const parsedNew = validatePassword(newPassword);
    if (!parsedNew.valid) {
      res.status(400).json({ error: parsedNew.reason });
      return;
    }

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
      | { password_hash: string }
      | undefined;
    if (!row || !verifySecret(currentPassword, row.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    const hashed = hashSecret(parsedNew.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashed, userId);

    const currentToken = extractSessionToken(req);
    if (currentToken) {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(
        userId,
        hashToken(currentToken)
      );
    }

    res.json({ ok: true });
  });

  router.delete('/auth/account', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    // Find direct conversations so peers get updated
    const convIds = db
      .prepare('SELECT conversation_id FROM conversation_members WHERE user_id = ?')
      .all(userId) as { conversation_id: string }[];

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    for (const c of convIds) {
      broadcastToConversation(c.conversation_id, {
        type: 'conversation:updated',
        payload: { conversationId: c.conversation_id },
      });
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // ---------------- UPLOAD ROUTE ----------------
  router.post(
    '/upload',
    requireAuth,
    rateLimitMiddleware('upload', 30, 60_000),
    (req: AuthedRequest, res) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          res.status(400).json({ error: err.message || 'Upload failed' });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'No file provided' });
          return;
        }
        res.status(201).json({
          url: `/uploads/${req.file.filename}`,
          name: req.file.originalname.slice(0, 120),
          mime: req.file.mimetype,
          size: req.file.size,
        });
      });
    }
  );

  // ---------------- PROFILE & PRIVACY ROUTES ----------------
  router.patch('/profile', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const {
      displayName,
      bio,
      avatarUrl,
      privacyLastSeen,
      privacyProfilePhoto,
      privacyOnline,
      privacyReadReceipts,
      privacyStatus,
      theme,
    } = req.body || {};

    const current = buildOwnAccount(userId);
    if (!current) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const nextDisplayName =
      typeof displayName === 'string' && displayName.trim().length > 0
        ? displayName.trim().slice(0, 60)
        : current.displayName;
    const nextBio = typeof bio === 'string' ? bio.trim().slice(0, 200) : current.bio;

    let nextAvatar = current.avatarUrl;
    if (avatarUrl === null) {
      nextAvatar = null;
    } else if (
      typeof avatarUrl === 'string' &&
      (avatarUrl.startsWith('/uploads/') || avatarUrl.startsWith('/src/assets/images/'))
    ) {
      nextAvatar = avatarUrl;
    }

    const validScope = (v: unknown, fallback: string) =>
      v === 'everyone' || v === 'contacts' || v === 'nobody' ? v : fallback;
    const nextLastSeen = validScope(privacyLastSeen, current.privacyLastSeen);
    const nextPhoto = validScope(privacyProfilePhoto, current.privacyProfilePhoto);
    const nextOnline = privacyOnline === 'everyone' || privacyOnline === 'nobody' ? privacyOnline : current.privacyOnline;
    const nextReceipts =
      typeof privacyReadReceipts === 'boolean' ? (privacyReadReceipts ? 1 : 0) : current.privacyReadReceipts ? 1 : 0;
    const nextStatus =
      privacyStatus === 'everyone' || privacyStatus === 'contacts' ? privacyStatus : current.privacyStatus;
    const nextTheme = theme === 'light' || theme === 'dark' ? theme : current.theme;

    db.prepare(
      `UPDATE profiles
       SET display_name = ?, bio = ?, avatar_url = ?,
           privacy_last_seen = ?, privacy_profile_photo = ?, privacy_online = ?,
           privacy_read_receipts = ?, privacy_status = ?, theme = ?, updated_at = ?
       WHERE user_id = ?`
    ).run(
      nextDisplayName,
      nextBio,
      nextAvatar,
      nextLastSeen,
      nextPhoto,
      nextOnline,
      nextReceipts,
      nextStatus,
      nextTheme,
      nowIso(),
      userId
    );

    const updated = buildOwnAccount(userId);
    // Notify conversation peers so profile updates reflect live
    const peerRows = db
      .prepare(
        `SELECT DISTINCT cm2.user_id AS peer_id
         FROM conversation_members cm1
         JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
         WHERE cm1.user_id = ? AND cm2.user_id != ?`
      )
      .all(userId, userId) as { peer_id: string }[];
    broadcastToUsers(
      peerRows.map((p) => p.peer_id),
      { type: 'profile:updated', payload: { userId } }
    );

    res.json({ user: updated });
  });

  // ---------------- USER DISCOVERY & CONTACTS & BLOCKING ----------------
  router.get('/users/search', requireAuth, rateLimitMiddleware('search', 60, 60_000), (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const rawQ = typeof req.query.q === 'string' ? req.query.q.trim().replace(/^@+/, '').toLowerCase() : '';
    if (!rawQ) {
      res.json({ users: [] });
      return;
    }

    const pattern = `%${rawQ}%`;
    const rows = db
      .prepare(
        `SELECT u.id
         FROM users u
         JOIN profiles p ON p.user_id = u.id
         WHERE u.id != ?
           AND (u.username LIKE ? OR LOWER(p.display_name) LIKE ?)
           AND NOT EXISTS (
             SELECT 1 FROM blocked_users b WHERE b.blocker_id = u.id AND b.blocked_id = ?
           )
         ORDER BY (CASE WHEN u.username = ? THEN 0 WHEN u.username LIKE ? THEN 1 ELSE 2 END), u.username ASC
         LIMIT 25`
      )
      .all(userId, pattern, pattern, userId, rawQ, `${rawQ}%`) as { id: string }[];

    const users = rows
      .map((r) => sanitizePeerProfile(userId, r.id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u));

    res.json({ users });
  });

  router.get('/users/:username', requireAuth, (req: AuthedRequest, res) => {
    const parsed = normalizeUsername(req.params.username);
    if (!parsed.valid) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.username) as
      | { id: string }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const profile = sanitizePeerProfile(req.userId!, target.id);
    if (!profile) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ profile });
  });

  router.get('/contacts', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT contact_user_id FROM contacts WHERE owner_id = ? ORDER BY created_at DESC')
      .all(req.userId!) as { contact_user_id: string }[];
    const contacts = rows
      .map((r) => sanitizePeerProfile(req.userId!, r.contact_user_id))
      .filter((u): u is NonNullable<typeof u> => Boolean(u));
    res.json({ contacts });
  });

  router.post('/contacts', requireAuth, (req: AuthedRequest, res) => {
    const ownerId = req.userId!;
    const { userId, username } = req.body || {};
    let targetId = typeof userId === 'string' ? userId : '';
    if (!targetId && typeof username === 'string') {
      const parsed = normalizeUsername(username);
      if (parsed.valid) {
        const u = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.username) as
          | { id: string }
          | undefined;
        if (u) targetId = u.id;
      }
    }

    if (!targetId || targetId === ownerId) {
      res.status(400).json({ error: 'Valid contact user is required.' });
      return;
    }
    const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId);
    if (!exists) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    db.prepare(
      'INSERT OR IGNORE INTO contacts (owner_id, contact_user_id, created_at) VALUES (?, ?, ?)'
    ).run(ownerId, targetId, nowIso());

    let conversation = null;
    const { aBlockedB, bBlockedA } = isBlockedBetween(ownerId, targetId);
    if (!aBlockedB && !bBlockedA) {
      const { convId } = ensureDirectConversation(ownerId, targetId);
      conversation = buildConversationSummaries(ownerId).find((c) => c.id === convId) || null;
      sendToUser(ownerId, { type: 'conversation:updated', payload: { conversationId: convId } });
    }
    sendToUser(ownerId, { type: 'contact:updated', payload: { userId: targetId } });

    res.status(201).json({ contact: sanitizePeerProfile(ownerId, targetId), conversation });
  });

  router.delete('/contacts/:userId', requireAuth, (req: AuthedRequest, res) => {
    const ownerId = req.userId!;
    const targetId = String(req.params.userId);
    db.prepare('DELETE FROM contacts WHERE owner_id = ? AND contact_user_id = ?').run(
      ownerId,
      targetId
    );
    sendToUser(ownerId, { type: 'contact:updated', payload: { userId: targetId } });
    sendToUser(ownerId, { type: 'conversation:updated', payload: { userId: targetId } });
    res.json({ ok: true });
  });

  router.get('/blocks', requireAuth, (req: AuthedRequest, res) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, p.display_name, p.avatar_url, b.created_at
         FROM blocked_users b
         JOIN users u ON u.id = b.blocked_id
         JOIN profiles p ON p.user_id = u.id
         WHERE b.blocker_id = ?
         ORDER BY b.created_at DESC`
      )
      .all(req.userId!) as {
      id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      created_at: string;
    }[];

    res.json({
      blocked: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        blockedAt: r.created_at,
      })),
    });
  });

  router.post('/blocks', requireAuth, (req: AuthedRequest, res) => {
    const blockerId = req.userId!;
    const { userId, reason } = req.body || {};
    if (typeof userId !== 'string' || !userId || userId === blockerId) {
      res.status(400).json({ error: 'Invalid user to block.' });
      return;
    }
    db.prepare(
      'INSERT OR REPLACE INTO blocked_users (blocker_id, blocked_id, reason, created_at) VALUES (?, ?, ?, ?)'
    ).run(blockerId, userId, typeof reason === 'string' ? reason.slice(0, 200) : null, nowIso());

    sendToUser(userId, { type: 'presence:update', payload: { userId: blockerId, isOnline: false, lastSeenAt: null } });
    res.status(201).json({ ok: true });
  });

  router.delete('/blocks/:userId', requireAuth, (req: AuthedRequest, res) => {
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(
      req.userId!,
      req.params.userId
    );
    res.json({ ok: true });
  });

  router.post('/reports', requireAuth, rateLimitMiddleware('report', 10, 60_000), (req: AuthedRequest, res) => {
    const { userId, reason, details } = req.body || {};
    if (typeof userId !== 'string' || typeof reason !== 'string' || !reason.trim()) {
      res.status(400).json({ error: 'Reported user and reason are required.' });
      return;
    }
    db.prepare(
      'INSERT INTO reports (id, reporter_id, reported_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      `rep_${crypto.randomUUID()}`,
      req.userId!,
      userId,
      reason.trim().slice(0, 100),
      typeof details === 'string' ? details.trim().slice(0, 500) : null,
      nowIso()
    );
    res.status(201).json({ ok: true });
  });

  // ---------------- CONVERSATIONS & GROUPS ----------------
  router.get('/conversations', requireAuth, (req: AuthedRequest, res) => {
    res.json({ conversations: buildConversationSummaries(req.userId!) });
  });

  router.post('/conversations/direct', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { username, userId: targetUserId } = req.body || {};

    let peerId = typeof targetUserId === 'string' ? targetUserId : '';
    if (!peerId && typeof username === 'string') {
      const parsed = normalizeUsername(username);
      if (!parsed.valid) {
        res.status(400).json({ error: parsed.reason });
        return;
      }
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get(parsed.username) as
        | { id: string }
        | undefined;
      if (!row) {
        res.status(404).json({ error: `No user found with username @${parsed.username}.` });
        return;
      }
      peerId = row.id;
    }

    if (!peerId || peerId === userId) {
      res.status(400).json({ error: 'Please choose another user to message.' });
      return;
    }

    const peerExists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(peerId);
    if (!peerExists) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const { aBlockedB, bBlockedA } = isBlockedBetween(userId, peerId);
    if (aBlockedB) {
      res.status(403).json({ error: 'You have blocked this user. Unblock them first to message.' });
      return;
    }
    if (bBlockedA) {
      res.status(403).json({ error: 'Unable to start conversation with this user.' });
      return;
    }

    const { convId, created } = ensureDirectConversation(userId, peerId);
    if (created) {
      sendToUser(userId, { type: 'conversation:updated', payload: { conversationId: convId } });
    }
    const summary = buildConversationSummaries(userId).find((c) => c.id === convId);
    res.status(created ? 201 : 200).json({ conversation: summary });
  });

  router.post('/conversations/group', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { name, description, avatarUrl, memberUsernames } = req.body || {};

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Group name is required.' });
      return;
    }
    const cleanName = name.trim().slice(0, 80);
    const cleanDesc = typeof description === 'string' ? description.trim().slice(0, 300) : '';
    const cleanAvatar =
      typeof avatarUrl === 'string' &&
      (avatarUrl.startsWith('/uploads/') || avatarUrl.startsWith('/src/assets/images/'))
        ? avatarUrl
        : null;

    const usernames: string[] = Array.isArray(memberUsernames)
      ? memberUsernames
          .map((u) => normalizeUsername(u))
          .filter((p) => p.valid)
          .map((p) => p.username)
      : [];

    const memberIds = new Set<string>([userId]);
    for (const uname of usernames) {
      const row = db.prepare('SELECT id FROM users WHERE username = ?').get(uname) as { id: string } | undefined;
      if (row && row.id !== userId) {
        const { aBlockedB, bBlockedA } = isBlockedBetween(userId, row.id);
        if (!aBlockedB && !bBlockedA) {
          memberIds.add(row.id);
        }
      }
    }

    const convId = `grp_${crypto.randomUUID()}`;
    const sysMsgId = `msg_${crypto.randomUUID()}`;
    const ts = nowIso();
    const creator = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string };

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO conversations (id, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        convId,
        'group',
        userId,
        ts,
        ts
      );
      db.prepare(
        'INSERT INTO groups (conversation_id, name, description, avatar_url, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(convId, cleanName, cleanDesc, cleanAvatar, ts);

      for (const mid of memberIds) {
        const role = mid === userId ? 'admin' : 'member';
        db.prepare(
          'INSERT INTO conversation_members (conversation_id, user_id, role, last_read_at, joined_at) VALUES (?, ?, ?, ?, ?)'
        ).run(convId, mid, role, ts, ts);
        db.prepare(
          'INSERT INTO group_members (conversation_id, user_id, role, added_by, joined_at) VALUES (?, ?, ?, ?, ?)'
        ).run(convId, mid, role, userId, ts);
      }

      db.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, type, content, status, created_at, updated_at)
         VALUES (?, ?, ?, 'system', ?, 'read', ?, ?)`
      ).run(sysMsgId, convId, userId, `@${creator.username} created group "${cleanName}"`, ts, ts);
    });
    tx();

    broadcastToUsers(Array.from(memberIds), {
      type: 'conversation:updated',
      payload: { conversationId: convId },
    });

    const summary = buildConversationSummaries(userId).find((c) => c.id === convId);
    res.status(201).json({ conversation: summary });
  });

  router.get('/conversations/:id', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const membership = db
      .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId) as { role: string } | undefined;
    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this conversation.' });
      return;
    }

    const memberRows = db
      .prepare(
        `SELECT cm.user_id, cm.role, cm.joined_at
         FROM conversation_members cm
         WHERE cm.conversation_id = ?
         ORDER BY (CASE WHEN cm.role = 'admin' THEN 0 ELSE 1 END), cm.joined_at ASC`
      )
      .all(convId) as { user_id: string; role: 'admin' | 'member'; joined_at: string }[];

    const members = memberRows
      .map((mr) => {
        const p = sanitizePeerProfile(userId, mr.user_id);
        if (!p) return null;
        return {
          userId: mr.user_id,
          username: p.username,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          bio: p.bio,
          role: mr.role,
          isOnline: p.isOnline,
          lastSeenAt: p.lastSeenAt,
          joinedAt: mr.joined_at,
        };
      })
      .filter((m): m is NonNullable<typeof m> => Boolean(m));

    const summary = buildConversationSummaries(userId).find((c) => c.id === convId);
    res.json({ conversation: summary, members });
  });

  router.patch('/conversations/:id', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const { archived, muted, pinned } = req.body || {};

    const existing = db
      .prepare('SELECT archived, muted, pinned FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId) as { archived: number; muted: number; pinned: number } | undefined;
    if (!existing) {
      res.status(403).json({ error: 'Not a member of this conversation.' });
      return;
    }

    db.prepare(
      'UPDATE conversation_members SET archived = ?, muted = ?, pinned = ? WHERE conversation_id = ? AND user_id = ?'
    ).run(
      typeof archived === 'boolean' ? (archived ? 1 : 0) : existing.archived,
      typeof muted === 'boolean' ? (muted ? 1 : 0) : existing.muted,
      typeof pinned === 'boolean' ? (pinned ? 1 : 0) : existing.pinned,
      convId,
      userId
    );

    const summary = buildConversationSummaries(userId).find((c) => c.id === convId);
    res.json({ conversation: summary });
  });

  router.patch('/conversations/:id/group', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const membership = db
      .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId) as { role: string } | undefined;
    if (!membership || membership.role !== 'admin') {
      res.status(403).json({ error: 'Only group administrators can update group info.' });
      return;
    }

    const current = db.prepare('SELECT name, description, avatar_url FROM groups WHERE conversation_id = ?').get(convId) as
      | { name: string; description: string; avatar_url: string | null }
      | undefined;
    if (!current) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }

    const { name, description, avatarUrl } = req.body || {};
    const nextName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : current.name;
    const nextDesc = typeof description === 'string' ? description.trim().slice(0, 300) : current.description;
    let nextAvatar = current.avatar_url;
    if (avatarUrl === null) nextAvatar = null;
    else if (
      typeof avatarUrl === 'string' &&
      (avatarUrl.startsWith('/uploads/') || avatarUrl.startsWith('/src/assets/images/'))
    ) {
      nextAvatar = avatarUrl;
    }

    db.prepare('UPDATE groups SET name = ?, description = ?, avatar_url = ?, updated_at = ? WHERE conversation_id = ?').run(
      nextName,
      nextDesc,
      nextAvatar,
      nowIso(),
      convId
    );

    broadcastToConversation(convId, { type: 'conversation:updated', payload: { conversationId: convId } });
    res.json({ ok: true });
  });

  router.post('/conversations/:id/members', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const membership = db
      .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId) as { role: string } | undefined;
    if (!membership || membership.role !== 'admin') {
      res.status(403).json({ error: 'Only group administrators can add members.' });
      return;
    }

    const parsed = normalizeUsername(req.body?.username);
    if (!parsed.valid) {
      res.status(400).json({ error: parsed.reason });
      return;
    }

    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(parsed.username) as
      | { id: string; username: string }
      | undefined;
    if (!target) {
      res.status(404).json({ error: `User @${parsed.username} not found.` });
      return;
    }

    const { aBlockedB, bBlockedA } = isBlockedBetween(userId, target.id);
    if (aBlockedB || bBlockedA) {
      res.status(403).json({ error: 'Cannot add this user to the group.' });
      return;
    }

    const already = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, target.id);
    if (already) {
      res.status(409).json({ error: `@${target.username} is already in this group.` });
      return;
    }

    const actor = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string };
    const ts = nowIso();
    const sysMsgId = `msg_${crypto.randomUUID()}`;

    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
      ).run(convId, target.id, 'member', ts);
      db.prepare(
        'INSERT INTO group_members (conversation_id, user_id, role, added_by, joined_at) VALUES (?, ?, ?, ?, ?)'
      ).run(convId, target.id, 'member', userId, ts);
      db.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, type, content, status, created_at, updated_at)
         VALUES (?, ?, ?, 'system', ?, 'read', ?, ?)`
      ).run(sysMsgId, convId, userId, `@${actor.username} added @${target.username}`, ts, ts);
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, convId);
    });
    tx();

    const sysMsg = fetchHydratedMessageById(sysMsgId, userId);
    broadcastToConversation(convId, { type: 'conversation:updated', payload: { conversationId: convId } });
    if (sysMsg) {
      broadcastToConversation(convId, { type: 'message:new', payload: sysMsg });
    }
    res.status(201).json({ ok: true });
  });

  router.patch('/conversations/:id/members/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const targetUserId = String(req.params.targetUserId);
    const { role } = req.body || {};

    if (role !== 'admin' && role !== 'member') {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }
    const actorMembership = db
      .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId) as { role: string } | undefined;
    if (!actorMembership || actorMembership.role !== 'admin') {
      res.status(403).json({ error: 'Only group administrators can change roles.' });
      return;
    }

    db.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(
      role,
      convId,
      targetUserId
    );
    db.prepare('UPDATE group_members SET role = ? WHERE conversation_id = ? AND user_id = ?').run(
      role,
      convId,
      targetUserId
    );

    broadcastToConversation(convId, { type: 'conversation:updated', payload: { conversationId: convId } });
    res.json({ ok: true });
  });

  router.delete('/conversations/:id/members/:targetUserId', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const targetUserId = String(req.params.targetUserId);

    const actorMembership = db
      .prepare('SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId) as { role: string } | undefined;
    if (!actorMembership) {
      res.status(403).json({ error: 'Not a member of this group.' });
      return;
    }
    if (targetUserId !== userId && actorMembership.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can remove other members.' });
      return;
    }

    const actor = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string };
    const target = db.prepare('SELECT username FROM users WHERE id = ?').get(targetUserId) as
      | { username: string }
      | undefined;

    const ts = nowIso();
    const sysMsgId = `msg_${crypto.randomUUID()}`;
    const notice =
      targetUserId === userId
        ? `@${actor.username} left the group`
        : `@${actor.username} removed @${target?.username || 'member'}`;

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
        convId,
        targetUserId
      );
      db.prepare('DELETE FROM group_members WHERE conversation_id = ? AND user_id = ?').run(convId, targetUserId);
      // Ensure at least one admin remains if members left
      const adminCnt = db
        .prepare("SELECT COUNT(*) AS cnt FROM conversation_members WHERE conversation_id = ? AND role = 'admin'")
        .get(convId) as { cnt: number };
      if (adminCnt.cnt === 0) {
        const nextMember = db
          .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? ORDER BY joined_at ASC LIMIT 1')
          .get(convId) as { user_id: string } | undefined;
        if (nextMember) {
          db.prepare("UPDATE conversation_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?").run(
            convId,
            nextMember.user_id
          );
          db.prepare("UPDATE group_members SET role = 'admin' WHERE conversation_id = ? AND user_id = ?").run(
            convId,
            nextMember.user_id
          );
        }
      }
      const remaining = db
        .prepare('SELECT COUNT(*) AS cnt FROM conversation_members WHERE conversation_id = ?')
        .get(convId) as { cnt: number };
      if (remaining.cnt > 0) {
        db.prepare(
          `INSERT INTO messages (id, conversation_id, sender_id, type, content, status, created_at, updated_at)
           VALUES (?, ?, ?, 'system', ?, 'read', ?, ?)`
        ).run(sysMsgId, convId, userId, notice, ts, ts);
        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, convId);
      }
    });
    tx();

    sendToUser(targetUserId, { type: 'conversation:updated', payload: { conversationId: convId } });
    broadcastToConversation(convId, { type: 'conversation:updated', payload: { conversationId: convId } });
    const sysMsg = fetchHydratedMessageById(sysMsgId, userId);
    if (sysMsg) {
      broadcastToConversation(convId, { type: 'message:new', payload: sysMsg });
    }
    res.json({ ok: true });
  });

  // ---------------- MESSAGES & REACTIONS & STARRED ----------------
  router.get('/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const isMember = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId);
    if (!isMember) {
      res.status(403).json({ error: 'Not a member of this conversation.' });
      return;
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
    const before = typeof req.query.before === 'string' && req.query.before ? req.query.before : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    let sql = `
      SELECT m.*, u.username AS sender_username, p.display_name AS sender_display_name, p.avatar_url AS sender_avatar_url
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      JOIN profiles p ON p.user_id = u.id
      WHERE m.conversation_id = ?
    `;
    const params: unknown[] = [convId];

    if (before) {
      sql += ' AND m.created_at < ?';
      params.push(before);
    }
    if (q) {
      sql += ' AND m.is_deleted = 0 AND (LOWER(m.content) LIKE ? OR LOWER(COALESCE(m.media_name, \'\')) LIKE ?)';
      const pat = `%${q.toLowerCase()}%`;
      params.push(pat, pat);
    }

    sql += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(limit + 1);

    const rows = db.prepare(sql).all(...params) as RawMessageRow[];
    const hasMore = rows.length > limit;
    const sliced = rows.slice(0, limit).reverse();

    res.json({
      messages: hydrateMessages(sliced, userId),
      hasMore,
    });
  });

  router.get('/conversations/:id/media', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const isMember = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId);
    if (!isMember) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const rows = db
      .prepare(
        `SELECT m.*, u.username AS sender_username, p.display_name AS sender_display_name, p.avatar_url AS sender_avatar_url
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         JOIN profiles p ON p.user_id = u.id
         WHERE m.conversation_id = ? AND m.is_deleted = 0 AND m.type IN ('image', 'video', 'document', 'audio')
         ORDER BY m.created_at DESC
         LIMIT 100`
      )
      .all(convId) as RawMessageRow[];

    res.json({ items: hydrateMessages(rows, userId) });
  });

  router.post(
    '/conversations/:id/messages',
    requireAuth,
    rateLimitMiddleware('sendmsg', 60, 30_000),
    (req: AuthedRequest, res) => {
      const userId = req.userId!;
      const convId = String(req.params.id);
      const isMember = db
        .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
        .get(convId, userId);
      if (!isMember) {
        res.status(403).json({ error: 'You are not a member of this conversation.' });
        return;
      }

      const conv = db.prepare('SELECT type FROM conversations WHERE id = ?').get(convId) as
        | { type: 'direct' | 'group' }
        | undefined;
      if (!conv) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      const members = getConversationMemberIds(convId);
      if (conv.type === 'direct') {
        const peerId = members.find((m) => m !== userId);
        if (peerId) {
          const { aBlockedB, bBlockedA } = isBlockedBetween(userId, peerId);
          if (aBlockedB) {
            res.status(403).json({ error: 'You blocked this user. Unblock to send messages.' });
            return;
          }
          if (bBlockedA) {
            res.status(403).json({ error: 'Message could not be delivered.' });
            return;
          }
        }
      }

      const {
        type = 'text',
        content = '',
        mediaUrl = null,
        mediaName = null,
        mediaMime = null,
        mediaSize = null,
        mediaDuration = null,
        replyToId = null,
        forwardedFromId = null,
      } = req.body || {};

      const validTypes = new Set(['text', 'image', 'video', 'document', 'audio']);
      if (!validTypes.has(type)) {
        res.status(400).json({ error: 'Invalid message type.' });
        return;
      }

      const cleanContent = typeof content === 'string' ? content.trim().slice(0, 8000) : '';
      const cleanMediaUrl =
        typeof mediaUrl === 'string' && mediaUrl.startsWith('/uploads/') ? mediaUrl : null;
      if (type === 'text' && !cleanContent) {
        res.status(400).json({ error: 'Message cannot be empty.' });
        return;
      }
      if (type !== 'text' && !cleanMediaUrl) {
        res.status(400).json({ error: 'Media URL is required.' });
        return;
      }

      let validReplyId: string | null = null;
      if (typeof replyToId === 'string' && replyToId) {
        const replyRow = db
          .prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?')
          .get(replyToId, convId);
        if (replyRow) validReplyId = replyToId;
      }

      const msgId = `msg_${crypto.randomUUID()}`;
      const ts = nowIso();
      const otherMembers = members.filter((m) => m !== userId);
      const anyRecipientOnline = otherMembers.some((m) => isUserConnected(m));
      const initialStatus = anyRecipientOnline ? 'delivered' : 'sent';

      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO messages (
             id, conversation_id, sender_id, type, content,
             media_url, media_name, media_mime, media_size, media_duration,
             reply_to_id, forwarded_from_id, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          msgId,
          convId,
          userId,
          type,
          cleanContent,
          cleanMediaUrl,
          typeof mediaName === 'string' ? mediaName.slice(0, 120) : null,
          typeof mediaMime === 'string' ? mediaMime.slice(0, 120) : null,
          typeof mediaSize === 'number' ? mediaSize : null,
          typeof mediaDuration === 'number' ? Math.round(mediaDuration) : null,
          validReplyId,
          typeof forwardedFromId === 'string' ? forwardedFromId : null,
          initialStatus,
          ts,
          ts
        );

        for (const recipientId of otherMembers) {
          db.prepare(
            'INSERT INTO message_receipts (message_id, user_id, delivered_at) VALUES (?, ?, ?)'
          ).run(msgId, recipientId, isUserConnected(recipientId) ? ts : null);
        }

        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, convId);
        db.prepare('UPDATE conversation_members SET last_read_at = ?, archived = 0 WHERE conversation_id = ? AND user_id = ?').run(
          ts,
          convId,
          userId
        );
        // Unarchive for recipients on new incoming message
        db.prepare('UPDATE conversation_members SET archived = 0 WHERE conversation_id = ? AND user_id != ?').run(
          convId,
          userId
        );
      });
      tx();

      const message = fetchHydratedMessageById(msgId, userId)!;
      // Clear sender's typing status & broadcast new message
      broadcastToConversation(
        convId,
        {
          type: 'typing:update',
          payload: {
            conversationId: convId,
            userId,
            username: message.senderUsername,
            displayName: message.senderDisplayName,
            isTyping: false,
          },
        },
        userId
      );
      broadcastToConversation(convId, { type: 'message:new', payload: message });

      res.status(201).json({ message });
    }
  );

  router.post('/conversations/:id/read', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const isMember = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId);
    if (!isMember) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const ts = nowIso();
    const readerProfile = db
      .prepare('SELECT privacy_read_receipts FROM profiles WHERE user_id = ?')
      .get(userId) as { privacy_read_receipts: number } | undefined;
    const allowReceipts = readerProfile ? Boolean(readerProfile.privacy_read_receipts) : true;

    const unreadMsgs = db
      .prepare(
        `SELECT id, sender_id FROM messages
         WHERE conversation_id = ? AND sender_id != ? AND status != 'read'`
      )
      .all(convId, userId) as { id: string; sender_id: string }[];

    const tx = db.transaction(() => {
      db.prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(
        ts,
        convId,
        userId
      );
      if (allowReceipts && unreadMsgs.length > 0) {
        const updMsg = db.prepare("UPDATE messages SET status = 'read' WHERE id = ?");
        const updRec = db.prepare(
          `INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(message_id, user_id) DO UPDATE SET read_at = excluded.read_at, delivered_at = COALESCE(delivered_at, excluded.delivered_at)`
        );
        for (const m of unreadMsgs) {
          updMsg.run(m.id);
          updRec.run(m.id, userId, ts, ts);
        }
      }
    });
    tx();

    if (allowReceipts) {
      for (const m of unreadMsgs) {
        sendToUser(m.sender_id, {
          type: 'message:status',
          payload: {
            conversationId: convId,
            messageId: m.id,
            status: 'read',
          },
        });
      }
    }

    res.json({ ok: true });
  });

  router.patch('/messages/:id', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const msgId = String(req.params.id);
    const { content } = req.body || {};

    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Edited message cannot be empty.' });
      return;
    }

    const msg = db
      .prepare('SELECT id, conversation_id, sender_id, type, is_deleted FROM messages WHERE id = ?')
      .get(msgId) as
      | { id: string; conversation_id: string; sender_id: string; type: string; is_deleted: number }
      | undefined;

    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (msg.sender_id !== userId) {
      res.status(403).json({ error: 'You can only edit your own messages.' });
      return;
    }
    if (msg.is_deleted || msg.type !== 'text') {
      res.status(400).json({ error: 'Only non-deleted text messages can be edited.' });
      return;
    }

    db.prepare('UPDATE messages SET content = ?, is_edited = 1, updated_at = ? WHERE id = ?').run(
      content.trim().slice(0, 8000),
      nowIso(),
      msgId
    );

    const updated = fetchHydratedMessageById(msgId, userId)!;
    broadcastToConversation(msg.conversation_id, { type: 'message:updated', payload: updated });
    res.json({ message: updated });
  });

  router.delete('/messages/:id', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const msgId = String(req.params.id);
    const msg = db
      .prepare('SELECT id, conversation_id, sender_id, media_url FROM messages WHERE id = ?')
      .get(msgId) as
      | { id: string; conversation_id: string; sender_id: string; media_url: string | null }
      | undefined;

    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (msg.sender_id !== userId) {
      res.status(403).json({ error: 'You can only delete your own messages.' });
      return;
    }

    db.prepare(
      `UPDATE messages
       SET is_deleted = 1, content = '', media_url = NULL, media_name = NULL, media_mime = NULL, media_size = NULL, updated_at = ?
       WHERE id = ?`
    ).run(nowIso(), msgId);

    const updated = fetchHydratedMessageById(msgId, userId)!;
    broadcastToConversation(msg.conversation_id, { type: 'message:updated', payload: updated });
    res.json({ message: updated });
  });

  router.post('/messages/:id/react', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const msgId = String(req.params.id);
    const { emoji } = req.body || {};

    if (typeof emoji !== 'string' || !emoji.trim() || emoji.trim().length > 16) {
      res.status(400).json({ error: 'Valid emoji reaction is required.' });
      return;
    }
    const cleanEmoji = emoji.trim();

    const msg = db
      .prepare('SELECT id, conversation_id, is_deleted FROM messages WHERE id = ?')
      .get(msgId) as { id: string; conversation_id: string; is_deleted: number } | undefined;
    if (!msg || msg.is_deleted) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    const isMember = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(msg.conversation_id, userId);
    if (!isMember) {
      res.status(403).json({ error: 'Not authorized to react in this conversation.' });
      return;
    }

    const existing = db
      .prepare('SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?')
      .get(msgId, userId) as { emoji: string } | undefined;

    if (existing && existing.emoji === cleanEmoji) {
      // Toggle off if clicking the same emoji
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(msgId, userId);
    } else {
      db.prepare(
        `INSERT INTO message_reactions (message_id, user_id, emoji, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`
      ).run(msgId, userId, cleanEmoji, nowIso());
    }

    const updated = fetchHydratedMessageById(msgId, userId)!;
    broadcastToConversation(msg.conversation_id, {
      type: 'message:reaction',
      payload: {
        conversationId: msg.conversation_id,
        messageId: msgId,
        reactions: updated.reactions,
      },
    });
    res.json({ message: updated });
  });

  router.post('/messages/:id/star', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const msgId = String(req.params.id);

    const msg = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(msgId) as
      | { conversation_id: string }
      | undefined;
    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    const isMember = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(msg.conversation_id, userId);
    if (!isMember) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const existing = db
      .prepare('SELECT 1 FROM starred_messages WHERE user_id = ? AND message_id = ?')
      .get(userId, msgId);

    if (existing) {
      db.prepare('DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?').run(userId, msgId);
      res.json({ isStarred: false });
    } else {
      db.prepare('INSERT INTO starred_messages (user_id, message_id, created_at) VALUES (?, ?, ?)').run(
        userId,
        msgId,
        nowIso()
      );
      res.json({ isStarred: true });
    }
  });

  router.get('/starred', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const rows = db
      .prepare(
        `SELECT m.*, u.username AS sender_username, p.display_name AS sender_display_name, p.avatar_url AS sender_avatar_url
         FROM starred_messages sm
         JOIN messages m ON m.id = sm.message_id
         JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
         JOIN users u ON u.id = m.sender_id
         JOIN profiles p ON p.user_id = u.id
         WHERE sm.user_id = ? AND m.is_deleted = 0
         ORDER BY sm.created_at DESC
         LIMIT 100`
      )
      .all(userId, userId) as RawMessageRow[];

    res.json({ messages: hydrateMessages(rows, userId) });
  });

  router.get('/conversations/:id/export', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const convId = String(req.params.id);
    const isMember = db
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .get(convId, userId);
    if (!isMember) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const rows = db
      .prepare(
        `SELECT m.*, u.username AS sender_username, p.display_name AS sender_display_name, p.avatar_url AS sender_avatar_url
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         JOIN profiles p ON p.user_id = u.id
         WHERE m.conversation_id = ?
         ORDER BY m.created_at ASC`
      )
      .all(convId) as RawMessageRow[];

    const summary = buildConversationSummaries(userId).find((c) => c.id === convId);
    res.json({
      exportedAt: nowIso(),
      conversation: summary,
      messages: hydrateMessages(rows, userId),
    });
  });

  // ---------------- 24-HOUR STATUS UPDATES ----------------
  router.get('/statuses', requireAuth, (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const now = nowIso();

    // Clean up expired statuses automatically
    db.prepare('DELETE FROM status_updates WHERE expires_at <= ?').run(now);

    const rows = db
      .prepare(
        `SELECT s.*, u.username, p.display_name, p.avatar_url
         FROM status_updates s
         JOIN users u ON u.id = s.user_id
         JOIN profiles p ON p.user_id = u.id
         WHERE s.expires_at > ?
         ORDER BY s.created_at ASC`
      )
      .all(now) as {
      id: string;
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      type: 'text' | 'image' | 'video';
      content: string;
      media_url: string | null;
      bg_color: string;
      visibility: 'everyone' | 'contacts';
      created_at: string;
      expires_at: string;
    }[];

    const groupsMap = new Map<
      string,
      {
        userId: string;
        username: string;
        displayName: string;
        avatarUrl: string | null;
        isMine: boolean;
        hasUnviewed: boolean;
        items: unknown[];
      }
    >();

    for (const s of rows) {
      const isMine = s.user_id === userId;
      if (!isMine) {
        const { aBlockedB, bBlockedA } = isBlockedBetween(userId, s.user_id);
        if (aBlockedB || bBlockedA) continue;
        if (s.visibility === 'contacts' && !isContactOf(s.user_id, userId)) {
          continue;
        }
        // Show statuses from contacts or people with whom user has a conversation or public everyone statuses
        const hasConv = db
          .prepare(
            `SELECT 1 FROM conversation_members cm1
             JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
             WHERE cm1.user_id = ? AND cm2.user_id = ? LIMIT 1`
          )
          .get(userId, s.user_id);
        const isSavedContact = isContactOf(userId, s.user_id);
        if (!hasConv && !isSavedContact && s.visibility !== 'everyone') {
          continue;
        }
      }

      const viewedRow = db
        .prepare('SELECT 1 FROM status_views WHERE status_id = ? AND viewer_id = ?')
        .get(s.id, userId);
      const countRow = db
        .prepare('SELECT COUNT(*) AS cnt FROM status_views WHERE status_id = ?')
        .get(s.id) as { cnt: number };

      let viewers = undefined;
      if (isMine) {
        const viewerRows = db
          .prepare(
            `SELECT sv.viewer_id, sv.viewed_at, u.username, p.display_name, p.avatar_url
             FROM status_views sv
             JOIN users u ON u.id = sv.viewer_id
             JOIN profiles p ON p.user_id = u.id
             WHERE sv.status_id = ?
             ORDER BY sv.viewed_at DESC`
          )
          .all(s.id) as {
          viewer_id: string;
          viewed_at: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
        }[];
        viewers = viewerRows.map((vr) => ({
          viewerId: vr.viewer_id,
          username: vr.username,
          displayName: vr.display_name,
          avatarUrl: vr.avatar_url,
          viewedAt: vr.viewed_at,
        }));
      }

      const peerSanitized = isMine ? null : sanitizePeerProfile(userId, s.user_id);
      const displayAvatar = isMine ? s.avatar_url : peerSanitized?.avatarUrl || null;

      let group = groupsMap.get(s.user_id);
      if (!group) {
        group = {
          userId: s.user_id,
          username: s.username,
          displayName: s.display_name,
          avatarUrl: displayAvatar,
          isMine,
          hasUnviewed: false,
          items: [],
        };
        groupsMap.set(s.user_id, group);
      }
      const viewedByMe = isMine || Boolean(viewedRow);
      if (!viewedByMe) group.hasUnviewed = true;

      group.items.push({
        id: s.id,
        userId: s.user_id,
        username: s.username,
        displayName: s.display_name,
        avatarUrl: displayAvatar,
        type: s.type,
        content: s.content,
        mediaUrl: s.media_url,
        bgColor: s.bg_color,
        visibility: s.visibility,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        viewedByMe,
        viewCount: countRow.cnt,
        viewers,
      });
    }

    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    res.json({ statusGroups: groups });
  });

  router.post('/statuses', requireAuth, rateLimitMiddleware('status', 20, 60_000), (req: AuthedRequest, res) => {
    const userId = req.userId!;
    const { type = 'text', content = '', mediaUrl = null, bgColor = '#00A884', visibility = 'everyone' } = req.body || {};

    if (type !== 'text' && type !== 'image' && type !== 'video') {
      res.status(400).json({ error: 'Invalid status type.' });
      return;
    }
    const cleanContent = typeof content === 'string' ? content.trim().slice(0, 700) : '';
    const cleanMedia = typeof mediaUrl === 'string' && mediaUrl.startsWith('/uploads/') ? mediaUrl : null;
    if (type === 'text' && !cleanContent) {
      res.status(400).json({ error: 'Text status cannot be empty.' });
      return;
    }
    if ((type === 'image' || type === 'video') && !cleanMedia) {
      res.status(400).json({ error: 'Media file is required for image/video status.' });
      return;
    }

    const vis = visibility === 'contacts' ? 'contacts' : 'everyone';
    const color = typeof bgColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(bgColor) ? bgColor : '#00A884';
    const id = `sts_${crypto.randomUUID()}`;
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO status_updates (id, user_id, type, content, media_url, bg_color, visibility, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, type, cleanContent, cleanMedia, color, vis, createdAt, expiresAt);

    // Notify contacts & peers
    const peerRows = db
      .prepare(
        `SELECT DISTINCT cm2.user_id AS peer_id
         FROM conversation_members cm1
         JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
         WHERE cm1.user_id = ? AND cm2.user_id != ?
         UNION
         SELECT owner_id AS peer_id FROM contacts WHERE contact_user_id = ?`
      )
      .all(userId, userId, userId) as { peer_id: string }[];
    broadcastToUsers(
      peerRows.map((p) => p.peer_id),
      { type: 'status:new', payload: { userId, statusId: id } }
    );

    res.status(201).json({ id, expiresAt });
  });

  router.post('/statuses/:id/view', requireAuth, (req: AuthedRequest, res) => {
    const viewerId = req.userId!;
    const statusId = String(req.params.id);
    const st = db
      .prepare('SELECT id, user_id, expires_at FROM status_updates WHERE id = ?')
      .get(statusId) as { id: string; user_id: string; expires_at: string } | undefined;

    if (!st || st.expires_at <= nowIso()) {
      res.status(404).json({ error: 'Status expired or not found.' });
      return;
    }

    if (st.user_id !== viewerId) {
      db.prepare(
        'INSERT OR IGNORE INTO status_views (status_id, viewer_id, viewed_at) VALUES (?, ?, ?)'
      ).run(statusId, viewerId, nowIso());
      sendToUser(st.user_id, { type: 'status:viewed', payload: { statusId, viewerId } });
    }
    res.json({ ok: true });
  });

  router.delete('/statuses/:id', requireAuth, (req: AuthedRequest, res) => {
    const statusId = String(req.params.id);
    const st = db.prepare('SELECT user_id, media_url FROM status_updates WHERE id = ?').get(statusId) as
      | { user_id: string; media_url: string | null }
      | undefined;
    if (!st) {
      res.status(404).json({ error: 'Status not found.' });
      return;
    }
    if (st.user_id !== req.userId!) {
      res.status(403).json({ error: 'Only the owner can delete this status.' });
      return;
    }
    db.prepare('DELETE FROM status_updates WHERE id = ?').run(statusId);
    if (st.media_url && st.media_url.startsWith('/uploads/')) {
      const target = path.resolve(uploadsDir, path.basename(st.media_url));
      if (target.startsWith(uploadsDir + path.sep) && fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    }
    res.json({ ok: true });
  });

  return router;
}
