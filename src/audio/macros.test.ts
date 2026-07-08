import { describe, expect, it } from 'vitest'
import type { Macros } from '../types'
import { defaultSession } from '../persistence/session'
import { applyMacros, composeMacros } from './macros'

/** Build a Macros with all knobs at `v` unless overridden. */
function m(v: number, over: Partial<Macros> = {}): Macros {
  return { glow: v, motion: v, air: v, grit: v, ...over }
}

const SAMPLES = [0, 0.25, 0.5, 0.75, 1]

/** A complete, valid base patch/fx to layer macro offsets onto. */
function base(): { patch: ReturnType<typeof defaultSession>['patch']; fx: ReturnType<typeof defaultSession>['fx'] } {
  const s = defaultSession()
  return { patch: s.patch, fx: s.fx }
}

describe('applyMacros — offsets', () => {
  it('is all-zero when every macro is 0, so neutral macros are a no-op', () => {
    expect(applyMacros(m(0))).toEqual({
      filter: { cutoff: 0, resonance: 0, drive: 0 },
      lfo: { rate: 0, depth: 0 },
      subLevel: 0,
      fx: { drive: 0, chorus: 0 },
      delay: { feedback: 0, mix: 0 },
      reverb: { size: 0, mix: 0 },
    })
  })

  it('keeps every offset non-negative and 0..1-bounded (cutoff/rate in Hz) for all sweeps', () => {
    for (const v of SAMPLES) {
      const o = applyMacros(m(v))
      for (const x of [
        o.filter.resonance, o.filter.drive, o.lfo.depth, o.subLevel,
        o.fx.drive, o.fx.chorus, o.delay.feedback, o.delay.mix, o.reverb.size, o.reverb.mix,
      ]) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
      }
      expect(o.filter.cutoff).toBeGreaterThanOrEqual(0)
      expect(o.lfo.rate).toBeGreaterThanOrEqual(0)
    }
  })

  it('clamps out-of-range macro inputs instead of leaking them', () => {
    const o = applyMacros({ glow: -5, motion: 9, air: -1, grit: 100 })
    expect(o.filter.resonance).toBeCloseTo(0.7) // grit clamps to 1
    expect(o.fx.drive).toBeCloseTo(0.8)
    expect(o.reverb.mix).toBe(0) // air clamps to 0
    expect(o.subLevel).toBe(0) // glow clamps to 0
  })
})

describe('applyMacros — monotonicity', () => {
  function sweep(knob: keyof Macros, read: (o: ReturnType<typeof applyMacros>) => number): number[] {
    return SAMPLES.map((v) => read(applyMacros(m(0, { [knob]: v }))))
  }
  function assertIncreasing(xs: number[]): void {
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
  }

  it('Glow raises warmth: subLevel, reverb size, cutoff', () => {
    assertIncreasing(sweep('glow', (o) => o.subLevel))
    assertIncreasing(sweep('glow', (o) => o.reverb.size))
    assertIncreasing(sweep('glow', (o) => o.filter.cutoff))
  })

  it('Motion raises movement: lfo rate/depth, chorus, delay mix/feedback', () => {
    assertIncreasing(sweep('motion', (o) => o.lfo.rate))
    assertIncreasing(sweep('motion', (o) => o.lfo.depth))
    assertIncreasing(sweep('motion', (o) => o.fx.chorus))
    assertIncreasing(sweep('motion', (o) => o.delay.mix))
    assertIncreasing(sweep('motion', (o) => o.delay.feedback))
  })

  it('Air raises high-end/space: cutoff and reverb mix', () => {
    assertIncreasing(sweep('air', (o) => o.filter.cutoff))
    assertIncreasing(sweep('air', (o) => o.reverb.mix))
  })

  it('Grit raises dirt: fx drive, filter resonance and filter drive', () => {
    assertIncreasing(sweep('grit', (o) => o.fx.drive))
    assertIncreasing(sweep('grit', (o) => o.filter.resonance))
    assertIncreasing(sweep('grit', (o) => o.filter.drive))
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
    expect(applyMacros(m(0, { glow: 1 })).reverb.mix).toBe(0)
    expect(applyMacros(m(0, { air: 1 })).reverb.size).toBe(0)
  })
})

describe('composeMacros — additive layering', () => {
  it('neutral macros return the base patch/fx unchanged', () => {
    const b = base()
    const c = composeMacros(b, m(0))
    expect(c.patch).toEqual(b.patch)
    expect(c.fx).toEqual(b.fx)
  })

  it('adds the macro offset on top of the base — a manual edit stays audible', () => {
    const b = base()
    // Glow=1 adds +2200 Hz to whatever the base cutoff is.
    expect(composeMacros(b, m(0, { glow: 1 })).patch.filter.cutoff).toBeCloseTo(
      b.patch.filter.cutoff + 2200,
    )
    // A manually edited base cutoff is not clobbered: it sums with the macro.
    const edited = { patch: { ...b.patch, filter: { ...b.patch.filter, cutoff: 1000 } }, fx: b.fx }
    expect(composeMacros(edited, m(0, { glow: 1 })).patch.filter.cutoff).toBeCloseTo(3200)
  })

  it('clamps the composed value to the field range', () => {
    const b = base()
    const hotCutoff = { patch: { ...b.patch, filter: { ...b.patch.filter, cutoff: 19000 } }, fx: b.fx }
    expect(composeMacros(hotCutoff, m(1)).patch.filter.cutoff).toBeLessThanOrEqual(20000)
    const hotDrive = { patch: b.patch, fx: { ...b.fx, drive: 0.9 } }
    expect(composeMacros(hotDrive, m(0, { grit: 1 })).fx.drive).toBe(1)
  })

  it('leaves fields no macro expresses untouched (envAmount, lfo.target, delay.time)', () => {
    const b = base()
    const c = composeMacros(b, m(1))
    expect(c.patch.filter.envAmount).toBe(b.patch.filter.envAmount)
    expect(c.patch.lfo.target).toBe(b.patch.lfo.target)
    expect(c.fx.delay.time).toBe(b.fx.delay.time)
  })

  it('does not mutate the base patch/fx', () => {
    const b = base()
    const snapshot = JSON.parse(JSON.stringify(b))
    composeMacros(b, m(1))
    expect(b).toEqual(snapshot)
  })
})
