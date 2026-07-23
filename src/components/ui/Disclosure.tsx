/*
 * Disclosure — a collapsible, card-styled section built on native <details>.
 *
 * Used to group the merged control panel into tidy sections that the player
 * expands only as needed. Open/closed state is remembered per `id` in
 * localStorage, so a layout you arrange survives reloads. The title lives in the
 * clickable summary; the wrapped children are the section's controls (they must
 * NOT repeat the title).
 */
import { useCallback, useState } from 'react'
import type { ReactNode, SyntheticEvent } from 'react'

const storeKey = (id: string): string => `mkeys.disclosure.${id}`

/** Read the remembered open state, falling back to `defaultOpen`. */
function initialOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem(storeKey(id))
    return v === null ? defaultOpen : v === '1'
  } catch {
    // Private-mode / disabled storage — just use the default.
    return defaultOpen
  }
}

export interface DisclosureProps {
  /** Stable id used to persist the open/closed state. */
  id: string
  /** Section heading shown in the summary bar. */
  title: string
  /** Whether the section starts open the first time (before any user toggle). */
  defaultOpen?: boolean
  children: ReactNode
}

export function Disclosure({ id, title, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(() => initialOpen(id, defaultOpen))

  const onToggle = useCallback(
    (e: SyntheticEvent<HTMLDetailsElement>): void => {
      const next = e.currentTarget.open
      setOpen(next)
      try {
        localStorage.setItem(storeKey(id), next ? '1' : '0')
      } catch {
        // Ignore storage failures — the in-memory state still works this session.
      }
    },
    [id],
  )

  return (
    <details className="disclosure" open={open} onToggle={onToggle}>
      <summary className="disclosure__summary">
        <span className="pgroup__title eyebrow">{title}</span>
        <span className="disclosure__chevron" aria-hidden="true" />
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  )
}
