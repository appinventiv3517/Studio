import { call } from '@/client/api/call';
import type * as s from '@/server/features/attendance/service';

export const markAttendance = (i: Parameters<typeof s.markAttendance>[0]) => call('PUT', '/attendance', i);
