import { ApiError } from './apiClient';

export type StorageBucket = 'employee-images' | 'task-attachments' | 'poster-images' | 'reel-videos' | 'company-assets';

export async function uploadFileToStorage(bucket: StorageBucket, file: File, onProgress?: (percent: number) => void): Promise<FileAttachment> {
  return new Promise<FileAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      let parsed: any = null;
      try { parsed = JSON.parse(xhr.responseText); } catch { parsed = null; }
      if (xhr.status >= 200 && xhr.status < 300 && parsed) {
        if (onProgress) onProgress(100);
        resolve(parsed as FileAttachment);
      } else {
        reject(new ApiError((parsed && typeof parsed.error === 'string' && parsed.error) || `Upload failed (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Network error during file upload. Please try again.', 0));
    xhr.onabort = () => reject(new ApiError('File upload was cancelled.', 0));
    const formData = new FormData();
    formData.append('bucket', bucket);
    formData.append('file', file);
    xhr.send(formData);
  });
}

import { FileAttachment } from '../types';
