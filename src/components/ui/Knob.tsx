/*
 * Knob — a rotary control (role="slider") for continuous params. Three input
 * paths, all mapped to the same value: vertical pointer-drag, arrow/Page/Home/
 * End keys, and mouse wheel. Shows a label + a mono value/unit readout. The
 * value ring uses the ember accent; the dial itself stays neutral.
 *
 * Pure-ish: fully controlled; the parent owns `value`.
 */
import { useCallback, useEffect, useId, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import './ui.css'

export interface KnobProps {
  value: number
  min?: number
  max?: number
  /** Increment for keys/wheel; defaults to 1% of the range. */
  step?: number
  onChange: (value: number) => void
  /** Visible label (also the accessible name). */
  label: string
  /** Hover tooltip explaining what the control does. */
  hint?: string
  /** Unit shown after the value (e.g. "Hz", "%"). */
  unit?: string
  /** Format the numeric readout + aria-valuetext. Defaults to rounded value. */
  format?: (value: number) => string | number
  /** Dial diameter in px. */
  size?: number
  disabled?: boolean
  id?: string
  className?: string
}

const SWEEP = 270 // degrees of travel; gap of 90° at the bottom
const START = 135 // starting angle (lower-left), sweeping clockwise
const DRAG_RANGE_PX = 180 // vertical px for a full min→max drag

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Snap to the step grid anchored at `min`, avoiding float drift. */
function quantize(v: number, min: number, step: number): number {
  if (step <= 0) return v
  const snapped = Math.round((v - min) / step) * step + min
  // Round to the step's decimal precision so we don't emit 0.30000000004.
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number(snapped.toFixed(decimals))
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

export function Knob({
  value,
  min = 0,
  max = 1,
  step,
  onChange,
  label,
  hint,
  unit,
  format,
  size = 56,
  disabled = false,
  id,
  className,
}: KnobProps) {
  const autoId = useId()
  const knobId = id ?? autoId
  const span = max - min
  const stepSize = step ?? (span > 0 ? span / 100 : 1)
  const pageStep = stepSize * 10

  const frac = span > 0 ? clamp((value - min) / span, 0, 1) : 0
  const shown = format ? format(value) : Math.round(value * 100) / 100
  const valueText = `${shown}${unit ? ` ${unit}` : ''}`

  // --- geometry ---
  const stroke = Math.max(3, Math.round(size * 0.09))
  const r = (size - stroke) / 2 - 1
  const c = size / 2
  const trackPath = arcPath(c, c, r, START, START + SWEEP)
  const valAngle = START + SWEEP * frac
  const valuePath = frac > 0.0005 ? arcPath(c, c, r, START, valAngle) : ''
  const [nx, ny] = polar(c, c, r, valAngle)
  const [ni, nyi] = polar(c, c, r * 0.42, valAngle)

  const emit = useCallback(
    (next: number) => {
      if (disabled) return
      const clamped = clamp(next, min, max)
      const q = quantize(clamped, min, stepSize)
      if (q !== value) onChange(clamp(q, min, max))
    },
    [disabled, min, max, stepSize, value, onChange],
  )

  // --- pointer drag (vertical: up = increase) ---
  const drag = useRef<{ startY: number; startVal: number } | null>(null)

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { startY: e.clientY, startVal: value }
    },
    [disabled, value],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current
      if (!d || span <= 0) return
      const dy = d.startY - e.clientY // up is positive
      const delta = (dy / DRAG_RANGE_PX) * span
      emit(d.startVal + delta)
    },
    [emit, span],
  )

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowRight':
          e.preventDefault()
          emit(value + stepSize)
          break
        case 'ArrowDown':
        case 'ArrowLeft':
          e.preventDefault()
          emit(value - stepSize)
          break
        case 'PageUp':
          e.preventDefault()
          emit(value + pageStep)
          break
        case 'PageDown':
          e.preventDefault()
          emit(value - pageStep)
          break
        case 'Home':
          e.preventDefault()
          emit(min)
          break
        case 'End':
          e.preventDefault()
          emit(max)
          break
        default:
          break
      }
    },
    [disabled, emit, value, stepSize, pageStep, min, max],
  )

  // Wheel must not scroll the page while adjusting; attach non-passive so
  // preventDefault takes effect (React's onWheel is passive by default).
  const dialRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = dialRef.current
    if (!el || disabled) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      emit(value + (e.deltaY < 0 ? stepSize : -stepSize))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [emit, value, stepSize, disabled])

  const cls = ['knob', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')

  return (
    <div className={cls} title={hint}>
      <div
        ref={dialRef}
        className="knob__dial touch-none"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-description={hint}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        aria-orientation="vertical"
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <path
            className="knob__track"
            d={trackPath}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          {valuePath ? (
            <path
              className="knob__value"
              d={valuePath}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          ) : null}
          <line
            className="knob__notch"
            x1={ni}
            y1={nyi}
            x2={nx}
            y2={ny}
            strokeWidth={Math.max(2, stroke * 0.55)}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="knob__meta">
        <span className="knob__label eyebrow" id={`${knobId}-label`}>
          {label}
        </span>
        <span className="knob__readout">
          <span className="knob__num">{shown}</span>
          {unit ? <span className="knob__unit">{unit}</span> : null}
        </span>
      </div>
    </div>
  )
}
