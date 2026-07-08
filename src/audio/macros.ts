/**
 * Pure macro mapping for mkeys.
 *
 * The four performance macros (each 0..1) collapse many low-level parameters
 * into a handful of musically meaningful gestures. They are *additive*: each
 * macro contributes a signed offset that is layered on top of the base patch
 * the direct controls edit, rather than replacing whole parameter groups. So a
 * manual cutoff/LFO edit and a macro move both stay audible — the engine plays
 * `base + macro offset`, clamped to each field's valid range.
 *
 * {@link applyMacros} is a total, deterministic function returning those offsets
 * (all zero when every macro is at 0, so neutral macros leave the base patch
 * untouched). {@link composeMacros} folds the offsets onto a base patch/fx.
 *
 * Mapping summary (see the per-field comments below for exact formulas):
 *
 *   Glow   warmth + reverb "air"  → filter.cutoff (body), patch.subLevel, reverb.size
 *   Motion movement              → lfo.rate/depth, fx.chorus, delay.mix/feedback
 *   Air    high-end + space      → filter.cutoff (brightness), reverb.mix
 *   Grit   dirt + bite          → fx.drive, filter.resonance, filter.drive
 */

import type { FxParams, Macros, PatchParams } from '../types'

/** Clamp `n` into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n
}

/**
 * The macro-derived offset layer. Every value is an additive delta (always >= 0
 * for the current mapping) applied to the matching base-patch/fx field. Fields
 * no macro expresses (envAmount, lfo.target, delay.time, ...) are absent, so the
 * base value passes through unchanged.
 */
export interface MacroOffsets {
  filter: { cutoff: number; resonance: number; drive: number }
  lfo: { rate: number; depth: number }
  subLevel: number
  fx: { drive: number; chorus: number }
  delay: { feedback: number; mix: number }
  reverb: { size: number; mix: number }
}

/**
 * Map the four macros onto additive parameter offsets. Pure and total: each
 * offset is monotonic in its macro and zero when the macro is 0, so composing
 * with all macros at 0 returns the base patch verbatim.
 */
export function applyMacros(macros: Macros): MacroOffsets {
  const glow = clamp(macros.glow, 0, 1)
  const motion = clamp(macros.motion, 0, 1)
  const air = clamp(macros.air, 0, 1)
  const grit = clamp(macros.grit, 0, 1)

  return {
    filter: {
      // Cutoff is a shared destination: Glow adds warm body, Air opens the top.
      // Both push the base cutoff upward (Hz).
      cutoff: glow * 2200 + air * 4000,
      // Grit sharpens the resonant peak and drives the filter for extra dirt.
      resonance: grit * 0.7,
      drive: grit * 0.5,
    },
    // Motion animates the LFO faster and deeper, on top of its base rate/depth.
    lfo: {
      rate: motion * 7.5,
      depth: motion * 0.8,
    },
    // Glow thickens the low end with sub for extra warmth.
    subLevel: glow * 0.4,
    fx: {
      // Grit is added master saturation; Motion adds chorus.
      drive: grit * 0.8,
      chorus: motion * 0.8,
    },
    // Motion feeds the delay's wet mix and feedback.
    delay: {
      feedback: motion * 0.6,
      mix: motion * 0.5,
    },
    // Glow lengthens the reverb tail ("air"); Air raises how much is heard.
    reverb: {
      size: glow * 0.6,
      mix: air * 0.6,
    },
  }
}

/**
 * Fold the macro offsets onto a base patch/fx, clamping every touched field to
 * its valid range. Untouched fields (oscillators, envelopes, lfo.target, delay
 * timing, ...) pass through from the base unchanged. Pure — inputs are copied.
 */
export function composeMacros(
  base: { patch: PatchParams; fx: FxParams },
  macros: Macros,
): { patch: PatchParams; fx: FxParams } {
  const o = applyMacros(macros)
  const { patch: bp, fx: bf } = base

  const patch: PatchParams = {
    ...bp,
    filter: {
      ...bp.filter,
      cutoff: clamp(bp.filter.cutoff + o.filter.cutoff, 20, 20000),
      resonance: clamp(bp.filter.resonance + o.filter.resonance, 0, 1),
      drive: clamp(bp.filter.drive + o.filter.drive, 0, 1),
    },
    lfo: {
      ...bp.lfo,
      rate: clamp(bp.lfo.rate + o.lfo.rate, 0, 50),
      depth: clamp(bp.lfo.depth + o.lfo.depth, 0, 1),
    },
    subLevel: clamp(bp.subLevel + o.subLevel, 0, 1),
  }

  const fx: FxParams = {
    ...bf,
    drive: clamp(bf.drive + o.fx.drive, 0, 1),
    chorus: clamp(bf.chorus + o.fx.chorus, 0, 1),
    delay: {
      ...bf.delay,
      feedback: clamp(bf.delay.feedback + o.delay.feedback, 0, 1),
      mix: clamp(bf.delay.mix + o.delay.mix, 0, 1),
    },
    reverb: {
      ...bf.reverb,
      size: clamp(bf.reverb.size + o.reverb.size, 0, 1),
      mix: clamp(bf.reverb.mix + o.reverb.mix, 0, 1),
    },
  }

  return { patch, fx }
}
