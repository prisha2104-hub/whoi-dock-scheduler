import { useSyncExternalStore } from 'react'
import { BERTHS, VESSELS, RESERVATIONS } from './seed'
import type { Berth, Reservation, Vessel } from './types'
import {
  validateReservationInput,
  type CreateReservationInput,
} from '../lib/scheduling'

/**
 * Application data store — a single module-level snapshot with subscribers,
 * exposed to React through useSyncExternalStore. Mutations (creating
 * reservations, recording vessel lengths) commit a new snapshot, so every
 * screen reads the same live state.
 *
 * The in-progress reservation draft also lives here: it survives the panel
 * being closed/reopened (e.g. detouring to inspect a berth mid-booking) and
 * lets the schedule render matching mode behind the panel.
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
  reservations: Reservation[]
  draft: Draft
}

function freshState(): DataState {
  return {
    berths: BERTHS.map((b) => ({ ...b })),
    vessels: VESSELS.map((v) => ({ ...v })),
    reservations: RESERVATIONS.map((r) => ({ ...r })),
    draft: { ...EMPTY_DRAFT },
  }
}

let state: DataState = freshState()
const listeners = new Set<() => void>()

function commit(next: DataState) {
  state = next
  listeners.forEach((l) => l())
}

export function getData(): DataState {
  return state
}

export function subscribeData(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Subscribe a component to the live dataset. */
export function useData(): DataState {
  return useSyncExternalStore(subscribeData, getData)
}

/* ——— draft actions ——— */

export function setDraft(patch: Partial<Draft>) {
  commit({ ...state, draft: { ...state.draft, ...patch } })
}

export function resetDraft() {
  commit({ ...state, draft: { ...EMPTY_DRAFT } })
}

/* ——— mutations ——— */

function nextReservationId(): string {
  const max = state.reservations.reduce((acc, r) => {
    const n = Number(r.id.replace(/^r-/, ''))
    return Number.isFinite(n) ? Math.max(acc, n) : acc
  }, 0)
  return `r-${max + 1}`
}

export type CreateResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; errors: string[] }

/**
 * Single enforcement point for reservation creation. Re-validates against
 * the full ruleset (fit, overlap, required fields) regardless of what the
 * UI allowed, then commits. Created reservations are ordinary records —
 * identical to seeded ones.
 */
export function createReservation(input: CreateReservationInput): CreateResult {
  const errors = validateReservationInput(input, state)
  if (errors.length > 0) return { ok: false, errors }

  const reservation: Reservation = {
    id: nextReservationId(),
    type: input.type,
    vesselId: input.type === 'vessel' ? input.vesselId : null,
    eventName: input.type === 'event' ? (input.eventName ?? '').trim() : null,
    berthId: input.berthId,
    startDate: input.startDate,
    endDate: input.endDate,
    notes: input.notes?.trim() || undefined,
    status: 'active',
  }

  commit({ ...state, reservations: [...state.reservations, reservation] })
  return { ok: true, reservation }
}

/** Record a vessel's length (used by the missing-length recovery flow). */
export function updateVesselLength(vesselId: string, lengthFt: number): boolean {
  if (!Number.isFinite(lengthFt) || lengthFt <= 0) return false
  commit({
    ...state,
    vessels: state.vessels.map((v) =>
      v.id === vesselId ? { ...v, lengthFt: Math.round(lengthFt) } : v,
    ),
  })
  return true
}

/** Restore the pristine seed dataset (used by tests). */
export function resetData() {
  commit(freshState())
}
