import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  addTaskUpdate, createEmployee, createPoster, createReel, createTask,
  deleteEmployee, deletePoster, deleteReel, deleteTask, getCalendarEvents,
  getCompanySettings, getDashboardSummary, getEmployeeDetail, getStoredFileById,
  getTaskDetail, listEmployees, listPosters, listReels, listTasks, saveStoredFile,
  updateCompanySettings, updateEmployee, updatePoster, updateReel, updateTask,
} from './src/db/queries.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { AuthRequest, requireAuth, verifyFileAccessToken } from './src/middleware/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_BUCKETS = new Set(['employee-images', 'task-attachments', 'poster-images', 'reel-videos', 'company-assets']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/svg+xml']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/ogg', 'video/mpeg']);
const ATTACHMENT_MIMES = new Set([
  ...IMAGE_MIMES, ...VIDEO_MIMES, 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function getTodayString(queryToday: unknown): string {
  return typeof queryToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(queryToday)
    ? queryToday : new Date().toISOString().slice(0, 10);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Only branding needed on the access-code page is public; do not expose settings IDs.
  app.get('/api/settings', async (_req, res) => {
    try {
      const settings = await getCompanySettings();
      res.json({ companyName: settings.companyName, logoUrl: settings.logoUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load company settings.' });
    }
  });

  // Company code validation/session issuance is isolated from data endpoints.
  app.post('/api/access', requireAuth, (_req: AuthRequest, res) => res.json({ authenticated: true }));

  app.put('/api/settings', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { companyName, logoFileId } = req.body ?? {};
      if (logoFileId !== undefined && logoFileId !== null && !UUID_RE.test(logoFileId)) return res.status(400).json({ error: 'Invalid logo file reference.' });
      const updated = await updateCompanySettings({
        companyName: typeof companyName === 'string' ? companyName : undefined,
        logoFileId: logoFileId === undefined ? undefined : logoFileId,
        actorName: req.actorName || 'Team Member', actorUid: req.user?.uid,
      });
      res.json(updated);
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to update settings.' }); }
  });

  app.post('/api/upload', requireAuth, (req: AuthRequest, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (error: any) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File exceeds the maximum allowed size of 50 MB.' });
      return res.status(400).json({ error: error.message || 'File upload failed.' });
    });
  }, async (req: AuthRequest, res: Response) => {
    try {
      const bucket = String(req.body?.bucket || '').trim();
      if (!ALLOWED_BUCKETS.has(bucket)) return res.status(400).json({ error: 'Invalid storage bucket specified.' });
      if (!req.file) return res.status(400).json({ error: 'No file provided.' });
      const mime = req.file.mimetype || 'application/octet-stream';
      const size = req.file.size;
      if (['employee-images', 'poster-images', 'company-assets'].includes(bucket)) {
        if (!IMAGE_MIMES.has(mime)) return res.status(400).json({ error: 'Please upload a valid image file (PNG, JPG, WEBP, GIF, or SVG).' });
        if (size > 10 * 1024 * 1024) return res.status(413).json({ error: 'Image size must be 10 MB or smaller.' });
      } else if (bucket === 'reel-videos') {
        if (!VIDEO_MIMES.has(mime)) return res.status(400).json({ error: 'Please upload a valid video file (MP4, WebM, MOV, M4V, or OGG).' });
        if (size > 50 * 1024 * 1024) return res.status(413).json({ error: 'Video size must be 50 MB or smaller.' });
      } else {
        if (!ATTACHMENT_MIMES.has(mime)) return res.status(400).json({ error: 'Unsupported attachment format.' });
        if (size > 20 * 1024 * 1024) return res.status(413).json({ error: 'Attachment size must be 20 MB or smaller.' });
      }
      const saved = await saveStoredFile({ bucket, originalName: req.file.originalname || 'file', mimeType: mime, sizeBytes: size, data: req.file.buffer, uploadedByUid: req.user?.uid ?? null });
      res.status(201).json(saved);
    } catch (error: any) { res.status(500).json({ error: error.message || 'Unable to save uploaded file.' }); }
  });

  // Existing signed file URLs are short-lived capabilities. Otherwise require a valid
  // company session or legacy Firebase ID token; no database/files are exposed directly.
  app.get('/api/files/:id', async (req: Request, res: Response, next: NextFunction) => {
    const fileId = req.params.id;
    if (!UUID_RE.test(fileId)) return res.status(400).json({ error: 'Invalid file ID.' });
    const accessToken = typeof req.query.access === 'string' ? req.query.access : undefined;
    if (verifyFileAccessToken(fileId, accessToken)) return next();
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try { await adminAuth.verifyIdToken(authHeader.slice(7).trim()); return next(); } catch { /* fall through to company session check */ }
    }
    return requireAuth(req as AuthRequest, res, next);
  }, async (req: Request, res: Response) => {
    try {
      const file = await getStoredFileById(req.params.id);
      if (!file) return res.status(404).json({ error: 'File not found.' });
      const buffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
      const totalLength = buffer.length;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', file.mimeType);
      if (file.mimeType === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline';");
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;
        if (isNaN(start) || isNaN(end) || start < 0 || end < start || start >= totalLength || end >= totalLength) {
          res.setHeader('Content-Range', `bytes */${totalLength}`);
          return res.status(416).end();
        }
        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
        res.setHeader('Content-Length', chunkSize);
        return res.send(buffer.subarray(start, end + 1));
      }
      res.setHeader('Content-Length', totalLength);
      return res.send(buffer);
    } catch (error: any) { res.status(500).json({ error: error.message || 'Unable to serve file.' }); }
  });

  app.get('/api/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try { res.json(await getDashboardSummary(getTodayString(req.query.today))); }
    catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load dashboard.' }); }
  });
  app.get('/api/calendar', requireAuth, async (_req: AuthRequest, res) => {
    try { res.json(await getCalendarEvents()); }
    catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load calendar events.' }); }
  });

  app.get('/api/employees', requireAuth, async (_req: AuthRequest, res) => {
    try { res.json(await listEmployees()); } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load employees.' }); }
  });
  app.get('/api/employees/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid employee ID.' });
      const detail = await getEmployeeDetail(req.params.id, getTodayString(req.query.today));
      if (!detail) return res.status(404).json({ error: 'Employee not found.' });
      res.json(detail);
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load employee profile.' }); }
  });
  app.post('/api/employees', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { employeeCode, fullName, profileImageFileId, department, designation, phone, joiningDate, isActive } = req.body ?? {};
      if (typeof fullName !== 'string' || !fullName.trim()) return res.status(400).json({ error: 'Employee full name is required.' });
      if (typeof department !== 'string' || !department.trim()) return res.status(400).json({ error: 'Department is required.' });
      if (typeof designation !== 'string' || !designation.trim()) return res.status(400).json({ error: 'Designation is required.' });
      if (profileImageFileId && !UUID_RE.test(profileImageFileId)) return res.status(400).json({ error: 'Invalid profile image reference.' });
      const created = await createEmployee({ employeeCode, fullName, profileImageFileId: profileImageFileId || null, department, designation, phone, joiningDate, isActive }, req.actorName || 'Team Member', req.user?.uid);
      res.status(201).json(created);
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to create employee.' }); }
  });
  app.put('/api/employees/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid employee ID.' });
      const body = req.body ?? {};
      if (body.profileImageFileId !== undefined && body.profileImageFileId !== null && !UUID_RE.test(body.profileImageFileId)) return res.status(400).json({ error: 'Invalid profile image reference.' });
      const updated = await updateEmployee(req.params.id, body, req.actorName || 'Team Member', req.user?.uid);
      if (!updated) return res.status(404).json({ error: 'Employee not found.' });
      res.json(updated);
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to update employee.' }); }
  });
  app.delete('/api/employees/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid employee ID.' });
      const ok = await deleteEmployee(req.params.id, req.actorName || 'Team Member', req.user?.uid);
      if (!ok) return res.status(404).json({ error: 'Employee not found.' });
      res.json({ deleted: true });
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to delete employee.' }); }
  });

  app.get('/api/tasks', requireAuth, async (_req: AuthRequest, res) => {
    try { res.json(await listTasks()); } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load tasks.' }); }
  });
  app.get('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid task ID.' });
      const detail = await getTaskDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: 'Task not found.' });
      res.json(detail);
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load task details.' }); }
  });
  app.post('/api/tasks', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body ?? {};
      if (typeof body.title !== 'string' || !body.title.trim()) return res.status(400).json({ error: 'Task title is required.' });
      res.status(201).json(await createTask(body, req.actorName || 'Team Member', req.user?.uid));
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to create task.' }); }
  });
  app.put('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid task ID.' });
      const updated = await updateTask(req.params.id, req.body ?? {}, req.actorName || 'Team Member', req.user?.uid);
      if (!updated) return res.status(404).json({ error: 'Task not found.' });
      res.json(updated);
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to update task.' }); }
  });
  app.post('/api/tasks/:id/updates', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid task ID.' });
      const { comment, statusChangeTo, attachments, employeeId, updateType } = req.body ?? {};
      if (typeof comment !== 'string' || !comment.trim()) return res.status(400).json({ error: 'Comment or update message is required.' });
      const updated = await addTaskUpdate(req.params.id, { comment, statusChangeTo, attachments, employeeId, updateType }, req.actorName || 'Team Member', req.user?.uid);
      if (!updated) return res.status(404).json({ error: 'Task not found.' });
      res.status(201).json(updated);
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to post task update.' }); }
  });
  app.delete('/api/tasks/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid task ID.' });
      const ok = await deleteTask(req.params.id, req.actorName || 'Team Member', req.user?.uid);
      if (!ok) return res.status(404).json({ error: 'Task not found.' });
      res.json({ deleted: true });
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to delete task.' }); }
  });

  app.get('/api/posters', requireAuth, async (_req: AuthRequest, res) => {
    try { res.json(await listPosters()); } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load posters.' }); }
  });
  app.post('/api/posters', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body ?? {};
      if (typeof body.title !== 'string' || !body.title.trim()) return res.status(400).json({ error: 'Poster title is required.' });
      res.status(201).json(await createPoster(body, req.actorName || 'Team Member', req.user?.uid));
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to create poster.' }); }
  });
  app.put('/api/posters/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid poster ID.' });
      const updated = await updatePoster(req.params.id, req.body ?? {}, req.actorName || 'Team Member', req.user?.uid);
      if (!updated) return res.status(404).json({ error: 'Poster not found.' });
      res.json(updated);
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to update poster.' }); }
  });
  app.delete('/api/posters/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid poster ID.' });
      const ok = await deletePoster(req.params.id, req.actorName || 'Team Member', req.user?.uid);
      if (!ok) return res.status(404).json({ error: 'Poster not found.' });
      res.json({ deleted: true });
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to delete poster.' }); }
  });

  app.get('/api/reels', requireAuth, async (_req: AuthRequest, res) => {
    try { res.json(await listReels()); } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to load reels.' }); }
  });
  app.post('/api/reels', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body ?? {};
      if (typeof body.title !== 'string' || !body.title.trim()) return res.status(400).json({ error: 'Reel title is required.' });
      res.status(201).json(await createReel(body, req.actorName || 'Team Member', req.user?.uid));
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to create reel.' }); }
  });
  app.put('/api/reels/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid reel ID.' });
      const updated = await updateReel(req.params.id, req.body ?? {}, req.actorName || 'Team Member', req.user?.uid);
      if (!updated) return res.status(404).json({ error: 'Reel not found.' });
      res.json(updated);
    } catch (error: any) { res.status(error.message?.includes('already exists') ? 409 : 500).json({ error: error.message || 'Failed to update reel.' }); }
  });
  app.delete('/api/reels/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid reel ID.' });
      const ok = await deleteReel(req.params.id, req.actorName || 'Team Member', req.user?.uid);
      if (!ok) return res.status(404).json({ error: 'Reel not found.' });
      res.json({ deleted: true });
    } catch (error: any) { res.status(500).json({ error: error.message || 'Failed to delete reel.' }); }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) res.sendFile(indexFile);
      else res.status(404).send('Build output not found.');
    });
  }
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => console.log(`WORK ORGANIZER server listening on http://0.0.0.0:${port}`));
}

startServer().catch((err) => { console.error('Failed to start server:', err); process.exit(1); });
