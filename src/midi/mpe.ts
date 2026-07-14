/**
 * MPE (MIDI Polyphonic Expression) output support for microtonal note-out.
 *
 * A microtuned note sits between the 12-TET grid, so a plain note number can't
 * express it. Under MPE each sounding voice gets its own *member* channel and a
 * per-channel pitch bend carries the fractional offset to the exact pitch — so
 * a chord's notes bend independently instead of sharing one channel's bend.
 *
 * This module is pure and framework-free: the allocator hands out channels and
 * tracks a voice↔channel bijection; {@link bendForSemitones} converts a signed
 * semitone offset to the normalised value {@link pitchBendBytes} expects.
 */

/** MPE lower-zone master channel (0-indexed) — carries zone-wide messages. */
export const MPE_MASTER_CHANNEL = 0

/**
 * MPE lower-zone member channels (0-indexed 1..15 → MIDI channels 2..16), one
 * per simultaneously sounding voice. 15 voices can bend independently.
 */
export const MPE_MEMBER_CHANNELS: readonly number[] = Array.from({ length: 15 }, (_, i) => i + 1)

/**
 * Per-note pitch-bend range in semitones. ±48 is the MPE spec default for member
 * channels; the receiving instrument must be configured to the same range for
 * the tuned pitch to land exactly.
 */
export const MPE_BEND_RANGE_SEMITONES = 48

/**
 * Normalise a signed semitone deviation to a -1..+1 pitch-bend value over the
 * given bend range (clamped). A microtuning offset is at most ±0.5 semitone, so
 * this stays well inside range; a wider offset simply saturates.
 */
export function bendForSemitones(semitones: number, rangeSemitones: number = MPE_BEND_RANGE_SEMITONES): number {
  const v = semitones / rangeSemitones
  return v < -1 ? -1 : v > 1 ? 1 : v
}

/** Result of acquiring a channel: which channel, and any voice evicted for it. */
export interface Allocation {
  channel: number
  /** Voice whose channel was stolen (all members busy), else null. */
  evicted: number | null
}

/**
 * Assigns MPE member channels to voices. A voice keeps its channel until
 * released. When every member is busy a new voice steals the least-recently
 * acquired one, reporting the evicted voice so the caller can flush its note
 * (never leaving a hung note on the shared channel).
 */
export class MpeAllocator {
  private readonly members: readonly number[]
  private readonly byVoice = new Map<number, number>()
  /** Voice ids, least-recently acquired first (LRU eviction order). */
  private order: number[] = []

  constructor(members: readonly number[] = MPE_MEMBER_CHANNELS) {
    this.members = members
  }

  /** Get (or reuse) a member channel for `voiceId`. */
  acquire(voiceId: number): Allocation {
    const existing = this.byVoice.get(voiceId)
    if (existing !== undefined) {
      this.touch(voiceId)
      return { channel: existing, evicted: null }
    }

    const used = new Set(this.byVoice.values())
    const free = this.members.find((c) => !used.has(c))
    if (free !== undefined) {
      this.assign(voiceId, free)
      return { channel: free, evicted: null }
    }

    // All members busy: steal the least-recently acquired voice's channel.
    const victim = this.order[0]
    const channel = this.byVoice.get(victim) as number
    this.release(victim)
    this.assign(voiceId, channel)
    return { channel, evicted: victim }
  }

  /** Free `voiceId`'s channel (no-op if it holds none). */
  release(voiceId: number): void {
    if (!this.byVoice.delete(voiceId)) return
    this.order = this.order.filter((v) => v !== voiceId)
  }

  /** Drop all assignments (e.g. on panic or mode switch). */
  clear(): void {
    this.byVoice.clear()
    this.order = []
  }

  /** Number of channels currently assigned. */
  activeCount(): number {
    return this.byVoice.size
  }

  private assign(voiceId: number, channel: number): void {
    this.byVoice.set(voiceId, channel)
    this.order.push(voiceId)
  }

  private touch(voiceId: number): void {
    this.order = this.order.filter((v) => v !== voiceId)
    this.order.push(voiceId)
  }
}
