import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Calendar,
  Edit3,
  Eye,
  Film,
  Image as ImageIcon,
  Phone,
  Plus,
  Search,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { Employee, EmployeeDetail } from '../types';
import { employeeService, EmployeeInput } from '../services/employeeService';
import { uploadFileToStorage } from '../services/storageService';
import { ThreeDotMenu } from '../components/ThreeDotMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageLoadError } from '../components/PageLoadError';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dates';
import {
  getAvatarColor,
  getInitials,
  getStatusBadgeStyle,
} from '../utils/colors';

interface EmployeesPageProps {
  employees: Employee[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  onRetry: () => void;
  initialSelectedEmployeeId?: string | null;
  onClearInitialSelection?: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function EmployeesPage({
  employees,
  loading,
  loaded,
  error,
  onRetry,
  initialSelectedEmployeeId,
  onClearInitialSelection,
  onRefresh,
  onNotify,
}: EmployeesPageProps) {
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Create / Edit modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');
  const [phone, setPhone] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [profileImageFileId, setProfileImageFileId] = useState<string | null>(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail profile modal state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTargetId, setDetailTargetId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [employeeDetail, setEmployeeDetail] = useState<EmployeeDetail | null>(null);
  const detailReqIdRef = useRef(0);

  // Confirm delete/deactivate modal
  const [confirmTarget, setConfirmTarget] = useState<{
    employee: Employee;
    mode: 'delete' | 'deactivate';
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.department) set.add(e.department);
    });
    return ['All', ...Array.from(set).sort()];
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (departmentFilter !== 'All' && e.department !== departmentFilter) {
        return false;
      }
      if (statusFilter === 'active' && !e.isActive) return false;
      if (statusFilter === 'inactive' && e.isActive) return false;
      if (q) {
        const hay = `${e.fullName} ${e.employeeCode} ${e.department} ${e.designation}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [employees, search, departmentFilter, statusFilter]);

  const openProfile = async (empId: string) => {
    const reqId = ++detailReqIdRef.current;
    setDetailTargetId(empId);
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setEmployeeDetail(null);
    try {
      const detail = await employeeService.getDetail(empId);
      if (reqId !== detailReqIdRef.current) return;
      setEmployeeDetail(detail);
    } catch (err: any) {
      if (reqId !== detailReqIdRef.current) return;
      setDetailError(err.message || 'Unable to load employee profile.');
    } finally {
      if (reqId === detailReqIdRef.current) {
        setDetailLoading(false);
      }
    }
  };

  useEffect(() => {
    if (initialSelectedEmployeeId) {
      openProfile(initialSelectedEmployeeId);
      onClearInitialSelection?.();
    }
  }, [initialSelectedEmployeeId]);

  const openCreateModal = () => {
    setEditingEmployee(null);
    setEmployeeCode('');
    setFullName('');
    setDepartment('');
    setDesignation('');
    setPhone('');
    setJoiningDate('');
    setIsActive(true);
    setProfileImageFileId(null);
    setProfilePreviewUrl(null);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (emp: Employee) => {
    setEditingEmployee(emp);
    setEmployeeCode(emp.employeeCode);
    setFullName(emp.fullName);
    setDepartment(emp.department);
    setDesignation(emp.designation);
    setPhone(emp.phone || '');
    setJoiningDate(emp.joiningDate || '');
    setIsActive(emp.isActive);
    setProfileImageFileId(emp.profileImageFileId);
    setProfilePreviewUrl(emp.profileImageUrl);
    setFormError(null);
    setFormOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingImage(true);
    setFormError(null);
    try {
      const uploaded = await uploadFileToStorage('employee-images', file);
      setProfileImageFileId(uploaded.fileId);
      setProfilePreviewUrl(uploaded.url);
    } catch (err: any) {
      setFormError(err.message || 'Failed to upload profile image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploadingImage) return;

    if (!fullName.trim()) {
      setFormError('Full name is required.');
      return;
    }
    if (!department.trim()) {
      setFormError('Department is required.');
      return;
    }
    if (!designation.trim()) {
      setFormError('Designation is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload: EmployeeInput = {
        employeeCode: employeeCode.trim() || undefined,
        fullName: fullName.trim(),
        department: department.trim(),
        designation: designation.trim(),
        phone: phone.trim() || null,
        joiningDate: joiningDate || null,
        isActive,
        profileImageFileId,
      };

      if (editingEmployee) {
        await employeeService.update(editingEmployee.id, payload);
        onNotify('success', `Updated ${fullName.trim()}`);
      } else {
        await employeeService.create(payload);
        onNotify('success', `Added employee ${fullName.trim()}`);
      }

      setFormOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save employee. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmTarget || confirmLoading) return;
    setConfirmLoading(true);
    try {
      if (confirmTarget.mode === 'delete') {
        await employeeService.remove(confirmTarget.employee.id);
        onNotify('success', `Removed ${confirmTarget.employee.fullName}`);
      } else {
        const nextActive = !confirmTarget.employee.isActive;
        await employeeService.update(confirmTarget.employee.id, {
          isActive: nextActive,
        });
        onNotify(
          'success',
          `${confirmTarget.employee.fullName} is now ${
            nextActive ? 'active' : 'inactive'
          }`
        );
      }
      setConfirmTarget(null);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Action failed.');
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Employees
          </h1>
          <p className="text-sm text-slate-500">
            Manage team members, roles, profile photos, and individual workloads
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-[#4776E6] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Add Employee</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID, or designation..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3.5 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#4776E6] focus:bg-white focus:outline-none"
          />
        </div>

        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 focus:border-[#4776E6] focus:outline-none"
        >
          {departments.map((dept) => (
            <option key={dept} value={dept}>
              {dept === 'All' ? 'All Departments' : dept}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
          {(['all', 'active', 'inactive'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-[#4776E6] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {error && loaded && (
        <PageLoadError
          title="Could not refresh employees"
          message={error}
          retrying={loading}
          onRetry={onRetry}
          variant="banner"
        />
      )}

      {/* Employee Cards Grid */}
      {loading && !loaded && employees.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-44 animate-pulse rounded-2xl bg-slate-200" />
          ))}
        </div>
      ) : error && !loaded && employees.length === 0 ? (
        <PageLoadError
          title="Unable to load employees"
          message={error}
          retrying={loading}
          onRetry={onRetry}
          variant="card"
        />
      ) : loaded && filteredEmployees.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#4776E6]/10 text-[#4776E6]">
            <Briefcase className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-900">
            {employees.length === 0 ? 'No employees yet' : 'No matching employees'}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {employees.length === 0
              ? 'Add your first employee to start assigning tasks, posters, and reels.'
              : 'Try adjusting your search or department filter.'}
          </p>
          {employees.length === 0 && (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 rounded-xl bg-[#4776E6] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Add First Employee
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEmployees.map((emp) => (
            <div
              key={emp.id}
              onClick={() => openProfile(emp.id)}
              className="group cursor-pointer rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3.5">
                  <div
                    style={{
                      backgroundColor: emp.profileImageUrl
                        ? undefined
                        : getAvatarColor(emp.fullName),
                    }}
                    className="flex h-13 w-13 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-base font-bold text-white"
                  >
                    {emp.profileImageUrl ? (
                      <img
                        src={emp.profileImageUrl}
                        alt={emp.fullName}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      getInitials(emp.fullName)
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-400">
                        {emp.employeeCode}
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          emp.isActive
                            ? 'bg-emerald-50 text-[#20A779]'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {emp.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <h3 className="mt-0.5 truncate text-base font-bold text-slate-900">
                      {emp.fullName}
                    </h3>
                    <p className="truncate text-sm text-slate-600">
                      {emp.designation}
                    </p>
                  </div>
                </div>

                <ThreeDotMenu
                  actions={[
                    {
                      label: 'View Profile',
                      icon: <Eye className="h-4 w-4" />,
                      onClick: () => openProfile(emp.id),
                    },
                    {
                      label: 'Edit Details',
                      icon: <Edit3 className="h-4 w-4" />,
                      onClick: () => openEditModal(emp),
                    },
                    {
                      label: emp.isActive ? 'Deactivate' : 'Activate',
                      icon: emp.isActive ? (
                        <UserX className="h-4 w-4" />
                      ) : (
                        <UserCheck className="h-4 w-4" />
                      ),
                      onClick: () =>
                        setConfirmTarget({ employee: emp, mode: 'deactivate' }),
                    },
                    {
                      label: 'Delete Employee',
                      icon: <Trash2 className="h-4 w-4" />,
                      danger: true,
                      onClick: () =>
                        setConfirmTarget({ employee: emp, mode: 'delete' }),
                    },
                  ]}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3.5 text-xs text-slate-500">
                <span className="rounded-lg bg-[#4776E6]/10 px-2.5 py-1 font-semibold text-[#4776E6]">
                  {emp.department}
                </span>
                <span className="tabular-nums">
                  {emp.phone || (emp.joiningDate ? `Joined ${formatDisplayDate(emp.joiningDate)}` : 'Profile ready')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-extrabold text-slate-900">
                {editingEmployee ? 'Edit Employee' : 'Add Employee'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-[#E85D65]">
                  {formError}
                </div>
              )}

              {/* Profile Image Upload */}
              <div className="flex items-center gap-4">
                <div
                  style={{
                    backgroundColor: profilePreviewUrl
                      ? undefined
                      : getAvatarColor(fullName || 'Employee'),
                  }}
                  className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 text-lg font-bold text-white"
                >
                  {profilePreviewUrl ? (
                    <img
                      src={profilePreviewUrl}
                      alt="Profile preview"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getInitials(fullName || 'EM')
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>
                      {uploadingImage
                        ? 'Uploading photo...'
                        : profilePreviewUrl
                        ? 'Replace Photo'
                        : 'Upload Photo'}
                    </span>
                  </button>
                  <p className="mt-1 text-xs text-slate-400">
                    PNG, JPG or WEBP up to 10 MB
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-[#4776E6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Employee ID
                  </label>
                  <input
                    type="text"
                    value={employeeCode}
                    onChange={(e) => setEmployeeCode(e.target.value)}
                    placeholder="Auto-generated if blank"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-[#4776E6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Department *
                  </label>
                  <input
                    type="text"
                    required
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g. Creative, Marketing, Video"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-[#4776E6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Designation *
                  </label>
                  <input
                    type="text"
                    required
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g. Graphic Designer"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-[#4776E6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 555 0100"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-[#4776E6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Joining Date (Optional)
                  </label>
                  <input
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-[#4776E6] focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 pt-1 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#4776E6]"
                />
                <span>Active employee</span>
              </label>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  disabled={saving}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || uploadingImage}
                  className="rounded-xl bg-[#4776E6] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {saving
                    ? 'Saving...'
                    : editingEmployee
                    ? 'Save Changes'
                    : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Profile Detail Modal */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-extrabold text-slate-900">
                Employee Profile
              </h2>
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {detailLoading ? (
              <div className="space-y-4 py-8">
                <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-36 animate-pulse rounded-2xl bg-slate-100" />
              </div>
            ) : detailError ? (
              <div className="py-6">
                <PageLoadError
                  title="Unable to load employee profile"
                  message={detailError}
                  retrying={detailLoading}
                  onRetry={() => {
                    if (detailTargetId) openProfile(detailTargetId);
                  }}
                  variant="card"
                />
              </div>
            ) : employeeDetail ? (
              <div className="mt-5 space-y-6">
                {/* Identity */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div
                      style={{
                        backgroundColor: employeeDetail.profileImageUrl
                          ? undefined
                          : getAvatarColor(employeeDetail.fullName),
                      }}
                      className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-xl font-bold text-white"
                    >
                      {employeeDetail.profileImageUrl ? (
                        <img
                          src={employeeDetail.profileImageUrl}
                          alt={employeeDetail.fullName}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        getInitials(employeeDetail.fullName)
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-400">
                          {employeeDetail.employeeCode}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            employeeDetail.isActive
                              ? 'bg-emerald-50 text-[#20A779]'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {employeeDetail.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <h3 className="text-xl font-extrabold text-slate-900">
                        {employeeDetail.fullName}
                      </h3>
                      <p className="text-sm text-slate-600">
                        {employeeDetail.designation} · {employeeDetail.department}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                        {employeeDetail.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {employeeDetail.phone}
                          </span>
                        )}
                        {employeeDetail.joiningDate && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            Joined {formatDisplayDate(employeeDetail.joiningDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailOpen(false);
                      openEditModal(employeeDetail);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </button>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {[
                    { label: 'Total Tasks', value: employeeDetail.stats.totalTasks, bg: '#8757D5' },
                    { label: 'Completed', value: employeeDetail.stats.completedTasks, bg: '#20A779' },
                    { label: 'Pending', value: employeeDetail.stats.pendingTasks, bg: '#F29A38' },
                    { label: 'In Progress', value: employeeDetail.stats.inProgressTasks, bg: '#16A6C1' },
                    { label: 'Overdue', value: employeeDetail.stats.overdueTasks, bg: '#E85D65' },
                    { label: 'Posters', value: employeeDetail.stats.assignedPosters, bg: '#E85B9A' },
                    { label: 'Reels', value: employeeDetail.stats.assignedReels, bg: '#159D91' },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      style={{ backgroundColor: stat.bg }}
                      className="rounded-xl p-3 text-white"
                    >
                      <div className="text-[11px] font-medium text-white/90">
                        {stat.label}
                      </div>
                      <div className="tabular-nums mt-1 text-xl font-extrabold">
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Assigned Tasks */}
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Assigned Tasks ({employeeDetail.tasks.length})
                  </h4>
                  {employeeDetail.tasks.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      No tasks assigned yet.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {employeeDetail.tasks.map((t) => {
                        const b = getStatusBadgeStyle(t.status);
                        return (
                          <div
                            key={t.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-sm"
                          >
                            <div className="min-w-0">
                              <span className="font-mono text-xs text-slate-400 mr-2">
                                {t.taskCode}
                              </span>
                              <span className="font-semibold text-slate-800">
                                {t.title}
                              </span>
                            </div>
                            <span
                              style={{
                                backgroundColor: b.bg,
                                color: b.text,
                                borderColor: b.border,
                              }}
                              className="shrink-0 rounded-lg border px-2 py-0.5 text-xs font-semibold"
                            >
                              {t.status}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Assigned Posters & Reels */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                      <ImageIcon className="h-4 w-4 text-[#E85B9A]" />
                      <span>Assigned Posters ({employeeDetail.posters.length})</span>
                    </h4>
                    <div className="mt-2 space-y-2">
                      {employeeDetail.posters.length === 0 ? (
                        <p className="text-xs text-slate-500">No posters assigned.</p>
                      ) : (
                        employeeDetail.posters.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                          >
                            <span className="truncate font-semibold text-slate-800">
                              {p.title}
                            </span>
                            <span className="shrink-0 text-slate-500">{p.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                      <Film className="h-4 w-4 text-[#159D91]" />
                      <span>Assigned Reels ({employeeDetail.reels.length})</span>
                    </h4>
                    <div className="mt-2 space-y-2">
                      {employeeDetail.reels.length === 0 ? (
                        <p className="text-xs text-slate-500">No reels assigned.</p>
                      ) : (
                        employeeDetail.reels.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                          >
                            <span className="truncate font-semibold text-slate-800">
                              {r.title}
                            </span>
                            <span className="shrink-0 text-slate-500">{r.status}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Recent Activities */}
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Recent Activities
                  </h4>
                  {employeeDetail.recentActivities.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">
                      No recent activity recorded.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {employeeDetail.recentActivities.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 text-xs last:border-b-0"
                        >
                          <span className="font-medium text-slate-700">{a.title}</span>
                          <span className="tabular-nums shrink-0 text-slate-400">
                            {formatDisplayDateTime(a.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Confirm Delete / Deactivate */}
      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={
          confirmTarget?.mode === 'delete'
            ? `Delete ${confirmTarget.employee.fullName}?`
            : `${
                confirmTarget?.employee.isActive ? 'Deactivate' : 'Activate'
              } ${confirmTarget?.employee.fullName}?`
        }
        message={
          confirmTarget?.mode === 'delete'
            ? 'This permanently removes the employee record. Unrelated tasks, posters, and reels remain preserved.'
            : `Are you sure you want to mark this employee as ${
                confirmTarget?.employee.isActive ? 'inactive' : 'active'
              }?`
        }
        confirmLabel={
          confirmTarget?.mode === 'delete'
            ? 'Delete Employee'
            : confirmTarget?.employee.isActive
            ? 'Deactivate'
            : 'Activate'
        }
        danger={confirmTarget?.mode === 'delete'}
        loading={confirmLoading}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
