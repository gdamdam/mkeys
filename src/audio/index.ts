// Audio module barrel — the public surface of the mkeys AUDIO layer.
//
// The engine owns the AudioContext, the `mkeys-synth` worklet, the master FX
// chain, and the recorder tap. FX/macros/presets are re-exported for callers
// (UI, transport) that need the pure logic without touching the live graph.
//
// Worklet URLs are exposed too: importing with `?worker&url` makes Vite emit
// each processor as its own hashed asset and hand back the URL string that
// `audioContext.audioWorklet.addModule(...)` needs. The engine registers them
// internally; the map is kept for precache/service-worker use.
import recorderWorkletUrl from './worklets/recorder.worklet?worker&url'
import silenceWorkletUrl from './worklets/silence.worklet?worker&url'
import synthWorkletUrl from './worklets/synth.worklet?worker&url'

export { AudioEngine } from './engine'
export { FxChain, secondsPerBeat } from './fx'
export { applyMacros } from './macros'
export type { MacroResult } from './macros'
export { MasterRecorder, encodeWav16 } from './recorder'
export { PRESETS, PRESET_CATEGORIES, getPreset } from './presets'
export type { Preset } from './presets'

/** URLs of the built AudioWorklet processor modules, keyed by processor name. */
export const WORKLET_URLS = {
  silence: silenceWorkletUrl,
  'mkeys-synth': synthWorkletUrl,
  'mkeys-recorder-tap': recorderWorkletUrl,
} as const
