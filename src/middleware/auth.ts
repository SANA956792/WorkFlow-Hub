import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const SESSION_COOKIE = 'workflow_session';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const FILE_URL_DURATION_SECONDS = 5 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const API_WINDOW_MS = 60 * 1000;
const API_MAX_REQUESTS = 120;
const attempts = new Map<string, { count: number; resetAt: number }>();
const requests = new Map<string, { count: number; resetAt: number }>();

function getSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function sign(value: string): string {
  const secret = getSecret();
  if (!secret) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function recordAttempt(map: Map<string, { count: number; resetAt: number }>, key: string, windowMs: number): number {
  const now = Date.now();
  const current = map.get(key);
  if (!current || current.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  current.count += 1;
  return current.count;
}

function clearExpiredEntries(): void {
  const now = Date.now();
  for (const map of [attempts, requests]) {
    for (const [key, value] of map) if (value.resetAt <= now) map.delete(key);
  }
}
setInterval(clearExpiredEntries, 5 * 60 * 1000).unref();

export function createSessionToken(now = Math.floor(Date.now() / 1000)): string {
  const expires = now + SESSION_DURATION_SECONDS;
  const payload = `${now}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const [issuedAtRaw, expiresRaw, signature, ...rest] = token.split('.');
  if (rest.length || !issuedAtRaw || !expiresRaw || !signature) return false;
  const issuedAt = Number(issuedAtRaw);
  const expires = Number(expiresRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expires) || expires <= now || expires - issuedAt !== SESSION_DURATION_SECONDS || issuedAt > now + 60) return false;
  try { return safeEqual(sign(`${issuedAt}.${expires}`), signature); } catch { return false; }
}

export function signFileAccessToken(fileId: string): string {
  const expires = Math.floor(Date.now() / 1000) + FILE_URL_DURATION_SECONDS;
  const payload = `${fileId}.${expires}`;
  return `${expires}.${sign(payload)}`;
}

export function verifyFileAccessToken(fileId: string, token: string | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const [expiresRaw, signature, ...rest] = token.split('.');
  if (rest.length || !expiresRaw || !signature) return false;
  const expires = Number(expiresRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + FILE_URL_DURATION_SECONDS) return false;
  try { return safeEqual(sign(`${fileId}.${expires}`), signature); } catch { return false; }
}

export function buildSignedFileUrl(fileId: string | null | undefined): string | null {
  if (!fileId) return null;
  return `/api/files/${fileId}?access=${signFileAccessToken(fileId)}`;
}

export interface AuthRequest extends Request {
  user?: { uid: string };
  actorName?: string;
}

/** Validate the shared company code and issue an HttpOnly signed session cookie. */
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const session = readCookie(req, SESSION_COOKIE);
  if (verifySessionToken(session)) {
    req.user = { uid: 'company-access' };
    req.actorName = 'Team Member';
    const ip = req.socket.remoteAddress || 'unknown';
    if (recordAttempt(requests, ip, API_WINDOW_MS) > API_MAX_REQUESTS) {
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }
    return next();
  }

  const suppliedCode = req.get('x-company-access-code');
  if (suppliedCode !== undefined) {
    const ip = req.socket.remoteAddress || 'unknown';
    if (recordAttempt(attempts, ip, LOGIN_WINDOW_MS) > LOGIN_MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many access code attempts. Try again later.' });
    }
    const configuredCode = process.env.COMPANY_ACCESS_CODE;
    if (!configuredCode || configuredCode.length < 12 || !getSecret()) {
      return res.status(503).json({ error: 'Company access is not configured on the server.' });
    }
    const suppliedHash = crypto.createHash('sha256').update(suppliedCode).digest('hex');
    const configuredHash = crypto.createHash('sha256').update(configuredCode).digest('hex');
    if (!safeEqual(suppliedHash, configuredHash)) {
      return res.status(401).json({ error: 'The company access code is incorrect.' });
    }
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}${secure}`);
    req.user = { uid: 'company-access' };
    req.actorName = 'Team Member';
    return next();
  }

  return res.status(401).json({ error: 'Enter the company access code to continue.' });
};

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}
