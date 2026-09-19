import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '../components/shell/PageHeader'
import { SortableTh } from '../components/ui'
import { useData } from '../data/store'
import { currentForVessel, lastVisitForVessel, nextForVessel } from '../data/queries'
import { fmtDay, fmtRange, todayISO } from '../lib/dates'
import { selToken, useSelection } from '../hooks/useSelection'

type SortKey = 'name' | 'length' | 'operator'

export function VesselsPage() {
  const { vessels } = useData()
  const { sel, setSel } = useSelection()
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [asc, setAsc] = useState(true)
  const today = todayISO()

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = vessels.filter(
      (v) =>
        !q || v.name.toLowerCase().includes(q) || (v.operator?.toLowerCase().includes(q) ?? false),
    )
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'operator') return (a.operator ?? '\uffff').localeCompare(b.operator ?? '\uffff')
      return (a.lengthFt ?? -1) - (b.lengthFt ?? -1)
    })
    return asc ? sorted : sorted.reverse()
  }, [vessels, query, sortKey, asc])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAsc(!asc)
    else {
      setSortKey(key)
      setAsc(true)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Vessels" context="Vessel registry — lengths, operators and visit history" />

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="font-mono text-[11px] text-slate">
            {rows.length} of {vessels.length} vessels
          </div>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <input
              className="field w-64 pl-7"
              placeholder="Filter by name or operator…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter vessels"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border border-line-strong bg-surface">
          <table className="dt">
            <thead>
              <tr>
                <SortableTh label="Vessel" k="name" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
                <SortableTh label="Length" k="length" sortKey={sortKey} asc={asc} onToggle={toggleSort} className="w-24" />
                <SortableTh label="Operator" k="operator" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
                <th>Next reservation</th>
                <th>Last visit</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[12.5px] text-faint">
                    No matching vessels
                  </td>
                </tr>
              )}
              {rows.map((v) => {
                const current = currentForVessel(v.id, today)
                const next = nextForVessel(v.id, today)
                const last = lastVisitForVessel(v.id, today)
                return (
                  <tr
                    key={v.id}
                    data-selected={sel?.kind === 'vessel' && sel.id === v.id}
                    onClick={() => setSel(selToken.vessel(v.id))}
                  >
                    <td className="font-medium text-ink">{v.name}</td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-slate">
                      {v.lengthFt != null ? (
                        `${v.lengthFt} ft`
                      ) : (
                        <span className="text-faint" title="Length not on file">
                          —
                        </span>
                      )}
                    </td>
                    <td className="text-slate">{v.operator ?? '—'}</td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-slate">
                      {current ? (
                        <span className="text-teal">In port · until {fmtDay(current.endDate)}</span>
                      ) : next ? (
                        fmtDay(next.startDate)
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap font-mono text-[12px] text-slate">
                      {last ? fmtRange(last.startDate, last.endDate) : <span className="text-faint">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
