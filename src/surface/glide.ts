/**
 * Glide quantization curve for horizontal slide gestures.
 *
 * A slide moves a touch between two scale degrees. `quantizeGlide` maps the
 * normalised slide progress `t` (0..1) to a fractional MIDI pitch, blending
 * between a continuous glissando and a stepped, snap-to-degree transition. The
 * `quantize` amount (0..1) shapes an easing curve that, as it rises, flattens
 * the pitch near the endpoints (holding on each degree) and steepens the
 * transition through the midpoint until it becomes a near-instant step.
 *
 * Pure module: no imports beyond the shared type contract, no side effects.
 */

/**
 * Steepness of the transition at full quantization. Chosen so the quarter
 * points (t = 0.25 / 0.75) sit within a tiny fraction of a semitone of their
 * anchoring degree, reading musically as "stepped" while remaining continuous
 * and differentiable everywhere except in the limit.
 */
const MAX_STEEPNESS = 40

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Symmetric power easing on [0,1] with e(0)=0, e(0.5)=0.5, e(1)=1.
 *
 * `exponent` = 1 yields the identity (linear glissando); larger exponents bow
 * the curve flat near the endpoints and steep across the middle, approaching a
 * midpoint step as the exponent grows. The curve satisfies e(t)+e(1-t)=1, which
 * makes the glide reversible (A→B mirrors B→A).
 */
function easeStep(t: number, exponent: number): number {
  if (t < 0.5) {
    return 0.5 * Math.pow(2 * t, exponent)
  }
  return 1 - 0.5 * Math.pow(2 * (1 - t), exponent)
}

/**
 * Fractional MIDI pitch at slide progress `t` between two scale degrees.
 *
 * @param fromMidi     MIDI note of the origin degree.
 * @param toMidi       MIDI note of the destination degree.
 * @param t            Slide progress, 0..1 (clamped).
 * @param quantizeAmount 0 = continuous linear glissando, 1 = stepped snap at the
 *                       midpoint (clamped).
 * @returns A pitch within `[min(fromMidi,toMidi), max(fromMidi,toMidi)]`, equal
 *          to `fromMidi` at t=0 and `toMidi` at t=1 for any quantize amount.
 */
export function quantizeGlide(
  fromMidi: number,
  toMidi: number,
  t: number,
  quantizeAmount: number,
): number {
  const progress = clamp01(t)
  const quantize = clamp01(quantizeAmount)
  const exponent = 1 + quantize * (MAX_STEEPNESS - 1)
  const eased = easeStep(progress, exponent)
  return fromMidi + (toMidi - fromMidi) * eased
}

/**
 * Snap a (possibly fractional) MIDI pitch to the nearest value in a degree set.
 *
 * The degree set need not be sorted. Exact ties resolve to the lower degree for
 * deterministic behaviour. An empty set leaves the input unchanged.
 *
 * @param midi        The pitch to snap.
 * @param degreeMidis Allowed degree pitches (MIDI note numbers).
 */
export function snapToDegree(midi: number, degreeMidis: readonly number[]): number {
  if (degreeMidis.length === 0) {
    return midi
  }
  let best = degreeMidis[0]
  let bestDist = Math.abs(midi - best)
  for (let i = 1; i < degreeMidis.length; i++) {
    const d = degreeMidis[i]
    const dist = Math.abs(midi - d)
    if (dist < bestDist || (dist === bestDist && d < best)) {
      best = d
      bestDist = dist
    }
  }
  return best
}
