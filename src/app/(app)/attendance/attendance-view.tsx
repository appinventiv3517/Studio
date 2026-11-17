'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Badge, Button, Card, Empty, Input, Select, Stat, cx } from '@/components/ui';
import { useAction } from '@/client/use-action';
import { addDays, dayOfWeek, DAY_NAMES, monthEnd } from '@/lib/format';
import { markAttendance } from '@/client/api/attendance';

type Rec = { date: string; present: boolean };
export type Row = { id: string; name: string; title: string; records: Rec[] };

type Props = { view: 'day' | 'month'; date: string; month: string; today: string; rows: Row[]; editable: boolean };

export function AttendanceView(p: Props) {
  const tabs = [['day', `/attendance?date=${p.date}`, 'Daily'], ['month', `/attendance?view=month&month=${p.month}`, 'Monthly']] as const;
  return (
    <div className="min-w-0">
      <div className="mb-5 inline-flex rounded-xl border border-line bg-white p-1">
        {tabs.map(([k, href, label]) => (
          <Link key={k} href={href} className={cx('rounded-lg px-4 py-1.5 text-[14px] font-semibold', p.view === k ? 'bg-violet-600 text-white' : 'text-ink-soft hover:bg-stone-100')}>{label}</Link>
        ))}
      </div>
      {p.rows.length === 0 ? <Card pad={false}><Empty title="No staff yet">Add your team on the Staff page first.</Empty></Card>
        : p.view === 'day' ? <Daily {...p} /> : <Monthly {...p} />}
    </div>
  );
}

function Daily({ date, today, rows, editable }: Props) {
  const router = useRouter();
  const { run, pending } = useAction();
  const items = rows.map((r) => ({ r, rec: r.records.find((x) => x.date === date) }));
  const present = items.filter((i) => i.rec?.present).length;
  const absent = items.filter((i) => i.rec && !i.rec.present).length;
  const go = (d: string) => d && router.push(`/attendance?date=${d}`);
  const canMark = editable && date <= today;
  const mark = (r: Row, value: boolean) => run(() => markAttendance({ staffId: r.id, date, present: value }), `${r.name} marked ${value ? 'present' : 'absent'}`);

  return (
    <>
      <div className="mb-5 grid grid-cols-3 gap-4">
        <Stat label="Present" value={present} tone="good" />
        <Stat label="Absent" value={absent} tone={absent ? 'warn' : undefined} />
        <Stat label="Not marked" value={rows.length - present - absent} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1">
        <Button variant="secondary" aria-label="Previous day" onClick={() => go(addDays(date, -1))}><ChevronLeft size={16} /></Button>
        <Input type="date" value={date} onChange={(e) => go(e.target.value)} className="w-auto" aria-label="Date" />
        <Button variant="secondary" aria-label="Next day" onClick={() => go(addDays(date, 1))}><ChevronRight size={16} /></Button>
        {date !== today && <Button variant="ghost" onClick={() => go(today)}>Today</Button>}
      </div>

      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Staff</th><th>Status</th>{canMark && <th />}</tr></thead>
            <tbody>
              {items.map(({ r, rec }) => (
                <tr key={r.id} className="hover:bg-canvas/60">
                  <td><div className="font-medium">{r.name}</div><div className="text-[12px] text-ink-mute">{r.title}</div></td>
                  <td>{rec ? <Badge tone={rec.present ? 'green' : 'red'}>{rec.present ? 'Present' : 'Absent'}</Badge> : <Badge tone="gray">Not marked</Badge>}</td>
                  {canMark && (
                    <td className="whitespace-nowrap text-right">
                      <Button size="sm" variant={rec?.present ? 'primary' : 'secondary'} disabled={pending} onClick={() => mark(r, true)}><Check size={14} />Present</Button>{' '}
                      <Button size="sm" variant={rec && !rec.present ? 'primary' : 'secondary'} disabled={pending} onClick={() => mark(r, false)}><X size={14} />Absent</Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {date > today && <p className="mt-3 text-[12.5px] text-ink-mute">Attendance can only be marked for today or an earlier date.</p>}
    </>
  );
}

function Monthly({ month, today, rows }: Props) {
  const router = useRouter();
  const from = `${month}-01`;
  const days = Array.from({ length: Number(monthEnd(from).slice(8)) }, (_, i) => addDays(from, i));
  const th = 'px-3 py-3 text-right text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-soft';
  const cell = (rec?: Rec) => rec ? (rec.present ? ['P', 'bg-emerald-50 text-emerald-700'] : ['A', 'bg-rose-50 text-rose-700']) : ['–', 'text-stone-300'];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input type="month" value={month} onChange={(e) => e.target.value && router.push(`/attendance?view=month&month=${e.target.value}`)} className="w-auto" aria-label="Month" />
        <div className="ml-auto flex flex-wrap gap-3 text-[12.5px] text-ink-soft">
          {[['P', 'Present'], ['A', 'Absent'], ['–', 'Not marked']].map(([l, t]) => <span key={l} className="inline-flex items-center gap-1.5"><span className={cx('inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold', cell(l === 'P' ? { date: '', present: true } : l === 'A' ? { date: '', present: false } : undefined)[1])}>{l}</span>{t}</span>)}
        </div>
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 min-w-[150px] bg-white px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-soft">Staff</th>
                {days.map((d) => (
                  <th key={d} className={cx('px-0.5 py-2 text-center font-semibold text-ink-soft', d === today && 'text-violet-600')}>
                    <div className="tabular">{Number(d.slice(8))}</div><div className="text-[10px] font-medium text-ink-mute">{DAY_NAMES[dayOfWeek(d)][0]}</div>
                  </th>
                ))}
                <th className={th}>Present</th><th className={th}>Absent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const by = new Map(r.records.map((x) => [x.date, x]));
                const present = r.records.filter((x) => x.present).length;
                const absent = r.records.length - present;
                return (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="sticky left-0 z-10 bg-white px-4 py-3"><div className="font-medium">{r.name}</div><div className="text-[11.5px] text-ink-mute">{r.title}</div></td>
                    {days.map((d) => {
                      const [letter, tone] = cell(by.get(d));
                      return <td key={d} className="px-0.5 py-2 text-center"><span className={cx('inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold', tone)}>{letter}</span></td>;
                    })}
                    <td className="tabular px-3 py-3 text-right font-semibold">{present}</td>
                    <td className={cx('tabular px-3 py-3 text-right font-semibold', absent > 0 && 'text-rose-600')}>{absent}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <MonthCalendar from={from} days={days} today={today} rows={rows} />
    </>
  );
}

/** One person's month laid out as a calendar. Click a day to open it in the Daily tab. */
function MonthCalendar({ from, days, today, rows }: { from: string; days: string[]; today: string; rows: Row[] }) {
  const [staffId, setStaffId] = useState(rows[0]?.id ?? '');
  const row = rows.find((r) => r.id === staffId) ?? rows[0];
  const by = new Map(row.records.map((x) => [x.date, x]));
  const present = row.records.filter((x) => x.present).length;
  const absent = row.records.length - present;
  const blanks = Array.from({ length: dayOfWeek(from) });

  return (
    <Card className="mt-5" title="Calendar" subtitle="Pick a person to see their month day by day"
      actions={<Select value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff">{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}>
      <div className="mb-4 flex gap-2"><Badge tone="green">{present} present</Badge><Badge tone="red">{absent} absent</Badge></div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {DAY_NAMES.map((d) => <div key={d} className="pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-mute">{d}</div>)}
        {blanks.map((_, i) => <div key={`b${i}`} />)}
        {days.map((d) => {
          const rec = by.get(d);
          return (
            <Link key={d} href={`/attendance?date=${d}`} className={cx('flex h-16 flex-col items-center justify-center rounded-lg border text-[13px] hover:border-violet-400',
              rec ? (rec.present ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700') : 'border-line text-ink-soft',
              d === today && 'ring-2 ring-violet-500')}>
              <span className="tabular font-semibold">{Number(d.slice(8))}</span>
              <span className="text-[11px] font-medium">{rec ? (rec.present ? 'Present' : 'Absent') : '–'}</span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
