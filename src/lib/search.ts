import type { Berth, Reservation, Vessel } from '../data/types'

/**
 * Global search — pure functions over the live dataset. Simple, predictable
 * partial matching (no fuzzy scoring): case-insensitive substring on the
 * fields that identify a record, plus date queries ("Sep 24", "2026-09-24")
 * that return reservations covering that day.
 *
 * Indexed fields:
 *   Vessel       name, operator, contact name
 *   Berth        name
 *   Reservation  vessel name / event name, berth name, notes
 */

export interface SearchInput {
  vessels: Vessel[]
  berths: Berth[]
  reservations: Reservation[]
}

export interface SearchResults {
  vessels: Vessel[]
  berths: Berth[]
  reservations: Reservation[]
  /** Set when the query parsed as a calendar date. */
  dateMatch: string | null
}

const LIMITS = { vessels: 6, berths: 6, reservations: 8 }

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/**
 * Parse "Sep 24", "september 24", "Sep 24 2026", "9/24" or "2026-09-24".
 * Returns an ISO date (defaulting to `defaultYear`) or null. The whole query
 * must be the date — fragments inside longer text are not treated as dates.
 */
export function parseSearchDate(query: string, defaultYear: number): string | null {
  const q = query.trim().toLowerCase()

  const iso = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return buildISO(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const slash = q.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/)
  if (slash) return buildISO(slash[3] ? Number(slash[3]) : defaultYear, Number(slash[1]), Number(slash[2]))

  const named = q.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/)
  if (named) {
    const idx = MONTHS.findIndex((m) => m.startsWith(named[1]))
    if (idx === -1) return null
    return buildISO(named[3] ? Number(named[3]) : defaultYear, idx + 1, Number(named[2]))
  }
  return null
}

function buildISO(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  // reject impossible dates like Feb 30
  const check = new Date(`${iso}T12:00:00Z`)
  return check.getUTCMonth() + 1 === m && check.getUTCDate() === d ? iso : null
}

function has(value: string | undefined | null, q: string): boolean {
  return !!value && value.toLowerCase().includes(q)
}

export function searchEntities(query: string, data: SearchInput, todayISO: string): SearchResults {
  const q = query.trim().toLowerCase()
  if (!q) return { vessels: [], berths: [], reservations: [], dateMatch: null }

  const dateMatch = parseSearchDate(q, Number(todayISO.slice(0, 4)))

  const vessels = data.vessels
    .filter((v) => has(v.name, q) || has(v.operator, q) || has(v.contactName, q))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1
      return aStarts - bStarts || a.name.localeCompare(b.name)
    })
    .slice(0, LIMITS.vessels)

  const berths = data.berths.filter((b) => has(b.name, q)).slice(0, LIMITS.berths)

  const berthName = (id: string) => data.berths.find((b) => b.id === id)?.name
  const vesselName = (id: string | null) =>
    id ? data.vessels.find((v) => v.id === id)?.name : undefined

  const reservations = data.reservations
    .filter((r) => {
      if (dateMatch && r.startDate <= dateMatch && r.endDate >= dateMatch) return true
      return (
        has(r.type === 'vessel' ? vesselName(r.vesselId) : r.eventName, q) ||
        has(berthName(r.berthId), q) ||
        has(r.notes, q)
      )
    })
    .sort((a, b) => {
      // active before cancelled; upcoming (soonest first) before past (most recent first)
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      const aUp = a.endDate >= todayISO ? 0 : 1
      const bUp = b.endDate >= todayISO ? 0 : 1
      if (aUp !== bUp) return aUp - bUp
      return aUp === 0
        ? a.startDate.localeCompare(b.startDate)
        : b.startDate.localeCompare(a.startDate)
    })
    .slice(0, LIMITS.reservations)

  return { vessels, berths, reservations, dateMatch }
}
