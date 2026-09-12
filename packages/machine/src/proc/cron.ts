import { ROOT_USER, type Vfs } from '../vfs/vfs.js';

export const CRONTAB = '/etc/crontab';

export interface CronEntry {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  /** The user column, as /etc/crontab has and a user crontab does not. */
  user: string;
  command: string;
  /** Source line, so errors and `crontab -l` can echo it verbatim. */
  source: string;
}

/**
 * The wall-clock fields a cron expression is matched against.
 *
 * Derived from the virtual clock plus the machine's epoch, never from
 * `new Date()` — cron is exactly the feature that would tempt someone to
 * reach for real time and quietly destroy determinism.
 */
export interface CronFields {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

export function fieldsAt(epochMs: number, clockMs: number): CronFields {
  const d = new Date(epochMs + clockMs);
  return {
    minute: d.getUTCMinutes(),
    hour: d.getUTCHours(),
    dayOfMonth: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
    dayOfWeek: d.getUTCDay(),
  };
}

/** Parse /etc/crontab. Unparseable lines are skipped, as cron skips them. */
export function parseCrontab(text: string): CronEntry[] {
  const entries: CronEntry[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    // Environment assignments (PATH=, SHELL=) are not schedules.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 7) continue;

    entries.push({
      minute: parts[0]!,
      hour: parts[1]!,
      dayOfMonth: parts[2]!,
      month: parts[3]!,
      dayOfWeek: parts[4]!,
      user: parts[5]!,
      command: parts.slice(6).join(' '),
      source: line,
    });
  }

  return entries;
}

/**
 * Does one cron field match one value?
 *
 * Supports `*`, `a`, `a-b`, `a,b,c`, and any of those with a `/step`.
 */
export function matchField(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    const [range = '', stepText] = part.split('/');
    const step = stepText ? Number(stepText) : 1;
    if (!Number.isFinite(step) || step < 1) return false;

    let lo: number;
    let hi: number;

    if (range === '*') {
      // An unbounded range only constrains via the step, so anchor on zero.
      return step === 1 || value % step === 0;
    }
    if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(range);
      hi = lo;
    }

    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    if (value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}

export function matches(entry: CronEntry, at: CronFields): boolean {
  return (
    matchField(entry.minute, at.minute) &&
    matchField(entry.hour, at.hour) &&
    matchField(entry.month, at.month) &&
    // Real cron ORs day-of-month and day-of-week when both are restricted.
    // Reproducing that is worth it: it is a genuine and famous gotcha.
    dayMatches(entry, at)
  );
}

function dayMatches(entry: CronEntry, at: CronFields): boolean {
  const domRestricted = entry.dayOfMonth !== '*';
  const dowRestricted = entry.dayOfWeek !== '*';
  const dom = matchField(entry.dayOfMonth, at.dayOfMonth);
  const dow = matchField(entry.dayOfWeek, at.dayOfWeek);

  if (domRestricted && dowRestricted) return dom || dow;
  if (domRestricted) return dom;
  if (dowRestricted) return dow;
  return true;
}

const MINUTE = 60_000;
/**
 * How far cron will catch up in one tick.
 *
 * `sleep 999999` must not spawn ten thousand jobs. A real machine that was
 * asleep does not replay every missed minute either.
 */
export const MAX_CATCHUP_MINUTES = 60;

export interface DueJob {
  entry: CronEntry;
  /** Virtual-clock time of the minute this fired for. */
  at: number;
}

/**
 * Which crontab entries are due between two clock readings?
 *
 * Exclusive of `from`, inclusive of `to`, so advancing the clock twice never
 * fires the same minute twice.
 */
export function dueBetween(
  vfs: Vfs,
  epochMs: number,
  fromMs: number,
  toMs: number,
): DueJob[] {
  let text: string;
  try {
    text = vfs.readText(CRONTAB, ROOT_USER);
  } catch {
    return [];
  }

  const entries = parseCrontab(text);
  if (entries.length === 0) return [];

  const firstMinute = Math.floor(fromMs / MINUTE) + 1;
  const lastMinute = Math.floor(toMs / MINUTE);
  if (lastMinute < firstMinute) return [];

  const start = Math.max(firstMinute, lastMinute - MAX_CATCHUP_MINUTES + 1);
  const due: DueJob[] = [];

  for (let m = start; m <= lastMinute; m++) {
    const at = m * MINUTE;
    const fields = fieldsAt(epochMs, at);
    for (const entry of entries) {
      if (matches(entry, fields)) due.push({ entry, at });
    }
  }

  return due;
}
