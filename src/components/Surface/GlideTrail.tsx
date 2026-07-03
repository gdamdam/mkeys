/*
 * GlideTrail — the signature "spectral" moment: a luminous cool (--glide) trail
 * that follows each active touch as it slides between scale degrees, plus a small
 * per-touch live readout (note name + cents) in Space Mono.
 *
 * Pure presentation: it draws whatever touch state the Surface hands it and owns
 * no interaction logic. The trail is drawn in an SVG overlay in normalised
 * (0..1) surface coordinates so it lines up with the pad grid at any size; the
 * head dot + readout are HTML so they stay crisp and un-distorted.
 *
 * Motion is instrument feedback, so when the caller passes `showTrail={false}`
 * (prefers-reduced-motion) the fading trail is dropped entirely — only the
 * static head dot + readout remain.
 */
import { glideColor } from '../../styles/palette'
import { formatCents } from './notes'

/** One active touch, as the Surface projects it for the overlay. */
export interface TouchView {
  /** Stable per-touch id (the pointerId). */
  id: number
  /** Recent normalised (0..1) positions, oldest first; the fading trail. */
  points: ReadonlyArray<{ x: number; y: number }>
  /** Current normalised position (0..1) of the touch. */
  x: number
  y: number
  /** Live note name at the current (possibly glided) pitch, e.g. "C#4". */
  label: string
  /** Cents offset from the nearest semitone, [-50, +50]. */
  cents: number
}

export interface GlideTrailProps {
  touches: ReadonlyArray<TouchView>
  /** When false (reduced motion), the fading trail is omitted. */
  showTrail: boolean
}

/** Alpha ramp along the trail: faint at the tail, bright at the head. */
function segmentAlpha(index: number, count: number): number {
  if (count <= 1) return 0.75
  return 0.12 + (index / (count - 1)) * 0.68
}

export function GlideTrail({ touches, showTrail }: GlideTrailProps) {
  return (
    <>
      {showTrail ? (
        <svg
          className="surface__trails"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {touches.map((t) =>
            t.points.slice(1).map((p, i) => {
              const prev = t.points[i]
              return (
                <line
                  key={`${t.id}-${i}`}
                  x1={prev.x}
                  y1={prev.y}
                  x2={p.x}
                  y2={p.y}
                  stroke={glideColor(segmentAlpha(i + 1, t.points.length))}
                  strokeWidth={3}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )
            }),
          )}
        </svg>
      ) : null}

      <div className="surface__readouts" aria-hidden="true">
        {touches.map((t) => (
          <div
            key={t.id}
            className="surface__touch"
            style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
          >
            <span className="surface__touch-dot" />
            <span className="surface__touch-readout">
              {t.label} {formatCents(t.cents)}¢
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
