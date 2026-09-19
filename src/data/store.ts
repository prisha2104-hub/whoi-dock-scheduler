import { useSyncExternalStore } from 'react'
import { SOURCE_BERTHS, SOURCE_RESERVATIONS, SOURCE_VESSELS } from './source'
import type { Berth, Reservation, Vessel } from './types'
import { validateReservationInput, type CreateReservationInput } from '../lib/scheduling'

/**
 * Application data store.
 *
 * Two layers, deliberately kept apart:
 *
 *   BASE      the schedule imported from the workbook. Immutable, and always
 *             reloaded deterministically from `source.generated.json`.
 *   USER      reservations created in the app and vessel lengths recorded
 *             through it. These sit on top of the base and are what a reset
 *             clears; the imported history is never modified or erased.
 *
 * Imported reservations carry a `source` block; user-created ones do not.
 */

export interface Draft {
  type: 'vessel' | 'event'
  vesselId: string
  eventName: string
  startDate: string
  endDate: string
  berthId: string
  notes: string
}

export const EMPTY_DRAFT: Draft = {
  type: 'vessel',
  vesselId: '',
  eventName: '',
  startDate: '',
  endDate: '',
  berthId: '',
  notes: '',
}

export interface DataState {
  berths: Berth[]
  vessels: Vessel[]
  /** Imported history followed by user-created reservations. */
  reservations: Reservation[]
  draft: Draft
}

/* ——— user layer ——— */

let userReservations: Reservation[] = []
let userVesselLengths: Record<string, number> = {}
let draft: Draft = { ...EMPTY_DRAFT }

let snapshot: DataState = build()
const listeners = new Set<() => void>()

function build(): DataState {
  const vessels = Object.keys(userVesselLengths).length
    ? SOURCE_VESSELS.map((v) =>
        userVesselLengths[v.id] != null ? { ...v, lengthFt: userVesselLengths[v.id] } : v,
      )
    : SOURCE_VESSELS
  return {
    berths: SOURCE_BERTHS,
    vessels,
    reservations: userReservations.length
      ? [...SOURCE_RESERVATIONS, ...userReservations]
      : SOURCE_RESERVATIONS,
    draft,
  }
}

function commit() {
  snapshot = build()
  listeners.forEach((l) => l())
}

export function getData(): DataState {
  return snapshot
}

export function subscribeData(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Subscribe a component to the live dataset. */
export function useData(): DataState {
  return useSyncExternalStore(subscribeData, getData)
}

/** True for reservations created in the app rather than imported. */
export function isUserCreated(r: Reservation): boolean {
  return r.source === undefined
}

/* ——— draft actions ——— */

export function setDraft(patch: Partial<Draft>) {
  draft = { ...draft, ...patch }
  commit()
}

export function resetDraft() {
  draft = { ...EMPTY_DRAFT }
  commit()
}

/* ——— mutations ——— */

let nextUserSeq = 1

export type CreateResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; errors: string[] }

/**
 * Single enforcement point for reservation creation. Re-validates against the
 * full ruleset (fit, overlap, required fields) regardless of what the UI
 * allowed. Created reservations behave exactly like imported ones everywhere
 * in the app; they simply carry no `source` provenance.
 */
export function createReservation(input: CreateReservationInput): CreateResult {
  const errors = validateReservationInput(input, snapshot)
  if (errors.length > 0) return { ok: false, errors }

  const reservation: Reservation = {
    id: `u-${nextUserSeq++}`,
    type: input.type,
    vesselId: input.type === 'vessel' ? input.vesselId : null,
    eventName: input.type === 'event' ? (input.eventName ?? '').trim() : null,
    berthId: input.berthId,
    startDate: input.startDate,
    endDate: input.endDate,
    notes: input.notes?.trim() || undefined,
    status: 'active',
  }

  userReservations = [...userReservations, reservation]
  commit()
  return { ok: true, reservation }
}

/** Record a vessel's length (used by the missing-length recovery flow). */
export function updateVesselLength(vesselId: string, lengthFt: number): boolean {
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) return false
  userVesselLengths = { ...userVesselLengths, [vesselId]: Math.round(lengthFt) }
  commit()
  return true
}

/**
 * Discard everything created during the session. The imported workbook
 * history is untouched and remains fully present afterwards.
 */
export function resetUserData() {
  userReservations = []
  userVesselLengths = {}
  draft = { ...EMPTY_DRAFT }
  nextUserSeq = 1
  commit()
}
