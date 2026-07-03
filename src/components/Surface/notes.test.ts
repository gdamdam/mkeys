import { describe, expect, it } from 'vitest'
import { centsOffset, formatCents, midiToNoteName } from './notes'

describe('midiToNoteName', () => {
  it('names the MIDI reference octave (C4 = 60)', () => {
    expect(midiToNoteName(60)).toBe('C4')
    expect(midiToNoteName(69)).toBe('A4')
  })

  it('spells sharps', () => {
    expect(midiToNoteName(61)).toBe('C#4')
    expect(midiToNoteName(66)).toBe('F#4')
  })

  it('rounds fractional pitches to the nearest semitone', () => {
    expect(midiToNoteName(60.2)).toBe('C4')
    expect(midiToNoteName(60.6)).toBe('C#4')
  })

  it('handles low and high octaves', () => {
    expect(midiToNoteName(0)).toBe('C-1')
    expect(midiToNoteName(127)).toBe('G9')
  })
})

describe('centsOffset', () => {
  it('is 0 for an exact semitone', () => {
    expect(centsOffset(60)).toBe(0)
  })

  it('reports positive cents above the semitone', () => {
    expect(centsOffset(60.12)).toBe(12)
  })

  it('reports negative cents below the semitone', () => {
    expect(centsOffset(59.95)).toBe(-5)
  })

  it('stays within [-50, 50]', () => {
    for (let p = 60; p <= 61; p += 0.01) {
      const c = centsOffset(p)
      expect(c).toBeGreaterThanOrEqual(-50)
      expect(c).toBeLessThanOrEqual(50)
    }
  })
})

describe('formatCents', () => {
  it('formats zero without a sign', () => {
    expect(formatCents(0)).toBe('0')
  })

  it('prefixes a plus for positive', () => {
    expect(formatCents(12)).toBe('+12')
  })

  it('keeps the minus for negative', () => {
    expect(formatCents(-5)).toBe('-5')
  })
})
