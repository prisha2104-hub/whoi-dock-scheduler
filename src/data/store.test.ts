import { beforeEach, describe, expect, it } from 'vitest'
import {
  createReservation,
  getData,
  isUserCreated,
  resetUserData,
  setDraft,
  updateVesselLength,
} from './store'
import { SOURCE_META, SOURCE_RESERVATIONS } from './source'
import {
  currentForBerth,
  nextForBerth,
  opsSummary,
  reservationsForBerth,
  reservationsForVessel,
  vesselHistory,
} from './queries'
import { evaluateBerth, getNextOpening } from '../lib/scheduling'
import { searchEntities } from '../lib/search'

/**
 * Integration tests over the imported workbook data plus the user layer.
 * A reservation created in the app must behave exactly like an imported one,
 * while remaining distinguishable from it.
 */

beforeEach(() => resetUserData())

// Well clear of the 1997–2019 source coverage.
const FREE = { startDate: '2030-03-01', endDate: '2030-03-05' }
const BERTH = 'b-north-pier-west'

/** A vessel whose length the workbook actually records. */
const knownVessel = () => getData().vessels.find((v) => v.lengthFt != null)!

describe('user-created reservations', () => {
  it('create a vessel reservation and immediately affect availability', () => {
    const before = evaluateBerth(
      getData().berths.find((b) => b.id === BERTH)!,
      { kind: 'vessel', lengthFt: 120, ...FREE },
      getData().reservations,
    )
    expect(before.status).toBe('available')

    const vesselId = knownVessel().id
    const result = createReservation({
      type: 'vessel', vesselId, eventName: null, berthId: BERTH, ...FREE,
    })
    expect(result.ok).toBe(true)

    const after = evaluateBerth(
      getData().berths.find((b) => b.id === BERTH)!,
      { kind: 'vessel', lengthFt: 120, ...FREE },
      getData().reservations,
    )
    expect(after.status).toBe('occupied')
  })

  it('appear in vessel history, berth schedule and ops summary', () => {
    const vesselId = getData().vessels.find((v) => v.lengthFt != null)!.id
    const result = createReservation({
      type: 'vessel', vesselId, eventName: null, berthId: BERTH, ...FREE,
    })
    if (!result.ok) throw new Error('expected ok')
    const id = result.reservation.id

    expect(reservationsForVessel(vesselId).map((r) => r.id)).toContain(id)
    expect(reservationsForBerth(BERTH, FREE.startDate, FREE.endDate).map((r) => r.id)).toContain(id)
    expect(nextForBerth(BERTH, '2030-02-01')?.id).toBe(id)
    expect(opsSummary('2030-03-01').occupied).toBe(1)
    expect(opsSummary('2030-03-01').arrivals).toBe(1)
    expect(vesselHistory(vesselId, '2030-01-01').upcoming.map((r) => r.id)).toContain(id)
  })

  it('are findable in global search immediately', () => {
    const vessel = getData().vessels.find((v) => v.lengthFt != null)!
    const before = searchEntities(vessel.name, getData(), '2030-01-01').reservations.length
    const result = createReservation({
      type: 'vessel', vesselId: vessel.id, eventName: null, berthId: BERTH, ...FREE,
    })
    expect(result.ok).toBe(true)
    const after = searchEntities(vessel.name, getData(), '2030-01-01').reservations
    expect(after.length).toBe(before + 1)
  })

  it('are distinguishable from imported records', () => {
    const vesselId = knownVessel().id
    const result = createReservation({
      type: 'vessel', vesselId, eventName: null, berthId: BERTH, ...FREE,
    })
    if (!result.ok) throw new Error('expected ok')
    expect(isUserCreated(result.reservation)).toBe(true)
    expect(result.reservation.source).toBeUndefined()
    expect(SOURCE_RESERVATIONS.every((r) => !isUserCreated(r))).toBe(true)
  })

  it('reject a second overlapping reservation on the same berth', () => {
    const a = getData().vessels.find((v) => v.lengthFt != null)!.id
    expect(createReservation({ type: 'vessel', vesselId: a, eventName: null, berthId: BERTH, ...FREE }).ok).toBe(true)
    const second = createReservation({
      type: 'vessel', vesselId: a, eventName: null, berthId: BERTH,
      startDate: '2030-03-05', endDate: '2030-03-08',
    })
    expect(second.ok).toBe(false)
  })

  it('reject an over-length vessel regardless of what the UI allowed', () => {
    // North Pier Face is 75 ft; find any vessel longer than that.
    const big = getData().vessels.find((v) => (v.lengthFt ?? 0) > 75)!
    const result = createReservation({
      type: 'vessel', vesselId: big.id, eventName: null,
      berthId: 'b-north-pier-face', ...FREE,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/exceeds/)
  })

  it('create events that block the berth like any vessel reservation', () => {
    const ev = createReservation({
      type: 'event', vesselId: null, eventName: 'Community Sail Day',
      berthId: 'b-north-pier-face', startDate: '2030-04-06', endDate: '2030-04-06',
    })
    expect(ev.ok).toBe(true)
    const blocked = createReservation({
      type: 'vessel', vesselId: knownVessel().id, eventName: null,
      berthId: 'b-north-pier-face', startDate: '2030-04-06', endDate: '2030-04-07',
    })
    expect(blocked.ok).toBe(false)
  })

  it('block vessels with no recorded length until a length is saved', () => {
    const unknown = getData().vessels.find((v) => v.lengthFt == null)!
    const missing = createReservation({
      type: 'vessel', vesselId: unknown.id, eventName: null, berthId: BERTH, ...FREE,
    })
    expect(missing.ok).toBe(false)

    expect(updateVesselLength(unknown.id, 98)).toBe(true)
    expect(getData().vessels.find((v) => v.id === unknown.id)?.lengthFt).toBe(98)

    const retry = createReservation({
      type: 'vessel', vesselId: unknown.id, eventName: null, berthId: BERTH, ...FREE,
    })
    expect(retry.ok).toBe(true)
  })

  it('reject nonsense lengths', () => {
    const v = getData().vessels[0].id
    expect(updateVesselLength(v, 0)).toBe(false)
    expect(updateVesselLength(v, -12)).toBe(false)
    expect(updateVesselLength(v, Number.NaN)).toBe(false)
  })
})

/* ——— the base / user split ——— */

describe('reset', () => {
  it('removes user reservations and length edits but keeps imported history intact', () => {
    const baseCount = SOURCE_RESERVATIONS.length
    expect(getData().reservations.length).toBe(baseCount)

    const unknown = getData().vessels.find((v) => v.lengthFt == null)!
    updateVesselLength(unknown.id, 120)
    createReservation({
      type: 'vessel', vesselId: unknown.id, eventName: null, berthId: BERTH, ...FREE,
    })
    expect(getData().reservations.length).toBe(baseCount + 1)

    resetUserData()

    expect(getData().reservations.length).toBe(baseCount)
    expect(getData().reservations.every((r) => !isUserCreated(r))).toBe(true)
    expect(getData().vessels.find((v) => v.id === unknown.id)?.lengthFt).toBeNull()
    // the imported dataset is still fully present
    expect(getData().reservations.some((r) => r.startDate.startsWith('1997'))).toBe(true)
    expect(getData().reservations.some((r) => r.startDate.startsWith('2019'))).toBe(true)
  })

  it('preserves unidentified historical occupancy as immutable source history', () => {
    const ambiguousBefore = getData().reservations.filter((r) => r.source?.ambiguous)
    expect(ambiguousBefore.length).toBeGreaterThan(0)

    createReservation({
      type: 'vessel', vesselId: knownVessel().id, eventName: null, berthId: BERTH, ...FREE,
    })
    resetUserData()

    const after = getData().reservations.filter((r) => r.source?.ambiguous)
    expect(after.length).toBe(ambiguousBefore.length)
    expect(after.every((r) => !isUserCreated(r))).toBe(true)
    expect(after[0].eventName).toBe('Unidentified historical occupancy')
  })

  it('never mutates the imported source arrays', () => {
    const snapshot = JSON.stringify(SOURCE_RESERVATIONS.slice(0, 20))
    createReservation({
      type: 'vessel', vesselId: knownVessel().id, eventName: null,
      berthId: BERTH, ...FREE,
    })
    updateVesselLength(knownVessel().id, 55)
    expect(JSON.stringify(SOURCE_RESERVATIONS.slice(0, 20))).toBe(snapshot)
  })
})

/* ——— imported history behaves like data ——— */

describe('unidentified occupancy blocks availability in the live store', () => {
  it('refuses a booking that overlaps an unidentified historical block', () => {
    const amb = getData().reservations.find((r) => r.source?.ambiguous)!
    const result = createReservation({
      type: 'vessel',
      vesselId: knownVessel().id,
      eventName: null,
      berthId: amb.berthId,
      startDate: amb.startDate,
      endDate: amb.endDate,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('Unidentified historical occupancy')
    }
  })

  it('is reported as occupied, not available, for its dates', () => {
    const amb = getData().reservations.find((r) => r.source?.ambiguous)!
    expect(currentForBerth(amb.berthId, amb.startDate)).toBeDefined()
    const evaluation = evaluateBerth(
      getData().berths.find((b) => b.id === amb.berthId)!,
      { kind: 'event', lengthFt: null, startDate: amb.startDate, endDate: amb.endDate },
      getData().reservations,
    )
    expect(evaluation.status).toBe('occupied')
    expect(evaluation.conflicts.map((c) => c.id)).toContain(amb.id)
  })
})

describe('imported history', () => {
  it('is all in the past relative to the source coverage end', () => {
    expect(getData().reservations.every((r) => r.endDate <= SOURCE_META.lastDate)).toBe(true)
  })

  it('supports berth occupancy and opening queries on historical dates', () => {
    const last = SOURCE_RESERVATIONS[SOURCE_RESERVATIONS.length - 1]
    expect(currentForBerth(last.berthId, last.startDate)?.id).toBeDefined()
    const opening = getNextOpening(last.berthId, '2019-01-01', getData().reservations)
    expect(opening).not.toBeNull()
  })

  it('is searchable by vessel name and by date', () => {
    const withVessel = SOURCE_RESERVATIONS.find((r) => r.type === 'vessel')!
    const vessel = getData().vessels.find((v) => v.id === withVessel.vesselId)!
    const hits = searchEntities(vessel.name, getData(), '2030-01-01')
    expect(hits.vessels.map((v) => v.id)).toContain(vessel.id)
    expect(hits.reservations.length).toBeGreaterThan(0)

    const byDate = searchEntities(withVessel.startDate, getData(), '2030-01-01')
    expect(byDate.dateMatch).toBe(withVessel.startDate)
    expect(byDate.reservations.length).toBeGreaterThan(0)
  })
})

/* ——— draft ——— */

describe('draft', () => {
  it('book-this-opening prefills berth and dates', () => {
    setDraft({ berthId: BERTH, startDate: '2030-05-01', endDate: '2030-05-07' })
    expect(getData().draft).toMatchObject({
      berthId: BERTH, startDate: '2030-05-01', endDate: '2030-05-07',
    })
  })

  it('survives unrelated store activity (inspection detours, other mutations)', () => {
    setDraft({ type: 'vessel', vesselId: 'v-r-v-golden-compass', startDate: '2030-06-01', endDate: '2030-06-04' })
    updateVesselLength(knownVessel().id, 61)
    createReservation({
      type: 'event', vesselId: null, eventName: 'Rescue drill',
      berthId: 'b-north-pier-face', startDate: '2030-07-20', endDate: '2030-07-20',
    })
    expect(getData().draft).toMatchObject({
      vesselId: 'v-r-v-golden-compass', startDate: '2030-06-01', endDate: '2030-06-04',
    })
  })
})
