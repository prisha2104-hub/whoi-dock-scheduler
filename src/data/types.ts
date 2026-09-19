/**
 * Conceptual entities, kept deliberately flat. The scheduling engine
 * (fit + conflict evaluation) operates on these shapes without extending them.
 */

export interface Berth {
  id: string
  name: string
  /**
   * Rated maximum vessel length in feet, or `null` where the workbook states
   * none (the "North Finger Piers" and "Small craft slips" rows carry no
   * length). Fit cannot be asserted against a berth with no rated length.
   */
  maxLengthFt: number | null
  active: boolean
}

export interface Vessel {
  id: string
  name: string
  /**
   * Length overall in feet. `null` means "not on file" — a real condition in
   * the legacy workbook, where most scheduled vessels had no recorded length.
   */
  lengthFt: number | null
  operator?: string
  contactName?: string
  phone?: string
  email?: string
  notes?: string
}

export type ReservationType = 'vessel' | 'event'
export type ReservationStatus = 'active' | 'cancelled'

export interface Reservation {
  id: string
  type: ReservationType
  /** Required when type = 'vessel'. */
  vesselId: string | null
  /** Required when type = 'event'. */
  eventName: string | null
  berthId: string
  /** Inclusive ISO dates — a reservation holds the berth on both endpoints. */
  startDate: string
  endDate: string
  notes?: string
  status: ReservationStatus
  /**
   * Provenance for records imported from the workbook. Absent on reservations
   * created in the application, which is what distinguishes the two — imported
   * history is immutable and reloads deterministically, user bookings do not
   * survive a reset.
   */
  source?: {
    sheet: string
    year: number
    row: number
    /** Worksheet cell range the block occupied, e.g. `F39:M39`. */
    cells?: string
    /** How the occupied range was reconstructed (merge, colour run, …). */
    span: string
    /**
     * The workbook marks these berth-days as occupied but records no occupant.
     * The record blocks the berth like any other, and is never presented as a
     * known vessel or a real named event.
     */
    ambiguous?: boolean
    ambiguityReason?: string
  }
}
