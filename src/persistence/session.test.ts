import { describe, expect, it } from 'vitest'
import { DEFAULT_BPM, MAX_BPM, MIN_BPM, MODES, SESSION_VERSION } from '../types'
import type { Session } from '../types'
import {
  MAX_PHRASE_EVENTS,
  MAX_PHRASE_LENGTH_BEATS,
  defaultSession,
  exportSessionJSON,
  importSessionJSON,
  migrateSession,
  sanitizeSession,
} from './session'

describe('stored BPM (§10)', () => {
  it('defaults to DEFAULT_BPM when absent (old sessions)', () => {
    expect(defaultSession().bpm).toBe(DEFAULT_BPM)
    expect(sanitizeSession({}).bpm).toBe(DEFAULT_BPM)
    expect(migrateSession({ root: 2, scale: 'dorian' }).bpm).toBe(DEFAULT_BPM)
  })

  it('preserves an in-range BPM', () => {
    expect(sanitizeSession({ bpm: 90 }).bpm).toBe(90)
  })

  it('clamps out-of-range and rejects non-finite BPM', () => {
    expect(sanitizeSession({ bpm: 5 }).bpm).toBe(MIN_BPM)
    expect(sanitizeSession({ bpm: 100000 }).bpm).toBe(MAX_BPM)
    expect(sanitizeSession({ bpm: Number.NaN }).bpm).toBe(DEFAULT_BPM)
    expect(sanitizeSession({ bpm: Infinity }).bpm).toBe(DEFAULT_BPM)
    expect(sanitizeSession({ bpm: 'fast' }).bpm).toBe(DEFAULT_BPM)
  })

  it('survives a JSON export/import round-trip', () => {
    const s: Session = { ...defaultSession(), bpm: 96 }
    const back = importSessionJSON(exportSessionJSON(s))
    expect(back?.bpm).toBe(96)
  })
})

describe('deprecated unison chord mode (§7)', () => {
  it('migrates a stored unison chord mode to off', () => {
    expect(sanitizeSession({ chordMode: 'unison' }).chordMode).toBe('off')
  })
  it('leaves other chord modes untouched', () => {
    expect(sanitizeSession({ chordMode: 'triad' }).chordMode).toBe('triad')
    expect(sanitizeSession({ chordMode: 'fifth' }).chordMode).toBe('fifth')
  })
})

describe('defaultSession', () => {
  it('produces a self-consistent, current-version session', () => {
    const s = defaultSession()
    expect(s.version).toBe(SESSION_VERSION)
    expect(MODES).toContain(s.mode)
    expect(s.keyRoot).toBeGreaterThanOrEqual(0)
    expect(s.keyRoot).toBeLessThanOrEqual(11)
    expect(s.phrase).toBeNull()
    expect(s.chordMode).toBe('off')
  })

  it('is idempotent under sanitize (defaults are already valid)', () => {
    const s = defaultSession()
    expect(sanitizeSession(s)).toEqual(s)
  })

  it('returns a fresh object each call (no shared mutable references)', () => {
    const a = defaultSession()
    const b = defaultSession()
    expect(a).not.toBe(b)
    expect(a.surface).not.toBe(b.surface)
    a.surface.rows = 99
    expect(b.surface.rows).not.toBe(99)
  })
})

describe('sanitizeSession — garbage input', () => {
  it('null → valid default-ish session', () => {
    expect(sanitizeSession(null)).toEqual(defaultSession())
  })

  it('undefined → valid default-ish session', () => {
    expect(sanitizeSession(undefined)).toEqual(defaultSession())
  })

  it('primitive/array garbage → valid default-ish session', () => {
    expect(sanitizeSession(42)).toEqual(defaultSession())
    expect(sanitizeSession('nope')).toEqual(defaultSession())
    expect(sanitizeSession([1, 2, 3])).toEqual(defaultSession())
  })

  it('never throws on deeply malformed nested shapes', () => {
    const raw = {
      keyRoot: 'x',
      mode: 123,
      surface: 'not-an-object',
      patch: { osc1: null, filter: [], ampEnv: 5 },
      fx: { delay: 'no', reverb: null },
      macros: 7,
      arp: { mode: 'sideways', division: 'fast' },
      midi: { outChannel: {} },
      phrase: { events: 'nope', lengthBeats: 'x' },
    }
    expect(() => sanitizeSession(raw)).not.toThrow()
    const s = sanitizeSession(raw)
    expect(MODES).toContain(s.mode)
  })
})

describe('sanitizeSession — clamping numbers', () => {
  it('clamps keyRoot into 0..11', () => {
    expect(sanitizeSession({ keyRoot: -5 }).keyRoot).toBe(0)
    expect(sanitizeSession({ keyRoot: 99 }).keyRoot).toBe(11)
    expect(sanitizeSession({ keyRoot: 7 }).keyRoot).toBe(7)
  })

  it('rounds keyRoot to an integer pitch class', () => {
    expect(sanitizeSession({ keyRoot: 3.7 }).keyRoot).toBe(4)
  })

  it('replaces NaN/Infinity numbers with defaults', () => {
    const d = defaultSession()
    expect(sanitizeSession({ keyRoot: Number.NaN }).keyRoot).toBe(d.keyRoot)
    expect(sanitizeSession({ patch: { volume: Number.POSITIVE_INFINITY } }).patch.volume).toBe(
      d.patch.volume,
    )
  })

  it('clamps 0..1 unit params (macros, volume, quantize)', () => {
    const s = sanitizeSession({
      macros: { glow: 5, motion: -2, air: 0.4, grit: 100 },
      patch: { volume: 9 },
      surface: { quantize: -3 },
    })
    expect(s.macros.glow).toBe(1)
    expect(s.macros.motion).toBe(0)
    expect(s.macros.air).toBeCloseTo(0.4)
    expect(s.macros.grit).toBe(1)
    expect(s.patch.volume).toBe(1)
    expect(s.surface.quantize).toBe(0)
  })

  it('clamps midi outChannel into 1..16 as an integer', () => {
    expect(sanitizeSession({ midi: { outChannel: 0 } }).midi.outChannel).toBe(1)
    expect(sanitizeSession({ midi: { outChannel: 50 } }).midi.outChannel).toBe(16)
    expect(sanitizeSession({ midi: { outChannel: 9.6 } }).midi.outChannel).toBe(10)
  })

  it('clamps filter cutoff into audible range', () => {
    expect(sanitizeSession({ patch: { filter: { cutoff: 1 } } }).patch.filter.cutoff).toBe(20)
    expect(sanitizeSession({ patch: { filter: { cutoff: 999999 } } }).patch.filter.cutoff).toBe(
      20000,
    )
  })
})

describe('sanitizeSession — enum coercion', () => {
  it('coerces invalid mode to default', () => {
    expect(sanitizeSession({ mode: 'klingon' }).mode).toBe(defaultSession().mode)
    expect(sanitizeSession({ mode: 'dorian' }).mode).toBe('dorian')
  })

  it('coerces invalid chordMode / surface layout / arp mode', () => {
    expect(sanitizeSession({ chordMode: 'nope' }).chordMode).toBe('off')
    expect(sanitizeSession({ chordMode: 'triad' }).chordMode).toBe('triad')
    expect(sanitizeSession({ surface: { layout: 'hex' } }).surface.layout).toBe('grid')
    expect(sanitizeSession({ arp: { mode: 'sideways' } }).arp.mode).toBe(defaultSession().arp.mode)
    expect(sanitizeSession({ arp: { mode: 'random' } }).arp.mode).toBe('random')
  })

  it('coerces oscillator wave and glide mode', () => {
    expect(sanitizeSession({ patch: { osc1: { wave: 'buzz' } } }).patch.osc1.wave).toBe(
      defaultSession().patch.osc1.wave,
    )
    expect(sanitizeSession({ patch: { osc2: { wave: 'sine' } } }).patch.osc2.wave).toBe('sine')
    expect(sanitizeSession({ patch: { glide: { mode: 'weird' } } }).patch.glide.mode).toBe('off')
  })
})

describe('sanitizeSession — booleans, strings, unknown keys', () => {
  it('coerces booleans and falls back for non-booleans', () => {
    expect(sanitizeSession({ arp: { enabled: true } }).arp.enabled).toBe(true)
    expect(sanitizeSession({ arp: { enabled: 'yes' } }).arp.enabled).toBe(
      defaultSession().arp.enabled,
    )
  })

  it('keeps valid name strings and falls back on non-strings', () => {
    expect(sanitizeSession({ name: 'My Patch' }).name).toBe('My Patch')
    expect(sanitizeSession({ name: 123 }).name).toBe(defaultSession().name)
  })

  it('preserves presetName when a valid string, omits otherwise', () => {
    expect(sanitizeSession({ presetName: 'Init' }).presetName).toBe('Init')
    expect('presetName' in sanitizeSession({ presetName: 42 })).toBe(false)
    expect('presetName' in sanitizeSession({})).toBe(false)
  })

  it('drops unknown top-level and nested keys', () => {
    const s = sanitizeSession({ bogus: 1, surface: { rows: 4, junk: 'x' } }) as unknown as Record<
      string,
      unknown
    >
    expect('bogus' in s).toBe(false)
    expect('junk' in (s.surface as Record<string, unknown>)).toBe(false)
  })
})

describe('sanitizeSession — phrase & arrays element-wise', () => {
  it('keeps null phrase', () => {
    expect(sanitizeSession({ phrase: null }).phrase).toBeNull()
  })

  it('drops invalid phrase (non-object) to null', () => {
    expect(sanitizeSession({ phrase: 'x' }).phrase).toBeNull()
  })

  it('validates events element-wise, dropping malformed entries', () => {
    const s = sanitizeSession({
      phrase: {
        lengthBeats: 8,
        events: [
          { time: 0, type: 'on', degree: 0, octave: 4 },
          'garbage',
          { time: 1, type: 'bogus', degree: 2, octave: 4 },
          { time: 2, type: 'off', degree: 0, octave: 4, expression: { pitch: 60, glide: 0, timbre: 5, pressure: -1 } },
          null,
        ],
      },
    })
    expect(s.phrase).not.toBeNull()
    const phrase = s.phrase as NonNullable<Session['phrase']>
    expect(phrase.lengthBeats).toBe(8)
    // 'garbage', bad-type event, and null dropped; two remain.
    expect(phrase.events).toHaveLength(2)
    expect(phrase.events[0]?.type).toBe('on')
    expect(phrase.events[1]?.type).toBe('off')
    // expression clamped element-wise
    expect(phrase.events[1]?.expression?.timbre).toBe(1)
    expect(phrase.events[1]?.expression?.pressure).toBe(0)
  })

  it('caps event count and clamps lengthBeats against oversized imports', () => {
    const events = Array.from({ length: MAX_PHRASE_EVENTS + 500 }, (_, i) => ({
      time: i,
      type: i % 2 === 0 ? 'on' : 'off',
      degree: 0,
      octave: 4,
    }))
    const s = sanitizeSession({
      phrase: { lengthBeats: Number.MAX_SAFE_INTEGER, events },
    })
    const phrase = s.phrase as NonNullable<Session['phrase']>
    expect(phrase.events).toHaveLength(MAX_PHRASE_EVENTS)
    expect(phrase.lengthBeats).toBe(MAX_PHRASE_LENGTH_BEATS)
    // per-event time is also bounded to the max loop length
    expect(phrase.events.every((e) => e.time <= MAX_PHRASE_LENGTH_BEATS)).toBe(true)
  })
})

describe('migrateSession', () => {
  it('bumps a legacy v0 object (root/scale field names) to current', () => {
    const legacy = { version: 0, root: 5, scale: 'dorian', name: 'Old' }
    const s = migrateSession(legacy)
    expect(s.version).toBe(SESSION_VERSION)
    expect(s.keyRoot).toBe(5)
    expect(s.mode).toBe('dorian')
    expect(s.name).toBe('Old')
  })

  it('treats a versionless object as legacy and still sanitizes', () => {
    const s = migrateSession({ root: 2 })
    expect(s.version).toBe(SESSION_VERSION)
    expect(s.keyRoot).toBe(2)
  })

  it('passes a current-version session through unchanged in shape', () => {
    const cur = defaultSession()
    expect(migrateSession(cur)).toEqual(cur)
  })

  it('never throws on garbage', () => {
    expect(() => migrateSession(null)).not.toThrow()
    expect(migrateSession(null)).toEqual(defaultSession())
  })
})

describe('export / import JSON', () => {
  it('exports pretty-printed, sanitized JSON', () => {
    const json = exportSessionJSON(defaultSession())
    expect(json).toContain('\n')
    expect(json).toContain('  ')
    expect(JSON.parse(json).version).toBe(SESSION_VERSION)
  })

  it('export → import round-trip is stable', () => {
    const s = defaultSession()
    s.name = 'Roundtrip'
    s.keyRoot = 9
    s.mode = 'lydian'
    const back = importSessionJSON(exportSessionJSON(s))
    expect(back).toEqual(sanitizeSession(s))
  })

  it('re-export of imported data is byte-identical (stable)', () => {
    const first = exportSessionJSON(defaultSession())
    const parsed = importSessionJSON(first)
    expect(parsed).not.toBeNull()
    const second = exportSessionJSON(parsed as Session)
    expect(second).toBe(first)
  })

  it('sanitizes dirty input on export', () => {
    const dirty = { keyRoot: 999, mode: 'bogus' } as unknown as Session
    const json = exportSessionJSON(dirty)
    const parsed = JSON.parse(json)
    expect(parsed.keyRoot).toBe(11)
    expect(MODES).toContain(parsed.mode)
  })

  it('import returns null on invalid JSON text', () => {
    expect(importSessionJSON('{ not json')).toBeNull()
    expect(importSessionJSON('')).toBeNull()
  })

  it('import migrates + sanitizes a legacy JSON payload', () => {
    const legacyJson = JSON.stringify({ version: 0, root: 3, scale: 'blues' })
    const s = importSessionJSON(legacyJson)
    expect(s).not.toBeNull()
    expect((s as Session).mode).toBe('blues')
    expect((s as Session).keyRoot).toBe(3)
    expect((s as Session).version).toBe(SESSION_VERSION)
  })
})

describe('keyboardMap persistence (§3-A/§4)', () => {
  const tuning = { tonicHz: 261.6255653005986, scaleCents: [0, 400, 800], period: 1200, name: 'aug' }

  it('round-trips a keyboard map alongside a tuning', () => {
    const s = sanitizeSession({
      ...defaultSession(),
      tuning,
      keyboardMap: { refNote: 60, degrees: [0, 1, 2] },
    })
    expect(s.keyboardMap).toEqual({ refNote: 60, degrees: [0, 1, 2] })
    // Survives a JSON export → import cycle.
    const back = importSessionJSON(exportSessionJSON(s)) as Session
    expect(back.keyboardMap).toEqual({ refNote: 60, degrees: [0, 1, 2] })
  })

  it('drops a keyboard map with no active tuning (it is meaningless alone)', () => {
    const s = sanitizeSession({
      ...defaultSession(),
      tuning: undefined,
      keyboardMap: { refNote: 60, degrees: [0, 1, 2] },
    })
    expect(s.keyboardMap).toBeUndefined()
  })

  it('coerces non-integer degree entries to the unmapped sentinel (-1)', () => {
    const s = sanitizeSession({
      ...defaultSession(),
      tuning,
      keyboardMap: { refNote: 60.7, degrees: [0, 'x', 2.5, 3] },
    })
    expect(s.keyboardMap).toEqual({ refNote: 60, degrees: [0, -1, -1, 3] })
  })
})
