import { CompanySettings } from '../types';
import { apiRequest, publicRequest } from './apiClient';

export const settingsService = {
  getSettings: () => publicRequest<CompanySettings>('/api/settings'),
  updateSettings: (payload: { companyName?: string; logoFileId?: string | null }) =>
    apiRequest<CompanySettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
