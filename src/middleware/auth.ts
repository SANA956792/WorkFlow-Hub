import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

const FILE_TOKEN_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
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
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function buildSignedFileUrl(fileId: string | null | undefined): string | null {
  if (!fileId) return null;
  const token = signFileAccessToken(fileId);
  return `/api/files/${fileId}?access=${token}`;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  actorName?: string;
}

async function syncUser(decoded: DecodedIdToken) {
  const email = decoded.email || `${decoded.uid}@user.local`;
  const displayName = decoded.name || email.split('@')[0];
  const photoUrl = decoded.picture || null;

  await db
    .insert(users)
    .values({
      uid: decoded.uid,
      email,
      displayName,
      photoUrl,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.uid,
      set: {
        email,
        displayName,
        photoUrl,
        updatedAt: new Date(),
      },
    });
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token is empty.' });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    req.actorName = decodedToken.name || decodedToken.email || 'Team Member';
    await syncUser(decodedToken);
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
};
