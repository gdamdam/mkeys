/**
 * Panel-side contract for the app store.
 *
 * The control panels in this folder are one visually-consistent family and all
 * consume the same `useInstrument()` hook (owned by the store agent, at
 * `src/app/useInstrument.ts`). That file is authored in parallel, so this module
 * declares the *shape the panels rely on* and re-exports the hook typed to it.
 *
 * If the store's real return type diverges, the mismatch surfaces here at
 * integration (a single reconciliation point) rather than scattered across every
 * panel. Nothing here creates state — it is a type contract only.
 *
 * Notable derivations from src/types.ts `Session` (which has NO tempo / latch /
 * transient-transport fields): `bpm`, `latch`, the phrase-recorder status, saved
 * session list, MIDI-access readiness, master-capture status and Link status are
 * all *transient* instrument state and therefore live on the hook, not the
 * serialised session.
 */
import type {
  ArpConfig,
  ChordMode,
  Macros,
  MidiConfig,
  Mode,
  PatchParams,
  PitchClass,
  PlayQuantizeConfig,
  PortableTuning,
  Session,
  SurfaceConfig,
  TouchExpression,
} from '../types'

/**
 * One resolved, playable cell of the instrument surface, derived by the store
 * from `session.surface` + the active key/mode. The UI renders these; playing a
 * cell calls {@link Instrument.noteOnAt} with the cell's `indexInScale`+`octave`.
 */
export interface GridCell {
  /** 0-based scale degree within the active scale (0 = tonic). */
  degree: number
  /** Absolute octave of this cell. */
  octave: number
  /** Resolved MIDI note number for the cell. */
  midi: number
  /** Human-readable note name, e.g. "C4". */
  label: string
  /** Position of `degree` within the scale (same as `degree`; explicit for the UI). */
  indexInScale: number
  /** True when this cell is the scale tonic (degree 0). */
  isTonic: boolean
}

/** Phrase-recorder transport state. */
export type RecorderState = 'idle' | 'recording' | 'playing'

/** Live phrase-recorder status mirrored up for the UI. */
export interface RecorderStatus {
  state: RecorderState
  /** Length of the captured / looping phrase, in bars (0 when empty). */
  bars: number
}

/** Metadata for one persisted session in the local library. */
export interface SavedSessionMeta {
  id: string
  name: string
  /** Epoch millis of last save, when the store tracks it. */
  updatedAt?: number
}

/**
 * Truthful result of a session-library operation (§15). Success is reported
 * ONLY after the IndexedDB transaction actually commits; failures carry a short,
 * user-facing, actionable message (unavailable storage, quota, missing record…).
 */
export type OpResult = { ok: true } | { ok: false; error: string }

/** A MIDI port (input or output) surfaced to the routing UI (§12). */
export interface MidiPortInfo {
  id: string
  name: string
  /** False when a previously-selected device is saved but currently absent. */
  connected: boolean
}

/** Ableton-Link-style status. The bridge is optional; `enabled` gates it. */
export interface LinkStatus {
  enabled: boolean
  connected: boolean
  peers: number
}

/**
 * Everything the control panels read or drive. Read persisted values from
 * `session.*`; call the action methods to change them (the store performs the
 * immutable update and pushes to the audio engine / MIDI / scheduler).
 */
export interface Instrument {
  /** The complete current session (source of truth for persisted values). */
  session: Session

  // --- lifecycle -----------------------------------------------------------
  /** True once the AudioContext + engine are running. */
  started: boolean
  /** Lazily start audio on first gesture. Idempotent. */
  start: () => void | Promise<void>
  /** All notes off, everywhere. */
  panic: () => void
  /**
   * Measured round-trip latency estimate in ms from the live AudioContext, or
   * null before {@link start}. Reflects the platform floor (hardware buffer +
   * base/output latency) — the app cannot lower it; it only reports it.
   */
  latencyMs: number | null

  // --- musical -------------------------------------------------------------
  setKeyRoot: (pc: PitchClass) => void
  setMode: (mode: Mode) => void
  /** Load a microtuning (arbitrary N, non-octave periods) or clear to 12-TET (null). */
  setTuning: (tuning: PortableTuning | null) => void
  /** Retune the active tuning's tonic in Hz (no-op without a tuning). */
  setTonic: (tonicHz: number) => void
  /** Import a Scala `.scl` scale file as the active tuning. Throws on bad input. */
  importSclFile: (text: string) => void
  /** Import a Scala `.kbm` keyboard map (retunes tonic + sets MIDI-in map). Throws on bad input or no active tuning. */
  importKbmFile: (text: string) => void
  setLayout: (layout: SurfaceConfig['layout']) => void
  /** Shift the surface register: octave of the bottom-left pad (clamped -1..9). */
  setBaseOctave: (octave: number) => void
  /** Glide quantize 0..1 (§11): 0 = continuous portamento, 1 = stepped snap. Applied live. */
  setQuantize: (v: number) => void
  /** Advanced surface geometry: rows / columns / isomorphic row offset (§11). Relays the grid. */
  setSurfaceGeometry: (next: { rows?: number; cols?: number; rowOffsetDegrees?: number }) => void

  // --- tempo (transient — not on Session) ----------------------------------
  bpm: number
  /** Link tempo when connected, else `bpm`. */
  effectiveBpm: number
  setBpm: (bpm: number) => void
  /** Register a tap; the store averages recent taps into a new bpm. */
  tapTempo: () => void

  // --- sound ---------------------------------------------------------------
  /** Replace the whole patch (panels build the next patch immutably). */
  updatePatch: (patch: PatchParams) => void
  setMacro: (name: keyof Macros, value: number) => void
  /** Master output level (0..1). */
  setMasterVolume: (v: number) => void
  /** Pre-FX input gain (0..2, unity 1). */
  setInputGain: (v: number) => void
  loadPreset: (name: string) => void

  // --- performance ---------------------------------------------------------
  setArp: (arp: ArpConfig) => void
  setChordMode: (mode: ChordMode) => void
  /** Held notes stay sounding after release (transient). */
  latch: boolean
  setLatch: (on: boolean) => void

  // --- phrase recorder -----------------------------------------------------
  recorder: RecorderStatus
  /** Toggle record arm / stop capture. */
  toggleRecordPhrase: () => void
  /** Toggle phrase loop playback. */
  togglePlayPhrase: () => void
  clearPhrase: () => void

  // --- session library -----------------------------------------------------
  savedSessions: SavedSessionMeta[]
  /** Persist the current session under `name`. Resolves a truthful {@link OpResult} (§15). */
  saveSession: (name: string) => Promise<OpResult>
  /** Load a saved session by id. Resolves a truthful {@link OpResult} (§15). */
  loadSession: (id: string) => Promise<OpResult>
  /** Delete a saved session by id. Resolves a truthful {@link OpResult} (§15). */
  deleteSession: (id: string) => Promise<OpResult>
  /** Load a full session object (used by JSON import + share links). */
  applySession: (session: Session) => void

  // --- master audio capture ------------------------------------------------
  masterRecording: boolean
  /** Seconds captured in the current take (§9). */
  masterRecordSeconds: number
  /** Hard capacity ceiling in seconds; capture auto-stops here (§9). */
  masterRecordMaxSeconds: number
  startMasterRecord: () => void | Promise<void>
  /** Stop and hand off the WAV (the store downloads it). */
  stopMasterRecord: () => void | Promise<void>

  // --- MIDI ----------------------------------------------------------------
  /** True once Web MIDI access has been granted. */
  midiReady: boolean
  /** Available input ports, plus a saved-but-disconnected one if selected (§12). */
  midiInputs: MidiPortInfo[]
  /** Available output ports, plus a saved-but-disconnected one if selected (§12). */
  midiOutputs: MidiPortInfo[]
  /**
   * A human-readable routing warning (e.g. a likely feedback loop, or a saved
   * device that's disconnected), or null when routing is clean (§12).
   */
  midiRoutingWarning: string | null
  /** Replace the MIDI routing config (panels build the next config). */
  setMidiConfig: (next: MidiConfig) => void
  /** Request Web MIDI access (no-op if already granted). */
  enableMidi: () => void | Promise<void>

  // --- Link (optional bridge) ---------------------------------------------
  link: LinkStatus
  toggleLink: () => void

  // --- mbus publish (optional patchbay, same bridge) ------------------------
  /** True while the master output is offered to the mbus patchbay. */
  mbusPublishing: boolean
  toggleMbusPublish: () => void

  // --- note routing --------------------------------------------------------
  /**
   * The playable surface, derived from `session.surface` + key/mode, indexed
   * `[row][col]`. Recomputed whenever the surface, key root or mode changes.
   */
  grid: readonly (readonly GridCell[])[]
  /**
   * Start a note at a scale position. Applies the active chord mode, latch and
   * arpeggiator. Returns an opaque voice id used to move/release the note.
   */
  noteOnAt: (indexInScale: number, octave: number, expr: TouchExpression) => number
  /** Update continuous expression (pitch/glide/timbre/pressure) for a live voice. */
  moveVoice: (voiceId: number, expr: TouchExpression) => void
  /** Release a voice (respecting latch / arp). No-op for an unknown id. */
  noteOffVoice: (voiceId: number) => void
  /** MIDI note currently sounding for each live logical voice (for UI feedback). */
  activeVoices: ReadonlyMap<number, { midi: number }>
  /** Voices awaiting a quantized-live onset (§24), for a pending-state highlight. */
  pendingNotes: ReadonlyMap<number, { midi: number }>
  /** Play-quantize (timing) mode + grid (§24). Distinct from glide quantize. */
  setPlayQuantize: (next: PlayQuantizeConfig) => void
}
