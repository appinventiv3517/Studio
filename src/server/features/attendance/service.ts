import 'server-only';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { attempt } from '@/server/api/attempt';
import { ActionError, requireEdit } from '@/server/auth/session';
import { isoDate } from '@/lib/format';
import * as v from '@/lib/validate';

const schema = z.object({ staffId: v.id, date: v.date, present: z.boolean() });

/** Mark a staff member present or absent on a date. Marking again changes the answer. */
export async function markAttendance(input: { staffId: string; date: string; present: boolean }) {
  return attempt(async () => {
    await requireEdit('attendance');
    const { staffId, date, present } = schema.parse(input);
    if (date > isoDate()) throw new ActionError('You cannot mark attendance for a future date.');
    const s = await db.staff.findUnique({ where: { id: staffId }, select: { active: true } });
    if (!s?.active) throw new ActionError('That staff member is no longer active.');
    await db.attendance.upsert({
      where: { staffId_date: { staffId, date } },
      create: { staffId, date, present },
      update: { present },
    });
    revalidatePath('/attendance');
  });
}
