# Alongside — Waterfront Scheduling

Berth scheduling for a marine research facility, replacing a 23-year-old
spreadsheet workflow (`Dock Schedule - CSS Takehome Project.xlsx`). The
schedule is the operational home screen: berths as rows, continuous days as
columns, with vessel calls and non-vessel events as first-class occupancy.

## Run

```
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` type-checks and produces a
production build. `npm test` runs the unit test suite.

## Data

The application is loaded with the **actual historical schedule from the
supplied workbook** — 1997–2019, every annual sheet, 2,467 reservations across
8 berths and 429 vessels. Nothing is synthesised: 2,163 named vessel calls,
49 named non-vessel events, and 255 blocks the workbook marks as occupied
without recording an occupant (imported as flagged, unnamed occupancy).

`source/Dock Schedule - CSS Takehome Project.xlsx` is the source of truth.
`npm run import:workbook` re-runs the importer
(`scripts/parse_workbook.py`, requires Python 3 + `openpyxl`), regenerating
`src/data/source.generated.json` and the full audit at
`source/IMPORT_AUDIT.md` — worksheet inventory, span-reconstruction method,
per-year and per-berth counts, round-trip verification, cross-checks, and
every block the workbook does not describe well enough to import.

The workbook encodes a booking's occupied range **visually**, and differently
across the years, so a "non-empty cell = one day" read is wrong. Spans are
reconstructed in this precedence:

1. **Merged ranges** (used from 2009 on) — authoritative. Only the anchor cell
   carries text, so the span is invisible to a value-only read.
2. **Contiguous same-colour fill runs** — the only span signal in 1997–2008,
   which contain 0–1 merged cells in total. A run's label may sit anywhere
   inside it; a run with two labels is split at each.
3. A lone labelled cell with neither is a single day.

Neutral fills (white, greys, base-theme) are structural shading, never
occupancy — sheet 2006 alone carries ~2.7k white-filled blank cells, and
indexed colour 9 is plain white. Stays crossing a month boundary are stitched
back together, verified either by matching fill colour or by the same vessel
being independently recorded on that berth on the far side of the boundary.

Two layers are kept apart at runtime: the imported history is **immutable and
reloads deterministically**, while reservations created in the app and vessel
lengths recorded through it sit on top and are what a reset clears. Imported
records carry a `source` provenance block; user-created ones do not.

The schedule opens on **December 2019**, the last month the workbook covers,
rather than the present day. "Today" still jumps to the real current date,
which correctly shows no imported activity.

## What it does

- **Waterfront schedule** — a continuous resource timeline (Month/Week zoom,
  sticky berth column and date header, today marker, weekend banding).
  Stays that cross month boundaries render as one bar — something the
  legacy month-grid spreadsheet could not express. A compact ops line
  summarizes today's occupancy, arrivals and departures.
- **Intelligent reservation creation** — one reactive panel: pick a vessel
  (or name an event) and dates, and every berth is evaluated instantly —
  physical fit with clearance in feet, availability, named conflicts with
  their dates and an availability strip, nearest earlier/later
  full-duration openings (clickable — they re-date the request), and a
  smallest-compatible-berth suggestion. While the panel is open the
  schedule behind it enters a subtle matching mode. Vessels with no
  recorded length pause matching until a length is saved to the record —
  no guessing.
- **Global search (⌘K / Ctrl+K)** — vessels (name/operator/contact), berths,
  reservations (vessel/event name, berth, notes), and date queries
  ("Sep 24" finds reservations covering that day). Grouped results, full
  keyboard navigation; selection opens the right inspector. Searching never
  disturbs an in-progress booking draft.
- **Connected records** — vessel detail shows compatible berths (physical
  fit only) and visit history; berth detail computes next / 3+ day / 7+ day
  openings over a 90-day horizon with one-click **Book** prefill;
  reservation detail states berth fit explicitly (including a visible FIT
  ISSUE state for any record that doesn't fit). Every related entity is one
  click away; list pages have working filters and sorting.

## Scheduling rules (exact)

- **Fit** — a vessel fits iff `vessel.lengthFt ≤ berth.maxLengthFt`;
  clearance is the signed difference. Equal length fits. No draft/beam/tide
  rules were invented.
- **Occupancy** — whole days, both endpoints occupied. Sep 10–16 vs
  Sep 16–20 conflicts; Sep 17–20 does not.
- **Blocking** — only `active` reservations block; cancelled never do.
- **States** — `too-short` (fails fit, regardless of dates), else `occupied`
  (any overlap), else `available`. Events skip the fit check.
- **Ordering** — available → occupied → too-short; within available and
  occupied, smallest adequate berth first; within too-short, closest to
  fitting first; ties keep physical berth order. The first available berth
  is labeled a *suggestion* (smallest compatible), never an assignment.
- **Alternatives** — nearest earlier and later windows of the exact
  requested duration (day-by-day scan, ±30 days); earlier windows never
  start in the past unless the request itself is retroactive.
- **Availability windows** — nearest free interval of at least 1/3/7 days
  within 90 days, returned in full (bounded by the next reservation) or
  open-ended.

## Structure

- `src/lib/scheduling.ts` — all business rules as pure functions: fit,
  inclusive whole-day overlap (`aStart ≤ bEnd && bStart ≤ aEnd`), berth
  evaluation and ordering, nearest-window search, availability openings,
  physical compatibility, and creation-time validation. Used by the panel,
  the timeline's matching mode, and the store — the UI cannot disagree with
  the rules that gate a reservation.
- `src/lib/search.ts` — pure global search (substring matching on
  identifying fields + date-query parsing).
- `src/data/store.ts` — module store with subscribers
  (`useSyncExternalStore`): live vessels/reservations, the in-progress
  draft, and mutations (`createReservation`, `updateVesselLength`) that
  re-validate through the scheduling module.
- `src/data/types.ts` — `Berth`, `Vessel` (nullable `lengthFt`),
  `Reservation` (type `vessel | event`, status `active | cancelled`,
  inclusive ISO dates).
- `src/data/source.generated.json` + `src/data/source.ts` — the imported
  workbook history (immutable base dataset) and its typed loader.
- `scripts/parse_workbook.py` — the deterministic importer and audit generator.
- `src/data/queries.ts` — read helpers over the live snapshot.
- `src/lib/dates.ts` — ISO date-only helpers, UTC-noon anchored.
- `src/hooks/useSelection.ts` — inspector selection in the URL
  (`?sel=r:…|v:…|b:…|new`), which makes cross-entity navigation a plain link.
- `src/components/` — timeline, inspectors, search palette, shell, shared UI.
- Tests: `src/lib/scheduling.test.ts`, `src/lib/search.test.ts`,
  `src/data/store.test.ts` — 50 cases covering fit boundaries, inclusive
  overlap, cancelled-reservation behavior, missing lengths,
  alternative-window and opening math, search, draft persistence, and
  end-to-end creation effects.

## Assumptions

- Dates are whole days, inclusive on both ends — matching how the legacy
  workbook recorded occupancy (merged day-cells). Same-day turnover is not
  modeled.
- Events occupy a berth exactly like vessels; they have a name instead of
  dimensions.
- A vessel's `lengthFt` may be `null` ("not on file") — true of most vessels
  in the source workbook; the booking flow records it when first needed.
- Cancelled reservations release the berth: they appear only in the
  Reservations → Cancelled tab, never on the timeline or in availability.
- The smallest-compatible-berth suggestion is an interface heuristic to
  conserve large-berth capacity, not an operational rule.
- Historical records are imported verbatim. Where the workbook itself
  contains overlaps (some month grids list a berth twice) or a stay that
  exceeds its berth's rated length, the record is kept and surfaced rather
  than silently corrected — the app flags it instead.
- Where a filled block carries no label and cannot be joined to an adjacent
  stay or matched to a colour legend, the occupancy is still real, so it is
  imported as "Unidentified historical occupancy" with `source.ambiguous`.
  It blocks the berth and takes part in conflict checks, but no vessel is
  invented for it and the UI states that the occupant is not known.
- Two month blocks in the 2010 sheet are labelled 2018 and have damaged day
  headers; their period cannot be resolved from the workbook, so they are
  quarantined rather than attributed to a guessed year. The Schedule shows a
  source-coverage notice for the affected months so an empty row there is not
  read as "the berth was available".

## Out of scope (deliberately)

Editing/cancellation of existing reservations, draft/depth/beam/tide rules,
rafting, approval workflows, accounts/permissions, notifications, analytics
dashboards, and automatic berth assignment.
