import { berthById, reservationDays, vesselById, vesselHistory } from '../../data/queries'
import { useData } from '../../data/store'
import type { Reservation } from '../../data/types'
import { getVesselCompatibleBerths } from '../../lib/scheduling'
import { fmtBerthLength, fmtRange, todayISO } from '../../lib/dates'
import { selToken, useSelection } from '../../hooks/useSelection'
import { EmptyNote, KV, SectionLabel } from '../ui'
import { InspectorMissing } from './InspectorHost'

export function VesselInspector({ id }: { id: string }) {
  const { berths } = useData() // live subscription
  const { setSel } = useSelection()
  const vessel = vesselById(id)
  if (!vessel) return <InspectorMissing label="Vessel" />

  const today = todayISO()
  const { upcoming, past } = vesselHistory(vessel.id, today)
  const compat = vessel.lengthFt != null ? getVesselCompatibleBerths(vessel.lengthFt, berths) : null

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line px-5 pb-4 pt-4">
        <div className="microlabel">Vessel</div>
        <h2 className="mt-1.5 pr-8 text-[15px] font-semibold leading-tight text-ink">{vessel.name}</h2>
        <div className="mt-1 font-mono text-[11.5px] text-slate">
          {vessel.lengthFt != null ? `${vessel.lengthFt} ft LOA` : 'Length not on file'}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {vessel.operator && <KV label="Operator">{vessel.operator}</KV>}

        {(vessel.contactName || vessel.phone || vessel.email) && (
          <KV label="Contact">
            {vessel.contactName && <div>{vessel.contactName}</div>}
            {vessel.phone && <div className="font-mono text-[12px]">{vessel.phone}</div>}
            {vessel.email && <div className="font-mono text-[12px]">{vessel.email}</div>}
          </KV>
        )}

        {vessel.notes && <KV label="Notes">{vessel.notes}</KV>}

        {/* physical compatibility — no date availability implied */}
        <div>
          <SectionLabel>Compatible berths</SectionLabel>
          {compat ? (
            <div>
              {compat.map(({ berth, fits, clearanceFt }) => (
                <button
                  key={berth.id}
                  onClick={() => setSel(selToken.berth(berth.id))}
                  className={`group flex w-full items-center justify-between gap-3 border-b border-line px-1 py-[7px] text-left last:border-b-0 hover:bg-[#f1efe7] ${
                    fits ? '' : 'opacity-55'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-accent">
                      {berth.name}
                    </span>
                    <span className="block font-mono text-[10.5px] text-slate">
                      {fmtBerthLength(berth.maxLengthFt)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[11px] ${
                      clearanceFt == null ? 'text-slate' : fits ? 'text-teal' : 'text-brick'
                    }`}
                  >
                    {clearanceFt == null
                      ? 'Fit unknown'
                      : fits
                        ? `+${clearanceFt} ft`
                        : `Too short · −${Math.abs(clearanceFt)} ft`}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyNote>Length not on file — record it to evaluate berth fit.</EmptyNote>
          )}
        </div>

        <HistorySection
          label="Upcoming"
          rows={upcoming}
          empty="No upcoming reservations"
          onOpenReservation={(rid) => setSel(selToken.reservation(rid))}
          onOpenBerth={(bid) => setSel(selToken.berth(bid))}
        />
        <HistorySection
          label="Previous visits"
          rows={past.slice(0, 5)}
          empty="No previous visits recorded"
          onOpenReservation={(rid) => setSel(selToken.reservation(rid))}
          onOpenBerth={(bid) => setSel(selToken.berth(bid))}
        />
      </div>
    </div>
  )
}

function HistorySection({
  label,
  rows,
  empty,
  onOpenReservation,
  onOpenBerth,
}: {
  label: string
  rows: Reservation[]
  empty: string
  onOpenReservation: (id: string) => void
  onOpenBerth: (id: string) => void
}) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      {rows.length === 0 && <EmptyNote>{empty}</EmptyNote>}
      {rows.map((r) => {
        const berth = berthById(r.berthId)
        const days = reservationDays(r)
        return (
          <div key={r.id} className="flex items-center gap-2 border-b border-line last:border-b-0">
            <button
              onClick={() => onOpenReservation(r.id)}
              className="group min-w-0 flex-1 px-1 py-2 text-left"
            >
              <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-accent">
                {fmtRange(r.startDate, r.endDate)}
              </span>
              <span className="block font-mono text-[10.5px] text-slate">
                {days} day{days === 1 ? '' : 's'}
              </span>
            </button>
            {berth && (
              <button
                onClick={() => onOpenBerth(berth.id)}
                className="shrink-0 px-1 py-2 text-right text-[11.5px] text-slate hover:text-accent"
              >
                {berth.name}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
