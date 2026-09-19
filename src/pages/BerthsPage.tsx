import { PageHeader } from '../components/shell/PageHeader'
import { Chip } from '../components/ui'
import { useData } from '../data/store'
import { currentForBerth, nextForBerth, reservationTitle } from '../data/queries'
import { getNextOpening } from '../lib/scheduling'
import { fmtBerthLength, fmtDay, fmtRange, todayISO } from '../lib/dates'
import { selToken, useSelection } from '../hooks/useSelection'

export function BerthsPage() {
  const { berths, reservations } = useData()
  const { sel, setSel } = useSelection()
  const today = todayISO()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Berths"
        context="Physical dock spaces and their rated maximum vessel lengths"
      />

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <div className="min-h-0 flex-1 overflow-auto border border-line-strong bg-surface">
          <table className="dt">
            <thead>
              <tr>
                <th>Berth</th>
                <th className="w-28">Max length</th>
                <th>Today</th>
                <th>Next reservation</th>
                <th>Next opening</th>
              </tr>
            </thead>
            <tbody>
              {berths.map((b) => {
                const current = currentForBerth(b.id, today)
                const next = nextForBerth(b.id, today)
                const opening = getNextOpening(b.id, today, reservations)
                return (
                  <tr
                    key={b.id}
                    data-selected={sel?.kind === 'berth' && sel.id === b.id}
                    onClick={() => setSel(selToken.berth(b.id))}
                  >
                    <td className="font-medium text-ink">{b.name}</td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-slate">
                      {fmtBerthLength(b.maxLengthFt)}
                    </td>
                    <td>
                      {current ? (
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-[6px] w-[6px] shrink-0 rounded-full ${
                              current.type === 'vessel' ? 'bg-accent' : 'bg-event-cap'
                            }`}
                            aria-hidden
                          />
                          <span className="text-ink">{reservationTitle(current)}</span>
                        </span>
                      ) : (
                        <Chip tone="teal" dot>
                          Available
                        </Chip>
                      )}
                    </td>
                    <td className="text-slate">
                      {next ? (
                        <>
                          {reservationTitle(next)}
                          <span className="ml-2 font-mono text-[12px] text-faint">
                            {fmtDay(next.startDate)}
                          </span>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-slate">
                      {!opening ? (
                        <span className="text-faint">None in 90 days</span>
                      ) : opening.startDate === today ? (
                        <span className="text-teal">Now</span>
                      ) : opening.endDate ? (
                        fmtRange(opening.startDate, opening.endDate)
                      ) : (
                        `From ${fmtDay(opening.startDate)}`
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.07em] text-faint">
          Berth inventory and rated lengths sourced from the 1997–2019 dock schedule workbook
        </p>
      </div>
    </div>
  )
}
