/**
 * scheduler — the lookahead transport driver ("two clocks" pattern).
 *
 * One clock is the audio sample clock (ctx.currentTime, supplied via `now()`);
 * the other is a coarse JS setInterval timer. On each tick we look a small
 * window into the future and emit every event whose onset falls in that window,
 * at absolute ctx times. This fully decouples musical timing from React render
 * timing — the UI never drives a single note.
 *
 * The timing math lives in the PURE {@link planWindow} function so it can be
 * tested deterministically without timers or audio. `planWindow` is generic: it
 * tiles a beat-domain pattern (an arpeggiator cycle, a captured phrase, …) over
 * a loop and resolves absolute times honouring tempo + swing. It emits only
 * event *times* + opaque numeric payloads — it never touches audio. The
 * {@link Scheduler} class is a thin stateful shell around it and is not
 * unit-tested (the pure planner is).
 */

import { secondsPerBeat, swungBeatTime } from './clock'

/**
 * One event in the repeating beat-domain pattern. `note`/`velocity` are opaque
 * numbers so the same planner can carry MIDI notes (arp) or degree indices
 * (phrase); the caller decides what they mean.
 */
export interface PatternEvent {
  /** Onset in beats from the start of the loop (0 <= beat < loopBeats). */
  beat: number
  /** Sounding length in beats. */
  durationBeats: number
  /** Opaque payload, typically a MIDI note number. */
  note: number
  /** Velocity 0..1. */
  velocity: number
}

/** Immutable transport state threaded through successive plan windows. */
export interface PlanState {
  /** The beat-domain pattern for one loop cycle. */
  pattern: PatternEvent[]
  /** Length of one loop cycle, in beats. */
  loopBeats: number
  bpm: number
  beatsPerBar: number
  /** Swing amount 0..1 applied to eighth-note off-beats. */
  swing: number
  /** ctx time (sec) at which beat 0 of loop-cycle 0 occurred. */
  startTimeSec: number
  /** ctx time (sec) up to which events have already been emitted (exclusive). */
  cursorSec: number
}

/** A fully-resolved event with absolute on/off ctx times. */
export interface PlannedEvent {
  /** Absolute ctx onset time (seconds). */
  time: number
  /** Absolute ctx release time (seconds). */
  offTime: number
  note: number
  velocity: number
  /** Absolute beat position (cycle * loopBeats + pattern beat) for UI/debug. */
  beat: number
}

/** Result of planning one window: the events plus the advanced state. */
export interface PlanResult {
  events: PlannedEvent[]
  nextState: PlanState
}

/**
 * Convert a beat-domain onset into seconds with swing. We map the beat onset
 * onto the eighth-note grid used by {@link swungBeatTime}: integer-and-half
 * beats are eighths; finer subdivisions (sixteenths, triplets) pass through
 * straight to avoid distorting arps, while their nearest eighth off-beat still
 * gets the swing push.
 */
export function swingBeatSeconds(startBeat: number, bpm: number, swing: number): number {
  const spb = secondsPerBeat(bpm)
  if (swing <= 0) return startBeat * spb
  const eighthIndex = startBeat * 2
  if (Math.abs(eighthIndex - Math.round(eighthIndex)) < 1e-9) {
    return swungBeatTime(Math.round(eighthIndex), bpm, swing)
  }
  // Finer than an eighth: add the swing delay of the eighth slot it sits in.
  const baseEighth = Math.floor(eighthIndex)
  const swungBase = swungBeatTime(baseEighth, bpm, swing)
  const straightBase = (baseEighth * spb) / 2
  const within = startBeat * spb - straightBase
  return swungBase + within
}

/**
 * PURE planner. Given the transport state and a window [windowStartSec,
 * windowEndSec), returns every event whose absolute `time` (onset) lies in that
 * window, plus a `nextState` whose cursor has advanced to the window end.
 *
 * The read cursor is `max(windowStartSec, state.cursorSec)`, so re-planning an
 * overlapping or repeated window never re-emits already-planned events — the
 * half-open interval guarantees gapless, overlap-free continuation.
 */
export function planWindow(
  state: PlanState,
  windowStartSec: number,
  windowEndSec: number,
): PlanResult {
  const { pattern, loopBeats, bpm, swing, startTimeSec } = state
  const from = Math.max(windowStartSec, state.cursorSec)
  const to = windowEndSec
  const nextCursor = Math.max(state.cursorSec, to)
  const nextState: PlanState = { ...state, cursorSec: nextCursor }

  if (!pattern.length || loopBeats <= 0 || bpm <= 0 || to <= from) {
    return { events: [], nextState }
  }

  const spb = secondsPerBeat(bpm)
  const loopSec = loopBeats * spb
  const events: PlannedEvent[] = []

  // A cycle contributes an event to [from, to) only when its start lies in
  // [from - loopSec, to). Clamp to cycle 0: the loop never plays before it
  // began (startTimeSec). The -1 guards against events near a cycle's tail.
  const startCycle = Math.max(0, Math.floor((from - startTimeSec) / loopSec) - 1)
  const endCycle = Math.floor((to - startTimeSec) / loopSec) + 1

  for (let c = startCycle; c <= endCycle; c++) {
    const cycleStart = startTimeSec + c * loopSec
    if (cycleStart >= to) break
    for (const ev of pattern) {
      const time = cycleStart + swingBeatSeconds(ev.beat, bpm, swing)
      if (time < from || time >= to) continue
      events.push({
        time,
        offTime: time + ev.durationBeats * spb,
        note: ev.note,
        velocity: ev.velocity,
        beat: c * loopBeats + ev.beat,
      })
    }
  }

  events.sort((a, b) => a.time - b.time)
  return { events, nextState }
}

// ---------------------------------------------------------------------------
// Scheduler class (thin shell — NOT unit-tested; drive planWindow instead)
// ---------------------------------------------------------------------------

export interface SchedulerOptions {
  /** Returns the audio sample clock time (ctx.currentTime). */
  now: () => number
  /** Called each tick with the events resolved inside the lookahead window. */
  onEvents: (events: PlannedEvent[]) => void
  /** Lookahead window in seconds (default 0.1). */
  lookahead?: number
  /** Timer interval in ms (default 25). */
  interval?: number
}

/**
 * Stateful driver around {@link planWindow}. Owns a setInterval loop that, on
 * each tick, plans the [now, now+lookahead) window and hands the events to the
 * `onEvents` callback. Kept audio-agnostic: the callback decides what to do
 * with the event times.
 */
export class Scheduler {
  private readonly now: () => number
  private readonly onEvents: (events: PlannedEvent[]) => void
  private readonly lookahead: number
  private readonly interval: number

  private timer: ReturnType<typeof setInterval> | null = null
  private _playing = false

  private state: PlanState = {
    pattern: [],
    loopBeats: 0,
    bpm: 120,
    beatsPerBar: 4,
    swing: 0,
    startTimeSec: 0,
    cursorSec: 0,
  }

  constructor(opts: SchedulerOptions) {
    this.now = opts.now
    this.onEvents = opts.onEvents
    this.lookahead = opts.lookahead ?? 0.1
    this.interval = opts.interval ?? 25
  }

  get playing(): boolean {
    return this._playing
  }

  /** Replace the looping pattern and its cycle length (beats). */
  setPattern(pattern: PatternEvent[], loopBeats: number): void {
    this.state = { ...this.state, pattern, loopBeats }
  }

  setSwing(swing: number): void {
    this.state = { ...this.state, swing: Math.max(0, Math.min(1, swing)) }
  }

  setBeatsPerBar(beatsPerBar: number): void {
    this.state = { ...this.state, beatsPerBar }
  }

  /**
   * Change tempo. While playing, rebase `startTimeSec` so the musical phase at
   * the already-committed cursor is preserved: bar length is inversely
   * proportional to bpm, so the rebase is a simple ratio. Without this every
   * cycle boundary would be reinterpreted at the new beat length and jump.
   */
  setTempo(bpm: number): void {
    const cur = this.state
    if (this._playing && bpm > 0 && cur.bpm > 0 && bpm !== cur.bpm) {
      const effectiveAt = Math.max(this.now(), cur.cursorSec)
      const startTimeSec = effectiveAt - (effectiveAt - cur.startTimeSec) * (cur.bpm / bpm)
      this.state = { ...cur, bpm, startTimeSec }
      return
    }
    this.state = { ...cur, bpm }
  }

  start(atTime?: number): void {
    if (this._playing) return
    const t = atTime ?? this.now()
    this.state = { ...this.state, startTimeSec: t, cursorSec: t }
    this._playing = true
    // Prime immediately, then on interval.
    this.tick()
    this.timer = setInterval(() => this.tick(), this.interval)
  }

  stop(): void {
    if (!this._playing) return
    this._playing = false
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  dispose(): void {
    this.stop()
  }

  private tick(): void {
    if (!this._playing) return
    const now = this.now()
    const horizon = now + this.lookahead
    const { events, nextState } = planWindow(this.state, now, horizon)
    this.state = nextState
    if (events.length) this.onEvents(events)
  }
}
