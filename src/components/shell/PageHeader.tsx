import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../ui'
import { selToken, useSelection } from '../../hooks/useSelection'

/**
 * Contextual page header. Every page carries the persistent primary action:
 * “+ New reservation”, which opens the reservation workflow panel.
 */
export function PageHeader({
  title,
  context,
  secondRow,
}: {
  title: string
  context?: ReactNode
  secondRow?: ReactNode
}) {
  const { setSel } = useSelection()
  return (
    <header className="shrink-0 border-b border-line bg-canvas px-6 pb-3.5 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-semibold leading-none tracking-[-0.01em] text-ink">
            {title}
          </h1>
          {context && <div className="mt-1.5 text-[12.5px] text-slate">{context}</div>}
        </div>
        <Button variant="primary" onClick={() => setSel(selToken.new)}>
          <Plus size={14} strokeWidth={2.25} aria-hidden />
          New reservation
        </Button>
      </div>
      {secondRow && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {secondRow}
        </div>
      )}
    </header>
  )
}
