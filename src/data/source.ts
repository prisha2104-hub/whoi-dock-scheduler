import raw from './source.generated.json'
import type { Berth, Reservation, Vessel } from './types'

/**
 * Imported historical schedule — the immutable base dataset.
 *
 * Generated from the supplied workbook by `scripts/parse_workbook.py`
 * (`npm run import:workbook`); see `source/IMPORT_AUDIT.md` for the sheet
 * inventory, span-reconstruction method, cross-checks and the blocks the
 * workbook does not describe well enough to import.
 *
 * Nothing here is synthesised: every reservation corresponds to a block that
 * the importer verified against the worksheet cells it claims.
 */

interface RawPayload {
  source: {
    workbook: string
    scheduleSheets: string[]
    otherSheets: string[]
    minDate: string
    maxDate: string
  }
  berths: { id: string; name: string; maxLengthFt?: number; active: boolean }[]
  vessels: {
    id: string
    name: string
    lengthFt?: number
    operator?: string
    contactName?: string
    phone?: string
    email?: string
    notes?: string
    matchedDirectory?: boolean
  }[]
  quarantined: {
    sheet: string
    labelledPeriod: string
    sheetPeriod: string
    reason: string
    affectedMonths: string[]
  }[]
  reservations: {
    id: string
    type: 'vessel' | 'event'
    vesselId?: string
    eventName?: string
    berthId: string
    startDate: string
    endDate: string
    status: 'active' | 'cancelled'
    source: {
      sheet: string
      year: number
      row: number
      cells?: string
      span: string
      ambiguous?: boolean
      ambiguityReason?: string
    }
  }[]
}

const payload = raw as unknown as RawPayload

export const SOURCE_BERTHS: Berth[] = payload.berths.map((b) => ({
  id: b.id,
  name: b.name,
  maxLengthFt: b.maxLengthFt ?? null,
  active: b.active,
}))

export const SOURCE_VESSELS: Vessel[] = payload.vessels.map((v) => ({
  id: v.id,
  name: v.name,
  lengthFt: v.lengthFt ?? null,
  operator: v.operator,
  contactName: v.contactName,
  phone: v.phone,
  email: v.email,
  notes: v.notes,
}))

export const SOURCE_RESERVATIONS: Reservation[] = payload.reservations.map((r) => ({
  id: r.id,
  type: r.type,
  vesselId: r.vesselId ?? null,
  eventName: r.eventName ?? null,
  berthId: r.berthId,
  startDate: r.startDate,
  endDate: r.endDate,
  status: r.status,
  source: r.source,
}))

/**
 * Month blocks the workbook does not describe well enough to place in time.
 * Their bookings are not imported, so these months must not be presented as
 * confidently empty.
 */
export const SOURCE_QUARANTINED = payload.quarantined

const QUARANTINED_MONTHS = new Set(
  payload.quarantined.flatMap((q) => q.affectedMonths),
)

/** True when a month (`YYYY-MM`) has source data that could not be imported. */
export function isQuarantinedMonth(yyyymm: string): boolean {
  return QUARANTINED_MONTHS.has(yyyymm)
}

/** The quarantine notes covering a month, for a restrained UI warning. */
export function quarantineNotesFor(yyyymm: string) {
  return payload.quarantined.filter((q) => q.affectedMonths.includes(yyyymm))
}

/** Coverage of the imported workbook, used for the schedule's initial view. */
export const SOURCE_META = {
  workbook: payload.source.workbook,
  scheduleSheets: payload.source.scheduleSheets,
  firstDate: payload.source.minDate,
  lastDate: payload.source.maxDate,
  firstYear: Number(payload.source.minDate.slice(0, 4)),
  lastYear: Number(payload.source.maxDate.slice(0, 4)),
  /** e.g. "1997–2019" */
  yearRange: `${payload.source.minDate.slice(0, 4)}–${payload.source.maxDate.slice(0, 4)}`,
  /** Month (YYYY-MM-01) the schedule opens on: the latest month with bookings. */
  latestMonth: `${payload.source.maxDate.slice(0, 7)}-01`,
}
