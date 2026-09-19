/**
 * Date-only helpers. All schedule dates are ISO `YYYY-MM-DD` strings and
 * every reservation occupies whole days, inclusive of both endpoints —
 * matching how the legacy workbook recorded occupancy. Internally dates are
 * anchored to UTC noon so arithmetic can never cross a DST boundary.
 */

const DAY_MS = 86_400_000

export function toDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`)
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function todayISO(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(iso: string, n: number): string {
  return toISO(new Date(toDate(iso).getTime() + n * DAY_MS))
}

/** Days from a to b (b - a). Same day = 0. */
export function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS)
}

/** Inclusive span in days: Sep 17–21 = 5. */
export function spanDays(startISO: string, endISO: string): number {
  return diffDays(startISO, endISO) + 1
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function addMonths(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return toISO(d)
}

/** Monday-based start of week. */
export function startOfWeek(iso: string): string {
  const dow = toDate(iso).getUTCDay() // 0 = Sun
  const back = dow === 0 ? 6 : dow - 1
  return addDays(iso, -back)
}

export function isWeekend(iso: string): boolean {
  const dow = toDate(iso).getUTCDay()
  return dow === 0 || dow === 6
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function monthShort(iso: string): string {
  return MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]
}

export function monthLong(iso: string): string {
  return MONTHS_LONG[Number(iso.slice(5, 7)) - 1]
}

export function dayNum(iso: string): number {
  return Number(iso.slice(8, 10))
}

export function yearNum(iso: string): number {
  return Number(iso.slice(0, 4))
}

export function dowLetter(iso: string): string {
  return DOW_LETTER[toDate(iso).getUTCDay()]
}

/** `Sep 17` */
export function fmtDay(iso: string): string {
  return `${monthShort(iso)} ${dayNum(iso)}`
}

/** `Sep 17, 2026` */
export function fmtDayYear(iso: string): string {
  return `${fmtDay(iso)}, ${yearNum(iso)}`
}

/**
 * Compact inclusive range: `Sep 17–21`, `Sep 29 – Oct 6`,
 * `Dec 28, 2026 – Jan 4, 2027`. Single day collapses to `Sep 24`.
 */
export function fmtRange(a: string, b: string, opts?: { year?: boolean }): string {
  const withYear = opts?.year ?? false
  if (a === b) return withYear ? fmtDayYear(a) : fmtDay(a)
  const sameYear = yearNum(a) === yearNum(b)
  const sameMonth = sameYear && a.slice(0, 7) === b.slice(0, 7)
  if (sameMonth) {
    const base = `${monthShort(a)} ${dayNum(a)}–${dayNum(b)}`
    return withYear ? `${base}, ${yearNum(a)}` : base
  }
  if (sameYear) {
    const base = `${fmtDay(a)} – ${fmtDay(b)}`
    return withYear ? `${base}, ${yearNum(a)}` : base
  }
  return `${fmtDayYear(a)} – ${fmtDayYear(b)}`
}

/** List of ISO dates starting at `startISO`, `n` days long. */
export function dateRange(startISO: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(startISO, i))
}

/** `410 ft` / `not stated` — one rendering for a berth's rated length. */
export function fmtBerthLength(maxLengthFt: number | null): string {
  return maxLengthFt == null ? 'not stated' : `${maxLengthFt} ft`
}
