import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getValidAppSession } from '../db/queries.ts';

export const SESSION_COOKIE_NAME = 'wo_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

const FILE_TOKEN_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export function signFileAccessToken(fileId: string): string {
  const hmac = crypto.createHmac('sha256', FILE_TOKEN_SECRET);
  hmac.update(fileId);
  return hmac.digest('hex');
}

export function verifyFileAccessToken(
  fileId: string,
  token: string | undefined
): boolean {
  if (!token || typeof token !== 'string') return false;
  const expected = signFileAccessToken(fileId);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(token, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function buildSignedFileUrl(
  fileId: string | null | undefined
): string | null {
  if (!fileId) return null;
  const token = signFileAccessToken(fileId);
  return `/api/files/${fileId}?access=${token}`;
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function hashAccessCode(code: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(code, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyAccessCodeAgainstHash(
  providedCode: string,
  storedHash: string
): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const actualBuf = crypto.scryptSync(providedCode, salt, 64);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export function verifyConstantTimePlaintext(
  providedCode: string,
  expectedSecret: string
): boolean {
  const a = crypto.createHash('sha256').update(providedCode).digest();
  const b = crypto.createHash('sha256').update(expectedSecret).digest();
  return crypto.timingSafeEqual(a, b);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = pair.slice(0, eqIndex).trim();
    const val = pair.slice(eqIndex + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return req.secure || forwardedProto === 'https' || req.protocol === 'https';
}

export function setPersistentSessionCookie(
  req: Request,
  res: Response,
  rawToken: string
) {
  const expiresAt = new Date(
    Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  ).toUTCString();
  const base = `${SESSION_COOKIE_NAME}=${encodeURIComponent(
    rawToken
  )}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Expires=${expiresAt}; Path=/; HttpOnly`;

  const cookie = isHttpsRequest(req)
    ? `${base}; Secure; SameSite=None; Partitioned`
    : `${base}; SameSite=Lax`;

  res.append('Set-Cookie', cookie);
}

export function clearPersistentSessionCookie(req: Request, res: Response) {
  const base = `${SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly`;
  const cookie = isHttpsRequest(req)
    ? `${base}; Secure; SameSite=None; Partitioned`
    : `${base}; SameSite=Lax`;

  res.append('Set-Cookie', cookie);
}

export function verifySameOriginMutation(req: Request): boolean {
  const expectedHost = String(
    req.headers['x-forwarded-host'] || req.headers.host || ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  const originHeader = req.headers.origin;
  if (typeof originHeader === 'string' && originHeader.trim()) {
    try {
      const originHost = new URL(originHeader).host.toLowerCase();
      if (!expectedHost || originHost !== expectedHost) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  const xrw = String(req.headers['x-requested-with'] || '').trim();
  if (xrw === 'XMLHttpRequest') {
    return true;
  }

  const refererHeader = req.headers.referer;
  if (typeof refererHeader === 'string' && refererHeader.trim()) {
    try {
      const refHost = new URL(refererHeader).host.toLowerCase();
      return Boolean(expectedHost && refHost === expectedHost);
    } catch {
      return false;
    }
  }

  return false;
}

export interface AuthRequest extends Request {
  sessionId?: string;
  actorName?: string;
  actorUid?: string;
}

export async function getSessionFromRequest(req: Request) {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken || rawToken.length < 32) {
    return null;
  }
  const tokenHash = hashSessionToken(rawToken);
  return {
    rawToken,
    tokenHash,
    session: await getValidAppSession(tokenHash),
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const resolved = await getSessionFromRequest(req);
    if (!resolved || !resolved.session) {
      return res.status(401).json({
        error: 'Session expired or not signed in. Please enter your Company Access Code.',
      });
    }

    const method = req.method.toUpperCase();
    if (
      method === 'POST' ||
      method === 'PUT' ||
      method === 'PATCH' ||
      method === 'DELETE'
    ) {
      if (!verifySameOriginMutation(req)) {
        return res.status(403).json({
          error: 'Blocked cross-origin state change request.',
        });
      }
    }

    req.sessionId = resolved.session.id;
    req.actorName = resolved.session.label || 'Company Member';
    req.actorUid = `session:${resolved.session.id}`;
    next();
  } catch (error) {
    console.error('Session verification error:', error);
    return res.status(500).json({ error: 'Unable to verify session.' });
  }
};
