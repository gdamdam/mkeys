/**
 * Note-ownership tracking: a bijection between the instrument's internal voice
 * ids and the MIDI notes currently sounding on an output. Its whole job is to
 * guarantee there are NEVER hung (orphaned) notes:
 *
 *  - a note-off is emitted only for a note we actually turned on;
 *  - a voice re-triggering (a second note-on before its note-off) first turns
 *    off whatever it was already sounding;
 *  - a duplicate note-on for an already-sounding pitch (even from a different
 *    voice) first turns that pitch off, then retriggers it;
 *  - {@link NoteOwnership.panic} / {@link NoteOwnership.allNotesOff} return a
 *    note-off for every held note and clear all state.
 *
 * Pure and framework-free: methods return the MIDI messages to send rather
 * than touching any output. Each message is a `number[]` of raw bytes; a call
 * may yield several (e.g. an off followed by an on on retrigger).
 */
import { noteOffBytes, noteOnBytes } from './emit'

/** A single MIDI message as raw bytes. */
export type MidiBytes = number[]

interface HeldNote {
  note: number
  channel: number
}

export class NoteOwnership {
  /** voiceId -> the note it is currently sounding. */
  private readonly byVoice = new Map<number, HeldNote>()
  /** "channel:note" -> the voiceId sounding it (one owner per pitch/channel). */
  private readonly byNote = new Map<string, number>()

  private static key(channel: number, note: number): string {
    return `${channel}:${note}`
  }

  /**
   * Register a note-on for `voiceId`, returning the messages to send. If the
   * voice was already sounding, or the target pitch is already sounding, the
   * conflicting note is turned off first so nothing is left hanging.
   */
  noteOn(voiceId: number, note: number, velocity: number, channel: number): MidiBytes[] {
    const messages: MidiBytes[] = []

    // Retrigger: this voice already holds a (possibly different) note.
    const previous = this.byVoice.get(voiceId)
    if (previous) {
      messages.push(noteOffBytes(previous.note, previous.channel))
      this.release(voiceId, previous)
    }

    // Duplicate pitch: some voice already sounds this exact note/channel.
    const noteKey = NoteOwnership.key(channel, note)
    const owner = this.byNote.get(noteKey)
    if (owner !== undefined) {
      const held = this.byVoice.get(owner)
      messages.push(noteOffBytes(note, channel))
      if (held) this.release(owner, held)
    }

    this.byVoice.set(voiceId, { note, channel })
    this.byNote.set(noteKey, voiceId)
    messages.push(noteOnBytes(note, velocity, channel))
    return messages
  }

  /**
   * Release `voiceId`. Returns the single note-off to send, or an empty array
   * if the voice holds nothing (so a stray note-off never becomes an orphan).
   */
  noteOff(voiceId: number): MidiBytes[] {
    const held = this.byVoice.get(voiceId)
    if (!held) return []
    this.release(voiceId, held)
    return [noteOffBytes(held.note, held.channel)]
  }

  /**
   * Turn off every held note and clear all state. Returns one note-off per
   * held note, in insertion order.
   */
  panic(): MidiBytes[] {
    const messages: MidiBytes[] = []
    for (const held of this.byVoice.values()) {
      messages.push(noteOffBytes(held.note, held.channel))
    }
    this.byVoice.clear()
    this.byNote.clear()
    return messages
  }

  /** Alias of {@link panic}: turn everything off and clear state. */
  allNotesOff(): MidiBytes[] {
    return this.panic()
  }

  /** Number of voices currently sounding. */
  activeCount(): number {
    return this.byVoice.size
  }

  /** Whether a given note is currently sounding on a channel. */
  isSounding(note: number, channel: number): boolean {
    return this.byNote.has(NoteOwnership.key(channel, note))
  }

  private release(voiceId: number, held: HeldNote): void {
    this.byVoice.delete(voiceId)
    this.byNote.delete(NoteOwnership.key(held.channel, held.note))
  }
}
