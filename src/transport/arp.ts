/**
 * Seeded arpeggiator pattern generation.
 *
 * Pure and framework-free: no `Math.random`, no timers, no audio. Given the set
 * of currently held MIDI notes and an {@link ArpConfig}, produces the ordered
 * stream of MIDI notes for exactly one cycle. Randomness is driven by an
 * explicit seed so a session/share link reproduces the same pattern bit-for-bit.
 */

import type { ArpConfig } from '../types'

/**
 * Mulberry32 PRNG. Fast, deterministic, seedable. Returns a function that
 * yields the next float in [0, 1) each call. Used instead of `Math.random` so
 * arp output is reproducible from a seed.
 */
export function mulberry32(seed: number): () => number {
  // Coerce to a 32-bit unsigned state so callers can pass any integer seed.
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Clamp octaves to a sane minimum of 1 (0/negative would erase the pattern). */
function normOctaves(octaves: number): number {
  return octaves >= 1 ? Math.floor(octaves) : 1
}

/**
 * Build the ascending "pool" of notes across all octaves: the sorted held notes
 * repeated once per octave, each repetition transposed +12 semitones.
 */
function buildPool(notes: number[], octaves: number): number[] {
  const base = [...notes].sort((a, b) => a - b)
  const pool: number[] = []
  for (let o = 0; o < octaves; o++) {
    const shift = o * 12
    for (const n of base) pool.push(n + shift)
  }
  return pool
}

/**
 * Number of steps one cycle produces for a given config and held-note count.
 * `noteCount` is passed explicitly because config carries no note set.
 */
export function stepsFor(config: ArpConfig, noteCount: number): number {
  if (noteCount <= 0) return 0
  const range = noteCount * normOctaves(config.octaves)
  if (config.mode === 'updown') {
    // Fold back without repeating the two endpoints: up (range) + down (range-2).
    return range > 1 ? range * 2 - 2 : range
  }
  return range
}

/**
 * Generate the ordered MIDI note stream for one arpeggiator cycle.
 *
 * - `up`     ascending pool.
 * - `down`   descending pool.
 * - `updown` up then back down, without duplicating the top/bottom notes.
 * - `random` a deterministic (seeded) shuffle of the pool.
 *
 * Returns `[]` for empty input.
 */
export function generateArpSequence(
  notes: number[],
  config: ArpConfig,
  seed: number,
): number[] {
  if (notes.length === 0) return []

  const octaves = normOctaves(config.octaves)
  const pool = buildPool(notes, octaves)

  switch (config.mode) {
    case 'up':
      return pool
    case 'down':
      return [...pool].reverse()
    case 'updown': {
      if (pool.length <= 1) return pool
      // Descending body excludes both endpoints to avoid repeats at the turns.
      const down = [...pool].slice(1, -1).reverse()
      return [...pool, ...down]
    }
    case 'random':
      return shuffle(pool, seed)
    default: {
      // Exhaustiveness guard: every ArpConfig['mode'] is handled above.
      const _exhaustive: never = config.mode
      return _exhaustive
    }
  }
}

/**
 * Fisher–Yates shuffle driven by the seeded PRNG. Returns a new array that is a
 * permutation of `pool`; identical for identical seeds.
 */
function shuffle(pool: number[], seed: number): number[] {
  const rng = mulberry32(seed)
  const out = [...pool]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}
