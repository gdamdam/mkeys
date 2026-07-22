import { describe, expect, it } from 'vitest'
import {
  boundaryDelayBeats,
  gridIntervalBeats,
  nextBoundaryBeat,
  snapBeat,
  PLAY_GRIDS,
  PLAY_TIMING_MODES,
} from './playQuantize'

describe('gridIntervalBeats (§24)', () => {
  it('maps every grid to its beat interval (4/4)', () => {
    expect(gridIntervalBeats('off', 4)).toBe(0)
    expect(gridIntervalBeats('1/16', 4)).toBe(0.25)
    expect(gridIntervalBeats('1/8', 4)).toBe(0.5)
    expect(gridIntervalBeats('1/4', 4)).toBe(1)
    expect(gridIntervalBeats('beat', 4)).toBe(1)
    expect(gridIntervalBeats('bar', 4)).toBe(4)
  })
  it('tracks beatsPerBar for the bar grid', () => {
    expect(gridIntervalBeats('bar', 3)).toBe(3)
  })
})

describe('nextBoundaryBeat (§24)', () => {
  it('returns a position exactly on a boundary unchanged (fires immediately)', () => {
    expect(nextBoundaryBeat(0, 1)).toBe(0)
    expect(nextBoundaryBeat(1, 1)).toBe(1)
    expect(nextBoundaryBeat(2, 1)).toBe(2)
    expect(nextBoundaryBeat(0.5, 0.25)).toBe(0.5)
  })
  it('rounds up just before and just after a boundary', () => {
    expect(nextBoundaryBeat(0.999, 1)).toBe(1)
    expect(nextBoundaryBeat(1.001, 1)).toBeCloseTo(2, 9)
    expect(nextBoundaryBeat(0.26, 0.25)).toBeCloseTo(0.5, 9)
  })
  it('grid off (interval 0) never defers', () => {
    expect(nextBoundaryBeat(3.7, 0)).toBe(3.7)
  })
})

describe('boundaryDelayBeats (§24)', () => {
  it('is 0 on a boundary and the remainder otherwise', () => {
    expect(boundaryDelayBeats(1, 1)).toBe(0)
    expect(boundaryDelayBeats(0.3, 1)).toBeCloseTo(0.7, 9)
    expect(boundaryDelayBeats(0.1, 0.25)).toBeCloseTo(0.15, 9)
  })
})

describe('snapBeat (§24 quantized recording)', () => {
  it('snaps to the nearest boundary', () => {
    expect(snapBeat(0.4, 1)).toBe(0)
    expect(snapBeat(0.6, 1)).toBe(1)
    expect(snapBeat(1.5, 1)).toBe(2)
    expect(snapBeat(0.1, 0.25)).toBe(0) // 0.1 is closer to 0 than to 0.25
    expect(snapBeat(0.13, 0.25)).toBeCloseTo(0.25, 9)
  })
  it('leaves the beat unchanged when the grid is off', () => {
    expect(snapBeat(3.7, 0)).toBe(3.7)
  })
})

describe('const arrays are append-only wire encodings (§24)', () => {
  it('preserve the documented order/index', () => {
    expect(PLAY_TIMING_MODES).toEqual(['immediate', 'recording', 'live'])
    expect(PLAY_GRIDS).toEqual(['off', '1/16', '1/8', '1/4', 'beat', 'bar'])
  })
})
