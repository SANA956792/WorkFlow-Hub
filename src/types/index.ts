export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export type TaskStatus =
  | 'Pending'
  | 'In Progress'
  | 'Under Review'
  | 'Revision Required'
  | 'Completed'
  | 'Cancelled';

export type PosterStatus =
  | 'Pending'
  | 'Designing'
  | 'Under Review'
  | 'Revision Required'
  | 'Approved'
  | 'Scheduled'
  | 'Published';

export type ReelStatus =
  | 'Pending'
  | 'Editing'
  | 'Under Review'
  | 'Revision Required'
  | 'Approved'
  | 'Scheduled'
  | 'Published';

export interface FileAttachment {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface CompanySettings {
  id: number;
  companyName: string;
  logoFileId: string | null;
  logoUrl: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  profileImageFileId: string | null;
  profileImageUrl: string | null;
  department: string;
  designation: string;
  phone: string | null;
  joiningDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeSummaryStats {
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  assignedPosters: number;
  assignedReels: number;
}

export interface EmployeeDetail extends Employee {
  stats: EmployeeSummaryStats;
  tasks: TaskRecord[];
  posters: PosterRecord[];
  reels: ReelRecord[];
  recentActivities: ActivityLog[];
}

export interface TaskUpdateRecord {
  id: string;
  taskId: string;
  employeeId: string | null;
  authorName: string;
  authorUid: string | null;
  updateType: string;
  comment: string;
  statusChangeTo: string | null;
  attachments: FileAttachment[];
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  taskCode: string;
  title: string;
  description: string;
  category: string;
  startDate: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  instructions: string;
  attachments: FileAttachment[];
  referenceLinks: string[];
  status: TaskStatus;
  assignedEmployees: Employee[];
  assignedEmployeeIds: string[];
  updates?: TaskUpdateRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PosterRecord {
  id: string;
  posterCode: string;
  title: string;
  description: string;
  campaignName: string;
  imageFileId: string | null;
  imageUrl: string | null;
  assignedDesignerId: string | null;
  assignedWriterId: string | null;
  assignedDesigner: Employee | null;
  assignedWriter: Employee | null;
  platform: string;
  designDeadline: string | null;
  publishingDate: string | null;
  publishingTime: string | null;
  caption: string;
  hashtags: string;
  referenceLinks: string[];
  notes: string;
  status: PosterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ReelRecord {
  id: string;
  reelCode: string;
  title: string;
  description: string;
  campaignName: string;
  referenceVideoFileId: string | null;
  referenceVideoUrl: string | null;
  referenceVideoLink: string;
  finalVideoFileId: string | null;
  finalVideoUrl: string | null;
  assignedEditorId: string | null;
  assignedCreatorId: string | null;
  assignedEditor: Employee | null;
  assignedCreator: Employee | null;
  platform: string;
  editingDeadline: string | null;
  publishingDate: string | null;
  publishingTime: string | null;
  script: string;
  caption: string;
  hashtags: string;
  referenceLinks: string[];
  notes: string;
  status: ReelStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityLog {
  id: string;
  entityType: 'employee' | 'task' | 'poster' | 'reel' | 'company';
  entityId: string;
  action: string;
  title: string;
  details: string;
  actorName: string;
  actorUid: string | null;
  createdAt: string;
}

export interface DashboardKPIs {
  totalEmployees: number;
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  underReviewTasks: number;
  completedTasks: number;
  overdueTasks: number;
  totalPosters: number;
  totalReels: number;
}

export interface UpcomingDeadlineItem {
  id: string;
  entityType: 'task' | 'poster' | 'reel';
  code: string;
  title: string;
  deadlineDate: string;
  deadlineKind: string;
  status: string;
  assigneeNames: string[];
}

export interface UpcomingPublishingItem {
  id: string;
  entityType: 'poster' | 'reel';
  code: string;
  title: string;
  platform: string;
  publishingDate: string;
  publishingTime: string | null;
  status: string;
  thumbnailUrl: string | null;
}

export interface EmployeeOverviewItem {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  profileImageUrl: string | null;
  isActive: boolean;
  assignedTasks: number;
  completedTasks: number;
  pendingTasks: number;
}

export interface DashboardSummary {
  kpis: DashboardKPIs;
  todaysWork: TaskRecord[];
  upcomingDeadlines: UpcomingDeadlineItem[];
  recentActivities: ActivityLog[];
  upcomingPublishing: UpcomingPublishingItem[];
  employeeOverview: EmployeeOverviewItem[];
}

export interface CalendarEvent {
  id: string;
  sourceId: string;
  entityType: 'task' | 'poster' | 'reel';
  eventType:
    | 'task_deadline'
    | 'poster_design_deadline'
    | 'poster_publishing'
    | 'reel_editing_deadline'
    | 'reel_publishing';
  label: string;
  title: string;
  date: string;
  time: string | null;
  status: string;
  platform?: string;
}

export type NavSection =
  | 'dashboard'
  | 'employees'
  | 'tasks'
  | 'posters'
  | 'reels'
  | 'calendar';
