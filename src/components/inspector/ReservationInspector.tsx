import {
  berthById,
  reservationById,
  reservationDays,
  reservationTitle,
  vesselById,
} from '../../data/queries'
import { useData } from '../../data/store'
import { vesselFitsBerth } from '../../lib/scheduling'
import { fmtRange } from '../../lib/dates'
import { selToken, useSelection } from '../../hooks/useSelection'
import { Chip, EntityLink, KV } from '../ui'
import { InspectorMissing } from './InspectorHost'

export function ReservationInspector({ id }: { id: string }) {
  useData() // subscribe to live data (newly created reservations, length updates)
  const { setSel } = useSelection()
  const r = reservationById(id)
  if (!r) return <InspectorMissing label="Reservation" />

  const berth = berthById(r.berthId)
  const vessel = vesselById(r.vesselId)
  const days = reservationDays(r)

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line px-5 pb-4 pt-4">
        <div className="microlabel">{r.type === 'vessel' ? 'Vessel reservation' : 'Event'}</div>
        <h2 className="mt-1.5 pr-8 text-[15px] font-semibold leading-tight text-ink">
          {reservationTitle(r)}
        </h2>
        <div className="mt-2 flex items-center gap-1.5">
          <Chip tone={r.type === 'vessel' ? 'vessel' : 'event'}>
            {r.type === 'vessel' ? 'Vessel' : 'Event'}
          </Chip>
          {r.status === 'cancelled' ? (
            <Chip tone="brick" dot>
              Cancelled
            </Chip>
          ) : (
            <Chip tone="teal" dot>
              Confirmed
            </Chip>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <KV label="Dates">
          <span className="font-mono text-[12.5px]">{fmtRange(r.startDate, r.endDate, { year: true })}</span>
          <span className="ml-2 font-mono text-[11px] text-slate">
            {days} day{days === 1 ? '' : 's'}
          </span>
        </KV>

        <KV label="Berth">
          {berth ? (
            <>
              <EntityLink onClick={() => setSel(selToken.berth(berth.id))}>{berth.name}</EntityLink>
              <div className="mt-0.5 font-mono text-[11px] text-slate">{berth.maxLengthFt} ft max</div>
            </>
          ) : (
            '—'
          )}
        </KV>

        {r.type === 'vessel' && vessel && (
          <>
            <KV label="Vessel">
              <EntityLink onClick={() => setSel(selToken.vessel(vessel.id))}>{vessel.name}</EntityLink>
              <div className="mt-0.5 font-mono text-[11px] text-slate">
                {vessel.lengthFt != null ? `${vessel.lengthFt} ft` : 'Length not on file'}
              </div>
            </KV>

            {berth && (
              <div>
                <div className="microlabel mb-1">Berth fit</div>
                {vessel.lengthFt == null ? (
                  <p className="border-l-2 border-ochre bg-event-bg/40 px-2.5 py-1.5 text-[12px] leading-snug text-slate">
                    Fit unverified — vessel length not on file.
                  </p>
                ) : (
                  (() => {
                    const { fits, clearanceFt } = vesselFitsBerth(vessel.lengthFt, berth)
                    return fits ? (
                      <div className="font-mono text-[12px] text-ink">
                        {vessel.lengthFt} ft vessel · {berth.maxLengthFt} ft berth
                        <span className="ml-1.5 text-teal">+{clearanceFt} ft clearance</span>
                      </div>
                    ) : (
                      <div className="border-l-2 border-brick bg-[#f4e8e4] px-2.5 py-1.5">
                        <div className="microlabel text-brick">Fit issue</div>
                        <p className="mt-0.5 font-mono text-[12px] text-brick">
                          Vessel exceeds berth by {Math.abs(clearanceFt)} ft
                        </p>
                      </div>
                    )
                  })()
                )}
              </div>
            )}

            {vessel.operator && <KV label="Operator">{vessel.operator}</KV>}
            {(vessel.contactName || vessel.phone || vessel.email) && (
              <KV label="Contact">
                {vessel.contactName && <div>{vessel.contactName}</div>}
                {vessel.phone && <div className="font-mono text-[12px]">{vessel.phone}</div>}
                {vessel.email && <div className="font-mono text-[12px]">{vessel.email}</div>}
              </KV>
            )}
          </>
        )}

        {r.type === 'event' && berth && (
          <p className="border-l-2 border-event-cap bg-event-bg/40 py-1.5 pl-3 pr-2 text-[12.5px] leading-snug text-slate">
            This event holds {berth.name} for its dates — the berth is closed to vessel traffic.
          </p>
        )}

        {r.notes && <KV label="Notes">{r.notes}</KV>}
      </div>
    </div>
  )
}
