/*
 * Panel — a quiet section container: an eyebrow label, optional right-aligned
 * actions, and the section body. Chrome, so it stays neutral (never uses the
 * ember/glide accents) — the surface is the hero.
 */
import type { ReactNode } from 'react'
import './ui.css'

export interface PanelProps {
  /** Eyebrow label shown at the top-left. Omit for an unlabelled container. */
  title?: string
  /** Optional actions rendered top-right, aligned with the title. */
  actions?: ReactNode
  children: ReactNode
  /** Element to render as. Defaults to <section>. */
  as?: 'section' | 'div' | 'aside' | 'form'
  className?: string
}

export function Panel({ title, actions, children, as: Tag = 'section', className }: PanelProps) {
  const cls = ['panel', className].filter(Boolean).join(' ')
  return (
    <Tag className={cls}>
      {title || actions ? (
        <header className="panel__head">
          {title ? <span className="panel__title eyebrow">{title}</span> : <span />}
          {actions ? <div className="panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="panel__body">{children}</div>
    </Tag>
  )
}
