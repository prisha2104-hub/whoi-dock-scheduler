import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useData } from '../../data/store'
import { searchEntities } from '../../lib/search'
import { fmtBerthLength, fmtDay, fmtRange, todayISO } from '../../lib/dates'
import { reservationTitle } from '../../data/queries'
import { selToken } from '../../hooks/useSelection'

/**
 * Global search (Cmd/Ctrl+K): one compact palette over the live dataset.
 * Results are grouped by entity; selecting one navigates to that entity's
 * page with its inspector open. Search never touches the reservation draft,
 * so an in-progress booking survives any detour through search.
 */

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform ?? '')

const SearchCtx = createContext<{ openPalette: () => void }>({ openPalette: () => {} })

export function useSearchPalette() {
  return useContext(SearchCtx)
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <SearchCtx.Provider value={useMemo(() => ({ openPalette: () => setOpen(true) }), [])}>
      {children}
      {open && <Palette onClose={() => setOpen(false)} />}
    </SearchCtx.Provider>
  )
}

/* ——————————————————————————————————————————————— */

interface Item {
  key: string
  group: 'Vessels' | 'Berths' | 'Reservations'
  primary: string
  secondary?: string
  right?: string
  cancelled?: boolean
  go: () => void
}

function Palette({ onClose }: { onClose: () => void }) {
  const data = useData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const today = todayISO()

  const results = useMemo(() => searchEntities(query, data, today), [query, data, today])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const v of results.vessels) {
      out.push({
        key: `v-${v.id}`,
        group: 'Vessels',
        primary: v.name,
        secondary: v.operator,
        right: v.lengthFt != null ? `${v.lengthFt} ft` : 'length —',
        go: () => navigate(`/vessels?sel=${selToken.vessel(v.id)}`),
      })
    }
    for (const b of results.berths) {
      out.push({
        key: `b-${b.id}`,
        group: 'Berths',
        primary: b.name,
        right: fmtBerthLength(b.maxLengthFt),
        go: () => navigate(`/berths?sel=${selToken.berth(b.id)}`),
      })
    }
    for (const r of results.reservations) {
      const berth = data.berths.find((b) => b.id === r.berthId)
      out.push({
        key: `r-${r.id}`,
        group: 'Reservations',
        primary: reservationTitle(r),
        secondary: berth?.name,
        right: fmtRange(r.startDate, r.endDate),
        cancelled: r.status === 'cancelled',
        go: () => navigate(`/reservations?sel=${selToken.reservation(r.id)}`),
      })
    }
    return out
  }, [results, data.berths, navigate])

  // Clamp/reset the active row when the result set changes.
  useEffect(() => setActive(0), [query])

  const select = (item: Item) => {
    item.go()
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (items.length ? (a + 1) % items.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[active]
      if (item) select(item)
    }
  }

  // Keep the active row in view during keyboard navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let idx = -1
  const groups: Item['group'][] = ['Vessels', 'Berths', 'Reservations']

  return (
    <div
      className="fixed inset-0 z-40 bg-[rgba(31,42,56,0.18)]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      <div
        className="mx-auto mt-[12vh] w-[540px] max-w-[calc(100vw-32px)] border border-line-strong bg-surface shadow-[0_10px_30px_rgba(31,42,56,0.16)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-3.5">
          <Search size={14} className="shrink-0 text-faint" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vessels, berths, reservations…"
            aria-label="Search"
            className="h-11 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
          <span className="kbd">esc</span>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1">
          {query.trim() === '' ? (
            <p className="px-3.5 py-3 text-[12px] text-faint">
              Type to search — partial names work. Dates like “Sep 24” find reservations
              covering that day.
            </p>
          ) : items.length === 0 ? (
            <p className="px-3.5 py-3 text-[12px] text-faint">No matching records.</p>
          ) : (
            groups.map((group) => {
              const groupItems = items.filter((i) => i.group === group)
              if (groupItems.length === 0) return null
              return (
                <div key={group} className="pb-1">
                  <div className="microlabel px-3.5 pb-1 pt-2">
                    {group}
                    {group === 'Reservations' && results.dateMatch
                      ? ` · covering ${fmtDay(results.dateMatch)}`
                      : ''}
                  </div>
                  {groupItems.map((item) => {
                    idx++
                    const i = idx
                    return (
                      <button
                        key={item.key}
                        data-idx={i}
                        onClick={() => select(item)}
                        onMouseMove={() => setActive(i)}
                        className={`flex w-full items-center gap-3 px-3.5 py-[7px] text-left ${
                          i === active ? 'bg-accent-wash' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-[12.5px] font-medium ${
                              item.cancelled ? 'text-faint' : 'text-ink'
                            }`}
                          >
                            {item.primary}
                            {item.cancelled && (
                              <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.07em] text-brick">
                                Cancelled
                              </span>
                            )}
                          </span>
                          {item.secondary && (
                            <span className="block truncate text-[11px] text-slate">
                              {item.secondary}
                            </span>
                          )}
                        </span>
                        {item.right && (
                          <span className="shrink-0 font-mono text-[11px] text-slate">
                            {item.right}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
