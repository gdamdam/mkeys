/**
 * Factory preset patches for mkeys.
 *
 * Each {@link Preset} carries a COMPLETE, valid {@link PatchParams} plus optional
 * master-FX overrides and performance macros. Values stay inside the ranges the
 * persistence/sharing sanitizers enforce (see src/persistence/session.ts):
 * envelope times in seconds (0..30), filter cutoff in Hz (20..20000), oscillator
 * detune in cents (-100..100), unison/level/mix in 0..1, LFO rate in Hz (0..40).
 *
 * Presets are the tasteful defaults surfaced in the UI; the sanitizer remains the
 * final authority for anything loaded from disk or a share link.
 */
import type { EnvParams, FxParams, Macros, OscillatorParams, PatchParams } from '../types'

/** A named factory patch, tagged by sound family. */
export interface Preset {
  name: string
  category: 'lead' | 'pad' | 'pluck' | 'bass' | 'ambient'
  patch: PatchParams
  fx?: Partial<FxParams>
  macros?: Macros
}

/** All preset families, in display order. */
export const PRESET_CATEGORIES = ['lead', 'pad', 'pluck', 'bass', 'ambient'] as const

/* ------------------------------------------------------------------ */
/* Terse builders (keep every patch field explicit yet readable)       */
/* ------------------------------------------------------------------ */

function osc(
  wave: OscillatorParams['wave'],
  detune: number,
  level: number,
  pulseWidth = 0.5,
  fm = 0,
  sync = false,
): OscillatorParams {
  return { wave, detune, level, pulseWidth, sync, fm }
}

function env(attack: number, decay: number, sustain: number, release: number): EnvParams {
  return { attack, decay, sustain, release }
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export const PRESETS: readonly Preset[] = [
  /* ---- Leads ---- */
  {
    name: 'Solar Filament',
    category: 'lead',
    patch: {
      osc1: osc('saw', 0, 0.9),
      osc2: osc('saw', 6, 0.6),
      subLevel: 0.1,
      noiseLevel: 0,
      filter: { cutoff: 6000, resonance: 0.25, drive: 0.15, envAmount: 0.3, keytrack: 0.5 },
      ampEnv: env(0.005, 0.15, 0.8, 0.25),
      filterEnv: env(0.01, 0.2, 0.3, 0.3),
      lfo: { rate: 5, depth: 0.1, target: 'pitch', tempoSync: false, division: 4 },
      unison: { voices: 2, detune: 0.15, spread: 0.4 },
      glide: { time: 0.05, mode: 'legato' },
      volume: 0.8,
    },
    fx: {
      drive: 0.1,
      chorus: 0.2,
      delay: { time: 0.25, feedback: 0.3, mix: 0.2, tempoSync: true, division: 4 },
      reverb: { size: 0.4, mix: 0.2 },
    },
    macros: { glow: 0.6, motion: 0.3, air: 0.4, grit: 0.2 },
  },
  {
    name: 'Neon Cantabile',
    category: 'lead',
    patch: {
      osc1: osc('pulse', -5, 0.8, 0.4),
      osc2: osc('pulse', 5, 0.5, 0.6),
      subLevel: 0.15,
      noiseLevel: 0,
      filter: { cutoff: 4500, resonance: 0.3, drive: 0.1, envAmount: 0.4, keytrack: 0.6 },
      ampEnv: env(0.02, 0.2, 0.85, 0.4),
      filterEnv: env(0.03, 0.25, 0.4, 0.35),
      lfo: { rate: 4.5, depth: 0.15, target: 'pitch', tempoSync: false, division: 4 },
      unison: { voices: 3, detune: 0.2, spread: 0.5 },
      glide: { time: 0.12, mode: 'always' },
      volume: 0.78,
    },
    fx: {
      chorus: 0.35,
      delay: { time: 0.3, feedback: 0.35, mix: 0.25, tempoSync: true, division: 8 },
      reverb: { size: 0.5, mix: 0.3 },
    },
    macros: { glow: 0.7, motion: 0.4, air: 0.5, grit: 0.1 },
  },
  {
    name: 'Copper Wire',
    category: 'lead',
    patch: {
      osc1: osc('saw', 0, 0.85, 0.5, 0.3),
      osc2: osc('triangle', 8, 0.5, 0.5, 0.5),
      subLevel: 0.1,
      noiseLevel: 0.05,
      filter: { cutoff: 5000, resonance: 0.4, drive: 0.4, envAmount: 0.5, keytrack: 0.4 },
      ampEnv: env(0.003, 0.12, 0.7, 0.2),
      filterEnv: env(0.005, 0.15, 0.25, 0.25),
      lfo: { rate: 6, depth: 0.2, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 2, detune: 0.1, spread: 0.3 },
      glide: { time: 0.03, mode: 'legato' },
      volume: 0.76,
    },
    fx: {
      drive: 0.3,
      chorus: 0.15,
      delay: { time: 0.2, feedback: 0.4, mix: 0.2, tempoSync: true, division: 16 },
      reverb: { size: 0.35, mix: 0.2 },
      limiterThreshold: -2,
    },
    macros: { glow: 0.4, motion: 0.3, air: 0.3, grit: 0.6 },
  },

  /* ---- Pads ---- */
  {
    name: 'Cathedral Dust',
    category: 'pad',
    patch: {
      osc1: osc('saw', -6, 0.7),
      osc2: osc('saw', 6, 0.7),
      subLevel: 0.2,
      noiseLevel: 0.02,
      filter: { cutoff: 3000, resonance: 0.15, drive: 0.05, envAmount: 0.3, keytrack: 0.3 },
      ampEnv: env(1.2, 0.8, 0.9, 2.5),
      filterEnv: env(1.5, 1.0, 0.5, 2.0),
      lfo: { rate: 0.3, depth: 0.3, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 4, detune: 0.3, spread: 0.7 },
      glide: { time: 0, mode: 'off' },
      volume: 0.7,
    },
    fx: {
      chorus: 0.5,
      delay: { time: 0.4, feedback: 0.3, mix: 0.15, tempoSync: false, division: 4 },
      reverb: { size: 0.8, mix: 0.5 },
    },
    macros: { glow: 0.8, motion: 0.5, air: 0.7, grit: 0.05 },
  },
  {
    name: 'Slow Aurora',
    category: 'pad',
    patch: {
      osc1: osc('triangle', -4, 0.6),
      osc2: osc('saw', 5, 0.5),
      subLevel: 0.25,
      noiseLevel: 0.03,
      filter: { cutoff: 2200, resonance: 0.2, drive: 0.05, envAmount: 0.4, keytrack: 0.25 },
      ampEnv: env(2.0, 1.5, 0.85, 3.5),
      filterEnv: env(3.0, 2.0, 0.6, 3.0),
      lfo: { rate: 0.15, depth: 0.4, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 3, detune: 0.25, spread: 0.6 },
      glide: { time: 0, mode: 'off' },
      volume: 0.68,
    },
    fx: {
      chorus: 0.4,
      delay: { time: 0.5, feedback: 0.4, mix: 0.2, tempoSync: true, division: 4 },
      reverb: { size: 0.85, mix: 0.55 },
    },
    macros: { glow: 0.7, motion: 0.7, air: 0.8, grit: 0.05 },
  },
  {
    name: 'Velvet Fog',
    category: 'pad',
    patch: {
      osc1: osc('sine', 0, 0.6),
      osc2: osc('triangle', 7, 0.55),
      subLevel: 0.3,
      noiseLevel: 0,
      filter: { cutoff: 1800, resonance: 0.1, drive: 0, envAmount: 0.2, keytrack: 0.3 },
      ampEnv: env(0.8, 0.6, 0.9, 2.0),
      filterEnv: env(1.0, 0.8, 0.5, 1.5),
      lfo: { rate: 0.5, depth: 0.2, target: 'amp', tempoSync: false, division: 4 },
      unison: { voices: 2, detune: 0.2, spread: 0.5 },
      glide: { time: 0, mode: 'off' },
      volume: 0.72,
    },
    fx: {
      chorus: 0.45,
      delay: { time: 0.35, feedback: 0.25, mix: 0.1, tempoSync: false, division: 4 },
      reverb: { size: 0.7, mix: 0.45 },
    },
    macros: { glow: 0.75, motion: 0.35, air: 0.6, grit: 0.02 },
  },

  /* ---- Plucks ---- */
  {
    name: 'Rain on Tin',
    category: 'pluck',
    patch: {
      osc1: osc('triangle', 0, 0.8),
      osc2: osc('pulse', 12, 0.4, 0.3),
      subLevel: 0.1,
      noiseLevel: 0.1,
      filter: { cutoff: 4000, resonance: 0.3, drive: 0.1, envAmount: 0.6, keytrack: 0.5 },
      ampEnv: env(0.002, 0.25, 0, 0.3),
      filterEnv: env(0.002, 0.2, 0, 0.25),
      lfo: { rate: 5, depth: 0, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 1, detune: 0, spread: 0 },
      glide: { time: 0, mode: 'off' },
      volume: 0.78,
    },
    fx: {
      drive: 0.05,
      chorus: 0.2,
      delay: { time: 0.25, feedback: 0.35, mix: 0.3, tempoSync: true, division: 8 },
      reverb: { size: 0.5, mix: 0.3 },
    },
    macros: { glow: 0.4, motion: 0.3, air: 0.5, grit: 0.2 },
  },
  {
    name: 'Glass Marbles',
    category: 'pluck',
    patch: {
      osc1: osc('sine', 0, 0.7, 0.5, 0.4),
      osc2: osc('sine', 7, 0.4, 0.5, 0.6),
      subLevel: 0.05,
      noiseLevel: 0,
      filter: { cutoff: 6000, resonance: 0.2, drive: 0.05, envAmount: 0.5, keytrack: 0.6 },
      ampEnv: env(0.001, 0.35, 0, 0.4),
      filterEnv: env(0.001, 0.3, 0, 0.35),
      lfo: { rate: 4, depth: 0, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 1, detune: 0, spread: 0 },
      glide: { time: 0, mode: 'off' },
      volume: 0.75,
    },
    fx: {
      chorus: 0.15,
      delay: { time: 0.3, feedback: 0.4, mix: 0.35, tempoSync: true, division: 16 },
      reverb: { size: 0.6, mix: 0.4 },
    },
    macros: { glow: 0.5, motion: 0.4, air: 0.6, grit: 0.05 },
  },

  /* ---- Bass ---- */
  {
    name: 'Tarpit',
    category: 'bass',
    patch: {
      osc1: osc('sine', 0, 0.9),
      osc2: osc('saw', 0, 0.5),
      subLevel: 0.6,
      noiseLevel: 0,
      filter: { cutoff: 800, resonance: 0.25, drive: 0.2, envAmount: 0.5, keytrack: 0.2 },
      ampEnv: env(0.005, 0.2, 0.6, 0.15),
      filterEnv: env(0.003, 0.15, 0.2, 0.15),
      lfo: { rate: 5, depth: 0, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 1, detune: 0, spread: 0 },
      glide: { time: 0.04, mode: 'legato' },
      volume: 0.82,
    },
    fx: {
      drive: 0.15,
      chorus: 0,
      delay: { time: 0.2, feedback: 0.2, mix: 0.05, tempoSync: false, division: 4 },
      reverb: { size: 0.2, mix: 0.1 },
    },
    macros: { glow: 0.3, motion: 0.1, air: 0.1, grit: 0.4 },
  },
  {
    name: 'Gravel Road',
    category: 'bass',
    patch: {
      osc1: osc('saw', 0, 0.85),
      osc2: osc('pulse', -8, 0.6, 0.35),
      subLevel: 0.5,
      noiseLevel: 0.03,
      filter: { cutoff: 1200, resonance: 0.4, drive: 0.5, envAmount: 0.6, keytrack: 0.3 },
      ampEnv: env(0.004, 0.18, 0.55, 0.18),
      filterEnv: env(0.003, 0.14, 0.15, 0.16),
      lfo: { rate: 6, depth: 0.1, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 2, detune: 0.1, spread: 0.2 },
      glide: { time: 0.03, mode: 'legato' },
      volume: 0.8,
    },
    fx: {
      drive: 0.35,
      chorus: 0.05,
      delay: { time: 0.15, feedback: 0.25, mix: 0.08, tempoSync: false, division: 4 },
      reverb: { size: 0.25, mix: 0.12 },
      limiterThreshold: -2,
    },
    macros: { glow: 0.25, motion: 0.2, air: 0.15, grit: 0.7 },
  },

  /* ---- Ambient ---- */
  {
    name: 'Distant Weather',
    category: 'ambient',
    patch: {
      osc1: osc('saw', -3, 0.5),
      osc2: osc('triangle', 4, 0.5),
      subLevel: 0.15,
      noiseLevel: 0.15,
      filter: { cutoff: 2500, resonance: 0.15, drive: 0.05, envAmount: 0.3, keytrack: 0.2 },
      ampEnv: env(3.0, 2.0, 0.8, 5.0),
      filterEnv: env(4.0, 3.0, 0.5, 5.0),
      lfo: { rate: 0.1, depth: 0.5, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 3, detune: 0.35, spread: 0.8 },
      glide: { time: 0, mode: 'off' },
      volume: 0.65,
    },
    fx: {
      chorus: 0.5,
      delay: { time: 0.6, feedback: 0.5, mix: 0.35, tempoSync: true, division: 4 },
      reverb: { size: 0.9, mix: 0.6 },
    },
    macros: { glow: 0.6, motion: 0.8, air: 0.9, grit: 0.1 },
  },
  {
    name: 'Lantern Drift',
    category: 'ambient',
    patch: {
      osc1: osc('sine', -2, 0.55),
      osc2: osc('sine', 9, 0.45, 0.5, 0.3),
      subLevel: 0.2,
      noiseLevel: 0.05,
      filter: { cutoff: 3200, resonance: 0.1, drive: 0, envAmount: 0.25, keytrack: 0.3 },
      ampEnv: env(2.5, 1.8, 0.85, 4.5),
      filterEnv: env(3.0, 2.5, 0.55, 4.0),
      lfo: { rate: 0.2, depth: 0.4, target: 'amp', tempoSync: false, division: 4 },
      unison: { voices: 2, detune: 0.25, spread: 0.6 },
      glide: { time: 0, mode: 'off' },
      volume: 0.66,
    },
    fx: {
      chorus: 0.4,
      delay: { time: 0.55, feedback: 0.45, mix: 0.3, tempoSync: true, division: 8 },
      reverb: { size: 0.88, mix: 0.55 },
    },
    macros: { glow: 0.7, motion: 0.6, air: 0.85, grit: 0.05 },
  },
  {
    name: 'Tape Horizon',
    category: 'ambient',
    patch: {
      osc1: osc('triangle', 0, 0.6),
      osc2: osc('saw', -5, 0.4),
      subLevel: 0.25,
      noiseLevel: 0.2,
      filter: { cutoff: 2000, resonance: 0.2, drive: 0.1, envAmount: 0.3, keytrack: 0.2 },
      ampEnv: env(1.8, 1.5, 0.8, 3.8),
      filterEnv: env(2.5, 2.0, 0.5, 3.5),
      lfo: { rate: 0.35, depth: 0.35, target: 'pitch', tempoSync: false, division: 4 },
      unison: { voices: 3, detune: 0.3, spread: 0.7 },
      glide: { time: 0, mode: 'off' },
      volume: 0.64,
    },
    fx: {
      drive: 0.1,
      chorus: 0.55,
      delay: { time: 0.5, feedback: 0.5, mix: 0.3, tempoSync: false, division: 4 },
      reverb: { size: 0.85, mix: 0.5 },
      limiterThreshold: -2,
    },
    macros: { glow: 0.55, motion: 0.7, air: 0.7, grit: 0.25 },
  },
  {
    name: 'Underwater Bells',
    category: 'ambient',
    patch: {
      osc1: osc('sine', 0, 0.7, 0.5, 0.5),
      osc2: osc('sine', 7, 0.4, 0.5, 0.7),
      subLevel: 0.1,
      noiseLevel: 0.05,
      filter: { cutoff: 3500, resonance: 0.25, drive: 0.05, envAmount: 0.4, keytrack: 0.5 },
      ampEnv: env(0.5, 2.5, 0.4, 4.0),
      filterEnv: env(0.4, 2.0, 0.3, 3.5),
      lfo: { rate: 0.4, depth: 0.3, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 2, detune: 0.2, spread: 0.55 },
      glide: { time: 0, mode: 'off' },
      volume: 0.67,
    },
    fx: {
      chorus: 0.35,
      delay: { time: 0.45, feedback: 0.55, mix: 0.4, tempoSync: true, division: 16 },
      reverb: { size: 0.9, mix: 0.6 },
    },
    macros: { glow: 0.65, motion: 0.5, air: 0.8, grit: 0.05 },
  },
] as const

/** Look up a preset by exact name. */
export function getPreset(name: string): Preset | undefined {
  return PRESETS.find((p) => p.name === name)
}
