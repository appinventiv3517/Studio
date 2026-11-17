import 'server-only';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { attempt } from '@/server/api/attempt';
import { ActionError, requireEdit } from '@/server/auth/session';
import { isoDate } from '@/lib/format';
import * as v from '@/lib/validate';

const schema = z.object({ staffId: v.id, date: v.date, present: z.boolean().optional(), remark: z.string().trim().max(200).optional() });

/**
 * Mark a staff member present or absent on a date, and/or add a remark such as "left early" or "late out".
 * Marking again changes the answer. Leave `present` out to change only the remark. An empty remark clears it.
 */
export async function markAttendance(input: { staffId: string; date: string; present?: boolean; remark?: string }) {
  return attempt(async () => {
    await requireEdit('attendance');
    const { staffId, date, present, remark } = schema.parse(input);
    if (date > isoDate()) throw new ActionError('You cannot mark attendance for a future date.');
    const s = await db.staff.findUnique({ where: { id: staffId }, select: { active: true } });
    if (!s?.active) throw new ActionError('That staff member is no longer active.');
    const existing = await db.attendance.findUnique({ where: { staffId_date: { staffId, date } } });
    if (!existing && present === undefined) throw new ActionError('Mark present or absent first.');
    const data = { ...(present !== undefined && { present }), ...(remark !== undefined && { remark: remark || null }) };
    if (existing) await db.attendance.update({ where: { id: existing.id }, data });
    else await db.attendance.create({ data: { staffId, date, present: present!, ...data } });
    revalidatePath('/attendance');
  });
}
