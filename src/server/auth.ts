import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, nowIso } from './db.ts';

export const SESSION_COOKIE_NAME = 'willow_session';

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'willow',
  'support',
  'help',
  'api',
  'ws',
  'uploads',
  'status',
  'settings',
  'profile',
  'null',
  'undefined',
]);

export function normalizeUsername(raw: unknown): { valid: boolean; username: string; reason?: string } {
  if (typeof raw !== 'string') {
    return { valid: false, username: '', reason: 'Username is required.' };
  }
  const cleaned = raw.trim().replace(/^@+/, '').toLowerCase();
  if (cleaned.length < 3 || cleaned.length > 30) {
    return { valid: false, username: cleaned, reason: 'Username must be 3 to 30 characters.' };
  }
  if (!/^[a-z0-9_]{3,30}$/.test(cleaned)) {
    return {
      valid: false,
      username: cleaned,
      reason: 'Use only lowercase letters, numbers, and underscores.',
    };
  }
  if (RESERVED_USERNAMES.has(cleaned)) {
    return { valid: false, username: cleaned, reason: 'This username is reserved.' };
  }
  return { valid: true, username: cleaned };
}

export function validatePassword(raw: unknown): { valid: boolean; password: string; reason?: string } {
  if (typeof raw !== 'string') {
    return { valid: false, password: '', reason: 'Password is required.' };
  }
  if (raw.length < 6) {
    return { valid: false, password: raw, reason: 'Password must be at least 6 characters.' };
  }
  if (raw.length > 128) {
    return { valid: false, password: raw, reason: 'Password must be 128 characters or fewer.' };
  }
  if (raw.trim().length === 0) {
    return { valid: false, password: raw, reason: 'Password cannot be only spaces.' };
  }
  return { valid: true, password: raw };
}

export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(secret, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSessionForUser(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const created = nowIso();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(tokenHash, userId, created, expires);
  return token;
}

export function getUserFromSessionToken(token: string | undefined | null): string | null {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return row.user_id;
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

export function extractSessionToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken;
  }
  return null;
}

function isHttpsRequest(req: Request): boolean {
  const proto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim().toLowerCase();
  return req.secure || proto === 'https';
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'Max-Age=2592000',
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  const userId = getUserFromSessionToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId);
  if (!userExists) {
    clearSessionCookie(req, res);
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }
  req.userId = userId;
  next();
}

export function verifyCsrfOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  const customHeader = req.headers['x-requested-with'];
  if (customHeader === 'XMLHttpRequest' || customHeader === 'WillowClient') {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // fall through
    }
  }
  res.status(403).json({ error: 'Forbidden: cross-origin request rejected' });
}

const rateBuckets = new Map<string, number[]>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = rateBuckets.get(key) || [];
  const valid = timestamps.filter((t) => now - t < windowMs);
  if (valid.length >= maxRequests) {
    rateBuckets.set(key, valid);
    return false;
  }
  valid.push(now);
  rateBuckets.set(key, valid);
  return true;
}

export function rateLimitMiddleware(prefix: string, maxRequests: number, windowMs: number) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const identity = req.userId || req.ip || 'anon';
    if (!checkRateLimit(`${prefix}:${identity}`, maxRequests, windowMs)) {
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
      return;
    }
    next();
  };
}
