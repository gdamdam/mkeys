/*
 * ValueReadout — a monospace numeric display. Space Mono is the instrument's
 * "voice": every live value (note name, cents, Hz, BPM, bars) renders through
 * this so numbers feel instrument-grade and columns don't jitter.
 */
import type { ReactNode } from 'react'
import './ui.css'

export interface ValueReadoutProps {
  /** The value to show. Numbers are rendered as-is; format upstream if needed. */
  value: ReactNode
  /** Optional trailing unit (e.g. "Hz", "bpm", "¢"). Rendered dimmer + smaller. */
  unit?: string
  /** Optional label shown above the value (Space Grotesk eyebrow). */
  label?: string
  /** Colour intent. `glide` is reserved for live pitch; `ember` for armed. */
  tone?: 'default' | 'glide' | 'ember' | 'faint'
  /** Relative size. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ValueReadout({
  value,
  unit,
  label,
  tone = 'default',
  size = 'md',
  className,
}: ValueReadoutProps) {
  const cls = ['readout', `readout--${size}`, `readout--${tone}`, className]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={cls}>
      {label ? <span className="readout__label eyebrow">{label}</span> : null}
      <span className="readout__value">
        {/* tabular-nums via the mono face keeps the width stable as digits change */}
        <span className="readout__num">{value}</span>
        {unit ? <span className="readout__unit">{unit}</span> : null}
      </span>
    </span>
  )
}
