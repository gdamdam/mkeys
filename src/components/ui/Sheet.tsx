/*
 * Sheet — a modal bottom-sheet (mobile) / side-drawer that holds panels off the
 * playable surface. Portaled to <body>, focus-trapped, Escape- and scrim-
 * dismissable, locks background scroll, and restores focus to the trigger on
 * close. role="dialog" aria-modal.
 */
import { useCallback, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { IconButton } from './IconButton'
import { CloseIcon } from './icons'
import './ui.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  /** Heading shown in the sheet header (also the accessible name). */
  title?: string
  /** Which edge the sheet enters from. Defaults to bottom (mobile-first). */
  side?: 'bottom' | 'right' | 'left'
  children: ReactNode
  className?: string
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Sheet({ open, onClose, title, side = 'bottom', children, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const headingId = useId()

  // Remember the trigger so focus can return to it on close.
  useEffect(() => {
    if (open) restoreRef.current = document.activeElement as HTMLElement | null
  }, [open])

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Move focus into the sheet on open; restore it on close.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()
    return () => {
      restoreRef.current?.focus?.()
    }
  }, [open])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // Trap Tab within the panel.
      const panel = panelRef.current
      if (!panel) return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey && (activeEl === first || activeEl === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  if (!open) return null

  const cls = ['sheet', `sheet--${side}`, className].filter(Boolean).join(' ')

  return createPortal(
    <div className="sheet__root" onKeyDown={onKeyDown}>
      {/* Scrim: click to dismiss. Not focusable; the dialog owns the a11y tree. */}
      <div className="sheet__scrim" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={cls}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : undefined}
        aria-label={title ? undefined : 'Panel'}
        tabIndex={-1}
      >
        <header className="sheet__head">
          {/* Grab handle affordance for the bottom sheet. */}
          {side === 'bottom' ? <span className="sheet__grip" aria-hidden="true" /> : null}
          {title ? (
            <h2 className="sheet__title" id={headingId}>
              {title}
            </h2>
          ) : (
            <span />
          )}
          <IconButton label="Close" onClick={onClose} className="sheet__close">
            <CloseIcon size={18} />
          </IconButton>
        </header>
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
