import { describe, expect, it } from 'vitest'
import type { ArpConfig } from '../types'
import { generateArpSequence, mulberry32, stepsFor } from './arp'

/** Base config helper; individual tests override fields as needed. */
function cfg(over: Partial<ArpConfig> = {}): ArpConfig {
  return {
    enabled: true,
    mode: 'up',
    division: 4,
    gate: 0.5,
    swing: 0,
    octaves: 1,
    ...over,
  }
}

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('emits values in [0, 1)', () => {
    const rng = mulberry32(999)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1)()
    const b = mulberry32(2)()
    expect(a).not.toBe(b)
  })
})

describe('generateArpSequence — empty input', () => {
  it('returns [] for no held notes', () => {
    expect(generateArpSequence([], cfg(), 0)).toEqual([])
  })

  it('returns [] regardless of octaves/mode', () => {
    expect(generateArpSequence([], cfg({ mode: 'random', octaves: 4 }), 42)).toEqual([])
  })
})

describe('generateArpSequence — up / down ordering', () => {
  const notes = [64, 60, 67] // deliberately unsorted

  it('up sorts ascending', () => {
    expect(generateArpSequence(notes, cfg({ mode: 'up' }), 0)).toEqual([60, 64, 67])
  })

  it('down sorts descending', () => {
    expect(generateArpSequence(notes, cfg({ mode: 'down' }), 0)).toEqual([67, 64, 60])
  })

  it('single note yields that note', () => {
    expect(generateArpSequence([72], cfg({ mode: 'up' }), 0)).toEqual([72])
    expect(generateArpSequence([72], cfg({ mode: 'down' }), 0)).toEqual([72])
  })
})

describe('generateArpSequence — octaves expansion', () => {
  const notes = [60, 64, 67]

  it('stacks copies +12 per extra octave (up)', () => {
    expect(generateArpSequence(notes, cfg({ mode: 'up', octaves: 2 }), 0)).toEqual([
      60, 64, 67, 72, 76, 79,
    ])
  })

  it('count == notes * octaves for up/down', () => {
    for (const octaves of [1, 2, 3, 4]) {
      const seq = generateArpSequence(notes, cfg({ mode: 'up', octaves }), 0)
      expect(seq).toHaveLength(notes.length * octaves)
    }
  })

  it('octaves < 1 is treated as 1', () => {
    expect(generateArpSequence(notes, cfg({ mode: 'up', octaves: 0 }), 0)).toEqual([60, 64, 67])
  })

  it('down expands over octaves descending', () => {
    expect(generateArpSequence(notes, cfg({ mode: 'down', octaves: 2 }), 0)).toEqual([
      79, 76, 72, 67, 64, 60,
    ])
  })
})

describe('generateArpSequence — updown', () => {
  it('does not duplicate top or bottom endpoints', () => {
    const seq = generateArpSequence([60, 64, 67], cfg({ mode: 'updown' }), 0)
    // up: 60 64 67, then down without repeating 67 or wrapping to repeat 60: 64
    expect(seq).toEqual([60, 64, 67, 64])
  })

  it('updown with octaves keeps single endpoints across full range', () => {
    const seq = generateArpSequence([60, 64], cfg({ mode: 'updown', octaves: 2 }), 0)
    // ascending: 60 64 72 76 ; descending body: 72 64
    expect(seq).toEqual([60, 64, 72, 76, 72, 64])
  })

  it('single note updown yields just that note (no duplicate)', () => {
    expect(generateArpSequence([60], cfg({ mode: 'updown' }), 0)).toEqual([60])
  })

  it('two notes updown has no endpoint duplication', () => {
    expect(generateArpSequence([60, 64], cfg({ mode: 'updown' }), 0)).toEqual([60, 64])
  })
})

describe('generateArpSequence — random determinism', () => {
  const notes = [60, 62, 64, 65, 67]

  it('same seed → same output', () => {
    const a = generateArpSequence(notes, cfg({ mode: 'random' }), 7)
    const b = generateArpSequence(notes, cfg({ mode: 'random' }), 7)
    expect(a).toEqual(b)
  })

  it('different seed → (very likely) different output', () => {
    const a = generateArpSequence(notes, cfg({ mode: 'random' }), 7)
    const b = generateArpSequence(notes, cfg({ mode: 'random' }), 8)
    expect(a).not.toEqual(b)
  })

  it('is a permutation of the expanded pool (no lost/added notes)', () => {
    const seq = generateArpSequence(notes, cfg({ mode: 'random', octaves: 2 }), 3)
    const pool = [...notes, ...notes.map((n) => n + 12)]
    expect(seq).toHaveLength(pool.length)
    expect([...seq].sort((x, y) => x - y)).toEqual([...pool].sort((x, y) => x - y))
  })
})

describe('stepsFor', () => {
  it('up/down: notes count is caller-provided via multiply; base is octaves*perCycle', () => {
    expect(stepsFor(cfg({ mode: 'up', octaves: 1 }), 3)).toBe(3)
    expect(stepsFor(cfg({ mode: 'up', octaves: 2 }), 3)).toBe(6)
  })

  it('updown: 2*range - 2 for range > 1', () => {
    // range = notes*octaves = 3 → 2*3-2 = 4
    expect(stepsFor(cfg({ mode: 'updown', octaves: 1 }), 3)).toBe(4)
  })

  it('updown: range 1 → 1 (no duplication)', () => {
    expect(stepsFor(cfg({ mode: 'updown', octaves: 1 }), 1)).toBe(1)
  })

  it('random matches range count', () => {
    expect(stepsFor(cfg({ mode: 'random', octaves: 2 }), 4)).toBe(8)
  })

  it('empty note count → 0', () => {
    expect(stepsFor(cfg({ mode: 'updown' }), 0)).toBe(0)
  })
})
