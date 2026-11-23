import { relations } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  photoUrl: text('photo_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const companySettings = pgTable('company_settings', {
  id: serial('id').primaryKey(),
  singletonKey: text('singleton_key').notNull().unique().default('default'),
  companyName: text('company_name').notNull().default('WORK ORGANIZER'),
  logoFileId: uuid('logo_file_id'),
  logoUrl: text('logo_url').notNull().default('/assets/aistudio/c1a1b7c939908f430c32f54944ae2d9b_58b868bd.jpg'),
  accessCodeHash: text('access_code_hash'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const appSessions = pgTable(
  'app_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    label: text('label').notNull().default('Company Workspace'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => [index('app_sessions_expires_at_idx').on(table.expiresAt)]
);

export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bucket: text('bucket').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    uploadedByUid: text('uploaded_by_uid'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('stored_files_bucket_idx').on(table.bucket)]
);

export const storedFileChunks = pgTable(
  'stored_file_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFiles.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('stored_file_chunks_file_idx').on(table.fileId, table.chunkIndex),
  ]
);

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    employeeCode: text('employee_code').notNull().unique(),
    fullName: text('full_name').notNull(),
    profileImageFileId: uuid('profile_image_file_id'),
    profileImageUrl: text('profile_image_url'),
    department: text('department').notNull(),
    designation: text('designation').notNull(),
    phone: text('phone'),
    joiningDate: text('joining_date'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('employees_department_idx').on(table.department),
    index('employees_is_active_idx').on(table.isActive),
  ]
);

export interface StoredAttachmentRef {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskCode: text('task_code').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    category: text('category').default('General').notNull(),
    startDate: text('start_date'),
    dueDate: text('due_date'),
    priority: text('priority').notNull().default('Medium'),
    instructions: text('instructions').default('').notNull(),
    attachments: jsonb('attachments').$type<StoredAttachmentRef[]>().default([]).notNull(),
    referenceLinks: jsonb('reference_links').$type<string[]>().default([]).notNull(),
    status: text('status').notNull().default('Pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('tasks_status_idx').on(table.status),
    index('tasks_priority_idx').on(table.priority),
    index('tasks_due_date_idx').on(table.dueDate),
  ]
);

export const taskAssignments = pgTable(
  'task_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('task_assignments_unique_idx').on(table.taskId, table.employeeId),
    index('task_assignments_employee_idx').on(table.employeeId),
  ]
);

export const taskUpdates = pgTable(
  'task_updates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    authorUid: text('author_uid'),
    updateType: text('update_type').notNull().default('comment'),
    comment: text('comment').notNull(),
    statusChangeTo: text('status_change_to'),
    attachments: jsonb('attachments').$type<StoredAttachmentRef[]>().default([]).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('task_updates_task_id_idx').on(table.taskId)]
);

export const posters = pgTable(
  'posters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    posterCode: text('poster_code').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    campaignName: text('campaign_name').default('').notNull(),
    imageFileId: uuid('image_file_id'),
    imageUrl: text('image_url'),
    assignedDesignerId: uuid('assigned_designer_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    assignedWriterId: uuid('assigned_writer_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    platform: text('platform').notNull().default('Instagram'),
    designDeadline: text('design_deadline'),
    publishingDate: text('publishing_date'),
    publishingTime: text('publishing_time'),
    caption: text('caption').default('').notNull(),
    hashtags: text('hashtags').default('').notNull(),
    referenceLinks: jsonb('reference_links').$type<string[]>().default([]).notNull(),
    notes: text('notes').default('').notNull(),
    status: text('status').notNull().default('Pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('posters_status_idx').on(table.status),
    index('posters_platform_idx').on(table.platform),
    index('posters_publishing_date_idx').on(table.publishingDate),
  ]
);

export const posterAssignments = pgTable(
  'poster_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    posterId: uuid('poster_id')
      .notNull()
      .references(() => posters.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('designer'),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('poster_assignments_unique_idx').on(table.posterId, table.employeeId, table.role),
    index('poster_assignments_employee_idx').on(table.employeeId),
  ]
);

export const reels = pgTable(
  'reels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reelCode: text('reel_code').notNull().unique(),
    title: text('title').notNull(),
    description: text('description').default('').notNull(),
    campaignName: text('campaign_name').default('').notNull(),
    referenceVideoFileId: uuid('reference_video_file_id'),
    referenceVideoUrl: text('reference_video_url'),
    referenceVideoLink: text('reference_video_link').default('').notNull(),
    finalVideoFileId: uuid('final_video_file_id'),
    finalVideoUrl: text('final_video_url'),
    assignedEditorId: uuid('assigned_editor_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    assignedCreatorId: uuid('assigned_creator_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    platform: text('platform').notNull().default('Instagram Reels'),
    editingDeadline: text('editing_deadline'),
    publishingDate: text('publishing_date'),
    publishingTime: text('publishing_time'),
    script: text('script').default('').notNull(),
    caption: text('caption').default('').notNull(),
    hashtags: text('hashtags').default('').notNull(),
    referenceLinks: jsonb('reference_links').$type<string[]>().default([]).notNull(),
    notes: text('notes').default('').notNull(),
    status: text('status').notNull().default('Pending'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('reels_status_idx').on(table.status),
    index('reels_platform_idx').on(table.platform),
    index('reels_publishing_date_idx').on(table.publishingDate),
  ]
);

export const reelAssignments = pgTable(
  'reel_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reelId: uuid('reel_id')
      .notNull()
      .references(() => reels.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('editor'),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('reel_assignments_unique_idx').on(table.reelId, table.employeeId, table.role),
    index('reel_assignments_employee_idx').on(table.employeeId),
  ]
);

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    title: text('title').notNull(),
    details: text('details').default('').notNull(),
    actorName: text('actor_name').notNull(),
    actorUid: text('actor_uid'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('activity_logs_entity_idx').on(table.entityType, table.entityId),
    index('activity_logs_created_at_idx').on(table.createdAt),
  ]
);

// Relations
export const employeesRelations = relations(employees, ({ many }) => ({
  taskAssignments: many(taskAssignments),
  posterAssignments: many(posterAssignments),
  reelAssignments: many(reelAssignments),
}));

export const tasksRelations = relations(tasks, ({ many }) => ({
  assignments: many(taskAssignments),
  updates: many(taskUpdates),
}));

export const taskAssignmentsRelations = relations(taskAssignments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskAssignments.taskId],
    references: [tasks.id],
  }),
  employee: one(employees, {
    fields: [taskAssignments.employeeId],
    references: [employees.id],
  }),
}));

export const taskUpdatesRelations = relations(taskUpdates, ({ one }) => ({
  task: one(tasks, {
    fields: [taskUpdates.taskId],
    references: [tasks.id],
  }),
  employee: one(employees, {
    fields: [taskUpdates.employeeId],
    references: [employees.id],
  }),
}));

export const postersRelations = relations(posters, ({ one, many }) => ({
  designer: one(employees, {
    fields: [posters.assignedDesignerId],
    references: [employees.id],
  }),
  writer: one(employees, {
    fields: [posters.assignedWriterId],
    references: [employees.id],
  }),
  assignments: many(posterAssignments),
}));

export const posterAssignmentsRelations = relations(posterAssignments, ({ one }) => ({
  poster: one(posters, {
    fields: [posterAssignments.posterId],
    references: [posters.id],
  }),
  employee: one(employees, {
    fields: [posterAssignments.employeeId],
    references: [employees.id],
  }),
}));

export const reelsRelations = relations(reels, ({ one, many }) => ({
  editor: one(employees, {
    fields: [reels.assignedEditorId],
    references: [employees.id],
  }),
  creator: one(employees, {
    fields: [reels.assignedCreatorId],
    references: [employees.id],
  }),
  assignments: many(reelAssignments),
}));

export const reelAssignmentsRelations = relations(reelAssignments, ({ one }) => ({
  reel: one(reels, {
    fields: [reelAssignments.reelId],
    references: [reels.id],
  }),
  employee: one(employees, {
    fields: [reelAssignments.employeeId],
    references: [employees.id],
  }),
}));
