import { ReelRecord, ReelStatus } from '../types';
import { apiRequest } from './apiClient';

export interface ReelInput {
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
  status?: ReelStatus;
}

export const reelService = {
  list: (signal?: AbortSignal, options?: { retry?: boolean }) =>
    apiRequest<ReelRecord[]>('/api/reels', { signal, retry: options?.retry }),
  create: (input: ReelInput) =>
    apiRequest<ReelRecord>('/api/reels', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: Partial<ReelInput>) =>
    apiRequest<ReelRecord>(`/api/reels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/reels/${id}`, {
      method: 'DELETE',
    }),
};
