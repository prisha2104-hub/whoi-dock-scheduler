import { NavLink } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useData } from '../../data/store'
import { SOURCE_META } from '../../data/source'
import { IS_MAC, useSearchPalette } from '../search/SearchPalette'
import { fmtDayYear, todayISO } from '../../lib/dates'

export function Sidebar() {
  const { berths, vessels, reservations } = useData()
  const { openPalette } = useSearchPalette()

  const nav = [
    { to: '/', label: 'Schedule', count: null as number | null },
    { to: '/reservations', label: 'Reservations', count: reservations.length },
    { to: '/vessels', label: 'Vessels', count: vessels.length },
    { to: '/berths', label: 'Berths', count: berths.length },
  ]

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="px-5 pb-5 pt-6">
        <div className="text-[13px] font-semibold uppercase tracking-[0.18em] text-ink">
          Alongside
        </div>
        <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-slate">
          Harborview · Marine Ops
        </div>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={openPalette}
          className="flex h-8 w-full items-center gap-2 rounded-[5px] border border-line-strong bg-surface px-2.5 text-[12.5px] text-slate transition-colors hover:text-ink"
          aria-label="Open search"
        >
          <Search size={13} className="shrink-0 text-faint" aria-hidden />
          <span>Search</span>
          <span className="kbd ml-auto">{IS_MAC ? '⌘K' : 'Ctrl+K'}</span>
        </button>
      </div>

      <nav className="flex flex-col gap-px px-3" aria-label="Primary">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center justify-between rounded-[4px] px-2.5 py-[7px] text-[13px] transition-colors ${
                isActive
                  ? 'bg-[#e2dfd3] font-medium text-ink shadow-[inset_2px_0_0_var(--color-accent)]'
                  : 'text-slate hover:bg-[#e7e4da] hover:text-ink'
              }`
            }
          >
            <span>{item.label}</span>
            {item.count !== null && (
              <span className="font-mono text-[10.5px] text-faint">{item.count}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-line px-5 py-4">
        <div className="font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.08em] text-faint">
          <div className="flex justify-between gap-2">
            <span>Op date</span>
            <span className="text-slate">{fmtDayYear(todayISO())}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <span>Source</span>
            <span className="text-slate">{SOURCE_META.yearRange}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <span>Records</span>
            <span className="text-slate">{reservations.length.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
