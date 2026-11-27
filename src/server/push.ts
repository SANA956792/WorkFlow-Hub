import crypto from 'crypto';
import {
  sendNotification,
  type PushSubscription as WebPushSubscription,
} from 'web-push';
import { createPool } from '../db/index.ts';

export interface ValidatedPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  section: 'tasks' | 'dashboard' | 'employees' | 'posters' | 'reels' | 'calendar';
  taskId?: string | null;
  tag?: string;
}

interface TaskNotificationShape {
  id: string;
  taskCode: string;
  title: string;
  priority?: string | null;
  dueDate?: string | null;
  status: string;
  assignedEmployees?: Array<{ id: string; fullName: string }>;
  assignedEmployeeIds?: string[];
}

interface TableColumnMeta {
  name: string;
  dataType: string;
  hasDefault: boolean;
}

let cachedColumns: Map<string, TableColumnMeta> | null = null;
let ensureTablePromise: Promise<Map<string, TableColumnMeta>> | null = null;

const BASE64_KEY_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) {
    return true;
  }
  const m172 = host.match(/^172\.(\d{1,3})\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

export function getVapidConfig(): {
  publicKey: string;
  privateKey: string;
  subject: string;
} | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || '';
  let subject = process.env.VAPID_SUBJECT?.trim() || '';

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  if (
    !subject.startsWith('mailto:') &&
    !subject.startsWith('https://') &&
    !subject.startsWith('http://') &&
    subject.includes('@')
  ) {
    subject = `mailto:${subject}`;
  }

  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return getVapidConfig() !== null;
}

export function getVapidPublicKey(): string | null {
  return getVapidConfig()?.publicKey ?? null;
}

export function validatePushSubscriptionInput(
  raw: unknown
): { subscription?: ValidatedPushSubscription; error?: string } {
  const candidate =
    raw && typeof raw === 'object' && 'subscription' in raw
      ? (raw as { subscription?: unknown }).subscription
      : raw;

  if (!candidate || typeof candidate !== 'object') {
    return { error: 'Invalid push subscription payload.' };
  }

  const obj = candidate as Record<string, unknown>;
  const endpoint = typeof obj.endpoint === 'string' ? obj.endpoint.trim() : '';
  if (!endpoint || endpoint.length > 2048) {
    return { error: 'Invalid push subscription endpoint.' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpoint);
  } catch {
    return { error: 'Push subscription endpoint must be a valid URL.' };
  }

  if (parsedUrl.protocol !== 'https:' || isPrivateOrLoopbackHost(parsedUrl.hostname)) {
    return { error: 'Push subscription endpoint must use a public HTTPS push service.' };
  }

  const keys = obj.keys;
  if (!keys || typeof keys !== 'object') {
    return { error: 'Push subscription keys are missing.' };
  }

  const keyObj = keys as Record<string, unknown>;
  const p256dh = typeof keyObj.p256dh === 'string' ? keyObj.p256dh.trim() : '';
  const auth = typeof keyObj.auth === 'string' ? keyObj.auth.trim() : '';

  if (
    !p256dh ||
    p256dh.length < 16 ||
    p256dh.length > 512 ||
    !BASE64_KEY_RE.test(p256dh)
  ) {
    return { error: 'Invalid push subscription p256dh key.' };
  }

  if (
    !auth ||
    auth.length < 8 ||
    auth.length > 256 ||
    !BASE64_KEY_RE.test(auth)
  ) {
    return { error: 'Invalid push subscription auth secret.' };
  }

  let expirationTime: number | null = null;
  if (obj.expirationTime !== undefined && obj.expirationTime !== null) {
    if (
      typeof obj.expirationTime !== 'number' ||
      !Number.isFinite(obj.expirationTime)
    ) {
      return { error: 'Invalid push subscription expiration time.' };
    }
    expirationTime = obj.expirationTime;
  }

  return {
    subscription: {
      endpoint,
      expirationTime,
      keys: { p256dh, auth },
    },
  };
}

async function getPushSubscriptionsColumns(forceRefresh = false): Promise<Map<string, TableColumnMeta>> {
  if (!forceRefresh && cachedColumns) {
    return cachedColumns;
  }
  if (!forceRefresh && ensureTablePromise) {
    return ensureTablePromise;
  }

  ensureTablePromise = (async () => {
    const pool = createPool();
    const inspectQuery = `
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
    `;

    let res = await pool.query(inspectQuery);
    if (res.rows.length === 0) {
      // Purely additive fallback when connected to a fresh database without push_subscriptions
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "push_subscriptions" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "endpoint" text NOT NULL UNIQUE,
          "p256dh" text NOT NULL,
          "auth" text NOT NULL,
          "expiration_time" bigint,
          "user_agent" text,
          "session_id" uuid,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL
        );
      `);
      res = await pool.query(inspectQuery);
    }

    const map = new Map<string, TableColumnMeta>();
    for (const row of res.rows) {
      map.set(String(row.column_name), {
        name: String(row.column_name),
        dataType: String(row.data_type || ''),
        hasDefault: row.column_default !== null && row.column_default !== undefined,
      });
    }
    cachedColumns = map;
    ensureTablePromise = null;
    return map;
  })().catch((err) => {
    ensureTablePromise = null;
    throw err;
  });

  return ensureTablePromise;
}

function parseKeysJson(raw: unknown): { p256dh?: string; auth?: string } | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') {
    return raw as { p256dh?: string; auth?: string };
  }
  return null;
}

export async function savePushSubscription(params: {
  subscription: ValidatedPushSubscription;
  userAgent?: string | null;
  sessionId?: string | null;
}): Promise<void> {
  const pool = createPool();
  const cols = await getPushSubscriptionsColumns();
  const { subscription, userAgent, sessionId } = params;

  const hasEndpointCol = cols.has('endpoint');
  const hasSubscriptionCol = cols.has('subscription');

  if (!hasEndpointCol && !hasSubscriptionCol) {
    throw new Error('push_subscriptions table is missing an endpoint or subscription column.');
  }

  const findSql = hasEndpointCol
    ? `SELECT id FROM "push_subscriptions" WHERE "endpoint" = $1 LIMIT 1`
    : `SELECT id FROM "push_subscriptions" WHERE ("subscription"->>'endpoint') = $1 LIMIT 1`;

  const existing = await pool.query(findSql, [subscription.endpoint]);
  const now = new Date();
  const safeUa = userAgent ? userAgent.slice(0, 300) : null;

  if (existing.rows.length > 0) {
    const rowId = existing.rows[0].id;
    const setClauses: string[] = [];
    const values: unknown[] = [];

    const pushSet = (colName: string, value: unknown) => {
      values.push(value);
      setClauses.push(`"${colName}" = $${values.length}`);
    };

    if (cols.has('endpoint')) pushSet('endpoint', subscription.endpoint);
    if (cols.has('p256dh')) pushSet('p256dh', subscription.keys.p256dh);
    if (cols.has('auth')) pushSet('auth', subscription.keys.auth);
    if (cols.has('keys')) pushSet('keys', JSON.stringify(subscription.keys));
    if (cols.has('subscription')) {
      pushSet(
        'subscription',
        JSON.stringify({
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime,
          keys: subscription.keys,
        })
      );
    }
    if (cols.has('expiration_time')) {
      pushSet('expiration_time', subscription.expirationTime);
    }
    if (cols.has('user_agent')) pushSet('user_agent', safeUa);
    if (cols.has('session_id') && sessionId && cols.get('session_id')?.dataType === 'uuid') {
      pushSet('session_id', sessionId);
    }
    if (cols.has('is_active')) pushSet('is_active', true);
    if (cols.has('active')) pushSet('active', true);
    if (cols.has('updated_at')) pushSet('updated_at', now);

    if (setClauses.length > 0) {
      values.push(rowId);
      await pool.query(
        `UPDATE "push_subscriptions" SET ${setClauses.join(', ')} WHERE "id" = $${values.length}`,
        values
      );
    }
    return;
  }

  const insertCols: string[] = [];
  const insertVals: unknown[] = [];

  const pushInsert = (colName: string, value: unknown) => {
    insertCols.push(`"${colName}"`);
    insertVals.push(value);
  };

  const idMeta = cols.get('id');
  if (idMeta && !idMeta.hasDefault && idMeta.dataType === 'uuid') {
    pushInsert('id', crypto.randomUUID());
  }
  if (cols.has('endpoint')) pushInsert('endpoint', subscription.endpoint);
  if (cols.has('p256dh')) pushInsert('p256dh', subscription.keys.p256dh);
  if (cols.has('auth')) pushInsert('auth', subscription.keys.auth);
  if (cols.has('keys')) pushInsert('keys', JSON.stringify(subscription.keys));
  if (cols.has('subscription')) {
    pushInsert(
      'subscription',
      JSON.stringify({
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: subscription.keys,
      })
    );
  }
  if (cols.has('expiration_time')) {
    pushInsert('expiration_time', subscription.expirationTime);
  }
  if (cols.has('user_agent')) pushInsert('user_agent', safeUa);
  if (cols.has('session_id') && sessionId && cols.get('session_id')?.dataType === 'uuid') {
    pushInsert('session_id', sessionId);
  }
  if (cols.has('is_active')) pushInsert('is_active', true);
  if (cols.has('active')) pushInsert('active', true);
  if (cols.has('created_at') && !cols.get('created_at')?.hasDefault) {
    pushInsert('created_at', now);
  }
  if (cols.has('updated_at') && !cols.get('updated_at')?.hasDefault) {
    pushInsert('updated_at', now);
  }

  const placeholders = insertVals.map((_, idx) => `$${idx + 1}`).join(', ');
  await pool.query(
    `INSERT INTO "push_subscriptions" (${insertCols.join(', ')}) VALUES (${placeholders})`,
    insertVals
  );
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  const pool = createPool();
  const cols = await getPushSubscriptionsColumns();

  if (cols.has('endpoint')) {
    await pool.query(`DELETE FROM "push_subscriptions" WHERE "endpoint" = $1`, [endpoint]);
  } else if (cols.has('subscription')) {
    await pool.query(
      `DELETE FROM "push_subscriptions" WHERE ("subscription"->>'endpoint') = $1`,
      [endpoint]
    );
  }
}

async function listActivePushSubscriptions(): Promise<WebPushSubscription[]> {
  const pool = createPool();
  const cols = await getPushSubscriptionsColumns();

  const selectable = ['endpoint', 'p256dh', 'auth', 'keys', 'subscription'].filter((c) =>
    cols.has(c)
  );
  if (selectable.length === 0) return [];

  const selectList = selectable.map((c) => `"${c}"`).join(', ');
  const whereClauses: string[] = [];
  if (cols.has('is_active')) whereClauses.push(`"is_active" = true`);
  if (cols.has('active')) whereClauses.push(`"active" = true`);

  const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
  const result = await pool.query(`SELECT ${selectList} FROM "push_subscriptions"${whereSql}`);

  const seenEndpoints = new Set<string>();
  const subs: WebPushSubscription[] = [];

  for (const row of result.rows) {
    const parsedSub = parseKeysJson(row.subscription) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    } | null;
    const parsedKeys = parseKeysJson(row.keys);

    const endpoint =
      typeof row.endpoint === 'string' && row.endpoint.trim()
        ? row.endpoint.trim()
        : typeof parsedSub?.endpoint === 'string'
        ? parsedSub.endpoint.trim()
        : '';

    const p256dh =
      typeof row.p256dh === 'string' && row.p256dh.trim()
        ? row.p256dh.trim()
        : typeof parsedKeys?.p256dh === 'string'
        ? parsedKeys.p256dh.trim()
        : typeof parsedSub?.keys?.p256dh === 'string'
        ? parsedSub.keys.p256dh.trim()
        : '';

    const auth =
      typeof row.auth === 'string' && row.auth.trim()
        ? row.auth.trim()
        : typeof parsedKeys?.auth === 'string'
        ? parsedKeys.auth.trim()
        : typeof parsedSub?.keys?.auth === 'string'
        ? parsedSub.keys.auth.trim()
        : '';

    if (!endpoint || !p256dh || !auth || seenEndpoints.has(endpoint)) {
      continue;
    }

    seenEndpoints.add(endpoint);
    subs.push({
      endpoint,
      keys: { p256dh, auth },
    });
  }

  return subs;
}

export async function sendPushNotificationToAll(
  payload: PushNotificationPayload
): Promise<{ sent: number; removed: number }> {
  const vapid = getVapidConfig();
  if (!vapid) {
    return { sent: 0, removed: 0 };
  }

  let subscriptions: WebPushSubscription[];
  try {
    subscriptions = await listActivePushSubscriptions();
  } catch (err: any) {
    console.error('Failed to load push subscriptions:', err?.message || 'PUSH_LOAD_ERR');
    return { sent: 0, removed: 0 };
  }

  if (subscriptions.length === 0) {
    return { sent: 0, removed: 0 };
  }

  const serializedPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    section: payload.section,
    taskId: payload.taskId ?? null,
    tag: payload.tag,
  });

  const expiredEndpoints: string[] = [];
  let sent = 0;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await sendNotification(sub, serializedPayload, {
          vapidDetails: vapid,
          TTL: 86400,
          timeout: 5000,
          urgency: 'high',
        });
        sent += 1;
      } catch (err: any) {
        const statusCode = Number(err?.statusCode);
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        } else {
          console.warn('Push delivery failed:', statusCode || err?.code || 'PUSH_ERR');
        }
      }
    })
  );

  if (expiredEndpoints.length > 0) {
    await Promise.allSettled(
      expiredEndpoints.map((ep) => deletePushSubscriptionByEndpoint(ep))
    );
  }

  return { sent, removed: expiredEndpoints.length };
}

function formatAssigneeNames(task: TaskNotificationShape, filterIds?: string[]): string {
  const assignees = task.assignedEmployees ?? [];
  const list = filterIds
    ? assignees.filter((a) => filterIds.includes(a.id))
    : assignees;
  const names = list.map((a) => a.fullName).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

export async function notifyTaskCreated(task: TaskNotificationShape): Promise<void> {
  if (!isPushConfigured()) return;
  const assignees = task.assignedEmployees ?? [];
  if (assignees.length === 0) return;

  const assigneeText = formatAssigneeNames(task);
  const dueSuffix = task.dueDate ? ` · Due ${task.dueDate}` : '';

  await sendPushNotificationToAll({
    title: `Task Assigned: ${task.title}`,
    body: `${task.taskCode} · Assigned to ${assigneeText}${dueSuffix}`,
    url: `/?section=tasks&taskId=${encodeURIComponent(task.id)}`,
    section: 'tasks',
    taskId: task.id,
    tag: `task-assigned-${task.id}`,
  });
}

export async function notifyTaskUpdated(
  before: TaskNotificationShape | null,
  after: TaskNotificationShape
): Promise<void> {
  if (!isPushConfigured()) return;

  const beforeIds = new Set(before?.assignedEmployeeIds ?? []);
  const afterIds = after.assignedEmployeeIds ?? [];
  const newlyAssignedIds = afterIds.filter((id) => !beforeIds.has(id));
  const statusChanged = before ? before.status !== after.status : false;

  if (newlyAssignedIds.length > 0) {
    const newNames = formatAssigneeNames(after, newlyAssignedIds) || 'team member';
    await sendPushNotificationToAll({
      title: `Task Assigned: ${after.title}`,
      body: `${after.taskCode} · Assigned to ${newNames}`,
      url: `/?section=tasks&taskId=${encodeURIComponent(after.id)}`,
      section: 'tasks',
      taskId: after.id,
      tag: `task-assigned-${after.id}`,
    });
    return;
  }

  if (statusChanged && before) {
    await sendPushNotificationToAll({
      title: `Task Status: ${after.title}`,
      body: `${after.taskCode} · ${before.status} → ${after.status}`,
      url: `/?section=tasks&taskId=${encodeURIComponent(after.id)}`,
      section: 'tasks',
      taskId: after.id,
      tag: `task-status-${after.id}`,
    });
    return;
  }

  const detailsChanged =
    !before ||
    before.title !== after.title ||
    before.dueDate !== after.dueDate ||
    before.priority !== after.priority;

  if (detailsChanged) {
    const dueSuffix = after.dueDate ? ` · Due ${after.dueDate}` : '';
    await sendPushNotificationToAll({
      title: `Task Updated: ${after.title}`,
      body: `${after.taskCode} · Priority: ${after.priority || 'Medium'}${dueSuffix}`,
      url: `/?section=tasks&taskId=${encodeURIComponent(after.id)}`,
      section: 'tasks',
      taskId: after.id,
      tag: `task-update-${after.id}`,
    });
  }
}

export async function notifyTaskProgressUpdate(
  task: TaskNotificationShape,
  comment: string,
  statusChangeTo?: string | null
): Promise<void> {
  if (!isPushConfigured()) return;

  const cleanComment = comment.trim().replace(/\s+/g, ' ').slice(0, 120);
  const title = statusChangeTo
    ? `Task Status: ${task.title}`
    : `Task Update: ${task.title}`;
  const body = statusChangeTo
    ? `${task.taskCode} moved to ${statusChangeTo}${cleanComment ? ` · ${cleanComment}` : ''}`
    : `${task.taskCode} · ${cleanComment || 'New progress update posted'}`;

  await sendPushNotificationToAll({
    title,
    body,
    url: `/?section=tasks&taskId=${encodeURIComponent(task.id)}`,
    section: 'tasks',
    taskId: task.id,
    tag: `task-update-${task.id}`,
  });
}
