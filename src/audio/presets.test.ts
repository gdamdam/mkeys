import { describe, expect, it } from 'vitest'
import type { EnvParams, FxParams, OscillatorParams, PatchParams } from '../types'
import { getPreset, PRESET_CATEGORIES, PRESETS, type Preset } from './presets'

/** Assert a finite number sits within [lo, hi] inclusive. */
function inRange(v: number, lo: number, hi: number): void {
  expect(Number.isFinite(v)).toBe(true)
  expect(v).toBeGreaterThanOrEqual(lo)
  expect(v).toBeLessThanOrEqual(hi)
}

const WAVES: readonly OscillatorParams['wave'][] = ['saw', 'pulse', 'sine', 'triangle']

function checkOsc(o: OscillatorParams): void {
  expect(WAVES).toContain(o.wave)
  inRange(o.detune, -100, 100)
  inRange(o.level, 0, 1)
  inRange(o.pulseWidth ?? 0.5, 0, 1)
  inRange(o.fm ?? 0, 0, 1)
  expect(typeof (o.sync ?? false)).toBe('boolean')
}

function checkEnv(e: EnvParams): void {
  inRange(e.attack, 0, 30)
  inRange(e.decay, 0, 30)
  inRange(e.sustain, 0, 1)
  inRange(e.release, 0, 30)
}

function checkPatch(p: PatchParams): void {
  checkOsc(p.osc1)
  checkOsc(p.osc2)
  inRange(p.subLevel, 0, 1)
  inRange(p.noiseLevel, 0, 1)

  inRange(p.filter.cutoff, 20, 20000)
  inRange(p.filter.resonance, 0, 1)
  inRange(p.filter.drive, 0, 1)
  inRange(p.filter.envAmount, -1, 1)
  inRange(p.filter.keytrack, 0, 1)

  checkEnv(p.ampEnv)
  checkEnv(p.filterEnv)

  inRange(p.lfo.rate, 0, 40)
  inRange(p.lfo.depth, 0, 1)
  expect(['pitch', 'filter', 'amp']).toContain(p.lfo.target)
  expect(typeof p.lfo.tempoSync).toBe('boolean')
  inRange(p.lfo.division ?? 4, 1, 64)

  inRange(p.unison.voices, 1, 8)
  expect(Number.isInteger(p.unison.voices)).toBe(true)
  inRange(p.unison.detune, 0, 1)
  inRange(p.unison.spread, 0, 1)

  inRange(p.glide.time, 0, 10)
  expect(['legato', 'always', 'off']).toContain(p.glide.mode)

  inRange(p.volume, 0, 1)
}

function checkFx(fx: Partial<FxParams>): void {
  if (fx.drive !== undefined) inRange(fx.drive, 0, 1)
  if (fx.chorus !== undefined) inRange(fx.chorus, 0, 1)
  if (fx.limiterThreshold !== undefined) inRange(fx.limiterThreshold, -60, 0)
  if (fx.delay) {
    inRange(fx.delay.time, 0, 5)
    inRange(fx.delay.feedback, 0, 1)
    inRange(fx.delay.mix, 0, 1)
    expect(typeof fx.delay.tempoSync).toBe('boolean')
    inRange(fx.delay.division, 1, 64)
    expect(Number.isInteger(fx.delay.division)).toBe(true)
  }
  if (fx.reverb) {
    inRange(fx.reverb.size, 0, 1)
    inRange(fx.reverb.mix, 0, 1)
  }
}

describe('PRESETS', () => {
  it('has 12..16 presets', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(12)
    expect(PRESETS.length).toBeLessThanOrEqual(16)
  })

  it('covers all five families', () => {
    const seen = new Set(PRESETS.map((p) => p.category))
    for (const c of PRESET_CATEGORIES) expect(seen.has(c)).toBe(true)
    expect(seen.size).toBe(PRESET_CATEGORIES.length)
  })

  it('has the requested family distribution', () => {
    const count = (c: Preset['category']) => PRESETS.filter((p) => p.category === c).length
    expect(count('lead')).toBe(3)
    expect(count('pad')).toBe(3)
    expect(count('pluck')).toBe(2)
    expect(count('bass')).toBe(2)
    expect(count('ambient')).toBe(4)
  })

  it('has unique, non-empty names', () => {
    const names = PRESETS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n.trim().length).toBeGreaterThan(0)
  })

  it('every category is a known family', () => {
    for (const p of PRESETS) expect(PRESET_CATEGORIES).toContain(p.category)
  })

  it('every patch is complete and within sane bounds', () => {
    for (const p of PRESETS) {
      checkPatch(p.patch)
      if (p.fx) checkFx(p.fx)
      if (p.macros) {
        inRange(p.macros.glow, 0, 1)
        inRange(p.macros.motion, 0, 1)
        inRange(p.macros.air, 0, 1)
        inRange(p.macros.grit, 0, 1)
      }
    }
  })
})

describe('getPreset', () => {
  it('round-trips every preset by name', () => {
    for (const p of PRESETS) expect(getPreset(p.name)).toBe(p)
  })

  it('returns undefined for unknown names', () => {
    expect(getPreset('No Such Patch')).toBeUndefined()
    expect(getPreset('')).toBeUndefined()
  })
})
