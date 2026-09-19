/**
 * Conceptual entities, kept deliberately flat. The scheduling engine
 * (fit + conflict evaluation) operates on these shapes without extending them.
 */

export interface Berth {
  id: string
  name: string
  /** Rated maximum vessel length in feet. */
  maxLengthFt: number
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
}
