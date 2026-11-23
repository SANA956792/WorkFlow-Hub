import crypto from 'crypto';
import net from 'net';
import { Request, Response, NextFunction } from 'express';

const FILE_TOKEN_SECRET = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
  ? process.env.SESSION_SECRET
  : crypto.randomBytes(32).toString('hex');

export function signFileAccessToken(fileId: string): string {
  const hmac = crypto.createHmac('sha256', FILE_TOKEN_SECRET);
  hmac.update(fileId);
  return hmac.digest('hex');
}

export function verifyFileAccessToken(fileId: string, token: string | undefined): boolean {
  if (!token || typeof token !== 'string') return false;
  const expected = signFileAccessToken(fileId);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(token, 'utf8');
  return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function buildSignedFileUrl(fileId: string | null | undefined): string | null {
  if (!fileId) return null;
  return `/api/files/${fileId}?access=${signFileAccessToken(fileId)}`;
}

export interface AuthRequest extends Request {
  user?: { uid: string };
  actorName?: string;
}

/**
 * Restrict all workspace-data routes to explicitly trusted network addresses.
 * Set WORKFLOW_ALLOWED_IPS to a comma-separated list of exact client IPs.
 * The default is deny-all so an unconfigured public deployment cannot expose
 * the database through the API. Do not trust forwarded IP headers here.
 */
export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const allowed = (process.env.WORKFLOW_ALLOWED_IPS || '').split(',').map((ip) => ip.trim()).filter(Boolean);
  if (allowed.length === 0) {
    return res.status(503).json({ error: 'Workspace access is not configured.' });
  }
  const remoteAddress = req.socket.remoteAddress || '';
  const normalizedAddress = remoteAddress.startsWith('::ffff:') ? remoteAddress.slice(7) : remoteAddress;
  if (!allowed.some((ip) => ip === normalizedAddress || (net.isIP(ip) === 6 && ip === remoteAddress))) {
    return res.status(403).json({ error: 'Workspace access is restricted to approved networks.' });
  }
  req.user = { uid: 'workspace' };
  req.actorName = 'Team Member';
  next();
};
