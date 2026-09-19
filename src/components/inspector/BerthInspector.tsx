import {
  berthById,
  currentForBerth,
  reservationTitle,
  reservationsForBerth,
} from '../../data/queries'
import { setDraft, useData } from '../../data/store'
import { getNextOpening, type Opening } from '../../lib/scheduling'
import { addDays, fmtDay, fmtRange, todayISO } from '../../lib/dates'
import { selToken, useSelection } from '../../hooks/useSelection'
import { Chip, EmptyNote, KV, RowLink, SectionLabel } from '../ui'
import { InspectorMissing } from './InspectorHost'

const HORIZON = 90

export function BerthInspector({ id }: { id: string }) {
  const { reservations } = useData() // live subscription
  const { setSel } = useSelection()
  const berth = berthById(id)
  if (!berth) return <InspectorMissing label="Berth" />

  const today = todayISO()
  const current = currentForBerth(berth.id, today)
  const upcoming = reservationsForBerth(berth.id, addDays(today, 1), addDays(today, HORIZON)).filter(
    (r) => r.id !== current?.id,
  )
  const recent = reservations
    .filter((r) => r.status === 'active' && r.berthId === berth.id && r.endDate < today)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, 3)

  /* Availability windows — dedupe rows that resolve to the same opening. */
  const openAny = getNextOpening(berth.id, today, reservations, { horizonDays: HORIZON })
  const open3 = getNextOpening(berth.id, today, reservations, { minDays: 3, horizonDays: HORIZON })
  const open7 = getNextOpening(berth.id, today, reservations, { minDays: 7, horizonDays: HORIZON })
  const windows: { label: string; minDays: number; opening: Opening | null; show: boolean }[] = [
    { label: 'Next opening', minDays: 1, opening: openAny, show: true },
    {
      label: 'Next 3+ day opening',
      minDays: 3,
      opening: open3,
      show: open3?.startDate !== openAny?.startDate || open3 == null,
    },
    {
      label: 'Next 7+ day opening',
      minDays: 7,
      opening: open7,
      show: open7?.startDate !== (open3 ?? openAny)?.startDate || open7 == null,
    },
  ]

  const bookOpening = (opening: Opening, minDays: number) => {
    const endDate = opening.endDate ?? addDays(opening.startDate, minDays - 1)
    setDraft({ berthId: berth.id, startDate: opening.startDate, endDate })
    setSel(selToken.new)
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line px-5 pb-4 pt-4">
        <div className="microlabel">Berth</div>
        <h2 className="mt-1.5 pr-8 text-[15px] font-semibold leading-tight text-ink">{berth.name}</h2>
        <div className="mt-1 font-mono text-[11.5px] text-slate">{berth.maxLengthFt} ft maximum vessel length</div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <KV label="Today">
          {current ? (
            <div className="flex items-center gap-2">
              <Chip tone={current.type === 'vessel' ? 'vessel' : 'event'} dot>
                Occupied
              </Chip>
              <span className="text-[12.5px] text-slate">{reservationTitle(current)}</span>
            </div>
          ) : (
            <Chip tone="teal" dot>
              Available
            </Chip>
          )}
        </KV>

        {/* availability windows */}
        <div>
          <SectionLabel>Availability</SectionLabel>
          <div className="border border-line bg-panel">
            {windows.map(
              (w) =>
                w.show && (
                  <div
                    key={w.label}
                    className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="microlabel">{w.label}</div>
                      {w.opening ? (
                        <div className="mt-0.5 font-mono text-[12px] text-ink">
                          {w.opening.endDate
                            ? fmtRange(w.opening.startDate, w.opening.endDate)
                            : `From ${fmtDay(w.opening.startDate)}`}
                          <span className="ml-1.5 text-[10.5px] text-slate">
                            {w.opening.days != null
                              ? `· ${w.opening.days} day${w.opening.days === 1 ? '' : 's'}`
                              : '· open'}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11.5px] text-faint">
                          No {w.minDays > 1 ? `${w.minDays}+ day ` : ''}opening in the next {HORIZON}{' '}
                          days
                        </div>
                      )}
                    </div>
                    {w.opening && (
                      <button
                        onClick={() => bookOpening(w.opening!, w.minDays)}
                        className="shrink-0 border border-line-strong bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.05em] text-slate hover:border-accent hover:text-accent"
                        title="Open New Reservation with this berth and these dates prefilled"
                      >
                        Book
                      </button>
                    )}
                  </div>
                ),
            )}
          </div>
        </div>

        {current && (
          <div>
            <SectionLabel>Current reservation</SectionLabel>
            <RowLink
              primary={reservationTitle(current)}
              secondary={fmtRange(current.startDate, current.endDate)}
              onClick={() => setSel(selToken.reservation(current.id))}
            />
          </div>
        )}

        <div>
          <SectionLabel>Upcoming</SectionLabel>
          {upcoming.length === 0 && <EmptyNote>Nothing scheduled in the next {HORIZON} days.</EmptyNote>}
          {upcoming.slice(0, 4).map((r) => (
            <RowLink
              key={r.id}
              primary={reservationTitle(r)}
              secondary={fmtRange(r.startDate, r.endDate)}
              onClick={() => setSel(selToken.reservation(r.id))}
            />
          ))}
        </div>

        <div>
          <SectionLabel>Recent</SectionLabel>
          {recent.length === 0 && <EmptyNote>No previous reservations recorded.</EmptyNote>}
          {recent.map((r) => (
            <RowLink
              key={r.id}
              primary={reservationTitle(r)}
              secondary={fmtRange(r.startDate, r.endDate)}
              onClick={() => setSel(selToken.reservation(r.id))}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
