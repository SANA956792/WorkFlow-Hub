import { FileAttachment } from '../types';
import { ApiError, apiRequest, UNAUTHORIZED_EVENT } from './apiClient';

export type StorageBucket =
  | 'employee-images'
  | 'task-attachments'
  | 'poster-images'
  | 'reel-videos'
  | 'company-assets';

// Files above 2.5 MB use 2 MB chunks so each request stays well below Vercel's 4.5 MB payload limit
const CHUNK_THRESHOLD_BYTES = Math.floor(2.5 * 1024 * 1024);
const CHUNK_SIZE_BYTES = 2 * 1024 * 1024;

function uploadSingleFile(
  bucket: StorageBucket,
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileAttachment> {
  return new Promise<FileAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && parsed) {
        if (onProgress) onProgress(100);
        resolve(parsed as FileAttachment);
      } else {
        if (xhr.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        }
        const msg =
          (parsed && typeof parsed.error === 'string' && parsed.error) ||
          `Upload failed (${xhr.status})`;
        reject(new ApiError(msg, xhr.status));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error during file upload. Please try again.', 0));
    };

    xhr.onabort = () => {
      reject(new ApiError('File upload was cancelled.', 0));
    };

    const formData = new FormData();
    formData.append('bucket', bucket);
    formData.append('file', file);
    xhr.send(formData);
  });
}

function uploadChunkWithProgress(
  fileId: string,
  chunkIndex: number,
  chunkBlob: Blob,
  onChunkProgress: (loadedBytes: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload/chunk');
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onChunkProgress(event.loaded);
      }
    };

    xhr.onload = () => {
      let parsed: any = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onChunkProgress(chunkBlob.size);
        resolve();
      } else {
        if (xhr.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
        }
        const msg =
          (parsed && typeof parsed.error === 'string' && parsed.error) ||
          `Chunk upload failed (${xhr.status})`;
        reject(new ApiError(msg, xhr.status));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError('Network error during chunk upload.', 0));
    };

    const formData = new FormData();
    formData.append('fileId', fileId);
    formData.append('chunkIndex', String(chunkIndex));
    formData.append('chunk', chunkBlob, `part-${chunkIndex}`);
    xhr.send(formData);
  });
}

async function uploadFileChunked(
  bucket: StorageBucket,
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileAttachment> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE_BYTES);
  const initRes = await apiRequest<{ fileId: string }>('/api/upload/init', {
    method: 'POST',
    body: JSON.stringify({
      bucket,
      originalName: file.name || 'file',
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      totalChunks,
    }),
  });

  const fileId = initRes.fileId;
  let uploadedBeforeChunk = 0;

  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE_BYTES;
      const end = Math.min(file.size, start + CHUNK_SIZE_BYTES);
      const slice = file.slice(start, end);

      await uploadChunkWithProgress(fileId, chunkIndex, slice, (loaded) => {
        if (onProgress) {
          const totalLoaded = Math.min(file.size, uploadedBeforeChunk + loaded);
          const pct = Math.min(99, Math.round((totalLoaded / file.size) * 100));
          onProgress(pct);
        }
      });

      uploadedBeforeChunk = end;
    }

    const completed = await apiRequest<FileAttachment>('/api/upload/complete', {
      method: 'POST',
      body: JSON.stringify({ fileId, totalChunks }),
    });

    if (onProgress) onProgress(100);
    return completed;
  } catch (err) {
    // Best-effort cleanup of incomplete placeholder
    apiRequest(`/api/upload/${fileId}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
}

export async function uploadFileToStorage(
  bucket: StorageBucket,
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileAttachment> {
  if (file.size <= CHUNK_THRESHOLD_BYTES) {
    return uploadSingleFile(bucket, file, onProgress);
  }
  return uploadFileChunked(bucket, file, onProgress);
}

export async function downloadStoredAttachment(att: FileAttachment): Promise<void> {
  const SLICE = 2 * 1024 * 1024;
  const total = att.sizeBytes;
  if (!total || total <= 3 * 1024 * 1024) {
    const link = document.createElement('a');
    link.href = att.url;
    link.download = att.fileName || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return;
  }

  const parts: BlobPart[] = [];
  let offset = 0;
  while (offset < total) {
    const end = Math.min(total - 1, offset + SLICE - 1);
    const resp = await fetch(att.url, {
      credentials: 'same-origin',
      headers: {
        Range: `bytes=${offset}-${end}`,
      },
    });
    if (!resp.ok && resp.status !== 206) {
      throw new ApiError('Failed to download attachment.', resp.status);
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0) break;
    parts.push(buf);
    offset += buf.byteLength;
  }

  const blob = new Blob(parts, { type: att.mimeType || 'application/octet-stream' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = att.fileName || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}

