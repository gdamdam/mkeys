/**
 * Byte-level MIDI emission. Pure and framework-free — no Web MIDI API.
 *
 * Every helper returns a fresh `number[]` with the correct status nibble and
 * strict 7-bit clamping, so callers can hand the array straight to
 * `MIDIOutput.send(...)` without risking out-of-range bytes.
 */

/** All-notes-off controller (CC 123). */
const CC_ALL_NOTES_OFF = 123

/** Pitch-bend centre (14-bit). */
const PITCH_BEND_CENTER = 8192
const PITCH_BEND_MAX = 16383

/** Round then clamp `n` into the inclusive integer range [lo, hi]. */
function clampInt(n: number, lo: number, hi: number): number {
  const r = Math.round(n)
  if (r < lo) return lo
  if (r > hi) return hi
  return r
}

/** Clamp to a valid 7-bit data byte (0..127). */
function clamp7(n: number): number {
  return clampInt(n, 0, 0x7f)
}

/** Clamp to a valid MIDI channel (0..15). */
function clampChannel(channel: number): number {
  return clampInt(channel, 0, 0x0f)
}

/** Note-on message. Note that velocity 0 is, by MIDI convention, a note-off. */
export function noteOnBytes(note: number, velocity: number, channel: number): number[] {
  return [0x90 | clampChannel(channel), clamp7(note), clamp7(velocity)]
}

/** Note-off message (status 0x80, release velocity 0). */
export function noteOffBytes(note: number, channel: number): number[] {
  return [0x80 | clampChannel(channel), clamp7(note), 0]
}

/** "All notes off" (CC 123) for the given channel. */
export function allNotesOffBytes(channel: number): number[] {
  return [0xb0 | clampChannel(channel), CC_ALL_NOTES_OFF, 0]
}

/**
 * Pitch-bend message. `value` is normalised -1 (full down) .. +1 (full up),
 * 0 = centre; out-of-range inputs are clamped. Encoded as 14-bit LSB, MSB.
 */
export function pitchBendBytes(value: number, channel: number): number[] {
  const clamped = value < -1 ? -1 : value > 1 ? 1 : value
  // Inverse of parse's asymmetric normalisation: centre -> 8192, ±1 -> 0 / 16383.
  const raw =
    clamped >= 0
      ? Math.round(clamped * 8191) + PITCH_BEND_CENTER
      : Math.round(clamped * 8192) + PITCH_BEND_CENTER
  const bounded = raw < 0 ? 0 : raw > PITCH_BEND_MAX ? PITCH_BEND_MAX : raw
  return [0xe0 | clampChannel(channel), bounded & 0x7f, (bounded >> 7) & 0x7f]
}
