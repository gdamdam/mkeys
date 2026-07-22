/**
 * Boundary-size limit enforcement (§16). Verifies that oversized names are
 * truncated, oversized structural inputs are rejected (not truncated), and
 * oversized files/payloads are refused before the expensive parse/decode.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_DECODED_SHARE_CHARS,
  MAX_JSON_IMPORT_BYTES,
  MAX_KEYBOARD_MAP_DEGREES,
  MAX_PRESET_NAME,
  MAX_SESSION_NAME,
  MAX_SHARE_FRAGMENT_CHARS,
  MAX_TUNING_NAME,
  MAX_TUNING_NOTES,
} from './limits'
import { importSessionJSON, sanitizeSession } from './persistence/session'
import { decodeSession } from './sharing/codec'
import { BUILTIN_PORTABLE_TUNINGS } from './harmony/tuning'

const validTuning = BUILTIN_PORTABLE_TUNINGS[1]

/** A valid, monotonic scaleCents of exactly `n` notes (0, 0.1, 0.2, …). */
const cents = (n: number): number[] => Array.from({ length: n }, (_, i) => i * 0.1)

describe('display-only name truncation (§16)', () => {
  it('truncates an over-long session name to the max', () => {
    const s = sanitizeSession({ name: 'x'.repeat(MAX_SESSION_NAME + 50) })
    expect(s.name.length).toBe(MAX_SESSION_NAME)
  })
  it('keeps a name at exactly the limit', () => {
    const s = sanitizeSession({ name: 'x'.repeat(MAX_SESSION_NAME) })
    expect(s.name.length).toBe(MAX_SESSION_NAME)
  })
  it('truncates an over-long preset name', () => {
    const s = sanitizeSession({ presetName: 'p'.repeat(MAX_PRESET_NAME + 10) })
    expect(s.presetName?.length).toBe(MAX_PRESET_NAME)
  })
  it('accepts an empty name (falls back to a default)', () => {
    expect(sanitizeSession({ name: '' }).name).toBe('')
  })
})

describe('tuning limits (§16)', () => {
  it('accepts a tuning at the note-count limit', () => {
    const t = { ...validTuning, scaleCents: cents(MAX_TUNING_NOTES), name: 'big' }
    expect(sanitizeSession({ tuning: t }).tuning?.scaleCents.length).toBe(MAX_TUNING_NOTES)
  })
  it('rejects a tuning one note over the limit (falls back to 12-TET)', () => {
    const t = { ...validTuning, scaleCents: cents(MAX_TUNING_NOTES + 1), name: 'toobig' }
    expect(sanitizeSession({ tuning: t }).tuning).toBeUndefined()
  })
  it('does not hang on an extreme scaleCents array', () => {
    const t = { ...validTuning, scaleCents: cents(1_000_000) }
    // Rejected by the length pre-check before any O(n) validation.
    expect(sanitizeSession({ tuning: t }).tuning).toBeUndefined()
  })
  it('truncates an over-long tuning name', () => {
    const t = { ...validTuning, name: 'n'.repeat(MAX_TUNING_NAME + 100) }
    expect(sanitizeSession({ tuning: t }).tuning?.name.length).toBe(MAX_TUNING_NAME)
  })
})

describe('keyboard-map limits (§16)', () => {
  const withMap = (len: number) =>
    sanitizeSession({
      tuning: { ...validTuning, name: 'k' },
      keyboardMap: { refNote: 60, degrees: Array.from({ length: len }, (_, i) => i % 12) },
    })

  it('accepts a keyboard map at the length limit', () => {
    expect(withMap(MAX_KEYBOARD_MAP_DEGREES).keyboardMap?.degrees.length).toBe(MAX_KEYBOARD_MAP_DEGREES)
  })
  it('rejects a keyboard map one entry over the limit', () => {
    expect(withMap(MAX_KEYBOARD_MAP_DEGREES + 1).keyboardMap).toBeUndefined()
  })
  it('rejects an empty keyboard map', () => {
    expect(withMap(0).keyboardMap).toBeUndefined()
  })
})

describe('JSON import size guard (§16)', () => {
  it('rejects an oversized (but otherwise valid) JSON payload before parsing', () => {
    const big = JSON.stringify({ name: 'a'.repeat(MAX_JSON_IMPORT_BYTES) })
    expect(big.length).toBeGreaterThan(MAX_JSON_IMPORT_BYTES)
    expect(importSessionJSON(big)).toBeNull()
  })
  it('accepts a small valid payload', () => {
    expect(importSessionJSON(JSON.stringify({ name: 'ok' }))?.name).toBe('ok')
  })
  it('returns null on malformed JSON', () => {
    expect(importSessionJSON('{not json')).toBeNull()
  })
})

describe('share fragment size guards (§16)', () => {
  it('rejects an over-long fragment before Base64 decoding', () => {
    expect(decodeSession('k'.repeat(MAX_SHARE_FRAGMENT_CHARS + 1))).toBeNull()
  })
  it('rejects empty / malformed fragments', () => {
    expect(decodeSession('')).toBeNull()
    expect(decodeSession('!!!not base64!!!')).toBeNull()
  })
  it('the decoded-size ceiling is larger than the fragment ceiling', () => {
    // Base64 inflates ~4/3, so a bounded fragment implies a bounded decode.
    expect(MAX_DECODED_SHARE_CHARS).toBeGreaterThanOrEqual(MAX_SHARE_FRAGMENT_CHARS)
  })
})
