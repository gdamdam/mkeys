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
  /** Import a Scala `.scl` scale file as the active tuning. Throws on bad input. */
  importSclFile: (text: string) => void
  /** Import a Scala `.kbm` keyboard map (retunes tonic + sets MIDI-in map). Throws on bad input or no active tuning. */
  importKbmFile: (text: string) => void
  setLayout: (layout: SurfaceConfig['layout']) => void

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
  saveSession: (name: string) => void | Promise<void>
  loadSession: (id: string) => void | Promise<void>
  deleteSession: (id: string) => void | Promise<void>
  /** Load a full session object (used by JSON import + share links). */
  applySession: (session: Session) => void

  // --- master audio capture ------------------------------------------------
  masterRecording: boolean
  startMasterRecord: () => void | Promise<void>
  /** Stop and hand off the WAV (the store downloads it). */
  stopMasterRecord: () => void | Promise<void>

  // --- MIDI ----------------------------------------------------------------
  /** True once Web MIDI access has been granted. */
  midiReady: boolean
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
}
