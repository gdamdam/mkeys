import { describe, expect, it } from 'vitest'
import { glidePitch, slideColumnOffset } from './surfaceMath'

describe('slideColumnOffset', () => {
  it('is 0 at the centre of the origin column', () => {
    // 8 cols, origin col 3 -> centre at x = (3 + 0.5) / 8 = 0.4375
    expect(slideColumnOffset(0.4375, 3, 8)).toBeCloseTo(0)
  })

  it('is +1 one column to the right', () => {
    expect(slideColumnOffset((4 + 0.5) / 8, 3, 8)).toBeCloseTo(1)
  })

  it('is -1 one column to the left', () => {
    expect(slideColumnOffset((2 + 0.5) / 8, 3, 8)).toBeCloseTo(-1)
  })

  it('clamps x into range and guards zero cols', () => {
    expect(Number.isFinite(slideColumnOffset(2, 0, 0))).toBe(true)
    expect(Number.isFinite(slideColumnOffset(-1, 0, 4))).toBe(true)
  })
})

describe('glidePitch', () => {
  it('returns the origin pitch with no offset', () => {
    expect(glidePitch(60, 62, 0, 0.5)).toBeCloseTo(60)
  })

  it('reaches the target pitch at a full column offset', () => {
    expect(glidePitch(60, 62, 1, 0)).toBeCloseTo(62)
    expect(glidePitch(60, 62, -1, 0)).toBeCloseTo(62)
  })

  it('glides continuously with no quantization (linear)', () => {
    expect(glidePitch(60, 62, 0.5, 0)).toBeCloseTo(61)
  })

  it('holds near the origin longer as quantization rises', () => {
    const free = glidePitch(60, 62, 0.25, 0)
    const snapped = glidePitch(60, 62, 0.25, 1)
    // With heavy quantization the quarter-point pitch stays much closer to the origin.
    expect(snapped - 60).toBeLessThan(free - 60)
  })

  it('produces no bend when the target equals the origin (grid edge)', () => {
    expect(glidePitch(60, 60, 0.8, 0.5)).toBeCloseTo(60)
  })
})
