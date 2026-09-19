import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Inspector selection, encoded in the URL (`?sel=r:r-102`, `v:…`, `b:…`,
 * or `new`). Keeping it in the URL makes cross-page entity navigation a
 * plain link and keeps the inspector consistent on every screen.
 */

export type Selection =
  | { kind: 'reservation'; id: string }
  | { kind: 'vessel'; id: string }
  | { kind: 'berth'; id: string }
  | { kind: 'new' }
  | null

export function parseSel(token: string | null): Selection {
  if (!token) return null
  if (token === 'new') return { kind: 'new' }
  const [prefix, id] = token.split(':')
  if (!id) return null
  if (prefix === 'r') return { kind: 'reservation', id }
  if (prefix === 'v') return { kind: 'vessel', id }
  if (prefix === 'b') return { kind: 'berth', id }
  return null
}

export const selToken = {
  reservation: (id: string) => `r:${id}`,
  vessel: (id: string) => `v:${id}`,
  berth: (id: string) => `b:${id}`,
  new: 'new',
}

export function useSelection() {
  const [params, setParams] = useSearchParams()
  const sel = parseSel(params.get('sel'))

  const setSel = useCallback(
    (token: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (token) next.set('sel', token)
          else next.delete('sel')
          return next
        },
        { replace: false },
      )
    },
    [setParams],
  )

  return { sel, setSel }
}
