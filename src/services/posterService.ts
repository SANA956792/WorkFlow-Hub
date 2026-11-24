import { PosterRecord, PosterStatus } from '../types';
import { apiRequest } from './apiClient';

export interface PosterInput {
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
  status?: PosterStatus;
}

export const posterService = {
  list: (signal?: AbortSignal, options?: { retry?: boolean }) =>
    apiRequest<PosterRecord[]>('/api/posters', { signal, retry: options?.retry }),
  create: (input: PosterInput) =>
    apiRequest<PosterRecord>('/api/posters', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: Partial<PosterInput>) =>
    apiRequest<PosterRecord>(`/api/posters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/posters/${id}`, {
      method: 'DELETE',
    }),
};
