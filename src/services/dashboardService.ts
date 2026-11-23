import { CalendarEvent, DashboardSummary } from '../types';
import { getLocalTodayISO } from '../utils/dates';
import { apiRequest } from './apiClient';

export const dashboardService = {
  getSummary: () =>
    apiRequest<DashboardSummary>(
      `/api/dashboard?today=${encodeURIComponent(getLocalTodayISO())}`
    ),
  getCalendarEvents: () => apiRequest<CalendarEvent[]>('/api/calendar'),
};
