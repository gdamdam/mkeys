import type { Mode, PitchClass } from '../types'

/**
 * Semitone interval sets (from the tonic) for every supported mode.
 *
 * Heptatonic modes have 7 intervals; the pentatonic scales have 5 and the
 * blues scale has 6. All entries are strictly ascending within [0, 12). This
 * table is the canonical source for diatonic membership and for mapping the
 * playing surface's scale degrees onto MIDI note numbers.
 */
export const SCALE_TABLE: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
}

/**
 * Reference octave used to translate an absolute MIDI note back into a scale
 * degree in {@link midiToNearestDegree}. Degree 0 at this octave is the tonic
 * (e.g. C4 = 60), matching the surface's default `baseOctave`.
 */
const REFERENCE_OCTAVE = 4

/** Normalise any integer to a pitch class 0–11. */
export function mod12(n: number): PitchClass {
  return ((n % 12) + 12) % 12
}

/** The pitch classes of `mode` rooted at `root`, in ascending scale order. */
export function scalePitchClasses(root: PitchClass, mode: Mode): number[] {
  return SCALE_TABLE[mode].map((iv) => mod12(root + iv))
}

/**
 * 0-based scale degree of `pc` in the key, or null if non-diatonic.
 * Degree 0 = tonic. `pc` may be any integer; it is normalised first.
 */
export function scaleDegreeOf(
  pc: PitchClass,
  root: PitchClass,
  mode: Mode,
): number | null {
  const pcs = scalePitchClasses(root, mode)
  const idx = pcs.indexOf(mod12(pc))
  return idx === -1 ? null : idx
}

/**
 * Absolute MIDI note for a scale `degree`. Degree 0 is the tonic at
 * `baseOctave`; degrees outside `[0, length)` wrap octaves (both directions),
 * so the result is monotonic increasing in `degree` and advances by exactly 12
 * semitones per full scale cycle.
 */
export function degreeToMidi(
  degree: number,
  root: PitchClass,
  mode: Mode,
  baseOctave: number,
): number {
  const intervals = SCALE_TABLE[mode]
  const len = intervals.length
  const octaveShift = Math.floor(degree / len)
  const index = degree - octaveShift * len
  // MIDI convention: (octave + 1) * 12 + pitch class, so C4 (octave 4) = 60.
  return (
    (baseOctave + 1) * 12 + root + intervals[index] + octaveShift * 12
  )
}

/**
 * Inverse of {@link degreeToMidi} (relative to {@link REFERENCE_OCTAVE}): the
 * scale degree whose MIDI note is closest to `midi`. Exact scale tones map back
 * to their own degree; off-scale notes snap to the nearest degree. On a tie the
 * lower degree wins.
 */
export function midiToNearestDegree(
  midi: number,
  root: PitchClass,
  mode: Mode,
): number {
  const len = SCALE_TABLE[mode].length
  const tonic = (REFERENCE_OCTAVE + 1) * 12 + root
  // Estimate then search a window wide enough to bracket the true nearest.
  const estimate = Math.round(((midi - tonic) / 12) * len)
  let bestDegree = estimate
  let bestDist = Infinity
  for (let d = estimate - (len + 2); d <= estimate + (len + 2); d++) {
    const dist = Math.abs(degreeToMidi(d, root, mode, REFERENCE_OCTAVE) - midi)
    if (dist < bestDist) {
      bestDist = dist
      bestDegree = d
    }
  }
  return bestDegree
}
