import type { Berth, Reservation, Vessel } from '../data/types'
import { addDays, dateRange, spanDays } from './dates'

/**
 * Scheduling engine — pure functions only.
 *
 * Every rule the product enforces lives here, not in components:
 *   fit        vessel.lengthFt <= berth.maxLengthFt (equal length fits)
 *   occupancy  whole days, inclusive on both endpoints
 *   overlap    aStart <= bEnd && bStart <= aEnd
 *   blocking   only ACTIVE reservations block; cancelled ones never do
 *
 * The same functions drive the New Reservation panel, the schedule's
 * matching mode, and creation-time validation in the store — so the UI can
 * never disagree with the rules that actually gate a reservation.
 */

export interface DateWindow {
  startDate: string
  endDate: string
}

export interface BookingRequest {
  kind: 'vessel' | 'event'
  /** Vessel length overall; null for events (no fit check). */
  lengthFt: number | null
  startDate: string
  endDate: string
}

export type BerthStatus = 'available' | 'occupied' | 'too-short'

export interface BerthEvaluation {
  berth: Berth
  /** berth.maxLengthFt − vessel.lengthFt. Null for event requests. */
  clearanceFt: number | null
  fits: boolean
  status: BerthStatus
  /** Active reservations overlapping the request, sorted by start. */
  conflicts: Reservation[]
  /** Requested days that are blocked (subset of the requested range). */
  blockedDays: string[]
  /** Per requested day: occupied or free (for the availability strip). */
  dayStates: { date: string; occupied: boolean }[]
  /** Nearest full-duration free windows; only computed when occupied. */
  alternatives: { earlier: DateWindow | null; later: DateWindow | null } | null
}

export interface RequestEvaluation {
  results: BerthEvaluation[]
  counts: { available: number; occupied: number; tooShort: number }
  /** Smallest compatible free berth — a suggestion, not an assignment. */
  suggestedBerthId: string | null
}

/** Inclusive whole-day overlap. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/**
 * Length fit. A berth with no rated length (the workbook's "North Finger
 * Piers" and "Small craft slips" rows state none) cannot be assessed, so fit
 * is reported as unknown rather than assumed to pass or fail.
 */
export function vesselFitsBerth(
  lengthFt: number,
  berth: Berth,
): { fits: boolean; clearanceFt: number | null } {
  if (berth.maxLengthFt == null) return { fits: true, clearanceFt: null }
  const clearanceFt = berth.maxLengthFt - lengthFt
  return { fits: clearanceFt >= 0, clearanceFt }
}

/** Active reservations on one berth that overlap [startDate, endDate]. */
export function getBerthConflicts(
  berthId: string,
  startDate: string,
  endDate: string,
  reservations: Reservation[],
): Reservation[] {
  return reservations
    .filter(
      (r) =>
        r.status === 'active' &&
        r.berthId === berthId &&
        overlaps(startDate, endDate, r.startDate, r.endDate),
    )
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

export function isBerthFree(
  berthId: string,
  startDate: string,
  endDate: string,
  reservations: Reservation[],
): boolean {
  return getBerthConflicts(berthId, startDate, endDate, reservations).length === 0
}

export interface WindowSearchOptions {
  /** How far (days) from the requested start to scan in each direction. */
  searchDays?: number
  /** Earlier windows may not begin before this date (e.g. today). */
  minStart?: string
}

/**
 * Deterministic nearby-alternative search: scan day by day, outward from the
 * requested start, for the nearest earlier and nearest later window of the
 * same duration that is completely free on this berth. At most one of each.
 */
export function getNearestWindows(
  berthId: string,
  request: DateWindow,
  reservations: Reservation[],
  opts: WindowSearchOptions = {},
): { earlier: DateWindow | null; later: DateWindow | null } {
  const searchDays = opts.searchDays ?? 30
  const duration = spanDays(request.startDate, request.endDate)

  let later: DateWindow | null = null
  for (let off = 1; off <= searchDays; off++) {
    const s = addDays(request.startDate, off)
    const e = addDays(s, duration - 1)
    if (isBerthFree(berthId, s, e, reservations)) {
      later = { startDate: s, endDate: e }
      break
    }
  }

  let earlier: DateWindow | null = null
  for (let off = 1; off <= searchDays; off++) {
    const s = addDays(request.startDate, -off)
    if (opts.minStart && s < opts.minStart) break
    const e = addDays(s, duration - 1)
    if (isBerthFree(berthId, s, e, reservations)) {
      earlier = { startDate: s, endDate: e }
      break
    }
  }

  return { earlier, later }
}

export function evaluateBerth(
  berth: Berth,
  request: BookingRequest,
  reservations: Reservation[],
  opts: WindowSearchOptions = {},
): BerthEvaluation {
  const fit =
    request.kind === 'vessel' && request.lengthFt != null && berth.maxLengthFt != null
      ? vesselFitsBerth(request.lengthFt, berth)
      : null

  const fits = fit ? fit.fits : true
  const conflicts = getBerthConflicts(berth.id, request.startDate, request.endDate, reservations)

  const days =
    spanDays(request.startDate, request.endDate) <= 62
      ? dateRange(request.startDate, spanDays(request.startDate, request.endDate))
      : []
  const dayStates = days.map((date) => ({
    date,
    occupied: conflicts.some((c) => c.startDate <= date && c.endDate >= date),
  }))
  const blockedDays = dayStates.filter((d) => d.occupied).map((d) => d.date)

  const status: BerthStatus = !fits ? 'too-short' : conflicts.length > 0 ? 'occupied' : 'available'

  return {
    berth,
    clearanceFt: fit ? fit.clearanceFt : null,
    fits,
    status,
    conflicts,
    blockedDays,
    dayStates,
    alternatives:
      status === 'occupied'
        ? getNearestWindows(berth.id, request, reservations, opts)
        : null,
  }
}

/**
 * Evaluate every active berth for a request.
 *
 * Ordering: available first (smallest adequate berth first), then occupied
 * (same size preference), then too-short (closest to fitting first). Ties
 * preserve the waterfront's physical berth order.
 */
export function evaluateRequest(
  berths: Berth[],
  request: BookingRequest,
  reservations: Reservation[],
  opts: WindowSearchOptions = {},
): RequestEvaluation {
  const results = berths
    .filter((b) => b.active)
    .map((b) => evaluateBerth(b, request, reservations, opts))

  const groupRank: Record<BerthStatus, number> = { available: 0, occupied: 1, 'too-short': 2 }
  results.sort((a, b) => {
    const g = groupRank[a.status] - groupRank[b.status]
    if (g !== 0) return g
    if (a.status === 'too-short') {
      // least deficit first
      return (b.clearanceFt ?? 0) - (a.clearanceFt ?? 0)
    }
    // smallest adequate berth first; unrated berths last (stable on ties)
    return (a.berth.maxLengthFt ?? Number.POSITIVE_INFINITY)
      - (b.berth.maxLengthFt ?? Number.POSITIVE_INFINITY)
  })

  const counts = {
    available: results.filter((r) => r.status === 'available').length,
    occupied: results.filter((r) => r.status === 'occupied').length,
    tooShort: results.filter((r) => r.status === 'too-short').length,
  }

  return {
    results,
    counts,
    suggestedBerthId: results.find((r) => r.status === 'available')?.berth.id ?? null,
  }
}

/* ——— availability windows ——— */

export interface Opening {
  startDate: string
  /** Null = open-ended: nothing scheduled after startDate within the horizon. */
  endDate: string | null
  /** Length in days; null when open-ended. */
  days: number | null
}

/**
 * Nearest free window on a berth at or after `fromISO` that is at least
 * `minDays` long, scanning up to `horizonDays` ahead (default 90). Returns
 * the FULL free interval (bounded by the next active reservation), not a
 * truncated one; open-ended intervals have `endDate: null`. Only active
 * reservations block — consistent with the inclusive whole-day overlap rule
 * (a booking ending Sep 19 leaves Sep 20 as the first free day).
 */
export function getNextOpening(
  berthId: string,
  fromISO: string,
  reservations: Reservation[],
  opts: { minDays?: number; horizonDays?: number } = {},
): Opening | null {
  const minDays = opts.minDays ?? 1
  const limit = addDays(fromISO, opts.horizonDays ?? 90)

  // Merge active intervals for this berth (touching intervals leave no free day).
  const busy = reservations
    .filter((r) => r.status === 'active' && r.berthId === berthId && r.endDate >= fromISO)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const merged: { start: string; end: string }[] = []
  for (const r of busy) {
    const last = merged[merged.length - 1]
    if (last && r.startDate <= addDays(last.end, 1)) {
      if (r.endDate > last.end) last.end = r.endDate
    } else {
      merged.push({ start: r.startDate, end: r.endDate })
    }
  }

  let cursor = fromISO
  for (const iv of merged) {
    if (iv.start > cursor) {
      const gapEnd = addDays(iv.start, -1)
      const days = spanDays(cursor, gapEnd)
      if (days >= minDays && cursor <= limit) return { startDate: cursor, endDate: gapEnd, days }
    }
    cursor = addDays(iv.end, 1)
    if (cursor > limit) return null
  }
  return cursor <= limit ? { startDate: cursor, endDate: null, days: null } : null
}

/* ——— physical compatibility (no dates) ——— */

export interface BerthCompatibility {
  berth: Berth
  fits: boolean
  /** Null when the berth states no rated length, so fit is unknown. */
  clearanceFt: number | null
}

/**
 * Pure physical fit of a vessel length against every active berth — no date
 * availability. Fitting berths first (smallest adequate first), then
 * too-short berths (closest to fitting first); ties keep berth order.
 */
export function getVesselCompatibleBerths(lengthFt: number, berths: Berth[]): BerthCompatibility[] {
  const rows = berths
    .filter((b) => b.active)
    .map((b) => ({ berth: b, ...vesselFitsBerth(lengthFt, b) }))
  rows.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1
    // berths with no rated length sort last within their group
    const ac = a.berth.maxLengthFt ?? Number.POSITIVE_INFINITY
    const bc = b.berth.maxLengthFt ?? Number.POSITIVE_INFINITY
    return a.fits ? ac - bc : (b.clearanceFt ?? 0) - (a.clearanceFt ?? 0)
  })
  return rows
}

/* ——— draft → request ——— */

export interface DraftFields {
  type: 'vessel' | 'event'
  vesselId: string
  eventName: string
  startDate: string
  endDate: string
}

/**
 * Build a computable request from the draft, or null if inputs are not yet
 * sufficient (missing dates, inverted dates, no vessel, or vessel length
 * unknown). Event names are not needed to *compute* availability — only to
 * confirm.
 */
export function requestFromDraft(draft: DraftFields, vessels: Vessel[]): BookingRequest | null {
  if (!draft.startDate || !draft.endDate || draft.startDate > draft.endDate) return null
  if (draft.type === 'event') {
    return { kind: 'event', lengthFt: null, startDate: draft.startDate, endDate: draft.endDate }
  }
  if (!draft.vesselId) return null
  const vessel = vessels.find((v) => v.id === draft.vesselId)
  if (!vessel || vessel.lengthFt == null) return null
  return { kind: 'vessel', lengthFt: vessel.lengthFt, startDate: draft.startDate, endDate: draft.endDate }
}

/* ——— creation-time validation ——— */

export interface CreateReservationInput {
  type: 'vessel' | 'event'
  vesselId: string | null
  eventName: string | null
  berthId: string
  startDate: string
  endDate: string
  notes?: string
}

export interface ValidationContext {
  berths: Berth[]
  vessels: Vessel[]
  reservations: Reservation[]
}

/**
 * Full guard used at creation time. The panel prevents most of these before
 * the button is enabled; this is the single enforcement point regardless.
 */
export function validateReservationInput(
  input: CreateReservationInput,
  ctx: ValidationContext,
): string[] {
  const errors: string[] = []

  if (!input.startDate || !input.endDate) errors.push('Arrival and departure dates are required.')
  else if (input.startDate > input.endDate) errors.push('Departure precedes arrival.')

  const berth = ctx.berths.find((b) => b.id === input.berthId)
  if (!berth) errors.push('Select a berth.')
  else if (!berth.active) errors.push(`${berth.name} is not in service.`)

  let vessel: Vessel | undefined
  if (input.type === 'vessel') {
    vessel = ctx.vessels.find((v) => v.id === input.vesselId) ?? undefined
    if (!vessel) errors.push('Select a vessel.')
    else if (vessel.lengthFt == null)
      errors.push(`${vessel.name} has no recorded length — record it before confirming.`)
  } else if (!input.eventName?.trim()) {
    errors.push('Event name is required.')
  }

  if (errors.length > 0) return errors

  if (input.type === 'vessel' && vessel && vessel.lengthFt != null && berth?.maxLengthFt != null) {
    const { fits, clearanceFt } = vesselFitsBerth(vessel.lengthFt, berth)
    if (!fits)
      errors.push(
        `${vessel.name} (${vessel.lengthFt} ft) exceeds ${berth.name} ` +
          `(${berth.maxLengthFt} ft) by ${Math.abs(clearanceFt ?? 0)} ft.`,
      )
  }

  if (berth) {
    const conflicts = getBerthConflicts(berth.id, input.startDate, input.endDate, ctx.reservations)
    if (conflicts.length > 0) {
      const first = conflicts[0]
      const title =
        first.type === 'vessel'
          ? ctx.vessels.find((v) => v.id === first.vesselId)?.name ?? 'another reservation'
          : first.eventName ?? 'an event'
      errors.push(`Dates conflict with ${title} (${first.startDate} – ${first.endDate}) on ${berth.name}.`)
    }
  }

  return errors
}
