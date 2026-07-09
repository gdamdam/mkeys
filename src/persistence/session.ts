/**
 * Pure session (de)serialisation for mkeys.
 *
 * Everything here is total: sanitize/migrate NEVER throw and ALWAYS return a
 * valid {@link Session}. This is the trust boundary for persisted autosaves,
 * imported files and shared payloads — downstream modules may assume any
 * Session that passed through here is fully in-range and current-version.
 */

import { MODES, SESSION_VERSION } from '../types'
import { isValidTuning, normalizeTuning } from '../vendor/tuning-core/model'
import type {
  ArpConfig,
  ChordMode,
  DelayParams,
  EnvParams,
  FilterParams,
  FxParams,
  GlideParams,
  KeyboardMap,
  LfoParams,
  Macros,
  MidiConfig,
  Mode,
  OscillatorParams,
  PatchParams,
  Phrase,
  PhraseEvent,
  PortableTuning,
  ReverbParams,
  Session,
  SurfaceConfig,
  TouchExpression,
  UnisonParams,
} from '../types'

/* ------------------------------------------------------------------ */
/* Primitive coercion helpers                                          */
/* ------------------------------------------------------------------ */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read a property from an unknown value, treating non-objects as empty. */
function prop(v: unknown, key: string): unknown {
  return isObject(v) ? v[key] : undefined
}

/** Clamp a finite number into [min, max]; fall back if not a finite number. */
function num(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.min(max, Math.max(min, v))
  }
  return fallback
}

/** Like {@link num} but rounds to the nearest integer. */
function int(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.min(max, Math.max(min, Math.round(v)))
  }
  return fallback
}

/** Convenience for the very common 0..1 unit range. */
function unit(v: unknown, fallback: number): number {
  return num(v, 0, 1, fallback)
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

/** Coerce to a member of `allowed`, else return `fallback`. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

const WAVES = ['saw', 'pulse', 'sine', 'triangle'] as const
const LFO_TARGETS = ['pitch', 'filter', 'amp'] as const
const GLIDE_MODES = ['legato', 'always', 'off'] as const
const ARP_MODES = ['up', 'down', 'updown', 'random'] as const
const CHORD_MODES: readonly ChordMode[] = ['off', 'unison', 'fifth', 'octave', 'triad']
const LAYOUTS = ['grid', 'piano'] as const
const PHRASE_EVENT_TYPES = ['on', 'off'] as const

/**
 * Hard bounds on phrase size. A phrase is a short musical loop, so these are
 * generous relative to any real take yet small enough that an untrusted import
 * (or a runaway live recording) cannot exhaust memory or wedge the scheduler.
 */
export const MAX_PHRASE_EVENTS = 4096
export const MAX_PHRASE_LENGTH_BEATS = 1024

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

function defaultOsc(wave: OscillatorParams['wave'], level: number): OscillatorParams {
  return { wave, detune: 0, level, pulseWidth: 0.5, sync: false, fm: 0 }
}

function defaultEnv(attack: number, decay: number, sustain: number, release: number): EnvParams {
  return { attack, decay, sustain, release }
}

/** A fresh, fully valid session with sensible defaults for every field. */
export function defaultSession(): Session {
  return {
    version: SESSION_VERSION,
    name: 'Untitled',
    keyRoot: 0,
    mode: 'major',
    surface: {
      layout: 'grid',
      rows: 6,
      cols: 12,
      rowOffsetDegrees: 3,
      quantize: 1,
      baseOctave: 4,
    },
    patch: {
      osc1: defaultOsc('saw', 1),
      osc2: defaultOsc('saw', 0.5),
      subLevel: 0,
      noiseLevel: 0,
      filter: { cutoff: 12000, resonance: 0.2, drive: 0, envAmount: 0, keytrack: 0 },
      ampEnv: defaultEnv(0.01, 0.2, 0.7, 0.3),
      filterEnv: defaultEnv(0.01, 0.3, 0.4, 0.3),
      lfo: { rate: 5, depth: 0, target: 'filter', tempoSync: false, division: 4 },
      unison: { voices: 1, detune: 0, spread: 0 },
      glide: { time: 0, mode: 'off' },
      volume: 0.8,
    },
    fx: {
      drive: 0,
      chorus: 0,
      delay: { time: 0.3, feedback: 0.3, mix: 0, tempoSync: false, division: 4 },
      reverb: { size: 0.5, mix: 0 },
      limiterThreshold: -1,
    },
    masterVolume: 1,
    inputGain: 1,
    macros: { glow: 0, motion: 0, air: 0, grit: 0 },
    arp: { enabled: false, mode: 'up', division: 4, gate: 0.5, swing: 0, octaves: 1 },
    chordMode: 'off',
    midi: { inEnabled: false, outEnabled: false, outChannel: 1 },
    phrase: null,
  }
}

/* ------------------------------------------------------------------ */
/* Sanitizers (per nested shape)                                       */
/* ------------------------------------------------------------------ */

function sanitizeSurface(v: unknown, d: SurfaceConfig): SurfaceConfig {
  return {
    layout: oneOf(prop(v, 'layout'), LAYOUTS, d.layout),
    rows: int(prop(v, 'rows'), 1, 32, d.rows),
    cols: int(prop(v, 'cols'), 1, 32, d.cols),
    rowOffsetDegrees: int(prop(v, 'rowOffsetDegrees'), 0, 12, d.rowOffsetDegrees),
    quantize: unit(prop(v, 'quantize'), d.quantize),
    baseOctave: int(prop(v, 'baseOctave'), -1, 9, d.baseOctave),
  }
}

function sanitizeOsc(v: unknown, d: OscillatorParams): OscillatorParams {
  return {
    wave: oneOf(prop(v, 'wave'), WAVES, d.wave),
    detune: num(prop(v, 'detune'), -100, 100, d.detune),
    level: unit(prop(v, 'level'), d.level),
    pulseWidth: unit(prop(v, 'pulseWidth'), d.pulseWidth ?? 0.5),
    sync: bool(prop(v, 'sync'), d.sync ?? false),
    fm: unit(prop(v, 'fm'), d.fm ?? 0),
  }
}

function sanitizeFilter(v: unknown, d: FilterParams): FilterParams {
  return {
    cutoff: num(prop(v, 'cutoff'), 20, 20000, d.cutoff),
    resonance: unit(prop(v, 'resonance'), d.resonance),
    drive: unit(prop(v, 'drive'), d.drive),
    envAmount: num(prop(v, 'envAmount'), -1, 1, d.envAmount),
    keytrack: unit(prop(v, 'keytrack'), d.keytrack),
  }
}

function sanitizeEnv(v: unknown, d: EnvParams): EnvParams {
  return {
    attack: num(prop(v, 'attack'), 0, 30, d.attack),
    decay: num(prop(v, 'decay'), 0, 30, d.decay),
    sustain: unit(prop(v, 'sustain'), d.sustain),
    release: num(prop(v, 'release'), 0, 30, d.release),
  }
}

function sanitizeLfo(v: unknown, d: LfoParams): LfoParams {
  return {
    rate: num(prop(v, 'rate'), 0, 40, d.rate),
    depth: unit(prop(v, 'depth'), d.depth),
    target: oneOf(prop(v, 'target'), LFO_TARGETS, d.target),
    tempoSync: bool(prop(v, 'tempoSync'), d.tempoSync),
    division: int(prop(v, 'division'), 1, 64, d.division ?? 4),
  }
}

function sanitizeUnison(v: unknown, d: UnisonParams): UnisonParams {
  return {
    voices: int(prop(v, 'voices'), 1, 8, d.voices),
    detune: unit(prop(v, 'detune'), d.detune),
    spread: unit(prop(v, 'spread'), d.spread),
  }
}

function sanitizeGlide(v: unknown, d: GlideParams): GlideParams {
  return {
    time: num(prop(v, 'time'), 0, 10, d.time),
    mode: oneOf(prop(v, 'mode'), GLIDE_MODES, d.mode),
  }
}

function sanitizePatch(v: unknown, d: PatchParams): PatchParams {
  return {
    osc1: sanitizeOsc(prop(v, 'osc1'), d.osc1),
    osc2: sanitizeOsc(prop(v, 'osc2'), d.osc2),
    subLevel: unit(prop(v, 'subLevel'), d.subLevel),
    noiseLevel: unit(prop(v, 'noiseLevel'), d.noiseLevel),
    filter: sanitizeFilter(prop(v, 'filter'), d.filter),
    ampEnv: sanitizeEnv(prop(v, 'ampEnv'), d.ampEnv),
    filterEnv: sanitizeEnv(prop(v, 'filterEnv'), d.filterEnv),
    lfo: sanitizeLfo(prop(v, 'lfo'), d.lfo),
    unison: sanitizeUnison(prop(v, 'unison'), d.unison),
    glide: sanitizeGlide(prop(v, 'glide'), d.glide),
    volume: unit(prop(v, 'volume'), d.volume),
  }
}

function sanitizeDelay(v: unknown, d: DelayParams): DelayParams {
  return {
    time: num(prop(v, 'time'), 0, 5, d.time),
    feedback: unit(prop(v, 'feedback'), d.feedback),
    mix: unit(prop(v, 'mix'), d.mix),
    tempoSync: bool(prop(v, 'tempoSync'), d.tempoSync),
    division: int(prop(v, 'division'), 1, 64, d.division),
  }
}

function sanitizeReverb(v: unknown, d: ReverbParams): ReverbParams {
  return {
    size: unit(prop(v, 'size'), d.size),
    mix: unit(prop(v, 'mix'), d.mix),
  }
}

function sanitizeFx(v: unknown, d: FxParams): FxParams {
  return {
    drive: unit(prop(v, 'drive'), d.drive),
    chorus: unit(prop(v, 'chorus'), d.chorus),
    delay: sanitizeDelay(prop(v, 'delay'), d.delay),
    reverb: sanitizeReverb(prop(v, 'reverb'), d.reverb),
    limiterThreshold: num(prop(v, 'limiterThreshold'), -60, 0, d.limiterThreshold),
  }
}

function sanitizeMacros(v: unknown, d: Macros): Macros {
  return {
    glow: unit(prop(v, 'glow'), d.glow),
    motion: unit(prop(v, 'motion'), d.motion),
    air: unit(prop(v, 'air'), d.air),
    grit: unit(prop(v, 'grit'), d.grit),
  }
}

function sanitizeArp(v: unknown, d: ArpConfig): ArpConfig {
  return {
    enabled: bool(prop(v, 'enabled'), d.enabled),
    mode: oneOf(prop(v, 'mode'), ARP_MODES, d.mode),
    division: int(prop(v, 'division'), 1, 64, d.division),
    gate: unit(prop(v, 'gate'), d.gate),
    swing: unit(prop(v, 'swing'), d.swing),
    octaves: int(prop(v, 'octaves'), 1, 4, d.octaves),
  }
}

function sanitizeMidi(v: unknown, d: MidiConfig): MidiConfig {
  return {
    inEnabled: bool(prop(v, 'inEnabled'), d.inEnabled),
    outEnabled: bool(prop(v, 'outEnabled'), d.outEnabled),
    outChannel: int(prop(v, 'outChannel'), 1, 16, d.outChannel),
  }
}

function sanitizeExpression(v: unknown): TouchExpression | undefined {
  if (!isObject(v)) return undefined
  return {
    pitch: num(prop(v, 'pitch'), 0, 127, 60),
    glide: num(prop(v, 'glide'), -127, 127, 0),
    timbre: unit(prop(v, 'timbre'), 0),
    pressure: unit(prop(v, 'pressure'), 0),
  }
}

/** Validate a single event; return null (to be dropped) if unusable. */
function sanitizeEvent(v: unknown): PhraseEvent | null {
  if (!isObject(v)) return null
  const type = prop(v, 'type')
  if (typeof type !== 'string' || !(PHRASE_EVENT_TYPES as readonly string[]).includes(type)) {
    return null
  }
  const event: PhraseEvent = {
    time: num(prop(v, 'time'), 0, MAX_PHRASE_LENGTH_BEATS, 0),
    type: type as PhraseEvent['type'],
    degree: int(prop(v, 'degree'), -128, 128, 0),
    octave: int(prop(v, 'octave'), -2, 10, 4),
  }
  const expr = sanitizeExpression(prop(v, 'expression'))
  if (expr) event.expression = expr
  return event
}

function sanitizePhrase(v: unknown): Phrase | null {
  if (!isObject(v)) return null
  const rawEvents = prop(v, 'events')
  const events: PhraseEvent[] = Array.isArray(rawEvents)
    ? rawEvents
        .slice(0, MAX_PHRASE_EVENTS)
        .map(sanitizeEvent)
        .filter((e): e is PhraseEvent => e !== null)
    : []
  return {
    events,
    lengthBeats: num(prop(v, 'lengthBeats'), 0, MAX_PHRASE_LENGTH_BEATS, 4),
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Coerce arbitrary untrusted input into a valid, current-version Session.
 * Clamps every numeric to range, coerces enums, drops unknown keys and
 * validates arrays element-wise. Never throws.
 */
export function sanitizeSession(raw: unknown): Session {
  const d = defaultSession()
  const s: Session = {
    version: SESSION_VERSION,
    name: str(prop(raw, 'name'), d.name),
    keyRoot: int(prop(raw, 'keyRoot'), 0, 11, d.keyRoot),
    mode: oneOf<Mode>(prop(raw, 'mode'), MODES, d.mode),
    surface: sanitizeSurface(prop(raw, 'surface'), d.surface),
    patch: sanitizePatch(prop(raw, 'patch'), d.patch),
    fx: sanitizeFx(prop(raw, 'fx'), d.fx),
    masterVolume: num(prop(raw, 'masterVolume'), 0, 1, d.masterVolume),
    inputGain: num(prop(raw, 'inputGain'), 0, 2, d.inputGain),
    macros: sanitizeMacros(prop(raw, 'macros'), d.macros),
    arp: sanitizeArp(prop(raw, 'arp'), d.arp),
    chordMode: oneOf<ChordMode>(prop(raw, 'chordMode'), CHORD_MODES, d.chordMode),
    midi: sanitizeMidi(prop(raw, 'midi'), d.midi),
    phrase: sanitizePhrase(prop(raw, 'phrase')),
  }
  const tuning = sanitizeTuning(prop(raw, 'tuning'))
  if (tuning) s.tuning = tuning
  // The MIDI-in keyboard map only makes sense alongside a tuning (§3-A).
  const keyboardMap = tuning ? sanitizeKeyboardMap(prop(raw, 'keyboardMap')) : undefined
  if (keyboardMap) s.keyboardMap = keyboardMap
  const presetName = prop(raw, 'presetName')
  if (typeof presetName === 'string') s.presetName = presetName
  return s
}

/** Accept a tuning only if it is a valid PortableTuning; else undefined (12-TET). */
function sanitizeTuning(raw: unknown): PortableTuning | undefined {
  return isValidTuning(raw) ? normalizeTuning(raw) : undefined
}

/** Accept a `.kbm` keyboard map (refNote + integer degree list); else undefined. */
function sanitizeKeyboardMap(raw: unknown): KeyboardMap | undefined {
  if (!isObject(raw)) return undefined
  const refNote = prop(raw, 'refNote')
  const degrees = prop(raw, 'degrees')
  if (typeof refNote !== 'number' || !Number.isFinite(refNote)) return undefined
  if (!Array.isArray(degrees) || degrees.length === 0) return undefined
  const clean = degrees.map((d) => (typeof d === 'number' && Number.isInteger(d) ? d : -1))
  return { refNote: Math.trunc(refNote), degrees: clean }
}

/**
 * Bring an older-shaped payload up to the current schema, then sanitize.
 * Legacy (v0 / versionless) sessions used `root`/`scale` field names.
 */
export function migrateSession(raw: unknown): Session {
  if (!isObject(raw)) return sanitizeSession(raw)
  const obj: Record<string, unknown> = { ...raw }
  const version = typeof obj.version === 'number' ? obj.version : 0
  if (version < 1) {
    if (!('keyRoot' in obj) && 'root' in obj) obj.keyRoot = obj.root
    if (!('mode' in obj) && 'scale' in obj) obj.mode = obj.scale
    obj.version = SESSION_VERSION
  }
  return sanitizeSession(obj)
}

/** Serialise a session as pretty-printed, sanitized JSON. */
export function exportSessionJSON(s: Session): string {
  return JSON.stringify(sanitizeSession(s), null, 2)
}

/**
 * Parse + migrate + sanitize a JSON string. Returns null only when the text
 * is not valid JSON; any parseable value yields a valid Session.
 */
export function importSessionJSON(text: string): Session | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return migrateSession(parsed)
}
