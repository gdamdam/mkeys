import { describe, expect, it } from 'vitest'

import { pitchBendBytes } from './emit'
import {
  bendForSemitones,
  MPE_BEND_RANGE_SEMITONES,
  MPE_MEMBER_CHANNELS,
  MpeAllocator,
} from './mpe'

describe('bendForSemitones', () => {
  it('maps zero deviation to centre', () => {
    expect(bendForSemitones(0)).toBe(0)
  })

  it('scales a semitone offset by the bend range', () => {
    // Half a semitone (a maximal microtuning offset) over ±48 st.
    expect(bendForSemitones(0.5)).toBeCloseTo(0.5 / MPE_BEND_RANGE_SEMITONES, 12)
    expect(bendForSemitones(-0.5)).toBeCloseTo(-0.5 / MPE_BEND_RANGE_SEMITONES, 12)
  })

  it('clamps offsets beyond the bend range to ±1', () => {
    expect(bendForSemitones(96)).toBe(1)
    expect(bendForSemitones(-96)).toBe(-1)
  })

  it('produces a valid pitch-bend message round-trip', () => {
    const [, lsb, msb] = pitchBendBytes(bendForSemitones(0.25), 1)
    expect(lsb).toBeGreaterThanOrEqual(0)
    expect(lsb).toBeLessThanOrEqual(0x7f)
    expect(msb).toBeGreaterThanOrEqual(0)
    expect(msb).toBeLessThanOrEqual(0x7f)
  })
})

describe('MpeAllocator', () => {
  it('assigns distinct member channels to distinct voices', () => {
    const a = new MpeAllocator()
    const c1 = a.acquire(1)
    const c2 = a.acquire(2)
    expect(c1.evicted).toBeNull()
    expect(c2.evicted).toBeNull()
    expect(c1.channel).not.toBe(c2.channel)
    expect(MPE_MEMBER_CHANNELS).toContain(c1.channel)
    expect(MPE_MEMBER_CHANNELS).toContain(c2.channel)
  })

  it('reuses the same channel when a voice re-acquires', () => {
    const a = new MpeAllocator()
    const first = a.acquire(7).channel
    expect(a.acquire(7)).toEqual({ channel: first, evicted: null })
    expect(a.activeCount()).toBe(1)
  })

  it('frees a channel on release so it can be handed out again', () => {
    const a = new MpeAllocator([1, 2])
    a.acquire(1)
    const second = a.acquire(2).channel
    a.release(1)
    // The freed channel (not the still-held one) is offered next.
    expect(a.acquire(3).channel).not.toBe(second)
    expect(a.acquire(3).evicted).toBeNull()
  })

  it('steals the least-recently-acquired channel when all are busy', () => {
    const a = new MpeAllocator([1, 2])
    const c1 = a.acquire(10).channel
    a.acquire(11)
    const stolen = a.acquire(12)
    // Voice 10 was oldest → evicted; its channel is reused.
    expect(stolen.evicted).toBe(10)
    expect(stolen.channel).toBe(c1)
    expect(a.activeCount()).toBe(2)
  })

  it('re-acquiring refreshes recency so a touched voice is not the next victim', () => {
    const a = new MpeAllocator([1, 2])
    a.acquire(10)
    a.acquire(11)
    a.acquire(10) // touch 10 → 11 becomes oldest
    expect(a.acquire(12).evicted).toBe(11)
  })

  it('clears all assignments', () => {
    const a = new MpeAllocator()
    a.acquire(1)
    a.acquire(2)
    a.clear()
    expect(a.activeCount()).toBe(0)
  })

  it('release of an unknown voice is a no-op', () => {
    const a = new MpeAllocator()
    a.acquire(1)
    a.release(999)
    expect(a.activeCount()).toBe(1)
  })
})
