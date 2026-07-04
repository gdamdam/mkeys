/**
 * Pure geometry math for horizontal-slide glide on the surface.
 *
 * Kept separate from the React interaction hook so the expression mapping is
 * node-testable with no DOM. Builds on surface/geometry + surface/glide: the
 * hook resolves the origin/target cells and their MIDI notes, then delegates the
 * continuous-pitch math here.
 */
import { quantizeGlide } from '../../surface/glide'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Signed horizontal offset of a normalized pointer x (0..1) from the CENTRE of
 * its origin column, measured in column-widths. 0 at the origin pad's centre;
 * +1 at the next column's centre; -1 at the previous column's centre. The sign
 * selects the glide direction; the magnitude drives the glide progress.
 */
export function slideColumnOffset(x: number, originCol: number, cols: number): number {
  const safeCols = cols > 0 ? cols : 1
  const fx = clamp(x, 0, 1) * safeCols
  return fx - (originCol + 0.5)
}

/** The adjacent-column pair a pointer sits between, and its progress across. */
export interface ColumnSpan {
  /** Column whose centre is at or left of the pointer. */
  from: number
  /** The next column right (equal to `from` at the last column). */
  to: number
  /** Progress from `from`'s centre toward `to`'s centre, 0..1. */
  t: number
}

/**
 * Resolve a normalized pointer x (0..1) to the pair of adjacent columns whose
 * centres bracket it, plus the fractional progress between those centres.
 *
 * This is the multi-note glide primitive: as a touch travels across the
 * surface, `from`/`to` walk column by column so the pitch passes through every
 * intermediate degree. Left of the first centre / right of the last centre the
 * span holds on the end column (t clamps to 0, or from == to).
 */
export function columnSpanAt(x: number, cols: number): ColumnSpan {
  const safeCols = cols > 0 ? cols : 1
  const fx = clamp(x, 0, 1) * safeCols - 0.5
  const from = clamp(Math.floor(fx), 0, safeCols - 1)
  const to = Math.min(from + 1, safeCols - 1)
  const t = clamp(fx - from, 0, 1)
  return { from, to, t }
}

/**
 * Fractional MIDI pitch for a slide from the origin pad toward a neighbour.
 *
 * `offset` is the signed column offset from {@link slideColumnOffset}; only its
 * magnitude (clamped to one column) is used for progress — the caller has
 * already chosen `targetMidi` by the offset's sign. When there is no neighbour
 * (grid edge) the caller passes `targetMidi === originMidi`, yielding no bend.
 */
export function glidePitch(
  originMidi: number,
  targetMidi: number,
  offset: number,
  quantize: number,
): number {
  const t = clamp(Math.abs(offset), 0, 1)
  return quantizeGlide(originMidi, targetMidi, t, quantize)
}
