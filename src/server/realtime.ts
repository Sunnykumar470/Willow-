import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { getUserFromSessionToken, parseCookieHeader, SESSION_COOKIE_NAME } from './auth.ts';
import { db, isBlockedBetween, isContactOf, nowIso } from './db.ts';

export interface RealtimeEvent {
  type: string;
  payload: unknown;
}

const userSockets = new Map<string, Set<WebSocket>>();
const typingTimers = new Map<string, NodeJS.Timeout>();

export function isUserConnected(userId: string): boolean {
  const sockets = userSockets.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

export function sendToUser(userId: string, event: RealtimeEvent): void {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;
  const raw = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }
}

export function broadcastToUsers(userIds: string[], event: RealtimeEvent, excludeUserId?: string): void {
  const seen = new Set<string>();
  for (const uid of userIds) {
    if (uid === excludeUserId || seen.has(uid)) continue;
    seen.add(uid);
    sendToUser(uid, event);
  }
}

export function getConversationMemberIds(conversationId: string): string[] {
  const rows = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(conversationId) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export function broadcastToConversation(
  conversationId: string,
  event: RealtimeEvent,
  excludeUserId?: string
): void {
  const memberIds = getConversationMemberIds(conversationId);
  broadcastToUsers(memberIds, event, excludeUserId);
}

function broadcastPresence(userId: string, isOnline: boolean, lastSeenAt: string): void {
  const userRow = db
    .prepare(
      `SELECT u.id, p.privacy_online, p.privacy_last_seen
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`
    )
    .get(userId) as
    | { id: string; privacy_online: string; privacy_last_seen: string }
    | undefined;
  if (!userRow) return;

  // Find all peers who share a conversation or have this user as a contact
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

  for (const { peer_id } of peerRows) {
    const { aBlockedB, bBlockedA } = isBlockedBetween(userId, peer_id);
    if (aBlockedB || bBlockedA) continue;
    const isContact = isContactOf(userId, peer_id);

    const visibleOnline = userRow.privacy_online === 'everyone' ? isOnline : false;
    const visibleLastSeen =
      userRow.privacy_last_seen === 'everyone' ||
      (userRow.privacy_last_seen === 'contacts' && isContact)
        ? lastSeenAt
        : null;

    sendToUser(peer_id, {
      type: 'presence:update',
      payload: {
        userId,
        isOnline: visibleOnline,
        lastSeenAt: visibleLastSeen,
      },
    });
  }
}

function clearTyping(conversationId: string, userId: string, username: string, displayName: string): void {
  const key = `${conversationId}:${userId}`;
  const existing = typingTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    typingTimers.delete(key);
  }
  broadcastToConversation(
    conversationId,
    {
      type: 'typing:update',
      payload: {
        conversationId,
        userId,
        username,
        displayName,
        isTyping: false,
      },
    },
    userId
  );
}

export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const rawUrl = req.url || '';
    if (!rawUrl.startsWith('/ws')) {
      return;
    }

    let queryToken: string | null = null;
    try {
      const parsedUrl = new URL(rawUrl, 'http://localhost');
      queryToken = parsedUrl.searchParams.get('token');
    } catch {
      queryToken = null;
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    const token = queryToken || cookies[SESSION_COOKIE_NAME];
    const userId = getUserFromSessionToken(token);
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, userId);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, userId: string) => {
    const userRow = db
      .prepare(
        'SELECT u.username, p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?'
      )
      .get(userId) as { username: string; display_name: string } | undefined;

    if (!userRow) {
      ws.close();
      return;
    }

    let sockets = userSockets.get(userId);
    const wasOffline = !sockets || sockets.size === 0;
    if (!sockets) {
      sockets = new Set();
      userSockets.set(userId, sockets);
    }
    sockets.add(ws);

    const ts = nowIso();
    db.prepare('UPDATE users SET is_online = 1, last_seen_at = ? WHERE id = ?').run(ts, userId);

    // Mark any previously 'sent' messages to this user as 'delivered' on reconnect
    const undelivered = db
      .prepare(
        `SELECT m.id, m.conversation_id, m.sender_id
         FROM messages m
         JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
         WHERE cm.user_id = ? AND m.sender_id != ? AND m.status = 'sent'`
      )
      .all(userId, userId) as { id: string; conversation_id: string; sender_id: string }[];

    if (undelivered.length > 0) {
      const updateMsg = db.prepare("UPDATE messages SET status = 'delivered' WHERE id = ? AND status = 'sent'");
      const upsertReceipt = db.prepare(
        `INSERT INTO message_receipts (message_id, user_id, delivered_at)
         VALUES (?, ?, ?)
         ON CONFLICT(message_id, user_id) DO UPDATE SET delivered_at = COALESCE(delivered_at, excluded.delivered_at)`
      );
      const tx = db.transaction(() => {
        for (const msg of undelivered) {
          updateMsg.run(msg.id);
          upsertReceipt.run(msg.id, userId, ts);
        }
      });
      tx();

      for (const msg of undelivered) {
        sendToUser(msg.sender_id, {
          type: 'message:status',
          payload: {
            conversationId: msg.conversation_id,
            messageId: msg.id,
            status: 'delivered',
          },
        });
      }
    }

    if (wasOffline) {
      broadcastPresence(userId, true, ts);
    }

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as { type?: string; conversationId?: string };
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if ((data.type === 'typing:start' || data.type === 'typing:stop') && typeof data.conversationId === 'string') {
          const convId = data.conversationId;
          const isMember = db
            .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
            .get(convId, userId);
          if (!isMember) return;

          const conv = db.prepare('SELECT type FROM conversations WHERE id = ?').get(convId) as
            | { type: string }
            | undefined;
          if (!conv) return;

          if (conv.type === 'direct') {
            const peer = db
              .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?')
              .get(convId, userId) as { user_id: string } | undefined;
            if (peer) {
              const { aBlockedB, bBlockedA } = isBlockedBetween(userId, peer.user_id);
              if (aBlockedB || bBlockedA) return;
            }
          }

          const key = `${convId}:${userId}`;
          const existingTimer = typingTimers.get(key);
          if (existingTimer) {
            clearTimeout(existingTimer);
            typingTimers.delete(key);
          }

          if (data.type === 'typing:start') {
            broadcastToConversation(
              convId,
              {
                type: 'typing:update',
                payload: {
                  conversationId: convId,
                  userId,
                  username: userRow.username,
                  displayName: userRow.display_name,
                  isTyping: true,
                },
              },
              userId
            );
            const timer = setTimeout(() => {
              clearTyping(convId, userId, userRow.username, userRow.display_name);
            }, 4000);
            typingTimers.set(key, timer);
          } else {
            clearTyping(convId, userId, userRow.username, userRow.display_name);
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      const current = userSockets.get(userId);
      if (current) {
        current.delete(ws);
        if (current.size === 0) {
          userSockets.delete(userId);
          const leaveTs = nowIso();
          db.prepare('UPDATE users SET is_online = 0, last_seen_at = ? WHERE id = ?').run(leaveTs, userId);
          // Clear any active typing indicators for this user
          for (const [key, timer] of typingTimers.entries()) {
            if (key.endsWith(`:${userId}`)) {
              clearTimeout(timer);
              typingTimers.delete(key);
              const convId = key.slice(0, key.indexOf(':'));
              broadcastToConversation(
                convId,
                {
                  type: 'typing:update',
                  payload: {
                    conversationId: convId,
                    userId,
                    username: userRow.username,
                    displayName: userRow.display_name,
                    isTyping: false,
                  },
                },
                userId
              );
            }
          }
          broadcastPresence(userId, false, leaveTs);
        }
      }
    });
  });

  return wss;
}
