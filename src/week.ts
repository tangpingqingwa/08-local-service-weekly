import type { AppDb } from "./db";

/** SPEC §6 / BUILD: open week is Monday 00:00 Europe/London. */
export const WEEK_TIMEZONE = "Europe/London";

const WEEK_ID_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type WeekWindow = {
  id: string;
  timezone: typeof WEEK_TIMEZONE;
  opensAt: Date;
  closesAt: Date;
};

export type WeekErrorCode = "week_closed" | "invalid_week";

export class WeekError extends Error {
  constructor(
    readonly code: WeekErrorCode,
    readonly httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "WeekError";
  }
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function requirePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error(`missing ${type} in zoned datetime`);
  }
  return value;
}

/** Calendar parts of `instant` in `timeZone`. Weekday is JS-style (Sun=0). */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(instant);
  const weekdayLabel = requirePart(parts, "weekday");
  const weekday = WEEKDAY_INDEX[weekdayLabel];
  if (weekday === undefined) {
    throw new Error(`unknown weekday ${JSON.stringify(weekdayLabel)}`);
  }
  return {
    year: Number(requirePart(parts, "year")),
    month: Number(requirePart(parts, "month")),
    day: Number(requirePart(parts, "day")),
    hour: Number(requirePart(parts, "hour")),
    minute: Number(requirePart(parts, "minute")),
    second: Number(requirePart(parts, "second")),
    weekday,
  };
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function formatIsoDate(parts: {
  year: number;
  month: number;
  day: number;
}): string {
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

export function parseWeekId(id: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = WEEK_ID_RE.exec(id);
  if (!match) {
    throw new WeekError("invalid_week", 400);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    throw new WeekError("invalid_week", 400);
  }
  return { year, month, day };
}

/**
 * Instant that displays as local midnight of `year-month-day` in `timeZone`.
 * UK offset is 0 or +1 and Monday 00:00 is never in a DST gap.
 */
export function zonedMidnight(
  timeZone: string,
  year: number,
  month: number,
  day: number,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const parts = zonedParts(new Date(utcGuess), timeZone);
  const shown = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  const target = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return new Date(utcGuess + (target - shown));
}

const WEEK_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: WEEK_TIMEZONE,
});

/** Spoken folio for the Monday that opens `id`, e.g. `Mon 17 Aug 2026`. */
export function formatWeekLabel(id: string): string {
  const monday = parseWeekId(id);
  return WEEK_LABEL.format(
    zonedMidnight(WEEK_TIMEZONE, monday.year, monday.month, monday.day),
  );
}

/** Monday ISO date of the week containing `now` in `timeZone`, e.g. `2026-08-17`. */
export function weekId(
  now: Date = new Date(),
  timeZone: string = WEEK_TIMEZONE,
): string {
  const parts = zonedParts(now, timeZone);
  const daysFromMonday = parts.weekday === 0 ? 6 : parts.weekday - 1;
  return formatIsoDate(
    addCalendarDays(parts.year, parts.month, parts.day, -daysFromMonday),
  );
}

/** Open week id in Europe/London. */
export function currentWeekId(now: Date = new Date()): string {
  return weekId(now, WEEK_TIMEZONE);
}

export function previousWeekId(id: string): string {
  const parts = parseWeekId(id);
  return formatIsoDate(addCalendarDays(parts.year, parts.month, parts.day, -7));
}

export function nextWeekId(id: string): string {
  const parts = parseWeekId(id);
  return formatIsoDate(addCalendarDays(parts.year, parts.month, parts.day, 7));
}

/** [Monday 00:00, next Monday 00:00) Europe/London for a Monday `id`. */
export function weekWindow(id: string): WeekWindow {
  const monday = parseWeekId(id);
  const next = addCalendarDays(monday.year, monday.month, monday.day, 7);
  return {
    id,
    timezone: WEEK_TIMEZONE,
    opensAt: zonedMidnight(
      WEEK_TIMEZONE,
      monday.year,
      monday.month,
      monday.day,
    ),
    closesAt: zonedMidnight(WEEK_TIMEZONE, next.year, next.month, next.day),
  };
}

export function currentWeek(now: Date = new Date()): WeekWindow {
  return weekWindow(currentWeekId(now));
}

export function isOpenWeek(id: string, now: Date = new Date()): boolean {
  return id === currentWeekId(now);
}

/** Raise and new bids apply only to the open London week. */
export function requireOpenWeek(
  id: string,
  now: Date = new Date(),
): string {
  parseWeekId(id);
  if (!isOpenWeek(id, now)) {
    throw new WeekError("week_closed", 409);
  }
  return id;
}

export function ensureWeek(
  db: AppDb,
  id: string = currentWeekId(),
): string {
  parseWeekId(id);
  const existing = db
    .prepare<[string], { id: string }>("SELECT id FROM weeks WHERE id = ?")
    .get(id);
  if (existing) {
    return id;
  }
  const window = weekWindow(id);
  db.prepare(
    "INSERT INTO weeks (id, timezone, opens_at, closes_at) VALUES (?, ?, ?, ?)",
  ).run(
    id,
    window.timezone,
    window.opensAt.toISOString(),
    window.closesAt.toISOString(),
  );
  return id;
}
