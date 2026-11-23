import crypto from 'crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, requireAuth, validateSessionToken, signFileAccessToken, verifyFileAccessToken } from './auth.ts';

process.env.SESSION_SECRET = 'test-secret-that-is-long-enough-for-session-signing';
process.env.COMPANY_ACCESS_CODE = 'test-company-access-code-123';
process.env.NODE_ENV = 'test';

function mockRequest(options: { code?: string; cookie?: string; ip?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.code !== undefined) headers['x-company-access-code'] = options.code;
  if (options.origin) headers.origin = options.origin;
  return { headers, socket: { remoteAddress: options.ip || `test-${crypto.randomUUID()}` }, protocol: 'http', get(name: string) { return headers[name.toLowerCase()]; } } as any;
}

function mockResponse() {
  const result: { status?: number; body?: unknown; cookie?: string } = {};
  return {
    result,
    setHeader(name: string, value: string) { if (name.toLowerCase() === 'set-cookie') result.cookie = value; return this; },
    status(code: number) { result.status = code; return this; },
    json(body: unknown) { result.body = body; return this; },
  } as any;
}

test('signed sessions expire and reject tampering', () => {
  const token = createSessionToken(1000);
  assert.equal(validateSessionToken(token, 1001), true);
  assert.equal(validateSessionToken(token, 1000 + 8 * 60 * 60), false);
  assert.equal(validateSessionToken(`${token}x`, 1001), false);
});

test('company code grants signed HttpOnly SameSite session', () => {
  const req = mockRequest({ code: process.env.COMPANY_ACCESS_CODE });
  const res = mockResponse();
  let advanced = false;
  requireAuth(req, res, (() => { advanced = true; }) as any);
  assert.equal(advanced, true);
  assert.match(res.result.cookie, /HttpOnly/);
  assert.match(res.result.cookie, /SameSite=Strict/);
  const cookieValue = res.result.cookie.split(';')[0].split('=').slice(1).join('=');
  assert.equal(validateSessionToken(decodeURIComponent(cookieValue)), true);
});

test('incorrect code is rejected without creating a session', () => {
  const req = mockRequest({ code: 'wrong-code' });
  const res = mockResponse();
  let advanced = false;
  requireAuth(req, res, (() => { advanced = true; }) as any);
  assert.equal(advanced, false);
  assert.equal(res.result.status, 401);
  assert.equal(res.result.cookie, undefined);
});

test('cross-origin API access is rejected', () => {
  const req = mockRequest({ code: process.env.COMPANY_ACCESS_CODE, origin: 'https://attacker.example' });
  req.headers.host = 'app.example';
  req.get = (name: string) => name.toLowerCase() === 'host' ? req.headers.host : req.headers[name.toLowerCase()];
  const res = mockResponse();
  let advanced = false;
  requireAuth(req, res, (() => { advanced = true; }) as any);
  assert.equal(advanced, false);
  assert.equal(res.result.status, 403);
});

test('signed file URL tokens are file-specific and expire', () => {
  const token = signFileAccessToken('file-a');
  assert.equal(verifyFileAccessToken('file-a', token), true);
  assert.equal(verifyFileAccessToken('file-b', token), false);
});
