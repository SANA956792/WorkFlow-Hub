import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Link as LinkIcon,
  MessageSquarePlus,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  Employee,
  FileAttachment,
  TaskPriority,
  TaskRecord,
  TaskStatus,
} from '../types';
import { taskService, TaskInput } from '../services/taskService';
import {
  downloadStoredAttachment,
  uploadFileToStorage,
} from '../services/storageService';
import { ThreeDotMenu } from '../components/ThreeDotMenu';
import { ConfirmModal } from '../components/ConfirmModal';
import { PageLoadError } from '../components/PageLoadError';
import {
  formatBytes,
  formatDisplayDate,
  formatDisplayDateTime,
  getLocalTodayISO,
} from '../utils/dates';
import {
  getAvatarColor,
  getInitials,
  getPriorityBadgeStyle,
  getStatusBadgeStyle,
} from '../utils/colors';
import { safeExternalUrl } from '../utils/urls';

const TASK_TABS: (TaskStatus | 'All')[] = [
  'All',
  'Pending',
  'In Progress',
  'Under Review',
  'Revision Required',
  'Completed',
  'Cancelled',
];

const PRIORITIES: TaskPriority[] = ['Low', 'Medium', 'High', 'Urgent'];

const TAB_COLORS: Record<string, string> = {
  All: '#4776E6',
  Pending: '#F29A38',
  'In Progress': '#16A6C1',
  'Under Review': '#8757D5',
  'Revision Required': '#E85D65',
  Completed: '#20A779',
  Cancelled: '#64748B',
};

interface TasksPageProps {
  tasks: TaskRecord[];
  employees: Employee[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  onRetry: () => void;
  initialStatusFilter?: TaskStatus | 'All';
  initialDeadlineFilter?: 'all' | 'today' | 'upcoming' | 'overdue';
  initialSelectedTaskId?: string | null;
  onClearInitialSelection?: () => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error', message: string) => void;
}

export function TasksPage({
  tasks,
  employees,
  loading,
  loaded,
  error,
  onRetry,
  initialStatusFilter,
  initialDeadlineFilter,
  initialSelectedTaskId,
  onClearInitialSelection,
  onRefresh,
  onNotify,
}: TasksPageProps) {
  const [activeTab, setActiveTab] = useState<TaskStatus | 'All'>(
    initialStatusFilter || 'All'
  );
  const [search, setSearch] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [deadlineFilter, setDeadlineFilter] = useState<
    'all' | 'today' | 'upcoming' | 'overdue'
  >(initialDeadlineFilter || 'all');

  useEffect(() => {
    if (initialStatusFilter) setActiveTab(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    if (initialDeadlineFilter) setDeadlineFilter(initialDeadlineFilter);
  }, [initialDeadlineFilter]);

  // Form Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRecord | null>(null);
  const [taskCode, setTaskCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [priority, setPriority] = useState<TaskPriority>('Medium');
  const [status, setStatus] = useState<TaskStatus>('Pending');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [instructions, setInstructions] = useState('');
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [referenceLinksText, setReferenceLinksText] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Detail Drawer/Modal state
  const [detailTask, setDetailTask] = useState<TaskRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentStatus, setCommentStatus] = useState<string>('');
  const [commentAttachments, setCommentAttachments] = useState<FileAttachment[]>([]);
  const [uploadingWork, setUploadingWork] = useState(false);
  const [postingUpdate, setPostingUpdate] = useState(false);
  const workInputRef = useRef<HTMLInputElement>(null);

  // Quick Status Modal
  const [statusModalTask, setStatusModalTask] = useState<TaskRecord | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<TaskRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const todayStr = getLocalTodayISO();

  const categories = useMemo(() => {
    const set = new Set<string>(['General']);
    tasks.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return ['All', ...Array.from(set).sort()];
  }, [tasks]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { All: tasks.length };
    for (const tab of TASK_TABS) {
      if (tab !== 'All') {
        counts[tab] = tasks.filter((t) => t.status === tab).length;
      }
    }
    return counts;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (activeTab !== 'All' && t.status !== activeTab) return false;
      if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false;
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
      if (
        employeeFilter !== 'All' &&
        !t.assignedEmployeeIds.includes(employeeFilter)
      ) {
        return false;
      }
      if (deadlineFilter === 'today' && t.dueDate !== todayStr) return false;
      if (
        deadlineFilter === 'upcoming' &&
        (!t.dueDate || t.dueDate < todayStr || t.status === 'Completed' || t.status === 'Cancelled')
      ) {
        return false;
      }
      if (
        deadlineFilter === 'overdue' &&
        (!t.dueDate || t.dueDate >= todayStr || t.status === 'Completed' || t.status === 'Cancelled')
      ) {
        return false;
      }
      if (q) {
        const assignees = t.assignedEmployees.map((e) => e.fullName).join(' ');
        const hay = `${t.taskCode} ${t.title} ${t.description} ${t.category} ${assignees}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    tasks,
    activeTab,
    priorityFilter,
    categoryFilter,
    employeeFilter,
    deadlineFilter,
    search,
    todayStr,
  ]);

  const openTaskDetail = async (taskId: string) => {
    setDetailLoading(true);
    setCommentText('');
    setCommentStatus('');
    setCommentAttachments([]);
    try {
      const full = await taskService.getDetail(taskId);
      setDetailTask(full);
    } catch (err: any) {
      onNotify('error', err.message || 'Unable to load task details.');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (initialSelectedTaskId) {
      openTaskDetail(initialSelectedTaskId);
      onClearInitialSelection?.();
    }
  }, [initialSelectedTaskId]);

  const openCreateModal = () => {
    setEditingTask(null);
    setTaskCode('');
    setTitle('');
    setDescription('');
    setCategory('General');
    setPriority('Medium');
    setStatus('Pending');
    setStartDate(todayStr);
    setDueDate('');
    setInstructions('');
    setAssignedIds([]);
    setReferenceLinksText('');
    setAttachments([]);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (t: TaskRecord) => {
    setEditingTask(t);
    setTaskCode(t.taskCode);
    setTitle(t.title);
    setDescription(t.description);
    setCategory(t.category);
    setPriority(t.priority);
    setStatus(t.status);
    setStartDate(t.startDate || '');
    setDueDate(t.dueDate || '');
    setInstructions(t.instructions);
    setAssignedIds(t.assignedEmployeeIds);
    setReferenceLinksText(t.referenceLinks.join('\n'));
    setAttachments(t.attachments);
    setFormError(null);
    setFormOpen(true);
  };

  const toggleEmployeeAssignment = (empId: string) => {
    setAssignedIds((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const handleAttachmentUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAttachment(true);
    setFormError(null);
    try {
      const uploaded = await uploadFileToStorage('task-attachments', file);
      setAttachments((prev) => [...prev, uploaded]);
    } catch (err: any) {
      setFormError(err.message || 'Failed to upload attachment.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploadingAttachment) return;
    if (!title.trim()) {
      setFormError('Task title is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const referenceLinks = referenceLinksText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: TaskInput = {
        taskCode: taskCode.trim() || undefined,
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || 'General',
        priority,
        status,
        startDate: startDate || null,
        dueDate: dueDate || null,
        instructions: instructions.trim(),
        assignedEmployeeIds: assignedIds,
        referenceLinks,
        attachments,
      };

      if (editingTask) {
        await taskService.update(editingTask.id, payload);
        onNotify('success', `Updated task "${title.trim()}"`);
      } else {
        await taskService.create(payload);
        onNotify('success', `Created task "${title.trim()}"`);
      }

      setFormOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save task.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatusChange = async (
    t: TaskRecord,
    nextStatus: TaskStatus
  ) => {
    if (statusUpdating) return;
    setStatusUpdating(true);
    try {
      const updated = await taskService.update(t.id, { status: nextStatus });
      if (detailTask?.id === t.id) {
        setDetailTask(updated);
      }
      setStatusModalTask(null);
      onNotify('success', `Task status updated to ${nextStatus}`);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleWorkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingWork(true);
    try {
      const uploaded = await uploadFileToStorage('task-attachments', file);
      setCommentAttachments((prev) => [...prev, uploaded]);
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to upload completed work.');
    } finally {
      setUploadingWork(false);
    }
  };

  const handlePostTaskUpdate = async (
    e: React.FormEvent,
    overrideStatus?: TaskStatus,
    overrideComment?: string
  ) => {
    e.preventDefault();
    if (!detailTask || postingUpdate || uploadingWork) return;
    const msg = (overrideComment ?? commentText).trim();
    if (!msg) {
      onNotify('error', 'Please enter a comment or progress note.');
      return;
    }

    setPostingUpdate(true);
    try {
      const nextStatus =
        overrideStatus || (commentStatus ? (commentStatus as TaskStatus) : null);
      const updated = await taskService.addUpdate(detailTask.id, {
        comment: msg,
        statusChangeTo: nextStatus,
        attachments: commentAttachments,
        updateType: overrideStatus ? 'review' : 'comment',
      });
      setDetailTask(updated);
      setCommentText('');
      setCommentStatus('');
      setCommentAttachments([]);
      onNotify('success', 'Task update saved.');
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to save update.');
    } finally {
      setPostingUpdate(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await taskService.remove(deleteTarget.id);
      if (detailTask?.id === deleteTarget.id) setDetailTask(null);
      onNotify('success', `Deleted task "${deleteTarget.title}"`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to delete task.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Tasks
          </h1>
          <p className="text-sm text-slate-500">
            Assign work, track progress, review deliverables, and manage deadlines
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-[#8757D5] px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Create Task</span>
        </button>
      </div>

      {/* Status Tabs with Counts */}
      <div className="flex flex-wrap items-center gap-2">
        {TASK_TABS.map((tab) => {
          const active = activeTab === tab;
          const activeBg = TAB_COLORS[tab] || '#4776E6';
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={active ? { backgroundColor: activeBg } : undefined}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>{tab}</span>
              <span
                className={`tabular-nums rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                  active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {tabCounts[tab] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search & Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-10 text-sm focus:border-[#8757D5] focus:bg-white focus:outline-none"
          />
        </div>

        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#8757D5] focus:outline-none"
        >
          <option value="All">All Employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.fullName}
            </option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#8757D5] focus:outline-none"
        >
          <option value="All">All Priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p} Priority
            </option>
          ))}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#8757D5] focus:outline-none"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'All' ? 'All Categories' : c}
            </option>
          ))}
        </select>

        <select
          value={deadlineFilter}
          onChange={(e) => setDeadlineFilter(e.target.value as any)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#8757D5] focus:outline-none"
        >
          <option value="all">All Deadlines</option>
          <option value="today">Due Today</option>
          <option value="upcoming">Upcoming</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      {error && loaded && (
        <PageLoadError
          title="Could not refresh tasks"
          message={error}
          retrying={loading}
          onRetry={onRetry}
          variant="banner"
        />
      )}

      {/* Tasks List */}
      {loading && !loaded && tasks.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200" />
          ))}
        </div>
      ) : error && !loaded && tasks.length === 0 ? (
        <PageLoadError
          title="Unable to load tasks"
          message={error}
          retrying={loading}
          onRetry={onRetry}
          variant="card"
        />
      ) : loaded && filteredTasks.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-12 text-center">
          <h3 className="text-base font-bold text-slate-900">
            {tasks.length === 0 ? 'No tasks created yet' : 'No tasks match your filters'}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {tasks.length === 0
              ? 'Create a task and assign it to one or more employees.'
              : 'Adjust the status tab, search, or filters to see tasks.'}
          </p>
          {tasks.length === 0 && (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 rounded-xl bg-[#8757D5] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Create First Task
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredTasks.map((t) => {
            const statusStyle = getStatusBadgeStyle(t.status);
            const priorityStyle = getPriorityBadgeStyle(t.priority);
            const isOverdue =
              t.dueDate &&
              t.dueDate < todayStr &&
              t.status !== 'Completed' &&
              t.status !== 'Cancelled';

            return (
              <div
                key={t.id}
                onClick={() => openTaskDetail(t.id)}
                className="cursor-pointer rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-400">
                        {t.taskCode}
                      </span>
                      <span
                        style={{
                          backgroundColor: priorityStyle.bg,
                          color: priorityStyle.text,
                        }}
                        className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                      >
                        {t.priority}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {t.category}
                      </span>
                    </div>
                    <h3 className="mt-1.5 text-base font-bold text-slate-900">
                      {t.title}
                    </h3>
                    {t.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                        {t.description}
                      </p>
                    )}
                  </div>

                  <ThreeDotMenu
                    actions={[
                      {
                        label: 'View Details',
                        icon: <Eye className="h-4 w-4" />,
                        onClick: () => openTaskDetail(t.id),
                      },
                      {
                        label: 'Edit Task',
                        icon: <Edit3 className="h-4 w-4" />,
                        onClick: () => openEditModal(t),
                      },
                      {
                        label: 'Change Status',
                        icon: <RefreshCw className="h-4 w-4" />,
                        onClick: () => setStatusModalTask(t),
                      },
                      {
                        label: 'Delete Task',
                        icon: <Trash2 className="h-4 w-4" />,
                        danger: true,
                        onClick: () => setDeleteTarget(t),
                      },
                    ]}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5">
                  {/* Assignees */}
                  <div className="flex items-center gap-2">
                    {t.assignedEmployees.length === 0 ? (
                      <span className="text-xs text-slate-400">Unassigned</span>
                    ) : (
                      <div className="flex items-center -space-x-2">
                        {t.assignedEmployees.slice(0, 4).map((emp) => (
                          <div
                            key={emp.id}
                            title={emp.fullName}
                            style={{
                              backgroundColor: emp.profileImageUrl
                                ? undefined
                                : getAvatarColor(emp.fullName),
                            }}
                            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white text-[10px] font-bold text-white"
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
                        ))}
                        {t.assignedEmployees.length > 4 && (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-bold text-slate-700">
                            +{t.assignedEmployees.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                    {t.assignedEmployees.length > 0 && (
                      <span className="max-w-[140px] truncate text-xs text-slate-600">
                        {t.assignedEmployees.map((e) => e.fullName).join(', ')}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {t.dueDate && (
                      <span
                        className={`tabular-nums inline-flex items-center gap-1 text-xs font-medium ${
                          isOverdue ? 'font-bold text-[#E85D65]' : 'text-slate-500'
                        }`}
                      >
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDisplayDate(t.dueDate)}
                        {isOverdue ? ' (Overdue)' : ''}
                      </span>
                    )}
                    <span
                      style={{
                        backgroundColor: statusStyle.bg,
                        color: statusStyle.text,
                        borderColor: statusStyle.border,
                      }}
                      className="rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                    >
                      {t.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Task Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-extrabold text-slate-900">
                {editingTask ? 'Edit Task' : 'Create Task'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="mt-5 space-y-4">
              {formError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-[#E85D65]">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Task Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Q4 Brand Campaign Assets"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Task ID
                  </label>
                  <input
                    type="text"
                    value={taskCode}
                    onChange={(e) => setTaskCode(e.target.value)}
                    placeholder="Auto if blank"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Overview of deliverables and goals..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Category
                  </label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Design, Marketing, Ops..."
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as TaskPriority)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as TaskStatus)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                  >
                    {TASK_TABS.filter((t) => t !== 'All').map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                  />
                </div>
              </div>

              {/* Assign Employees (multi-select) */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Assign Employees
                </label>
                {employees.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No employees available. Add employees first.
                  </p>
                ) : (
                  <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-xl border border-slate-200 p-2.5">
                    {employees.map((emp) => {
                      const selected = assignedIds.includes(emp.id);
                      return (
                        <button
                          key={emp.id}
                          type="button"
                          onClick={() => toggleEmployeeAssignment(emp.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                            selected
                              ? 'border-[#8757D5] bg-[#8757D5] text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span>{emp.fullName}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Instructions
                </label>
                <textarea
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Step-by-step requirements or brand guidelines..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Reference Links (one URL per line)
                </label>
                <textarea
                  rows={2}
                  value={referenceLinksText}
                  onChange={(e) => setReferenceLinksText(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                />
              </div>

              {/* Attachments */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Attachments
                  </label>
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={uploadingAttachment}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>
                      {uploadingAttachment ? 'Uploading...' : 'Attach File'}
                    </span>
                  </button>
                  <input
                    ref={attachmentInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleAttachmentUpload}
                  />
                </div>
                {attachments.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {attachments.map((att) => (
                      <div
                        key={att.fileId}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs"
                      >
                        <span className="truncate font-medium text-slate-700">
                          {att.fileName} ({formatBytes(att.sizeBytes)})
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) =>
                              prev.filter((x) => x.fileId !== att.fileId)
                            )
                          }
                          className="text-slate-400 hover:text-[#E85D65]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

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
                  disabled={saving || uploadingAttachment}
                  className="rounded-xl bg-[#8757D5] px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {saving
                    ? 'Saving...'
                    : editingTask
                    ? 'Save Changes'
                    : 'Create Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {(detailTask || detailLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-lg font-extrabold text-slate-900">Task Details</h2>
              <button
                type="button"
                onClick={() => setDetailTask(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {detailLoading && !detailTask ? (
              <div className="space-y-4 py-8">
                <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
                <div className="h-44 animate-pulse rounded-2xl bg-slate-100" />
              </div>
            ) : detailTask ? (
              <div className="mt-5 space-y-6">
                {/* Header & Status Controls */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-400">
                        {detailTask.taskCode}
                      </span>
                      <span
                        style={{
                          backgroundColor: getPriorityBadgeStyle(detailTask.priority).bg,
                          color: getPriorityBadgeStyle(detailTask.priority).text,
                        }}
                        className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                      >
                        {detailTask.priority}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {detailTask.category}
                      </span>
                    </div>
                    <h3 className="mt-1 text-xl font-extrabold text-slate-900">
                      {detailTask.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>Start: {formatDisplayDate(detailTask.startDate)}</span>
                      <span>Due: {formatDisplayDate(detailTask.dueDate)}</span>
                      <span>
                        Updated: {formatDisplayDateTime(detailTask.updatedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={detailTask.status}
                      disabled={statusUpdating}
                      onChange={(e) =>
                        handleQuickStatusChange(
                          detailTask,
                          e.target.value as TaskStatus
                        )
                      }
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-[#8757D5] focus:outline-none"
                    >
                      {TASK_TABS.filter((t) => t !== 'All').map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const target = detailTask;
                        setDetailTask(null);
                        openEditModal(target);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Edit</span>
                    </button>
                  </div>
                </div>

                {/* Reviewer Quick Actions */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                  <span className="mr-2 text-xs font-bold text-slate-600">
                    Review Actions:
                  </span>
                  <button
                    type="button"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleQuickStatusChange(detailTask, 'Under Review')
                    }
                    className="rounded-lg bg-[#8757D5] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Submit for Review
                  </button>
                  <button
                    type="button"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleQuickStatusChange(detailTask, 'Completed')
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-[#20A779] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Approve & Complete</span>
                  </button>
                  <button
                    type="button"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleQuickStatusChange(detailTask, 'Revision Required')
                    }
                    className="inline-flex items-center gap-1 rounded-lg bg-[#E85D65] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Request Revision</span>
                  </button>
                </div>

                {/* Description & Instructions */}
                {(detailTask.description || detailTask.instructions) && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {detailTask.description && (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                        <div className="text-xs font-bold text-slate-500">
                          Description
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">
                          {detailTask.description}
                        </p>
                      </div>
                    )}
                    {detailTask.instructions && (
                      <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                        <div className="text-xs font-bold text-slate-500">
                          Instructions
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">
                          {detailTask.instructions}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Assigned Employees */}
                <div>
                  <div className="text-xs font-bold text-slate-500">
                    Assigned Employees
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detailTask.assignedEmployees.length === 0 ? (
                      <span className="text-xs text-slate-400">
                        No employees assigned
                      </span>
                    ) : (
                      detailTask.assignedEmployees.map((emp) => (
                        <div
                          key={emp.id}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800"
                        >
                          <span>{emp.fullName}</span>
                          <span className="text-slate-400">· {emp.designation}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Attachments & Links */}
                {(detailTask.attachments.length > 0 ||
                  detailTask.referenceLinks.length > 0) && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {detailTask.attachments.length > 0 && (
                      <div>
                        <div className="text-xs font-bold text-slate-500">
                          Task Attachments
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {detailTask.attachments.map((att) => (
                            <a
                              key={att.fileId}
                              href={att.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => {
                                if (att.sizeBytes > 3 * 1024 * 1024) {
                                  e.preventDefault();
                                  downloadStoredAttachment(att).catch((err) =>
                                    onNotify('error', err?.message || 'Download failed.')
                                  );
                                }
                              }}
                              className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-[#4776E6] hover:bg-slate-50"
                            >
                              <span className="inline-flex items-center gap-2 truncate">
                                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{att.fileName}</span>
                              </span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {detailTask.referenceLinks.length > 0 && (
                      <div>
                        <div className="text-xs font-bold text-slate-500">
                          Reference Links
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {detailTask.referenceLinks.map((lnk, idx) => {
                            const safeHref = safeExternalUrl(lnk);
                            return safeHref ? (
                              <a
                                key={idx}
                                href={safeHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-[#4776E6] hover:bg-slate-50"
                              >
                                <span className="inline-flex items-center gap-2 truncate">
                                  <LinkIcon className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{lnk}</span>
                                </span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              </a>
                            ) : (
                              <span
                                key={idx}
                                className="block truncate rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500"
                              >
                                {lnk}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Comments & Completed Work Submission */}
                <div className="border-t border-slate-100 pt-5">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <MessageSquarePlus className="h-4 w-4 text-[#8757D5]" />
                    <span>Comments, Progress Updates &amp; Completed Work</span>
                  </h4>

                  <form onSubmit={handlePostTaskUpdate} className="mt-3 space-y-3">
                    <textarea
                      rows={2}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Write a progress update, review feedback, or submission notes..."
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-[#8757D5] focus:outline-none"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => workInputRef.current?.click()}
                          disabled={uploadingWork}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>
                            {uploadingWork
                              ? 'Uploading work...'
                              : 'Upload Completed Work'}
                          </span>
                        </button>
                        <input
                          ref={workInputRef}
                          type="file"
                          className="hidden"
                          onChange={handleWorkUpload}
                        />

                        <select
                          value={commentStatus}
                          onChange={(e) => setCommentStatus(e.target.value)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-[#8757D5] focus:outline-none"
                        >
                          <option value="">Keep current status</option>
                          {TASK_TABS.filter((t) => t !== 'All').map((st) => (
                            <option key={st} value={st}>
                              Also set status: {st}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="submit"
                        disabled={postingUpdate || uploadingWork}
                        className="rounded-xl bg-[#8757D5] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        {postingUpdate ? 'Posting...' : 'Post Update'}
                      </button>
                    </div>

                    {commentAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {commentAttachments.map((att) => (
                          <span
                            key={att.fileId}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span>{att.fileName}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setCommentAttachments((prev) =>
                                  prev.filter((x) => x.fileId !== att.fileId)
                                )
                              }
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </form>

                  {/* Updates Timeline */}
                  <div className="mt-4 space-y-3">
                    {!detailTask.updates?.length ? (
                      <p className="text-xs text-slate-400">
                        No comments or work submissions yet.
                      </p>
                    ) : (
                      detailTask.updates.map((upd) => (
                        <div
                          key={upd.id}
                          className="rounded-xl border border-slate-100 bg-slate-50/80 p-3.5"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-bold text-slate-900">
                              {upd.authorName}
                              {upd.statusChangeTo && (
                                <span className="ml-2 font-semibold text-[#8757D5]">
                                  → {upd.statusChangeTo}
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums text-slate-400">
                              {formatDisplayDateTime(upd.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                            {upd.comment}
                          </p>
                          {upd.attachments.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {upd.attachments.map((att) => (
                                <a
                                  key={att.fileId}
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => {
                                    if (att.sizeBytes > 3 * 1024 * 1024) {
                                      e.preventDefault();
                                      downloadStoredAttachment(att).catch((err) =>
                                        onNotify('error', err?.message || 'Download failed.')
                                      );
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-[#4776E6] hover:bg-slate-50"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  <span>{att.fileName}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Quick Change Status Modal */}
      {statusModalTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Change Task Status
              </h3>
              <button
                type="button"
                onClick={() => setStatusModalTask(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {statusModalTask.title}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {TASK_TABS.filter((t) => t !== 'All').map((st) => (
                <button
                  key={st}
                  type="button"
                  disabled={statusUpdating}
                  onClick={() =>
                    handleQuickStatusChange(statusModalTask, st as TaskStatus)
                  }
                  className={`flex items-center justify-between rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                    statusModalTask.status === st
                      ? 'border-[#8757D5] bg-[#8757D5]/10 text-[#8757D5]'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>{st}</span>
                  {statusModalTask.status === st && (
                    <span className="text-xs font-bold">Current</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete "${deleteTarget?.title}"?`}
        message="This will permanently delete this task and its update history. Employees and unrelated records will not be affected."
        confirmLabel="Delete Task"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
