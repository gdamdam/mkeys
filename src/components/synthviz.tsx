/*
 * synthviz — small, live SVG diagrams that make the synth editor legible: they
 * show *what* a group of knobs does, not just its numbers. Each renders directly
 * from patch values, so turning a knob animates the picture (a pulse-width knob
 * visibly changes the square's duty, cutoff slides the filter knee, etc.).
 *
 * Pure presentation, theme-aware via CSS custom properties (see synthviz.css):
 * stroke = --viz-line (ember), fill = --viz-fill, guides = --viz-axis.
 */
import type { OscillatorParams } from '../types'

const CYCLES = 2

/** Build an SVG path for two cycles of an oscillator wave in the given box. */
function wavePath(wave: OscillatorParams['wave'], pw: number, W: number, H: number, pad: number): string {
  const x0 = pad
  const span = W - 2 * pad
  const mid = H / 2
  const amp = (H - 2 * pad) / 2
  const toX = (u: number): number => x0 + u * span // u in 0..1 across all cycles
  const toY = (v: number): number => mid - v * amp // v in -1..1

  if (wave === 'saw') {
    let d = `M ${toX(0)},${toY(-1)}`
    for (let c = 0; c < CYCLES; c++) {
      const u1 = (c + 1) / CYCLES
      d += ` L ${toX(u1)},${toY(1)} L ${toX(u1)},${toY(-1)}`
    }
    return d
  }
  if (wave === 'pulse') {
    const duty = Math.min(0.92, Math.max(0.08, pw))
    let d = `M ${toX(0)},${toY(1)}`
    for (let c = 0; c < CYCLES; c++) {
      const uEdge = (c + duty) / CYCLES
      const u1 = (c + 1) / CYCLES
      d += ` L ${toX(uEdge)},${toY(1)} L ${toX(uEdge)},${toY(-1)} L ${toX(u1)},${toY(-1)} L ${toX(u1)},${toY(1)}`
    }
    return d
  }
  if (wave === 'triangle') {
    const pts: string[] = []
    const N = CYCLES * 4
    for (let i = 0; i <= N; i++) {
      const ph = ((i / N) * CYCLES) % 1
      let v: number
      if (ph < 0.25) v = ph / 0.25
      else if (ph < 0.5) v = 1 - (ph - 0.25) / 0.25
      else if (ph < 0.75) v = -(ph - 0.5) / 0.25
      else v = -1 + (ph - 0.75) / 0.25
      pts.push(`${toX(i / N).toFixed(1)},${toY(v).toFixed(1)}`)
    }
    return 'M ' + pts.join(' L ')
  }
  // sine
  const pts: string[] = []
  const N = 44
  for (let i = 0; i <= N; i++) {
    const v = Math.sin((i / N) * CYCLES * 2 * Math.PI)
    pts.push(`${toX(i / N).toFixed(1)},${toY(v).toFixed(1)}`)
  }
  return 'M ' + pts.join(' L ')
}

export function WaveformIcon({
  wave,
  pulseWidth = 0.5,
  className,
}: {
  wave: OscillatorParams['wave']
  pulseWidth?: number
  className?: string
}) {
  const W = 60
  const H = 30
  return (
    <svg
      className={['synthviz', 'synthviz--wave', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="synthviz__line" d={wavePath(wave, pulseWidth, W, H, 4)} fill="none" />
    </svg>
  )
}

/** ADSR shape: attack ramp up, decay to sustain level, sustain hold, release down. */
export function EnvelopeGraph({
  attack,
  decay,
  sustain,
  release,
  max = 4,
  className,
}: {
  attack: number
  decay: number
  sustain: number
  release: number
  max?: number
  className?: string
}) {
  const W = 150
  const H = 54
  const pad = 6
  const top = pad
  const bot = H - pad
  const seg = 30 // px a full-scale time segment spans
  const hold = 26 // sustain plateau width
  const ax = pad + Math.min(1, attack / max) * seg
  const dx = ax + Math.min(1, decay / max) * seg
  const sy = bot - sustain * (bot - top)
  const rsx = dx + hold
  const rx = Math.min(W - pad, rsx + Math.min(1, release / max) * seg)
  const pts = `${pad},${bot} ${ax.toFixed(1)},${top} ${dx.toFixed(1)},${sy.toFixed(1)} ${rsx.toFixed(1)},${sy.toFixed(1)} ${rx.toFixed(1)},${bot}`
  return (
    <svg
      className={['synthviz', 'synthviz--env', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
    >
      <polygon className="synthviz__fill" points={pts} />
      <polyline className="synthviz__line" points={pts} fill="none" />
      <circle className="synthviz__node" cx={ax} cy={top} r="2.4" />
      <circle className="synthviz__node" cx={dx} cy={sy} r="2.4" />
      <circle className="synthviz__node" cx={rsx} cy={sy} r="2.4" />
    </svg>
  )
}

/** Low-pass response: flat passband, a resonance bump at cutoff, then roll-off. */
export function FilterCurve({
  cutoff,
  resonance,
  className,
}: {
  cutoff: number
  resonance: number
  className?: string
}) {
  const W = 150
  const H = 54
  const pad = 6
  const top = pad
  const bot = H - pad
  const minF = 20
  const maxF = 20000
  const clamped = Math.max(minF, Math.min(maxF, cutoff))
  const norm = (Math.log(clamped) - Math.log(minF)) / (Math.log(maxF) - Math.log(minF))
  const cx = pad + norm * (W - 2 * pad)
  const passY = top + (bot - top) * 0.42
  const peak = resonance * (passY - top) * 0.95
  const kneeL = Math.max(pad, cx - 12)
  const d =
    `M ${pad},${passY} L ${kneeL.toFixed(1)},${passY} ` +
    `Q ${(cx - 3).toFixed(1)},${passY} ${cx.toFixed(1)},${(passY - peak).toFixed(1)} ` +
    `Q ${(cx + 5).toFixed(1)},${(passY + (bot - passY) * 0.35).toFixed(1)} ${Math.min(W - pad, cx + 16).toFixed(1)},${bot} ` +
    `L ${W - pad},${bot}`
  return (
    <svg
      className={['synthviz', 'synthviz--filter', className].filter(Boolean).join(' ')}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
    >
      <line className="synthviz__axis" x1={cx} y1={top} x2={cx} y2={bot} />
      <path className="synthviz__line" d={d} fill="none" />
    </svg>
  )
}
