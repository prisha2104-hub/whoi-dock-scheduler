import { beforeEach, describe, expect, it } from 'vitest'
import {
  createReservation,
  getData,
  resetData,
  setDraft,
  updateVesselLength,
} from './store'
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
 * Integration tests over the live store + seed: a created reservation must
 * behave exactly like a seeded one everywhere (cases 10 & 11).
 */

beforeEach(() => resetData())

const FREE = { startDate: '2027-03-01', endDate: '2027-03-05' } // far from seeded data

describe('createReservation', () => {
  it('creates a vessel reservation and immediately affects availability queries', () => {
    const before = evaluateBerth(
      getData().berths.find((b) => b.id === 'b-npw')!,
      { kind: 'vessel', lengthFt: 120, ...FREE },
      getData().reservations,
    )
    expect(before.status).toBe('available')

    const result = createReservation({
      type: 'vessel',
      vesselId: 'v-high-drift',
      eventName: null,
      berthId: 'b-npw',
      ...FREE,
      notes: 'test booking',
    })
    expect(result.ok).toBe(true)

    const after = evaluateBerth(
      getData().berths.find((b) => b.id === 'b-npw')!,
      { kind: 'vessel', lengthFt: 120, ...FREE },
      getData().reservations,
    )
    expect(after.status).toBe('occupied')
  })

  it('created reservation participates in vessel history, berth schedule and ops summary', () => {
    const result = createReservation({
      type: 'vessel',
      vesselId: 'v-high-drift',
      eventName: null,
      berthId: 'b-npw',
      ...FREE,
    })
    if (!result.ok) throw new Error('expected ok')
    const id = result.reservation.id

    expect(reservationsForVessel('v-high-drift').map((r) => r.id)).toContain(id)
    expect(reservationsForBerth('b-npw', FREE.startDate, FREE.endDate).map((r) => r.id)).toContain(id)
    expect(nextForBerth('b-npw', '2027-02-01')?.id).toBe(id)
    expect(opsSummary('2027-03-01').occupied).toBe(1)
    expect(opsSummary('2027-03-01').arrivals).toBe(1)
  })

  it('rejects a second overlapping reservation on the same berth', () => {
    expect(createReservation({ type: 'vessel', vesselId: 'v-high-drift', eventName: null, berthId: 'b-npw', ...FREE }).ok).toBe(true)
    const second = createReservation({
      type: 'vessel',
      vesselId: 'v-bright-dory',
      eventName: null,
      berthId: 'b-npw',
      startDate: '2027-03-05',
      endDate: '2027-03-08',
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.errors.join(' ')).toContain('R/V High Drift')
  })

  it('rejects an over-length vessel regardless of what the UI allowed', () => {
    const result = createReservation({
      type: 'vessel',
      vesselId: 'v-bright-horizon', // 170 ft
      eventName: null,
      berthId: 'b-sfw', // 90 ft
      ...FREE,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toContain('80 ft')
  })

  it('creates events that block the berth like any vessel reservation', () => {
    const result = createReservation({
      type: 'event',
      vesselId: null,
      eventName: 'Community Sail Day',
      berthId: 'b-npf',
      startDate: '2027-03-06',
      endDate: '2027-03-06',
    })
    expect(result.ok).toBe(true)
    const blocked = createReservation({
      type: 'vessel',
      vesselId: 'v-wild-marlin',
      eventName: null,
      berthId: 'b-npf',
      startDate: '2027-03-06',
      endDate: '2027-03-07',
    })
    expect(blocked.ok).toBe(false)
  })

  it('cancelled seed reservations do not block creation (Iron Skua window, NPW Sep 22–24)', () => {
    // r-104 (cancelled) held North Pier West Sep 21–24; the slot must be bookable.
    const result = createReservation({
      type: 'vessel',
      vesselId: 'v-bright-dory',
      eventName: null,
      berthId: 'b-npw',
      startDate: '2026-09-22',
      endDate: '2026-09-24',
    })
    expect(result.ok).toBe(true)
  })

  it('blocks vessels with no recorded length until a length is saved', () => {
    const missing = createReservation({
      type: 'vessel',
      vesselId: 'v-blue-fathom',
      eventName: null,
      berthId: 'b-npe',
      ...FREE,
    })
    expect(missing.ok).toBe(false)

    expect(updateVesselLength('v-blue-fathom', 98)).toBe(true)
    expect(getData().vessels.find((v) => v.id === 'v-blue-fathom')?.lengthFt).toBe(98)

    const retry = createReservation({
      type: 'vessel',
      vesselId: 'v-blue-fathom',
      eventName: null,
      berthId: 'b-npe',
      ...FREE,
    })
    expect(retry.ok).toBe(true)
  })

  it('rejects nonsense lengths', () => {
    expect(updateVesselLength('v-blue-fathom', 0)).toBe(false)
    expect(updateVesselLength('v-blue-fathom', -12)).toBe(false)
    expect(updateVesselLength('v-blue-fathom', Number.NaN)).toBe(false)
  })
})

/* ——— connected information + search over live data ——— */

describe('vessel history partitioning', () => {
  it('splits active reservations into upcoming and past around a reference day', () => {
    // Seed: R/V Bright Dory has Sep 12–14 (past) and Oct 3–7 (upcoming) vs Sep 19.
    const h = vesselHistory('v-bright-dory', '2026-09-19')
    expect(h.past.map((r) => r.id)).toEqual(['r-114'])
    expect(h.upcoming.map((r) => r.id)).toEqual(['r-117'])
  })
})

describe('berth occupancy uses active reservations only', () => {
  it('the cancelled Iron Skua hold (NPW Sep 21–24) leaves the berth unoccupied', () => {
    // r-102 (High Drift) ends Sep 21; r-104 is cancelled — Sep 22 must be free.
    expect(currentForBerth('b-npw', '2026-09-22')).toBeUndefined()
  })

  it('and does not affect next-opening math: NPW opens Sep 22–28 before High Strand', () => {
    expect(getNextOpening('b-npw', '2026-09-22', getData().reservations)).toEqual({
      startDate: '2026-09-22',
      endDate: '2026-09-28',
      days: 7,
    })
  })
})

describe('global search over live data', () => {
  it('a newly created reservation appears in search immediately', () => {
    const before = searchEntities('coral voyager', getData(), '2026-09-19')
    const countBefore = before.reservations.length

    const result = createReservation({
      type: 'vessel',
      vesselId: 'v-coral-voyager',
      eventName: null,
      berthId: 'b-ic',
      startDate: '2026-10-10',
      endDate: '2026-10-12',
    })
    expect(result.ok).toBe(true)

    const after = searchEntities('coral voyager', getData(), '2026-09-19')
    expect(after.reservations.length).toBe(countBefore + 1)
    if (result.ok) expect(after.reservations.map((r) => r.id)).toContain(result.reservation.id)
  })
})

describe('draft (book-this-opening + persistence)', () => {
  it('booking an opening prefills berth and dates in the draft', () => {
    setDraft({ berthId: 'b-npw', startDate: '2026-09-22', endDate: '2026-09-28' })
    expect(getData().draft.berthId).toBe('b-npw')
    expect(getData().draft.startDate).toBe('2026-09-22')
    expect(getData().draft.endDate).toBe('2026-09-28')
  })

  it('the draft survives unrelated store activity (inspect detours, other mutations)', () => {
    setDraft({ type: 'vessel', vesselId: 'v-high-drift', startDate: '2026-11-01', endDate: '2026-11-04' })
    updateVesselLength('v-silver-voyager', 110) // unrelated mutation
    createReservation({
      type: 'event',
      vesselId: null,
      eventName: 'Rescue drill',
      berthId: 'b-npf',
      startDate: '2026-11-20',
      endDate: '2026-11-20',
    })
    const d = getData().draft
    expect(d.vesselId).toBe('v-high-drift')
    expect(d.startDate).toBe('2026-11-01')
    expect(d.endDate).toBe('2026-11-04')
  })
})
