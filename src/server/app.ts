import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  addTaskUpdate,
  claimCompanyAccessCodeHash,
  createAppSession,
  createChunkedFilePlaceholder,
  createEmployee,
  createPoster,
  createReel,
  createTask,
  deleteAppSessionByTokenHash,
  deleteEmployee,
  deleteIncompleteStoredFile,
  deletePoster,
  deleteReel,
  deleteTask,
  finalizeChunkedFile,
  getCalendarEvents,
  getCompanyAccessConfig,
  getCompanySettings,
  getDashboardSummary,
  getEmployeeDetail,
  getStoredFileMeta,
  getTaskDetail,
  listEmployees,
  listPosters,
  listReels,
  listTasks,
  readStoredFileRange,
  saveStoredFile,
  updateCompanySettings,
  updateEmployee,
  updatePoster,
  updateReel,
  updateTask,
  upsertStoredFileChunk,
} from '../db/queries.ts';
import {
  AuthRequest,
  clearPersistentSessionCookie,
  generateSessionToken,
  getSessionFromRequest,
  hashAccessCode,
  hashSessionToken,
  requireAuth,
  SESSION_MAX_AGE_SECONDS,
  setPersistentSessionCookie,
  verifyAccessCodeAgainstHash,
  verifyConstantTimePlaintext,
  verifyFileAccessToken,
  verifySameOriginMutation,
} from '../middleware/auth.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_BUCKETS = new Set([
  'employee-images',
  'task-attachments',
  'poster-images',
  'reel-videos',
  'company-assets',
]);

const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'video/ogg',
  'video/mpeg',
]);

const ATTACHMENT_MIMES = new Set([
  ...IMAGE_MIMES,
  ...VIDEO_MIMES,
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

// Keep single HTTP slice <= 3 MB so video streaming and chunked downloads stay under Vercel's 4.5 MB Hobby ceiling
const MAX_HTTP_SLICE_BYTES = 3 * 1024 * 1024;
const MAX_CHUNK_UPLOAD_BYTES = 4 * 1024 * 1024;

function getTodayString(queryToday: unknown): string {
  if (typeof queryToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(queryToday)) {
    return queryToday;
  }
  return new Date().toISOString().slice(0, 10);
}

function validateUploadSpec(bucket: string, mime: string, size: number): string | null {
  if (!ALLOWED_BUCKETS.has(bucket)) {
    return 'Invalid storage bucket specified.';
  }
  if (
    bucket === 'employee-images' ||
    bucket === 'poster-images' ||
    bucket === 'company-assets'
  ) {
    if (!IMAGE_MIMES.has(mime)) {
      return 'Please upload a valid image file (PNG, JPG, WEBP, GIF, or SVG).';
    }
    if (size > 10 * 1024 * 1024) {
      return 'Image size must be 10 MB or smaller.';
    }
  } else if (bucket === 'reel-videos') {
    if (!VIDEO_MIMES.has(mime)) {
      return 'Please upload a valid video file (MP4, WebM, MOV, M4V, or OGG).';
    }
    if (size > 50 * 1024 * 1024) {
      return 'Video size must be 50 MB or smaller.';
    }
  } else if (bucket === 'task-attachments') {
    if (!ATTACHMENT_MIMES.has(mime)) {
      return 'Unsupported attachment format.';
    }
    if (size > 20 * 1024 * 1024) {
      return 'Attachment size must be 20 MB or smaller.';
    }
  }
  return null;
}

const singleUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CHUNK_UPLOAD_BYTES,
  },
});

// Light per-IP rate limiter for Company Access Code attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(req: Request): boolean {
  const ip = String(
    req.headers['x-forwarded-for'] || req.ip || 'unknown'
  )
    .split(',')[0]
    .trim();
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 20) {
    return false;
  }
  entry.count += 1;
  return true;
}

function clearLoginRateLimit(req: Request) {
  const ip = String(
    req.headers['x-forwarded-for'] || req.ip || 'unknown'
  )
    .split(',')[0]
    .trim();
  loginAttempts.delete(ip);
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  // Public health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Public branding settings (returns logo URL for access-code screen & favicon)
  app.get('/api/settings', async (_req, res) => {
    try {
      const settings = await getCompanySettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load company settings.' });
    }
  });

  // ============================================================================
  // COMPANY ACCESS CODE AUTHENTICATION (PERSISTENT 30-DAY HTTPONLY COOKIE)
  // ============================================================================

  app.get('/api/auth/session', async (req: Request, res: Response) => {
    try {
      res.setHeader('Cache-Control', 'no-store, private');
      const envCode = process.env.COMPANY_ACCESS_CODE?.trim() || '';
      const config = await getCompanyAccessConfig();
      const needsSetup = !envCode && !config.accessCodeHash;

      const resolved = await getSessionFromRequest(req);
      if (resolved && resolved.session) {
        return res.json({
          authenticated: true,
          needsSetup: false,
          label: resolved.session.label || 'Company Workspace',
          expiresAt: resolved.session.expiresAt.toISOString(),
        });
      }

      return res.json({
        authenticated: false,
        needsSetup,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to check session status.' });
    }
  });

  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    try {
      if (!verifySameOriginMutation(req)) {
        return res.status(403).json({ error: 'Blocked cross-origin request.' });
      }
      if (!checkLoginRateLimit(req)) {
        return res.status(429).json({
          error: 'Too many attempts. Please wait a few minutes and try again.',
        });
      }

      const envCode = process.env.COMPANY_ACCESS_CODE?.trim() || '';
      if (envCode) {
        return res.status(409).json({
          error: 'Company Access Code is already configured via server environment.',
        });
      }

      const code =
        typeof req.body?.accessCode === 'string' ? req.body.accessCode.trim() : '';
      if (code.length < 4 || code.length > 128) {
        return res.status(400).json({
          error: 'Company Access Code must be between 4 and 128 characters.',
        });
      }

      const hashed = hashAccessCode(code);
      const claimed = await claimCompanyAccessCodeHash(hashed);
      if (!claimed) {
        return res.status(409).json({
          error: 'Company Access Code has already been set up. Please sign in with it.',
        });
      }

      clearLoginRateLimit(req);
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
      const session = await createAppSession({
        tokenHash,
        label: 'Company Workspace',
        expiresAt,
      });

      setPersistentSessionCookie(req, res, rawToken);
      res.status(201).json({
        authenticated: true,
        needsSetup: false,
        label: session.label,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to set Company Access Code.' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      if (!verifySameOriginMutation(req)) {
        return res.status(403).json({ error: 'Blocked cross-origin request.' });
      }
      if (!checkLoginRateLimit(req)) {
        return res.status(429).json({
          error: 'Too many invalid attempts. Please wait a few minutes and try again.',
        });
      }

      const code =
        typeof req.body?.accessCode === 'string' ? req.body.accessCode.trim() : '';
      if (!code) {
        return res.status(400).json({ error: 'Please enter the Company Access Code.' });
      }

      const envCode = process.env.COMPANY_ACCESS_CODE?.trim() || '';
      let valid = false;

      if (envCode) {
        valid = verifyConstantTimePlaintext(code, envCode);
      } else {
        const config = await getCompanyAccessConfig();
        if (!config.accessCodeHash) {
          return res.status(409).json({
            error: 'No Company Access Code configured yet. Please set one first.',
            needsSetup: true,
          });
        }
        valid = verifyAccessCodeAgainstHash(code, config.accessCodeHash);
      }

      if (!valid) {
        return res.status(401).json({ error: 'Invalid Company Access Code.' });
      }

      clearLoginRateLimit(req);
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
      const session = await createAppSession({
        tokenHash,
        label: 'Company Workspace',
        expiresAt,
      });

      setPersistentSessionCookie(req, res, rawToken);
      res.json({
        authenticated: true,
        needsSetup: false,
        label: session.label,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to verify Company Access Code.' });
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      if (!verifySameOriginMutation(req)) {
        return res.status(403).json({ error: 'Blocked cross-origin request.' });
      }
      const resolved = await getSessionFromRequest(req);
      if (resolved?.tokenHash) {
        await deleteAppSessionByTokenHash(resolved.tokenHash).catch(() => {});
      }
      clearPersistentSessionCookie(req, res);
      res.json({ authenticated: false });
    } catch (error: any) {
      clearPersistentSessionCookie(req, res);
      res.status(500).json({ error: error.message || 'Failed to log out.' });
    }
  });

  // Update company branding / logo (Authenticated)
  app.put('/api/settings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { companyName, logoFileId } = req.body ?? {};
      if (
        logoFileId !== undefined &&
        logoFileId !== null &&
        !UUID_RE.test(logoFileId)
      ) {
        return res.status(400).json({ error: 'Invalid logo file reference.' });
      }
      const updated = await updateCompanySettings({
        companyName: typeof companyName === 'string' ? companyName : undefined,
        logoFileId: logoFileId === undefined ? undefined : logoFileId,
        actorName: req.actorName || 'Company Member',
        actorUid: req.actorUid,
      });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to update settings.' });
    }
  });

  // ============================================================================
  // FILE UPLOAD & SERVING (SINGLE-REQUEST + FREE-TIER CHUNKED UPLOAD)
  // ============================================================================

  // Single-request upload (used for <= 2.5 MB files and small assets)
  app.post(
    '/api/upload',
    requireAuth,
    (req: AuthRequest, res: Response, next: NextFunction) => {
      singleUpload.single('file')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res
              .status(413)
              .json({ error: 'File exceeds the maximum allowed size of 50 MB.' });
          }
          return res.status(400).json({ error: err.message || 'File upload failed.' });
        }
        next();
      });
    },
    async (req: AuthRequest, res: Response) => {
      try {
        const bucket = String(req.body?.bucket || '').trim();
        if (!req.file) {
          return res.status(400).json({ error: 'No file provided.' });
        }

        const mime = req.file.mimetype || 'application/octet-stream';
        const size = req.file.size;
        const validationError = validateUploadSpec(bucket, mime, size);
        if (validationError) {
          return res
            .status(validationError.includes('size') ? 413 : 400)
            .json({ error: validationError });
        }

        const saved = await saveStoredFile({
          bucket,
          originalName: req.file.originalname || 'file',
          mimeType: mime,
          sizeBytes: size,
          data: req.file.buffer,
          uploadedByUid: req.actorUid ?? null,
        });

        res.status(201).json(saved);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Unable to save uploaded file.' });
      }
    }
  );

  // Chunked upload endpoints (each request stays <= 4 MB for Vercel Free Tier compatibility)
  app.post('/api/upload/init', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const bucket = String(req.body?.bucket || '').trim();
      const originalName = String(req.body?.originalName || 'file').trim() || 'file';
      const mimeType = String(req.body?.mimeType || 'application/octet-stream').trim();
      const sizeBytes = Number(req.body?.sizeBytes);

      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return res.status(400).json({ error: 'Invalid file size.' });
      }

      const validationError = validateUploadSpec(bucket, mimeType, sizeBytes);
      if (validationError) {
        return res
          .status(validationError.includes('size') ? 413 : 400)
          .json({ error: validationError });
      }

      const placeholder = await createChunkedFilePlaceholder({
        bucket,
        originalName,
        mimeType,
        sizeBytes,
        uploadedByUid: req.actorUid ?? null,
      });

      res.status(201).json(placeholder);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to initialize upload.' });
    }
  });

  app.post(
    '/api/upload/chunk',
    requireAuth,
    (req: AuthRequest, res: Response, next: NextFunction) => {
      chunkUpload.single('chunk')(req, res, (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res
              .status(413)
              .json({ error: 'Upload part exceeds 4 MB limit.' });
          }
          return res.status(400).json({ error: err.message || 'Chunk upload failed.' });
        }
        next();
      });
    },
    async (req: AuthRequest, res: Response) => {
      try {
        const fileId = String(req.body?.fileId || '').trim();
        const chunkIndex = Number(req.body?.chunkIndex);

        if (!UUID_RE.test(fileId)) {
          return res.status(400).json({ error: 'Invalid upload file ID.' });
        }
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
          return res.status(400).json({ error: 'Invalid chunk index.' });
        }
        if (!req.file || !req.file.buffer) {
          return res.status(400).json({ error: 'Chunk payload is missing.' });
        }

        await upsertStoredFileChunk({
          fileId,
          chunkIndex,
          data: req.file.buffer,
        });

        res.json({ ok: true, chunkIndex });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to save upload part.' });
      }
    }
  );

  app.post('/api/upload/complete', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const fileId = String(req.body?.fileId || '').trim();
      const totalChunks = Number(req.body?.totalChunks);

      if (!UUID_RE.test(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID.' });
      }
      if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
        return res.status(400).json({ error: 'Invalid chunk count.' });
      }

      const finalized = await finalizeChunkedFile({ fileId, totalChunks });
      res.json(finalized);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Unable to finalize upload.' });
    }
  });

  app.delete('/api/upload/:fileId', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { fileId } = req.params;
      if (!UUID_RE.test(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID.' });
      }
      await deleteIncompleteStoredFile(fileId);
      res.json({ cleaned: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Cleanup failed.' });
    }
  });

  // Serve stored files (supports legacy inline stored_files AND chunked stored_file_chunks + HTTP Range)
  app.get('/api/files/:id', async (req: Request, res: Response) => {
    try {
      const fileId = req.params.id;
      if (!UUID_RE.test(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID.' });
      }

      const accessToken =
        typeof req.query.access === 'string' ? req.query.access : undefined;
      let authorized = verifyFileAccessToken(fileId, accessToken);

      if (!authorized) {
        const resolved = await getSessionFromRequest(req);
        if (resolved?.session) {
          authorized = true;
        }
      }

      // Allow the active company branding logo so the login card & favicon always load before sign-in
      if (!authorized) {
        const config = await getCompanyAccessConfig();
        if (config.logoFileId && config.logoFileId === fileId) {
          authorized = true;
        }
      }

      if (!authorized) {
        return res.status(401).json({ error: 'Unauthorized file access.' });
      }

      const meta = await getStoredFileMeta(fileId);
      if (!meta) {
        return res.status(404).json({ error: 'File not found.' });
      }

      const totalLength = meta.totalLength;

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', meta.mimeType);
      if (meta.mimeType === 'image/svg+xml') {
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline';"
        );
      }

      if (totalLength === 0) {
        res.setHeader('Content-Length', 0);
        return res.status(200).send(Buffer.alloc(0));
      }

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

        if (isNaN(start) || isNaN(end) || start < 0 || start >= totalLength || end < start) {
          res.setHeader('Content-Range', `bytes */${totalLength}`);
          return res.status(416).end();
        }

        end = Math.min(totalLength - 1, end);
        // Bound single range response to <= 3 MB so video streaming works smoothly under Vercel's 4.5 MB cap
        if (end - start + 1 > MAX_HTTP_SLICE_BYTES) {
          end = start + MAX_HTTP_SLICE_BYTES - 1;
        }

        const chunkSize = end - start + 1;
        const slice = await readStoredFileRange(fileId, start, end, meta.isChunked);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
        res.setHeader('Content-Length', chunkSize);
        return res.send(slice);
      }

      // Non-Range request: on Vercel serverless (> 3 MB), return 206 first slice or advise range
      if (process.env.VERCEL === '1' && totalLength > MAX_HTTP_SLICE_BYTES) {
        const end = MAX_HTTP_SLICE_BYTES - 1;
        const slice = await readStoredFileRange(fileId, 0, end, meta.isChunked);
        res.status(206);
        res.setHeader('Content-Range', `bytes 0-${end}/${totalLength}`);
        res.setHeader('Content-Length', slice.length);
        return res.send(slice);
      }

      const fullBuffer = await readStoredFileRange(
        fileId,
        0,
        totalLength - 1,
        meta.isChunked
      );
      res.setHeader('Content-Length', fullBuffer.length);
      return res.send(fullBuffer);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Unable to serve file.' });
    }
  });

  // ============================================================================
  // DASHBOARD & CALENDAR
  // ============================================================================

  app.get('/api/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const todayStr = getTodayString(req.query.today);
      const summary = await getDashboardSummary(todayStr);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load dashboard.' });
    }
  });

  app.get('/api/calendar', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const events = await getCalendarEvents();
      res.json(events);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load calendar events.' });
    }
  });

  // ============================================================================
  // EMPLOYEES CRUD
  // ============================================================================

  app.get('/api/employees', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const data = await listEmployees();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load employees.' });
    }
  });

  app.get('/api/employees/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid employee ID.' });
      }
      const todayStr = getTodayString(req.query.today);
      const detail = await getEmployeeDetail(req.params.id, todayStr);
      if (!detail) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      res.json(detail);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load employee profile.' });
    }
  });

  app.post('/api/employees', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        employeeCode,
        fullName,
        profileImageFileId,
        department,
        designation,
        phone,
        joiningDate,
        isActive,
      } = req.body ?? {};

      if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
        return res.status(400).json({ error: 'Employee full name is required.' });
      }
      if (!department || typeof department !== 'string' || !department.trim()) {
        return res.status(400).json({ error: 'Department is required.' });
      }
      if (!designation || typeof designation !== 'string' || !designation.trim()) {
        return res.status(400).json({ error: 'Designation is required.' });
      }
      if (profileImageFileId && !UUID_RE.test(profileImageFileId)) {
        return res.status(400).json({ error: 'Invalid profile image reference.' });
      }

      const created = await createEmployee(
        {
          employeeCode,
          fullName,
          profileImageFileId: profileImageFileId || null,
          department,
          designation,
          phone,
          joiningDate,
          isActive,
        },
        req.actorName || 'Company Member',
        req.actorUid
      );
      res.status(201).json(created);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to create employee.' });
    }
  });

  app.put('/api/employees/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid employee ID.' });
      }
      const body = req.body ?? {};
      if (
        body.profileImageFileId !== undefined &&
        body.profileImageFileId !== null &&
        !UUID_RE.test(body.profileImageFileId)
      ) {
        return res.status(400).json({ error: 'Invalid profile image reference.' });
      }
      const updated = await updateEmployee(
        req.params.id,
        body,
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!updated) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      res.json(updated);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to update employee.' });
    }
  });

  app.delete('/api/employees/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid employee ID.' });
      }
      const ok = await deleteEmployee(
        req.params.id,
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!ok) {
        return res.status(404).json({ error: 'Employee not found.' });
      }
      res.json({ deleted: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to delete employee.' });
    }
  });

  // ============================================================================
  // TASKS CRUD & UPDATES
  // ============================================================================

  app.get('/api/tasks', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const data = await listTasks();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load tasks.' });
    }
  });

  app.get('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid task ID.' });
      }
      const detail = await getTaskDetail(req.params.id);
      if (!detail) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      res.json(detail);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load task details.' });
    }
  });

  app.post('/api/tasks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body ?? {};
      if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
        return res.status(400).json({ error: 'Task title is required.' });
      }
      const created = await createTask(
        body,
        req.actorName || 'Company Member',
        req.actorUid
      );
      res.status(201).json(created);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to create task.' });
    }
  });

  app.put('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid task ID.' });
      }
      const updated = await updateTask(
        req.params.id,
        req.body ?? {},
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!updated) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      res.json(updated);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to update task.' });
    }
  });

  app.post('/api/tasks/:id/updates', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid task ID.' });
      }
      const { comment, statusChangeTo, attachments, employeeId, updateType } =
        req.body ?? {};
      if (!comment || typeof comment !== 'string' || !comment.trim()) {
        return res.status(400).json({ error: 'Comment or update message is required.' });
      }
      const updated = await addTaskUpdate(
        req.params.id,
        { comment, statusChangeTo, attachments, employeeId, updateType },
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!updated) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      res.status(201).json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to post task update.' });
    }
  });

  app.delete('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid task ID.' });
      }
      const ok = await deleteTask(
        req.params.id,
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!ok) {
        return res.status(404).json({ error: 'Task not found.' });
      }
      res.json({ deleted: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to delete task.' });
    }
  });

  // ============================================================================
  // POSTERS CRUD
  // ============================================================================

  app.get('/api/posters', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const data = await listPosters();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load posters.' });
    }
  });

  app.post('/api/posters', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body ?? {};
      if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
        return res.status(400).json({ error: 'Poster title is required.' });
      }
      const created = await createPoster(
        body,
        req.actorName || 'Company Member',
        req.actorUid
      );
      res.status(201).json(created);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to create poster.' });
    }
  });

  app.put('/api/posters/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid poster ID.' });
      }
      const updated = await updatePoster(
        req.params.id,
        req.body ?? {},
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!updated) {
        return res.status(404).json({ error: 'Poster not found.' });
      }
      res.json(updated);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to update poster.' });
    }
  });

  app.delete('/api/posters/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid poster ID.' });
      }
      const ok = await deletePoster(
        req.params.id,
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!ok) {
        return res.status(404).json({ error: 'Poster not found.' });
      }
      res.json({ deleted: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to delete poster.' });
    }
  });

  // ============================================================================
  // REELS CRUD
  // ============================================================================

  app.get('/api/reels', requireAuth, async (_req: AuthRequest, res) => {
    try {
      const data = await listReels();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load reels.' });
    }
  });

  app.post('/api/reels', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body ?? {};
      if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
        return res.status(400).json({ error: 'Reel title is required.' });
      }
      const created = await createReel(
        body,
        req.actorName || 'Company Member',
        req.actorUid
      );
      res.status(201).json(created);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to create reel.' });
    }
  });

  app.put('/api/reels/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid reel ID.' });
      }
      const updated = await updateReel(
        req.params.id,
        req.body ?? {},
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!updated) {
        return res.status(404).json({ error: 'Reel not found.' });
      }
      res.json(updated);
    } catch (error: any) {
      const status = error.message?.includes('already exists') ? 409 : 500;
      res.status(status).json({ error: error.message || 'Failed to update reel.' });
    }
  });

  app.delete('/api/reels/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        return res.status(400).json({ error: 'Invalid reel ID.' });
      }
      const ok = await deleteReel(
        req.params.id,
        req.actorName || 'Company Member',
        req.actorUid
      );
      if (!ok) {
        return res.status(404).json({ error: 'Reel not found.' });
      }
      res.json({ deleted: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to delete reel.' });
    }
  });

  // Catch-all JSON 404 for unknown /api/* endpoints
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}
