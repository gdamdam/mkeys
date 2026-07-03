import { describe, expect, it } from 'vitest'
import { quantizeGlide, snapToDegree } from './glide'

const QUANTIZE_STEPS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]

describe('quantizeGlide', () => {
  it('returns fromMidi at t=0 for every quantize amount', () => {
    for (const q of QUANTIZE_STEPS) {
      expect(quantizeGlide(60, 67, 0, q)).toBeCloseTo(60, 10)
    }
  })

  it('returns toMidi at t=1 for every quantize amount', () => {
    for (const q of QUANTIZE_STEPS) {
      expect(quantizeGlide(60, 67, 1, q)).toBeCloseTo(67, 10)
    }
  })

  it('is exactly linear when quantize is 0', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const tc = Math.min(t, 1)
      expect(quantizeGlide(60, 72, tc, 0)).toBeCloseTo(60 + 12 * tc, 10)
    }
  })

  it('is stepped when quantize is 1 (mostly fromMidi then toMidi)', () => {
    // Well before the midpoint we sit essentially on the origin degree.
    expect(quantizeGlide(60, 67, 0.2, 1)).toBeCloseTo(60, 3)
    expect(quantizeGlide(60, 67, 0.4, 1)).toBeCloseTo(60, 2)
    // Well after the midpoint we sit essentially on the destination degree.
    expect(quantizeGlide(60, 67, 0.6, 1)).toBeCloseTo(67, 2)
    expect(quantizeGlide(60, 67, 0.8, 1)).toBeCloseTo(67, 3)
    // The transition happens at the midpoint.
    expect(quantizeGlide(60, 67, 0.5, 1)).toBeCloseTo(63.5, 6)
  })

  it('is monotonically non-decreasing in t for an ascending glide', () => {
    for (const q of QUANTIZE_STEPS) {
      let prev = quantizeGlide(60, 67, 0, q)
      for (let t = 0.02; t <= 1.0001; t += 0.02) {
        const v = quantizeGlide(60, 67, Math.min(t, 1), q)
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = v
      }
    }
  })

  it('is monotonically non-increasing in t for a descending glide', () => {
    for (const q of QUANTIZE_STEPS) {
      let prev = quantizeGlide(72, 60, 0, q)
      for (let t = 0.02; t <= 1.0001; t += 0.02) {
        const v = quantizeGlide(72, 60, Math.min(t, 1), q)
        expect(v).toBeLessThanOrEqual(prev + 1e-9)
        prev = v
      }
    }
  })

  it('stays within the endpoint range for every t and quantize', () => {
    const from = 55
    const to = 62
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    for (const q of QUANTIZE_STEPS) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = quantizeGlide(from, to, Math.min(t, 1), q)
        expect(v).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(v).toBeLessThanOrEqual(hi + 1e-9)
      }
    }
  })

  it('clamps t outside the unit interval', () => {
    expect(quantizeGlide(60, 67, -0.5, 0.5)).toBeCloseTo(60, 10)
    expect(quantizeGlide(60, 67, 1.5, 0.5)).toBeCloseTo(67, 10)
  })

  it('clamps quantize outside the unit interval', () => {
    // Below 0 behaves like linear (0).
    expect(quantizeGlide(60, 72, 0.25, -1)).toBeCloseTo(63, 10)
    // Above 1 behaves like fully stepped (1).
    expect(quantizeGlide(60, 72, 0.2, 5)).toBeCloseTo(60, 3)
  })

  it('returns the shared value when both endpoints coincide', () => {
    for (const q of QUANTIZE_STEPS) {
      for (let t = 0; t <= 1.0001; t += 0.1) {
        expect(quantizeGlide(64, 64, Math.min(t, 1), q)).toBeCloseTo(64, 10)
      }
    }
  })

  it('is symmetric about the midpoint (round-trip)', () => {
    // Progress p from A->B should mirror progress (1-p) from B->A.
    for (const q of QUANTIZE_STEPS) {
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const fwd = quantizeGlide(60, 72, t, q)
        const bwd = quantizeGlide(72, 60, 1 - t, q)
        expect(fwd).toBeCloseTo(bwd, 9)
      }
    }
  })
})

describe('snapToDegree', () => {
  it('snaps to the nearest degree in the set', () => {
    const degrees = [60, 62, 64, 65, 67]
    expect(snapToDegree(60.4, degrees)).toBe(60)
    expect(snapToDegree(61.4, degrees)).toBe(62)
    expect(snapToDegree(66.6, degrees)).toBe(67)
  })

  it('returns an exact match unchanged', () => {
    expect(snapToDegree(64, [60, 64, 67])).toBe(64)
  })

  it('handles fractional MIDI input', () => {
    expect(snapToDegree(63.9, [60, 64, 67])).toBe(64)
  })

  it('works with an unsorted degree set', () => {
    expect(snapToDegree(66, [67, 60, 64])).toBe(67)
  })

  it('resolves exact ties to the lower degree deterministically', () => {
    // 63 is equidistant from 62 and 64.
    expect(snapToDegree(63, [62, 64])).toBe(62)
  })

  it('returns the input unchanged for an empty degree set', () => {
    expect(snapToDegree(61.7, [])).toBe(61.7)
  })

  it('handles out-of-range values by clamping to the extremes', () => {
    const degrees = [60, 62, 64]
    expect(snapToDegree(40, degrees)).toBe(60)
    expect(snapToDegree(90, degrees)).toBe(64)
  })
})
