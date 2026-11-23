import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CalendarEvent, NavSection } from '../types';
import { formatTime12h, getLocalTodayISO } from '../utils/dates';
import { getCalendarEventColor } from '../utils/colors';

interface CalendarPageProps {
  events: CalendarEvent[];
  loading: boolean;
  onOpenEvent: (
    section: NavSection,
    opts: { taskId?: string; posterId?: string; reelId?: string }
  ) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LEGEND_ITEMS = [
  { type: 'task_deadline', label: 'Task Deadlines', color: '#4776E6' },
  { type: 'poster_design_deadline', label: 'Poster Design Deadlines', color: '#E85B9A' },
  { type: 'poster_publishing', label: 'Poster Publishing', color: '#8757D5' },
  { type: 'reel_editing_deadline', label: 'Reel Editing Deadlines', color: '#F29A38' },
  { type: 'reel_publishing', label: 'Reel Publishing', color: '#159D91' },
];

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function CalendarPage({
  events,
  loading,
  onOpenEvent,
}: CalendarPageProps) {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const todayISO = getLocalTodayISO();

  const filteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events;
    return events.filter((e) => e.eventType === typeFilter);
  }, [events, typeFilter]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of filteredEvents) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [filteredEvents]);

  const monthCells = useMemo(() => {
    const year = cursorDate.getFullYear();
    const month = cursorDate.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const cells: { date: Date; iso: string; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i
      );
      cells.push({
        date: d,
        iso: toISODate(d),
        inMonth: d.getMonth() === month,
      });
    }
    return cells;
  }, [cursorDate]);

  const weekCells = useMemo(() => {
    const start = new Date(
      cursorDate.getFullYear(),
      cursorDate.getMonth(),
      cursorDate.getDate() - cursorDate.getDay()
    );
    const cells: { date: Date; iso: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + i
      );
      cells.push({ date: d, iso: toISODate(d) });
    }
    return cells;
  }, [cursorDate]);

  const handlePrev = () => {
    if (viewMode === 'month') {
      setCursorDate(
        new Date(cursorDate.getFullYear(), cursorDate.getMonth() - 1, 1)
      );
    } else {
      setCursorDate(
        new Date(
          cursorDate.getFullYear(),
          cursorDate.getMonth(),
          cursorDate.getDate() - 7
        )
      );
    }
  };

  const handleNext = () => {
    if (viewMode === 'month') {
      setCursorDate(
        new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 1)
      );
    } else {
      setCursorDate(
        new Date(
          cursorDate.getFullYear(),
          cursorDate.getMonth(),
          cursorDate.getDate() + 7
        )
      );
    }
  };

  const handleToday = () => {
    setCursorDate(new Date());
  };

  const handleClickEvent = (ev: CalendarEvent) => {
    if (ev.entityType === 'task') {
      onOpenEvent('tasks', { taskId: ev.sourceId });
    } else if (ev.entityType === 'poster') {
      onOpenEvent('posters', { posterId: ev.sourceId });
    } else {
      onOpenEvent('reels', { reelId: ev.sourceId });
    }
  };

  const headerTitle =
    viewMode === 'month'
      ? cursorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : `Week of ${weekCells[0].date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })} – ${weekCells[6].date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Calendar
          </h1>
          <p className="text-sm text-slate-500">
            Live deadlines and publishing schedule derived from tasks, posters, and reels
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'month'
                  ? 'bg-[#16A6C1] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                viewMode === 'week'
                  ? 'bg-[#16A6C1] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Weekly
            </button>
          </div>
        </div>
      </div>

      {/* Controls & Color Legend */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <h2 className="ml-2 text-base font-extrabold text-slate-900">
            {headerTitle}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              typeFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({events.length})
          </button>
          {LEGEND_ITEMS.map((item) => {
            const active = typeFilter === item.type;
            return (
              <button
                key={item.type}
                type="button"
                onClick={() =>
                  setTypeFilter(active ? 'all' : item.type)
                }
                style={
                  active
                    ? { backgroundColor: item.color, color: '#FFFFFF' }
                    : undefined
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-transparent'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {!active && (
                  <span
                    style={{ backgroundColor: item.color }}
                    className="h-2.5 w-2.5 rounded-sm"
                  />
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Calendar Grid */}
      {loading && events.length === 0 ? (
        <div className="h-[520px] animate-pulse rounded-2xl bg-slate-200" />
      ) : viewMode === 'month' ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="px-2 py-2.5 text-center text-xs font-bold text-slate-500"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
            {monthCells.map((cell) => {
              const dayEvents = eventsByDate.get(cell.iso) ?? [];
              const isToday = cell.iso === todayISO;
              return (
                <div
                  key={cell.iso}
                  className={`min-h-[115px] p-2 ${
                    cell.inMonth ? 'bg-white' : 'bg-slate-50/60'
                  } ${isToday ? 'ring-2 ring-inset ring-[#4776E6]' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`tabular-nums inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-bold ${
                        isToday
                          ? 'bg-[#4776E6] text-white'
                          : cell.inMonth
                          ? 'text-slate-800'
                          : 'text-slate-400'
                      }`}
                    >
                      {cell.date.getDate()}
                    </span>
                    {isToday && (
                      <span className="text-[10px] font-bold text-[#4776E6]">
                        Today
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {dayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => handleClickEvent(ev)}
                        style={{ backgroundColor: getCalendarEventColor(ev.eventType) }}
                        className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                        title={`${ev.label}: ${ev.title}${
                          ev.time ? ` (${formatTime12h(ev.time)})` : ''
                        }`}
                      >
                        {ev.time ? `${formatTime12h(ev.time)} · ` : ''}
                        {ev.title}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Weekly View */
        <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
          {weekCells.map((cell) => {
            const dayEvents = eventsByDate.get(cell.iso) ?? [];
            const isToday = cell.iso === todayISO;
            return (
              <div
                key={cell.iso}
                className={`min-h-[260px] rounded-2xl border bg-white p-3.5 shadow-xs ${
                  isToday ? 'border-[#4776E6] ring-1 ring-[#4776E6]' : 'border-slate-200/80'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-500">
                      {WEEKDAYS[cell.date.getDay()]}
                    </div>
                    <div
                      className={`tabular-nums text-lg font-extrabold ${
                        isToday ? 'text-[#4776E6]' : 'text-slate-900'
                      }`}
                    >
                      {cell.date.getDate()}
                    </div>
                  </div>
                  {isToday && (
                    <span className="rounded-md bg-[#4776E6] px-2 py-0.5 text-[10px] font-bold text-white">
                      Today
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-2">
                  {dayEvents.length === 0 ? (
                    <p className="text-xs text-slate-400">No events</p>
                  ) : (
                    dayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => handleClickEvent(ev)}
                        style={{ backgroundColor: getCalendarEventColor(ev.eventType) }}
                        className="w-full rounded-xl p-2.5 text-left text-white shadow-xs transition-opacity hover:opacity-90"
                      >
                        <div className="text-[10px] font-bold text-white/85">
                          {ev.label}
                        </div>
                        <div className="mt-0.5 text-xs font-bold leading-snug">
                          {ev.title}
                        </div>
                        {ev.time && (
                          <div className="tabular-nums mt-1 text-[11px] font-medium text-white/90">
                            {formatTime12h(ev.time)}
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
