import { FileAttachment } from '../types';
import { ApiError, getAuthToken } from './apiClient';

export type StorageBucket =
  | 'employee-images'
  | 'task-attachments'
  | 'poster-images'
  | 'reel-videos'
  | 'company-assets';

export async function uploadFileToStorage(
  bucket: StorageBucket,
  file: File,
  onProgress?: (percent: number) => void
): Promise<FileAttachment> {
  const token = await getAuthToken();

  return new Promise<FileAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

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
