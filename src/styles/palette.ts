/*
 * palette.ts — scale-degree-as-colour, the signature of the "spectral surface".
 *
 * Each playable pad is tinted by its position within the current scale. The hue
 * rotates smoothly across the degrees of the scale (a cohesive risograph-like
 * spectrum, NOT a garish full-saturation rainbow); the tonic is emphasised
 * (brighter + more saturated) so the "home" note reads at a glance, and an
 * actively-held pad brightens further. All chrome stays neutral so this remains
 * the one bold, memorable element on screen.
 *
 * Pure module: no imports, deterministic, safe to call in render.
 */

/** Tuning constants for the spectrum. Muted saturation + mid-light keeps the
 * surface cohesive; tonic/active nudges stay within a tasteful range. */
const HUE_BASE = 20 // warm anchor near --ember, so degree 0 leans warm
const HUE_SPAN = 300 // sweep most of the wheel, but stop short of a full loop
const SAT_BASE = 52 // within the 45–60% "muted" band
const LIGHT_BASE = 57
const TONIC_SAT_BOOST = 14
const TONIC_LIGHT_BOOST = 9
const ACTIVE_SAT_BOOST = 10
const ACTIVE_LIGHT_BOOST = 13

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Round to 1 decimal for stable, deterministic string output. */
const r1 = (v: number): number => Math.round(v * 10) / 10

export interface DegreeColorOpts {
  /** The scale root — emphasised with more saturation + lightness. */
  tonic?: boolean
  /** Currently held/sounding — brightened further so touch feels responsive. */
  active?: boolean
}

/**
 * Colour for a pad at `indexInScale` of a scale with `scaleLength` degrees.
 * Returns an `hsl(...)` string. Deterministic for the same inputs.
 *
 * @param indexInScale zero-based position within the scale (wraps if out of range)
 * @param scaleLength  number of degrees in the scale (>= 1; coerced otherwise)
 */
export function degreeColor(
  indexInScale: number,
  scaleLength: number,
  opts: DegreeColorOpts = {},
): string {
  // Guard against degenerate scale lengths so we never divide by zero or NaN.
  const len = Number.isFinite(scaleLength) && scaleLength > 0 ? Math.floor(scaleLength) : 1
  const safeIndex = Number.isFinite(indexInScale) ? Math.floor(indexInScale) : 0
  // Wrap the index into range so callers can pass octave-extended positions.
  const idx = ((safeIndex % len) + len) % len

  // Fraction spreads across the scale; dividing by len (not len-1) leaves a gap
  // before the octave so the top degree doesn't collide with the tonic's hue.
  const fraction = idx / len
  const hue = (HUE_BASE + fraction * HUE_SPAN) % 360

  let sat = SAT_BASE
  let light = LIGHT_BASE

  if (opts.tonic) {
    sat += TONIC_SAT_BOOST
    light += TONIC_LIGHT_BOOST
  }
  if (opts.active) {
    sat += ACTIVE_SAT_BOOST
    light += ACTIVE_LIGHT_BOOST
  }

  sat = clamp(sat, 0, 100)
  light = clamp(light, 0, 100)

  return `hsl(${r1(hue)} ${r1(sat)}% ${r1(light)}%)`
}

/** The glide-trail colour at a given opacity (0..1). Always the cool --glide
 * hue — reserved for the trail + live pitch readout, never for chrome. */
export function glideColor(alpha = 1): string {
  const a = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1)
  // #7FE7D4 ≈ hsl(168 66% 70%). Kept as an explicit literal so it stays locked
  // to the token even if callers tween alpha for the fading trail.
  return `hsl(168 66% 70% / ${r1(a)})`
}
