/**
 * Pure macro mapping for mkeys.
 *
 * The four performance macros (each 0..1) collapse many low-level parameters
 * into a handful of musically meaningful gestures. {@link applyMacros} is a
 * total, deterministic function: given the macro state it returns absolute
 * values for the parameter *groups* those macros own, as partial patch/fx
 * overrides the caller layers onto a base patch.
 *
 * Because the returned nested objects (filter, lfo, delay, reverb) are the
 * groups a macro fully controls, sibling fields the macros do not express are
 * filled with neutral, always-valid defaults rather than being left undefined.
 *
 * Mapping summary (see the per-field comments below for exact formulas):
 *
 *   Glow   warmth + reverb "air"  → filter.cutoff (body), patch.subLevel, reverb.size
 *   Motion movement              → lfo.rate/depth, fx.chorus, delay.mix/feedback
 *   Air    high-end + space      → filter.cutoff (brightness), reverb.mix
 *   Grit   dirt + bite          → fx.drive, filter.resonance, filter.drive
 */

import type {
  DelayParams,
  FilterParams,
  FxParams,
  LfoParams,
  Macros,
  PatchParams,
  ReverbParams,
} from '../types'

/** Clamp `n` into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

/** Linear interpolation from `a` to `b` by `t` (t expected in 0..1). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** The macro-derived override layer, split across synth patch and master FX. */
export interface MacroResult {
  patch: Partial<PatchParams>
  fx: Partial<FxParams>
}

/**
 * Map the four macros onto patch + fx parameter groups. Pure and total: every
 * output stays within the type's valid range for any macro value in [0, 1].
 */
export function applyMacros(macros: Macros): MacroResult {
  const glow = clamp(macros.glow, 0, 1)
  const motion = clamp(macros.motion, 0, 1)
  const air = clamp(macros.air, 0, 1)
  const grit = clamp(macros.grit, 0, 1)

  // Filter cutoff is a shared destination: Glow adds warm body, Air opens the
  // high end. Both push it up, so the field is monotonic in each. Range 20..20k.
  const cutoff = clamp(300 + glow * 2200 + air * 4000, 20, 20000)

  const filter: FilterParams = {
    cutoff,
    // Grit sharpens the resonant peak.
    resonance: clamp(grit * 0.7, 0, 1),
    // Grit also drives the filter for extra dirt.
    drive: clamp(grit * 0.5, 0, 1),
    // Neutral, always-valid defaults for fields no macro expresses.
    envAmount: 0.3,
    keytrack: 0.5,
  }

  // Motion animates the LFO: faster and deeper as it opens up.
  const lfo: LfoParams = {
    rate: clamp(lerp(0.5, 8, motion), 0, 50),
    depth: clamp(motion * 0.8, 0, 1),
    target: 'filter',
    tempoSync: false,
  }

  // Motion feeds the tempo-synced delay's wet mix and feedback.
  const delay: DelayParams = {
    time: 0.3,
    feedback: clamp(motion * 0.6, 0, 1),
    mix: clamp(motion * 0.5, 0, 1),
    tempoSync: true,
    division: 8,
  }

  // Glow sets the reverb tail length ("air"); Air sets how much is heard.
  const reverb: ReverbParams = {
    size: clamp(lerp(0.2, 0.8, glow), 0, 1),
    mix: clamp(air * 0.6, 0, 1),
  }

  const patch: Partial<PatchParams> = {
    filter,
    lfo,
    // Glow thickens the low end with sub for extra warmth.
    subLevel: clamp(lerp(0.1, 0.5, glow), 0, 1),
  }

  const fx: Partial<FxParams> = {
    // Grit is the master saturation amount.
    drive: clamp(grit * 0.8, 0, 1),
    // Motion is the chorus depth/mix.
    chorus: clamp(motion * 0.8, 0, 1),
    delay,
    reverb,
  }

  return { patch, fx }
}
