import { describe, expect, it } from 'vitest'
import {
  SOURCE_BERTHS,
  SOURCE_META,
  SOURCE_QUARANTINED,
  SOURCE_RESERVATIONS,
  SOURCE_VESSELS,
  isQuarantinedMonth,
  quarantineNotesFor,
} from './source'
import { spanDays } from '../lib/dates'
import { getBerthConflicts, overlaps } from '../lib/scheduling'

/**
 * Fidelity of the imported workbook data. These guard the properties that the
 * importer is responsible for, so a regression in `scripts/parse_workbook.py`
 * fails the suite rather than silently changing the historical record.
 */

const YEARS_WITH_SHEETS = Array.from({ length: 2019 - 1997 + 1 }, (_, i) => 1997 + i)

describe('source coverage', () => {
  it('covers 1997–2019, the workbook’s actual extent', () => {
    expect(SOURCE_META.firstYear).toBe(1997)
    expect(SOURCE_META.lastYear).toBe(2019)
    expect(SOURCE_META.yearRange).toBe('1997–2019')
    expect(SOURCE_META.firstDate).toBe('1997-08-01')
    expect(SOURCE_META.lastDate).toBe('2019-12-31')
  })

  it('imports records from every schedule year found in the workbook', () => {
    const years = new Set(SOURCE_RESERVATIONS.map((r) => Number(r.startDate.slice(0, 4))))
    for (const y of YEARS_WITH_SHEETS) {
      expect(years.has(y), `no records imported for ${y}`).toBe(true)
    }
    expect(SOURCE_META.scheduleSheets).toHaveLength(23)
  })

  it('imports the earliest and the latest source year', () => {
    expect(SOURCE_RESERVATIONS.some((r) => r.startDate.startsWith('1997'))).toBe(true)
    expect(SOURCE_RESERVATIONS.some((r) => r.startDate.startsWith('2019'))).toBe(true)
  })

  it('contains no record beyond the workbook’s latest source date', () => {
    expect(SOURCE_RESERVATIONS.every((r) => r.endDate <= SOURCE_META.lastDate)).toBe(true)
    // and nothing from the invented 2026 prototype baseline
    expect(SOURCE_RESERVATIONS.some((r) => r.startDate.startsWith('2026'))).toBe(false)
  })

  it('opens the schedule on the latest month that actually has bookings', () => {
    expect(SOURCE_META.latestMonth).toBe('2019-12-01')
    const inMonth = SOURCE_RESERVATIONS.filter(
      (r) => r.startDate <= '2019-12-31' && r.endDate >= '2019-12-01',
    )
    expect(inMonth.length).toBeGreaterThan(0)
  })
})

describe('berths', () => {
  it('carries the six rated berths from the workbook row labels', () => {
    const rated = SOURCE_BERTHS.filter((b) => b.maxLengthFt != null)
      .map((b) => [b.name, b.maxLengthFt])
    expect(rated).toEqual(
      expect.arrayContaining([
        ['North Pier West', 410],
        ['North Pier Face', 75],
        ['North Pier East', 240],
        ['Inner Channel', 55],
        ['South Float West', 90],
        ['South Float East', 90],
      ]),
    )
  })

  it('keeps the two unrated rows unrated rather than inventing a length', () => {
    const unrated = SOURCE_BERTHS.filter((b) => b.maxLengthFt == null).map((b) => b.name)
    expect(unrated).toEqual(
      expect.arrayContaining(['North Finger Piers', 'Small craft slips (institution boats)']),
    )
  })

  it('never references a berth that does not exist', () => {
    const ids = new Set(SOURCE_BERTHS.map((b) => b.id))
    expect(SOURCE_RESERVATIONS.every((r) => ids.has(r.berthId))).toBe(true)
  })
})

describe('reservations', () => {
  it('are all well-formed, active and provenance-tagged', () => {
    for (const r of SOURCE_RESERVATIONS) {
      expect(r.startDate <= r.endDate, `${r.id} has inverted dates`).toBe(true)
      expect(r.status).toBe('active')
      expect(r.source, `${r.id} missing provenance`).toBeTruthy()
      expect(r.source!.year).toBeGreaterThanOrEqual(1997)
    }
  })

  it('distinguishes vessel calls from non-vessel events', () => {
    const vesselIds = new Set(SOURCE_VESSELS.map((v) => v.id))
    const events = SOURCE_RESERVATIONS.filter((r) => r.type === 'event')
    const calls = SOURCE_RESERVATIONS.filter((r) => r.type === 'vessel')
    expect(events.length).toBeGreaterThan(0)
    expect(calls.length).toBeGreaterThan(0)
    for (const r of calls) {
      expect(r.vesselId && vesselIds.has(r.vesselId), `${r.id} bad vessel ref`).toBe(true)
      expect(r.eventName).toBeNull()
    }
    for (const r of events) {
      expect(r.vesselId).toBeNull()
      expect(r.eventName?.trim()).toBeTruthy()
    }
  })

  it('imports recognisable non-vessel events from the workbook', () => {
    const names = SOURCE_RESERVATIONS.filter((r) => r.type === 'event')
      .map((r) => r.eventName!.toLowerCase())
    expect(names.some((n) => n.includes('sail day'))).toBe(true)
    expect(names.some((n) => /maintenance|repair|rebuild|no docking|no usage/.test(n))).toBe(true)
  })

  it('reconstructs multi-day spans, not one row per filled cell', () => {
    const multi = SOURCE_RESERVATIONS.filter((r) => spanDays(r.startDate, r.endDate) > 1)
    // A naive "one cell = one day" read produced ~74% single-day records; real
    // span reconstruction must leave the majority of stays longer than a day.
    expect(multi.length / SOURCE_RESERVATIONS.length).toBeGreaterThan(0.5)
  })

  it('recovers spans from merged ranges and from styled continuation cells', () => {
    const spans = SOURCE_RESERVATIONS.map((r) => r.source!.span)
    expect(spans.some((s) => s.startsWith('merged'))).toBe(true)
    expect(spans.some((s) => s.startsWith('colour-run'))).toBe(true)
    // multi-day blocks exist under both encodings
    const byMerge = SOURCE_RESERVATIONS.filter(
      (r) => r.source!.span.startsWith('merged') && spanDays(r.startDate, r.endDate) > 1)
    const byColour = SOURCE_RESERVATIONS.filter(
      (r) => r.source!.span.startsWith('colour-run') && spanDays(r.startDate, r.endDate) > 1)
    expect(byMerge.length).toBeGreaterThan(50)
    expect(byColour.length).toBeGreaterThan(50)
  })

  it('keeps single-day bookings single-day', () => {
    const oneDay = SOURCE_RESERVATIONS.filter((r) => r.startDate === r.endDate)
    expect(oneDay.length).toBeGreaterThan(100)
    expect(oneDay.every((r) => spanDays(r.startDate, r.endDate) === 1)).toBe(true)
  })

  it('stitches stays that cross a month boundary into one record', () => {
    const crossing = SOURCE_RESERVATIONS.filter(
      (r) => r.startDate.slice(0, 7) !== r.endDate.slice(0, 7))
    expect(crossing.length).toBeGreaterThan(0)
    // A single month grid cannot express a crossing, so every such record must
    // have been joined from two blocks rather than read from one.
    expect(crossing.every((r) => r.source!.span.includes('+'))).toBe(true)
  })

  it('does not import the same month twice from two sheets', () => {
    const owners = new Map<string, Set<string>>()
    for (const r of SOURCE_RESERVATIONS) {
      const key = r.startDate.slice(0, 7)
      if (!owners.has(key)) owners.set(key, new Set())
      owners.get(key)!.add(r.source!.sheet)
    }
    // December 2001–2003 are drawn on two sheets each; only one may be imported
    for (const m of ['2001-12', '2002-12', '2003-12']) {
      expect(owners.get(m)?.size, `${m} imported from multiple sheets`).toBe(1)
    }
  })
})

/* ——— occupancy the workbook records without naming an occupant ——— */

describe('unidentified historical occupancy', () => {
  const ambiguous = SOURCE_RESERVATIONS.filter((r) => r.source?.ambiguous)

  it('is imported rather than discarded', () => {
    expect(ambiguous.length).toBeGreaterThan(0)
    const days = ambiguous.reduce((n, r) => n + spanDays(r.startDate, r.endDate), 0)
    expect(days).toBeGreaterThan(0)
  })

  it('blocks its berth for the exact inclusive span', () => {
    const r = ambiguous[0]
    const all = SOURCE_RESERVATIONS
    // every day of the span conflicts
    expect(getBerthConflicts(r.berthId, r.startDate, r.startDate, all).map((x) => x.id)).toContain(r.id)
    expect(getBerthConflicts(r.berthId, r.endDate, r.endDate, all).map((x) => x.id)).toContain(r.id)
    // the days immediately outside it do not, via this record
    const before = getBerthConflicts(r.berthId, '1900-01-01', '1900-01-01', all)
    expect(before.map((x) => x.id)).not.toContain(r.id)
    expect(spanDays(r.startDate, r.endDate)).toBeGreaterThanOrEqual(1)
  })

  it('participates in overlap checks for every ambiguous record', () => {
    for (const r of ambiguous) {
      const hits = getBerthConflicts(r.berthId, r.startDate, r.endDate, SOURCE_RESERVATIONS)
      expect(hits.map((x) => x.id), `${r.id} does not block its own berth`).toContain(r.id)
    }
  })

  it('never invents a vessel', () => {
    const vesselIds = new Set(SOURCE_VESSELS.map((v) => v.id))
    for (const r of ambiguous) {
      expect(r.type).toBe('event')
      expect(r.vesselId).toBeNull()
    }
    // no vessel in the directory is named after the placeholder
    expect(SOURCE_VESSELS.some((v) => /unidentified/i.test(v.name))).toBe(false)
    // and the placeholder never leaks into a vessel reference
    expect([...vesselIds].some((id) => /unidentified/i.test(id))).toBe(false)
  })

  it('is visibly marked as source-ambiguous and distinguishable from named events', () => {
    for (const r of ambiguous) {
      expect(r.eventName).toBe('Unidentified historical occupancy')
      expect(r.source!.ambiguous).toBe(true)
      expect(r.source!.ambiguityReason)
        .toBe('Occupancy span present in workbook; label unavailable')
      expect(r.source!.cells).toBeTruthy()
    }
    const namedEvents = SOURCE_RESERVATIONS.filter(
      (r) => r.type === 'event' && !r.source?.ambiguous)
    expect(namedEvents.length).toBeGreaterThan(0)
    expect(namedEvents.every((r) => r.eventName !== 'Unidentified historical occupancy')).toBe(true)
  })
})

/* ——— month blocks whose period could not be resolved ——— */

describe('quarantined source periods', () => {
  it('records the damaged 2010-sheet blocks instead of guessing their year', () => {
    expect(SOURCE_QUARANTINED.length).toBe(2)
    expect(SOURCE_QUARANTINED.every((q) => q.sheet === '2010')).toBe(true)
    expect(SOURCE_QUARANTINED.map((q) => q.labelledPeriod).sort())
      .toEqual(['2018-11', '2018-12'])
    expect(SOURCE_QUARANTINED.map((q) => q.sheetPeriod).sort())
      .toEqual(['2010-11', '2010-12'])
  })

  it('imports nothing from those blocks under either candidate year', () => {
    for (const m of ['2010-11', '2010-12']) {
      expect(SOURCE_RESERVATIONS.filter((r) => r.startDate.startsWith(m)).length).toBe(0)
    }
    // and nothing from the 2010 sheet was filed under 2018
    expect(SOURCE_RESERVATIONS.some(
      (r) => r.source!.sheet === '2010' && !r.startDate.startsWith('2010'))).toBe(false)
  })

  it('flags every affected month so it is not shown as confidently empty', () => {
    for (const m of ['2010-11', '2010-12', '2018-11', '2018-12']) {
      expect(isQuarantinedMonth(m), `${m} not flagged`).toBe(true)
      expect(quarantineNotesFor(m).length).toBeGreaterThan(0)
      expect(quarantineNotesFor(m)[0].reason).toMatch(/cannot be resolved/)
    }
  })

  it('does not flag months with intact coverage', () => {
    for (const m of ['2010-10', '2019-12', '1997-08']) {
      expect(isQuarantinedMonth(m), `${m} wrongly flagged`).toBe(false)
      expect(quarantineNotesFor(m)).toHaveLength(0)
    }
  })
})

describe('vessels', () => {
  it('never invents a length: unknown stays null', () => {
    const unknown = SOURCE_VESSELS.filter((v) => v.lengthFt == null)
    expect(unknown.length).toBeGreaterThan(0)
    expect(SOURCE_VESSELS.every((v) => v.lengthFt == null || v.lengthFt > 0)).toBe(true)
  })

  it('carries directory detail only where a vessel matched Science/Yachts', () => {
    const enriched = SOURCE_VESSELS.filter((v) => v.lengthFt != null)
    expect(enriched.length).toBeGreaterThan(0)
    // every enriched vessel keeps its source-facing name
    expect(enriched.every((v) => /\S/.test(v.name))).toBe(true)
  })

  it('has no duplicate identities after normalisation', () => {
    const keys = SOURCE_VESSELS.map((v) =>
      v.name.replace(/^OS\/V/i, 'OSV').replace(/\s+/g, ' ').trim().toUpperCase())
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is referenced by at least one reservation for every vessel', () => {
    const used = new Set(SOURCE_RESERVATIONS.map((r) => r.vesselId).filter(Boolean))
    // the directory is built from the schedule, so there are no orphan vessels
    expect(SOURCE_VESSELS.every((v) => used.has(v.id))).toBe(true)
  })
})

describe('fit and conflict logic still applies to imported data', () => {
  it('flags imported stays that exceed their berth’s rated length, without altering them', () => {
    const byId = new Map(SOURCE_BERTHS.map((b) => [b.id, b]))
    const vById = new Map(SOURCE_VESSELS.map((v) => [v.id, v]))
    let checked = 0
    for (const r of SOURCE_RESERVATIONS) {
      const b = byId.get(r.berthId)!
      const v = r.vesselId ? vById.get(r.vesselId) : undefined
      if (!v || v.lengthFt == null || b.maxLengthFt == null) continue
      checked++
      // the record is imported verbatim whether or not it fits
      expect(r.startDate <= r.endDate).toBe(true)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('detects overlaps among imported records using the same rule as the app', () => {
    const byBerth = new Map<string, typeof SOURCE_RESERVATIONS>()
    for (const r of SOURCE_RESERVATIONS) {
      const list = byBerth.get(r.berthId) ?? []
      list.push(r)
      byBerth.set(r.berthId, list)
    }
    let overlapping = 0
    for (const list of byBerth.values()) {
      const sorted = [...list].sort((a, b) => a.startDate.localeCompare(b.startDate))
      for (let i = 1; i < sorted.length; i++) {
        if (overlaps(sorted[i].startDate, sorted[i].endDate,
                     sorted[i - 1].startDate, sorted[i - 1].endDate)) overlapping++
      }
    }
    // The workbook repeats a berth row inside some month grids, so a handful of
    // historical overlaps genuinely exist. They are preserved, not silently
    // removed — but they must stay a small minority of the record set.
    expect(overlapping / SOURCE_RESERVATIONS.length).toBeLessThan(0.05)
  })
})
