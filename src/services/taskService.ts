import { FileAttachment, TaskPriority, TaskRecord, TaskStatus } from '../types';
import { apiRequest } from './apiClient';

export interface TaskInput {
  taskCode?: string;
  title: string;
  description?: string;
  category?: string;
  startDate?: string | null;
  dueDate?: string | null;
  priority?: TaskPriority;
  instructions?: string;
  attachments?: FileAttachment[];
  referenceLinks?: string[];
  status?: TaskStatus;
  assignedEmployeeIds?: string[];
}

export interface TaskUpdateInput {
  employeeId?: string | null;
  updateType?: string;
  comment: string;
  statusChangeTo?: TaskStatus | null;
  attachments?: FileAttachment[];
}

export const taskService = {
  list: (signal?: AbortSignal, options?: { retry?: boolean }) =>
    apiRequest<TaskRecord[]>('/api/tasks', { signal, retry: options?.retry }),
  getDetail: (id: string, signal?: AbortSignal) =>
    apiRequest<TaskRecord>(`/api/tasks/${id}`, { signal }),
  create: (input: TaskInput) =>
    apiRequest<TaskRecord>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: Partial<TaskInput>) =>
    apiRequest<TaskRecord>(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  addUpdate: (id: string, input: TaskUpdateInput) =>
    apiRequest<TaskRecord>(`/api/tasks/${id}/updates`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/tasks/${id}`, {
      method: 'DELETE',
    }),
};
