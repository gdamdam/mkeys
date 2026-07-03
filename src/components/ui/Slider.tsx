/*
 * Slider — a horizontal value control (macros, swing, volume). Built on a
 * native range input for free accessibility + keyboard, then restyled from
 * tokens with a filled track. The value renders through ValueReadout (mono).
 */
import { useId } from 'react'
import type { CSSProperties } from 'react'
import { ValueReadout } from './ValueReadout'
import './ui.css'

export interface SliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  /** Visible label (also the accessible name). */
  label: string
  /** Hide the label row visually but keep it for assistive tech. */
  hideLabel?: boolean
  /** Unit shown next to the readout (e.g. "%", "ms"). */
  unit?: string
  /** Format the numeric readout. Defaults to the raw value. */
  format?: (value: number) => string | number
  disabled?: boolean
  id?: string
  className?: string
}

export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  label,
  hideLabel = false,
  unit,
  format,
  disabled = false,
  id,
  className,
}: SliderProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const span = max - min
  // Fill percentage drives the gradient track (see ui.css --fill consumer).
  const fill = span > 0 ? ((value - min) / span) * 100 : 0
  const shown = format ? format(value) : value
  const cls = ['slider', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')
  const style = { '--fill': `${fill}%` } as CSSProperties

  return (
    <div className={cls}>
      <div className={hideLabel ? 'sr-only' : 'slider__head'}>
        <label className="slider__label eyebrow" htmlFor={inputId}>
          {label}
        </label>
        <ValueReadout value={shown} unit={unit} size="sm" />
      </div>
      <input
        id={inputId}
        className="slider__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={style}
        aria-label={hideLabel ? label : undefined}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
      />
    </div>
  )
}
