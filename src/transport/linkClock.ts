/**
 * linkClock — pure timing core for Ableton Link sync.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Derivation / attribution
 * ------------------------
 * Adapted from the mchord project's `src/transport/linkClock.ts` (AGPL-3.0;
 * github.com/gdamdam), itself derived from mdrone's `src/engine/linkClock.ts`,
 * which shares the mpump Link bridge protocol. mkeys needs only the
 * grid-boundary / quantize math and tempo projection; the remaining pure
 * functions are unchanged apart from naming.
 *
 * Turns a Link session snapshot (tempo / beat / phase from the bridge) into
 * AudioContext times: grid boundaries for quantized changes. Everything here
 * is pure — a snapshot value plus a `now` time go in, a number comes out — so
 * it is unit-testable without any audio nodes.
 */
import type { LinkState } from './linkBridge'

export interface LinkClockSnapshot {
  /** Session tempo (BPM). */
  bpm: number
  /** Absolute beat position. Needed (not just `phase`) to know which bar we're
   *  in within a multi-bar cycle, e.g. for true 2-bar boundaries. */
  beat: number
  /** Phase within the current bar (0..quantum). */
  phase: number
  /** Beats per bar (Link quantum). The bridge only reports 4/4 today. */
  quantum: number
  /** Real-seconds timestamp captured when the Link message arrived, in the SAME
   *  clock domain callers later query with. Only ever used to compute *durations*
   *  (boundary delays, projected beat/phase) relative to a same-domain `now`, so
   *  those durations can be applied as offsets to any real-seconds clock (e.g. the
   *  scheduler's ctx.currentTime). Keeping stamp + query in one domain is the
   *  invariant that makes the projection correct. */
  tAtMsg: number
}

export type QuantizeGrid = 'beat' | 'bar' | '2bar'

/** Build an immutable snapshot from a Link state + the AudioContext time at
 *  which the message was processed. `quantum` defaults to 4 (the only metre the
 *  bridge reports); non-finite/non-positive falls back to 4. */
export function makeLinkClockSnapshot(
  state: LinkState,
  tAtMsg: number,
  quantum = 4,
): LinkClockSnapshot {
  const q = Number.isFinite(quantum) && quantum > 0 ? quantum : 4
  return { bpm: state.tempo, beat: state.beat, phase: state.phase, quantum: q, tAtMsg }
}

function beatSec(s: LinkClockSnapshot): number {
  return 60 / s.bpm
}

/** Bar length in seconds. */
export function barSec(s: LinkClockSnapshot): number {
  return s.quantum * beatSec(s)
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** ctx-time of the next downbeat ≥ `now`. */
export function nextDownbeatTime(s: LinkClockSnapshot, now: number): number {
  const bar = barSec(s)
  let t = s.tAtMsg + (s.quantum - s.phase) * beatSec(s)
  while (t < now) t += bar
  return t
}

/** ctx-time of the next `beat` / `bar` / `2bar` boundary ≥ `now`. The 2-bar
 *  boundary is derived from the absolute `beat` (multiples of `2 * quantum`),
 *  since `phase` alone can't tell odd bars from even. */
export function nextBoundaryTime(
  s: LinkClockSnapshot,
  grid: QuantizeGrid,
  now: number,
): number {
  const bs = beatSec(s)
  if (grid === 'beat') {
    const frac = s.phase - Math.floor(s.phase)
    let t = s.tAtMsg + (1 - frac) * bs
    while (t < now) t += bs
    return t
  }
  if (grid === 'bar') return nextDownbeatTime(s, now)
  // 2bar: next time the absolute beat reaches a multiple of 2*quantum.
  const span = 2 * s.quantum
  const spanSec = span * bs
  let t = s.tAtMsg + (span - mod(s.beat, span)) * bs
  while (t < now) t += spanSec
  return t
}

/** Seconds to defer a quantized change. 0 (apply immediately) when the grid is
 *  off, Link is disconnected, or there's no snapshot yet — these are also the
 *  fallback when Link drops mid-change. */
export function quantizeDelaySec(
  snapshot: LinkClockSnapshot | null,
  grid: QuantizeGrid | 'off',
  connected: boolean,
  now: number,
): number {
  if (grid === 'off' || !connected || !snapshot) return 0
  return Math.max(0, nextBoundaryTime(snapshot, grid, now) - now)
}

/** Project the absolute beat position at `now` from a snapshot. `now` must be in
 *  the same real-seconds clock domain as `tAtMsg` (the scheduler's clock). Pure
 *  linear projection — no per-tick smoothing; drift is reconciled only at musical
 *  boundaries, never by replaying or restarting. */
export function projectBeat(s: LinkClockSnapshot, now: number): number {
  return s.beat + (now - s.tAtMsg) / beatSec(s)
}

/** Project the phase within the bar (0..quantum) at `now`. Same clock-domain rule
 *  as {@link projectBeat}. Fractional tempo is preserved (beatSec uses raw bpm). */
export function projectPhase(s: LinkClockSnapshot, now: number): number {
  return mod(s.phase + (now - s.tAtMsg) / beatSec(s), s.quantum)
}
