import { describe, expect, it } from 'vitest'
import { DEFAULT_BPM, MODES, SESSION_VERSION, type Mode, type Session } from '../types'
import {
  COMPACT_VERSION,
  createDefaultSession,
  decodeSession,
  encodeSession,
  sanitizeSession,
  sessionFromUrl,
  sessionToShareUrl,
} from './codec'

/** Mirror of the codec's internal Unicode-safe base64, for hand-crafting payloads. */
function b64(obj: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
}

/** Decode the codec's base64url wire string back to its JSON string. */
function decodeWire(encoded: string): string {
  const std = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const pad = std.length % 4
  const padded = std + (pad === 2 ? '==' : pad === 3 ? '=' : '')
  return decodeURIComponent(escape(atob(padded)))
}

import { sanitizeSession as persistSanitize } from '../persistence/session'

/** A fully-populated, already-canonical session for exact round-trip assertions. */
function makeSession(overrides: Partial<Session> = {}): Session {
  const base = createDefaultSession()
  return sanitizeSession({ ...base, ...overrides })
}

describe('deprecated unison chord mode in share links (§7)', () => {
  it('decodes a legacy unison (compact index 1) to off', () => {
    // Hand-craft a compact payload that still encodes chordMode index 1 (unison).
    const s = makeSession()
    const compact = JSON.parse(decodeWire(encodeSession(s))) as Record<string, unknown>
    compact.cm = 1 // legacy 'unison' index
    const back = decodeSession(b64(compact))
    expect(back?.chordMode).toBe('off')
  })
})

describe('stored BPM in share links (§10)', () => {
  it('round-trips local BPM through a share link', () => {
    const s = makeSession({ bpm: 96 })
    const back = decodeSession(encodeSession(s))
    expect(back?.bpm).toBe(96)
  })

  it('an old payload without BPM decodes to the default', () => {
    // Hand-craft a compact payload with no `bp` field (pre-§10 share links).
    const s = makeSession({ bpm: 150 })
    const compact = JSON.parse(decodeWire(encodeSession(s))) as Record<string, unknown>
    delete compact.bp
    const back = decodeSession(b64(compact))
    expect(back?.bpm).toBe(DEFAULT_BPM)
  })
})

describe('share ↔ save bound parity (§4)', () => {
  // The share codec and the persistence sanitizer must agree on arp/unison
  // bounds, or a share→save→reload silently rewrites values. These lock the
  // two sanitizers to the same fixpoint.
  it('preserves arp + unison values across share→save→reload', () => {
    const s = makeSession()
    s.arp = { ...s.arp, enabled: true, division: 8, octaves: 3 }
    s.patch.unison = { voices: 6, detune: 0.4, spread: 0.7 }
    const canonical = sanitizeSession(s)

    const shared = decodeSession(encodeSession(canonical))! // share round-trip
    const reloaded = persistSanitize(shared) // save + reload

    expect(shared.arp).toEqual(canonical.arp)
    expect(shared.patch.unison).toEqual(canonical.patch.unison)
    expect(reloaded.arp).toEqual(canonical.arp)
    expect(reloaded.patch.unison).toEqual(canonical.patch.unison)
  })

  it('arp.division is an integer in BOTH sanitizers (no fractional drift)', () => {
    // A hand-crafted payload with a fractional division must land on the same
    // integer through the share codec and the persistence path — not survive
    // the share only to be rounded on the next save.
    const raw = { ...createDefaultSession(), arp: { ...createDefaultSession().arp, division: 8.5 } }
    const shared = sanitizeSession(raw)
    const saved = persistSanitize(raw)
    expect(Number.isInteger(shared.arp.division)).toBe(true)
    expect(shared.arp.division).toBe(saved.arp.division)
  })

  it('unison.voices caps at 8 (the worklet limit) in both sanitizers', () => {
    const raw = { ...createDefaultSession() }
    raw.patch = { ...raw.patch, unison: { voices: 99, detune: 0.5, spread: 0.5 } }
    expect(sanitizeSession(raw).patch.unison.voices).toBe(8)
    expect(persistSanitize(raw).patch.unison.voices).toBe(8)
  })
})

describe('encodeSession / decodeSession round-trip', () => {
  it('preserves every field of a canonical default session', () => {
    const s = makeSession()
    const back = decodeSession(encodeSession(s))
    expect(back).toEqual(s)
  })

  it('preserves non-default field values within range', () => {
    const s = makeSession({
      name: 'My Patch ✨',
      keyRoot: 7,
      mode: 'dorian',
      chordMode: 'triad',
      presetName: 'lead-1',
    })
    const back = decodeSession(encodeSession(s))
    expect(back).toEqual(s)
    expect(back?.name).toBe('My Patch ✨')
    expect(back?.keyRoot).toBe(7)
    expect(back?.presetName).toBe('lead-1')
  })

  it('preserves optional patch fields when present', () => {
    const s = makeSession()
    s.patch.osc1.pulseWidth = 0.4
    s.patch.osc1.sync = true
    s.patch.osc1.fm = 2.5
    s.patch.lfo.division = 16
    const canonical = sanitizeSession(s)
    const back = decodeSession(encodeSession(canonical))
    expect(back).toEqual(canonical)
    expect(back?.patch.osc1.pulseWidth).toBe(0.4)
    expect(back?.patch.osc1.sync).toBe(true)
    expect(back?.patch.lfo.division).toBe(16)
  })

  it('round-trips a session with a recorded phrase and expression', () => {
    const s = makeSession({
      phrase: {
        lengthBeats: 8,
        events: [
          { time: 0, type: 'on', degree: 0, octave: 3 },
          {
            time: 1.5,
            type: 'on',
            degree: 2,
            octave: 3,
            expression: { pitch: 62.3, glide: 0.2, timbre: 0.6, pressure: 0.8 },
          },
          { time: 2, type: 'off', degree: 0, octave: 3 },
        ],
      },
    })
    const back = decodeSession(encodeSession(s))
    expect(back).toEqual(s)
    expect(back?.phrase?.events).toHaveLength(3)
    expect(back?.phrase?.events[1].expression?.pitch).toBeCloseTo(62.3)
  })

  it('round-trips a null phrase', () => {
    const s = makeSession({ phrase: null })
    const back = decodeSession(encodeSession(s))
    expect(back?.phrase).toBeNull()
  })

  it('always stamps the current SESSION_VERSION on decode', () => {
    const s = makeSession()
    const back = decodeSession(encodeSession(s))
    expect(back?.version).toBe(SESSION_VERSION)
  })
})

describe('URL-safe encoding (base64url)', () => {
  it('emits no +, / or = in the encoded string', () => {
    // Force a payload likely to hit +/-//= in standard base64 (long name).
    const s = makeSession({ name: 'zzzz~~~~????>>>>ffff' })
    const encoded = encodeSession(s)
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('still decodes a percent-encoded fragment', () => {
    const s = makeSession({ keyRoot: 3 })
    const encoded = encodeSession(s)
    // An intermediary percent-encodes the fragment; decode must still work.
    const back = decodeSession(encodeURIComponent(encoded))
    expect(back?.keyRoot).toBe(3)
  })

  it('still decodes legacy +/= base64 links and + mangled to a space', () => {
    const s = makeSession({ name: 'zzzz~~~~????>>>>ffff', keyRoot: 5 })
    const legacy = b64(JSON.parse(decodeWire(encodeSession(s))))
    expect(decodeSession(legacy)?.keyRoot).toBe(5)
    // A linkifier turned every '+' into a space; the codec recovers it.
    expect(decodeSession(legacy.replace(/\+/g, ' '))?.keyRoot).toBe(5)
  })
})

describe('malformed input', () => {
  it('returns null for an empty string', () => {
    expect(decodeSession('')).toBeNull()
  })

  it('returns null for non-base64 garbage', () => {
    expect(decodeSession('!!!! not base64 @@@')).toBeNull()
  })

  it('returns null for valid base64 that is not JSON', () => {
    expect(decodeSession(btoa('hello world'))).toBeNull()
  })

  it('returns null for JSON that is not an object', () => {
    expect(decodeSession(b64(5))).toBeNull()
    expect(decodeSession(b64([1, 2, 3]))).toBeNull()
    expect(decodeSession(b64(null))).toBeNull()
    expect(decodeSession(b64('a string'))).toBeNull()
  })
})

describe('sanitizeSession clamping', () => {
  it('coerces an empty object into a valid default session', () => {
    const s = sanitizeSession({})
    expect(s).toEqual(createDefaultSession())
  })

  it('clamps out-of-range numeric fields decoded from a crafted payload', () => {
    // Hand-build a compact payload with wild values; short keys mirror the codec.
    const payload = b64({
      v: COMPACT_VERSION,
      k: 999, // keyRoot out of range
      m: -4, // mode index out of range
      su: [5, 0, -3, 999, 5, -1], // layout idx, rows, cols, offset, quantize, baseOctave
      cm: 42, // chordMode out of range
    })
    const s = decodeSession(payload)
    expect(s).not.toBeNull()
    expect(s?.keyRoot).toBeGreaterThanOrEqual(0)
    expect(s?.keyRoot).toBeLessThanOrEqual(11)
    expect(MODES).toContain(s?.mode)
    expect(s?.surface.quantize).toBeGreaterThanOrEqual(0)
    expect(s?.surface.quantize).toBeLessThanOrEqual(1)
    expect(s?.surface.rows).toBeGreaterThanOrEqual(1)
    expect(['off', 'unison', 'fifth', 'octave', 'triad']).toContain(s?.chordMode)
  })
})

describe('mode index stability', () => {
  it('encodes the mode as its MODES index and restores it', () => {
    for (const mode of MODES) {
      const s = makeSession({ mode })
      const encoded = encodeSession(s)
      // Inspect the wire format: `m` must equal the stable index.
      const wire = JSON.parse(decodeWire(encoded)) as { m: number }
      expect(wire.m).toBe(MODES.indexOf(mode))
      expect(decodeSession(encoded)?.mode).toBe(mode)
    }
  })

  it('maps a specific index back to the same Mode', () => {
    const modeAtIndex2 = MODES[2] as Mode
    const s = makeSession({ mode: modeAtIndex2 })
    expect(decodeSession(encodeSession(s))?.mode).toBe(modeAtIndex2)
  })
})

describe('version mismatch handling', () => {
  it('gracefully decodes a payload with an unknown compact version', () => {
    const s = makeSession({ keyRoot: 5, mode: 'lydian' })
    const encoded = encodeSession(s)
    const wire = JSON.parse(decodeURIComponent(escape(atob(encoded)))) as Record<string, unknown>
    wire.v = 999 // future/unknown format version
    const rewrapped = b64(wire)
    const back = decodeSession(rewrapped)
    expect(back).not.toBeNull()
    // Fields still present in the payload are preserved despite the version bump.
    expect(back?.keyRoot).toBe(5)
    expect(back?.mode).toBe('lydian')
  })
})

describe('share URL round-trip', () => {
  const BASE = 'https://mkeys.app/'

  it('builds a #k= fragment and parses it back', () => {
    const s = makeSession({ keyRoot: 3, mode: 'blues' })
    const url = sessionToShareUrl(s, BASE)
    expect(url.startsWith(`${BASE}#k=`)).toBe(true)
    expect(sessionFromUrl(url)).toEqual(s)
  })

  it('parses a bare fragment with or without the leading #', () => {
    const s = makeSession({ keyRoot: 9 })
    const payload = encodeSession(s)
    expect(sessionFromUrl(`#k=${payload}`)).toEqual(s)
    expect(sessionFromUrl(`k=${payload}`)).toEqual(s)
  })

  it('finds k= among multiple fragment params', () => {
    const s = makeSession({ keyRoot: 2 })
    const payload = encodeSession(s)
    expect(sessionFromUrl(`https://x/#foo=1&k=${payload}&bar=2`)).toEqual(s)
  })

  it('returns null when the fragment has no k= param', () => {
    expect(sessionFromUrl('https://mkeys.app/#foo=bar')).toBeNull()
    expect(sessionFromUrl('https://mkeys.app/')).toBeNull()
  })

  it('returns null for a non-string url', () => {
    expect(sessionFromUrl(undefined as unknown as string)).toBeNull()
  })
})
