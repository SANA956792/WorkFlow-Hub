import { Employee, EmployeeDetail } from '../types';
import { getLocalTodayISO } from '../utils/dates';
import { apiRequest } from './apiClient';

export interface EmployeeInput {
  employeeCode?: string;
  fullName: string;
  profileImageFileId?: string | null;
  department: string;
  designation: string;
  phone?: string | null;
  joiningDate?: string | null;
  isActive?: boolean;
}

export const employeeService = {
  list: (signal?: AbortSignal, options?: { retry?: boolean }) =>
    apiRequest<Employee[]>('/api/employees', { signal, retry: options?.retry }),
  getDetail: (id: string, signal?: AbortSignal) =>
    apiRequest<EmployeeDetail>(
      `/api/employees/${id}?today=${encodeURIComponent(getLocalTodayISO())}`,
      { signal }
    ),
  create: (input: EmployeeInput) =>
    apiRequest<Employee>('/api/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: Partial<EmployeeInput>) =>
    apiRequest<Employee>(`/api/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/employees/${id}`, {
      method: 'DELETE',
    }),
};
