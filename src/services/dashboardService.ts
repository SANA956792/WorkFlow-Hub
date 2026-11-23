import { CalendarEvent, DashboardSummary, WorkspaceData } from '../types';
import { getLocalTodayISO } from '../utils/dates';
import { apiRequest } from './apiClient';

export const dashboardService = {
  getWorkspace: (signal?: AbortSignal) =>
    apiRequest<WorkspaceData>(
      `/api/workspace?today=${encodeURIComponent(getLocalTodayISO())}`,
      { signal }
    ),
  getSummary: (signal?: AbortSignal) =>
    apiRequest<DashboardSummary>(
      `/api/dashboard?today=${encodeURIComponent(getLocalTodayISO())}`,
      { signal }
    ),
  getCalendarEvents: (signal?: AbortSignal) =>
    apiRequest<CalendarEvent[]>('/api/calendar', { signal }),
};
