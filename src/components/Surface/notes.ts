/**
 * Note-name + cents helpers for the Surface's live readouts.
 *
 * Pure, DOM-free, node-testable. These are UI-presentation concerns (how a
 * fractional MIDI pitch reads as a note label and a cents offset), so they live
 * with the Surface rather than in the harmony core. Sharps only — the surface
 * is scale-locked, so enharmonic spelling never surfaces to the player.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const mod12 = (n: number): number => ((n % 12) + 12) % 12

/**
 * Note label (name + octave) for a MIDI note number. Fractional inputs are
 * rounded to the nearest semitone first, matching MIDI convention where
 * C4 = 60. e.g. 60 -> "C4", 61.4 -> "C#4".
 */
export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi)
  const pc = mod12(rounded)
  const octave = Math.floor(rounded / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

/**
 * Cents offset of a fractional pitch from its nearest semitone, in the range
 * [-50, +50]. 60.12 -> +12; 59.95 -> -5; an exact scale tone -> 0.
 */
export function centsOffset(pitch: number): number {
  const rounded = Math.round(pitch)
  return Math.round((pitch - rounded) * 100)
}

/** Format a cents value for display: "+12", "0", "-5". */
export function formatCents(cents: number): string {
  if (cents === 0) return '0'
  return cents > 0 ? `+${cents}` : `${cents}`
}
