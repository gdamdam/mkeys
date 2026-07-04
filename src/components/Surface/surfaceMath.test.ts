import { describe, expect, it } from 'vitest'
import { columnSpanAt, glidePitch, slideColumnOffset } from './surfaceMath'

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

describe('columnSpanAt', () => {
  // 8 columns: centres at x = (col + 0.5) / 8.
  const cx = (col: number, cols = 8): number => (col + 0.5) / cols

  it('sits exactly on a column centre with zero progress', () => {
    expect(columnSpanAt(cx(3), 8)).toEqual({ from: 3, to: 4, t: expect.closeTo(0) })
  })

  it('is halfway between two adjacent centres at t = 0.5', () => {
    expect(columnSpanAt((cx(3) + cx(4)) / 2, 8)).toEqual({
      from: 3,
      to: 4,
      t: expect.closeTo(0.5),
    })
  })

  it('spans several columns as x travels (multi-note glide)', () => {
    // Between col 5 and col 6, 30% of the way.
    const x = cx(5) + 0.3 / 8
    expect(columnSpanAt(x, 8)).toEqual({ from: 5, to: 6, t: expect.closeTo(0.3) })
  })

  it('holds on the first column left of its centre', () => {
    const span = columnSpanAt(0, 8)
    expect(span.from).toBe(0)
    expect(span.t).toBeCloseTo(0)
  })

  it('holds on the last column right of its centre', () => {
    const span = columnSpanAt(1, 8)
    expect(span.from).toBe(7)
    expect(span.to).toBe(7)
  })

  it('clamps x into range and guards zero cols', () => {
    expect(() => columnSpanAt(2, 0)).not.toThrow()
    const span = columnSpanAt(-1, 4)
    expect(span.from).toBe(0)
    expect(span.t).toBeCloseTo(0)
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
