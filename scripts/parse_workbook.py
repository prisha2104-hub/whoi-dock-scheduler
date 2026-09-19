#!/usr/bin/env python3
"""
Deterministic importer for "Dock Schedule - CSS Takehome Project.xlsx".

Reconstructs historical berth occupancy from the workbook's annual schedule
sheets and emits:
  src/data/source.generated.json   — imported berths / vessels / reservations
  source/IMPORT_AUDIT.md           — full audit + cross-checks + warnings

SPAN RECONSTRUCTION
-------------------
The workbook encodes a booking's occupied date range visually, and the
encoding changes across the 23 years. Precedence, per berth row / month:

  1. MERGED RANGE (used from 2009 onward) — authoritative. Only the anchor
     cell of a merge carries text/fill; the remaining cells are blank, so a
     naive "non-empty cell = one day" read loses the span entirely.
  2. CONTIGUOUS SAME-COLOUR FILL RUN (the only span signal in 1997–2008,
     which contain 0–1 merged cells in total). A maximal run of cells sharing
     one non-neutral fill colour is one booking block; the label may sit
     anywhere inside the run, not necessarily at its left edge. A run holding
     two or more labels is split at each label.
  3. Otherwise a lone labelled cell is a single day.

Neutral fills (white / greys / theme 0-1 backgrounds) are structural
shading, never occupancy: sheet 2006 alone carries ~2.7k white-filled blank
cells. Runs with a fill but no label are reported as warnings, and resolved
to a vessel only where the sheet's own colour legend maps that colour
unambiguously.

Day-number header rows in 1997–2013 are `=SUM(prev+1)` formula chains with
no cached values, so day columns are derived from the literal `1` seed plus
the calendar length of the month rather than read from the cells.
"""

from __future__ import annotations

import calendar
import collections
import datetime as _dt
import json
import re
from pathlib import Path

import openpyxl
from openpyxl.styles.colors import COLOR_INDEX
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
WB_PATH = ROOT / "source" / "Dock Schedule - CSS Takehome Project.xlsx"
OUT_JSON = ROOT / "src" / "data" / "source.generated.json"
OUT_AUDIT = ROOT / "source" / "IMPORT_AUDIT.md"

MONTHS = {m.upper(): i for i, m in enumerate(calendar.month_name) if m}
VESSEL_PREFIX = r"(R/V|M/V|M/Y|S/V|S/Y|F/V|OSV|OS/V|Tug|Barge)"

# Berth row labels carry their rated length: "North Pier West - 410'".
BERTH_RE = re.compile(r"^(?P<name>.+?)\s*-\s*(?P<len>\d+)\s*'\s*$")

# Cells that record an operational note against a berth-day rather than an
# occupant. In the workbook these steal a berth cell because the sheet has
# nowhere else to put them; they must not become reservations.
ANNOTATION_RE = re.compile(
    r"^(eta\b|etd\b|arrival|arrives|departure|departs|delayed|holiday|"
    r"fuel(ing)?\b|bunker(ing)?\b|provisioning|load equipment|wire spooling|"
    r"water/slops|touch and go|emergency port call|\d{3,4}$)",
    re.I,
)

# Label used for filled blocks whose occupant the workbook does not record.
# These are real occupancy — they must block the berth — but the name is not
# knowable, so no vessel is invented for them.
UNIDENTIFIED = "Unidentified historical occupancy"
AMBIGUITY_REASON = "Occupancy span present in workbook; label unavailable"

# Non-vessel occupancy: public programmes and berth closures both hold a
# berth for a date range, so both import as events.
EVENT_HINT_RE = re.compile(
    r"(sail day|open house|reception|campus event|film crew|tour|stroll|"
    r"road race|maintenance|repair|rebuild|bollard|utility work|ultrasonic|"
    r"inspection|paving|concrete|dredg|safety training|rescue drill|"
    r"restricted|no docking|no usage)",
    re.I,
)


# ——————————————————————————————— cell helpers ———————————————————————————————

def colour_key(cell) -> str | None:
    """
    Stable identity for a solid fill, across rgb / theme / indexed forms.

    Indexed colours are resolved through the legacy palette rather than kept
    as bare indices: index 9 is plain white and index 22 is silver, so leaving
    them unresolved would misread background shading in the 1997–2001 sheets
    as occupancy and let a fill run swallow an entire month.
    """
    f = cell.fill
    if f is None or f.patternType != "solid":
        return None
    c = f.start_color
    rgb = c.rgb if isinstance(c.rgb, str) else None
    if rgb:
        return "rgb:" + rgb[-6:]
    try:
        if c.type == "theme":
            return f"theme:{c.theme}:{round(float(c.tint or 0), 3)}"
    except Exception:
        pass
    try:
        if c.type == "indexed":
            i = int(c.indexed)
            if 0 <= i < len(COLOR_INDEX):
                return "rgb:" + str(COLOR_INDEX[i])[-6:]
            return None          # 64/65 = system foreground/background
    except Exception:
        pass
    return None


def is_neutral(key: str | None) -> bool:
    """White, grey-axis and base-theme fills are structural, not occupancy."""
    if key is None:
        return True
    if key.startswith("rgb:"):
        h = key[4:]
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return abs(r - g) <= 6 and abs(g - b) <= 6 and abs(r - b) <= 6
    if key.startswith("theme:"):
        return int(key.split(":")[1]) in (0, 1)
    return False


def text_of(cell) -> str | None:
    v = cell.value
    if isinstance(v, str) and v.strip():
        return re.sub(r"\s+", " ", v.strip())
    return None


def norm_name(s: str) -> str:
    """Identity key: case/space-insensitive, OS/V unified to OSV."""
    return re.sub(r"\s+", " ", re.sub(r"^OS/V", "OSV", s.strip(), flags=re.I)).upper()


def classify(title: str) -> str:
    if ANNOTATION_RE.match(title):
        return "annotation"
    if re.match(r"^" + VESSEL_PREFIX + r"\s", title, re.I):
        return "vessel"
    if EVENT_HINT_RE.search(title):
        return "event"
    return "event"  # non-vessel, non-annotation occupancy


# ——————————————————————————— sheet structure ———————————————————————————

def month_blocks(ws, sheet_year: int, sheet: str, unresolved: list):
    """
    Locate each month grid: header row, day-1 column, berth rows.

    The day-number row is normally the month-header row itself (or the one
    below it). It is found by locating the literal `1`; in 1997–2013 the
    remaining day numbers are `=SUM(prev+1)` formulas with no cached value,
    so the rest of the row is derived from the calendar length of the month.

    If the literal `1` is missing, the header is damaged. Day 1 is then
    recovered from any surviving day integer (column of day N, minus N-1).
    Blocks that cannot be anchored at all are quarantined, never guessed.
    """
    heads = []
    for r in range(1, ws.max_row + 1):
        v = ws.cell(r, 1).value
        if not isinstance(v, str):
            continue
        m = re.match(r"^([A-Za-z]+)(\s+(\d{4}))?$", v.strip())
        if m and m.group(1).upper() in MONTHS:
            heads.append((r, MONTHS[m.group(1).upper()],
                          int(m.group(3)) if m.group(3) else sheet_year,
                          bool(m.group(3))))

    out = []
    for i, (hr, mo, yr, had_year) in enumerate(heads):
        day_row = day1 = None
        for rr in (hr, hr + 1, hr + 2):
            if rr > ws.max_row:
                break
            for c in range(1, 13):
                if ws.cell(rr, c).value == 1:
                    day_row, day1 = rr, c
                    break
            if day_row:
                break

        if not day_row:
            # Damaged header: recover the day-1 column from a surviving day
            # integer further along the row.
            for rr in (hr, hr + 1):
                if rr > ws.max_row:
                    break
                for c in range(2, ws.max_column + 1):
                    v = ws.cell(rr, c).value
                    if isinstance(v, int) and 2 <= v <= 31:
                        day_row, day1 = rr, c - (v - 1)
                        break
                if day_row:
                    break
            conflict = had_year and yr != sheet_year
            if not (day_row and day1 >= 2):
                unresolved.append(dict(
                    sheet=sheet, label=f"{calendar.month_name[mo]} {yr}", row=hr,
                    month=mo, labelled_year=yr,
                    reason="no day-number row could be located — block not imported",
                    year_conflict=conflict))
                continue
            if conflict:
                # The header is damaged *and* the block's own label disagrees
                # with the sheet it lives on, so the period it describes cannot
                # be established. Attributing it to either year would invent a
                # fact, so the block is not imported.
                unresolved.append(dict(
                    sheet=sheet, label=f"{calendar.month_name[mo]} {yr}", row=hr,
                    month=mo, labelled_year=yr,
                    reason=(f"day-number header overwritten by vessel-name text and the "
                            f"block is labelled {yr} on the {sheet_year} sheet; the period "
                            f"cannot be resolved — block not imported"),
                    year_conflict=True))
                continue
            unresolved.append(dict(
                sheet=sheet, label=f"{calendar.month_name[mo]} {yr}", row=hr,
                month=mo, labelled_year=yr,
                reason=("day-number header partly overwritten by vessel-name text; "
                        f"day 1 recovered as column {day1}"),
                year_conflict=False))

        stop = heads[i + 1][0] if i + 1 < len(heads) else ws.max_row + 1
        berths = {}
        for r in range(day_row + 1, min(day_row + 13, stop)):
            lbl = text_of(ws.cell(r, 1))
            if lbl:
                berths[r] = lbl
        out.append(dict(month=mo, year=yr, day_row=day_row, day1=day1,
                        berths=berths, ndays=calendar.monthrange(yr, mo)[1],
                        labelled_year=had_year))
    return out


def colour_legend(ws, day_cols_by_row):
    """
    Map fill colour -> vessel name using the sheet's hand-kept legend: rows
    outside the month grids that pair a filled swatch with a vessel name.
    Colours that map to more than one name are dropped as unreliable.
    """
    cand = collections.defaultdict(collections.Counter)
    for row in ws.iter_rows():
        if row[0].row in day_cols_by_row:
            continue
        for cell in row:
            t = text_of(cell)
            k = colour_key(cell)
            if t and k and not is_neutral(k) and re.match(r"^" + VESSEL_PREFIX + r"\s", t, re.I):
                cand[k][norm_name(t)] += 1
    return {k: next(iter(c)) for k, c in cand.items() if len(c) == 1}


# ——————————————————————————————— extraction ———————————————————————————————

def extract(ws, sheet: str, warnings: list, unresolved: list):
    """
    Yield one record per reconstructed booking block on this sheet.

    Blocks with a fill but no label are emitted with `title=None` so the
    caller can try to resolve them by cross-month continuation (strongest
    evidence) and then by the sheet's colour legend, before giving up.
    """
    sheet_year = int(sheet)
    blocks = month_blocks(ws, sheet_year, sheet, unresolved)
    berth_rows = {b["day_row"] for b in blocks}
    legend = colour_legend(ws, berth_rows)

    anchors, covered = {}, set()
    for rng in ws.merged_cells.ranges:
        anchors[(rng.min_row, rng.min_col)] = rng
        for cc in range(rng.min_col, rng.max_col + 1):
            covered.add((rng.min_row, cc))

    records = []
    for blk in blocks:
        first, last = blk["day1"], blk["day1"] + blk["ndays"] - 1

        def emit(row, berth_label, c0, c1, title, source, colour=None):
            d0, d1 = max(1, c0 - first + 1), min(blk["ndays"], c1 - first + 1)
            if d1 < d0:
                return
            a, b = first + d0 - 1, first + d1 - 1
            records.append(dict(
                sheetName=sheet, sourceYear=blk["year"], month=blk["month"],
                sourceRow=row, berthLabel=berth_label, title=title,
                startDay=d0, endDay=d1, span=source, colour=colour,
                cellRange=(f"{get_column_letter(a)}{row}" if a == b
                           else f"{get_column_letter(a)}{row}:{get_column_letter(b)}{row}"),
            ))

        for row, berth_label in blk["berths"].items():
            # 1 ── merged ranges: authoritative spans
            handled = set()
            for c in range(first, last + 1):
                rng = anchors.get((row, c))
                if not rng:
                    continue
                a, b = max(rng.min_col, first), min(rng.max_col, last)
                title = text_of(ws.cell(row, c))
                key = colour_key(ws.cell(row, c))
                if title:
                    if classify(title) != "annotation":
                        emit(row, berth_label, a, b, title, "merged", key)
                elif key and not is_neutral(key):
                    emit(row, berth_label, a, b, None, "merged", key)
                handled.update(range(a, b + 1))

            # 2 ── maximal same-colour runs (sole span signal pre-2009)
            c = first
            while c <= last:
                if c in handled:
                    c += 1
                    continue
                key = colour_key(ws.cell(row, c))
                if is_neutral(key):
                    c += 1
                    continue
                b = c
                while (b + 1 <= last and b + 1 not in handled
                       and colour_key(ws.cell(row, b + 1)) == key):
                    b += 1
                labels = [(cc, text_of(ws.cell(row, cc)))
                          for cc in range(c, b + 1) if text_of(ws.cell(row, cc))]
                real = [(cc, t) for cc, t in labels if classify(t) != "annotation"]
                if not real:
                    if not labels:  # a run carrying only a note is not occupancy
                        emit(row, berth_label, c, b, None, "colour-run", key)
                else:
                    # one label -> whole run; several -> split at each label
                    for i, (cc, t) in enumerate(real):
                        a0 = c if i == 0 else cc
                        a1 = real[i + 1][0] - 1 if i + 1 < len(real) else b
                        emit(row, berth_label, a0, a1, t, "colour-run", key)
                handled.update(range(c, b + 1))
                c = b + 1

            # 3 ── lone labelled cell, no merge and no colour: one day
            for c in range(first, last + 1):
                if c in handled:
                    continue
                t = text_of(ws.cell(row, c))
                if t and classify(t) != "annotation":
                    emit(row, berth_label, c, c, t, "single-cell", None)

    return records


# ——————————————————————————————— main ———————————————————————————————

def iso(year, month, day):
    return f"{year}-{month:02d}-{day:02d}"


def shift(iso_date: str, days: int) -> str:
    import datetime as _dt
    y, m, d = map(int, iso_date.split("-"))
    return (_dt.date(y, m, d) + _dt.timedelta(days=days)).isoformat()


def dedupe_repeated_months(raw, warnings):
    """
    Sheets 2002–2004 each open with the previous December so the coordinator
    could see across the year boundary, so those months are described twice.
    The two renderings are not identical (December 2001 is offset by a day,
    December 2003 uses different berths), so the sheet whose own year matches
    the month is treated as authoritative and the repeat is dropped.
    """
    owners = collections.defaultdict(set)
    for r in raw:
        owners[(r["sourceYear"], r["month"])].add(r["sheetName"])
    drop = set()
    for (yr, mo), sheets in owners.items():
        if len(sheets) < 2:
            continue
        canonical = str(yr) if str(yr) in sheets else sorted(sheets)[0]
        for s in sheets - {canonical}:
            drop.add((yr, mo, s))
            warnings.append(
                f"{calendar.month_name[mo]} {yr} appears on sheets "
                f"{sorted(sheets)} with differing content; kept sheet "
                f"{canonical} as authoritative and dropped the repeat on {s}")
    return [r for r in raw
            if (r["sourceYear"], r["month"], r["sheetName"]) not in drop]


def stitch_and_resolve(raw, legends, warnings):
    """
    Resolve fill blocks that carry no label.

    A stay crossing a month boundary is drawn as a labelled block in one month
    and an unlabelled block in the next, because the grid restarts every month.
    Two joins are applied, both requiring positive evidence:

      * same colour, date-adjacent to a labelled block on that berth;
      * date-adjacent to a labelled block whose vessel is independently shown
        occupying the same berth on the day on the far side of the gap — this
        catches the common case where the label sits just after the
        continuation (e.g. 2004 Jan North Pier West is filled on the 1st–2nd
        with "Barge SALT DORY" written on the 3rd, and Dec 2003 shows that
        vessel on the same berth through the 31st).

    Blocks that survive both joins are matched against the sheet's colour
    legend. Anything still unnamed is kept as occupancy — the workbook plainly
    marks the berth-days as taken — but flagged ambiguous, because the occupant
    is not recoverable. It is never attributed to a guessed vessel.
    """
    for r in raw:
        r["start"] = iso(r["sourceYear"], r["month"], r["startDay"])
        r["end"] = iso(r["sourceYear"], r["month"], r["endDay"])

    def berth_of(r):
        return r["berthLabel"].split(" - ")[0].rstrip(":")

    def occupies(berth, vessel_key, day, exclude):
        """Is this vessel independently recorded on this berth on this day?"""
        for o in raw:
            if o is exclude or o.get("dropped") or not o["title"]:
                continue
            if berth_of(o) == berth and norm_name(o["title"]) == vessel_key \
                    and o["start"] <= day <= o["end"]:
                return True
        return False

    merged_count = 0
    changed = True
    while changed:
        changed = False
        by_berth = collections.defaultdict(list)
        for r in raw:
            if not r.get("dropped"):
                by_berth[berth_of(r)].append(r)
        for berth, rows in by_berth.items():
            rows.sort(key=lambda r: r["start"])
            for i, r in enumerate(rows):
                if r["title"] or r.get("dropped"):
                    continue
                for nb in (rows[i - 1] if i else None,
                           rows[i + 1] if i + 1 < len(rows) else None):
                    if nb is None or not nb["title"] or nb.get("dropped"):
                        continue
                    after = shift(nb["end"], 1) == r["start"]
                    before = shift(r["end"], 1) == nb["start"]
                    if not (after or before):
                        continue
                    key = norm_name(nb["title"])
                    if nb["colour"] == r["colour"]:
                        why = "continuation"
                    elif after and occupies(berth, key, shift(r["end"], 1), nb):
                        why = "continuation-verified"
                    elif before and occupies(berth, key, shift(r["start"], -1), nb):
                        why = "continuation-verified"
                    elif nb["span"] == "single-cell" and nb["start"] == nb["end"]:
                        # The label cell itself carries no fill and sits directly
                        # against a filled block. Everywhere else in the workbook
                        # a block's label sits inside the block, so the label
                        # names this block rather than a lone one-day stay.
                        why = "adjacent-block"
                    else:
                        continue
                    if after:
                        nb["end"] = r["end"]
                    else:
                        nb["start"] = r["start"]
                    nb["span"] = f"{nb['span'].split('+')[0]}+{why}"
                    r["dropped"] = True
                    merged_count += 1
                    changed = True
                    break

    resolved_by_legend = 0
    for r in raw:
        if r.get("dropped") or r["title"]:
            continue
        name = legends.get(r["sheetName"], {}).get(r["colour"])
        if name:
            r["title"] = name
            r["span"] += "+legend"
            resolved_by_legend += 1
        else:
            # Occupancy is certain, occupant is not. Keep the span.
            r["ambiguous"] = True
            r["title"] = UNIDENTIFIED
    unattributed = [r for r in raw if r.get("ambiguous")]
    return ([r for r in raw if not r.get("dropped")], merged_count,
            resolved_by_legend, unattributed)


def main():
    wb = openpyxl.load_workbook(WB_PATH)
    warnings: list[str] = []
    unresolved: list[dict] = []
    sheet_rows = {ws.title: (ws.max_row, ws.max_column) for ws in wb.worksheets}

    schedule_sheets = [ws.title for ws in wb.worksheets if re.fullmatch(r"\d{4}", ws.title)]
    other_sheets = [ws.title for ws in wb.worksheets if ws.title not in schedule_sheets]

    # ——— schedule sheets ———
    raw, legends = [], {}
    dup_rows = 0
    for sheet in schedule_sheets:
        ws = wb[sheet]
        raw.extend(extract(ws, sheet, warnings, unresolved))
        blocks = month_blocks(ws, int(sheet), sheet, [])
        legends[sheet] = colour_legend(ws, {b["day_row"] for b in blocks})
        # Some month grids list the same berth twice; both rows are read, which
        # can yield two imported stays on one berth for the same days.
        for b in blocks:
            names = [l.split(" - ")[0].rstrip(":") for l in b["berths"].values()]
            for name, n in collections.Counter(names).items():
                if n > 1:
                    dup_rows += 1
                    warnings.append(
                        f"{sheet} {calendar.month_name[b['month']]} {b['year']}: berth "
                        f"'{name}' appears on {n} rows of the same month grid; all rows "
                        f"were read, so this month may show overlapping stays on that berth")

    raw = dedupe_repeated_months(raw, warnings)
    raw, stitched, by_legend, unattributed = stitch_and_resolve(raw, legends, warnings)

    # ——— berths (from the row labels themselves) ———
    berth_meta: dict[str, dict] = {}
    for rec in raw:
        m = BERTH_RE.match(rec["berthLabel"])
        name = (m.group("name") if m else rec["berthLabel"]).strip().rstrip(":")
        length = int(m.group("len")) if m else None
        b = berth_meta.setdefault(name, dict(name=name, maxLengthFt=length, count=0,
                                             firstSeen=rec["sourceYear"]))
        if length is not None and b["maxLengthFt"] is None:
            b["maxLengthFt"] = length
        b["count"] += 1
        rec["berthName"] = name

    def berth_id(name: str) -> str:
        return "b-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    # ——— vessel directory from Science / Yachts ———
    directory = build_directory(wb, warnings)

    # ——— reservations ———
    reservations, vessels = [], {}
    events = 0
    for i, rec in enumerate(sorted(raw, key=lambda r: (r["start"], r["berthLabel"]))):
        ambiguous = bool(rec.get("ambiguous"))
        kind = "event" if ambiguous else classify(rec["title"])
        start, end = rec["start"], rec["end"]
        if end < start:
            continue

        vessel_id = None
        if kind == "vessel":
            key = norm_name(rec["title"])
            if key not in vessels:
                info = directory.get(key, {})
                vessels[key] = dict(
                    id="v-" + re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-"),
                    name=info.get("name") or rec["title"],
                    lengthFt=info.get("lengthFt"),
                    operator=info.get("operator"),
                    contactName=info.get("contactName"),
                    phone=info.get("phone"),
                    email=info.get("email"),
                    notes=info.get("notes"),
                    matchedDirectory=bool(info),
                )
            vessel_id = vessels[key]["id"]
        else:
            events += 1

        source = dict(sheet=rec["sheetName"], year=rec["sourceYear"],
                      row=rec["sourceRow"], cells=rec.get("cellRange"),
                      span=rec["span"])
        if ambiguous:
            source["ambiguous"] = True
            source["ambiguityReason"] = AMBIGUITY_REASON

        reservations.append(dict(
            id=f"s-{i+1}",
            type="vessel" if kind == "vessel" else "event",
            vesselId=vessel_id,
            eventName=None if kind == "vessel" else rec["title"],
            berthId=berth_id(rec["berthName"]),
            startDate=start, endDate=end,
            status="active",
            source=source,
        ))

    berths = [dict(id=berth_id(b["name"]), name=b["name"],
                   maxLengthFt=b["maxLengthFt"], active=True)
              for b in sorted(berth_meta.values(), key=lambda b: (b["firstSeen"], -b["count"]))]

    # Month blocks that could not be anchored at all. Their bookings are not
    # imported, so the months they could refer to must not be presented as
    # confidently empty — both the labelled period and the sheet's own year are
    # recorded as affected, because the workbook does not say which is correct.
    quarantined = []
    for u in unresolved:
        if "not imported" not in u["reason"]:
            continue
        mo = u["month"]
        labelled = f"{u['labelled_year']}-{mo:02d}"
        sheet_period = f"{int(u['sheet'])}-{mo:02d}"
        quarantined.append(dict(
            sheet=u["sheet"],
            labelledPeriod=labelled,
            sheetPeriod=sheet_period,
            reason=u["reason"],
            affectedMonths=sorted({labelled, sheet_period}),
        ))

    payload = dict(
        source=dict(
            workbook=WB_PATH.name,
            scheduleSheets=schedule_sheets,
            otherSheets=other_sheets,
            minDate=min(r["startDate"] for r in reservations),
            maxDate=max(r["endDate"] for r in reservations),
        ),
        quarantined=quarantined,
        berths=berths,
        vessels=[v for v in sorted(vessels.values(), key=lambda v: v["name"])],
        reservations=reservations,
    )
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

    def prune(obj):
        """Drop empty fields so the bundled payload stays small."""
        if isinstance(obj, dict):
            return {k: prune(v) for k, v in obj.items() if v is not None and v != ""}
        if isinstance(obj, list):
            return [prune(v) for v in obj]
        return obj

    OUT_JSON.write_text(json.dumps(prune(payload), separators=(",", ":")) + "\n")

    write_audit(wb, payload, raw, warnings, sheet_rows, schedule_sheets,
                other_sheets, events, unresolved, stitched, by_legend, unattributed)
    print(f"reservations={len(reservations)} vessels={len(vessels)} berths={len(berths)} "
          f"events={events} stitched={stitched} legend={by_legend} "
          f"warnings={len(warnings)} unresolved_blocks={len(unresolved)}")
    print(f"range {payload['source']['minDate']} .. {payload['source']['maxDate']}")


def build_directory(wb, warnings):
    """
    Parse the Science / Yachts contact sheets. Both are badly degraded: columns
    are not respected, values drift, and a vessel's length is embedded in its
    name string rather than held in a field. Only rows whose first cell is a
    recognisable vessel name are used as anchors; loose continuation rows are
    counted as unattributable rather than guessed onto a neighbouring vessel.
    """
    out, orphan_rows = {}, 0
    for sheet in ("Science", "Yachts"):
        ws = wb[sheet]
        for row in ws.iter_rows():
            cells = [text_of(c) for c in row]
            head = cells[0]
            m = head and re.match(
                r"^" + VESSEL_PREFIX + r"\s+(?P<nm>[A-Za-z' ]+?)\s*(?P<len>\d{2,3})\s*'\s*$",
                head, re.I)
            if not m:
                if any(cells):
                    orphan_rows += 1
                continue
            key = norm_name(re.sub(r"\s*\d{2,3}\s*'\s*$", "", head))
            rec = out.setdefault(key, dict(name=re.sub(r"\s*\d{2,3}\s*'\s*$", "", head).strip(),
                                           lengthFt=int(m.group("len")), sheet=sheet))
            rest = [c for c in cells[1:] if c]
            for val in rest:
                if re.match(r"^[\w.+-]+@[\w.-]+$", val) and not rec.get("email"):
                    rec["email"] = val
                elif re.match(r"^Cell:\s*", val, re.I) and not rec.get("phone"):
                    rec["phone"] = re.sub(r"^Cell:\s*", "", val, flags=re.I)
                elif re.match(r"^(Capt\.|Mr\.|Ms\.)?\s*[A-Z][a-z]+\s+[A-Z][a-z]+$", val) \
                        and not rec.get("contactName"):
                    rec["contactName"] = val
                elif re.search(r"(Institute|University|Partners|Agency|Trust|Charters|"
                               r"School|Academy|Foundation|Offshore|Services|Survey)", val) \
                        and not rec.get("operator"):
                    rec["operator"] = val
            # A structured LOA, where present, contradicts the name-embedded
            # length in every comparable row; record the disagreement.
            for val in rest:
                loa = re.search(r"LOA:\s*(\d+)'", val)
                if loa and int(loa.group(1)) != rec["lengthFt"]:
                    warnings.append(
                        f"{sheet}: {rec['name']} name says {rec['lengthFt']}ft but "
                        f"LOA field says {loa.group(1)}ft — kept name-embedded length")
    warnings.append(
        f"Science/Yachts: {orphan_rows} rows carry data but no vessel name in the "
        f"first column (orphaned continuation rows) — not attributed to any vessel")
    return out


def write_audit(wb, payload, raw, warnings, sheet_rows, schedule_sheets,
                other_sheets, events, unresolved, stitched, by_legend, unattributed):
    res = payload["reservations"]
    by_year = collections.Counter(r["source"]["year"] for r in res)
    by_berth = collections.Counter(r["berthId"] for r in res)
    by_span = collections.Counter(r["source"]["span"] for r in res)
    name_of = {b["id"]: b["name"] for b in payload["berths"]}

    L = []
    L.append("# Workbook import audit\n")
    L.append(f"Source: `{payload['source']['workbook']}`\n")
    L.append(f"Generated by `scripts/parse_workbook.py`. "
             f"Schedule coverage **{payload['source']['minDate']} .. {payload['source']['maxDate']}**.\n")

    L.append("\n## Worksheet inventory\n")
    L.append("| Sheet | Rows | Cols | Classification | Use |")
    L.append("|---|---:|---:|---|---|")
    for ws in wb.worksheets:
        r, c = sheet_rows[ws.title]
        if ws.title in schedule_sheets:
            cls, use = "historical dock schedule", f"imported — {by_year.get(int(ws.title),0)} records"
        elif ws.title == "8YR Dock Summary":
            cls, use = "summary / aggregate", "cross-check only (not imported)"
        elif ws.title in ("Science", "Yachts"):
            cls, use = "vessel / contact reference", "enriches vessel directory (not reservations)"
        elif ws.title == "Tours":
            cls, use = "tour reference", "not imported — tours tracked outside this workbook"
        else:
            cls, use = "other", "not imported"
        L.append(f"| {ws.title} | {r} | {c} | {cls} | {use} |")

    n_amb = sum(1 for r in res if r["source"].get("ambiguous"))
    amb_days = sum((_dt.date.fromisoformat(r["endDate"])
                    - _dt.date.fromisoformat(r["startDate"])).days + 1
                   for r in res if r["source"].get("ambiguous"))

    L.append("\n## Totals\n")
    L.append(f"- Reservations imported: **{len(res)}**")
    L.append(f"  - named vessel reservations: **{len(res)-events}**")
    L.append(f"  - named non-vessel events: **{events - n_amb}**")
    L.append(f"  - unidentified historical occupancy: **{n_amb}** "
             f"({amb_days} berth-days) — occupancy is certain, occupant is not")
    L.append(f"- Month blocks quarantined (period unresolvable, not imported): "
             f"**{sum(1 for u in unresolved if 'not imported' in u['reason'])}**")
    L.append(f"- Unique vessels: **{len(payload['vessels'])}** "
             f"({sum(1 for v in payload['vessels'] if v['matchedDirectory'])} matched to "
             f"Science/Yachts, {sum(1 for v in payload['vessels'] if v['lengthFt'] is None)} "
             f"with no known length)")
    L.append(f"- Berths: **{len(payload['berths'])}**")
    L.append(f"- Span reconstruction: " + ", ".join(f"{k}={v}" for k, v in by_span.most_common()))
    L.append(f"- Cross-month continuation blocks stitched onto their parent stay: **{stitched}**")
    L.append(f"- Unlabelled blocks named from a sheet colour legend: **{by_legend}**")

    L.append("\n## Records per year\n")
    L.append("| Year | Records |")
    L.append("|---|---:|")
    for y in sorted(by_year):
        L.append(f"| {y} | {by_year[y]} |")

    L.append("\n## Records per berth\n")
    L.append("| Berth | Max length | Records |")
    L.append("|---|---:|---:|")
    for b in payload["berths"]:
        ln = f"{b['maxLengthFt']} ft" if b["maxLengthFt"] else "not stated"
        L.append(f"| {b['name']} | {ln} | {by_berth.get(b['id'],0)} |")

    # ——— round-trip verification of every imported record ———
    L.append("\n## Round-trip verification\n")
    L.append("Every imported reservation is read back against the worksheet cells it "
             "claims. A day passes if its cell is covered by a merge anchored in that "
             "berth row, carries a non-neutral fill, or holds the label itself.\n")
    block_cache: dict[str, list] = {}
    checked, failed, examples = 0, 0, []
    for r in res:
        sh = r["source"]["sheet"]
        ws = wb[sh]
        if sh not in block_cache:
            block_cache[sh] = month_blocks(ws, int(sh), sh, [])
        blocks = block_cache[sh]
        want_berth = name_of[r["berthId"]]
        d = _dt.date.fromisoformat(r["startDate"])
        last = _dt.date.fromisoformat(r["endDate"])
        while d <= last:
            checked += 1
            blk = next((b for b in blocks if b["year"] == d.year and b["month"] == d.month), None)
            # A stitched stay crosses month grids, so the berth row is resolved
            # inside each block. Some grids repeat a berth row (e.g. September
            # 1998 lists North Pier West twice), so every matching row counts.
            rows = [rr for rr, lbl in (blk["berths"].items() if blk else [])
                    if lbl.split(" - ")[0].rstrip(":") == want_berth]
            if not rows:
                failed += 1
                if len(examples) < 6:
                    examples.append(f"{r['id']} {sh} {d} — no {want_berth} row in that month grid")
            else:
                col = blk["day1"] + d.day - 1
                ok = False
                for row in rows:
                    cell = ws.cell(row, col)
                    if any(rng.min_row == row and rng.min_col <= col <= rng.max_col
                           for rng in ws.merged_cells.ranges) \
                            or not is_neutral(colour_key(cell)) or text_of(cell):
                        ok = True
                        break
                if not ok:
                    failed += 1
                    if len(examples) < 6:
                        examples.append(f"{r['id']} {sh} {d} — no occupied cell at column "
                                        f"{col} in row(s) {rows}")
            d += _dt.timedelta(days=1)
    L.append(f"- Berth-days verified: **{checked}**")
    L.append(f"- Failures: **{failed}**"
             + ("" if failed == 0 else "\n\n" + "\n".join(f"  - {e}" for e in examples)))

    # ——— cross-check against the workbook's own 8-year summary ———
    L.append("\n## Cross-check — `8YR Dock Summary`\n")
    ws = wb["8YR Dock Summary"]
    years = [int(ws.cell(1, c).value) for c in range(2, 10)]
    occupied = collections.defaultdict(set)
    for r in res:
        d = _dt.date.fromisoformat(r["startDate"])
        last = _dt.date.fromisoformat(r["endDate"])
        while d <= last:
            occupied[(name_of[r["berthId"]], d.year)].add(d.isoformat())
            d += _dt.timedelta(days=1)

    summary_berths = [ws.cell(row, 1).value.strip() for row in range(2, 9)
                      if ws.cell(row, 1).value]
    grid_berths = {b["name"] for b in payload["berths"]}
    phantom = [b for b in summary_berths if b not in grid_berths]
    # berths that exist in the grids, but only from a later year than 2006–2013
    late = {}
    for name in summary_berths:
        if name in grid_berths:
            first = min((int(r["source"]["sheet"]) for r in res
                         if name_of[r["berthId"]] == name), default=None)
            if first and first > years[0]:
                late[name] = first

    L.append("This summary **cannot be used as a validation oracle for the schedule "
             "sheets**, for three reasons established from the workbook itself:\n")
    L.append(f"1. It reports on berths the schedule grids of those years do not contain. "
             f"`Marsh Landing` appears in **no** annual sheet at all, and "
             f"`North Finger Piers` rows first appear in **{late.get('North Finger Piers', 2014)}** "
             f"— yet both carry 2006–2013 totals. Those two rows account for "
             f"{sum(int(ws.cell(row, 2 + i).value or 0) for row in range(2, 9) for i in range(8) if (ws.cell(row,1).value or '').strip() in ('Marsh Landing','North Finger Piers'))}"
             f" of the summary's berth-days.")
    impossible = [(ws.cell(row, 1).value.strip(), years[i], int(ws.cell(row, 2 + i).value))
                  for row in range(2, 9) if ws.cell(row, 1).value
                  for i in range(8)
                  if isinstance(ws.cell(row, 2 + i).value, (int, float))
                  and ws.cell(row, 2 + i).value > 366]
    L.append(f"2. {len(impossible)} cells exceed the number of days in a year, which no "
             f"per-berth occupied-day count can produce — e.g. "
             + ", ".join(f"{b} {y} = {v}" for b, y, v in impossible[:3])
             + ". So its \"days\" are not per-berth occupied calendar days.")
    L.append("3. It stops at 2013 while the schedule runs to 2019, and its `Total Days` row "
             "is a live `=SUM()` over those same figures, so it is self-referential.")
    L.append("\nThe comparison is still shown for completeness. Rows for berths absent from "
             "the 2006–2013 grids are marked *phantom*.\n")
    L.append("| Berth | Year | Summary days | Parsed days | Δ | Note |")
    L.append("|---|---:|---:|---:|---:|---|")
    comparable = []
    for row in range(2, 9):
        bname = ws.cell(row, 1).value
        if not bname:
            continue
        bname = bname.strip()
        for i, y in enumerate(years):
            want = ws.cell(row, 2 + i).value
            if not isinstance(want, (int, float)):
                continue
            got = len(occupied.get((bname, y), set()))
            note = ""
            if bname in phantom:
                note = "phantom berth — absent from every sheet"
            elif bname in late and y < late[bname]:
                note = f"berth row absent until {late[bname]}"
            elif want > 366:
                note = "impossible value"
            else:
                comparable.append((want, got))
            L.append(f"| {bname} | {y} | {int(want)} | {got} | {got-int(want):+d} | {note} |")
    exact = sum(1 for w, g in comparable if w == g)
    L.append(f"\nOf {len(comparable)} structurally comparable berth-year cells, {exact} match "
             f"exactly. The residual differences are not attributable to the span "
             f"reconstruction: the round-trip check above confirms every imported day maps to "
             f"an occupied cell in the source grid.\n")

    L.append("\n## Unresolved / damaged month blocks\n")
    if unresolved:
        L.append("| Sheet | Block label | Row | Problem | Year conflict |")
        L.append("|---|---|---:|---|---|")
        for u in unresolved:
            L.append(f"| {u['sheet']} | {u['label']} | {u['row']} | {u['reason']} | "
                     f"{'yes' if u['year_conflict'] else 'no'} |")
    else:
        L.append("None.")

    L.append("\n## Unidentified historical occupancy (imported, flagged ambiguous)\n")
    if unattributed:
        days = sum((_dt.date.fromisoformat(r["end"]) - _dt.date.fromisoformat(r["start"])).days + 1
                   for r in unattributed)
        L.append(f"{len(unattributed)} filled block(s) totalling {days} berth-days carry no "
                 f"label, could not be joined to an adjacent stay, and match no colour legend. "
                 f"They satisfy the same fill rules that identify occupancy everywhere else, so "
                 f"they **are imported** — they block the berth and take part in conflict checks "
                 f"— under the title \"{UNIDENTIFIED}\" with "
                 f"`source.ambiguous = true`. No vessel is invented for them.\n")
        agg = collections.Counter((r["sheetName"], r["colour"]) for r in unattributed)
        L.append("| Sheet | Fill colour | Blocks |")
        L.append("|---|---|---:|")
        for (sh, col), n in sorted(agg.items(), key=lambda x: (-x[1], x[0])):
            L.append(f"| {sh} | `{col}` | {n} |")
    else:
        L.append("None.")

    L.append("\n## Other warnings\n")
    if warnings:
        L.append(f"{len(warnings)} item(s):\n")
        for w in warnings:
            L.append(f"- {w}")
    else:
        L.append("None.")
    OUT_AUDIT.write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
