import { describe, expect, it } from 'vitest'
import type { Berth, Reservation, Vessel } from '../data/types'
import { parseSearchDate, searchEntities } from './search'

const TODAY = '2026-09-19'

const berths: Berth[] = [
  { id: 'b-npw', name: 'North Pier West', maxLengthFt: 410, active: true },
  { id: 'b-npf', name: 'North Pier Face', maxLengthFt: 75, active: true },
  { id: 'b-sfe', name: 'South Float East', maxLengthFt: 90, active: true },
]

const vessels: Vessel[] = [
  { id: 'v-hd', name: 'R/V High Drift', lengthFt: 120, operator: 'Coastal Survey Partners', contactName: 'Parker Underhill' },
  { id: 'v-ar', name: 'OSV Amber Reef', lengthFt: 78, operator: 'Regional Fisheries Agency' },
]

const reservations: Reservation[] = [
  {
    id: 'r-1', type: 'vessel', vesselId: 'v-hd', eventName: null, berthId: 'b-npw',
    startDate: '2026-09-17', endDate: '2026-09-21', status: 'active',
  },
  {
    id: 'r-2', type: 'event', vesselId: null, eventName: 'Community Sail Day', berthId: 'b-npf',
    startDate: '2026-09-24', endDate: '2026-09-24', status: 'active', notes: 'public program',
  },
  {
    id: 'r-3', type: 'vessel', vesselId: 'v-ar', eventName: null, berthId: 'b-sfe',
    startDate: '2026-09-01', endDate: '2026-09-03', status: 'cancelled',
  },
]

const data = { berths, vessels, reservations }

describe('searchEntities', () => {
  it('finds a vessel by partial name, and its reservations', () => {
    const r = searchEntities('high dr', data, TODAY)
    expect(r.vessels.map((v) => v.id)).toEqual(['v-hd'])
    expect(r.reservations.map((x) => x.id)).toContain('r-1')
  })

  it('finds vessels by operator and contact name', () => {
    expect(searchEntities('coastal', data, TODAY).vessels.map((v) => v.id)).toEqual(['v-hd'])
    expect(searchEntities('underhill', data, TODAY).vessels.map((v) => v.id)).toEqual(['v-hd'])
  })

  it('finds berths by partial name, plus reservations at those berths', () => {
    const r = searchEntities('north pier', data, TODAY)
    expect(r.berths.map((b) => b.id)).toEqual(['b-npw', 'b-npf'])
    expect(r.reservations.map((x) => x.id)).toEqual(expect.arrayContaining(['r-1', 'r-2']))
  })

  it('finds events by name and by notes', () => {
    expect(searchEntities('community', data, TODAY).reservations.map((r) => r.id)).toEqual(['r-2'])
    expect(searchEntities('public program', data, TODAY).reservations.map((r) => r.id)).toEqual(['r-2'])
  })

  it('date queries return reservations covering that day', () => {
    const r = searchEntities('Sep 24', data, TODAY)
    expect(r.dateMatch).toBe('2026-09-24')
    expect(r.reservations.map((x) => x.id)).toEqual(['r-2'])
    // a day inside a multi-day stay also matches
    expect(searchEntities('Sep 19', data, TODAY).reservations.map((x) => x.id)).toContain('r-1')
  })

  it('orders active before cancelled and returns nothing for a blank query', () => {
    const r = searchEntities('s', data, TODAY) // matches broadly
    const ids = r.reservations.map((x) => x.id)
    expect(ids.indexOf('r-3')).toBe(ids.length - 1)
    expect(searchEntities('   ', data, TODAY).vessels).toEqual([])
  })
})

describe('parseSearchDate', () => {
  it('parses month-name, slash and ISO forms', () => {
    expect(parseSearchDate('Sep 24', 2026)).toBe('2026-09-24')
    expect(parseSearchDate('september 2, 2027', 2026)).toBe('2027-09-02')
    expect(parseSearchDate('9/24', 2026)).toBe('2026-09-24')
    expect(parseSearchDate('2026-09-24', 2026)).toBe('2026-09-24')
  })

  it('rejects non-dates and impossible dates', () => {
    expect(parseSearchDate('High Drift', 2026)).toBeNull()
    expect(parseSearchDate('Feb 30', 2026)).toBeNull()
    expect(parseSearchDate('sep', 2026)).toBeNull()
  })
})
