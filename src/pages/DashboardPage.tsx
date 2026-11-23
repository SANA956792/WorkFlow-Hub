import React from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  CheckSquare,
  Clock,
  Eye,
  Film,
  Image as ImageIcon,
  Layers,
  Send,
  Users,
} from 'lucide-react';
import {
  CompanySettings,
  DashboardSummary,
  NavSection,
  PosterStatus,
  ReelStatus,
  TaskStatus,
} from '../types';
import { formatDisplayDate, formatDisplayDateTime, formatTime12h } from '../utils/dates';
import { getAvatarColor, getInitials, getStatusBadgeStyle } from '../utils/colors';

interface DashboardPageProps {
  summary: DashboardSummary | null;
  loading: boolean;
  error: string | null;
  settings: CompanySettings | null;
  onRetry: () => void;
  onNavigate: (
    section: NavSection,
    opts?: {
      taskStatus?: TaskStatus | 'All';
      taskDeadlineFilter?: 'all' | 'today' | 'upcoming' | 'overdue';
      posterStatus?: PosterStatus | 'All';
      reelStatus?: ReelStatus | 'All';
      employeeId?: string;
      taskId?: string;
      posterId?: string;
      reelId?: string;
    }
  ) => void;
}

export function DashboardPage({
  summary,
  loading,
  error,
  settings,
  onRetry,
  onNavigate,
}: DashboardPageProps) {
  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 9 }).map((_, idx) => (
            <div
              key={idx}
              className="h-28 animate-pulse rounded-2xl bg-slate-200"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-2xl bg-slate-200" />
          <div className="h-72 animate-pulse rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-[#E85D65]" />
        <h3 className="mt-3 text-base font-bold text-slate-900">
          Unable to load dashboard
        </h3>
        <p className="mt-1 text-sm text-slate-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-xl bg-[#4776E6] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Retry
        </button>
      </div>
    );
  }

  const kpis = summary?.kpis ?? {
    totalEmployees: 0,
    totalTasks: 0,
    pendingTasks: 0,
    inProgressTasks: 0,
    underReviewTasks: 0,
    completedTasks: 0,
    overdueTasks: 0,
    totalPosters: 0,
    totalReels: 0,
  };

  const kpiCards = [
    {
      label: 'Total Employees',
      value: kpis.totalEmployees,
      bg: '#4776E6',
      icon: Users,
      onClick: () => onNavigate('employees'),
    },
    {
      label: 'Total Tasks',
      value: kpis.totalTasks,
      bg: '#8757D5',
      icon: CheckSquare,
      onClick: () => onNavigate('tasks', { taskStatus: 'All' }),
    },
    {
      label: 'Pending Tasks',
      value: kpis.pendingTasks,
      bg: '#F29A38',
      icon: Clock,
      onClick: () => onNavigate('tasks', { taskStatus: 'Pending' }),
    },
    {
      label: 'In Progress Tasks',
      value: kpis.inProgressTasks,
      bg: '#16A6C1',
      icon: Layers,
      onClick: () => onNavigate('tasks', { taskStatus: 'In Progress' }),
    },
    {
      label: 'Under Review Tasks',
      value: kpis.underReviewTasks,
      bg: '#6366F1',
      icon: Eye,
      onClick: () => onNavigate('tasks', { taskStatus: 'Under Review' }),
    },
    {
      label: 'Completed Tasks',
      value: kpis.completedTasks,
      bg: '#20A779',
      icon: CheckCircle2,
      onClick: () => onNavigate('tasks', { taskStatus: 'Completed' }),
    },
    {
      label: 'Overdue Tasks',
      value: kpis.overdueTasks,
      bg: '#E85D65',
      icon: AlertCircle,
      onClick: () =>
        onNavigate('tasks', { taskStatus: 'All', taskDeadlineFilter: 'overdue' }),
    },
    {
      label: 'Total Posters',
      value: kpis.totalPosters,
      bg: '#E85B9A',
      icon: ImageIcon,
      onClick: () => onNavigate('posters', { posterStatus: 'All' }),
    },
    {
      label: 'Total Reels',
      value: kpis.totalReels,
      bg: '#159D91',
      icon: Film,
      onClick: () => onNavigate('reels', { reelStatus: 'All' }),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Brand Welcome Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white px-6 py-4 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1">
            {settings?.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt="Company Logo"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-sm font-bold text-[#4776E6]">WO</span>
            )}
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
              {settings?.companyName || 'WORK ORGANIZER'} Overview
            </h1>
            <p className="text-sm text-slate-500">
              Live company operations, creative production, and publishing schedule
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('tasks')}
            className="rounded-xl bg-[#4776E6] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 whitespace-nowrap shrink-0"
          >
            Manage Tasks
          </button>
          <button
            type="button"
            onClick={() => onNavigate('calendar')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Open Calendar
          </button>
        </div>
      </div>

      {/* 9 Full-Background Colored KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={card.onClick}
              style={{ backgroundColor: card.bg }}
              className="group flex flex-col justify-between rounded-2xl p-5 text-left text-white shadow-sm transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-white/95">
                  {card.label}
                </span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20">
                  <Icon className="h-5 w-5 text-white" />
                </span>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <span className="tabular-nums text-3xl font-extrabold tracking-tight">
                  {card.value}
                </span>
                <span className="text-xs font-medium text-white/85 group-hover:underline">
                  View →
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Middle Grid: Today's Work + Upcoming Deadlines */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Today's Work */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="text-base font-bold text-slate-900">Today&apos;s Work</h2>
              <p className="text-xs text-slate-500">Tasks due today</p>
            </div>
            <button
              type="button"
              onClick={() =>
                onNavigate('tasks', { taskStatus: 'All', taskDeadlineFilter: 'today' })
              }
              className="text-xs font-semibold text-[#4776E6] hover:underline"
            >
              View all
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {!summary?.todaysWork.length ? (
              <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No tasks due today.
              </div>
            ) : (
              summary.todaysWork.map((task) => {
                const badge = getStatusBadgeStyle(task.status);
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onNavigate('tasks', { taskId: task.id })}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-left transition-colors hover:bg-slate-100/80"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-500">
                          {task.taskCode}
                        </span>
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {task.title}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {task.assignedEmployees.length > 0
                          ? task.assignedEmployees.map((e) => e.fullName).join(', ')
                          : 'Unassigned'}
                      </div>
                    </div>
                    <span
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.text,
                        borderColor: badge.border,
                      }}
                      className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                    >
                      {task.status}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Upcoming Deadlines */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Upcoming Deadlines
              </h2>
              <p className="text-xs text-slate-500">
                Tasks, poster designs, and reel edits
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="text-xs font-semibold text-[#4776E6] hover:underline"
            >
              Calendar
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {!summary?.upcomingDeadlines.length ? (
              <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No upcoming deadlines scheduled.
              </div>
            ) : (
              summary.upcomingDeadlines.map((item) => {
                const badge = getStatusBadgeStyle(item.status);
                const kindColor =
                  item.entityType === 'task'
                    ? '#4776E6'
                    : item.entityType === 'poster'
                    ? '#E85B9A'
                    : '#F29A38';
                return (
                  <button
                    key={`${item.entityType}-${item.id}`}
                    type="button"
                    onClick={() => {
                      if (item.entityType === 'task') {
                        onNavigate('tasks', { taskId: item.id });
                      } else if (item.entityType === 'poster') {
                        onNavigate('posters', { posterId: item.id });
                      } else {
                        onNavigate('reels', { reelId: item.id });
                      }
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-left transition-colors hover:bg-slate-100/80"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          style={{ backgroundColor: kindColor }}
                          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                        >
                          {item.deadlineKind}
                        </span>
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {item.title}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        <span className="tabular-nums">
                          {formatDisplayDate(item.deadlineDate)}
                        </span>
                        {item.assigneeNames.length > 0 && (
                          <>
                            <span>·</span>
                            <span className="truncate">
                              {item.assigneeNames.join(', ')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.text,
                        borderColor: badge.border,
                      }}
                      className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                    >
                      {item.status}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Bottom Grid: Upcoming Publishing + Recent Activities */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming Publishing */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Upcoming Publishing
              </h2>
              <p className="text-xs text-slate-500">
                Scheduled posters and reels with publish times
              </p>
            </div>
            <Send className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-4 space-y-3">
            {!summary?.upcomingPublishing.length ? (
              <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No scheduled posters or reels yet.
              </div>
            ) : (
              summary.upcomingPublishing.map((item) => {
                const badge = getStatusBadgeStyle(item.status);
                const isPoster = item.entityType === 'poster';
                return (
                  <button
                    key={`${item.entityType}-pub-${item.id}`}
                    type="button"
                    onClick={() =>
                      isPoster
                        ? onNavigate('posters', { posterId: item.id })
                        : onNavigate('reels', { reelId: item.id })
                    }
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-left transition-colors hover:bg-slate-100/80"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        style={{ backgroundColor: isPoster ? '#8757D5' : '#159D91' }}
                        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-white"
                      >
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : isPoster ? (
                          <ImageIcon className="h-4 w-4" />
                        ) : (
                          <Film className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">
                          {item.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span className="font-medium text-slate-700">
                            {item.platform}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {formatDisplayDate(item.publishingDate)}
                            {item.publishingTime
                              ? ` at ${formatTime12h(item.publishingTime)}`
                              : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span
                      style={{
                        backgroundColor: badge.bg,
                        color: badge.text,
                        borderColor: badge.border,
                      }}
                      className="shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
                    >
                      {item.status}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Recent Activities */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Recent Activities
              </h2>
              <p className="text-xs text-slate-500">
                Latest team actions, uploads, and status updates
              </p>
            </div>
          </div>
          <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
            {!summary?.recentActivities.length ? (
              <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                Activity updates will appear here as your team creates and updates work.
              </div>
            ) : (
              summary.recentActivities.map((act) => (
                <div
                  key={act.id}
                  className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {act.title}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      <span>{act.actorName}</span>
                      {act.details ? (
                        <>
                          <span> · </span>
                          <span>{act.details}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span className="tabular-nums shrink-0 text-xs text-slate-400">
                    {formatDisplayDateTime(act.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Employee Overview Table */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Employee Overview</h2>
            <p className="text-xs text-slate-500">
              Task allocation and completion across team members
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('employees')}
            className="text-xs font-semibold text-[#4776E6] hover:underline"
          >
            Manage Employees
          </button>
        </div>

        {!summary?.employeeOverview.length ? (
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No employees added yet. Add your first team member in the Employees section.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-semibold text-slate-500">
                  <th className="py-3 pr-4">Employee</th>
                  <th className="py-3 px-4">Department</th>
                  <th className="py-3 px-4 text-right">Assigned</th>
                  <th className="py-3 px-4 text-right">Completed</th>
                  <th className="py-3 pl-4 text-right">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.employeeOverview.map((emp) => (
                  <tr
                    key={emp.id}
                    onClick={() => onNavigate('employees', { employeeId: emp.id })}
                    className="cursor-pointer transition-colors hover:bg-slate-50"
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            backgroundColor: emp.profileImageUrl
                              ? undefined
                              : getAvatarColor(emp.fullName),
                          }}
                          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white"
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
                          <div className="truncate font-semibold text-slate-900">
                            {emp.fullName}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {emp.designation}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{emp.department}</td>
                    <td className="tabular-nums py-3 px-4 text-right font-semibold text-slate-900">
                      {emp.assignedTasks}
                    </td>
                    <td className="tabular-nums py-3 px-4 text-right font-semibold text-[#20A779]">
                      {emp.completedTasks}
                    </td>
                    <td className="tabular-nums py-3 pl-4 text-right font-semibold text-[#F29A38]">
                      {emp.pendingTasks}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
