/**
 * Centralized, named boundary-size limits (§16).
 *
 * Every untrusted string / array / file that reaches a parser, decoder, or
 * allocation is bounded here — validated BEFORE the expensive work, so an
 * oversized share fragment, imported JSON, Scala file, or hostile tuning array
 * can neither exhaust memory nor wedge the app.
 *
 * Two policies:
 *  - DISPLAY-ONLY names are safely TRUNCATED (documented; no musical meaning is
 *    lost by clipping a label).
 *  - STRUCTURAL sizes (scale note counts, keyboard-map lengths, whole files and
 *    payloads) are REJECTED when exceeded, because truncating them would change
 *    what actually sounds.
 *
 * The core sanitizer stays total: rejection means "fall back to the default /
 * 12-TET", never throw. File-import call sites (which already surface errors to
 * the UI) may throw a friendly message instead.
 */

// --- Display-only names — safe to truncate --------------------------------
export const MAX_SESSION_NAME = 200
export const MAX_PRESET_NAME = 100
export const MAX_TUNING_NAME = 200

// --- Structural sizes — reject when exceeded ------------------------------
/** Max notes in a tuning's scale (arbitrary N is supported, but bounded). */
export const MAX_TUNING_NOTES = 4096
/** Max per-key entries in a `.kbm` keyboard map. */
export const MAX_KEYBOARD_MAP_DEGREES = 4096

// --- Untrusted file / payload sizes — checked before parse/decode ---------
/** Scala `.scl` file, bytes. */
export const MAX_SCL_BYTES = 512 * 1024
/** Scala `.kbm` file, bytes. */
export const MAX_KBM_BYTES = 128 * 1024
/** Imported session JSON file, bytes. */
export const MAX_JSON_IMPORT_BYTES = 4 * 1024 * 1024
/** Share-link fragment, characters — checked before Base64 decoding. */
export const MAX_SHARE_FRAGMENT_CHARS = 2 * 1024 * 1024
/** Decoded share JSON, characters — checked before JSON.parse. */
export const MAX_DECODED_SHARE_CHARS = 4 * 1024 * 1024

/**
 * UTF-8 byte length of a string, used for the file-size pre-checks. Falls back
 * to the UTF-16 code-unit count when TextEncoder is unavailable (never larger
 * for the ASCII-ish content these files carry, so still a safe conservative
 * bound for the reject decision).
 */
export function byteLength(s: string): number {
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length
  } catch {
    /* fall through */
  }
  return s.length
}

/** Truncate a display-only name to `max` characters (total; never throws). */
export function clampName(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}
