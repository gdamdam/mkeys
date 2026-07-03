import { describe, expect, it } from 'vitest'
import type { Macros } from '../types'
import { applyMacros } from './macros'

/** Build a Macros with all knobs at `v` unless overridden. */
function m(v: number, over: Partial<Macros> = {}): Macros {
  return { glow: v, motion: v, air: v, grit: v, ...over }
}

const SAMPLES = [0, 0.25, 0.5, 0.75, 1]

describe('applyMacros — validity', () => {
  it('keeps every output within its type range for all-macro sweeps', () => {
    for (const v of SAMPLES) {
      const { patch, fx } = applyMacros(m(v))

      // patch.filter
      const f = patch.filter!
      expect(f.cutoff).toBeGreaterThanOrEqual(20)
      expect(f.cutoff).toBeLessThanOrEqual(20000)
      expect(f.resonance).toBeGreaterThanOrEqual(0)
      expect(f.resonance).toBeLessThanOrEqual(1)
      expect(f.drive).toBeGreaterThanOrEqual(0)
      expect(f.drive).toBeLessThanOrEqual(1)
      expect(f.envAmount).toBeGreaterThanOrEqual(-1)
      expect(f.envAmount).toBeLessThanOrEqual(1)
      expect(f.keytrack).toBeGreaterThanOrEqual(0)
      expect(f.keytrack).toBeLessThanOrEqual(1)

      // patch.lfo
      const l = patch.lfo!
      expect(l.rate).toBeGreaterThanOrEqual(0)
      expect(l.rate).toBeLessThanOrEqual(50)
      expect(l.depth).toBeGreaterThanOrEqual(0)
      expect(l.depth).toBeLessThanOrEqual(1)

      // patch.subLevel
      expect(patch.subLevel!).toBeGreaterThanOrEqual(0)
      expect(patch.subLevel!).toBeLessThanOrEqual(1)

      // fx scalars
      expect(fx.drive!).toBeGreaterThanOrEqual(0)
      expect(fx.drive!).toBeLessThanOrEqual(1)
      expect(fx.chorus!).toBeGreaterThanOrEqual(0)
      expect(fx.chorus!).toBeLessThanOrEqual(1)

      // fx.delay
      const d = fx.delay!
      expect(d.time).toBeGreaterThanOrEqual(0)
      expect(d.time).toBeLessThanOrEqual(10)
      expect(d.feedback).toBeGreaterThanOrEqual(0)
      expect(d.feedback).toBeLessThanOrEqual(1)
      expect(d.mix).toBeGreaterThanOrEqual(0)
      expect(d.mix).toBeLessThanOrEqual(1)
      expect(Number.isInteger(d.division)).toBe(true)
      expect(d.division).toBeGreaterThanOrEqual(1)
      expect(d.division).toBeLessThanOrEqual(64)

      // fx.reverb
      const r = fx.reverb!
      expect(r.size).toBeGreaterThanOrEqual(0)
      expect(r.size).toBeLessThanOrEqual(1)
      expect(r.mix).toBeGreaterThanOrEqual(0)
      expect(r.mix).toBeLessThanOrEqual(1)
    }
  })

  it('clamps out-of-range macro inputs instead of leaking them', () => {
    const { patch, fx } = applyMacros({ glow: -5, motion: 9, air: -1, grit: 100 })
    expect(patch.subLevel!).toBeGreaterThanOrEqual(0)
    expect(patch.subLevel!).toBeLessThanOrEqual(1)
    expect(fx.drive!).toBeLessThanOrEqual(1)
    expect(fx.chorus!).toBeLessThanOrEqual(1)
    expect(patch.filter!.resonance).toBeLessThanOrEqual(1)
    expect(patch.filter!.cutoff).toBeLessThanOrEqual(20000)
    // Negative macros clamp to the zero end, not below.
    expect(patch.filter!.resonance).toBeGreaterThanOrEqual(0)
    expect(fx.reverb!.mix).toBeGreaterThanOrEqual(0)
  })
})

describe('applyMacros — monotonicity', () => {
  /** Sweep one macro (others at 0) and read a scalar off the result. */
  function sweep(knob: keyof Macros, read: (r: ReturnType<typeof applyMacros>) => number): number[] {
    return SAMPLES.map((v) => read(applyMacros(m(0, { [knob]: v }))))
  }

  function assertIncreasing(xs: number[]): void {
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
  }

  it('Glow raises warmth: subLevel, reverb size, cutoff', () => {
    assertIncreasing(sweep('glow', (r) => r.patch.subLevel!))
    assertIncreasing(sweep('glow', (r) => r.fx.reverb!.size))
    assertIncreasing(sweep('glow', (r) => r.patch.filter!.cutoff))
  })

  it('Motion raises movement: lfo rate/depth, chorus, delay mix/feedback', () => {
    assertIncreasing(sweep('motion', (r) => r.patch.lfo!.rate))
    assertIncreasing(sweep('motion', (r) => r.patch.lfo!.depth))
    assertIncreasing(sweep('motion', (r) => r.fx.chorus!))
    assertIncreasing(sweep('motion', (r) => r.fx.delay!.mix))
    assertIncreasing(sweep('motion', (r) => r.fx.delay!.feedback))
  })

  it('Air raises high-end/space: cutoff and reverb mix', () => {
    assertIncreasing(sweep('air', (r) => r.patch.filter!.cutoff))
    assertIncreasing(sweep('air', (r) => r.fx.reverb!.mix))
  })

  it('Grit raises dirt: fx drive, filter resonance and filter drive', () => {
    assertIncreasing(sweep('grit', (r) => r.fx.drive!))
    assertIncreasing(sweep('grit', (r) => r.patch.filter!.resonance))
    assertIncreasing(sweep('grit', (r) => r.patch.filter!.drive))
  })
})

describe('applyMacros — determinism & independence', () => {
  it('is deterministic for identical input', () => {
    const input = m(0.42, { air: 0.7 })
    expect(applyMacros(input)).toEqual(applyMacros(input))
  })

  it('does not mutate its input', () => {
    const input = m(0.3)
    const snapshot = { ...input }
    applyMacros(input)
    expect(input).toEqual(snapshot)
  })

  it('leaves reverb mix untouched by Glow and reverb size untouched by Air', () => {
    // Glow drives size, Air drives mix — they are independent axes.
    const onlyGlow = applyMacros(m(0, { glow: 1 }))
    const onlyAir = applyMacros(m(0, { air: 1 }))
    expect(onlyGlow.fx.reverb!.mix).toBe(0)
    expect(onlyAir.fx.reverb!.size).toBe(applyMacros(m(0)).fx.reverb!.size)
  })
})
