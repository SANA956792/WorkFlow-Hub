import { CalendarEvent, DashboardSummary, WorkspaceData } from '../types';
import { getLocalTodayISO } from '../utils/dates';
import { apiRequest } from './apiClient';

export const dashboardService = {
  getWorkspace: (signal?: AbortSignal, options?: { retry?: boolean }) =>
    apiRequest<WorkspaceData>(
      `/api/workspace?today=${encodeURIComponent(getLocalTodayISO())}`,
      { signal, retry: options?.retry }
    ),
  getSummary: (signal?: AbortSignal, options?: { retry?: boolean }) =>
    apiRequest<DashboardSummary>(
      `/api/dashboard?today=${encodeURIComponent(getLocalTodayISO())}`,
      { signal, retry: options?.retry }
    ),
  getCalendarEvents: (signal?: AbortSignal, options?: { retry?: boolean }) =>
    apiRequest<CalendarEvent[]>('/api/calendar', { signal, retry: options?.retry }),
};
