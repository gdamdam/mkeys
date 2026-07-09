/**
 * Tuning resolution for mkeys — the bridge between the surface's (degree, octave)
 * addressing and absolute frequency, through an arbitrary {@link PortableTuning}
 * (vendored from mdrone; see src/vendor/tuning-core).
 *
 * When no tuning is active the instrument stays pure 12-TET and this module is
 * bypassed entirely (see store.ts): note-on carries no `freq` and the worklet
 * computes `midiToFreq` exactly as before, so 12-TET is regression-identical.
 *
 * When a tuning IS active the surface degrees index the tuning's `scaleCents`
 * DIRECTLY (a 19-note tuning yields 19 steps per period, a Bohlen-Pierce scale
 * repeats at its tritave, etc.) — the diatonic mode/key are not consulted for
 * pitch. The resolved Hz crosses the worklet boundary in the note-on message.
 */
import {
  degreeToHz,
  isValidTuning,
  normalizeTuning,
  periodCents,
  type PortableTuning,
} from '../vendor/tuning-core/model'
import { parseKbm, parseScl, sclToPortable } from '../vendor/tuning-core/scala'
import { REFERENCE_OCTAVE } from './scales'

export type { PortableTuning }
export { degreeToHz, isValidTuning, normalizeTuning, periodCents }
export { BUILTIN_PORTABLE_TUNINGS, DEFAULT_TONIC_HZ } from '../vendor/tuning-core/builtins'

/**
 * Parse a Scala `.scl` scale file into a normalized {@link PortableTuning} at
 * `tonicHz`. Throws (via the vendored parser) on malformed input — the UI catches
 * and surfaces it, so a bad file never becomes a bad tuning.
 */
export function importSclText(text: string, tonicHz: number): PortableTuning {
  return normalizeTuning(sclToPortable(parseScl(text), tonicHz))
}

/**
 * Reference frequency (Hz) declared by a Scala `.kbm` keyboard map. A `.kbm`
 * carries no scale of its own; mkeys uses its `refFreq` to set the tonic pitch
 * of the active tuning. Throws on malformed input.
 */
export function refFreqFromKbmText(text: string): number {
  return parseKbm(text).refFreq
}

/** Number of steps in one period of a tuning (its scale length). */
export function scaleLengthOf(tuning: PortableTuning): number {
  return tuning.scaleCents.length
}

/**
 * Resolve an absolute surface (degree, octave) to a frequency through `tuning`.
 *
 * `degree` may be any integer — chord stacks push it above the scale length and
 * cross-octave layouts below zero — so it wraps within the scale, carrying the
 * overflow into whole extra periods. `octave` is the surface's absolute octave;
 * {@link REFERENCE_OCTAVE} maps to the tuning's own octave 0 (its `tonicHz`),
 * the same anchor `degreeToMidi` uses, so a tuned scene sits at the pitch a
 * 12-TET one would.
 */
export function degreeOctaveToHz(
  tuning: PortableTuning,
  degree: number,
  octave: number,
): number {
  const n = tuning.scaleCents.length
  const step = ((degree % n) + n) % n
  const carry = Math.floor(degree / n)
  return degreeToHz(tuning, step, octave - REFERENCE_OCTAVE + carry)
}

/**
 * Fractional MIDI note number of a frequency (A4 = 69 = 440 Hz). Used to give a
 * tuned note a nominal 12-TET anchor for filter keytracking, on-screen note
 * labels and (rounded) MIDI output — never for the sounding pitch, which is the
 * resolved Hz itself.
 */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

/**
 * A Scala `.kbm` keyboard map, reduced to what mkeys needs to route incoming
 * MIDI notes: the reference note that sounds scale degree `degrees[0]`, and the
 * per-key scale-degree indices (repeating every `degrees.length` keys, one
 * period up per repeat). `-1` marks an unmapped key.
 */
export interface KeyboardMap {
  refNote: number
  degrees: readonly number[]
}

/** Unmapped-key sentinel (matches the vendored core's KBM_UNMAPPED). */
const KBM_UNMAPPED = -1

/**
 * Map an incoming MIDI note to a surface cell `(index, octave)` under an active
 * tuning (§3-A). This replaces the diatonic {@link SCALE_TABLE} routing, which
 * can only reach 7 degrees and mistunes anything but a heptatonic 12-TET scale.
 *
 * Two mappings:
 *  - With a `.kbm` keyboard map: route `note` through it — key
 *    `kbm.refNote + i` sounds scale degree `kbm.degrees[i mod size]`, advancing
 *    one period every `size` keys. Unmapped keys return `null` (no sound).
 *  - Otherwise: a linear map anchored at the tonic MIDI note
 *    `(REFERENCE_OCTAVE + 1) * 12 + keyRoot` (the same anchor `degreeToMidi`
 *    uses), so consecutive MIDI notes step through consecutive scale degrees and
 *    an N-note scale is fully reachable — e.g. a 19-note tuning turns MIDI notes
 *    60‥78 into all 19 degrees before rolling into the next octave register.
 *
 * `octave` is the surface's absolute octave (REFERENCE_OCTAVE == the tuning's
 * own octave 0), matching {@link degreeOctaveToHz}, so pitch lands exactly where
 * touch input on the same cell would.
 */
export function midiToTunedCell(
  note: number,
  keyRoot: number,
  tuning: PortableTuning,
  kbm?: KeyboardMap | null,
): { index: number; octave: number } | null {
  const n = tuning.scaleCents.length
  if (kbm && kbm.degrees.length > 0) {
    const size = kbm.degrees.length
    const rel = note - kbm.refNote
    const within = ((rel % size) + size) % size
    const periods = Math.floor(rel / size)
    const degree = kbm.degrees[within]
    if (degree === KBM_UNMAPPED || degree < 0) return null
    const index = ((degree % n) + n) % n
    const octave = REFERENCE_OCTAVE + periods + Math.floor(degree / n)
    return { index, octave }
  }
  const tonic = (REFERENCE_OCTAVE + 1) * 12 + keyRoot
  const rel = note - tonic
  const index = ((rel % n) + n) % n
  const octave = REFERENCE_OCTAVE + Math.floor(rel / n)
  return { index, octave }
}
