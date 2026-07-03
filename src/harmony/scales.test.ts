import { describe, expect, it } from 'vitest'
import { MODES } from '../types'
import {
  SCALE_TABLE,
  degreeToMidi,
  midiToNearestDegree,
  mod12,
  scaleDegreeOf,
  scalePitchClasses,
} from './scales'

describe('mod12', () => {
  it('normalises positive, negative and large integers to 0..11', () => {
    expect(mod12(0)).toBe(0)
    expect(mod12(12)).toBe(0)
    expect(mod12(13)).toBe(1)
    expect(mod12(-1)).toBe(11)
    expect(mod12(-13)).toBe(11)
    expect(mod12(25)).toBe(1)
  })
})

describe('SCALE_TABLE', () => {
  it('covers every mode in MODES', () => {
    for (const mode of MODES) {
      expect(SCALE_TABLE[mode]).toBeDefined()
      expect(SCALE_TABLE[mode].length).toBeGreaterThan(0)
    }
  })

  it('has the canonical heptatonic contents', () => {
    expect(SCALE_TABLE.major).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(SCALE_TABLE['natural-minor']).toEqual([0, 2, 3, 5, 7, 8, 10])
    expect(SCALE_TABLE.dorian).toEqual([0, 2, 3, 5, 7, 9, 10])
    expect(SCALE_TABLE.mixolydian).toEqual([0, 2, 4, 5, 7, 9, 10])
    expect(SCALE_TABLE.phrygian).toEqual([0, 1, 3, 5, 7, 8, 10])
    expect(SCALE_TABLE.lydian).toEqual([0, 2, 4, 6, 7, 9, 11])
    expect(SCALE_TABLE['harmonic-minor']).toEqual([0, 2, 3, 5, 7, 8, 11])
  })

  it('has correct pentatonic and blues contents/lengths', () => {
    expect(SCALE_TABLE['pentatonic-major']).toEqual([0, 2, 4, 7, 9])
    expect(SCALE_TABLE['pentatonic-minor']).toEqual([0, 3, 5, 7, 10])
    expect(SCALE_TABLE.blues).toEqual([0, 3, 5, 6, 7, 10])
    expect(SCALE_TABLE['pentatonic-major']).toHaveLength(5)
    expect(SCALE_TABLE['pentatonic-minor']).toHaveLength(5)
    expect(SCALE_TABLE.blues).toHaveLength(6)
  })

  it('has strictly ascending intervals within [0, 12) for every mode', () => {
    for (const mode of MODES) {
      const iv = SCALE_TABLE[mode]
      for (let i = 0; i < iv.length; i++) {
        expect(iv[i]).toBeGreaterThanOrEqual(0)
        expect(iv[i]).toBeLessThan(12)
        if (i > 0) expect(iv[i]).toBeGreaterThan(iv[i - 1])
      }
    }
  })
})

describe('scalePitchClasses', () => {
  it('roots the scale correctly (C major)', () => {
    expect(scalePitchClasses(0, 'major')).toEqual([0, 2, 4, 5, 7, 9, 11])
  })

  it('wraps pitch classes for a non-zero root (A major)', () => {
    // A=9: 9,11,1,2,4,6,8
    expect(scalePitchClasses(9, 'major')).toEqual([9, 11, 1, 2, 4, 6, 8])
  })

  it('handles pentatonic-minor at G (7)', () => {
    // 7,10,0,2,5
    expect(scalePitchClasses(7, 'pentatonic-minor')).toEqual([7, 10, 0, 2, 5])
  })
})

describe('scaleDegreeOf', () => {
  it('returns 0-based degree of a diatonic pitch', () => {
    expect(scaleDegreeOf(0, 0, 'major')).toBe(0)
    expect(scaleDegreeOf(7, 0, 'major')).toBe(4)
    expect(scaleDegreeOf(11, 0, 'major')).toBe(6)
  })

  it('accepts pitch classes given as out-of-range integers', () => {
    expect(scaleDegreeOf(12, 0, 'major')).toBe(0)
    expect(scaleDegreeOf(-1, 0, 'major')).toBe(6)
  })

  it('returns null for a non-diatonic pitch', () => {
    expect(scaleDegreeOf(1, 0, 'major')).toBeNull()
    expect(scaleDegreeOf(6, 0, 'major')).toBeNull()
  })
})

describe('degreeToMidi', () => {
  it('maps degree 0 to the root at baseOctave (C4 = 60)', () => {
    expect(degreeToMidi(0, 0, 'major', 4)).toBe(60)
  })

  it('follows the scale intervals within one octave', () => {
    // C major from C4
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => degreeToMidi(d, 0, 'major', 4))).toEqual(
      [60, 62, 64, 65, 67, 69, 71],
    )
  })

  it('wraps to the next octave for degrees >= scale length', () => {
    // degree 7 of major = octave above degree 0
    expect(degreeToMidi(7, 0, 'major', 4)).toBe(72)
    // pentatonic-major length 5 -> degree 5 is an octave up
    expect(degreeToMidi(5, 0, 'pentatonic-major', 4)).toBe(72)
  })

  it('wraps downward for negative degrees', () => {
    // degree -1 of major = leading tone an octave below (B3 = 59)
    expect(degreeToMidi(-1, 0, 'major', 4)).toBe(59)
    // degree -7 is a full octave below degree 0
    expect(degreeToMidi(-7, 0, 'major', 4)).toBe(48)
  })

  it('respects a non-zero root', () => {
    // A4 root = 69
    expect(degreeToMidi(0, 9, 'major', 4)).toBe(69)
  })

  it('is monotonic increasing in degree across many octaves', () => {
    for (const mode of MODES) {
      let prev = -Infinity
      for (let d = -20; d <= 20; d++) {
        const m = degreeToMidi(d, 3, mode, 4)
        expect(m).toBeGreaterThan(prev)
        prev = m
      }
    }
  })

  it('advances by exactly 12 semitones per full scale cycle', () => {
    for (const mode of MODES) {
      const len = SCALE_TABLE[mode].length
      expect(degreeToMidi(len, 0, mode, 4) - degreeToMidi(0, 0, mode, 4)).toBe(12)
    }
  })
})

describe('midiToNearestDegree', () => {
  it('round-trips exact scale tones back to their degree', () => {
    for (const mode of MODES) {
      for (let d = -12; d <= 12; d++) {
        const midi = degreeToMidi(d, 5, mode, 4)
        expect(midiToNearestDegree(midi, 5, mode)).toBe(d)
      }
    }
  })

  it('snaps a non-scale midi to the nearest degree', () => {
    // C4=60 is degree 0, D4=62 is degree 1 in C major. C#4=61 -> nearest is 0 or 1.
    const near = midiToNearestDegree(61, 0, 'major')
    expect([0, 1]).toContain(near)
    expect(Math.abs(degreeToMidi(near, 0, 'major', 4) - 61)).toBeLessThanOrEqual(1)
  })

  it('finds the truly nearest degree for a distant midi', () => {
    // pick an arbitrary midi and verify no other degree is closer
    const mode = 'blues'
    const root = 2
    const target = 83
    const d = midiToNearestDegree(target, root, mode)
    const best = Math.abs(degreeToMidi(d, root, mode, 4) - target)
    for (let o = -3; o <= 3; o++) {
      const alt = Math.abs(degreeToMidi(d + o, root, mode, 4) - target)
      expect(best).toBeLessThanOrEqual(alt)
    }
  })
})
