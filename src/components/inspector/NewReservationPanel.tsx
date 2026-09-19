import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { Reservation } from '../../data/types'
import {
  createReservation,
  resetDraft,
  setDraft,
  updateVesselLength,
  useData,
} from '../../data/store'
import { reservationTitle } from '../../data/queries'
import {
  evaluateRequest,
  requestFromDraft,
  type BerthEvaluation,
} from '../../lib/scheduling'
import { dayNum, fmtDay, fmtRange, spanDays, todayISO } from '../../lib/dates'
import { selToken, useSelection } from '../../hooks/useSelection'
import { Button, Segmented } from '../ui'

/**
 * The reservation workflow. A compact reactive panel — every input change
 * immediately re-evaluates all berths (fit, availability, conflicts, nearest
 * alternative windows). The draft lives in the store so the schedule behind
 * the panel can render matching mode, and so a detour to inspect a berth or
 * reservation doesn't lose the in-progress booking.
 */

const STATUS_LABEL = { available: 'Available', occupied: 'Occupied', 'too-short': 'Too short' } as const
const STATUS_CLASS = {
  available: 'text-teal',
  occupied: 'text-slate',
  'too-short': 'text-brick',
} as const

function clearanceLabel(ft: number | null): string {
  if (ft == null) return ''
  return ft >= 0 ? `+${ft} ft` : `−${Math.abs(ft)} ft`
}

/** Contiguous-run label for blocked days: "Sep 17–18" or "3 days". */
function blockedLabel(days: string[]): string {
  if (days.length === 0) return ''
  const first = days[0]
  const last = days[days.length - 1]
  const contiguous = spanDays(first, last) === days.length
  return contiguous ? fmtRange(first, last) : `${days.length} days`
}

export function NewReservationPanel() {
  const { berths, vessels, reservations, draft } = useData()
  const { setSel } = useSelection()
  const [created, setCreated] = useState<Reservation | null>(null)
  const [createErrors, setCreateErrors] = useState<string[]>([])
  const [lengthInput, setLengthInput] = useState('')

  const today = todayISO()
  const vessel = draft.vesselId ? vessels.find((v) => v.id === draft.vesselId) : undefined
  const hasDates = Boolean(draft.startDate && draft.endDate)
  const datesInverted = hasDates && draft.startDate > draft.endDate
  const duration = hasDates && !datesInverted ? spanDays(draft.startDate, draft.endDate) : null

  const request = requestFromDraft(draft, vessels)
  // Alternative windows may not start in the past — unless the request itself
  // is retroactive (backfilling a log), in which case nearby past dates are fine.
  const evaln = request
    ? evaluateRequest(berths, request, reservations, {
        minStart: request.startDate >= today ? today : undefined,
      })
    : null
  const selected = evaln?.results.find((r) => r.berth.id === draft.berthId)

  /* ——— confirm gating ——— */
  const blockers: string[] = []
  if (draft.type === 'vessel') {
    if (!draft.vesselId) blockers.push('Select a vessel.')
    else if (vessel?.lengthFt == null) blockers.push('Record the vessel length to check berth fit.')
  } else if (!draft.eventName.trim()) {
    blockers.push('Name the event.')
  }
  if (!hasDates) blockers.push('Set arrival and departure dates.')
  else if (datesInverted) blockers.push('Departure precedes arrival.')
  if (blockers.length === 0) {
    if (!draft.berthId || !selected) blockers.push('Select an available berth.')
    else if (selected.status === 'occupied') blockers.push('Selected berth is occupied for these dates.')
    else if (selected.status === 'too-short') blockers.push('Selected berth is too short for this vessel.')
  }
  const canConfirm = blockers.length === 0

  const confirm = () => {
    const result = createReservation({
      type: draft.type,
      vesselId: draft.type === 'vessel' ? draft.vesselId : null,
      eventName: draft.type === 'event' ? draft.eventName : null,
      berthId: draft.berthId,
      startDate: draft.startDate,
      endDate: draft.endDate,
      notes: draft.notes,
    })
    if (result.ok) {
      setCreated(result.reservation)
      setCreateErrors([])
      resetDraft()
    } else {
      setCreateErrors(result.errors)
    }
  }

  const saveLength = () => {
    if (!vessel) return
    if (updateVesselLength(vessel.id, Number(lengthInput))) setLengthInput('')
  }

  /* ——— created confirmation state ——— */
  if (created) {
    const berth = berths.find((b) => b.id === created.berthId)
    return (
      <div className="flex min-h-full flex-col">
        <div className="border-b border-line px-5 pb-4 pt-4">
          <div className="microlabel text-teal">Reservation created</div>
          <h2 className="mt-1.5 pr-8 text-[15px] font-semibold leading-tight text-ink">
            {reservationTitle(created)}
          </h2>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="border border-line bg-panel px-3 py-2.5">
            <div className="text-[12.5px] font-medium text-ink">{berth?.name}</div>
            <div className="mt-0.5 font-mono text-[11.5px] text-slate">
              {fmtRange(created.startDate, created.endDate, { year: true })} ·{' '}
              {spanDays(created.startDate, created.endDate)} day
              {spanDays(created.startDate, created.endDate) === 1 ? '' : 's'}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="flex-1 justify-center"
              onClick={() => setSel(selToken.reservation(created.id))}
            >
              View reservation
            </Button>
            <Button className="flex-1 justify-center" onClick={() => setCreated(null)}>
              Book another
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-line px-5 pb-4 pt-4">
        <div className="flex items-baseline justify-between pr-8">
          <div className="microlabel">New reservation</div>
          <button
            onClick={() => {
              resetDraft()
              setCreateErrors([])
            }}
            className="font-mono text-[10px] uppercase tracking-[0.07em] text-faint hover:text-accent"
          >
            Reset
          </button>
        </div>
        <h2 className="mt-1.5 text-[15px] font-semibold leading-tight text-ink">Schedule a berth</h2>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        {/* type */}
        <div>
          <div className="microlabel mb-1.5">What are you scheduling?</div>
          <Segmented<'vessel' | 'event'>
            label="Reservation type"
            options={[
              { value: 'vessel', label: 'Vessel' },
              { value: 'event', label: 'Event' },
            ]}
            value={draft.type}
            onChange={(type) => setDraft({ type })}
          />
        </div>

        {/* identity */}
        {draft.type === 'vessel' ? (
          <div>
            <label className="microlabel mb-1.5 block" htmlFor="nr-vessel">
              Vessel
            </label>
            <select
              id="nr-vessel"
              className="field"
              value={draft.vesselId}
              onChange={(e) => setDraft({ vesselId: e.target.value })}
            >
              <option value="">Select a vessel…</option>
              {[...vessels]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.lengthFt != null ? ` — ${v.lengthFt} ft` : ' — length not on file'}
                  </option>
                ))}
            </select>

            {vessel && vessel.lengthFt != null && (
              <div className="mt-1.5 font-mono text-[11px] text-slate">
                {vessel.lengthFt} ft LOA
                {vessel.operator ? ` · ${vessel.operator}` : ''}
              </div>
            )}

            {vessel && vessel.lengthFt == null && (
              <div className="mt-2 border-l-2 border-ochre bg-event-bg/40 px-3 py-2.5">
                <div className="microlabel text-ochre">Length required</div>
                <p className="mt-1 text-[12px] leading-snug text-slate">
                  {vessel.name} has no recorded length. Berth compatibility can't be checked
                  until it's on file.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    className="field w-24"
                    placeholder="Length"
                    aria-label="Vessel length in feet"
                    value={lengthInput}
                    onChange={(e) => setLengthInput(e.target.value)}
                  />
                  <span className="font-mono text-[11px] text-slate">ft</span>
                  <Button
                    onClick={saveLength}
                    disabled={!(Number(lengthInput) > 0)}
                    className="h-8"
                  >
                    Save to vessel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="microlabel mb-1.5 block" htmlFor="nr-event">
              Event name
            </label>
            <input
              id="nr-event"
              className="field"
              placeholder="e.g. Community Sail Day"
              value={draft.eventName}
              onChange={(e) => setDraft({ eventName: e.target.value })}
            />
          </div>
        )}

        {/* dates */}
        <div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="microlabel mb-1.5 block" htmlFor="nr-start">
                {draft.type === 'vessel' ? 'Arrival' : 'Start'}
              </label>
              <input
                id="nr-start"
                type="date"
                className="field"
                value={draft.startDate}
                onChange={(e) => setDraft({ startDate: e.target.value })}
              />
            </div>
            <div>
              <label className="microlabel mb-1.5 block" htmlFor="nr-end">
                {draft.type === 'vessel' ? 'Departure' : 'End'}
              </label>
              <input
                id="nr-end"
                type="date"
                className="field"
                value={draft.endDate}
                onChange={(e) => setDraft({ endDate: e.target.value })}
              />
            </div>
          </div>
          {datesInverted && (
            <p className="mt-1.5 text-[12px] text-brick">Departure precedes arrival.</p>
          )}
          {duration != null && (
            <p className="mt-1.5 font-mono text-[11px] text-slate">
              Request · {duration} day{duration === 1 ? '' : 's'}
            </p>
          )}
        </div>

        {/* matching */}
        <div className="border border-line-strong bg-surface">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="microlabel">Matching berths</span>
            {evaln && (
              <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-slate">
                <span className="text-teal">{evaln.counts.available} available</span>
                {' · '}
                {evaln.counts.occupied} occupied
                {request?.kind === 'vessel' && (
                  <>
                    {' · '}
                    <span className="text-brick">{evaln.counts.tooShort} too short</span>
                  </>
                )}
              </span>
            )}
          </div>

          {!evaln ? (
            <p className="px-3 py-3 text-[12px] leading-snug text-faint">
              {draft.type === 'vessel'
                ? 'Select a vessel with a recorded length and valid dates to evaluate every berth.'
                : 'Set valid dates to evaluate berth availability.'}
            </p>
          ) : (
            <div>
              {evaln.results.map((res) => (
                <BerthResultRow
                  key={res.berth.id}
                  res={res}
                  isSelected={draft.berthId === res.berth.id}
                  isSuggested={
                    evaln.counts.available > 1 && evaln.suggestedBerthId === res.berth.id
                  }
                  isEvent={request?.kind === 'event'}
                  duration={duration ?? 0}
                  onSelect={() => setDraft({ berthId: res.berth.id })}
                  onInspect={() => setSel(selToken.berth(res.berth.id))}
                  onOpenReservation={(id) => setSel(selToken.reservation(id))}
                  onApplyWindow={(w) => setDraft({ startDate: w.startDate, endDate: w.endDate })}
                />
              ))}
            </div>
          )}
        </div>

        {/* selected berth */}
        {selected && selected.status === 'available' && (
          <div className="border border-line bg-panel px-3 py-2.5">
            <div className="microlabel">Selected berth</div>
            <div className="mt-1 text-[12.5px] font-medium text-ink">{selected.berth.name}</div>
            <div className="mt-0.5 font-mono text-[11px] text-slate">
              {selected.berth.maxLengthFt} ft max
              {selected.clearanceFt != null && ` · ${clearanceLabel(selected.clearanceFt)} clearance`}
            </div>
          </div>
        )}

        {/* notes */}
        <div>
          <label className="microlabel mb-1.5 block" htmlFor="nr-notes">
            Notes <span className="normal-case text-faint">(optional)</span>
          </label>
          <textarea
            id="nr-notes"
            rows={2}
            className="field h-auto resize-none py-1.5"
            placeholder="e.g. Requires shore power"
            value={draft.notes}
            onChange={(e) => setDraft({ notes: e.target.value })}
          />
        </div>
      </div>

      <div className="mt-auto border-t border-line px-5 py-4">
        {createErrors.length > 0 && (
          <div className="mb-2.5 border-l-2 border-brick bg-[#f4e8e4] px-3 py-2">
            {createErrors.map((e) => (
              <p key={e} className="text-[12px] leading-snug text-brick">
                {e}
              </p>
            ))}
          </div>
        )}
        <Button
          variant="primary"
          className="w-full justify-center"
          disabled={!canConfirm}
          onClick={confirm}
        >
          Confirm reservation
        </Button>
        {!canConfirm && (
          <p className="mt-2 text-center font-mono text-[10.5px] text-slate">· {blockers[0]}</p>
        )}
      </div>
    </div>
  )
}

/* ——————————————————————————————————————————————— */

function BerthResultRow({
  res,
  isSelected,
  isSuggested,
  isEvent,
  duration,
  onSelect,
  onInspect,
  onOpenReservation,
  onApplyWindow,
}: {
  res: BerthEvaluation
  isSelected: boolean
  isSuggested: boolean
  isEvent: boolean
  duration: number
  onSelect: () => void
  onInspect: () => void
  onOpenReservation: (id: string) => void
  onApplyWindow: (w: { startDate: string; endDate: string }) => void
}) {
  const selectable = res.status === 'available'
  const receded = res.status === 'too-short'
  const blocked = blockedLabel(res.blockedDays)

  return (
    <div className={`border-b border-line last:border-b-0 ${receded ? 'opacity-55' : ''}`}>
      <div
        className={`flex items-stretch ${isSelected ? 'bg-accent-wash shadow-[inset_2px_0_0_var(--color-accent)]' : ''}`}
      >
        <button
          onClick={selectable ? onSelect : undefined}
          disabled={!selectable}
          aria-pressed={selectable ? isSelected : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left ${
            selectable ? 'cursor-pointer hover:bg-[#f1efe7]' : 'cursor-default'
          } ${isSelected ? 'hover:bg-accent-wash' : ''}`}
        >
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-[12.5px] font-medium ${isSelected ? 'text-accent' : 'text-ink'}`}
            >
              {res.berth.name}
            </span>
            {isSuggested && (
              <span className="mt-0.5 block font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-teal">
                Suggested · smallest compatible
              </span>
            )}
          </span>

          <span className="w-16 shrink-0 text-right font-mono text-[11.5px]">
            {isEvent ? (
              <span className="text-slate">{res.berth.maxLengthFt} ft</span>
            ) : (
              <span className={res.clearanceFt != null && res.clearanceFt < 0 ? 'text-brick' : 'text-slate'}>
                {clearanceLabel(res.clearanceFt)}
              </span>
            )}
          </span>

          <span className="w-[92px] shrink-0 text-right">
            <span
              className={`block font-mono text-[9.5px] font-medium uppercase tracking-[0.07em] ${STATUS_CLASS[res.status]}`}
            >
              {STATUS_LABEL[res.status]}
            </span>
            {res.status === 'occupied' && blocked && (
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.05em] text-faint">
                {blocked}
              </span>
            )}
          </span>
        </button>

        <button
          onClick={onInspect}
          aria-label={`Inspect ${res.berth.name}`}
          title={`Inspect ${res.berth.name} — the booking draft is kept`}
          className="flex w-8 shrink-0 items-center justify-center border-l border-line text-faint hover:bg-[#f1efe7] hover:text-accent"
        >
          <ArrowUpRight size={13} aria-hidden />
        </button>
      </div>

      {/* conflict explanation + recovery */}
      {res.status === 'occupied' && (
        <div className="border-t border-line bg-panel px-3 py-2.5">
          {res.conflicts.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpenReservation(c.id)}
              className="group flex w-full items-baseline justify-between gap-2 py-0.5 text-left"
            >
              <span className="truncate text-[12px] font-medium text-ink group-hover:text-accent">
                {reservationTitle(c)}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-slate">
                {fmtRange(c.startDate, c.endDate)}
              </span>
            </button>
          ))}

          <p className="mt-1 text-[11.5px] leading-snug text-slate">
            {res.blockedDays.length === 1
              ? `1-day conflict — ${fmtDay(res.blockedDays[0])} is taken.`
              : `Overlaps your request by ${res.blockedDays.length} days (${blocked}).`}
          </p>

          {duration > 0 && duration <= 14 && (
            <AvailabilityStrip dayStates={res.dayStates} />
          )}

          {res.alternatives && (res.alternatives.earlier || res.alternatives.later) && (
            <div className="mt-2">
              <div className="microlabel mb-1">Nearest {duration}-day openings</div>
              <div className="flex flex-wrap gap-1.5">
                {res.alternatives.earlier && (
                  <button
                    onClick={() => onApplyWindow(res.alternatives!.earlier!)}
                    className="border border-line-strong bg-surface px-2 py-1 font-mono text-[10.5px] text-ink hover:border-accent hover:text-accent"
                    title="Apply these dates to the request"
                  >
                    ← {fmtRange(res.alternatives.earlier.startDate, res.alternatives.earlier.endDate)}
                  </button>
                )}
                {res.alternatives.later && (
                  <button
                    onClick={() => onApplyWindow(res.alternatives!.later!)}
                    className="border border-line-strong bg-surface px-2 py-1 font-mono text-[10.5px] text-ink hover:border-accent hover:text-accent"
                    title="Apply these dates to the request"
                  >
                    → {fmtRange(res.alternatives.later.startDate, res.alternatives.later.endDate)}
                  </button>
                )}
              </div>
              {res.alternatives.later && (
                <p className="mt-1 font-mono text-[10px] text-faint">
                  Earliest full opening · {fmtDay(res.alternatives.later.startDate)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* physical explanation for too-short berths */}
      {res.status === 'too-short' && res.clearanceFt != null && (
        <div className="px-3 pb-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-faint">
            Exceeds capacity by {Math.abs(res.clearanceFt)} ft
          </p>
        </div>
      )}
    </div>
  )
}

/** Tiny technical availability strip for the requested period. */
function AvailabilityStrip({ dayStates }: { dayStates: { date: string; occupied: boolean }[] }) {
  if (dayStates.length === 0) return null
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {dayStates.map((d) => (
          <div key={d.date} className="w-4 text-center" title={`${fmtDay(d.date)} — ${d.occupied ? 'occupied' : 'free'}`}>
            <div className="font-mono text-[8.5px] leading-none text-faint">{dayNum(d.date)}</div>
            <div
              className={`mx-auto mt-0.5 h-2 w-2 ${
                d.occupied ? 'bg-slate' : 'border border-line-strong bg-surface'
              }`}
            />
          </div>
        ))}
      </div>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
        ■ occupied · □ free
      </p>
    </div>
  )
}
