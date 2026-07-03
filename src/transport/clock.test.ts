import { describe, expect, it } from 'vitest'
import { secondsPerBar, secondsPerBeat, swungBeatTime } from './clock'

describe('secondsPerBeat', () => {
  it('is 0.5s at 120 BPM and 1s at 60 BPM', () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.5, 12)
    expect(secondsPerBeat(60)).toBeCloseTo(1, 12)
  })
})

describe('secondsPerBar', () => {
  it('defaults to 4 beats per bar', () => {
    expect(secondsPerBar(120)).toBeCloseTo(2, 12)
  })

  it('honours an explicit beats-per-bar', () => {
    expect(secondsPerBar(120, 3)).toBeCloseTo(1.5, 12)
    expect(secondsPerBar(60, 7)).toBeCloseTo(7, 12)
  })
})

describe('swungBeatTime', () => {
  it('leaves on-beats (even eighth indices) on the straight grid', () => {
    // eighth = spb/2 = 0.25 at 120 BPM.
    expect(swungBeatTime(0, 120, 1)).toBeCloseTo(0, 12)
    expect(swungBeatTime(2, 120, 1)).toBeCloseTo(0.5, 12)
    expect(swungBeatTime(4, 120, 1)).toBeCloseTo(1.0, 12)
  })

  it('is fully straight when swing is 0', () => {
    // Odd index 1 with no swing = 1 * eighth = 0.25.
    expect(swungBeatTime(1, 120, 0)).toBeCloseTo(0.25, 12)
    expect(swungBeatTime(3, 120, 0)).toBeCloseTo(0.75, 12)
  })

  it('delays off-beats by swing * (spb/3) at max swing', () => {
    const spb = 0.5
    // index 1 base = 0.25, +1*(spb/3).
    expect(swungBeatTime(1, 120, 1)).toBeCloseTo(0.25 + spb / 3, 12)
  })

  it('scales the off-beat delay linearly with swing amount', () => {
    const spb = 0.5
    expect(swungBeatTime(1, 120, 0.5)).toBeCloseTo(0.25 + 0.5 * (spb / 3), 12)
  })

  it('clamps swing into [0,1]', () => {
    expect(swungBeatTime(1, 120, -5)).toBeCloseTo(0.25, 12)
    expect(swungBeatTime(1, 120, 5)).toBeCloseTo(0.25 + 0.5 / 3, 12)
  })
})
