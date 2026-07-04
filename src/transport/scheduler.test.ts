import { describe, expect, it } from 'vitest'
import {
  planWindow,
  swingBeatSeconds,
  type PatternEvent,
  type PlanState,
} from './scheduler'

/** Four quarter-notes on beats 0..3 of a 4-beat loop. */
function quarters(): PatternEvent[] {
  return [0, 1, 2, 3].map((beat) => ({
    beat,
    durationBeats: 1,
    note: 60 + beat,
    velocity: 0.8,
  }))
}

function baseState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    pattern: quarters(),
    loopBeats: 4,
    bpm: 120,
    beatsPerBar: 4,
    swing: 0,
    startTimeSec: 0,
    cursorSec: 0,
    ...overrides,
  }
}

describe('swingBeatSeconds', () => {
  it('is straight for whole beats regardless of swing', () => {
    // Whole beats sit on even eighth indices (on-beats), never pushed.
    expect(swingBeatSeconds(1, 120, 1)).toBeCloseTo(0.5, 12)
    expect(swingBeatSeconds(2, 120, 1)).toBeCloseTo(1.0, 12)
  })

  it('pushes half-beat off-beats by the swing amount', () => {
    const spb = 0.5
    // beat 0.5 -> eighth index 1 -> swung; swing=1 is a triplet feel (+spb/6).
    expect(swingBeatSeconds(0.5, 120, 1)).toBeCloseTo(0.25 + spb / 6, 12)
  })

  it('is straight when swing is 0', () => {
    expect(swingBeatSeconds(0.5, 120, 0)).toBeCloseTo(0.25, 12)
  })
})

describe('planWindow', () => {
  it('emits every event whose onset lies in the window', () => {
    const { events } = planWindow(baseState(), 0, 2)
    // spb = 0.5, beats 0..3 -> 0, 0.5, 1.0, 1.5, all < 2.
    expect(events.map((e) => e.time)).toEqual([0, 0.5, 1.0, 1.5])
    expect(events.map((e) => e.note)).toEqual([60, 61, 62, 63])
  })

  it('computes offTime from duration and tempo', () => {
    const { events } = planWindow(baseState(), 0, 0.6)
    expect(events).toHaveLength(2) // beats 0 and 0.5s onset (beat 1)
    expect(events[0].offTime).toBeCloseTo(0.5, 12) // 0 + 1 beat
    expect(events[1].offTime).toBeCloseTo(1.0, 12) // 0.5 + 1 beat
  })

  it('uses a half-open window: onset at windowEnd is excluded', () => {
    const { events } = planWindow(baseState(), 0, 1.0)
    // 1.0 (beat 2) is excluded; 0, 0.5 included.
    expect(events.map((e) => e.time)).toEqual([0, 0.5])
  })

  it('advances across successive windows without gaps or overlaps', () => {
    const s0 = baseState()
    const a = planWindow(s0, 0, 1)
    const b = planWindow(a.nextState, 1, 2)
    const combined = [...a.events, ...b.events].map((e) => e.time)
    const oneShot = planWindow(baseState(), 0, 2).events.map((e) => e.time)
    expect(combined).toEqual(oneShot)
    // No duplicated onset at the seam.
    expect(new Set(combined).size).toBe(combined.length)
  })

  it('clamps the read cursor so overlapping windows never re-emit', () => {
    const s = baseState({ cursorSec: 1 })
    // Even though windowStart is 0, cursor at 1 means [1,2) is planned.
    const { events } = planWindow(s, 0, 2)
    expect(events.map((e) => e.time)).toEqual([1.0, 1.5])
  })

  it('emits (does not drop) events missed when a tick arrives late', () => {
    // First window [0,1) emits beats 0 and 0.5, advancing the cursor to 1.
    const a = planWindow(baseState(), 0, 1)
    expect(a.events.map((e) => e.time)).toEqual([0, 0.5])
    // A stall: the next tick's window starts at 1.5, past the cursor. The
    // event at 1.0 (in [cursorSec, windowStart)) must still fire, late, not vanish.
    const b = planWindow(a.nextState, 1.5, 2.5)
    expect(b.events.map((e) => e.time)).toEqual([1.0, 1.5, 2.0])
  })

  it('advances the cursor to the window end', () => {
    const { nextState } = planWindow(baseState(), 0, 1)
    expect(nextState.cursorSec).toBeCloseTo(1, 12)
  })

  it('wraps the loop and keeps emitting on the next cycle', () => {
    const s = baseState({
      pattern: [{ beat: 0, durationBeats: 1, note: 60, velocity: 1 }],
      loopBeats: 2, // loopSec = 1s at 120 BPM
    })
    const { events } = planWindow(s, 0, 3.5)
    // Cycle onsets at 0, 1, 2, 3.
    expect(events.map((e) => e.time)).toEqual([0, 1, 2, 3])
    expect(events.map((e) => e.beat)).toEqual([0, 2, 4, 6])
  })

  it('respects a tempo change (same beats, different seconds)', () => {
    const fast = planWindow(baseState({ bpm: 120 }), 0, 4)
    const slow = planWindow(baseState({ bpm: 60 }), 0, 4)
    // Beat 1 lands at 0.5s @120, 1.0s @60.
    expect(fast.events[1].time).toBeCloseTo(0.5, 12)
    expect(slow.events[1].time).toBeCloseTo(1.0, 12)
  })

  it('applies swing offsets to off-beat events', () => {
    const s = baseState({
      pattern: [
        { beat: 0, durationBeats: 0.5, note: 60, velocity: 1 },
        { beat: 0.5, durationBeats: 0.5, note: 62, velocity: 1 },
      ],
      loopBeats: 1,
      swing: 1,
    })
    const { events } = planWindow(s, 0, 1)
    expect(events[0].time).toBeCloseTo(0, 12) // on-beat unaffected
    expect(events[1].time).toBeCloseTo(0.25 + 0.5 / 6, 12) // off-beat pushed (triplet)
  })

  it('offsets every cycle by startTimeSec', () => {
    const { events } = planWindow(baseState({ startTimeSec: 10 }), 10, 11)
    expect(events.map((e) => e.time)).toEqual([10, 10.5])
  })

  it('returns nothing for an empty pattern but still advances the cursor', () => {
    const { events, nextState } = planWindow(
      baseState({ pattern: [], loopBeats: 4 }),
      0,
      2,
    )
    expect(events).toEqual([])
    expect(nextState.cursorSec).toBeCloseTo(2, 12)
  })

  it('returns nothing when the window end is at or before the cursor', () => {
    // The read boundary is the cursor, so an empty window is windowEnd <= cursor.
    const { events } = planWindow(baseState({ cursorSec: 2 }), 0, 2)
    expect(events).toEqual([])
  })

  it('sorts emitted events by onset time', () => {
    const s = baseState({
      pattern: [
        { beat: 3, durationBeats: 1, note: 63, velocity: 1 },
        { beat: 0, durationBeats: 1, note: 60, velocity: 1 },
        { beat: 1, durationBeats: 1, note: 61, velocity: 1 },
      ],
      loopBeats: 4,
    })
    const { events } = planWindow(s, 0, 2)
    const times = events.map((e) => e.time)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})
