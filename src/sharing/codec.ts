/**
 * Backend-free share codec: Session ⇆ a self-contained URL fragment.
 *
 * The wire format is a COMPACT object: short keys and integer indices into the
 * type-level const arrays (MODES + a few codec-local enum arrays) instead of the
 * verbose string enums. Enum *indices* are stable as long as those arrays only
 * ever append (types.ts already requires this for MODES), so the compact form is
 * itself versioned via `v` and decoded back through `sanitizeSession`, which
 * tolerates anything out of range.
 *
 * Pipeline: compact obj → JSON → encodeURIComponent → btoa. `btoa` needs Latin-1
 * and encodeURIComponent guarantees ASCII, so the pair round-trips arbitrary
 * Unicode safely and stays dependency-free.
 *
 * This module is intentionally self-contained: it carries its own defaults and
 * sanitiser rather than depending on a persistence layer, so it can ship (and be
 * tested) independently. If a shared `sanitizeSession` later lands in
 * persistence, this local copy is the natural thing to delete.
 */
import {
  MODES,
  SESSION_VERSION,
  type ArpConfig,
  type ChordMode,
  type DelayParams,
  type EnvParams,
  type FilterParams,
  type FxParams,
  type GlideParams,
  type LfoParams,
  type Macros,
  type MidiConfig,
  type Mode,
  type OscillatorParams,
  type PatchParams,
  type Phrase,
  type PhraseEvent,
  type ReverbParams,
  type Session,
  type SurfaceConfig,
  type TouchExpression,
  type UnisonParams,
} from '../types'

/** Stable URL-fragment param key: `…#k=<payload>`. */
const FRAGMENT_KEY = 'k'

/** Compact-format version (independent of SESSION_VERSION; bump on format change). */
export const COMPACT_VERSION = 1

// ---------------------------------------------------------------------------
// Codec-local enum orderings (APPEND-ONLY, same discipline as MODES).
// Defined here because types.ts exposes these as string unions without const
// arrays; keeping them local avoids editing the shared contract.
// ---------------------------------------------------------------------------

const LAYOUTS = ['grid', 'piano'] as const
const WAVES = ['saw', 'pulse', 'sine', 'triangle'] as const
const LFO_TARGETS = ['pitch', 'filter', 'amp'] as const
const GLIDE_MODES = ['legato', 'always', 'off'] as const
const ARP_MODES = ['up', 'down', 'updown', 'random'] as const
const CHORD_MODES = ['off', 'unison', 'fifth', 'octave', 'triad'] as const
const EVENT_TYPES = ['on', 'off'] as const

// ---------------------------------------------------------------------------
// Compact wire shapes (tuples for fixed-arity structs; short-keyed objects for
// the larger groupings so the payload stays reviewable).
// ---------------------------------------------------------------------------

/** [waveIdx, detune, level, pulseWidth|null, sync 0/1|null, fm|null] */
type CompactOsc = [number, number, number, number | null, number | null, number | null]
/** [cutoff, resonance, drive, envAmount, keytrack] */
type CompactFilter = [number, number, number, number, number]
/** [attack, decay, sustain, release] */
type CompactEnv = [number, number, number, number]
/** [rate, depth, targetIdx, tempoSync 0/1, division|null] */
type CompactLfo = [number, number, number, number, number | null]
/** [voices, detune, spread] */
type CompactUnison = [number, number, number]
/** [time, modeIdx] */
type CompactGlide = [number, number]
/** [time, feedback, mix, tempoSync 0/1, division] */
type CompactDelay = [number, number, number, number, number]
/** [size, mix] */
type CompactReverb = [number, number]
/** [layoutIdx, rows, cols, rowOffsetDegrees, quantize, baseOctave] */
type CompactSurface = [number, number, number, number, number, number]
/** [enabled 0/1, modeIdx, division, gate, swing, octaves] */
type CompactArp = [number, number, number, number, number, number]
/** [inEnabled 0/1, outEnabled 0/1, outChannel] */
type CompactMidi = [number, number, number]
/** [pitch, glide, timbre, pressure] */
type CompactExpr = [number, number, number, number]
/** [time, typeIdx, degree, octave, expr|null] */
type CompactEvent = [number, number, number, number, CompactExpr | null]
/** [lengthBeats, events] */
type CompactPhrase = [number, CompactEvent[]]

interface CompactPatch {
  o1: CompactOsc
  o2: CompactOsc
  sl: number // subLevel
  nl: number // noiseLevel
  fl: CompactFilter
  ae: CompactEnv // ampEnv
  fe: CompactEnv // filterEnv
  lf: CompactLfo
  un: CompactUnison
  gl: CompactGlide
  vo: number // volume
}

interface CompactFx {
  dr: number // drive
  ch: number // chorus
  dl: CompactDelay
  rv: CompactReverb
  lt: number // limiterThreshold
}

interface CompactSession {
  v: number // compact format version
  n: string // name
  k: number // keyRoot
  m: number // mode index
  su: CompactSurface
  pt: CompactPatch
  fx: CompactFx
  mc: [number, number, number, number] // macros [glow, motion, air, grit]
  ar: CompactArp
  cm: number // chordMode index
  mi: CompactMidi
  ph: CompactPhrase | null
  pn?: string // presetName (optional)
}

// ---------------------------------------------------------------------------
// Defaults — a fresh, valid Session used as the sanitiser skeleton.
// ---------------------------------------------------------------------------

/** Returns a fresh, fully-valid Session on every call (no shared mutable state). */
export function createDefaultSession(): Session {
  return {
    version: SESSION_VERSION,
    name: 'Untitled',
    keyRoot: 0,
    mode: 'major',
    surface: {
      layout: 'grid',
      rows: 4,
      cols: 12,
      rowOffsetDegrees: 3,
      quantize: 1,
      baseOctave: 3,
    },
    patch: {
      osc1: { wave: 'saw', detune: 0, level: 0.8 },
      osc2: { wave: 'sine', detune: 7, level: 0.4 },
      subLevel: 0.2,
      noiseLevel: 0,
      filter: { cutoff: 1200, resonance: 0.2, drive: 0.1, envAmount: 0.3, keytrack: 0.5 },
      ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
      filterEnv: { attack: 0.01, decay: 0.3, sustain: 0.3, release: 0.2 },
      lfo: { rate: 5, depth: 0.2, target: 'filter', tempoSync: false },
      unison: { voices: 1, detune: 0.1, spread: 0.5 },
      glide: { time: 0.05, mode: 'off' },
      volume: 0.8,
    },
    fx: {
      drive: 0.1,
      chorus: 0.2,
      delay: { time: 0.3, feedback: 0.3, mix: 0.2, tempoSync: true, division: 8 },
      reverb: { size: 0.5, mix: 0.2 },
      limiterThreshold: -3,
    },
    macros: { glow: 0.3, motion: 0.3, air: 0.3, grit: 0.3 },
    arp: { enabled: false, mode: 'up', division: 8, gate: 0.8, swing: 0, octaves: 1 },
    chordMode: 'off',
    midi: { inEnabled: false, outEnabled: false, outChannel: 1 },
    phrase: null,
  }
}

// ---------------------------------------------------------------------------
// Coercion helpers (each total — never throws)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Clamp a finite number into [min, max]; fall back otherwise. */
function num(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return value < min ? min : value > max ? max : value
}

/** Coerce to a rounded integer in [min, max], else fallback. */
function int(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Coerce loosely to boolean: true/1 → true, false/0 → false, else fallback. */
function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 0) return false
  return fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/** Accept `value` only if it is a member of `allowed`, else `fallback`. */
function coerceEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** Look an enum member up by numeric index; undefined if out of range. */
function fromIdx<T extends string>(arr: readonly T[], idx: unknown): T | undefined {
  return typeof idx === 'number' ? arr[idx] : undefined
}

// ---------------------------------------------------------------------------
// Field sanitisers — the trust boundary. Never throw; unknown → default.
// ---------------------------------------------------------------------------

function sanitizeOsc(raw: unknown, fb: OscillatorParams): OscillatorParams {
  const r = isRecord(raw) ? raw : {}
  const osc: OscillatorParams = {
    wave: coerceEnum(r.wave, WAVES, fb.wave),
    detune: num(r.detune, -1200, 1200, fb.detune),
    level: num(r.level, 0, 1, fb.level),
  }
  // Optionals: only carry them through when actually present, preserving the
  // undefined/defined distinction across a round-trip.
  if (typeof r.pulseWidth === 'number') osc.pulseWidth = num(r.pulseWidth, 0, 1, 0.5)
  if (typeof r.sync === 'boolean') osc.sync = r.sync
  if (typeof r.fm === 'number') osc.fm = num(r.fm, 0, 24, 0)
  return osc
}

function sanitizeFilter(raw: unknown, fb: FilterParams): FilterParams {
  const r = isRecord(raw) ? raw : {}
  return {
    cutoff: num(r.cutoff, 20, 20000, fb.cutoff),
    resonance: num(r.resonance, 0, 1, fb.resonance),
    drive: num(r.drive, 0, 1, fb.drive),
    envAmount: num(r.envAmount, -1, 1, fb.envAmount),
    keytrack: num(r.keytrack, 0, 1, fb.keytrack),
  }
}

function sanitizeEnv(raw: unknown, fb: EnvParams): EnvParams {
  const r = isRecord(raw) ? raw : {}
  return {
    attack: num(r.attack, 0, 30, fb.attack),
    decay: num(r.decay, 0, 30, fb.decay),
    sustain: num(r.sustain, 0, 1, fb.sustain),
    release: num(r.release, 0, 30, fb.release),
  }
}

function sanitizeLfo(raw: unknown, fb: LfoParams): LfoParams {
  const r = isRecord(raw) ? raw : {}
  const lfo: LfoParams = {
    rate: num(r.rate, 0, 50, fb.rate),
    depth: num(r.depth, 0, 1, fb.depth),
    target: coerceEnum(r.target, LFO_TARGETS, fb.target),
    tempoSync: bool(r.tempoSync, fb.tempoSync),
  }
  if (typeof r.division === 'number') lfo.division = int(r.division, 0, 64, 8)
  return lfo
}

function sanitizeUnison(raw: unknown, fb: UnisonParams): UnisonParams {
  const r = isRecord(raw) ? raw : {}
  return {
    voices: int(r.voices, 1, 16, fb.voices),
    detune: num(r.detune, 0, 1, fb.detune),
    spread: num(r.spread, 0, 1, fb.spread),
  }
}

function sanitizeGlide(raw: unknown, fb: GlideParams): GlideParams {
  const r = isRecord(raw) ? raw : {}
  return {
    time: num(r.time, 0, 10, fb.time),
    mode: coerceEnum(r.mode, GLIDE_MODES, fb.mode),
  }
}

function sanitizePatch(raw: unknown, fb: PatchParams): PatchParams {
  const r = isRecord(raw) ? raw : {}
  return {
    osc1: sanitizeOsc(r.osc1, fb.osc1),
    osc2: sanitizeOsc(r.osc2, fb.osc2),
    subLevel: num(r.subLevel, 0, 1, fb.subLevel),
    noiseLevel: num(r.noiseLevel, 0, 1, fb.noiseLevel),
    filter: sanitizeFilter(r.filter, fb.filter),
    ampEnv: sanitizeEnv(r.ampEnv, fb.ampEnv),
    filterEnv: sanitizeEnv(r.filterEnv, fb.filterEnv),
    lfo: sanitizeLfo(r.lfo, fb.lfo),
    unison: sanitizeUnison(r.unison, fb.unison),
    glide: sanitizeGlide(r.glide, fb.glide),
    volume: num(r.volume, 0, 1, fb.volume),
  }
}

function sanitizeDelay(raw: unknown, fb: DelayParams): DelayParams {
  const r = isRecord(raw) ? raw : {}
  return {
    time: num(r.time, 0, 10, fb.time),
    feedback: num(r.feedback, 0, 1, fb.feedback),
    mix: num(r.mix, 0, 1, fb.mix),
    tempoSync: bool(r.tempoSync, fb.tempoSync),
    division: int(r.division, 1, 64, fb.division),
  }
}

function sanitizeReverb(raw: unknown, fb: ReverbParams): ReverbParams {
  const r = isRecord(raw) ? raw : {}
  return {
    size: num(r.size, 0, 1, fb.size),
    mix: num(r.mix, 0, 1, fb.mix),
  }
}

function sanitizeFx(raw: unknown, fb: FxParams): FxParams {
  const r = isRecord(raw) ? raw : {}
  return {
    drive: num(r.drive, 0, 1, fb.drive),
    chorus: num(r.chorus, 0, 1, fb.chorus),
    delay: sanitizeDelay(r.delay, fb.delay),
    reverb: sanitizeReverb(r.reverb, fb.reverb),
    limiterThreshold: num(r.limiterThreshold, -60, 0, fb.limiterThreshold),
  }
}

function sanitizeSurface(raw: unknown, fb: SurfaceConfig): SurfaceConfig {
  const r = isRecord(raw) ? raw : {}
  return {
    layout: coerceEnum(r.layout, LAYOUTS, fb.layout),
    rows: int(r.rows, 1, 64, fb.rows),
    cols: int(r.cols, 1, 64, fb.cols),
    rowOffsetDegrees: int(r.rowOffsetDegrees, -24, 24, fb.rowOffsetDegrees),
    quantize: num(r.quantize, 0, 1, fb.quantize),
    baseOctave: int(r.baseOctave, 0, 9, fb.baseOctave),
  }
}

function sanitizeMacros(raw: unknown, fb: Macros): Macros {
  const r = isRecord(raw) ? raw : {}
  return {
    glow: num(r.glow, 0, 1, fb.glow),
    motion: num(r.motion, 0, 1, fb.motion),
    air: num(r.air, 0, 1, fb.air),
    grit: num(r.grit, 0, 1, fb.grit),
  }
}

function sanitizeArp(raw: unknown, fb: ArpConfig): ArpConfig {
  const r = isRecord(raw) ? raw : {}
  return {
    enabled: bool(r.enabled, fb.enabled),
    mode: coerceEnum(r.mode, ARP_MODES, fb.mode),
    division: num(r.division, 1, 64, fb.division),
    gate: num(r.gate, 0, 1, fb.gate),
    swing: num(r.swing, 0, 1, fb.swing),
    octaves: int(r.octaves, 0, 8, fb.octaves),
  }
}

function sanitizeMidi(raw: unknown, fb: MidiConfig): MidiConfig {
  const r = isRecord(raw) ? raw : {}
  return {
    inEnabled: bool(r.inEnabled, fb.inEnabled),
    outEnabled: bool(r.outEnabled, fb.outEnabled),
    outChannel: int(r.outChannel, 1, 16, fb.outChannel),
  }
}

function sanitizeExpression(raw: unknown): TouchExpression | undefined {
  if (!isRecord(raw)) return undefined
  return {
    pitch: num(raw.pitch, 0, 127, 60),
    glide: num(raw.glide, -127, 127, 0),
    timbre: num(raw.timbre, 0, 1, 0),
    pressure: num(raw.pressure, 0, 1, 0),
  }
}

function sanitizeEvent(raw: unknown): PhraseEvent | null {
  if (!isRecord(raw)) return null
  const event: PhraseEvent = {
    time: num(raw.time, 0, 1e6, 0),
    type: coerceEnum(raw.type, EVENT_TYPES, 'on'),
    degree: int(raw.degree, -1000, 1000, 0),
    octave: int(raw.octave, -2, 12, 0),
  }
  const expr = sanitizeExpression(raw.expression)
  if (expr) event.expression = expr
  return event
}

function sanitizePhrase(raw: unknown): Phrase | null {
  if (!isRecord(raw)) return null
  const events = Array.isArray(raw.events)
    ? raw.events.map(sanitizeEvent).filter((e): e is PhraseEvent => e !== null)
    : []
  return {
    events,
    lengthBeats: num(raw.lengthBeats, 0, 1e6, 0),
  }
}

/**
 * Coerce an arbitrary unknown value into a fully-valid Session. Never throws.
 * Missing/invalid fields fall back to the default session; numbers are clamped;
 * enums validated against their const arrays.
 */
export function sanitizeSession(raw: unknown): Session {
  const fb = createDefaultSession()
  const r = isRecord(raw) ? raw : {}
  const session: Session = {
    version: SESSION_VERSION,
    name: str(r.name, fb.name),
    keyRoot: int(r.keyRoot, 0, 11, fb.keyRoot),
    mode: coerceEnum<Mode>(r.mode, MODES, fb.mode),
    surface: sanitizeSurface(r.surface, fb.surface),
    patch: sanitizePatch(r.patch, fb.patch),
    fx: sanitizeFx(r.fx, fb.fx),
    macros: sanitizeMacros(r.macros, fb.macros),
    arp: sanitizeArp(r.arp, fb.arp),
    chordMode: coerceEnum<ChordMode>(r.chordMode, CHORD_MODES, fb.chordMode),
    midi: sanitizeMidi(r.midi, fb.midi),
    phrase: r.phrase === null || r.phrase === undefined ? null : sanitizePhrase(r.phrase),
  }
  if (typeof r.presetName === 'string') session.presetName = r.presetName
  return session
}

// ---------------------------------------------------------------------------
// Compact encoding (Session → CompactSession)
// ---------------------------------------------------------------------------

function encodeOsc(o: OscillatorParams): CompactOsc {
  return [
    WAVES.indexOf(o.wave),
    o.detune,
    o.level,
    o.pulseWidth ?? null,
    o.sync === undefined ? null : o.sync ? 1 : 0,
    o.fm ?? null,
  ]
}

function encodePatch(p: PatchParams): CompactPatch {
  return {
    o1: encodeOsc(p.osc1),
    o2: encodeOsc(p.osc2),
    sl: p.subLevel,
    nl: p.noiseLevel,
    fl: [p.filter.cutoff, p.filter.resonance, p.filter.drive, p.filter.envAmount, p.filter.keytrack],
    ae: [p.ampEnv.attack, p.ampEnv.decay, p.ampEnv.sustain, p.ampEnv.release],
    fe: [p.filterEnv.attack, p.filterEnv.decay, p.filterEnv.sustain, p.filterEnv.release],
    lf: [p.lfo.rate, p.lfo.depth, LFO_TARGETS.indexOf(p.lfo.target), p.lfo.tempoSync ? 1 : 0, p.lfo.division ?? null],
    un: [p.unison.voices, p.unison.detune, p.unison.spread],
    gl: [p.glide.time, GLIDE_MODES.indexOf(p.glide.mode)],
    vo: p.volume,
  }
}

function encodeFx(f: FxParams): CompactFx {
  return {
    dr: f.drive,
    ch: f.chorus,
    dl: [f.delay.time, f.delay.feedback, f.delay.mix, f.delay.tempoSync ? 1 : 0, f.delay.division],
    rv: [f.reverb.size, f.reverb.mix],
    lt: f.limiterThreshold,
  }
}

function encodeEvent(e: PhraseEvent): CompactEvent {
  const expr: CompactExpr | null = e.expression
    ? [e.expression.pitch, e.expression.glide, e.expression.timbre, e.expression.pressure]
    : null
  return [e.time, EVENT_TYPES.indexOf(e.type), e.degree, e.octave, expr]
}

function encodePhrase(p: Phrase | null): CompactPhrase | null {
  if (p === null) return null
  return [p.lengthBeats, p.events.map(encodeEvent)]
}

function toCompact(s: Session): CompactSession {
  const compact: CompactSession = {
    v: COMPACT_VERSION,
    n: s.name,
    k: s.keyRoot,
    m: MODES.indexOf(s.mode),
    su: [
      LAYOUTS.indexOf(s.surface.layout),
      s.surface.rows,
      s.surface.cols,
      s.surface.rowOffsetDegrees,
      s.surface.quantize,
      s.surface.baseOctave,
    ],
    pt: encodePatch(s.patch),
    fx: encodeFx(s.fx),
    mc: [s.macros.glow, s.macros.motion, s.macros.air, s.macros.grit],
    ar: [
      s.arp.enabled ? 1 : 0,
      ARP_MODES.indexOf(s.arp.mode),
      s.arp.division,
      s.arp.gate,
      s.arp.swing,
      s.arp.octaves,
    ],
    cm: CHORD_MODES.indexOf(s.chordMode),
    mi: [s.midi.inEnabled ? 1 : 0, s.midi.outEnabled ? 1 : 0, s.midi.outChannel],
    ph: encodePhrase(s.phrase),
  }
  if (s.presetName !== undefined) compact.pn = s.presetName
  return compact
}

// ---------------------------------------------------------------------------
// Compact decoding (unknown → loose Session-shaped record for sanitiser)
// ---------------------------------------------------------------------------

function nn(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

function decodeOsc(raw: unknown): Record<string, unknown> {
  if (!Array.isArray(raw)) return {}
  const [waveIdx, detune, level, pw, sync, fm] = raw as unknown[]
  const osc: Record<string, unknown> = {
    wave: fromIdx(WAVES, waveIdx),
    detune: nn(detune),
    level: nn(level),
  }
  if (typeof pw === 'number') osc.pulseWidth = pw
  if (sync === 0 || sync === 1) osc.sync = sync === 1
  if (typeof fm === 'number') osc.fm = fm
  return osc
}

function decodePatch(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {}
  const fl = Array.isArray(raw.fl) ? raw.fl : []
  const ae = Array.isArray(raw.ae) ? raw.ae : []
  const fe = Array.isArray(raw.fe) ? raw.fe : []
  const lf = Array.isArray(raw.lf) ? raw.lf : []
  const un = Array.isArray(raw.un) ? raw.un : []
  const gl = Array.isArray(raw.gl) ? raw.gl : []
  const lfo: Record<string, unknown> = {
    rate: nn(lf[0]),
    depth: nn(lf[1]),
    target: fromIdx(LFO_TARGETS, lf[2]),
    tempoSync: lf[3] === 1,
  }
  if (typeof lf[4] === 'number') lfo.division = lf[4]
  return {
    osc1: decodeOsc(raw.o1),
    osc2: decodeOsc(raw.o2),
    subLevel: nn(raw.sl),
    noiseLevel: nn(raw.nl),
    filter: { cutoff: nn(fl[0]), resonance: nn(fl[1]), drive: nn(fl[2]), envAmount: nn(fl[3]), keytrack: nn(fl[4]) },
    ampEnv: { attack: nn(ae[0]), decay: nn(ae[1]), sustain: nn(ae[2]), release: nn(ae[3]) },
    filterEnv: { attack: nn(fe[0]), decay: nn(fe[1]), sustain: nn(fe[2]), release: nn(fe[3]) },
    lfo,
    unison: { voices: nn(un[0]), detune: nn(un[1]), spread: nn(un[2]) },
    glide: { time: nn(gl[0]), mode: fromIdx(GLIDE_MODES, gl[1]) },
    volume: nn(raw.vo),
  }
}

function decodeFx(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {}
  const dl = Array.isArray(raw.dl) ? raw.dl : []
  const rv = Array.isArray(raw.rv) ? raw.rv : []
  return {
    drive: nn(raw.dr),
    chorus: nn(raw.ch),
    delay: { time: nn(dl[0]), feedback: nn(dl[1]), mix: nn(dl[2]), tempoSync: dl[3] === 1, division: nn(dl[4]) },
    reverb: { size: nn(rv[0]), mix: nn(rv[1]) },
    limiterThreshold: nn(raw.lt),
  }
}

function decodeEvent(raw: unknown): Record<string, unknown> {
  if (!Array.isArray(raw)) return {}
  const [time, typeIdx, degree, octave, expr] = raw as unknown[]
  const event: Record<string, unknown> = {
    time: nn(time),
    type: fromIdx(EVENT_TYPES, typeIdx),
    degree: nn(degree),
    octave: nn(octave),
  }
  if (Array.isArray(expr)) {
    const [pitch, glide, timbre, pressure] = expr as unknown[]
    event.expression = { pitch: nn(pitch), glide: nn(glide), timbre: nn(timbre), pressure: nn(pressure) }
  }
  return event
}

function decodePhrase(raw: unknown): Record<string, unknown> | null {
  if (!Array.isArray(raw)) return null
  const [lengthBeats, events] = raw as unknown[]
  return {
    lengthBeats: nn(lengthBeats),
    events: Array.isArray(events) ? events.map(decodeEvent) : [],
  }
}

/** Expand a compact payload into a loose Session-shaped record for sanitising. */
function fromCompact(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {}
  const su = Array.isArray(raw.su) ? raw.su : []
  const mc = Array.isArray(raw.mc) ? raw.mc : []
  const ar = Array.isArray(raw.ar) ? raw.ar : []
  const mi = Array.isArray(raw.mi) ? raw.mi : []
  const loose: Record<string, unknown> = {
    name: raw.n,
    keyRoot: raw.k,
    mode: fromIdx(MODES, raw.m),
    surface: {
      layout: fromIdx(LAYOUTS, su[0]),
      rows: nn(su[1]),
      cols: nn(su[2]),
      rowOffsetDegrees: nn(su[3]),
      quantize: nn(su[4]),
      baseOctave: nn(su[5]),
    },
    patch: decodePatch(raw.pt),
    fx: decodeFx(raw.fx),
    macros: { glow: nn(mc[0]), motion: nn(mc[1]), air: nn(mc[2]), grit: nn(mc[3]) },
    arp: {
      enabled: ar[0] === 1,
      mode: fromIdx(ARP_MODES, ar[1]),
      division: nn(ar[2]),
      gate: nn(ar[3]),
      swing: nn(ar[4]),
      octaves: nn(ar[5]),
    },
    chordMode: fromIdx(CHORD_MODES, raw.cm),
    midi: { inEnabled: mi[0] === 1, outEnabled: mi[1] === 1, outChannel: nn(mi[2]) },
    phrase: raw.ph === null || raw.ph === undefined ? null : decodePhrase(raw.ph),
  }
  if (typeof raw.pn === 'string') loose.presetName = raw.pn
  return loose
}

// ---------------------------------------------------------------------------
// Base64 over Unicode-safe JSON
// ---------------------------------------------------------------------------

function utf8ToBase64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}

function base64ToUtf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64)))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Encode a session into a compact, URL-fragment-safe base64 string. */
export function encodeSession(session: Session): string {
  // Sanitise first so we never serialise garbage into a share link.
  return utf8ToBase64(JSON.stringify(toCompact(sanitizeSession(session))))
}

/**
 * Decode a compact share string back into a valid Session, or null on any
 * malformed input. Never throws — every failure mode returns null, and a
 * structurally-odd-but-decodable payload is salvaged via sanitizeSession. An
 * unknown compact `v` is tolerated: fields are still mapped and sanitised.
 */
export function decodeSession(str: string): Session | null {
  if (typeof str !== 'string' || str.length === 0) return null
  let json: string
  try {
    json = base64ToUtf8(str)
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  return sanitizeSession(fromCompact(parsed))
}

/** Build a full share URL with the session in a `#k=` fragment. */
export function sessionToShareUrl(session: Session, baseUrl?: string): string {
  const base = baseUrl ?? defaultBaseUrl()
  return `${base}#${FRAGMENT_KEY}=${encodeSession(session)}`
}

/**
 * Extract and decode a session from a hash fragment or full URL. Accepts a bare
 * fragment (`#k=…` or `k=…`) or a complete URL. Returns null if the fragment
 * param is absent or invalid.
 */
export function sessionFromUrl(hashOrUrl: string): Session | null {
  if (typeof hashOrUrl !== 'string') return null
  const hashIndex = hashOrUrl.indexOf('#')
  const fragment = hashIndex >= 0 ? hashOrUrl.slice(hashIndex + 1) : hashOrUrl
  for (const part of fragment.split('&')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq) === FRAGMENT_KEY) {
      return decodeSession(part.slice(eq + 1))
    }
  }
  return null
}

/** Best-effort base URL from the current document, falling back to '' in node. */
function defaultBaseUrl(): string {
  try {
    const loc = (globalThis as { location?: { origin?: string; pathname?: string } }).location
    if (loc?.origin) return `${loc.origin}${loc.pathname ?? ''}`
  } catch {
    // no DOM (tests/SSR)
  }
  return ''
}
