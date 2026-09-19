import { getData } from './store'
import type { Berth, Reservation, Vessel } from './types'
import { spanDays } from '../lib/dates'
import { overlaps } from '../lib/scheduling'

/**
 * Read helpers over the live store snapshot. Components subscribe via
 * useData() (which triggers re-render); these functions always read the
 * current snapshot, so both stay consistent.
 */

export function vesselById(id: string | null): Vessel | undefined {
  return id ? getData().vessels.find((v) => v.id === id) : undefined
}

export function berthById(id: string): Berth | undefined {
  return getData().berths.find((b) => b.id === id)
}

export function reservationById(id: string): Reservation | undefined {
  return getData().reservations.find((r) => r.id === id)
}

/** Display title: vessel name for vessel calls, event name for events. */
export function reservationTitle(r: Reservation): string {
  if (r.type === 'vessel') return vesselById(r.vesselId)?.name ?? 'Unknown vessel'
  return r.eventName ?? 'Untitled event'
}

/**
 * True for imported blocks that the workbook shows as occupied without
 * recording what occupied them. They block the berth like any reservation but
 * must never read as a known vessel or a real named event.
 */
export function isAmbiguousOccupancy(r: Reservation): boolean {
  return r.source?.ambiguous === true
}

export function activeReservations(): Reservation[] {
  return getData().reservations.filter((r) => r.status === 'active')
}

/** Active reservations touching [startISO, endISO] on one berth, by start. */
export function reservationsForBerth(berthId: string, startISO: string, endISO: string): Reservation[] {
  return activeReservations()
    .filter((r) => r.berthId === berthId && overlaps(startISO, endISO, r.startDate, r.endDate))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** The reservation occupying a berth on a given day, if any. */
export function currentForBerth(berthId: string, dateISO: string): Reservation | undefined {
  return activeReservations().find(
    (r) => r.berthId === berthId && r.startDate <= dateISO && r.endDate >= dateISO,
  )
}

/** Next reservation starting strictly after the given day. */
export function nextForBerth(berthId: string, dateISO: string): Reservation | undefined {
  return activeReservations()
    .filter((r) => r.berthId === berthId && r.startDate > dateISO)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
}

export function reservationsForVessel(vesselId: string): Reservation[] {
  return getData()
    .reservations.filter((r) => r.vesselId === vesselId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** The vessel's reservation covering today, if any. */
export function currentForVessel(vesselId: string, dateISO: string): Reservation | undefined {
  return activeReservations().find(
    (r) => r.vesselId === vesselId && r.startDate <= dateISO && r.endDate >= dateISO,
  )
}

/** The vessel's next active reservation starting after today. */
export function nextForVessel(vesselId: string, dateISO: string): Reservation | undefined {
  return activeReservations()
    .filter((r) => r.vesselId === vesselId && r.startDate > dateISO)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
}

export function reservationDays(r: Reservation): number {
  return spanDays(r.startDate, r.endDate)
}

export interface VesselHistory {
  /** Active reservations that have not ended yet, soonest first. */
  upcoming: Reservation[]
  /** Active reservations that have ended, most recent first. */
  past: Reservation[]
}

/** Partition a vessel's active reservations around a reference day. */
export function vesselHistory(vesselId: string, dateISO: string): VesselHistory {
  const all = reservationsForVessel(vesselId).filter((r) => r.status === 'active')
  return {
    upcoming: all.filter((r) => r.endDate >= dateISO),
    past: all.filter((r) => r.endDate < dateISO).reverse(),
  }
}

/** The vessel's most recently completed visit, if any. */
export function lastVisitForVessel(vesselId: string, dateISO: string): Reservation | undefined {
  return vesselHistory(vesselId, dateISO).past[0]
}

export interface OpsSummary {
  occupied: number
  available: number
  arrivals: number
  departures: number
}

/** Compact operational summary for a single day across all berths. */
export function opsSummary(dateISO: string): OpsSummary {
  const act = activeReservations()
  const occupiedBerths = new Set(
    act.filter((r) => r.startDate <= dateISO && r.endDate >= dateISO).map((r) => r.berthId),
  )
  return {
    occupied: occupiedBerths.size,
    available: getData().berths.filter((b) => b.active).length - occupiedBerths.size,
    arrivals: act.filter((r) => r.startDate === dateISO).length,
    departures: act.filter((r) => r.endDate === dateISO).length,
  }
}
