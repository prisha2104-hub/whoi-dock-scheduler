import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useSelection } from '../../hooks/useSelection'
import { ReservationInspector } from './ReservationInspector'
import { VesselInspector } from './VesselInspector'
import { BerthInspector } from './BerthInspector'
import { NewReservationPanel } from './NewReservationPanel'

/**
 * Right-hand inspection panel. Attached to the shell (not a floating modal)
 * so the schedule keeps its context while details are open. Selection lives
 * in the URL, so the panel behaves identically on every page.
 */
export function InspectorHost() {
  const { sel, setSel } = useSelection()

  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, setSel])

  if (!sel) return null

  return (
    <aside
      className="relative flex h-full w-[360px] shrink-0 flex-col border-l border-line-strong bg-surface"
      aria-label="Details panel"
    >
      <button
        onClick={() => setSel(null)}
        aria-label="Close panel"
        className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-[5px] text-slate hover:bg-[#f1efe7] hover:text-ink"
      >
        <X size={15} aria-hidden />
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sel.kind === 'reservation' && <ReservationInspector id={sel.id} />}
        {sel.kind === 'vessel' && <VesselInspector id={sel.id} />}
        {sel.kind === 'berth' && <BerthInspector id={sel.id} />}
        {sel.kind === 'new' && <NewReservationPanel />}
      </div>
    </aside>
  )
}

export function InspectorMissing({ label }: { label: string }) {
  return <div className="px-5 py-6 text-[12.5px] text-faint">{label} not found.</div>
}
