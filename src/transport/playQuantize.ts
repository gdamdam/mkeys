/**
 * playQuantize — pure timing-quantization core for "Play quantize" (§24).
 *
 * DISTINCT from glide/pitch quantize (surface/glide.ts): glide quantize shapes
 * how pitch moves BETWEEN degrees; play quantize decides WHEN note-on/off events
 * land on the musical timeline.
 *
 * Everything here is pure beat-domain math (no audio, no DOM, no clock), so the
 * boundary/snapping logic is exhaustively unit-testable. The store supplies the
 * current beat position (from the local anchor, or the Link snapshot) and turns
 * the returned beat offsets into AudioContext times.
 */

/** Timing mode (APPEND-ONLY — codec encodes by index). */
export type PlayTimingMode = 'immediate' | 'recording' | 'live'
export const PLAY_TIMING_MODES: readonly PlayTimingMode[] = ['immediate', 'recording', 'live']

/** Quantize grid (APPEND-ONLY — codec encodes by index). */
export type PlayGrid = 'off' | '1/16' | '1/8' | '1/4' | 'beat' | 'bar'
export const PLAY_GRIDS: readonly PlayGrid[] = ['off', '1/16', '1/8', '1/4', 'beat', 'bar']

/** Play-quantize configuration persisted on the session. */
export interface PlayQuantizeConfig {
  mode: PlayTimingMode
  grid: PlayGrid
}

/** Minimum captured-note length in beats after snapping — never a zero-length note (§24). */
export const MIN_QUANTIZED_NOTE_BEATS = 0.05

/**
 * Grid interval in beats, assuming a quarter-note beat (the bridge is 4/4-only).
 * `off` → 0 (no quantization). Note 1/4 and Beat coincide at one beat in 4/4 —
 * both are offered because performers reach for either name.
 */
export function gridIntervalBeats(grid: PlayGrid, beatsPerBar: number): number {
  switch (grid) {
    case '1/16':
      return 0.25
    case '1/8':
      return 0.5
    case '1/4':
    case 'beat':
      return 1
    case 'bar':
      return beatsPerBar > 0 ? beatsPerBar : 4
    case 'off':
    default:
      return 0
  }
}

/** Tiny epsilon so a press sitting exactly on a boundary fires on it (delay 0). */
const EPS = 1e-9

/**
 * The next grid boundary at or after `beatNow`, in absolute beats. A position
 * exactly on a boundary returns that boundary (no forced wait to the next one).
 * `interval <= 0` (grid off) returns `beatNow` — apply immediately.
 */
export function nextBoundaryBeat(beatNow: number, interval: number): number {
  if (interval <= 0) return beatNow
  const steps = Math.ceil(beatNow / interval - EPS)
  // `steps === 0` also catches -0 (Math.ceil of a tiny negative), avoiding a -0 result.
  return steps === 0 ? 0 : steps * interval
}

/** Beats to wait from `beatNow` until the next boundary (0 when on a boundary / grid off). */
export function boundaryDelayBeats(beatNow: number, interval: number): number {
  return Math.max(0, nextBoundaryBeat(beatNow, interval) - beatNow)
}

/**
 * Snap a captured beat position to the nearest grid boundary (§24 quantized
 * recording). `interval <= 0` returns the beat unchanged.
 */
export function snapBeat(beat: number, interval: number): number {
  if (interval <= 0) return beat
  return Math.round(beat / interval) * interval
}
