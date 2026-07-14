/*
 * Select — a styled single-choice dropdown (key, division, preset category).
 * Native <select> can't be styled cross-browser, so this is a custom listbox
 * built to the WAI-ARIA combobox/listbox pattern: a trigger button + a popup
 * list with roving `aria-activedescendant`, full keyboard support (arrows,
 * Home/End, Enter/Space, Escape, typeahead), outside-click close, and focus
 * return. Optional groups render as labelled sections (for preset categories).
 *
 * Generic over the value type so callers keep their string-union types.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon } from './icons'
import './ui.css'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** Optional group heading; consecutive same-group options cluster together. */
  group?: string
  disabled?: boolean
}

export interface SelectProps<T extends string> {
  options: ReadonlyArray<SelectOption<T>>
  value: T
  onChange: (value: T) => void
  /** Eyebrow label above the control (also the accessible name). */
  label?: string
  /** Shown when `value` matches no option. */
  placeholder?: string
  disabled?: boolean
  /** Hover tooltip explaining what the control does. */
  title?: string
  id?: string
  className?: string
}

export function Select<T extends string>({
  options,
  value,
  onChange,
  label,
  placeholder = 'Select…',
  disabled = false,
  title,
  id,
  className,
}: SelectProps<T>) {
  const autoId = useId()
  const baseId = id ?? autoId
  const listId = `${baseId}-list`
  const labelId = label ? `${baseId}-label` : undefined

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef({ query: '', at: 0 })
  // Where the current pointer went down on an option, to tell a tap from a
  // touch-scroll: only a near-stationary release commits (see M10).
  const optionDown = useRef<{ x: number; y: number } | null>(null)

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  // Whether to render grouped sections.
  const grouped = useMemo(() => options.some((o) => o.group), [options])
  const optId = (i: number) => `${baseId}-opt-${i}`

  const openList = useCallback(() => {
    if (disabled) return
    setActive(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }, [disabled, selectedIndex])

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  const commit = useCallback(
    (i: number) => {
      const opt = options[i]
      if (!opt || opt.disabled) return
      onChange(opt.value)
      close(true)
    },
    [options, onChange, close],
  )

  /** Move the active option by delta, skipping disabled entries. */
  const move = useCallback(
    (delta: number) => {
      const n = options.length
      if (n === 0) return
      let i = active
      for (let hop = 0; hop < n; hop++) {
        i = (i + delta + n) % n
        if (!options[i]?.disabled) break
      }
      setActive(i)
    },
    [active, options],
  )

  const edge = useCallback(
    (dir: 'first' | 'last') => {
      const n = options.length
      const order = dir === 'first' ? [...Array(n).keys()] : [...Array(n).keys()].reverse()
      const found = order.find((i) => !options[i]?.disabled)
      if (found !== undefined) setActive(found)
    },
    [options],
  )

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return
    const el = document.getElementById(optId(active))
    el?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  // Move focus into the list on open so keys route there.
  useEffect(() => {
    if (open) listRef.current?.focus()
  }, [open])

  // Close on outside pointer.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        edge('first')
        break
      case 'End':
        e.preventDefault()
        edge('last')
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(active)
        break
      case 'Escape':
        e.preventDefault()
        close(true)
        break
      case 'Tab':
        close(false)
        break
      default: {
        // Typeahead: jump to the next option whose label starts with the typed run.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now()
          const ta = typeahead.current
          ta.query = now - ta.at > 600 ? e.key : ta.query + e.key
          ta.at = now
          const q = ta.query.toLowerCase()
          const from = ta.query.length === 1 ? active + 1 : active
          for (let hop = 0; hop < options.length; hop++) {
            const i = (from + hop) % options.length
            const o = options[i]
            if (!o.disabled && o.label.toLowerCase().startsWith(q)) {
              setActive(i)
              break
            }
          }
        }
      }
    }
  }

  const onButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openList()
    }
  }

  const cls = ['select', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')

  // Precompute group boundaries for rendering.
  const renderOption = (opt: SelectOption<T>, i: number) => {
    const isActive = i === active
    const isSelected = i === selectedIndex
    const oCls = [
      'select__opt',
      isActive ? 'is-active' : '',
      isSelected ? 'is-selected' : '',
      opt.disabled ? 'is-disabled' : '',
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <li
        key={opt.value}
        id={optId(i)}
        role="option"
        aria-selected={isSelected}
        aria-disabled={opt.disabled || undefined}
        className={oCls}
        // Record the down position but DON'T commit or preventDefault here, so a
        // swipe can scroll a long list. Commit happens on a stationary release.
        onPointerDown={(e) => {
          optionDown.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={(e) => {
          const start = optionDown.current
          optionDown.current = null
          if (!start) return
          const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
          // A drag (scroll) moves the finger; only a tap commits.
          if (moved <= 10) {
            e.preventDefault()
            commit(i)
          }
        }}
        onPointerCancel={() => {
          optionDown.current = null
        }}
        onPointerEnter={() => !opt.disabled && setActive(i)}
      >
        <span className="select__opt-label">{opt.label}</span>
        {isSelected ? <CheckIcon size={16} className="select__opt-check" /> : null}
      </li>
    )
  }

  return (
    <div className={cls} ref={rootRef} title={title}>
      {label ? (
        <span className="select__label eyebrow" id={labelId}>
          {label}
        </span>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className="select__button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKeyDown}
      >
        <span className={selected ? 'select__value' : 'select__value select__value--empty'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon size={16} className="select__caret" />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={optId(active)}
          className="select__list"
          onKeyDown={onListKeyDown}
        >
          {grouped
            ? renderGrouped(options, renderOption)
            : options.map((opt, i) => renderOption(opt, i))}
        </ul>
      ) : null}
    </div>
  )
}

/** Render options clustered under their group headings, preserving indices. */
function renderGrouped<T extends string>(
  options: ReadonlyArray<SelectOption<T>>,
  renderOption: (opt: SelectOption<T>, i: number) => React.ReactNode,
): React.ReactNode {
  const blocks: React.ReactNode[] = []
  let cursor = 0
  while (cursor < options.length) {
    const group = options[cursor].group
    const items: React.ReactNode[] = []
    const startGroup = group
    while (cursor < options.length && options[cursor].group === startGroup) {
      items.push(renderOption(options[cursor], cursor))
      cursor++
    }
    blocks.push(
      <li key={`grp-${startGroup ?? 'none'}-${cursor}`} role="presentation" className="select__group">
        {startGroup ? <span className="select__group-label eyebrow">{startGroup}</span> : null}
        <ul role="presentation" className="select__group-list">
          {items}
        </ul>
      </li>,
    )
  }
  return blocks
}
