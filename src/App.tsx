import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Menu, RefreshCw, X } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import {
  CalendarEvent,
  CompanySettings,
  DashboardSummary,
  Employee,
  NavSection,
  PosterRecord,
  PosterStatus,
  ReelRecord,
  ReelStatus,
  TaskRecord,
  TaskStatus,
} from './types';
import { settingsService } from './services/settingsService';
import { storageServiceUploadLogo } from './services/logoHelper';
import { dashboardService } from './services/dashboardService';
import { employeeService } from './services/employeeService';
import { taskService } from './services/taskService';
import { posterService } from './services/posterService';
import { reelService } from './services/reelService';
import { Sidebar } from './components/Sidebar';
import { DashboardPage } from './pages/DashboardPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { TasksPage } from './pages/TasksPage';
import { PostersPage } from './pages/PostersPage';
import { ReelsPage } from './pages/ReelsPage';
import { CalendarPage } from './pages/CalendarPage';

export default function App() {
  const { user, loading: authLoading, authError, signInWithGoogle, signOut } =
    useAuth();

  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [posters, setPosters] = useState<PosterRecord[]>([]);
  const [reels, setReels] = useState<ReelRecord[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Navigation deep-link filters/selections
  const [taskStatusFilter, setTaskStatusFilter] = useState<
    TaskStatus | 'All' | undefined
  >(undefined);
  const [taskDeadlineFilter, setTaskDeadlineFilter] = useState<
    'all' | 'today' | 'upcoming' | 'overdue' | undefined
  >(undefined);
  const [posterStatusFilter, setPosterStatusFilter] = useState<
    PosterStatus | 'All' | undefined
  >(undefined);
  const [reelStatusFilter, setReelStatusFilter] = useState<
    ReelStatus | 'All' | undefined
  >(undefined);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    null
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedPosterId, setSelectedPosterId] = useState<string | null>(null);
  const [selectedReelId, setSelectedReelId] = useState<string | null>(null);

  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Sync dynamic favicon with stored company logo
  useEffect(() => {
    if (!settings?.logoUrl) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = settings.logoUrl;
  }, [settings?.logoUrl]);

  const loadSettings = useCallback(async () => {
    try {
      const s = await settingsService.getSettings();
      setSettings(s);
    } catch {
      // keep fallback favicon/logo
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const refreshAllData = useCallback(async () => {
    if (!user) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const [sum, emps, tks, psts, rls, cal] = await Promise.all([
        dashboardService.getSummary(),
        employeeService.list(),
        taskService.list(),
        posterService.list(),
        reelService.list(),
        dashboardService.getCalendarEvents(),
      ]);
      setDashboard(sum);
      setEmployees(emps);
      setTasks(tks);
      setPosters(psts);
      setReels(rls);
      setCalendarEvents(cal);
    } catch (err: any) {
      const msg = err.message || 'Failed to load workspace data.';
      setDataError(msg);
      notify('error', msg);
    } finally {
      setDataLoading(false);
    }
  }, [user, notify]);

  useEffect(() => {
    if (user) {
      refreshAllData();
    }
  }, [user, refreshAllData]);

  const handleUploadLogo = async (file: File) => {
    try {
      const updated = await storageServiceUploadLogo(file);
      setSettings(updated);
      notify('success', 'Company logo saved permanently.');
      await refreshAllData();
    } catch (err: any) {
      notify('error', err.message || 'Unable to upload company logo.');
    }
  };

  const handleNavigate = (
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
  ) => {
    setTaskStatusFilter(opts?.taskStatus);
    setTaskDeadlineFilter(opts?.taskDeadlineFilter);
    setPosterStatusFilter(opts?.posterStatus);
    setReelStatusFilter(opts?.reelStatus);
    setSelectedEmployeeId(opts?.employeeId || null);
    setSelectedTaskId(opts?.taskId || null);
    setSelectedPosterId(opts?.posterId || null);
    setSelectedReelId(opts?.reelId || null);
    setActiveSection(section);
  };

  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch {
      // handled by AuthContext
    } finally {
      setSigningIn(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#4776E6] border-t-transparent" />
          <p className="text-sm font-semibold text-slate-600">
            Loading WORK ORGANIZER...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FB] p-4">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white p-2">
              <img
                src={
                  settings?.logoUrl ||
                  '/assets/aistudio/c1a1b7c939908f430c32f54944ae2d9b_58b868bd.jpg'
                }
                alt="Company Logo"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </div>
            <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-slate-900">
              {settings?.companyName || 'WORK ORGANIZER'}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Sign in with your Google account to manage employees, tasks,
              posters, reels, and publishing schedules.
            </p>
          </div>

          {authError && (
            <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-[#E85D65]">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={signingIn}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-[#4776E6] px-5 py-3 text-sm font-bold text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <span>
              {signingIn ? 'Signing in...' : 'Sign in with Google'}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F5F7FB] text-slate-900">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={(sec) => handleNavigate(sec)}
        settings={settings}
        onUploadLogo={handleUploadLogo}
        counts={{
          employees: employees.length,
          tasks: tasks.length,
          posters: posters.length,
          reels: reels.length,
        }}
        userEmail={user.email}
        userName={user.displayName}
        onSignOut={signOut}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur-xs lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2.5 lg:hidden">
              <img
                src={
                  settings?.logoUrl ||
                  '/assets/aistudio/c1a1b7c939908f430c32f54944ae2d9b_58b868bd.jpg'
                }
                alt="Company Logo"
                referrerPolicy="no-referrer"
                className="h-7 w-7 rounded-md object-contain"
              />
              <span className="text-sm font-extrabold tracking-tight text-slate-900">
                {settings?.companyName || 'WORK ORGANIZER'}
              </span>
            </div>
            <span className="hidden text-sm font-semibold capitalize text-slate-500 lg:inline">
              {settings?.companyName || 'WORK ORGANIZER'} /{' '}
              <span className="font-bold text-slate-900">{activeSection}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={refreshAllData}
            disabled={dataLoading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${dataLoading ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </button>
        </header>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6 lg:p-8">
          {activeSection === 'dashboard' && (
            <DashboardPage
              summary={dashboard}
              loading={dataLoading}
              error={dataError}
              settings={settings}
              onRetry={refreshAllData}
              onNavigate={handleNavigate}
            />
          )}

          {activeSection === 'employees' && (
            <EmployeesPage
              employees={employees}
              loading={dataLoading}
              initialSelectedEmployeeId={selectedEmployeeId}
              onClearInitialSelection={() => setSelectedEmployeeId(null)}
              onRefresh={refreshAllData}
              onNotify={notify}
            />
          )}

          {activeSection === 'tasks' && (
            <TasksPage
              tasks={tasks}
              employees={employees}
              loading={dataLoading}
              initialStatusFilter={taskStatusFilter}
              initialDeadlineFilter={taskDeadlineFilter}
              initialSelectedTaskId={selectedTaskId}
              onClearInitialSelection={() => setSelectedTaskId(null)}
              onRefresh={refreshAllData}
              onNotify={notify}
            />
          )}

          {activeSection === 'posters' && (
            <PostersPage
              posters={posters}
              employees={employees}
              loading={dataLoading}
              initialStatusFilter={posterStatusFilter}
              initialSelectedPosterId={selectedPosterId}
              onClearInitialSelection={() => setSelectedPosterId(null)}
              onRefresh={refreshAllData}
              onNotify={notify}
            />
          )}

          {activeSection === 'reels' && (
            <ReelsPage
              reels={reels}
              employees={employees}
              loading={dataLoading}
              initialStatusFilter={reelStatusFilter}
              initialSelectedReelId={selectedReelId}
              onClearInitialSelection={() => setSelectedReelId(null)}
              onRefresh={refreshAllData}
              onNotify={notify}
            />
          )}

          {activeSection === 'calendar' && (
            <CalendarPage
              events={calendarEvents}
              loading={dataLoading}
              onOpenEvent={(sec, opts) => handleNavigate(sec, opts)}
            />
          )}
        </main>
      </div>

      {/* Real Operation Feedback Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed right-5 bottom-5 z-50 flex max-w-sm items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
            toast.type === 'success' ? 'bg-[#20A779]' : 'bg-[#E85D65]'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="rounded-lg p-1 hover:bg-white/15"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
