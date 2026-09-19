import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/**
 * One shared, fixed-position tooltip for timeline bars. Rendering it at the
 * app root avoids clipping inside the scroll container.
 */

interface TooltipState {
  x: number
  y: number
  content: ReactNode
}

interface TooltipApi {
  show: (x: number, y: number, content: ReactNode) => void
  hide: () => void
}

const TooltipCtx = createContext<TooltipApi>({ show: () => {}, hide: () => {} })

export function useTooltip() {
  return useContext(TooltipCtx)
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TooltipState | null>(null)

  const show = useCallback((x: number, y: number, content: ReactNode) => {
    setTip({ x, y, content })
  }, [])
  const hide = useCallback(() => setTip(null), [])

  return (
    <TooltipCtx.Provider value={{ show, hide }}>
      {children}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 max-w-[260px] -translate-x-1/2 -translate-y-full rounded-[4px] bg-ink px-2.5 py-2 text-[#f2f1ec] shadow-sm"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.content}
        </div>
      )}
    </TooltipCtx.Provider>
  )
}
