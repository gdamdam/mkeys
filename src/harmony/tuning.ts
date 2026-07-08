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
