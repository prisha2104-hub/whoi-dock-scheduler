import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react'

/* ——— Buttons ——— */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
}

export function Button({ variant = 'ghost', className = '', ...rest }: ButtonProps) {
  const base =
    'inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45'
  const styles =
    variant === 'primary'
      ? 'bg-accent text-[#f6f8fa] hover:bg-accent-deep'
      : 'border border-line-strong bg-surface text-ink hover:bg-[#f1efe7]'
  return <button className={`${base} ${styles} ${className}`} {...rest} />
}

export function IconButton({ className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-line-strong bg-surface text-slate transition-colors hover:bg-[#f1efe7] hover:text-ink ${className}`}
      {...rest}
    />
  )
}

/* ——— Segmented control ——— */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-8 items-center gap-0.5 rounded-[6px] border border-line-strong bg-surface p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`h-[26px] rounded-[4px] px-2.5 text-[12px] transition-colors ${
            o.value === value
              ? 'bg-accent-wash font-medium text-accent'
              : 'text-slate hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ——— Sortable table header ——— */

export function SortableTh<K extends string>({
  label,
  k,
  sortKey,
  asc,
  onToggle,
  className = '',
}: {
  label: string
  k: K
  sortKey: K
  asc: boolean
  onToggle: (k: K) => void
  className?: string
}) {
  const active = sortKey === k
  return (
    <th className={className} aria-sort={active ? (asc ? 'ascending' : 'descending') : undefined}>
      <button
        onClick={() => onToggle(k)}
        className="inline-flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-slate hover:text-ink"
      >
        {label}
        {active && (asc ? <ChevronUp size={11} aria-hidden /> : <ChevronDown size={11} aria-hidden />)}
      </button>
    </th>
  )
}

/* ——— Status / type chips ——— */

const chipStyles = {
  teal: 'border-[#bcd4cb] bg-[#e8f0eb] text-teal',
  brick: 'border-[#e0c4bd] bg-[#f4e8e4] text-brick',
  vessel: 'border-vessel-line bg-vessel-bg text-vessel-text',
  event: 'border-event-line bg-event-bg text-event-text',
  slate: 'border-line-strong bg-panel text-slate',
} as const

export function Chip({
  tone,
  children,
  dot = false,
}: {
  tone: keyof typeof chipStyles
  children: ReactNode
  dot?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-px font-mono text-[10px] font-medium uppercase tracking-[0.07em] ${chipStyles[tone]}`}
    >
      {dot && <span className="h-[5px] w-[5px] rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

/* ——— Inspector building blocks ——— */

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="microlabel mb-2">{children}</div>
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="microlabel mb-1">{label}</div>
      <div className="text-[13px] leading-snug text-ink">{children}</div>
    </div>
  )
}

/** Quiet row link used for related-entity navigation inside inspectors. */
export function RowLink({
  primary,
  secondary,
  onClick,
}: {
  primary: ReactNode
  secondary?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center justify-between gap-3 border-b border-line px-1 py-2 text-left last:border-b-0 hover:bg-[#f1efe7]"
    >
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-ink group-hover:text-accent">
          {primary}
        </span>
        {secondary && (
          <span className="mt-0.5 block truncate font-mono text-[11px] text-slate">{secondary}</span>
        )}
      </span>
      <ArrowUpRight size={13} className="shrink-0 text-faint group-hover:text-accent" aria-hidden />
    </button>
  )
}

/** Inline entity link (e.g. berth name inside a sentence or KV value). */
export function EntityLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-0.5 text-[13px] font-medium text-accent hover:underline"
    >
      {children}
      <ArrowUpRight size={12} aria-hidden />
    </button>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <div className="py-2 text-[12.5px] text-faint">{children}</div>
}
