import { describe, expect, it } from 'vitest'
import { degreeColor, glideColor } from './palette'

/** hsl(H S% L%) or hsl(H S% L% / A) — the shapes this module emits. */
const HSL = /^hsl\(\d+(?:\.\d+)?\s\d+(?:\.\d+)?%\s\d+(?:\.\d+)?%(?:\s\/\s\d(?:\.\d+)?)?\)$/

/** Parse "hsl(H S% L%)" into numeric components for assertions. */
function parse(color: string): { h: number; s: number; l: number } {
  const m = color.match(/^hsl\(([\d.]+)\s([\d.]+)%\s([\d.]+)%/)
  if (!m) throw new Error(`unparseable color: ${color}`)
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) }
}

describe('degreeColor', () => {
  it('returns a valid hsl() string', () => {
    expect(degreeColor(0, 7)).toMatch(HSL)
    expect(degreeColor(3, 7, { tonic: true })).toMatch(HSL)
    expect(degreeColor(5, 7, { active: true })).toMatch(HSL)
  })

  it('covers the full scaleLength range with valid, in-gamut colours', () => {
    for (const len of [1, 5, 6, 7, 12]) {
      for (let i = 0; i < len; i++) {
        const c = degreeColor(i, len)
        expect(c).toMatch(HSL)
        const { h, s, l } = parse(c)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThan(360)
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(100)
        expect(l).toBeGreaterThanOrEqual(0)
        expect(l).toBeLessThanOrEqual(100)
      }
    }
  })

  it('keeps base saturation in the muted 45–60% band', () => {
    for (let i = 0; i < 7; i++) {
      const { s } = parse(degreeColor(i, 7))
      expect(s).toBeGreaterThanOrEqual(45)
      expect(s).toBeLessThanOrEqual(60)
    }
  })

  it('emphasises the tonic (more saturated and lighter than a plain degree)', () => {
    const plain = parse(degreeColor(0, 7))
    const tonic = parse(degreeColor(0, 7, { tonic: true }))
    expect(tonic.s).toBeGreaterThan(plain.s)
    expect(tonic.l).toBeGreaterThan(plain.l)
  })

  it('brightens an active pad', () => {
    const plain = parse(degreeColor(2, 7))
    const active = parse(degreeColor(2, 7, { active: true }))
    expect(active.l).toBeGreaterThan(plain.l)
  })

  it('rotates hue across the scale (degrees differ from each other)', () => {
    const hues = Array.from({ length: 7 }, (_, i) => parse(degreeColor(i, 7)).h)
    const unique = new Set(hues)
    expect(unique.size).toBe(7)
    // Degree 0 sits at the warm anchor; a later degree has advanced round the wheel.
    expect(hues[0]).not.toBe(hues[4])
  })

  it('is deterministic for identical inputs', () => {
    expect(degreeColor(4, 7, { tonic: true, active: true })).toBe(
      degreeColor(4, 7, { tonic: true, active: true }),
    )
  })

  it('wraps out-of-range and coerces degenerate inputs instead of NaN', () => {
    expect(degreeColor(9, 7)).toBe(degreeColor(2, 7)) // 9 mod 7 = 2
    expect(degreeColor(-1, 7)).toBe(degreeColor(6, 7)) // negative wraps
    expect(degreeColor(0, 0)).toMatch(HSL) // scaleLength coerced to 1
    expect(degreeColor(Number.NaN, Number.NaN)).toMatch(HSL)
  })
})

describe('glideColor', () => {
  it('returns a valid hsl() string with alpha', () => {
    expect(glideColor(0.5)).toMatch(HSL)
    expect(glideColor()).toMatch(HSL)
  })

  it('clamps alpha into 0..1 and is deterministic', () => {
    expect(glideColor(2)).toBe(glideColor(1))
    expect(glideColor(-1)).toBe(glideColor(0))
    expect(glideColor(0.3)).toBe(glideColor(0.3))
  })
})
