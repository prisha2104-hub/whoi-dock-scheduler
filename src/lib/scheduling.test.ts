import { describe, expect, it } from 'vitest'
import type { Berth, Reservation, Vessel } from '../data/types'
import {
  evaluateBerth,
  evaluateRequest,
  getBerthConflicts,
  getNearestWindows,
  getNextOpening,
  getVesselCompatibleBerths,
  requestFromDraft,
  validateReservationInput,
  vesselFitsBerth,
} from './scheduling'

/* ——— fixtures (independent of the seed) ——— */

const B240: Berth = { id: 'b240', name: 'North Pier East', maxLengthFt: 240, active: true }
const B90: Berth = { id: 'b90', name: 'South Float West', maxLengthFt: 90, active: true }
const B75: Berth = { id: 'b75', name: 'North Pier Face', maxLengthFt: 75, active: true }
const BERTHS = [B240, B90, B75]

const V120: Vessel = { id: 'v120', name: 'R/V High Drift', lengthFt: 120 }
const V90: Vessel = { id: 'v90', name: 'OSV Amber Reef', lengthFt: 90 }
const VNULL: Vessel = { id: 'vnull', name: 'Tug Blue Fathom', lengthFt: null }
const VESSELS = [V120, V90, VNULL]

function res(partial: Partial<Reservation> & Pick<Reservation, 'id' | 'berthId' | 'startDate' | 'endDate'>): Reservation {
  return {
    type: 'vessel',
    vesselId: 'v90',
    eventName: null,
    status: 'active',
    ...partial,
  }
}

const vesselReq = (lengthFt: number, startDate: string, endDate: string) =>
  ({ kind: 'vessel', lengthFt, startDate, endDate }) as const
const eventReq = (startDate: string, endDate: string) =>
  ({ kind: 'event', lengthFt: null, startDate, endDate }) as const

/* ——— fit ——— */

describe('vessel fit', () => {
  it('1. 120 ft vessel in a 240 ft berth on free dates is AVAILABLE', () => {
    const r = evaluateBerth(B240, vesselReq(120, '2026-09-17', '2026-09-21'), [])
    expect(r.status).toBe('available')
    expect(r.clearanceFt).toBe(120)
  })

  it('2. 120 ft vessel in a 90 ft berth is TOO SHORT by 30 ft', () => {
    const r = evaluateBerth(B90, vesselReq(120, '2026-09-17', '2026-09-21'), [])
    expect(r.status).toBe('too-short')
    expect(r.clearanceFt).toBe(-30)
  })

  it('8. vessel exactly equal to berth capacity FITS', () => {
    expect(vesselFitsBerth(90, B90).fits).toBe(true)
    expect(vesselFitsBerth(90, B90).clearanceFt).toBe(0)
    expect(vesselFitsBerth(91, B90).fits).toBe(false)
  })
})

/* ——— inclusive whole-day overlap ——— */

describe('date conflicts (inclusive whole days)', () => {
  const existing = [res({ id: 'r1', berthId: 'b240', startDate: '2026-09-10', endDate: '2026-09-16' })]

  it('3. Sep 10–16 existing vs Sep 16–20 requested = CONFLICT (shared end/start day)', () => {
    const r = evaluateBerth(B240, vesselReq(120, '2026-09-16', '2026-09-20'), existing)
    expect(r.status).toBe('occupied')
    expect(r.conflicts.map((c) => c.id)).toEqual(['r1'])
    expect(r.blockedDays).toEqual(['2026-09-16'])
  })

  it('4. Sep 10–16 existing vs Sep 17–20 requested = AVAILABLE (abutting)', () => {
    const r = evaluateBerth(B240, vesselReq(120, '2026-09-17', '2026-09-20'), existing)
    expect(r.status).toBe('available')
  })

  it('5. event request overlapping a vessel reservation = CONFLICT', () => {
    const r = evaluateBerth(B240, eventReq('2026-09-12', '2026-09-12'), existing)
    expect(r.status).toBe('occupied')
    expect(r.conflicts).toHaveLength(1)
  })

  it('6. cancelled reservations never block availability', () => {
    const cancelled = [
      res({ id: 'rc', berthId: 'b240', startDate: '2026-09-10', endDate: '2026-09-16', status: 'cancelled' }),
    ]
    const r = evaluateBerth(B240, vesselReq(120, '2026-09-12', '2026-09-14'), cancelled)
    expect(r.status).toBe('available')
    expect(getBerthConflicts('b240', '2026-09-10', '2026-09-16', cancelled)).toHaveLength(0)
  })

  it('fully-contained and containing requests both conflict', () => {
    expect(evaluateBerth(B240, vesselReq(120, '2026-09-01', '2026-09-30'), existing).status).toBe('occupied')
    expect(evaluateBerth(B240, vesselReq(120, '2026-09-12', '2026-09-13'), existing).status).toBe('occupied')
  })
})

/* ——— missing length ——— */

describe('missing vessel length', () => {
  it('7. request cannot be computed and confirmation is blocked', () => {
    const draft = {
      type: 'vessel' as const,
      vesselId: 'vnull',
      eventName: '',
      startDate: '2026-09-17',
      endDate: '2026-09-21',
    }
    expect(requestFromDraft(draft, VESSELS)).toBeNull()

    const errors = validateReservationInput(
      {
        type: 'vessel',
        vesselId: 'vnull',
        eventName: null,
        berthId: 'b240',
        startDate: '2026-09-17',
        endDate: '2026-09-21',
      },
      { berths: BERTHS, vessels: VESSELS, reservations: [] },
    )
    expect(errors.some((e) => e.toLowerCase().includes('length'))).toBe(true)
  })
})

/* ——— nearest alternative windows ——— */

describe('nearest full-duration openings', () => {
  // Berth busy Sep 15–18; requested Sep 17–21 (5 days).
  const busy = [res({ id: 'r1', berthId: 'b240', startDate: '2026-09-15', endDate: '2026-09-18' })]
  const request = { startDate: '2026-09-17', endDate: '2026-09-21' }

  it('9. later 5-day opening starts the day after the conflict clears', () => {
    const { later } = getNearestWindows('b240', request, busy)
    expect(later).toEqual({ startDate: '2026-09-19', endDate: '2026-09-23' })
  })

  it('earlier 5-day opening ends the day before the conflict begins', () => {
    const { earlier } = getNearestWindows('b240', request, busy)
    expect(earlier).toEqual({ startDate: '2026-09-10', endDate: '2026-09-14' })
  })

  it('minStart clamps earlier windows (no suggestions in the past)', () => {
    const { earlier } = getNearestWindows('b240', request, busy, { minStart: '2026-09-12' })
    expect(earlier).toBeNull()
  })

  it('omits windows when nothing frees up inside the search window', () => {
    const wall = [res({ id: 'rw', berthId: 'b240', startDate: '2026-08-01', endDate: '2026-11-30' })]
    const { earlier, later } = getNearestWindows('b240', request, wall)
    expect(earlier).toBeNull()
    expect(later).toBeNull()
  })
})

/* ——— whole-request evaluation ——— */

describe('evaluateRequest ordering and suggestion', () => {
  it('orders available → occupied → too-short; smallest adequate berth first; suggests it', () => {
    const reservations = [res({ id: 'r1', berthId: 'b240', startDate: '2026-09-17', endDate: '2026-09-18' })]
    const evaln = evaluateRequest(BERTHS, vesselReq(80, '2026-09-17', '2026-09-21'), reservations)
    // 80 ft: fits B240 (occupied) and B90 (free); too short for B75.
    expect(evaln.results.map((r) => [r.berth.id, r.status])).toEqual([
      ['b90', 'available'],
      ['b240', 'occupied'],
      ['b75', 'too-short'],
    ])
    expect(evaln.suggestedBerthId).toBe('b90')
    expect(evaln.counts).toEqual({ available: 1, occupied: 1, tooShort: 1 })
  })

  it('event requests never produce too-short states', () => {
    const evaln = evaluateRequest(BERTHS, eventReq('2026-09-24', '2026-09-24'), [])
    expect(evaln.results.every((r) => r.status === 'available')).toBe(true)
  })
})

/* ——— berth availability windows ——— */

describe('getNextOpening', () => {
  // Spec-shaped fixture: busy Sep 15–19, Sep 22–30, Oct 6–7; ask from Sep 19.
  const busy = [
    res({ id: 'a', berthId: 'b240', startDate: '2026-09-15', endDate: '2026-09-19' }),
    res({ id: 'b', berthId: 'b240', startDate: '2026-09-22', endDate: '2026-09-30' }),
    res({ id: 'c', berthId: 'b240', startDate: '2026-10-06', endDate: '2026-10-07' }),
  ]
  const from = '2026-09-19'

  it('next opening starts the day AFTER an inclusive reservation end', () => {
    expect(getNextOpening('b240', from, busy)).toEqual({
      startDate: '2026-09-20',
      endDate: '2026-09-21',
      days: 2,
    })
  })

  it('next 3+ day opening skips too-small gaps and returns the full interval', () => {
    expect(getNextOpening('b240', from, busy, { minDays: 3 })).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      days: 5,
    })
  })

  it('next 7+ day opening can be open-ended', () => {
    expect(getNextOpening('b240', from, busy, { minDays: 7 })).toEqual({
      startDate: '2026-10-08',
      endDate: null,
      days: null,
    })
  })

  it('a completely free berth is open from the query day', () => {
    expect(getNextOpening('b90', from, busy)).toEqual({
      startDate: from,
      endDate: null,
      days: null,
    })
  })

  it('cancelled reservations do not affect openings', () => {
    const withCancelled = [
      ...busy,
      res({ id: 'x', berthId: 'b240', startDate: '2026-09-20', endDate: '2026-09-21', status: 'cancelled' }),
    ]
    expect(getNextOpening('b240', from, withCancelled)?.startDate).toBe('2026-09-20')
  })

  it('touching reservations leave no phantom opening between them', () => {
    const touching = [
      res({ id: 'a', berthId: 'b240', startDate: '2026-09-10', endDate: '2026-09-14' }),
      res({ id: 'b', berthId: 'b240', startDate: '2026-09-15', endDate: '2026-09-18' }),
    ]
    expect(getNextOpening('b240', '2026-09-10', touching)?.startDate).toBe('2026-09-19')
  })

  it('returns null when nothing qualifies inside the horizon', () => {
    const wall = [res({ id: 'w', berthId: 'b240', startDate: '2026-09-01', endDate: '2027-01-31' })]
    expect(getNextOpening('b240', from, wall, { minDays: 3, horizonDays: 90 })).toBeNull()
  })
})

/* ——— physical compatibility ——— */

describe('getVesselCompatibleBerths', () => {
  it('reflects vessel length: fitting berths (smallest first), then too-short by least deficit', () => {
    const rows = getVesselCompatibleBerths(80, BERTHS)
    expect(rows.map((r) => [r.berth.id, r.fits, r.clearanceFt])).toEqual([
      ['b90', true, 10],
      ['b240', true, 160],
      ['b75', false, -5],
    ])
  })

  it('exact-length berth counts as compatible', () => {
    const rows = getVesselCompatibleBerths(90, BERTHS)
    expect(rows.find((r) => r.berth.id === 'b90')?.fits).toBe(true)
  })
})

/* ——— creation validation ——— */

describe('validateReservationInput', () => {
  const ctx = { berths: BERTHS, vessels: VESSELS, reservations: [res({ id: 'r1', berthId: 'b240', startDate: '2026-09-10', endDate: '2026-09-16' })] }

  it('rejects a too-small berth with the deficit named', () => {
    const errors = validateReservationInput(
      { type: 'vessel', vesselId: 'v120', eventName: null, berthId: 'b90', startDate: '2026-10-01', endDate: '2026-10-03' },
      ctx,
    )
    expect(errors.join(' ')).toContain('30 ft')
  })

  it('rejects an overlap with the conflicting reservation named', () => {
    const errors = validateReservationInput(
      { type: 'vessel', vesselId: 'v90', eventName: null, berthId: 'b240', startDate: '2026-09-16', endDate: '2026-09-20' },
      ctx,
    )
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toContain('OSV Amber Reef')
  })

  it('rejects inverted dates and unnamed events', () => {
    expect(
      validateReservationInput(
        { type: 'event', vesselId: null, eventName: '  ', berthId: 'b75', startDate: '2026-09-24', endDate: '2026-09-24' },
        ctx,
      ).join(' '),
    ).toContain('Event name')
    expect(
      validateReservationInput(
        { type: 'event', vesselId: null, eventName: 'Community Sail Day', berthId: 'b75', startDate: '2026-09-25', endDate: '2026-09-24' },
        ctx,
      ).join(' '),
    ).toContain('precedes')
  })

  it('accepts a valid same-day event on a free berth', () => {
    const errors = validateReservationInput(
      { type: 'event', vesselId: null, eventName: 'Community Sail Day', berthId: 'b75', startDate: '2026-09-24', endDate: '2026-09-24' },
      ctx,
    )
    expect(errors).toEqual([])
  })
})
