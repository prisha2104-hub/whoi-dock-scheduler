import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '../components/shell/PageHeader'
import { Timeline } from '../components/timeline/Timeline'
import { Button, IconButton, Segmented } from '../components/ui'
import { opsSummary } from '../data/queries'
import { useData } from '../data/store'
import {
  addDays,
  addMonths,
  daysInMonth,
  fmtRange,
  monthLong,
  startOfMonth,
  startOfWeek,
  todayISO,
  yearNum,
} from '../lib/dates'

type View = 'week' | 'month'

export function SchedulePage() {
  useData() // subscribe: ops summary and berth count react to created reservations
  const today = todayISO()
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(today)

  const startISO = view === 'month' ? startOfMonth(anchor) : startOfWeek(anchor)
  const days = view === 'month' ? daysInMonth(anchor) : 7
  const rangeLabel =
    view === 'month'
      ? `${monthLong(anchor)} ${yearNum(anchor)}`
      : fmtRange(startISO, addDays(startISO, 6), { year: true })

  const step = (dir: 1 | -1) => {
    setAnchor(view === 'month' ? addMonths(startOfMonth(anchor), dir) : addDays(startOfWeek(anchor), dir * 7))
  }

  const ops = opsSummary(today)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Waterfront Schedule"
        context="6 berths · continuous day view · click a bar or berth for details"
        secondRow={
          <>
            <div className="flex items-center gap-3 font-mono text-[11px] text-slate">
              <span className="microlabel">Today</span>
              <span className="flex items-center gap-1.5">
                <span className="h-[6px] w-[6px] rounded-full bg-accent" aria-hidden />
                {ops.occupied} occupied
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-[6px] w-[6px] rounded-full bg-teal" aria-hidden />
                {ops.available} available
              </span>
              <span className="text-faint">·</span>
              <span>
                {ops.arrivals} arrival{ops.arrivals === 1 ? '' : 's'}
              </span>
              <span>
                {ops.departures} departure{ops.departures === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="min-w-[132px] text-right text-[13px] font-medium text-ink">
                {rangeLabel}
              </span>
              <div className="flex items-center gap-1">
                <IconButton aria-label="Previous period" onClick={() => step(-1)}>
                  <ChevronLeft size={15} aria-hidden />
                </IconButton>
                <Button onClick={() => setAnchor(today)}>Today</Button>
                <IconButton aria-label="Next period" onClick={() => step(1)}>
                  <ChevronRight size={15} aria-hidden />
                </IconButton>
              </div>
              <Segmented<View>
                label="Timeline zoom"
                options={[
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                ]}
                value={view}
                onChange={setView}
              />
            </div>
          </>
        }
      />

      <div className="min-h-0 flex-1 px-6 py-4">
        <Timeline startISO={startISO} days={days} view={view} />
      </div>
    </div>
  )
}
