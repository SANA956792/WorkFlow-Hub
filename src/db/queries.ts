import crypto from 'crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { createPool, db } from './index.ts';
import {
  activityLogs,
  appSessions,
  companySettings,
  employees,
  posterAssignments,
  posters,
  reelAssignments,
  reels,
  storedFileChunks,
  storedFiles,
  StoredAttachmentRef,
  taskAssignments,
  tasks,
  taskUpdates,
} from './schema.ts';
import { buildSignedFileUrl } from '../middleware/auth.ts';

const DEFAULT_LOGO_URL = '/assets/aistudio/c1a1b7c939908f430c32f54944ae2d9b_58b868bd.jpg';

let schemaEnsureDone = false;
let schemaEnsurePromise: Promise<void> | null = null;

/**
 * Ensures additive tables/columns (app_sessions, stored_file_chunks, company_settings.access_code_hash)
 * exist on any connected PostgreSQL database without dropping, truncating, or altering existing data.
 */
export async function ensureAdditiveWorkspaceSchema(): Promise<void> {
  if (schemaEnsureDone) return;
  if (schemaEnsurePromise) return schemaEnsurePromise;

  schemaEnsurePromise = (async () => {
    const pool = createPool();
    const check = await pool.query(`
      SELECT
        to_regclass('public.app_sessions') IS NOT NULL AS has_sessions,
        to_regclass('public.stored_file_chunks') IS NOT NULL AS has_chunks,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'company_settings'
            AND column_name = 'access_code_hash'
        ) AS has_access_code_col
    `);

    const row = check.rows[0];
    if (row?.has_sessions && row?.has_chunks && row?.has_access_code_col) {
      schemaEnsureDone = true;
      return;
    }

    // Purely additive DDL — never drops, resets, or truncates any existing tables or rows
    if (!row?.has_sessions) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "app_sessions" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "token_hash" text NOT NULL UNIQUE,
          "label" text DEFAULT 'Company Workspace' NOT NULL,
          "expires_at" timestamp NOT NULL,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "last_seen_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "app_sessions_expires_at_idx" ON "app_sessions" ("expires_at");
      `);
    }

    if (!row?.has_chunks) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "stored_file_chunks" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "file_id" uuid NOT NULL REFERENCES "public"."stored_files"("id") ON DELETE cascade,
          "chunk_index" integer NOT NULL,
          "size_bytes" integer NOT NULL,
          "data" bytea NOT NULL,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "stored_file_chunks_file_idx" ON "stored_file_chunks" ("file_id", "chunk_index");
      `);
    }

    if (!row?.has_access_code_col) {
      await pool.query(`
        ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "access_code_hash" text;
      `);
    }

    schemaEnsureDone = true;
  })()
    .catch((err: any) => {
      schemaEnsurePromise = null;
      console.error(
        'ensureAdditiveWorkspaceSchema failed:',
        err?.code,
        err?.message
      );
      throw err;
    });

  return schemaEnsurePromise;
}

function serializeEmployee(row: typeof employees.$inferSelect) {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    profileImageFileId: row.profileImageFileId ?? null,
    profileImageUrl: row.profileImageFileId
      ? buildSignedFileUrl(row.profileImageFileId)
      : row.profileImageUrl ?? null,
    department: row.department,
    designation: row.designation,
    phone: row.phone ?? null,
    joiningDate: row.joiningDate ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function signAttachmentList(items: StoredAttachmentRef[] | null | undefined) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    ...item,
    url: item.fileId ? buildSignedFileUrl(item.fileId) || item.url : item.url,
  }));
}

async function generateNextCode(
  prefix: string,
  table: 'employees' | 'tasks' | 'posters' | 'reels'
): Promise<string> {
  let count = 0;
  if (table === 'employees') {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(employees);
    count = res[0]?.count ?? 0;
  } else if (table === 'tasks') {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(tasks);
    count = res[0]?.count ?? 0;
  } else if (table === 'posters') {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(posters);
    count = res[0]?.count ?? 0;
  } else {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(reels);
    count = res[0]?.count ?? 0;
  }
  const num = count + 1;
  const suffix = String(num).padStart(3, '0');
  const randomTail = Math.floor(10 + Math.random() * 89);
  return `${prefix}-${suffix}-${randomTail}`;
}

export async function logActivity(params: {
  entityType: 'employee' | 'task' | 'poster' | 'reel' | 'company';
  entityId: string;
  action: string;
  title: string;
  details?: string;
  actorName: string;
  actorUid?: string | null;
}) {
  try {
    await db.insert(activityLogs).values({
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      title: params.title,
      details: params.details ?? '',
      actorName: params.actorName,
      actorUid: params.actorUid ?? null,
    });
  } catch (error) {
    console.error('Failed to insert activity log:', error);
  }
}

export async function getCompanySettings() {
  try {
    await ensureAdditiveWorkspaceSchema();
    const existing = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.singletonKey, 'default'))
      .limit(1);

    let row = existing[0];
    if (!row) {
      const inserted = await db
        .insert(companySettings)
        .values({
          singletonKey: 'default',
          companyName: 'WORK ORGANIZER',
          logoUrl: DEFAULT_LOGO_URL,
        })
        .onConflictDoNothing()
        .returning();
      row = inserted[0];
      if (!row) {
        const refetch = await db
          .select()
          .from(companySettings)
          .where(eq(companySettings.singletonKey, 'default'))
          .limit(1);
        row = refetch[0];
      }
    }

    return {
      id: row.id,
      companyName: row.companyName,
      logoFileId: row.logoFileId ?? null,
      logoUrl: row.logoFileId
        ? buildSignedFileUrl(row.logoFileId) || DEFAULT_LOGO_URL
        : row.logoUrl || DEFAULT_LOGO_URL,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database query failed in getCompanySettings:', error);
    throw new Error('Unable to load company settings.', { cause: error });
  }
}

export async function updateCompanySettings(params: {
  companyName?: string;
  logoFileId?: string | null;
  logoUrl?: string;
  actorName: string;
  actorUid?: string | null;
}) {
  try {
    const current = await getCompanySettings();
    const nextLogoFileId =
      params.logoFileId !== undefined ? params.logoFileId : current.logoFileId;
    const nextLogoUrl =
      params.logoFileId !== undefined
        ? params.logoFileId
          ? `/api/files/${params.logoFileId}`
          : DEFAULT_LOGO_URL
        : params.logoUrl ?? current.logoUrl;
    const nextName = params.companyName?.trim() || current.companyName;

    const [updated] = await db
      .update(companySettings)
      .set({
        companyName: nextName,
        logoFileId: nextLogoFileId,
        logoUrl: nextLogoUrl,
        updatedAt: new Date(),
      })
      .where(eq(companySettings.singletonKey, 'default'))
      .returning();

    if (
      params.logoFileId &&
      current.logoFileId &&
      current.logoFileId !== params.logoFileId
    ) {
      await safeDeleteStoredFile(current.logoFileId);
    }

    await logActivity({
      entityType: 'company',
      entityId: String(updated.id),
      action: 'updated_logo',
      title: 'Company branding updated',
      details: params.logoFileId ? 'Uploaded new company logo' : 'Updated company settings',
      actorName: params.actorName,
      actorUid: params.actorUid,
    });

    return {
      id: updated.id,
      companyName: updated.companyName,
      logoFileId: updated.logoFileId ?? null,
      logoUrl: updated.logoFileId
        ? buildSignedFileUrl(updated.logoFileId) || DEFAULT_LOGO_URL
        : updated.logoUrl || DEFAULT_LOGO_URL,
      updatedAt: updated.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database update failed in updateCompanySettings:', error);
    throw new Error('Unable to save company branding.', { cause: error });
  }
}

export async function saveStoredFile(params: {
  bucket: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
  uploadedByUid?: string | null;
}) {
  try {
    const [row] = await db
      .insert(storedFiles)
      .values({
        bucket: params.bucket,
        originalName: params.originalName,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        data: params.data,
        uploadedByUid: params.uploadedByUid ?? null,
      })
      .returning({
        id: storedFiles.id,
        bucket: storedFiles.bucket,
        originalName: storedFiles.originalName,
        mimeType: storedFiles.mimeType,
        sizeBytes: storedFiles.sizeBytes,
        createdAt: storedFiles.createdAt,
      });

    return {
      fileId: row.id,
      fileName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      url: buildSignedFileUrl(row.id) || `/api/files/${row.id}`,
    };
  } catch (error) {
    console.error('Database write failed in saveStoredFile:', error);
    throw new Error('Unable to store uploaded file.', { cause: error });
  }
}

export async function getStoredFileById(fileId: string) {
  try {
    const [row] = await db
      .select()
      .from(storedFiles)
      .where(eq(storedFiles.id, fileId))
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error('Database query failed in getStoredFileById:', error);
    throw new Error('Unable to retrieve file.', { cause: error });
  }
}

export async function createChunkedFilePlaceholder(params: {
  bucket: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUid?: string | null;
}) {
  try {
    await ensureAdditiveWorkspaceSchema();
    const [row] = await db
      .insert(storedFiles)
      .values({
        bucket: params.bucket,
        originalName: params.originalName,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        data: Buffer.alloc(0),
        uploadedByUid: params.uploadedByUid ?? null,
      })
      .returning({
        id: storedFiles.id,
        originalName: storedFiles.originalName,
        mimeType: storedFiles.mimeType,
        sizeBytes: storedFiles.sizeBytes,
      });

    return {
      fileId: row.id,
      fileName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    };
  } catch (error) {
    console.error('Database write failed in createChunkedFilePlaceholder:', error);
    throw new Error('Unable to initialize file upload.', { cause: error });
  }
}

export async function upsertStoredFileChunk(params: {
  fileId: string;
  chunkIndex: number;
  data: Buffer;
}) {
  try {
    const [fileRow] = await db
      .select({ id: storedFiles.id })
      .from(storedFiles)
      .where(eq(storedFiles.id, params.fileId))
      .limit(1);
    if (!fileRow) {
      throw new Error('Upload session file not found.');
    }

    await db
      .insert(storedFileChunks)
      .values({
        fileId: params.fileId,
        chunkIndex: params.chunkIndex,
        sizeBytes: params.data.length,
        data: params.data,
      })
      .onConflictDoUpdate({
        target: [storedFileChunks.fileId, storedFileChunks.chunkIndex],
        set: {
          sizeBytes: params.data.length,
          data: params.data,
        },
      });
  } catch (error) {
    console.error('Database write failed in upsertStoredFileChunk:', error);
    throw error instanceof Error
      ? error
      : new Error('Unable to save upload chunk.');
  }
}

export async function finalizeChunkedFile(params: {
  fileId: string;
  totalChunks: number;
}) {
  try {
    const [fileRow] = await db
      .select({
        id: storedFiles.id,
        originalName: storedFiles.originalName,
        mimeType: storedFiles.mimeType,
        sizeBytes: storedFiles.sizeBytes,
      })
      .from(storedFiles)
      .where(eq(storedFiles.id, params.fileId))
      .limit(1);

    if (!fileRow) {
      throw new Error('Uploaded file record not found.');
    }

    const chunksMeta = await db
      .select({
        chunkIndex: storedFileChunks.chunkIndex,
        sizeBytes: storedFileChunks.sizeBytes,
      })
      .from(storedFileChunks)
      .where(eq(storedFileChunks.fileId, params.fileId))
      .orderBy(asc(storedFileChunks.chunkIndex));

    if (chunksMeta.length !== params.totalChunks) {
      throw new Error(
        `Incomplete upload: received ${chunksMeta.length} of ${params.totalChunks} parts.`
      );
    }

    let totalBytes = 0;
    for (let i = 0; i < chunksMeta.length; i++) {
      if (chunksMeta[i].chunkIndex !== i) {
        throw new Error(`Missing upload part #${i}.`);
      }
      totalBytes += chunksMeta[i].sizeBytes;
    }

    if (totalBytes !== fileRow.sizeBytes) {
      await db
        .update(storedFiles)
        .set({ sizeBytes: totalBytes })
        .where(eq(storedFiles.id, params.fileId));
    }

    return {
      fileId: fileRow.id,
      fileName: fileRow.originalName,
      mimeType: fileRow.mimeType,
      sizeBytes: totalBytes,
      url: buildSignedFileUrl(fileRow.id) || `/api/files/${fileRow.id}`,
    };
  } catch (error) {
    console.error('Database finalize failed in finalizeChunkedFile:', error);
    throw error instanceof Error
      ? error
      : new Error('Unable to finalize uploaded file.');
  }
}

export async function deleteIncompleteStoredFile(fileId: string) {
  try {
    await db
      .delete(storedFiles)
      .where(
        and(
          eq(storedFiles.id, fileId),
          sql`octet_length(${storedFiles.data}) = 0`
        )
      );
  } catch (error) {
    console.error('Non-fatal cleanup error for incomplete file:', fileId, error);
  }
}

export async function getStoredFileMeta(fileId: string) {
  try {
    await ensureAdditiveWorkspaceSchema();
    const [row] = await db
      .select({
        id: storedFiles.id,
        bucket: storedFiles.bucket,
        originalName: storedFiles.originalName,
        mimeType: storedFiles.mimeType,
        sizeBytes: storedFiles.sizeBytes,
        inlineLength: sql<number>`octet_length(${storedFiles.data})::int`,
      })
      .from(storedFiles)
      .where(eq(storedFiles.id, fileId))
      .limit(1);

    if (!row) return null;

    if (row.inlineLength > 0) {
      return {
        ...row,
        totalLength: row.inlineLength,
        isChunked: false,
      };
    }

    const chunkSum = await db
      .select({
        total: sql<number>`coalesce(sum(${storedFileChunks.sizeBytes}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(storedFileChunks)
      .where(eq(storedFileChunks.fileId, fileId));

    const totalFromChunks = chunkSum[0]?.total ?? 0;
    const chunkCount = chunkSum[0]?.count ?? 0;
    if (chunkCount === 0 && row.sizeBytes === 0) {
      return {
        ...row,
        totalLength: 0,
        isChunked: false,
      };
    }

    return {
      ...row,
      totalLength: chunkCount > 0 ? totalFromChunks : row.sizeBytes,
      isChunked: chunkCount > 0,
    };
  } catch (error) {
    console.error('Database query failed in getStoredFileMeta:', error);
    throw new Error('Unable to read file metadata.', { cause: error });
  }
}

export async function readStoredFileRange(
  fileId: string,
  start: number,
  end: number,
  isChunked: boolean
): Promise<Buffer> {
  const length = Math.max(0, end - start + 1);
  if (length === 0) return Buffer.alloc(0);

  if (!isChunked) {
    // PostgreSQL substring(bytea from 1-based-start for length) avoids loading full blobs into Node RAM
    const result = await db
      .select({
        slice: sql<Buffer>`substring(${storedFiles.data} from ${start + 1} for ${length})`,
      })
      .from(storedFiles)
      .where(eq(storedFiles.id, fileId))
      .limit(1);
    const raw = result[0]?.slice;
    if (!raw) return Buffer.alloc(0);
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  }

  const chunkMeta = await db
    .select({
      chunkIndex: storedFileChunks.chunkIndex,
      sizeBytes: storedFileChunks.sizeBytes,
    })
    .from(storedFileChunks)
    .where(eq(storedFileChunks.fileId, fileId))
    .orderBy(asc(storedFileChunks.chunkIndex));

  const neededIndices: { chunkIndex: number; chunkStart: number; chunkEnd: number }[] = [];
  let offset = 0;
  for (const cm of chunkMeta) {
    const chunkStart = offset;
    const chunkEnd = offset + cm.sizeBytes - 1;
    offset += cm.sizeBytes;
    if (chunkEnd >= start && chunkStart <= end) {
      neededIndices.push({ chunkIndex: cm.chunkIndex, chunkStart, chunkEnd });
    }
  }

  if (neededIndices.length === 0) return Buffer.alloc(0);

  const fetched = await db
    .select({
      chunkIndex: storedFileChunks.chunkIndex,
      data: storedFileChunks.data,
    })
    .from(storedFileChunks)
    .where(
      and(
        eq(storedFileChunks.fileId, fileId),
        inArray(
          storedFileChunks.chunkIndex,
          neededIndices.map((n) => n.chunkIndex)
        )
      )
    )
    .orderBy(asc(storedFileChunks.chunkIndex));

  const parts: Buffer[] = [];
  for (const meta of neededIndices) {
    const row = fetched.find((f) => f.chunkIndex === meta.chunkIndex);
    if (!row) continue;
    const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    const sliceStart = Math.max(0, start - meta.chunkStart);
    const sliceEnd = Math.min(buf.length - 1, end - meta.chunkStart);
    if (sliceEnd >= sliceStart) {
      parts.push(buf.subarray(sliceStart, sliceEnd + 1));
    }
  }

  return Buffer.concat(parts);
}

async function safeDeleteStoredFile(fileId: string) {
  try {
    await db.delete(storedFiles).where(eq(storedFiles.id, fileId));
  } catch (error) {
    console.error('Non-fatal cleanup error for stored file:', fileId, error);
  }
}

// ============================================================================
// COMPANY ACCESS CODE & PERSISTENT SESSIONS
// ============================================================================

export async function getCompanyAccessConfig() {
  await ensureAdditiveWorkspaceSchema();
  await getCompanySettings();
  const [row] = await db
    .select({
      accessCodeHash: companySettings.accessCodeHash,
      logoFileId: companySettings.logoFileId,
    })
    .from(companySettings)
    .where(eq(companySettings.singletonKey, 'default'))
    .limit(1);

  return {
    accessCodeHash: row?.accessCodeHash ?? null,
    logoFileId: row?.logoFileId ?? null,
  };
}

export async function claimCompanyAccessCodeHash(hash: string): Promise<boolean> {
  await ensureAdditiveWorkspaceSchema();
  await getCompanySettings();
  const updated = await db
    .update(companySettings)
    .set({
      accessCodeHash: hash,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(companySettings.singletonKey, 'default'),
        isNull(companySettings.accessCodeHash)
      )
    )
    .returning({ id: companySettings.id });
  return updated.length > 0;
}

export async function createAppSession(params: {
  tokenHash: string;
  label?: string;
  expiresAt: Date;
}) {
  await ensureAdditiveWorkspaceSchema();
  const now = new Date();
  try {
    const [created] = await db
      .insert(appSessions)
      .values({
        id: crypto.randomUUID(),
        tokenHash: params.tokenHash,
        label: params.label || 'Company Workspace',
        expiresAt: params.expiresAt,
        createdAt: now,
        lastSeenAt: now,
      })
      .returning();

    // Clean up expired sessions safely after insert
    try {
      await db.delete(appSessions).where(lt(appSessions.expiresAt, now));
    } catch {
      // Non-fatal cleanup
    }

    return created;
  } catch (error: any) {
    const cause = error?.cause || error;
    console.error(
      'Database insert failed in createAppSession:',
      cause?.code,
      cause?.message,
      cause?.detail
    );
    throw new Error(
      cause?.message
        ? `Unable to create session (${cause.code || 'DB_ERROR'}): ${cause.message}`
        : 'Unable to create session.',
      { cause: error }
    );
  }
}

export async function getValidAppSession(tokenHash: string) {
  const now = new Date();
  let row: typeof appSessions.$inferSelect | undefined;

  try {
    const rows = await db
      .select()
      .from(appSessions)
      .where(
        and(
          eq(appSessions.tokenHash, tokenHash),
          gt(appSessions.expiresAt, now)
        )
      )
      .limit(1);
    row = rows[0];
  } catch (error: any) {
    const code = error?.code || error?.cause?.code;
    if (code === '42P01') {
      await ensureAdditiveWorkspaceSchema();
      const rows = await db
        .select()
        .from(appSessions)
        .where(
          and(
            eq(appSessions.tokenHash, tokenHash),
            gt(appSessions.expiresAt, now)
          )
        )
        .limit(1);
      row = rows[0];
    } else {
      throw error;
    }
  }

  if (!row) return null;

  // Throttle lastSeenAt updates to at most once per hour; await safely so no dangling socket remains on serverless freeze
  if (now.getTime() - row.lastSeenAt.getTime() > 60 * 60 * 1000) {
    try {
      await db
        .update(appSessions)
        .set({ lastSeenAt: now })
        .where(eq(appSessions.id, row.id));
    } catch (err: any) {
      console.warn(
        'Non-fatal session lastSeenAt update failed:',
        err?.code || 'UPDATE_WARN'
      );
    }
  }

  return row;
}

export async function deleteAppSessionByTokenHash(tokenHash: string) {
  await ensureAdditiveWorkspaceSchema();
  await db.delete(appSessions).where(eq(appSessions.tokenHash, tokenHash));
}

// ============================================================================
// EMPLOYEES
// ============================================================================

export async function listEmployees() {
  try {
    const rows = await db.select().from(employees).orderBy(desc(employees.createdAt));
    return rows.map(serializeEmployee);
  } catch (error) {
    console.error('Database query failed in listEmployees:', error);
    throw new Error('Unable to load employees.', { cause: error });
  }
}

export async function getEmployeeDetail(employeeId: string, todayStr: string) {
  try {
    const [empRow] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!empRow) return null;

    // Fetch only this employee's assigned task IDs, posters, and reels directly in SQL
    const [empTaskLinks, empPosterRows, empReelRows] = await Promise.all([
      db
        .select({ taskId: taskAssignments.taskId })
        .from(taskAssignments)
        .where(eq(taskAssignments.employeeId, employeeId)),
      db
        .select()
        .from(posters)
        .where(
          or(
            eq(posters.assignedDesignerId, employeeId),
            eq(posters.assignedWriterId, employeeId)
          )
        )
        .orderBy(desc(posters.createdAt)),
      db
        .select()
        .from(reels)
        .where(
          or(
            eq(reels.assignedEditorId, employeeId),
            eq(reels.assignedCreatorId, employeeId)
          )
        )
        .orderBy(desc(reels.createdAt)),
    ]);

    const taskIds = Array.from(new Set(empTaskLinks.map((a) => a.taskId)));

    const [empTaskRows, empTaskAssignmentRows] =
      taskIds.length > 0
        ? await Promise.all([
            db
              .select()
              .from(tasks)
              .where(inArray(tasks.id, taskIds))
              .orderBy(desc(tasks.createdAt)),
            db
              .select()
              .from(taskAssignments)
              .where(inArray(taskAssignments.taskId, taskIds)),
          ])
        : [[], []];

    const referencedEmpIds = new Set<string>([employeeId]);
    for (const a of empTaskAssignmentRows) {
      referencedEmpIds.add(a.employeeId);
    }
    for (const p of empPosterRows) {
      if (p.assignedDesignerId) referencedEmpIds.add(p.assignedDesignerId);
      if (p.assignedWriterId) referencedEmpIds.add(p.assignedWriterId);
    }
    for (const r of empReelRows) {
      if (r.assignedEditorId) referencedEmpIds.add(r.assignedEditorId);
      if (r.assignedCreatorId) referencedEmpIds.add(r.assignedCreatorId);
    }

    const relatedEmployees = await db
      .select()
      .from(employees)
      .where(inArray(employees.id, Array.from(referencedEmpIds)));
    const empMap = new Map(
      relatedEmployees.map((e) => [e.id, serializeEmployee(e)])
    );

    const empTasks = mapTaskRows(empTaskRows, empTaskAssignmentRows, empMap);
    const empPosters = mapPosterRows(empPosterRows, empMap);
    const empReels = mapReelRows(empReelRows, empMap);

    const relatedEntityIds = [
      employeeId,
      ...empTasks.map((t) => t.id),
      ...empPosters.map((p) => p.id),
      ...empReels.map((r) => r.id),
    ];

    const activities =
      relatedEntityIds.length > 0
        ? await db
            .select()
            .from(activityLogs)
            .where(inArray(activityLogs.entityId, relatedEntityIds))
            .orderBy(desc(activityLogs.createdAt))
            .limit(20)
        : [];

    const completedTasks = empTasks.filter((t) => t.status === 'Completed').length;
    const pendingTasks = empTasks.filter((t) => t.status === 'Pending').length;
    const inProgressTasks = empTasks.filter(
      (t) => t.status === 'In Progress'
    ).length;
    const overdueTasks = empTasks.filter(
      (t) =>
        t.dueDate &&
        t.dueDate < todayStr &&
        t.status !== 'Completed' &&
        t.status !== 'Cancelled'
    ).length;

    return {
      ...serializeEmployee(empRow),
      stats: {
        totalTasks: empTasks.length,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        overdueTasks,
        assignedPosters: empPosters.length,
        assignedReels: empReels.length,
      },
      tasks: empTasks,
      posters: empPosters,
      reels: empReels,
      recentActivities: activities.map((a) => ({
        ...a,
        entityType: a.entityType as any,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error('Database query failed in getEmployeeDetail:', error);
    throw new Error('Unable to load employee profile.', { cause: error });
  }
}

export async function createEmployee(
  input: {
    employeeCode?: string;
    fullName: string;
    profileImageFileId?: string | null;
    department: string;
    designation: string;
    phone?: string | null;
    joiningDate?: string | null;
    isActive?: boolean;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code =
      input.employeeCode?.trim() || (await generateNextCode('EMP', 'employees'));

    const [created] = await db
      .insert(employees)
      .values({
        employeeCode: code,
        fullName: input.fullName.trim(),
        profileImageFileId: input.profileImageFileId ?? null,
        profileImageUrl: input.profileImageFileId
          ? `/api/files/${input.profileImageFileId}`
          : null,
        department: input.department.trim(),
        designation: input.designation.trim(),
        phone: input.phone?.trim() || null,
        joiningDate: input.joiningDate || null,
        isActive: input.isActive ?? true,
      })
      .returning();

    await logActivity({
      entityType: 'employee',
      entityId: created.id,
      action: 'created',
      title: `Added employee ${created.fullName}`,
      details: `${created.designation} · ${created.department}`,
      actorName,
      actorUid,
    });

    return serializeEmployee(created);
  } catch (error: any) {
    console.error('Database insert failed in createEmployee:', error);
    if (error?.code === '23505') {
      throw new Error('An employee with this Employee ID already exists.');
    }
    throw new Error('Unable to create employee.', { cause: error });
  }
}

export async function updateEmployee(
  employeeId: string,
  input: {
    employeeCode?: string;
    fullName?: string;
    profileImageFileId?: string | null;
    department?: string;
    designation?: string;
    phone?: string | null;
    joiningDate?: string | null;
    isActive?: boolean;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!existing) return null;

    const nextImageId =
      input.profileImageFileId !== undefined
        ? input.profileImageFileId
        : existing.profileImageFileId;

    const [updated] = await db
      .update(employees)
      .set({
        employeeCode: input.employeeCode?.trim() || existing.employeeCode,
        fullName: input.fullName?.trim() || existing.fullName,
        profileImageFileId: nextImageId,
        profileImageUrl: nextImageId ? `/api/files/${nextImageId}` : null,
        department: input.department?.trim() || existing.department,
        designation: input.designation?.trim() || existing.designation,
        phone: input.phone !== undefined ? input.phone?.trim() || null : existing.phone,
        joiningDate:
          input.joiningDate !== undefined
            ? input.joiningDate || null
            : existing.joiningDate,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, employeeId))
      .returning();

    if (
      input.profileImageFileId !== undefined &&
      existing.profileImageFileId &&
      existing.profileImageFileId !== input.profileImageFileId
    ) {
      await safeDeleteStoredFile(existing.profileImageFileId);
    }

    await logActivity({
      entityType: 'employee',
      entityId: updated.id,
      action:
        input.isActive !== undefined && input.isActive !== existing.isActive
          ? updated.isActive
            ? 'activated'
            : 'deactivated'
          : 'updated',
      title: `Updated employee ${updated.fullName}`,
      details: `${updated.designation} · ${updated.department}`,
      actorName,
      actorUid,
    });

    return serializeEmployee(updated);
  } catch (error: any) {
    console.error('Database update failed in updateEmployee:', error);
    if (error?.code === '23505') {
      throw new Error('An employee with this Employee ID already exists.');
    }
    throw new Error('Unable to update employee.', { cause: error });
  }
}

export async function deleteEmployee(
  employeeId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!existing) return false;

    await db.delete(employees).where(eq(employees.id, employeeId));

    if (existing.profileImageFileId) {
      await safeDeleteStoredFile(existing.profileImageFileId);
    }

    await logActivity({
      entityType: 'employee',
      entityId: employeeId,
      action: 'deleted',
      title: `Removed employee ${existing.fullName}`,
      details: `${existing.employeeCode} · ${existing.department}`,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deleteEmployee:', error);
    throw new Error('Unable to delete employee.', { cause: error });
  }
}

// ============================================================================
// TASKS
// ============================================================================

type SerializedEmployee = ReturnType<typeof serializeEmployee>;

function mapTaskRows(
  taskRows: (typeof tasks.$inferSelect)[],
  assignmentRows: (typeof taskAssignments.$inferSelect)[],
  empMap: Map<string, SerializedEmployee>
) {
  const assignMap = new Map<string, SerializedEmployee[]>();
  for (const a of assignmentRows) {
    const emp = empMap.get(a.employeeId);
    if (!emp) continue;
    const list = assignMap.get(a.taskId) ?? [];
    list.push(emp);
    assignMap.set(a.taskId, list);
  }

  return taskRows.map((t) => {
    const assignedEmployees = assignMap.get(t.id) ?? [];
    return {
      id: t.id,
      taskCode: t.taskCode,
      title: t.title,
      description: t.description,
      category: t.category,
      startDate: t.startDate ?? null,
      dueDate: t.dueDate ?? null,
      priority: t.priority as any,
      instructions: t.instructions,
      attachments: signAttachmentList(t.attachments),
      referenceLinks: Array.isArray(t.referenceLinks) ? t.referenceLinks : [],
      status: t.status as any,
      assignedEmployees,
      assignedEmployeeIds: assignedEmployees.map((e) => e.id),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  });
}

export async function listTasks(preloadedEmpMap?: Map<string, SerializedEmployee>) {
  try {
    const [taskRows, assignmentRows, employeeRows] = await Promise.all([
      db.select().from(tasks).orderBy(desc(tasks.createdAt)),
      db.select().from(taskAssignments),
      preloadedEmpMap ? Promise.resolve(null) : db.select().from(employees),
    ]);

    const empMap =
      preloadedEmpMap ??
      new Map((employeeRows ?? []).map((e) => [e.id, serializeEmployee(e)]));

    return mapTaskRows(taskRows, assignmentRows, empMap);
  } catch (error) {
    console.error('Database query failed in listTasks:', error);
    throw new Error('Unable to load tasks.', { cause: error });
  }
}

export async function getTaskDetail(taskId: string) {
  try {
    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!taskRow) return null;

    const [assignmentRows, employeeRows, updateRows] = await Promise.all([
      db.select().from(taskAssignments).where(eq(taskAssignments.taskId, taskId)),
      db.select().from(employees),
      db
        .select()
        .from(taskUpdates)
        .where(eq(taskUpdates.taskId, taskId))
        .orderBy(desc(taskUpdates.createdAt)),
    ]);

    const empMap = new Map(employeeRows.map((e) => [e.id, serializeEmployee(e)]));
    const assignedEmployees = assignmentRows
      .map((a) => empMap.get(a.employeeId))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    return {
      id: taskRow.id,
      taskCode: taskRow.taskCode,
      title: taskRow.title,
      description: taskRow.description,
      category: taskRow.category,
      startDate: taskRow.startDate ?? null,
      dueDate: taskRow.dueDate ?? null,
      priority: taskRow.priority as any,
      instructions: taskRow.instructions,
      attachments: signAttachmentList(taskRow.attachments),
      referenceLinks: Array.isArray(taskRow.referenceLinks)
        ? taskRow.referenceLinks
        : [],
      status: taskRow.status as any,
      assignedEmployees,
      assignedEmployeeIds: assignedEmployees.map((e) => e.id),
      updates: updateRows.map((u) => ({
        id: u.id,
        taskId: u.taskId,
        employeeId: u.employeeId ?? null,
        authorName: u.authorName,
        authorUid: u.authorUid ?? null,
        updateType: u.updateType,
        comment: u.comment,
        statusChangeTo: u.statusChangeTo ?? null,
        attachments: signAttachmentList(u.attachments),
        createdAt: u.createdAt.toISOString(),
      })),
      createdAt: taskRow.createdAt.toISOString(),
      updatedAt: taskRow.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database query failed in getTaskDetail:', error);
    throw new Error('Unable to load task details.', { cause: error });
  }
}

export async function createTask(
  input: {
    taskCode?: string;
    title: string;
    description?: string;
    category?: string;
    startDate?: string | null;
    dueDate?: string | null;
    priority?: string;
    instructions?: string;
    attachments?: StoredAttachmentRef[];
    referenceLinks?: string[];
    status?: string;
    assignedEmployeeIds?: string[];
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code = input.taskCode?.trim() || (await generateNextCode('TSK', 'tasks'));
    const createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tasks)
        .values({
          taskCode: code,
          title: input.title.trim(),
          description: input.description?.trim() ?? '',
          category: input.category?.trim() || 'General',
          startDate: input.startDate || null,
          dueDate: input.dueDate || null,
          priority: input.priority || 'Medium',
          instructions: input.instructions?.trim() ?? '',
          attachments: input.attachments ?? [],
          referenceLinks: input.referenceLinks ?? [],
          status: input.status || 'Pending',
        })
        .returning();

      const uniqueEmpIds = Array.from(new Set(input.assignedEmployeeIds ?? []));
      if (uniqueEmpIds.length > 0) {
        await tx.insert(taskAssignments).values(
          uniqueEmpIds.map((employeeId) => ({
            taskId: created.id,
            employeeId,
          }))
        );
      }
      return created.id;
    });

    await logActivity({
      entityType: 'task',
      entityId: createdId,
      action: 'created',
      title: `Created task "${input.title.trim()}"`,
      details: `${code} · Priority: ${input.priority || 'Medium'}`,
      actorName,
      actorUid,
    });

    return await getTaskDetail(createdId);
  } catch (error: any) {
    console.error('Database insert failed in createTask:', error);
    if (error?.code === '23505') {
      throw new Error('A task with this Task ID already exists.');
    }
    throw new Error('Unable to create task.', { cause: error });
  }
}

export async function updateTask(
  taskId: string,
  input: {
    taskCode?: string;
    title?: string;
    description?: string;
    category?: string;
    startDate?: string | null;
    dueDate?: string | null;
    priority?: string;
    instructions?: string;
    attachments?: StoredAttachmentRef[];
    referenceLinks?: string[];
    status?: string;
    assignedEmployeeIds?: string[];
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!existing) return null;

    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          taskCode: input.taskCode?.trim() || existing.taskCode,
          title: input.title?.trim() || existing.title,
          description:
            input.description !== undefined
              ? input.description.trim()
              : existing.description,
          category:
            input.category !== undefined
              ? input.category.trim() || 'General'
              : existing.category,
          startDate:
            input.startDate !== undefined ? input.startDate || null : existing.startDate,
          dueDate:
            input.dueDate !== undefined ? input.dueDate || null : existing.dueDate,
          priority: input.priority || existing.priority,
          instructions:
            input.instructions !== undefined
              ? input.instructions.trim()
              : existing.instructions,
          attachments:
            input.attachments !== undefined ? input.attachments : existing.attachments,
          referenceLinks:
            input.referenceLinks !== undefined
              ? input.referenceLinks
              : existing.referenceLinks,
          status: input.status || existing.status,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));

      if (input.assignedEmployeeIds !== undefined) {
        await tx.delete(taskAssignments).where(eq(taskAssignments.taskId, taskId));
        const uniqueEmpIds = Array.from(new Set(input.assignedEmployeeIds));
        if (uniqueEmpIds.length > 0) {
          await tx.insert(taskAssignments).values(
            uniqueEmpIds.map((employeeId) => ({
              taskId,
              employeeId,
            }))
          );
        }
      }
    });

    const statusChanged = input.status && input.status !== existing.status;
    await logActivity({
      entityType: 'task',
      entityId: taskId,
      action: statusChanged ? 'status_changed' : 'updated',
      title: statusChanged
        ? `Task "${input.title?.trim() || existing.title}" moved to ${input.status}`
        : `Updated task "${input.title?.trim() || existing.title}"`,
      details: statusChanged
        ? `Status: ${existing.status} -> ${input.status}`
        : `${existing.taskCode}`,
      actorName,
      actorUid,
    });

    return await getTaskDetail(taskId);
  } catch (error: any) {
    console.error('Database update failed in updateTask:', error);
    if (error?.code === '23505') {
      throw new Error('A task with this Task ID already exists.');
    }
    throw new Error('Unable to update task.', { cause: error });
  }
}

export async function addTaskUpdate(
  taskId: string,
  input: {
    employeeId?: string | null;
    updateType?: string;
    comment: string;
    statusChangeTo?: string | null;
    attachments?: StoredAttachmentRef[];
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!existing) return null;

    await db.transaction(async (tx) => {
      await tx.insert(taskUpdates).values({
        taskId,
        employeeId: input.employeeId || null,
        authorName: actorName,
        authorUid: actorUid ?? null,
        updateType: input.updateType || 'comment',
        comment: input.comment.trim(),
        statusChangeTo: input.statusChangeTo || null,
        attachments: input.attachments ?? [],
      });

      if (input.statusChangeTo && input.statusChangeTo !== existing.status) {
        await tx
          .update(tasks)
          .set({ status: input.statusChangeTo, updatedAt: new Date() })
          .where(eq(tasks.id, taskId));
      } else {
        await tx
          .update(tasks)
          .set({ updatedAt: new Date() })
          .where(eq(tasks.id, taskId));
      }
    });

    await logActivity({
      entityType: 'task',
      entityId: taskId,
      action: input.statusChangeTo ? 'review_update' : 'comment_added',
      title: input.statusChangeTo
        ? `Task "${existing.title}" set to ${input.statusChangeTo}`
        : `Progress update on "${existing.title}"`,
      details: input.comment.trim().slice(0, 140),
      actorName,
      actorUid,
    });

    return await getTaskDetail(taskId);
  } catch (error) {
    console.error('Database insert failed in addTaskUpdate:', error);
    throw new Error('Unable to save task update.', { cause: error });
  }
}

export async function deleteTask(
  taskId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!existing) return false;

    await db.delete(tasks).where(eq(tasks.id, taskId));

    await logActivity({
      entityType: 'task',
      entityId: taskId,
      action: 'deleted',
      title: `Deleted task "${existing.title}"`,
      details: existing.taskCode,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deleteTask:', error);
    throw new Error('Unable to delete task.', { cause: error });
  }
}

// ============================================================================
// POSTERS
// ============================================================================

function mapPosterRows(
  posterRows: (typeof posters.$inferSelect)[],
  empMap: Map<string, SerializedEmployee>
) {
  return posterRows.map((p) => ({
    id: p.id,
    posterCode: p.posterCode,
    title: p.title,
    description: p.description,
    campaignName: p.campaignName,
    imageFileId: p.imageFileId ?? null,
    imageUrl: p.imageFileId
      ? buildSignedFileUrl(p.imageFileId)
      : p.imageUrl ?? null,
    assignedDesignerId: p.assignedDesignerId ?? null,
    assignedWriterId: p.assignedWriterId ?? null,
    assignedDesigner: p.assignedDesignerId
      ? empMap.get(p.assignedDesignerId) ?? null
      : null,
    assignedWriter: p.assignedWriterId
      ? empMap.get(p.assignedWriterId) ?? null
      : null,
    platform: p.platform,
    designDeadline: p.designDeadline ?? null,
    publishingDate: p.publishingDate ?? null,
    publishingTime: p.publishingTime ?? null,
    caption: p.caption,
    hashtags: p.hashtags,
    referenceLinks: Array.isArray(p.referenceLinks) ? p.referenceLinks : [],
    notes: p.notes,
    status: p.status as any,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function listPosters(preloadedEmpMap?: Map<string, SerializedEmployee>) {
  try {
    const [posterRows, employeeRows] = await Promise.all([
      db.select().from(posters).orderBy(desc(posters.createdAt)),
      preloadedEmpMap ? Promise.resolve(null) : db.select().from(employees),
    ]);

    const empMap =
      preloadedEmpMap ??
      new Map((employeeRows ?? []).map((e) => [e.id, serializeEmployee(e)]));

    return mapPosterRows(posterRows, empMap);
  } catch (error) {
    console.error('Database query failed in listPosters:', error);
    throw new Error('Unable to load posters.', { cause: error });
  }
}

export async function createPoster(
  input: {
    posterCode?: string;
    title: string;
    description?: string;
    campaignName?: string;
    imageFileId?: string | null;
    assignedDesignerId?: string | null;
    assignedWriterId?: string | null;
    platform?: string;
    designDeadline?: string | null;
    publishingDate?: string | null;
    publishingTime?: string | null;
    caption?: string;
    hashtags?: string;
    referenceLinks?: string[];
    notes?: string;
    status?: string;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code =
      input.posterCode?.trim() || (await generateNextCode('PST', 'posters'));

    const createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(posters)
        .values({
          posterCode: code,
          title: input.title.trim(),
          description: input.description?.trim() ?? '',
          campaignName: input.campaignName?.trim() ?? '',
          imageFileId: input.imageFileId ?? null,
          imageUrl: input.imageFileId ? `/api/files/${input.imageFileId}` : null,
          assignedDesignerId: input.assignedDesignerId || null,
          assignedWriterId: input.assignedWriterId || null,
          platform: input.platform?.trim() || 'Instagram',
          designDeadline: input.designDeadline || null,
          publishingDate: input.publishingDate || null,
          publishingTime: input.publishingTime || null,
          caption: input.caption?.trim() ?? '',
          hashtags: input.hashtags?.trim() ?? '',
          referenceLinks: input.referenceLinks ?? [],
          notes: input.notes?.trim() ?? '',
          status: input.status || 'Pending',
        })
        .returning();

      const assignments: { posterId: string; employeeId: string; role: string }[] = [];
      if (input.assignedDesignerId) {
        assignments.push({
          posterId: created.id,
          employeeId: input.assignedDesignerId,
          role: 'designer',
        });
      }
      if (input.assignedWriterId) {
        assignments.push({
          posterId: created.id,
          employeeId: input.assignedWriterId,
          role: 'writer',
        });
      }
      if (assignments.length > 0) {
        await tx.insert(posterAssignments).values(assignments);
      }

      return created.id;
    });

    await logActivity({
      entityType: 'poster',
      entityId: createdId,
      action: input.imageFileId ? 'uploaded' : 'created',
      title: `Created poster "${input.title.trim()}"`,
      details: `${code} · ${input.platform || 'Instagram'}`,
      actorName,
      actorUid,
    });

    const all = await listPosters();
    return all.find((p) => p.id === createdId) ?? null;
  } catch (error: any) {
    console.error('Database insert failed in createPoster:', error);
    if (error?.code === '23505') {
      throw new Error('A poster with this Poster ID already exists.');
    }
    throw new Error('Unable to create poster.', { cause: error });
  }
}

export async function updatePoster(
  posterId: string,
  input: Partial<{
    posterCode: string;
    title: string;
    description: string;
    campaignName: string;
    imageFileId: string | null;
    assignedDesignerId: string | null;
    assignedWriterId: string | null;
    platform: string;
    designDeadline: string | null;
    publishingDate: string | null;
    publishingTime: string | null;
    caption: string;
    hashtags: string;
    referenceLinks: string[];
    notes: string;
    status: string;
  }>,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(posters)
      .where(eq(posters.id, posterId))
      .limit(1);
    if (!existing) return null;

    const nextImageFileId =
      input.imageFileId !== undefined ? input.imageFileId : existing.imageFileId;

    await db.transaction(async (tx) => {
      const nextDesignerId =
        input.assignedDesignerId !== undefined
          ? input.assignedDesignerId || null
          : existing.assignedDesignerId;
      const nextWriterId =
        input.assignedWriterId !== undefined
          ? input.assignedWriterId || null
          : existing.assignedWriterId;

      await tx
        .update(posters)
        .set({
          posterCode: input.posterCode?.trim() || existing.posterCode,
          title: input.title?.trim() || existing.title,
          description:
            input.description !== undefined
              ? input.description.trim()
              : existing.description,
          campaignName:
            input.campaignName !== undefined
              ? input.campaignName.trim()
              : existing.campaignName,
          imageFileId: nextImageFileId,
          imageUrl: nextImageFileId ? `/api/files/${nextImageFileId}` : null,
          assignedDesignerId: nextDesignerId,
          assignedWriterId: nextWriterId,
          platform: input.platform?.trim() || existing.platform,
          designDeadline:
            input.designDeadline !== undefined
              ? input.designDeadline || null
              : existing.designDeadline,
          publishingDate:
            input.publishingDate !== undefined
              ? input.publishingDate || null
              : existing.publishingDate,
          publishingTime:
            input.publishingTime !== undefined
              ? input.publishingTime || null
              : existing.publishingTime,
          caption:
            input.caption !== undefined ? input.caption.trim() : existing.caption,
          hashtags:
            input.hashtags !== undefined ? input.hashtags.trim() : existing.hashtags,
          referenceLinks:
            input.referenceLinks !== undefined
              ? input.referenceLinks
              : existing.referenceLinks,
          notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
          status: input.status || existing.status,
          updatedAt: new Date(),
        })
        .where(eq(posters.id, posterId));

      if (
        input.assignedDesignerId !== undefined ||
        input.assignedWriterId !== undefined
      ) {
        await tx
          .delete(posterAssignments)
          .where(eq(posterAssignments.posterId, posterId));
        const assignments: { posterId: string; employeeId: string; role: string }[] = [];
        if (nextDesignerId) {
          assignments.push({
            posterId,
            employeeId: nextDesignerId,
            role: 'designer',
          });
        }
        if (nextWriterId) {
          assignments.push({
            posterId,
            employeeId: nextWriterId,
            role: 'writer',
          });
        }
        if (assignments.length > 0) {
          await tx.insert(posterAssignments).values(assignments);
        }
      }
    });

    if (
      input.imageFileId !== undefined &&
      existing.imageFileId &&
      existing.imageFileId !== input.imageFileId
    ) {
      await safeDeleteStoredFile(existing.imageFileId);
    }

    const statusChanged = input.status && input.status !== existing.status;
    await logActivity({
      entityType: 'poster',
      entityId: posterId,
      action: statusChanged ? 'status_changed' : 'updated',
      title: statusChanged
        ? `Poster "${input.title?.trim() || existing.title}" moved to ${input.status}`
        : `Updated poster "${input.title?.trim() || existing.title}"`,
      details: statusChanged
        ? `Status: ${existing.status} -> ${input.status}`
        : existing.posterCode,
      actorName,
      actorUid,
    });

    const all = await listPosters();
    return all.find((p) => p.id === posterId) ?? null;
  } catch (error: any) {
    console.error('Database update failed in updatePoster:', error);
    if (error?.code === '23505') {
      throw new Error('A poster with this Poster ID already exists.');
    }
    throw new Error('Unable to update poster.', { cause: error });
  }
}

export async function deletePoster(
  posterId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(posters)
      .where(eq(posters.id, posterId))
      .limit(1);
    if (!existing) return false;

    await db.delete(posters).where(eq(posters.id, posterId));

    if (existing.imageFileId) {
      await safeDeleteStoredFile(existing.imageFileId);
    }

    await logActivity({
      entityType: 'poster',
      entityId: posterId,
      action: 'deleted',
      title: `Deleted poster "${existing.title}"`,
      details: existing.posterCode,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deletePoster:', error);
    throw new Error('Unable to delete poster.', { cause: error });
  }
}

// ============================================================================
// REELS
// ============================================================================

function mapReelRows(
  reelRows: (typeof reels.$inferSelect)[],
  empMap: Map<string, SerializedEmployee>
) {
  return reelRows.map((r) => ({
    id: r.id,
    reelCode: r.reelCode,
    title: r.title,
    description: r.description,
    campaignName: r.campaignName,
    referenceVideoFileId: r.referenceVideoFileId ?? null,
    referenceVideoUrl: r.referenceVideoFileId
      ? buildSignedFileUrl(r.referenceVideoFileId)
      : r.referenceVideoUrl ?? null,
    referenceVideoLink: r.referenceVideoLink,
    finalVideoFileId: r.finalVideoFileId ?? null,
    finalVideoUrl: r.finalVideoFileId
      ? buildSignedFileUrl(r.finalVideoFileId)
      : r.finalVideoUrl ?? null,
    assignedEditorId: r.assignedEditorId ?? null,
    assignedCreatorId: r.assignedCreatorId ?? null,
    assignedEditor: r.assignedEditorId
      ? empMap.get(r.assignedEditorId) ?? null
      : null,
    assignedCreator: r.assignedCreatorId
      ? empMap.get(r.assignedCreatorId) ?? null
      : null,
    platform: r.platform,
    editingDeadline: r.editingDeadline ?? null,
    publishingDate: r.publishingDate ?? null,
    publishingTime: r.publishingTime ?? null,
    script: r.script,
    caption: r.caption,
    hashtags: r.hashtags,
    referenceLinks: Array.isArray(r.referenceLinks) ? r.referenceLinks : [],
    notes: r.notes,
    status: r.status as any,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function listReels(preloadedEmpMap?: Map<string, SerializedEmployee>) {
  try {
    const [reelRows, employeeRows] = await Promise.all([
      db.select().from(reels).orderBy(desc(reels.createdAt)),
      preloadedEmpMap ? Promise.resolve(null) : db.select().from(employees),
    ]);

    const empMap =
      preloadedEmpMap ??
      new Map((employeeRows ?? []).map((e) => [e.id, serializeEmployee(e)]));

    return mapReelRows(reelRows, empMap);
  } catch (error) {
    console.error('Database query failed in listReels:', error);
    throw new Error('Unable to load reels.', { cause: error });
  }
}

export async function createReel(
  input: {
    reelCode?: string;
    title: string;
    description?: string;
    campaignName?: string;
    referenceVideoFileId?: string | null;
    referenceVideoLink?: string;
    finalVideoFileId?: string | null;
    assignedEditorId?: string | null;
    assignedCreatorId?: string | null;
    platform?: string;
    editingDeadline?: string | null;
    publishingDate?: string | null;
    publishingTime?: string | null;
    script?: string;
    caption?: string;
    hashtags?: string;
    referenceLinks?: string[];
    notes?: string;
    status?: string;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code = input.reelCode?.trim() || (await generateNextCode('REL', 'reels'));

    const createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(reels)
        .values({
          reelCode: code,
          title: input.title.trim(),
          description: input.description?.trim() ?? '',
          campaignName: input.campaignName?.trim() ?? '',
          referenceVideoFileId: input.referenceVideoFileId ?? null,
          referenceVideoUrl: input.referenceVideoFileId
            ? `/api/files/${input.referenceVideoFileId}`
            : null,
          referenceVideoLink: input.referenceVideoLink?.trim() ?? '',
          finalVideoFileId: input.finalVideoFileId ?? null,
          finalVideoUrl: input.finalVideoFileId
            ? `/api/files/${input.finalVideoFileId}`
            : null,
          assignedEditorId: input.assignedEditorId || null,
          assignedCreatorId: input.assignedCreatorId || null,
          platform: input.platform?.trim() || 'Instagram Reels',
          editingDeadline: input.editingDeadline || null,
          publishingDate: input.publishingDate || null,
          publishingTime: input.publishingTime || null,
          script: input.script?.trim() ?? '',
          caption: input.caption?.trim() ?? '',
          hashtags: input.hashtags?.trim() ?? '',
          referenceLinks: input.referenceLinks ?? [],
          notes: input.notes?.trim() ?? '',
          status: input.status || 'Pending',
        })
        .returning();

      const assignments: { reelId: string; employeeId: string; role: string }[] = [];
      if (input.assignedEditorId) {
        assignments.push({
          reelId: created.id,
          employeeId: input.assignedEditorId,
          role: 'editor',
        });
      }
      if (input.assignedCreatorId) {
        assignments.push({
          reelId: created.id,
          employeeId: input.assignedCreatorId,
          role: 'creator',
        });
      }
      if (assignments.length > 0) {
        await tx.insert(reelAssignments).values(assignments);
      }

      return created.id;
    });

    await logActivity({
      entityType: 'reel',
      entityId: createdId,
      action:
        input.finalVideoFileId || input.referenceVideoFileId ? 'uploaded' : 'created',
      title: `Created reel "${input.title.trim()}"`,
      details: `${code} · ${input.platform || 'Instagram Reels'}`,
      actorName,
      actorUid,
    });

    const all = await listReels();
    return all.find((r) => r.id === createdId) ?? null;
  } catch (error: any) {
    console.error('Database insert failed in createReel:', error);
    if (error?.code === '23505') {
      throw new Error('A reel with this Reel ID already exists.');
    }
    throw new Error('Unable to create reel.', { cause: error });
  }
}

export async function updateReel(
  reelId: string,
  input: Partial<{
    reelCode: string;
    title: string;
    description: string;
    campaignName: string;
    referenceVideoFileId: string | null;
    referenceVideoLink: string;
    finalVideoFileId: string | null;
    assignedEditorId: string | null;
    assignedCreatorId: string | null;
    platform: string;
    editingDeadline: string | null;
    publishingDate: string | null;
    publishingTime: string | null;
    script: string;
    caption: string;
    hashtags: string;
    referenceLinks: string[];
    notes: string;
    status: string;
  }>,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(reels)
      .where(eq(reels.id, reelId))
      .limit(1);
    if (!existing) return null;

    const nextRefVideoId =
      input.referenceVideoFileId !== undefined
        ? input.referenceVideoFileId
        : existing.referenceVideoFileId;
    const nextFinalVideoId =
      input.finalVideoFileId !== undefined
        ? input.finalVideoFileId
        : existing.finalVideoFileId;

    await db.transaction(async (tx) => {
      const nextEditorId =
        input.assignedEditorId !== undefined
          ? input.assignedEditorId || null
          : existing.assignedEditorId;
      const nextCreatorId =
        input.assignedCreatorId !== undefined
          ? input.assignedCreatorId || null
          : existing.assignedCreatorId;

      await tx
        .update(reels)
        .set({
          reelCode: input.reelCode?.trim() || existing.reelCode,
          title: input.title?.trim() || existing.title,
          description:
            input.description !== undefined
              ? input.description.trim()
              : existing.description,
          campaignName:
            input.campaignName !== undefined
              ? input.campaignName.trim()
              : existing.campaignName,
          referenceVideoFileId: nextRefVideoId,
          referenceVideoUrl: nextRefVideoId ? `/api/files/${nextRefVideoId}` : null,
          referenceVideoLink:
            input.referenceVideoLink !== undefined
              ? input.referenceVideoLink.trim()
              : existing.referenceVideoLink,
          finalVideoFileId: nextFinalVideoId,
          finalVideoUrl: nextFinalVideoId ? `/api/files/${nextFinalVideoId}` : null,
          assignedEditorId: nextEditorId,
          assignedCreatorId: nextCreatorId,
          platform: input.platform?.trim() || existing.platform,
          editingDeadline:
            input.editingDeadline !== undefined
              ? input.editingDeadline || null
              : existing.editingDeadline,
          publishingDate:
            input.publishingDate !== undefined
              ? input.publishingDate || null
              : existing.publishingDate,
          publishingTime:
            input.publishingTime !== undefined
              ? input.publishingTime || null
              : existing.publishingTime,
          script:
            input.script !== undefined ? input.script.trim() : existing.script,
          caption:
            input.caption !== undefined ? input.caption.trim() : existing.caption,
          hashtags:
            input.hashtags !== undefined ? input.hashtags.trim() : existing.hashtags,
          referenceLinks:
            input.referenceLinks !== undefined
              ? input.referenceLinks
              : existing.referenceLinks,
          notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
          status: input.status || existing.status,
          updatedAt: new Date(),
        })
        .where(eq(reels.id, reelId));

      if (
        input.assignedEditorId !== undefined ||
        input.assignedCreatorId !== undefined
      ) {
        await tx.delete(reelAssignments).where(eq(reelAssignments.reelId, reelId));
        const assignments: { reelId: string; employeeId: string; role: string }[] = [];
        if (nextEditorId) {
          assignments.push({
            reelId,
            employeeId: nextEditorId,
            role: 'editor',
          });
        }
        if (nextCreatorId) {
          assignments.push({
            reelId,
            employeeId: nextCreatorId,
            role: 'creator',
          });
        }
        if (assignments.length > 0) {
          await tx.insert(reelAssignments).values(assignments);
        }
      }
    });

    if (
      input.referenceVideoFileId !== undefined &&
      existing.referenceVideoFileId &&
      existing.referenceVideoFileId !== input.referenceVideoFileId
    ) {
      await safeDeleteStoredFile(existing.referenceVideoFileId);
    }

    if (
      input.finalVideoFileId !== undefined &&
      existing.finalVideoFileId &&
      existing.finalVideoFileId !== input.finalVideoFileId
    ) {
      await safeDeleteStoredFile(existing.finalVideoFileId);
    }

    const statusChanged = input.status && input.status !== existing.status;
    await logActivity({
      entityType: 'reel',
      entityId: reelId,
      action: statusChanged ? 'status_changed' : 'updated',
      title: statusChanged
        ? `Reel "${input.title?.trim() || existing.title}" moved to ${input.status}`
        : `Updated reel "${input.title?.trim() || existing.title}"`,
      details: statusChanged
        ? `Status: ${existing.status} -> ${input.status}`
        : existing.reelCode,
      actorName,
      actorUid,
    });

    const all = await listReels();
    return all.find((r) => r.id === reelId) ?? null;
  } catch (error: any) {
    console.error('Database update failed in updateReel:', error);
    if (error?.code === '23505') {
      throw new Error('A reel with this Reel ID already exists.');
    }
    throw new Error('Unable to update reel.', { cause: error });
  }
}

export async function deleteReel(
  reelId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(reels)
      .where(eq(reels.id, reelId))
      .limit(1);
    if (!existing) return false;

    await db.delete(reels).where(eq(reels.id, reelId));

    if (existing.referenceVideoFileId) {
      await safeDeleteStoredFile(existing.referenceVideoFileId);
    }
    if (existing.finalVideoFileId) {
      await safeDeleteStoredFile(existing.finalVideoFileId);
    }

    await logActivity({
      entityType: 'reel',
      entityId: reelId,
      action: 'deleted',
      title: `Deleted reel "${existing.title}"`,
      details: existing.reelCode,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deleteReel:', error);
    throw new Error('Unable to delete reel.', { cause: error });
  }
}

// ============================================================================
// DASHBOARD & CALENDAR (DERIVED FROM REAL RECORDS)
// ============================================================================

function buildDashboardSummaryFromLists(params: {
  todayStr: string;
  allEmployees: SerializedEmployee[];
  allTasks: ReturnType<typeof mapTaskRows>;
  allPosters: ReturnType<typeof mapPosterRows>;
  allReels: ReturnType<typeof mapReelRows>;
  recentActivityRows: (typeof activityLogs.$inferSelect)[];
}) {
  const {
    todayStr,
    allEmployees,
    allTasks,
    allPosters,
    allReels,
    recentActivityRows,
  } = params;

  const kpis = {
    totalEmployees: allEmployees.length,
    totalTasks: allTasks.length,
    pendingTasks: allTasks.filter((t) => t.status === 'Pending').length,
    inProgressTasks: allTasks.filter((t) => t.status === 'In Progress').length,
    underReviewTasks: allTasks.filter((t) => t.status === 'Under Review').length,
    completedTasks: allTasks.filter((t) => t.status === 'Completed').length,
    overdueTasks: allTasks.filter(
      (t) =>
        t.dueDate &&
        t.dueDate < todayStr &&
        t.status !== 'Completed' &&
        t.status !== 'Cancelled'
    ).length,
    totalPosters: allPosters.length,
    totalReels: allReels.length,
  };

  const todaysWork = allTasks.filter(
    (t) =>
      t.dueDate === todayStr &&
      t.status !== 'Completed' &&
      t.status !== 'Cancelled'
  );

  const upcomingDeadlines: any[] = [];
  for (const t of allTasks) {
    if (
      t.dueDate &&
      t.dueDate >= todayStr &&
      t.status !== 'Completed' &&
      t.status !== 'Cancelled'
    ) {
      upcomingDeadlines.push({
        id: t.id,
        entityType: 'task',
        code: t.taskCode,
        title: t.title,
        deadlineDate: t.dueDate,
        deadlineKind: 'Task Due',
        status: t.status,
        assigneeNames: t.assignedEmployees.map((e) => e.fullName),
      });
    }
  }
  for (const p of allPosters) {
    if (
      p.designDeadline &&
      p.designDeadline >= todayStr &&
      p.status !== 'Published' &&
      p.status !== 'Approved'
    ) {
      upcomingDeadlines.push({
        id: p.id,
        entityType: 'poster',
        code: p.posterCode,
        title: p.title,
        deadlineDate: p.designDeadline,
        deadlineKind: 'Poster Design',
        status: p.status,
        assigneeNames: [
          p.assignedDesigner?.fullName,
          p.assignedWriter?.fullName,
        ].filter(Boolean) as string[],
      });
    }
  }
  for (const r of allReels) {
    if (
      r.editingDeadline &&
      r.editingDeadline >= todayStr &&
      r.status !== 'Published' &&
      r.status !== 'Approved'
    ) {
      upcomingDeadlines.push({
        id: r.id,
        entityType: 'reel',
        code: r.reelCode,
        title: r.title,
        deadlineDate: r.editingDeadline,
        deadlineKind: 'Reel Editing',
        status: r.status,
        assigneeNames: [
          r.assignedEditor?.fullName,
          r.assignedCreator?.fullName,
        ].filter(Boolean) as string[],
      });
    }
  }
  upcomingDeadlines.sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate));

  const upcomingPublishing: any[] = [];
  for (const p of allPosters) {
    if (
      p.publishingDate &&
      p.publishingDate >= todayStr &&
      p.status !== 'Published'
    ) {
      upcomingPublishing.push({
        id: p.id,
        entityType: 'poster',
        code: p.posterCode,
        title: p.title,
        platform: p.platform,
        publishingDate: p.publishingDate,
        publishingTime: p.publishingTime,
        status: p.status,
        thumbnailUrl: p.imageUrl,
      });
    }
  }
  for (const r of allReels) {
    if (
      r.publishingDate &&
      r.publishingDate >= todayStr &&
      r.status !== 'Published'
    ) {
      upcomingPublishing.push({
        id: r.id,
        entityType: 'reel',
        code: r.reelCode,
        title: r.title,
        platform: r.platform,
        publishingDate: r.publishingDate,
        publishingTime: r.publishingTime,
        status: r.status,
        thumbnailUrl: null,
      });
    }
  }
  upcomingPublishing.sort((a, b) => {
    const dateCmp = a.publishingDate.localeCompare(b.publishingDate);
    if (dateCmp !== 0) return dateCmp;
    return (a.publishingTime || '99:99').localeCompare(b.publishingTime || '99:99');
  });

  // Index task counts per employee in O(tasks) instead of nested O(employees * tasks)
  const empTaskStats = new Map<
    string,
    { assigned: number; completed: number; pending: number }
  >();
  for (const t of allTasks) {
    const isCompleted = t.status === 'Completed';
    const isPending = t.status !== 'Completed' && t.status !== 'Cancelled';
    for (const empId of t.assignedEmployeeIds) {
      const curr = empTaskStats.get(empId) ?? {
        assigned: 0,
        completed: 0,
        pending: 0,
      };
      curr.assigned += 1;
      if (isCompleted) curr.completed += 1;
      if (isPending) curr.pending += 1;
      empTaskStats.set(empId, curr);
    }
  }

  const employeeOverview = allEmployees.map((emp) => {
    const counts = empTaskStats.get(emp.id) ?? {
      assigned: 0,
      completed: 0,
      pending: 0,
    };
    return {
      id: emp.id,
      employeeCode: emp.employeeCode,
      fullName: emp.fullName,
      department: emp.department,
      designation: emp.designation,
      profileImageUrl: emp.profileImageUrl,
      isActive: emp.isActive,
      assignedTasks: counts.assigned,
      completedTasks: counts.completed,
      pendingTasks: counts.pending,
    };
  });

  return {
    kpis,
    todaysWork,
    upcomingDeadlines: upcomingDeadlines.slice(0, 10),
    recentActivities: recentActivityRows.map((a) => ({
      ...a,
      entityType: a.entityType as any,
      createdAt: a.createdAt.toISOString(),
    })),
    upcomingPublishing: upcomingPublishing.slice(0, 10),
    employeeOverview,
  };
}

function buildCalendarEventsFromRows(params: {
  taskRows: { id: string; title: string; dueDate: string | null; status: string }[];
  posterRows: {
    id: string;
    title: string;
    designDeadline: string | null;
    publishingDate: string | null;
    publishingTime: string | null;
    status: string;
    platform: string;
  }[];
  reelRows: {
    id: string;
    title: string;
    editingDeadline: string | null;
    publishingDate: string | null;
    publishingTime: string | null;
    status: string;
    platform: string;
  }[];
}) {
  const events: any[] = [];

  for (const t of params.taskRows) {
    if (t.dueDate) {
      events.push({
        id: `task-${t.id}`,
        sourceId: t.id,
        entityType: 'task',
        eventType: 'task_deadline',
        label: 'Task Deadline',
        title: t.title,
        date: t.dueDate,
        time: null,
        status: t.status,
      });
    }
  }

  for (const p of params.posterRows) {
    if (p.designDeadline) {
      events.push({
        id: `poster-design-${p.id}`,
        sourceId: p.id,
        entityType: 'poster',
        eventType: 'poster_design_deadline',
        label: 'Poster Design Deadline',
        title: p.title,
        date: p.designDeadline,
        time: null,
        status: p.status,
        platform: p.platform,
      });
    }
    if (p.publishingDate) {
      events.push({
        id: `poster-pub-${p.id}`,
        sourceId: p.id,
        entityType: 'poster',
        eventType: 'poster_publishing',
        label: 'Poster Publishing',
        title: p.title,
        date: p.publishingDate,
        time: p.publishingTime,
        status: p.status,
        platform: p.platform,
      });
    }
  }

  for (const r of params.reelRows) {
    if (r.editingDeadline) {
      events.push({
        id: `reel-edit-${r.id}`,
        sourceId: r.id,
        entityType: 'reel',
        eventType: 'reel_editing_deadline',
        label: 'Reel Editing Deadline',
        title: r.title,
        date: r.editingDeadline,
        time: null,
        status: r.status,
        platform: r.platform,
      });
    }
    if (r.publishingDate) {
      events.push({
        id: `reel-pub-${r.id}`,
        sourceId: r.id,
        entityType: 'reel',
        eventType: 'reel_publishing',
        label: 'Reel Publishing',
        title: r.title,
        date: r.publishingDate,
        time: r.publishingTime,
        status: r.status,
        platform: r.platform,
      });
    }
  }

  return events;
}

export async function getDashboardSummary(todayStr: string) {
  try {
    // Fetch each underlying table once (instead of scanning employees 4 times)
    const [
      employeeRows,
      taskRows,
      assignmentRows,
      posterRows,
      reelRows,
      recentActivityRows,
    ] = await Promise.all([
      db.select().from(employees).orderBy(desc(employees.createdAt)),
      db.select().from(tasks).orderBy(desc(tasks.createdAt)),
      db.select().from(taskAssignments),
      db.select().from(posters).orderBy(desc(posters.createdAt)),
      db.select().from(reels).orderBy(desc(reels.createdAt)),
      db
        .select()
        .from(activityLogs)
        .orderBy(desc(activityLogs.createdAt))
        .limit(15),
    ]);

    const allEmployees = employeeRows.map(serializeEmployee);
    const empMap = new Map(allEmployees.map((e) => [e.id, e]));
    const allTasks = mapTaskRows(taskRows, assignmentRows, empMap);
    const allPosters = mapPosterRows(posterRows, empMap);
    const allReels = mapReelRows(reelRows, empMap);

    return buildDashboardSummaryFromLists({
      todayStr,
      allEmployees,
      allTasks,
      allPosters,
      allReels,
      recentActivityRows,
    });
  } catch (error) {
    console.error('Database query failed in getDashboardSummary:', error);
    throw new Error('Unable to load dashboard summary.', { cause: error });
  }
}

export async function getCalendarEvents() {
  try {
    // Fetch only required calendar columns without scanning employees or large JSONB/text payloads
    const [taskRows, posterRows, reelRows] = await Promise.all([
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          dueDate: tasks.dueDate,
          status: tasks.status,
        })
        .from(tasks),
      db
        .select({
          id: posters.id,
          title: posters.title,
          designDeadline: posters.designDeadline,
          publishingDate: posters.publishingDate,
          publishingTime: posters.publishingTime,
          status: posters.status,
          platform: posters.platform,
        })
        .from(posters),
      db
        .select({
          id: reels.id,
          title: reels.title,
          editingDeadline: reels.editingDeadline,
          publishingDate: reels.publishingDate,
          publishingTime: reels.publishingTime,
          status: reels.status,
          platform: reels.platform,
        })
        .from(reels),
    ]);

    return buildCalendarEventsFromRows({ taskRows, posterRows, reelRows });
  } catch (error) {
    console.error('Database query failed in getCalendarEvents:', error);
    throw new Error('Unable to load calendar events.', { cause: error });
  }
}

/**
 * Consolidated single-round-trip workspace loader used by GET /api/workspace.
 * Fetches each table once instead of 6 parallel HTTP requests triggering 30+ queries.
 */
export async function getWorkspaceData(todayStr: string) {
  try {
    const [
      employeeRows,
      taskRows,
      assignmentRows,
      posterRows,
      reelRows,
      recentActivityRows,
    ] = await Promise.all([
      db.select().from(employees).orderBy(desc(employees.createdAt)),
      db.select().from(tasks).orderBy(desc(tasks.createdAt)),
      db.select().from(taskAssignments),
      db.select().from(posters).orderBy(desc(posters.createdAt)),
      db.select().from(reels).orderBy(desc(reels.createdAt)),
      db
        .select()
        .from(activityLogs)
        .orderBy(desc(activityLogs.createdAt))
        .limit(15),
    ]);

    const allEmployees = employeeRows.map(serializeEmployee);
    const empMap = new Map(allEmployees.map((e) => [e.id, e]));
    const allTasks = mapTaskRows(taskRows, assignmentRows, empMap);
    const allPosters = mapPosterRows(posterRows, empMap);
    const allReels = mapReelRows(reelRows, empMap);

    const summary = buildDashboardSummaryFromLists({
      todayStr,
      allEmployees,
      allTasks,
      allPosters,
      allReels,
      recentActivityRows,
    });
    const calendarEvents = buildCalendarEventsFromRows({
      taskRows,
      posterRows,
      reelRows,
    });

    return {
      summary,
      employees: allEmployees,
      tasks: allTasks,
      posters: allPosters,
      reels: allReels,
      calendarEvents,
    };
  } catch (error) {
    console.error('Database query failed in getWorkspaceData:', error);
    throw new Error('Unable to load workspace data.', { cause: error });
  }
}
