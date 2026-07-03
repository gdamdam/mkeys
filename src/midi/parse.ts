/**
 * Byte-level MIDI parsing. Pure and framework-free — no Web MIDI API.
 *
 * Only the channel-voice messages mkeys actually consumes are decoded
 * (note on/off, pitch bend, control change). Everything else — system
 * messages, and "running status" packets that omit the status byte — is
 * reported as `null`. Running status is unsupported by design: a single
 * decoder call has no prior-status context to reconstruct it, so we refuse
 * rather than mis-parse. Callers should feed complete messages (as the Web
 * MIDI API delivers via `MIDIMessageEvent.data`).
 */

/** Note pressed. A note-on with velocity 0 is normalised to {@link NoteOffEvent}. */
export interface NoteOnEvent {
  type: 'noteOn'
  channel: number
  note: number
  velocity: number
}

/** Note released. `velocity` is the release velocity (0 for velocity-0 note-ons). */
export interface NoteOffEvent {
  type: 'noteOff'
  channel: number
  note: number
  velocity: number
}

/** Pitch bend wheel, with `value` normalised to -1 (full down) .. +1 (full up), 0 = centre. */
export interface PitchBendEvent {
  type: 'pitchBend'
  channel: number
  value: number
}

/** Semantic tag for the controllers mkeys cares about. */
export type ControlChangeKind = 'modWheel' | 'sustain' | 'other'

/** Control change. `value` is the raw 0..127 controller value. */
export interface ControlChangeEvent {
  type: 'controlChange'
  channel: number
  controller: number
  value: number
  kind: ControlChangeKind
}

/** Discriminated union of every MIDI message {@link parseMidiMessage} recognises. */
export type MidiEvent =
  | NoteOnEvent
  | NoteOffEvent
  | PitchBendEvent
  | ControlChangeEvent

/** Standard controller numbers we recognise by name. */
const CC_MOD_WHEEL = 1
const CC_SUSTAIN = 64

/** Pitch-bend centre (14-bit): raw values below sit "down", above sit "up". */
const PITCH_BEND_CENTER = 8192

/** True when `n` is a valid 7-bit data byte (high bit clear). */
function isDataByte(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0x7f
}

function classifyController(controller: number): ControlChangeKind {
  if (controller === CC_MOD_WHEEL) return 'modWheel'
  if (controller === CC_SUSTAIN) return 'sustain'
  return 'other'
}

/**
 * Decode a single, complete MIDI message.
 *
 * @returns the typed event, or `null` for empty, truncated, malformed,
 *   running-status, or unhandled (e.g. system/sysex) messages.
 */
export function parseMidiMessage(bytes: number[] | Uint8Array): MidiEvent | null {
  if (bytes.length < 1) return null

  const status = bytes[0]
  // A leading data byte means running status: unsupported without context.
  if (status < 0x80) return null

  const kind = status & 0xf0
  const channel = status & 0x0f

  switch (kind) {
    case 0x90: {
      // Note on (velocity 0 is a note-off by convention).
      if (bytes.length < 3) return null
      const note = bytes[1]
      const velocity = bytes[2]
      if (!isDataByte(note) || !isDataByte(velocity)) return null
      if (velocity === 0) return { type: 'noteOff', channel, note, velocity: 0 }
      return { type: 'noteOn', channel, note, velocity }
    }
    case 0x80: {
      // Note off.
      if (bytes.length < 3) return null
      const note = bytes[1]
      const velocity = bytes[2]
      if (!isDataByte(note) || !isDataByte(velocity)) return null
      return { type: 'noteOff', channel, note, velocity }
    }
    case 0xb0: {
      // Control change.
      if (bytes.length < 3) return null
      const controller = bytes[1]
      const value = bytes[2]
      if (!isDataByte(controller) || !isDataByte(value)) return null
      return {
        type: 'controlChange',
        channel,
        controller,
        value,
        kind: classifyController(controller),
      }
    }
    case 0xe0: {
      // Pitch bend: 14-bit little-endian (LSB, MSB), centre = 8192.
      if (bytes.length < 3) return null
      const lsb = bytes[1]
      const msb = bytes[2]
      if (!isDataByte(lsb) || !isDataByte(msb)) return null
      const raw = (msb << 7) | lsb
      // Asymmetric normalisation so centre maps to exactly 0 and both
      // extremes reach ±1 (down range is 8192 wide, up range 8191).
      const value =
        raw >= PITCH_BEND_CENTER
          ? (raw - PITCH_BEND_CENTER) / 8191
          : (raw - PITCH_BEND_CENTER) / 8192
      return { type: 'pitchBend', channel, value }
    }
    default:
      return null
  }
}
