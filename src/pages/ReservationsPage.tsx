import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '../components/shell/PageHeader'
import { Chip, EmptyNote, Segmented, SortableTh } from '../components/ui'
import { useData } from '../data/store'
import { berthById, reservationDays, reservationTitle } from '../data/queries'
import { fmtRange, todayISO } from '../lib/dates'
import { selToken, useSelection } from '../hooks/useSelection'

type Tab = 'upcoming' | 'past' | 'cancelled'
type TypeFilter = 'all' | 'vessel' | 'event'
type SortKey = 'date' | 'name' | 'berth'

export function ReservationsPage() {
  const { reservations, berths } = useData()
  const { sel, setSel } = useSelection()
  const [tab, setTabState] = useState<Tab>('upcoming')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [berthFilter, setBerthFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [asc, setAsc] = useState(true)
  const today = todayISO()

  // Tab changes restore the operationally sensible default ordering.
  const setTab = (t: Tab) => {
    setTabState(t)
    setSortKey('date')
    setAsc(t !== 'past')
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAsc(!asc)
    else {
      setSortKey(key)
      setAsc(true)
    }
  }

  const buckets = useMemo(() => {
    const active = reservations.filter((r) => r.status === 'active')
    return {
      upcoming: active.filter((r) => r.endDate >= today),
      past: active.filter((r) => r.endDate < today),
      cancelled: reservations.filter((r) => r.status === 'cancelled'),
    }
  }, [reservations, today])

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const filtered = buckets[tab].filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      if (berthFilter && r.berthId !== berthFilter) return false
      if (!q) return true
      return (
        reservationTitle(r).toLowerCase().includes(q) ||
        (berthById(r.berthId)?.name.toLowerCase().includes(q) ?? false)
      )
    })
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'name') return reservationTitle(a).localeCompare(reservationTitle(b))
      if (sortKey === 'berth')
        return (berthById(a.berthId)?.name ?? '').localeCompare(berthById(b.berthId)?.name ?? '')
      return a.startDate.localeCompare(b.startDate)
    })
    return asc ? sorted : sorted.reverse()
  }, [buckets, tab, typeFilter, berthFilter, q, sortKey, asc])

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'upcoming', label: 'Upcoming', count: buckets.upcoming.length },
    { key: 'past', label: 'Past', count: buckets.past.length },
    { key: 'cancelled', label: 'Cancelled', count: buckets.cancelled.length },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Reservations" context="Every berth hold — vessel calls and waterfront events" />

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <div className="mb-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 border-b border-line" role="tablist" aria-label="Reservation filters">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] transition-colors ${
                  tab === t.key
                    ? 'border-accent font-medium text-ink'
                    : 'border-transparent text-slate hover:text-ink'
                }`}
              >
                {t.label}
                <span className="font-mono text-[10.5px] text-faint">{t.count}</span>
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <input
              className="field w-64 pl-7"
              placeholder="Filter by name or berth…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter reservations"
            />
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2.5">
          <Segmented<TypeFilter>
            label="Type filter"
            options={[
              { value: 'all', label: 'All' },
              { value: 'vessel', label: 'Vessels' },
              { value: 'event', label: 'Events' },
            ]}
            value={typeFilter}
            onChange={setTypeFilter}
          />
          <select
            className="field w-44"
            value={berthFilter}
            onChange={(e) => setBerthFilter(e.target.value)}
            aria-label="Filter by berth"
          >
            <option value="">All berths</option>
            {berths.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="ml-auto font-mono text-[11px] text-slate">
            {rows.length} record{rows.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border border-line-strong bg-surface">
          {rows.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <EmptyNote>No reservations found for this filter</EmptyNote>
            </div>
          ) : (
            <table className="dt">
              <thead>
                <tr>
                  <SortableTh label="Reservation" k="name" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
                  <th>Type</th>
                  <SortableTh label="Berth" k="berth" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
                  <SortableTh label="Dates" k="date" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
                  <th className="text-right">Days</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = reservationDays(r)
                  return (
                    <tr
                      key={r.id}
                      data-selected={sel?.kind === 'reservation' && sel.id === r.id}
                      onClick={() => setSel(selToken.reservation(r.id))}
                    >
                      <td className="font-medium text-ink">{reservationTitle(r)}</td>
                      <td>
                        <Chip tone={r.type === 'vessel' ? 'vessel' : 'event'}>
                          {r.type === 'vessel' ? 'Vessel' : 'Event'}
                        </Chip>
                      </td>
                      <td className="text-slate">{berthById(r.berthId)?.name ?? '—'}</td>
                      <td className="whitespace-nowrap font-mono text-[12px] text-slate">
                        {fmtRange(r.startDate, r.endDate, { year: true })}
                      </td>
                      <td className="text-right font-mono text-[12px] text-slate">{d}</td>
                      <td>
                        {r.status === 'active' ? (
                          <Chip tone="teal" dot>
                            Confirmed
                          </Chip>
                        ) : (
                          <Chip tone="brick" dot>
                            Cancelled
                          </Chip>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
