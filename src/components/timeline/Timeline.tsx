import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useData } from '../../data/store'
import type { Reservation } from '../../data/types'
import {
  berthById,
  isAmbiguousOccupancy,
  reservationDays,
  reservationTitle,
  reservationsForBerth,
  vesselById,
} from '../../data/queries'
import {
  evaluateRequest,
  requestFromDraft,
  type BerthStatus,
  type BookingRequest,
} from '../../lib/scheduling'
import {
  addDays,
  dateRange,
  dayNum,
  diffDays,
  dowLetter,
  fmtRange,
  isWeekend,
  monthShort,
  todayISO,
} from '../../lib/dates'
import { selToken, useSelection } from '../../hooks/useSelection'
import { useTooltip } from '../Tooltip'

const LABEL_W = 224
const ROW_H = 64
const HEADER_H = 46
const BAR_H = 44
const BAR_TOP = (ROW_H - BAR_H) / 2

interface TimelineProps {
  /** First visible day (ISO). */
  startISO: string
  /** Number of days rendered. */
  days: number
  view: 'week' | 'month'
}

/** Strip the type prefix ("R/V ", "OSV ", …) when a bar is too narrow. */
function shortName(name: string): string {
  return name.replace(/^(R\/V|M\/V|M\/Y|S\/V|S\/Y|F\/V|OSV|OS\/V|Tug|Barge)\s+/i, '')
}

function barMeta(r: Reservation): string | null {
  if (isAmbiguousOccupancy(r)) return 'occupant unknown'
  if (r.type === 'event') return 'Event'
  const v = vesselById(r.vesselId)
  if (!v) return null
  return v.lengthFt != null ? `${v.lengthFt} ft` : 'length —'
}

/** Clamp the requested date range to visible day indices; null if off-view. */
function spanIndices(
  request: BookingRequest,
  startISO: string,
  days: number,
): { startIdx: number; endIdx: number } | null {
  const startIdx = Math.max(0, diffDays(startISO, request.startDate))
  const endIdx = Math.min(days - 1, diffDays(startISO, request.endDate))
  if (endIdx < 0 || startIdx > days - 1 || startIdx > endIdx) return null
  return { startIdx, endIdx }
}

export function Timeline({ startISO, days, view }: TimelineProps) {
  const { berths, vessels, reservations, draft } = useData()
  const { sel, setSel } = useSelection()
  const tooltip = useTooltip()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dayW, setDayW] = useState(44)

  const endISO = addDays(startISO, days - 1)
  const cells = useMemo(() => dateRange(startISO, days), [startISO, days])
  const today = todayISO()
  const todayIdx = cells.indexOf(today)

  /**
   * Matching mode: while the New Reservation panel is open with a computable
   * request, every berth row reflects its evaluation — available rows show
   * the requested span, too-short rows recede, occupied rows stay legible so
   * the conflicting bars remain readable.
   */
  const matching = useMemo(() => {
    if (sel?.kind !== 'new') return null
    const request = requestFromDraft(draft, vessels)
    if (!request) return null
    const evaln = evaluateRequest(berths, request, reservations)
    const statusByBerth = new Map<string, BerthStatus>(
      evaln.results.map((r) => [r.berth.id, r.status]),
    )
    return { request, statusByBerth }
  }, [sel?.kind, draft, vessels, berths, reservations])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const compute = () => {
      const avail = el.clientWidth - LABEL_W
      const [min, max] = view === 'week' ? [96, 220] : [40, 64]
      setDayW(Math.max(min, Math.min(max, Math.floor(avail / days))))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [days, view])

  const laneW = days * dayW
  const selectedReservation = sel?.kind === 'reservation' ? sel.id : null
  const selectedBerth = sel?.kind === 'berth' ? sel.id : null

  const showTip = (e: React.MouseEvent<HTMLElement>, r: Reservation) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const berth = berthById(r.berthId)
    const meta = barMeta(r)
    const d = reservationDays(r)
    tooltip.show(
      Math.min(Math.max(rect.left + rect.width / 2, 130), window.innerWidth - 130),
      rect.top - 6,
      <div>
        <div className="text-[12px] font-semibold leading-tight">{reservationTitle(r)}</div>
        <div className="mt-1 font-mono text-[10.5px] opacity-80">
          {fmtRange(r.startDate, r.endDate)} · {d} day{d === 1 ? '' : 's'}
        </div>
        <div className="font-mono text-[10.5px] opacity-80">
          {berth?.name}
          {meta ? ` · ${meta}` : ''}
        </div>
        {isAmbiguousOccupancy(r) && (
          <div className="mt-1 max-w-[220px] text-[10.5px] leading-snug opacity-70">
            Occupant not identified in source workbook.
          </div>
        )}
      </div>,
    )
  }

  return (
    <div ref={scrollRef} className="tl-scroll" onScroll={tooltip.hide}>
      <div style={{ width: LABEL_W + laneW, minWidth: '100%' }}>
        {/* ——— date header ——— */}
        <div className="tl-hrow" style={{ height: HEADER_H }}>
          <div className="tl-corner" style={{ width: LABEL_W }}>
            <span className="microlabel">Berth</span>
          </div>
          {cells.map((d) => (
            <div
              key={d}
              className={`tl-dayhead${isWeekend(d) ? ' is-weekend' : ''}${d === today ? ' is-today' : ''}`}
              style={{ width: dayW }}
            >
              <span className="dow">{dowLetter(d)}</span>
              <span className="num">
                {dayNum(d) === 1 || d === startISO ? `${monthShort(d)} ${dayNum(d)}` : dayNum(d)}
              </span>
            </div>
          ))}
        </div>

        {/* ——— berth rows ——— */}
        {berths.map((b) => {
          const rows = reservationsForBerth(b.id, startISO, endISO)
          const matchStatus = matching?.statusByBerth.get(b.id) ?? null
          const matchSpan =
            matching && (matchStatus === 'available' || draft.berthId === b.id)
              ? spanIndices(matching.request, startISO, days)
              : null
          return (
            <div
              key={b.id}
              className={`tl-row${matchStatus === 'too-short' ? ' is-receded' : ''}`}
              style={{ height: ROW_H }}
            >
              <button
                className="tl-labelcell"
                style={{ width: LABEL_W }}
                data-selected={selectedBerth === b.id}
                onClick={() => setSel(selToken.berth(b.id))}
                aria-label={`${b.name}, ${
                  b.maxLengthFt == null
                    ? 'no rated maximum length'
                    : `maximum vessel length ${b.maxLengthFt} feet`
                }${matchStatus ? `, ${matchStatus.replace('-', ' ')} for the current request` : ''}`}
              >
                <span className="b-name">{b.name}</span>
                <span className="b-cap">
                  {b.maxLengthFt == null ? 'no rated length' : `${b.maxLengthFt} ft max`}
                </span>
                {matchStatus && (
                  <span className={`match-tag t-${matchStatus}`}>
                    {matchStatus === 'too-short' ? 'Too short' : matchStatus}
                  </span>
                )}
              </button>

              <div className="tl-lane" style={{ width: laneW }}>
                {cells.map((d) => (
                  <div
                    key={d}
                    className={`tl-cell${isWeekend(d) ? ' is-weekend' : ''}${d === today ? ' is-today' : ''}`}
                    style={{ width: dayW }}
                  />
                ))}

                {todayIdx >= 0 && <div className="tl-nowline" style={{ left: todayIdx * dayW }} />}

                {matchSpan && (
                  <div
                    className={`tl-match-span${draft.berthId === b.id ? ' is-selected' : ''}`}
                    style={{
                      left: matchSpan.startIdx * dayW + 2,
                      width: (matchSpan.endIdx - matchSpan.startIdx + 1) * dayW - 4,
                    }}
                    aria-hidden
                  />
                )}

                {rows.map((r) => {
                  const clipL = r.startDate < startISO
                  const clipR = r.endDate > endISO
                  const startIdx = clipL ? 0 : diffDays(startISO, r.startDate)
                  const endIdx = clipR ? days - 1 : diffDays(startISO, r.endDate)
                  const span = endIdx - startIdx + 1
                  const barPx = span * dayW - 4
                  const title = reservationTitle(r)
                  const label = isAmbiguousOccupancy(r)
                    ? 'Unidentified'
                    : barPx < 72
                      ? shortName(title)
                      : title
                  const meta = barMeta(r)
                  const showMeta = barPx >= 92 && meta != null
                  const d = reservationDays(r)

                  return (
                    <button
                      key={r.id}
                      className={`tl-bar ${
                        isAmbiguousOccupancy(r)
                          ? 'is-unknown'
                          : r.type === 'vessel'
                            ? 'is-vessel'
                            : 'is-event'
                      }`}
                      data-selected={selectedReservation === r.id}
                      style={{
                        left: startIdx * dayW + 2,
                        width: barPx,
                        top: BAR_TOP,
                        height: BAR_H,
                        borderTopLeftRadius: clipL ? 0 : undefined,
                        borderBottomLeftRadius: clipL ? 0 : undefined,
                        borderTopRightRadius: clipR ? 0 : undefined,
                        borderBottomRightRadius: clipR ? 0 : undefined,
                        paddingLeft: clipL ? 12 : undefined,
                        paddingRight: clipR ? 12 : undefined,
                      }}
                      onClick={() => setSel(selToken.reservation(r.id))}
                      onMouseEnter={(e) => showTip(e, r)}
                      onMouseLeave={tooltip.hide}
                      onFocus={(e) => showTip(e as unknown as React.MouseEvent<HTMLElement>, r)}
                      onBlur={tooltip.hide}
                      aria-label={`${title}, ${b.name}, ${fmtRange(r.startDate, r.endDate, { year: true })}, ${d} day${d === 1 ? '' : 's'}, ${
                        isAmbiguousOccupancy(r)
                          ? 'occupancy recorded in the source workbook without an occupant'
                          : r.type === 'vessel'
                            ? 'vessel reservation'
                            : 'event'
                      }`}
                    >
                      {clipL && (
                        <span className="bar-clip l" aria-hidden>
                          ‹
                        </span>
                      )}
                      <span className="bar-name">{label}</span>
                      {showMeta && <span className="bar-meta">{meta}</span>}
                      {clipR && (
                        <span className="bar-clip r" aria-hidden>
                          ›
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
