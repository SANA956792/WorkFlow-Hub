import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  activityLogs,
  companySettings,
  employees,
  posterAssignments,
  posters,
  reelAssignments,
  reels,
  storedFiles,
  StoredAttachmentRef,
  taskAssignments,
  tasks,
  taskUpdates,
} from './schema.ts';
import { buildSignedFileUrl } from '../middleware/auth.ts';

const DEFAULT_LOGO_URL = '/assets/aistudio/c1a1b7c939908f430c32f54944ae2d9b_58b868bd.jpg';

function serializeEmployee(row: typeof employees.$inferSelect) {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    fullName: row.fullName,
    profileImageFileId: row.profileImageFileId ?? null,
    profileImageUrl: row.profileImageFileId
      ? buildSignedFileUrl(row.profileImageFileId)
      : row.profileImageUrl ?? null,
    department: row.department,
    designation: row.designation,
    phone: row.phone ?? null,
    joiningDate: row.joiningDate ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function signAttachmentList(items: StoredAttachmentRef[] | null | undefined) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    ...item,
    url: item.fileId ? buildSignedFileUrl(item.fileId) || item.url : item.url,
  }));
}

async function generateNextCode(
  prefix: string,
  table: 'employees' | 'tasks' | 'posters' | 'reels'
): Promise<string> {
  let count = 0;
  if (table === 'employees') {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(employees);
    count = res[0]?.count ?? 0;
  } else if (table === 'tasks') {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(tasks);
    count = res[0]?.count ?? 0;
  } else if (table === 'posters') {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(posters);
    count = res[0]?.count ?? 0;
  } else {
    const res = await db.select({ count: sql<number>`count(*)::int` }).from(reels);
    count = res[0]?.count ?? 0;
  }
  const num = count + 1;
  const suffix = String(num).padStart(3, '0');
  const randomTail = Math.floor(10 + Math.random() * 89);
  return `${prefix}-${suffix}-${randomTail}`;
}

export async function logActivity(params: {
  entityType: 'employee' | 'task' | 'poster' | 'reel' | 'company';
  entityId: string;
  action: string;
  title: string;
  details?: string;
  actorName: string;
  actorUid?: string | null;
}) {
  try {
    await db.insert(activityLogs).values({
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      title: params.title,
      details: params.details ?? '',
      actorName: params.actorName,
      actorUid: params.actorUid ?? null,
    });
  } catch (error) {
    console.error('Failed to insert activity log:', error);
  }
}

export async function getCompanySettings() {
  try {
    const existing = await db
      .select()
      .from(companySettings)
      .where(eq(companySettings.singletonKey, 'default'))
      .limit(1);

    let row = existing[0];
    if (!row) {
      const inserted = await db
        .insert(companySettings)
        .values({
          singletonKey: 'default',
          companyName: 'WORK ORGANIZER',
          logoUrl: DEFAULT_LOGO_URL,
        })
        .onConflictDoNothing()
        .returning();
      row = inserted[0];
      if (!row) {
        const refetch = await db
          .select()
          .from(companySettings)
          .where(eq(companySettings.singletonKey, 'default'))
          .limit(1);
        row = refetch[0];
      }
    }

    return {
      id: row.id,
      companyName: row.companyName,
      logoFileId: row.logoFileId ?? null,
      logoUrl: row.logoFileId
        ? buildSignedFileUrl(row.logoFileId) || DEFAULT_LOGO_URL
        : row.logoUrl || DEFAULT_LOGO_URL,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database query failed in getCompanySettings:', error);
    throw new Error('Unable to load company settings.', { cause: error });
  }
}

export async function updateCompanySettings(params: {
  companyName?: string;
  logoFileId?: string | null;
  logoUrl?: string;
  actorName: string;
  actorUid?: string | null;
}) {
  try {
    const current = await getCompanySettings();
    const nextLogoFileId =
      params.logoFileId !== undefined ? params.logoFileId : current.logoFileId;
    const nextLogoUrl =
      params.logoFileId !== undefined
        ? params.logoFileId
          ? `/api/files/${params.logoFileId}`
          : DEFAULT_LOGO_URL
        : params.logoUrl ?? current.logoUrl;
    const nextName = params.companyName?.trim() || current.companyName;

    const [updated] = await db
      .update(companySettings)
      .set({
        companyName: nextName,
        logoFileId: nextLogoFileId,
        logoUrl: nextLogoUrl,
        updatedAt: new Date(),
      })
      .where(eq(companySettings.singletonKey, 'default'))
      .returning();

    if (
      params.logoFileId &&
      current.logoFileId &&
      current.logoFileId !== params.logoFileId
    ) {
      await safeDeleteStoredFile(current.logoFileId);
    }

    await logActivity({
      entityType: 'company',
      entityId: String(updated.id),
      action: 'updated_logo',
      title: 'Company branding updated',
      details: params.logoFileId ? 'Uploaded new company logo' : 'Updated company settings',
      actorName: params.actorName,
      actorUid: params.actorUid,
    });

    return {
      id: updated.id,
      companyName: updated.companyName,
      logoFileId: updated.logoFileId ?? null,
      logoUrl: updated.logoFileId
        ? buildSignedFileUrl(updated.logoFileId) || DEFAULT_LOGO_URL
        : updated.logoUrl || DEFAULT_LOGO_URL,
      updatedAt: updated.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database update failed in updateCompanySettings:', error);
    throw new Error('Unable to save company branding.', { cause: error });
  }
}

export async function saveStoredFile(params: {
  bucket: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
  uploadedByUid?: string | null;
}) {
  try {
    const [row] = await db
      .insert(storedFiles)
      .values({
        bucket: params.bucket,
        originalName: params.originalName,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        data: params.data,
        uploadedByUid: params.uploadedByUid ?? null,
      })
      .returning({
        id: storedFiles.id,
        bucket: storedFiles.bucket,
        originalName: storedFiles.originalName,
        mimeType: storedFiles.mimeType,
        sizeBytes: storedFiles.sizeBytes,
        createdAt: storedFiles.createdAt,
      });

    return {
      fileId: row.id,
      fileName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      url: buildSignedFileUrl(row.id) || `/api/files/${row.id}`,
    };
  } catch (error) {
    console.error('Database write failed in saveStoredFile:', error);
    throw new Error('Unable to store uploaded file.', { cause: error });
  }
}

export async function getStoredFileById(fileId: string) {
  try {
    const [row] = await db
      .select()
      .from(storedFiles)
      .where(eq(storedFiles.id, fileId))
      .limit(1);
    return row ?? null;
  } catch (error) {
    console.error('Database query failed in getStoredFileById:', error);
    throw new Error('Unable to retrieve file.', { cause: error });
  }
}

async function safeDeleteStoredFile(fileId: string) {
  try {
    await db.delete(storedFiles).where(eq(storedFiles.id, fileId));
  } catch (error) {
    console.error('Non-fatal cleanup error for stored file:', fileId, error);
  }
}

// ============================================================================
// EMPLOYEES
// ============================================================================

export async function listEmployees() {
  try {
    const rows = await db.select().from(employees).orderBy(desc(employees.createdAt));
    return rows.map(serializeEmployee);
  } catch (error) {
    console.error('Database query failed in listEmployees:', error);
    throw new Error('Unable to load employees.', { cause: error });
  }
}

export async function getEmployeeDetail(employeeId: string, todayStr: string) {
  try {
    const [empRow] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!empRow) return null;

    const allTasks = await listTasks();
    const empTasks = allTasks.filter((t) =>
      t.assignedEmployeeIds.includes(employeeId)
    );

    const allPosters = await listPosters();
    const empPosters = allPosters.filter(
      (p) =>
        p.assignedDesignerId === employeeId || p.assignedWriterId === employeeId
    );

    const allReels = await listReels();
    const empReels = allReels.filter(
      (r) =>
        r.assignedEditorId === employeeId || r.assignedCreatorId === employeeId
    );

    const relatedEntityIds = [
      employeeId,
      ...empTasks.map((t) => t.id),
      ...empPosters.map((p) => p.id),
      ...empReels.map((r) => r.id),
    ];

    const activities =
      relatedEntityIds.length > 0
        ? await db
            .select()
            .from(activityLogs)
            .where(inArray(activityLogs.entityId, relatedEntityIds))
            .orderBy(desc(activityLogs.createdAt))
            .limit(20)
        : [];

    const completedTasks = empTasks.filter((t) => t.status === 'Completed').length;
    const pendingTasks = empTasks.filter((t) => t.status === 'Pending').length;
    const inProgressTasks = empTasks.filter(
      (t) => t.status === 'In Progress'
    ).length;
    const overdueTasks = empTasks.filter(
      (t) =>
        t.dueDate &&
        t.dueDate < todayStr &&
        t.status !== 'Completed' &&
        t.status !== 'Cancelled'
    ).length;

    return {
      ...serializeEmployee(empRow),
      stats: {
        totalTasks: empTasks.length,
        completedTasks,
        pendingTasks,
        inProgressTasks,
        overdueTasks,
        assignedPosters: empPosters.length,
        assignedReels: empReels.length,
      },
      tasks: empTasks,
      posters: empPosters,
      reels: empReels,
      recentActivities: activities.map((a) => ({
        ...a,
        entityType: a.entityType as any,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error('Database query failed in getEmployeeDetail:', error);
    throw new Error('Unable to load employee profile.', { cause: error });
  }
}

export async function createEmployee(
  input: {
    employeeCode?: string;
    fullName: string;
    profileImageFileId?: string | null;
    department: string;
    designation: string;
    phone?: string | null;
    joiningDate?: string | null;
    isActive?: boolean;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code =
      input.employeeCode?.trim() || (await generateNextCode('EMP', 'employees'));

    const [created] = await db
      .insert(employees)
      .values({
        employeeCode: code,
        fullName: input.fullName.trim(),
        profileImageFileId: input.profileImageFileId ?? null,
        profileImageUrl: input.profileImageFileId
          ? `/api/files/${input.profileImageFileId}`
          : null,
        department: input.department.trim(),
        designation: input.designation.trim(),
        phone: input.phone?.trim() || null,
        joiningDate: input.joiningDate || null,
        isActive: input.isActive ?? true,
      })
      .returning();

    await logActivity({
      entityType: 'employee',
      entityId: created.id,
      action: 'created',
      title: `Added employee ${created.fullName}`,
      details: `${created.designation} · ${created.department}`,
      actorName,
      actorUid,
    });

    return serializeEmployee(created);
  } catch (error: any) {
    console.error('Database insert failed in createEmployee:', error);
    if (error?.code === '23505') {
      throw new Error('An employee with this Employee ID already exists.');
    }
    throw new Error('Unable to create employee.', { cause: error });
  }
}

export async function updateEmployee(
  employeeId: string,
  input: {
    employeeCode?: string;
    fullName?: string;
    profileImageFileId?: string | null;
    department?: string;
    designation?: string;
    phone?: string | null;
    joiningDate?: string | null;
    isActive?: boolean;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);

    if (!existing) return null;

    const nextImageId =
      input.profileImageFileId !== undefined
        ? input.profileImageFileId
        : existing.profileImageFileId;

    const [updated] = await db
      .update(employees)
      .set({
        employeeCode: input.employeeCode?.trim() || existing.employeeCode,
        fullName: input.fullName?.trim() || existing.fullName,
        profileImageFileId: nextImageId,
        profileImageUrl: nextImageId ? `/api/files/${nextImageId}` : null,
        department: input.department?.trim() || existing.department,
        designation: input.designation?.trim() || existing.designation,
        phone: input.phone !== undefined ? input.phone?.trim() || null : existing.phone,
        joiningDate:
          input.joiningDate !== undefined
            ? input.joiningDate || null
            : existing.joiningDate,
        isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, employeeId))
      .returning();

    if (
      input.profileImageFileId !== undefined &&
      existing.profileImageFileId &&
      existing.profileImageFileId !== input.profileImageFileId
    ) {
      await safeDeleteStoredFile(existing.profileImageFileId);
    }

    await logActivity({
      entityType: 'employee',
      entityId: updated.id,
      action:
        input.isActive !== undefined && input.isActive !== existing.isActive
          ? updated.isActive
            ? 'activated'
            : 'deactivated'
          : 'updated',
      title: `Updated employee ${updated.fullName}`,
      details: `${updated.designation} · ${updated.department}`,
      actorName,
      actorUid,
    });

    return serializeEmployee(updated);
  } catch (error: any) {
    console.error('Database update failed in updateEmployee:', error);
    if (error?.code === '23505') {
      throw new Error('An employee with this Employee ID already exists.');
    }
    throw new Error('Unable to update employee.', { cause: error });
  }
}

export async function deleteEmployee(
  employeeId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (!existing) return false;

    await db.delete(employees).where(eq(employees.id, employeeId));

    if (existing.profileImageFileId) {
      await safeDeleteStoredFile(existing.profileImageFileId);
    }

    await logActivity({
      entityType: 'employee',
      entityId: employeeId,
      action: 'deleted',
      title: `Removed employee ${existing.fullName}`,
      details: `${existing.employeeCode} · ${existing.department}`,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deleteEmployee:', error);
    throw new Error('Unable to delete employee.', { cause: error });
  }
}

// ============================================================================
// TASKS
// ============================================================================

export async function listTasks() {
  try {
    const [taskRows, assignmentRows, employeeRows] = await Promise.all([
      db.select().from(tasks).orderBy(desc(tasks.createdAt)),
      db.select().from(taskAssignments),
      db.select().from(employees),
    ]);

    const empMap = new Map(employeeRows.map((e) => [e.id, serializeEmployee(e)]));
    const assignMap = new Map<string, ReturnType<typeof serializeEmployee>[]>();

    for (const a of assignmentRows) {
      const emp = empMap.get(a.employeeId);
      if (!emp) continue;
      const list = assignMap.get(a.taskId) ?? [];
      list.push(emp);
      assignMap.set(a.taskId, list);
    }

    return taskRows.map((t) => {
      const assignedEmployees = assignMap.get(t.id) ?? [];
      return {
        id: t.id,
        taskCode: t.taskCode,
        title: t.title,
        description: t.description,
        category: t.category,
        startDate: t.startDate ?? null,
        dueDate: t.dueDate ?? null,
        priority: t.priority as any,
        instructions: t.instructions,
        attachments: signAttachmentList(t.attachments),
        referenceLinks: Array.isArray(t.referenceLinks) ? t.referenceLinks : [],
        status: t.status as any,
        assignedEmployees,
        assignedEmployeeIds: assignedEmployees.map((e) => e.id),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    });
  } catch (error) {
    console.error('Database query failed in listTasks:', error);
    throw new Error('Unable to load tasks.', { cause: error });
  }
}

export async function getTaskDetail(taskId: string) {
  try {
    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!taskRow) return null;

    const [assignmentRows, employeeRows, updateRows] = await Promise.all([
      db.select().from(taskAssignments).where(eq(taskAssignments.taskId, taskId)),
      db.select().from(employees),
      db
        .select()
        .from(taskUpdates)
        .where(eq(taskUpdates.taskId, taskId))
        .orderBy(desc(taskUpdates.createdAt)),
    ]);

    const empMap = new Map(employeeRows.map((e) => [e.id, serializeEmployee(e)]));
    const assignedEmployees = assignmentRows
      .map((a) => empMap.get(a.employeeId))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    return {
      id: taskRow.id,
      taskCode: taskRow.taskCode,
      title: taskRow.title,
      description: taskRow.description,
      category: taskRow.category,
      startDate: taskRow.startDate ?? null,
      dueDate: taskRow.dueDate ?? null,
      priority: taskRow.priority as any,
      instructions: taskRow.instructions,
      attachments: signAttachmentList(taskRow.attachments),
      referenceLinks: Array.isArray(taskRow.referenceLinks)
        ? taskRow.referenceLinks
        : [],
      status: taskRow.status as any,
      assignedEmployees,
      assignedEmployeeIds: assignedEmployees.map((e) => e.id),
      updates: updateRows.map((u) => ({
        id: u.id,
        taskId: u.taskId,
        employeeId: u.employeeId ?? null,
        authorName: u.authorName,
        authorUid: u.authorUid ?? null,
        updateType: u.updateType,
        comment: u.comment,
        statusChangeTo: u.statusChangeTo ?? null,
        attachments: signAttachmentList(u.attachments),
        createdAt: u.createdAt.toISOString(),
      })),
      createdAt: taskRow.createdAt.toISOString(),
      updatedAt: taskRow.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database query failed in getTaskDetail:', error);
    throw new Error('Unable to load task details.', { cause: error });
  }
}

export async function createTask(
  input: {
    taskCode?: string;
    title: string;
    description?: string;
    category?: string;
    startDate?: string | null;
    dueDate?: string | null;
    priority?: string;
    instructions?: string;
    attachments?: StoredAttachmentRef[];
    referenceLinks?: string[];
    status?: string;
    assignedEmployeeIds?: string[];
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code = input.taskCode?.trim() || (await generateNextCode('TSK', 'tasks'));
    const createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tasks)
        .values({
          taskCode: code,
          title: input.title.trim(),
          description: input.description?.trim() ?? '',
          category: input.category?.trim() || 'General',
          startDate: input.startDate || null,
          dueDate: input.dueDate || null,
          priority: input.priority || 'Medium',
          instructions: input.instructions?.trim() ?? '',
          attachments: input.attachments ?? [],
          referenceLinks: input.referenceLinks ?? [],
          status: input.status || 'Pending',
        })
        .returning();

      const uniqueEmpIds = Array.from(new Set(input.assignedEmployeeIds ?? []));
      if (uniqueEmpIds.length > 0) {
        await tx.insert(taskAssignments).values(
          uniqueEmpIds.map((employeeId) => ({
            taskId: created.id,
            employeeId,
          }))
        );
      }
      return created.id;
    });

    await logActivity({
      entityType: 'task',
      entityId: createdId,
      action: 'created',
      title: `Created task "${input.title.trim()}"`,
      details: `${code} · Priority: ${input.priority || 'Medium'}`,
      actorName,
      actorUid,
    });

    return await getTaskDetail(createdId);
  } catch (error: any) {
    console.error('Database insert failed in createTask:', error);
    if (error?.code === '23505') {
      throw new Error('A task with this Task ID already exists.');
    }
    throw new Error('Unable to create task.', { cause: error });
  }
}

export async function updateTask(
  taskId: string,
  input: {
    taskCode?: string;
    title?: string;
    description?: string;
    category?: string;
    startDate?: string | null;
    dueDate?: string | null;
    priority?: string;
    instructions?: string;
    attachments?: StoredAttachmentRef[];
    referenceLinks?: string[];
    status?: string;
    assignedEmployeeIds?: string[];
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!existing) return null;

    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          taskCode: input.taskCode?.trim() || existing.taskCode,
          title: input.title?.trim() || existing.title,
          description:
            input.description !== undefined
              ? input.description.trim()
              : existing.description,
          category:
            input.category !== undefined
              ? input.category.trim() || 'General'
              : existing.category,
          startDate:
            input.startDate !== undefined ? input.startDate || null : existing.startDate,
          dueDate:
            input.dueDate !== undefined ? input.dueDate || null : existing.dueDate,
          priority: input.priority || existing.priority,
          instructions:
            input.instructions !== undefined
              ? input.instructions.trim()
              : existing.instructions,
          attachments:
            input.attachments !== undefined ? input.attachments : existing.attachments,
          referenceLinks:
            input.referenceLinks !== undefined
              ? input.referenceLinks
              : existing.referenceLinks,
          status: input.status || existing.status,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));

      if (input.assignedEmployeeIds !== undefined) {
        await tx.delete(taskAssignments).where(eq(taskAssignments.taskId, taskId));
        const uniqueEmpIds = Array.from(new Set(input.assignedEmployeeIds));
        if (uniqueEmpIds.length > 0) {
          await tx.insert(taskAssignments).values(
            uniqueEmpIds.map((employeeId) => ({
              taskId,
              employeeId,
            }))
          );
        }
      }
    });

    const statusChanged = input.status && input.status !== existing.status;
    await logActivity({
      entityType: 'task',
      entityId: taskId,
      action: statusChanged ? 'status_changed' : 'updated',
      title: statusChanged
        ? `Task "${input.title?.trim() || existing.title}" moved to ${input.status}`
        : `Updated task "${input.title?.trim() || existing.title}"`,
      details: statusChanged
        ? `Status: ${existing.status} -> ${input.status}`
        : `${existing.taskCode}`,
      actorName,
      actorUid,
    });

    return await getTaskDetail(taskId);
  } catch (error: any) {
    console.error('Database update failed in updateTask:', error);
    if (error?.code === '23505') {
      throw new Error('A task with this Task ID already exists.');
    }
    throw new Error('Unable to update task.', { cause: error });
  }
}

export async function addTaskUpdate(
  taskId: string,
  input: {
    employeeId?: string | null;
    updateType?: string;
    comment: string;
    statusChangeTo?: string | null;
    attachments?: StoredAttachmentRef[];
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!existing) return null;

    await db.transaction(async (tx) => {
      await tx.insert(taskUpdates).values({
        taskId,
        employeeId: input.employeeId || null,
        authorName: actorName,
        authorUid: actorUid ?? null,
        updateType: input.updateType || 'comment',
        comment: input.comment.trim(),
        statusChangeTo: input.statusChangeTo || null,
        attachments: input.attachments ?? [],
      });

      if (input.statusChangeTo && input.statusChangeTo !== existing.status) {
        await tx
          .update(tasks)
          .set({ status: input.statusChangeTo, updatedAt: new Date() })
          .where(eq(tasks.id, taskId));
      } else {
        await tx
          .update(tasks)
          .set({ updatedAt: new Date() })
          .where(eq(tasks.id, taskId));
      }
    });

    await logActivity({
      entityType: 'task',
      entityId: taskId,
      action: input.statusChangeTo ? 'review_update' : 'comment_added',
      title: input.statusChangeTo
        ? `Task "${existing.title}" set to ${input.statusChangeTo}`
        : `Progress update on "${existing.title}"`,
      details: input.comment.trim().slice(0, 140),
      actorName,
      actorUid,
    });

    return await getTaskDetail(taskId);
  } catch (error) {
    console.error('Database insert failed in addTaskUpdate:', error);
    throw new Error('Unable to save task update.', { cause: error });
  }
}

export async function deleteTask(
  taskId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!existing) return false;

    await db.delete(tasks).where(eq(tasks.id, taskId));

    await logActivity({
      entityType: 'task',
      entityId: taskId,
      action: 'deleted',
      title: `Deleted task "${existing.title}"`,
      details: existing.taskCode,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deleteTask:', error);
    throw new Error('Unable to delete task.', { cause: error });
  }
}

// ============================================================================
// POSTERS
// ============================================================================

export async function listPosters() {
  try {
    const [posterRows, employeeRows] = await Promise.all([
      db.select().from(posters).orderBy(desc(posters.createdAt)),
      db.select().from(employees),
    ]);

    const empMap = new Map(employeeRows.map((e) => [e.id, serializeEmployee(e)]));

    return posterRows.map((p) => ({
      id: p.id,
      posterCode: p.posterCode,
      title: p.title,
      description: p.description,
      campaignName: p.campaignName,
      imageFileId: p.imageFileId ?? null,
      imageUrl: p.imageFileId
        ? buildSignedFileUrl(p.imageFileId)
        : p.imageUrl ?? null,
      assignedDesignerId: p.assignedDesignerId ?? null,
      assignedWriterId: p.assignedWriterId ?? null,
      assignedDesigner: p.assignedDesignerId
        ? empMap.get(p.assignedDesignerId) ?? null
        : null,
      assignedWriter: p.assignedWriterId
        ? empMap.get(p.assignedWriterId) ?? null
        : null,
      platform: p.platform,
      designDeadline: p.designDeadline ?? null,
      publishingDate: p.publishingDate ?? null,
      publishingTime: p.publishingTime ?? null,
      caption: p.caption,
      hashtags: p.hashtags,
      referenceLinks: Array.isArray(p.referenceLinks) ? p.referenceLinks : [],
      notes: p.notes,
      status: p.status as any,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error('Database query failed in listPosters:', error);
    throw new Error('Unable to load posters.', { cause: error });
  }
}

export async function createPoster(
  input: {
    posterCode?: string;
    title: string;
    description?: string;
    campaignName?: string;
    imageFileId?: string | null;
    assignedDesignerId?: string | null;
    assignedWriterId?: string | null;
    platform?: string;
    designDeadline?: string | null;
    publishingDate?: string | null;
    publishingTime?: string | null;
    caption?: string;
    hashtags?: string;
    referenceLinks?: string[];
    notes?: string;
    status?: string;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code =
      input.posterCode?.trim() || (await generateNextCode('PST', 'posters'));

    const createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(posters)
        .values({
          posterCode: code,
          title: input.title.trim(),
          description: input.description?.trim() ?? '',
          campaignName: input.campaignName?.trim() ?? '',
          imageFileId: input.imageFileId ?? null,
          imageUrl: input.imageFileId ? `/api/files/${input.imageFileId}` : null,
          assignedDesignerId: input.assignedDesignerId || null,
          assignedWriterId: input.assignedWriterId || null,
          platform: input.platform?.trim() || 'Instagram',
          designDeadline: input.designDeadline || null,
          publishingDate: input.publishingDate || null,
          publishingTime: input.publishingTime || null,
          caption: input.caption?.trim() ?? '',
          hashtags: input.hashtags?.trim() ?? '',
          referenceLinks: input.referenceLinks ?? [],
          notes: input.notes?.trim() ?? '',
          status: input.status || 'Pending',
        })
        .returning();

      const assignments: { posterId: string; employeeId: string; role: string }[] = [];
      if (input.assignedDesignerId) {
        assignments.push({
          posterId: created.id,
          employeeId: input.assignedDesignerId,
          role: 'designer',
        });
      }
      if (input.assignedWriterId) {
        assignments.push({
          posterId: created.id,
          employeeId: input.assignedWriterId,
          role: 'writer',
        });
      }
      if (assignments.length > 0) {
        await tx.insert(posterAssignments).values(assignments);
      }

      return created.id;
    });

    await logActivity({
      entityType: 'poster',
      entityId: createdId,
      action: input.imageFileId ? 'uploaded' : 'created',
      title: `Created poster "${input.title.trim()}"`,
      details: `${code} · ${input.platform || 'Instagram'}`,
      actorName,
      actorUid,
    });

    const all = await listPosters();
    return all.find((p) => p.id === createdId) ?? null;
  } catch (error: any) {
    console.error('Database insert failed in createPoster:', error);
    if (error?.code === '23505') {
      throw new Error('A poster with this Poster ID already exists.');
    }
    throw new Error('Unable to create poster.', { cause: error });
  }
}

export async function updatePoster(
  posterId: string,
  input: Partial<{
    posterCode: string;
    title: string;
    description: string;
    campaignName: string;
    imageFileId: string | null;
    assignedDesignerId: string | null;
    assignedWriterId: string | null;
    platform: string;
    designDeadline: string | null;
    publishingDate: string | null;
    publishingTime: string | null;
    caption: string;
    hashtags: string;
    referenceLinks: string[];
    notes: string;
    status: string;
  }>,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(posters)
      .where(eq(posters.id, posterId))
      .limit(1);
    if (!existing) return null;

    const nextImageFileId =
      input.imageFileId !== undefined ? input.imageFileId : existing.imageFileId;

    await db.transaction(async (tx) => {
      const nextDesignerId =
        input.assignedDesignerId !== undefined
          ? input.assignedDesignerId || null
          : existing.assignedDesignerId;
      const nextWriterId =
        input.assignedWriterId !== undefined
          ? input.assignedWriterId || null
          : existing.assignedWriterId;

      await tx
        .update(posters)
        .set({
          posterCode: input.posterCode?.trim() || existing.posterCode,
          title: input.title?.trim() || existing.title,
          description:
            input.description !== undefined
              ? input.description.trim()
              : existing.description,
          campaignName:
            input.campaignName !== undefined
              ? input.campaignName.trim()
              : existing.campaignName,
          imageFileId: nextImageFileId,
          imageUrl: nextImageFileId ? `/api/files/${nextImageFileId}` : null,
          assignedDesignerId: nextDesignerId,
          assignedWriterId: nextWriterId,
          platform: input.platform?.trim() || existing.platform,
          designDeadline:
            input.designDeadline !== undefined
              ? input.designDeadline || null
              : existing.designDeadline,
          publishingDate:
            input.publishingDate !== undefined
              ? input.publishingDate || null
              : existing.publishingDate,
          publishingTime:
            input.publishingTime !== undefined
              ? input.publishingTime || null
              : existing.publishingTime,
          caption:
            input.caption !== undefined ? input.caption.trim() : existing.caption,
          hashtags:
            input.hashtags !== undefined ? input.hashtags.trim() : existing.hashtags,
          referenceLinks:
            input.referenceLinks !== undefined
              ? input.referenceLinks
              : existing.referenceLinks,
          notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
          status: input.status || existing.status,
          updatedAt: new Date(),
        })
        .where(eq(posters.id, posterId));

      if (
        input.assignedDesignerId !== undefined ||
        input.assignedWriterId !== undefined
      ) {
        await tx
          .delete(posterAssignments)
          .where(eq(posterAssignments.posterId, posterId));
        const assignments: { posterId: string; employeeId: string; role: string }[] = [];
        if (nextDesignerId) {
          assignments.push({
            posterId,
            employeeId: nextDesignerId,
            role: 'designer',
          });
        }
        if (nextWriterId) {
          assignments.push({
            posterId,
            employeeId: nextWriterId,
            role: 'writer',
          });
        }
        if (assignments.length > 0) {
          await tx.insert(posterAssignments).values(assignments);
        }
      }
    });

    if (
      input.imageFileId !== undefined &&
      existing.imageFileId &&
      existing.imageFileId !== input.imageFileId
    ) {
      await safeDeleteStoredFile(existing.imageFileId);
    }

    const statusChanged = input.status && input.status !== existing.status;
    await logActivity({
      entityType: 'poster',
      entityId: posterId,
      action: statusChanged ? 'status_changed' : 'updated',
      title: statusChanged
        ? `Poster "${input.title?.trim() || existing.title}" moved to ${input.status}`
        : `Updated poster "${input.title?.trim() || existing.title}"`,
      details: statusChanged
        ? `Status: ${existing.status} -> ${input.status}`
        : existing.posterCode,
      actorName,
      actorUid,
    });

    const all = await listPosters();
    return all.find((p) => p.id === posterId) ?? null;
  } catch (error: any) {
    console.error('Database update failed in updatePoster:', error);
    if (error?.code === '23505') {
      throw new Error('A poster with this Poster ID already exists.');
    }
    throw new Error('Unable to update poster.', { cause: error });
  }
}

export async function deletePoster(
  posterId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(posters)
      .where(eq(posters.id, posterId))
      .limit(1);
    if (!existing) return false;

    await db.delete(posters).where(eq(posters.id, posterId));

    if (existing.imageFileId) {
      await safeDeleteStoredFile(existing.imageFileId);
    }

    await logActivity({
      entityType: 'poster',
      entityId: posterId,
      action: 'deleted',
      title: `Deleted poster "${existing.title}"`,
      details: existing.posterCode,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deletePoster:', error);
    throw new Error('Unable to delete poster.', { cause: error });
  }
}

// ============================================================================
// REELS
// ============================================================================

export async function listReels() {
  try {
    const [reelRows, employeeRows] = await Promise.all([
      db.select().from(reels).orderBy(desc(reels.createdAt)),
      db.select().from(employees),
    ]);

    const empMap = new Map(employeeRows.map((e) => [e.id, serializeEmployee(e)]));

    return reelRows.map((r) => ({
      id: r.id,
      reelCode: r.reelCode,
      title: r.title,
      description: r.description,
      campaignName: r.campaignName,
      referenceVideoFileId: r.referenceVideoFileId ?? null,
      referenceVideoUrl: r.referenceVideoFileId
        ? buildSignedFileUrl(r.referenceVideoFileId)
        : r.referenceVideoUrl ?? null,
      referenceVideoLink: r.referenceVideoLink,
      finalVideoFileId: r.finalVideoFileId ?? null,
      finalVideoUrl: r.finalVideoFileId
        ? buildSignedFileUrl(r.finalVideoFileId)
        : r.finalVideoUrl ?? null,
      assignedEditorId: r.assignedEditorId ?? null,
      assignedCreatorId: r.assignedCreatorId ?? null,
      assignedEditor: r.assignedEditorId
        ? empMap.get(r.assignedEditorId) ?? null
        : null,
      assignedCreator: r.assignedCreatorId
        ? empMap.get(r.assignedCreatorId) ?? null
        : null,
      platform: r.platform,
      editingDeadline: r.editingDeadline ?? null,
      publishingDate: r.publishingDate ?? null,
      publishingTime: r.publishingTime ?? null,
      script: r.script,
      caption: r.caption,
      hashtags: r.hashtags,
      referenceLinks: Array.isArray(r.referenceLinks) ? r.referenceLinks : [],
      notes: r.notes,
      status: r.status as any,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  } catch (error) {
    console.error('Database query failed in listReels:', error);
    throw new Error('Unable to load reels.', { cause: error });
  }
}

export async function createReel(
  input: {
    reelCode?: string;
    title: string;
    description?: string;
    campaignName?: string;
    referenceVideoFileId?: string | null;
    referenceVideoLink?: string;
    finalVideoFileId?: string | null;
    assignedEditorId?: string | null;
    assignedCreatorId?: string | null;
    platform?: string;
    editingDeadline?: string | null;
    publishingDate?: string | null;
    publishingTime?: string | null;
    script?: string;
    caption?: string;
    hashtags?: string;
    referenceLinks?: string[];
    notes?: string;
    status?: string;
  },
  actorName: string,
  actorUid?: string | null
) {
  try {
    const code = input.reelCode?.trim() || (await generateNextCode('REL', 'reels'));

    const createdId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(reels)
        .values({
          reelCode: code,
          title: input.title.trim(),
          description: input.description?.trim() ?? '',
          campaignName: input.campaignName?.trim() ?? '',
          referenceVideoFileId: input.referenceVideoFileId ?? null,
          referenceVideoUrl: input.referenceVideoFileId
            ? `/api/files/${input.referenceVideoFileId}`
            : null,
          referenceVideoLink: input.referenceVideoLink?.trim() ?? '',
          finalVideoFileId: input.finalVideoFileId ?? null,
          finalVideoUrl: input.finalVideoFileId
            ? `/api/files/${input.finalVideoFileId}`
            : null,
          assignedEditorId: input.assignedEditorId || null,
          assignedCreatorId: input.assignedCreatorId || null,
          platform: input.platform?.trim() || 'Instagram Reels',
          editingDeadline: input.editingDeadline || null,
          publishingDate: input.publishingDate || null,
          publishingTime: input.publishingTime || null,
          script: input.script?.trim() ?? '',
          caption: input.caption?.trim() ?? '',
          hashtags: input.hashtags?.trim() ?? '',
          referenceLinks: input.referenceLinks ?? [],
          notes: input.notes?.trim() ?? '',
          status: input.status || 'Pending',
        })
        .returning();

      const assignments: { reelId: string; employeeId: string; role: string }[] = [];
      if (input.assignedEditorId) {
        assignments.push({
          reelId: created.id,
          employeeId: input.assignedEditorId,
          role: 'editor',
        });
      }
      if (input.assignedCreatorId) {
        assignments.push({
          reelId: created.id,
          employeeId: input.assignedCreatorId,
          role: 'creator',
        });
      }
      if (assignments.length > 0) {
        await tx.insert(reelAssignments).values(assignments);
      }

      return created.id;
    });

    await logActivity({
      entityType: 'reel',
      entityId: createdId,
      action:
        input.finalVideoFileId || input.referenceVideoFileId ? 'uploaded' : 'created',
      title: `Created reel "${input.title.trim()}"`,
      details: `${code} · ${input.platform || 'Instagram Reels'}`,
      actorName,
      actorUid,
    });

    const all = await listReels();
    return all.find((r) => r.id === createdId) ?? null;
  } catch (error: any) {
    console.error('Database insert failed in createReel:', error);
    if (error?.code === '23505') {
      throw new Error('A reel with this Reel ID already exists.');
    }
    throw new Error('Unable to create reel.', { cause: error });
  }
}

export async function updateReel(
  reelId: string,
  input: Partial<{
    reelCode: string;
    title: string;
    description: string;
    campaignName: string;
    referenceVideoFileId: string | null;
    referenceVideoLink: string;
    finalVideoFileId: string | null;
    assignedEditorId: string | null;
    assignedCreatorId: string | null;
    platform: string;
    editingDeadline: string | null;
    publishingDate: string | null;
    publishingTime: string | null;
    script: string;
    caption: string;
    hashtags: string;
    referenceLinks: string[];
    notes: string;
    status: string;
  }>,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(reels)
      .where(eq(reels.id, reelId))
      .limit(1);
    if (!existing) return null;

    const nextRefVideoId =
      input.referenceVideoFileId !== undefined
        ? input.referenceVideoFileId
        : existing.referenceVideoFileId;
    const nextFinalVideoId =
      input.finalVideoFileId !== undefined
        ? input.finalVideoFileId
        : existing.finalVideoFileId;

    await db.transaction(async (tx) => {
      const nextEditorId =
        input.assignedEditorId !== undefined
          ? input.assignedEditorId || null
          : existing.assignedEditorId;
      const nextCreatorId =
        input.assignedCreatorId !== undefined
          ? input.assignedCreatorId || null
          : existing.assignedCreatorId;

      await tx
        .update(reels)
        .set({
          reelCode: input.reelCode?.trim() || existing.reelCode,
          title: input.title?.trim() || existing.title,
          description:
            input.description !== undefined
              ? input.description.trim()
              : existing.description,
          campaignName:
            input.campaignName !== undefined
              ? input.campaignName.trim()
              : existing.campaignName,
          referenceVideoFileId: nextRefVideoId,
          referenceVideoUrl: nextRefVideoId ? `/api/files/${nextRefVideoId}` : null,
          referenceVideoLink:
            input.referenceVideoLink !== undefined
              ? input.referenceVideoLink.trim()
              : existing.referenceVideoLink,
          finalVideoFileId: nextFinalVideoId,
          finalVideoUrl: nextFinalVideoId ? `/api/files/${nextFinalVideoId}` : null,
          assignedEditorId: nextEditorId,
          assignedCreatorId: nextCreatorId,
          platform: input.platform?.trim() || existing.platform,
          editingDeadline:
            input.editingDeadline !== undefined
              ? input.editingDeadline || null
              : existing.editingDeadline,
          publishingDate:
            input.publishingDate !== undefined
              ? input.publishingDate || null
              : existing.publishingDate,
          publishingTime:
            input.publishingTime !== undefined
              ? input.publishingTime || null
              : existing.publishingTime,
          script:
            input.script !== undefined ? input.script.trim() : existing.script,
          caption:
            input.caption !== undefined ? input.caption.trim() : existing.caption,
          hashtags:
            input.hashtags !== undefined ? input.hashtags.trim() : existing.hashtags,
          referenceLinks:
            input.referenceLinks !== undefined
              ? input.referenceLinks
              : existing.referenceLinks,
          notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
          status: input.status || existing.status,
          updatedAt: new Date(),
        })
        .where(eq(reels.id, reelId));

      if (
        input.assignedEditorId !== undefined ||
        input.assignedCreatorId !== undefined
      ) {
        await tx.delete(reelAssignments).where(eq(reelAssignments.reelId, reelId));
        const assignments: { reelId: string; employeeId: string; role: string }[] = [];
        if (nextEditorId) {
          assignments.push({
            reelId,
            employeeId: nextEditorId,
            role: 'editor',
          });
        }
        if (nextCreatorId) {
          assignments.push({
            reelId,
            employeeId: nextCreatorId,
            role: 'creator',
          });
        }
        if (assignments.length > 0) {
          await tx.insert(reelAssignments).values(assignments);
        }
      }
    });

    if (
      input.referenceVideoFileId !== undefined &&
      existing.referenceVideoFileId &&
      existing.referenceVideoFileId !== input.referenceVideoFileId
    ) {
      await safeDeleteStoredFile(existing.referenceVideoFileId);
    }

    if (
      input.finalVideoFileId !== undefined &&
      existing.finalVideoFileId &&
      existing.finalVideoFileId !== input.finalVideoFileId
    ) {
      await safeDeleteStoredFile(existing.finalVideoFileId);
    }

    const statusChanged = input.status && input.status !== existing.status;
    await logActivity({
      entityType: 'reel',
      entityId: reelId,
      action: statusChanged ? 'status_changed' : 'updated',
      title: statusChanged
        ? `Reel "${input.title?.trim() || existing.title}" moved to ${input.status}`
        : `Updated reel "${input.title?.trim() || existing.title}"`,
      details: statusChanged
        ? `Status: ${existing.status} -> ${input.status}`
        : existing.reelCode,
      actorName,
      actorUid,
    });

    const all = await listReels();
    return all.find((r) => r.id === reelId) ?? null;
  } catch (error: any) {
    console.error('Database update failed in updateReel:', error);
    if (error?.code === '23505') {
      throw new Error('A reel with this Reel ID already exists.');
    }
    throw new Error('Unable to update reel.', { cause: error });
  }
}

export async function deleteReel(
  reelId: string,
  actorName: string,
  actorUid?: string | null
) {
  try {
    const [existing] = await db
      .select()
      .from(reels)
      .where(eq(reels.id, reelId))
      .limit(1);
    if (!existing) return false;

    await db.delete(reels).where(eq(reels.id, reelId));

    if (existing.referenceVideoFileId) {
      await safeDeleteStoredFile(existing.referenceVideoFileId);
    }
    if (existing.finalVideoFileId) {
      await safeDeleteStoredFile(existing.finalVideoFileId);
    }

    await logActivity({
      entityType: 'reel',
      entityId: reelId,
      action: 'deleted',
      title: `Deleted reel "${existing.title}"`,
      details: existing.reelCode,
      actorName,
      actorUid,
    });

    return true;
  } catch (error) {
    console.error('Database delete failed in deleteReel:', error);
    throw new Error('Unable to delete reel.', { cause: error });
  }
}

// ============================================================================
// DASHBOARD & CALENDAR (DERIVED FROM REAL RECORDS)
// ============================================================================

export async function getDashboardSummary(todayStr: string) {
  try {
    const [allEmployees, allTasks, allPosters, allReels, recentActivityRows] =
      await Promise.all([
        listEmployees(),
        listTasks(),
        listPosters(),
        listReels(),
        db
          .select()
          .from(activityLogs)
          .orderBy(desc(activityLogs.createdAt))
          .limit(15),
      ]);

    const kpis = {
      totalEmployees: allEmployees.length,
      totalTasks: allTasks.length,
      pendingTasks: allTasks.filter((t) => t.status === 'Pending').length,
      inProgressTasks: allTasks.filter((t) => t.status === 'In Progress').length,
      underReviewTasks: allTasks.filter((t) => t.status === 'Under Review').length,
      completedTasks: allTasks.filter((t) => t.status === 'Completed').length,
      overdueTasks: allTasks.filter(
        (t) =>
          t.dueDate &&
          t.dueDate < todayStr &&
          t.status !== 'Completed' &&
          t.status !== 'Cancelled'
      ).length,
      totalPosters: allPosters.length,
      totalReels: allReels.length,
    };

    const todaysWork = allTasks.filter(
      (t) =>
        t.dueDate === todayStr &&
        t.status !== 'Completed' &&
        t.status !== 'Cancelled'
    );

    const upcomingDeadlines: any[] = [];
    for (const t of allTasks) {
      if (
        t.dueDate &&
        t.dueDate >= todayStr &&
        t.status !== 'Completed' &&
        t.status !== 'Cancelled'
      ) {
        upcomingDeadlines.push({
          id: t.id,
          entityType: 'task',
          code: t.taskCode,
          title: t.title,
          deadlineDate: t.dueDate,
          deadlineKind: 'Task Due',
          status: t.status,
          assigneeNames: t.assignedEmployees.map((e) => e.fullName),
        });
      }
    }
    for (const p of allPosters) {
      if (
        p.designDeadline &&
        p.designDeadline >= todayStr &&
        p.status !== 'Published' &&
        p.status !== 'Approved'
      ) {
        upcomingDeadlines.push({
          id: p.id,
          entityType: 'poster',
          code: p.posterCode,
          title: p.title,
          deadlineDate: p.designDeadline,
          deadlineKind: 'Poster Design',
          status: p.status,
          assigneeNames: [p.assignedDesigner?.fullName, p.assignedWriter?.fullName].filter(
            Boolean
          ) as string[],
        });
      }
    }
    for (const r of allReels) {
      if (
        r.editingDeadline &&
        r.editingDeadline >= todayStr &&
        r.status !== 'Published' &&
        r.status !== 'Approved'
      ) {
        upcomingDeadlines.push({
          id: r.id,
          entityType: 'reel',
          code: r.reelCode,
          title: r.title,
          deadlineDate: r.editingDeadline,
          deadlineKind: 'Reel Editing',
          status: r.status,
          assigneeNames: [r.assignedEditor?.fullName, r.assignedCreator?.fullName].filter(
            Boolean
          ) as string[],
        });
      }
    }
    upcomingDeadlines.sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate));

    const upcomingPublishing: any[] = [];
    for (const p of allPosters) {
      if (
        p.publishingDate &&
        p.publishingDate >= todayStr &&
        p.status !== 'Published'
      ) {
        upcomingPublishing.push({
          id: p.id,
          entityType: 'poster',
          code: p.posterCode,
          title: p.title,
          platform: p.platform,
          publishingDate: p.publishingDate,
          publishingTime: p.publishingTime,
          status: p.status,
          thumbnailUrl: p.imageUrl,
        });
      }
    }
    for (const r of allReels) {
      if (
        r.publishingDate &&
        r.publishingDate >= todayStr &&
        r.status !== 'Published'
      ) {
        upcomingPublishing.push({
          id: r.id,
          entityType: 'reel',
          code: r.reelCode,
          title: r.title,
          platform: r.platform,
          publishingDate: r.publishingDate,
          publishingTime: r.publishingTime,
          status: r.status,
          thumbnailUrl: null,
        });
      }
    }
    upcomingPublishing.sort((a, b) => {
      const dateCmp = a.publishingDate.localeCompare(b.publishingDate);
      if (dateCmp !== 0) return dateCmp;
      return (a.publishingTime || '99:99').localeCompare(b.publishingTime || '99:99');
    });

    const employeeOverview = allEmployees.map((emp) => {
      const assigned = allTasks.filter((t) => t.assignedEmployeeIds.includes(emp.id));
      const completed = assigned.filter((t) => t.status === 'Completed').length;
      const pending = assigned.filter(
        (t) =>
          t.status !== 'Completed' && t.status !== 'Cancelled'
      ).length;
      return {
        id: emp.id,
        employeeCode: emp.employeeCode,
        fullName: emp.fullName,
        department: emp.department,
        designation: emp.designation,
        profileImageUrl: emp.profileImageUrl,
        isActive: emp.isActive,
        assignedTasks: assigned.length,
        completedTasks: completed,
        pendingTasks: pending,
      };
    });

    return {
      kpis,
      todaysWork,
      upcomingDeadlines: upcomingDeadlines.slice(0, 10),
      recentActivities: recentActivityRows.map((a) => ({
        ...a,
        entityType: a.entityType as any,
        createdAt: a.createdAt.toISOString(),
      })),
      upcomingPublishing: upcomingPublishing.slice(0, 10),
      employeeOverview,
    };
  } catch (error) {
    console.error('Database query failed in getDashboardSummary:', error);
    throw new Error('Unable to load dashboard summary.', { cause: error });
  }
}

export async function getCalendarEvents() {
  try {
    const [allTasks, allPosters, allReels] = await Promise.all([
      listTasks(),
      listPosters(),
      listReels(),
    ]);

    const events: any[] = [];

    for (const t of allTasks) {
      if (t.dueDate) {
        events.push({
          id: `task-${t.id}`,
          sourceId: t.id,
          entityType: 'task',
          eventType: 'task_deadline',
          label: 'Task Deadline',
          title: t.title,
          date: t.dueDate,
          time: null,
          status: t.status,
        });
      }
    }

    for (const p of allPosters) {
      if (p.designDeadline) {
        events.push({
          id: `poster-design-${p.id}`,
          sourceId: p.id,
          entityType: 'poster',
          eventType: 'poster_design_deadline',
          label: 'Poster Design Deadline',
          title: p.title,
          date: p.designDeadline,
          time: null,
          status: p.status,
          platform: p.platform,
        });
      }
      if (p.publishingDate) {
        events.push({
          id: `poster-pub-${p.id}`,
          sourceId: p.id,
          entityType: 'poster',
          eventType: 'poster_publishing',
          label: 'Poster Publishing',
          title: p.title,
          date: p.publishingDate,
          time: p.publishingTime,
          status: p.status,
          platform: p.platform,
        });
      }
    }

    for (const r of allReels) {
      if (r.editingDeadline) {
        events.push({
          id: `reel-edit-${r.id}`,
          sourceId: r.id,
          entityType: 'reel',
          eventType: 'reel_editing_deadline',
          label: 'Reel Editing Deadline',
          title: r.title,
          date: r.editingDeadline,
          time: null,
          status: r.status,
          platform: r.platform,
        });
      }
      if (r.publishingDate) {
        events.push({
          id: `reel-pub-${r.id}`,
          sourceId: r.id,
          entityType: 'reel',
          eventType: 'reel_publishing',
          label: 'Reel Publishing',
          title: r.title,
          date: r.publishingDate,
          time: r.publishingTime,
          status: r.status,
          platform: r.platform,
        });
      }
    }

    return events;
  } catch (error) {
    console.error('Database query failed in getCalendarEvents:', error);
    throw new Error('Unable to load calendar events.', { cause: error });
  }
}
