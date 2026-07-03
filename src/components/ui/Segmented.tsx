/*
 * Segmented — a single-choice control rendered as a radio group (scale, arp
 * mode, chord mode, layout). Built on native radio inputs inside labels: arrow-
 * key navigation and form semantics come for free; we only restyle. The
 * selected segment earns the ember accent.
 *
 * Generic over the option value type so callers keep their string-union types.
 */
import { useId } from 'react'
import './ui.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Optional sub-label shown under the main label. */
  hint?: string
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  /** Group legend (also the accessible name). */
  label: string
  /** Visually hide the legend but keep it for assistive tech. */
  hideLabel?: boolean
  disabled?: boolean
  /** Radio group name; auto-generated if omitted. */
  name?: string
  className?: string
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  hideLabel = false,
  disabled = false,
  name,
  className,
}: SegmentedProps<T>) {
  const autoName = useId()
  const groupName = name ?? autoName
  const cls = ['segmented', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')

  return (
    <fieldset className={cls} disabled={disabled}>
      <legend className={hideLabel ? 'sr-only' : 'segmented__legend eyebrow'}>{label}</legend>
      <div className="segmented__row" role="presentation">
        {options.map((opt) => {
          const selected = opt.value === value
          const optCls = ['segmented__opt', selected ? 'is-active' : ''].filter(Boolean).join(' ')
          return (
            <label key={opt.value} className={optCls} data-selected={selected}>
              <input
                type="radio"
                name={groupName}
                value={opt.value}
                checked={selected}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
              />
              <span className="segmented__opt-label">{opt.label}</span>
              {opt.hint ? <span className="segmented__opt-hint">{opt.hint}</span> : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
