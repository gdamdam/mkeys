/**
 * AudioEngine — the mkeys audio runtime.
 *
 * Owns the AudioContext, the `mkeys-synth` AudioWorkletNode (voices + DSP), the
 * native-node master {@link FxChain}, the master gain, and the {@link MasterRecorder}
 * tap. It is a thin, imperative NoteSink: the surface/transport layers call
 * noteOn/noteOff/setExpression and the parameter setters, and the engine
 * translates those into {@link WorkletCommand} port messages and FxChain updates.
 *
 * Signal path:
 *   synth worklet → FxChain.input … FxChain.output → masterGain → destination
 *                                                              ↘ recorder tap
 *
 * Everything after `start()` is safe to call repeatedly; calls before `start()`
 * (or after `dispose()`) are no-ops so the caller never has to guard readiness.
 */

import type {
  FxParams,
  Macros,
  PatchParams,
  TouchExpression,
  WorkletCommand,
} from '../types'
import { FxChain } from './fx'
import { composeMacros } from './macros'
import { MasterRecorder } from './recorder'
import recorderWorkletUrl from './worklets/recorder.worklet?worker&url'
import synthWorkletUrl from './worklets/synth.worklet?worker&url'

/** A complete, always-valid default patch used before a preset is loaded. */
function defaultPatch(): PatchParams {
  return {
    osc1: { wave: 'saw', detune: 0, level: 0.8, pulseWidth: 0.5, sync: false, fm: 0 },
    osc2: { wave: 'saw', detune: 6, level: 0.5, pulseWidth: 0.5, sync: false, fm: 0 },
    subLevel: 0.15,
    noiseLevel: 0,
    filter: { cutoff: 4000, resonance: 0.2, drive: 0.1, envAmount: 0.4, keytrack: 0.4 },
    ampEnv: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
    filterEnv: { attack: 0.02, decay: 0.25, sustain: 0.4, release: 0.35 },
    lfo: { rate: 4, depth: 0, target: 'filter', tempoSync: false, division: 4 },
    unison: { voices: 1, detune: 0.2, spread: 0.5 },
    glide: { time: 0, mode: 'off' },
    volume: 0.8,
  }
}

/** A complete, always-valid default master-FX state. */
function defaultFx(): FxParams {
  return {
    drive: 0,
    chorus: 0,
    delay: { time: 0.3, feedback: 0.3, mix: 0, tempoSync: true, division: 8 },
    reverb: { size: 0.5, mix: 0 },
    limiterThreshold: -3,
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private inputGainNode: GainNode | null = null
  private fx: FxChain | null = null
  private master: GainNode | null = null
  private recorder: MasterRecorder | null = null
  private running = false
  /** In-flight start, shared by concurrent callers so only one graph is built. */
  private startPromise: Promise<void> | null = null

  // Authoritative main-thread mirror of the *base* patch/fx (what the direct
  // controls edit). The macros are an additive layer composed on top at push
  // time via {@link composeMacros}, never folded into this base — so a manual
  // edit and a macro move both survive and stay audible.
  private patch: PatchParams = defaultPatch()
  private fxState: FxParams = defaultFx()
  private macros: Macros = { glow: 0, motion: 0, air: 0, grit: 0 }
  private bpm = 120
  // Mirrored so a (re)start applies the current levels to the fresh graph.
  private masterVolumeState = 1
  private inputGainState = 1

  /** True once {@link start} has completed and the graph is live. */
  isRunning(): boolean {
    return this.running
  }

  /** The master output node (post-FX). Null until {@link start}. */
  get masterGain(): GainNode | null {
    return this.master
  }

  /**
   * Measured round-trip latency estimate in ms from the live context, or null
   * before {@link start}. This is what the platform reports — not a target we
   * can lower; the browser round-trip is a floor no code can beat.
   */
  latencyMs(): number | null {
    return this.ctx ? estimateRoundTripMs(this.ctx) : null
  }

  /**
   * Create and wire the audio graph. MUST be called from a user gesture so the
   * AudioContext is allowed to start. Idempotent — a second call is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) return
    // Coalesce concurrent starts (e.g. a double-tapped gesture): both callers
    // await one build instead of racing two AudioContexts into existence.
    if (this.startPromise) return this.startPromise
    this.startPromise = this.build()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async build(): Promise<void> {
    // 'interactive' asks the platform for the smallest safe output buffer — the
    // right hint for a played instrument, and what the other m-suite apps use.
    // It only nudges the buffer size; the ~10–30 ms browser round-trip floor
    // (hardware buffer + baseLatency + outputLatency) is unaffected.
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    try {
      await ctx.resume()
      // Register both worklet modules before instantiating any node from them.
      await ctx.audioWorklet.addModule(synthWorkletUrl)
      await ctx.audioWorklet.addModule(recorderWorkletUrl)
    } catch (err) {
      // Setup failed — close the freshly created context so it isn't leaked.
      void ctx.close()
      throw err
    }

    const node = new AudioWorkletNode(ctx, 'mkeys-synth', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const inputGain = ctx.createGain()
    inputGain.gain.value = this.inputGainState
    const fx = new FxChain(ctx)
    const master = ctx.createGain()
    master.gain.value = this.masterVolumeState

    // synth → input gain → FX → master → destination.
    node.connect(inputGain)
    inputGain.connect(fx.input)
    fx.output.connect(master)
    master.connect(ctx.destination)

    this.ctx = ctx
    this.node = node
    this.inputGainNode = inputGain
    this.fx = fx
    this.master = master
    this.recorder = new MasterRecorder(ctx, master)
    this.running = true

    // Push the current mirrored state (base composed with macros) into the graph.
    this.pushSound()
    this.post({ type: 'setTempo', bpm: this.bpm })
    fx.setTempo(this.bpm)
  }

  // --- NoteSink API ------------------------------------------------------

  noteOn(id: number, midi: number, velocity: number): void {
    this.post({ type: 'noteOn', id, midi, velocity })
  }

  noteOff(id: number): void {
    this.post({ type: 'noteOff', id })
  }

  setExpression(id: number, expr: TouchExpression): void {
    this.post({ type: 'expression', id, expr })
  }

  // --- Parameter API -----------------------------------------------------

  /** Replace the whole base patch (e.g. loading a preset). */
  setPatch(patch: PatchParams): void {
    this.patch = patch
    this.pushSound()
  }

  /** Set one dotted base-patch field (e.g. 'filter.cutoff'); recomposes macros. */
  setParam(path: string, value: number): void {
    applyDottedParam(this.patch, path, value)
    this.pushSound()
  }

  /** Replace the base master-FX state. */
  setFx(fx: FxParams): void {
    this.fxState = fx
    this.pushSound()
  }

  /** Master output level (0..1). Smoothed so it never zippers. */
  setMasterVolume(v: number): void {
    this.masterVolumeState = v
    const g = this.master?.gain
    if (g) g.setTargetAtTime(v, this.ctx?.currentTime ?? 0, 0.02)
  }

  /** Pre-FX input gain (unity 1). Smoothed so it never zippers. */
  setInputGain(v: number): void {
    this.inputGainState = v
    const g = this.inputGainNode?.gain
    if (g) g.setTargetAtTime(v, this.ctx?.currentTime ?? 0, 0.02)
  }

  /**
   * Set the four performance macros. They are an additive layer, composed onto
   * the base patch/fx at push time — the base is left intact, so direct-control
   * edits are never clobbered.
   */
  setMacros(macros: Macros): void {
    this.macros = macros
    this.pushSound()
  }

  /** Compose the base patch/fx with the active macro offsets and push to the graph. */
  private pushSound(): void {
    const { patch, fx } = composeMacros({ patch: this.patch, fx: this.fxState }, this.macros)
    this.post({ type: 'setPatch', patch })
    this.fx?.setParams(fx)
  }

  /** Update tempo for both the synced delay (FxChain) and the synced LFO (worklet). */
  setTempo(bpm: number): void {
    this.bpm = bpm > 0 ? bpm : 120
    this.post({ type: 'setTempo', bpm: this.bpm })
    this.fx?.setTempo(this.bpm)
  }

  /** Immediately silence all voices. */
  panic(): void {
    this.post({ type: 'panic' })
  }

  // --- Recording ---------------------------------------------------------

  /** The master recorder (null until {@link start}). */
  getRecorder(): MasterRecorder | null {
    return this.recorder
  }

  // --- Lifecycle ---------------------------------------------------------

  /** Tear down the graph and close the context. Safe to call more than once. */
  dispose(): void {
    this.recorder?.dispose()
    if (this.node) {
      this.post({ type: 'panic' })
      this.node.port.onmessage = null
      this.node.disconnect()
    }
    this.inputGainNode?.disconnect()
    this.fx?.dispose()
    this.master?.disconnect()
    void this.ctx?.close()
    this.ctx = null
    this.node = null
    this.inputGainNode = null
    this.fx = null
    this.master = null
    this.recorder = null
    this.running = false
  }

  private post(cmd: WorkletCommand): void {
    this.node?.port.postMessage(cmd)
  }
}

/** The read-only AudioContext latency fields the readout measures (seconds). */
export interface LatencyFields {
  baseLatency?: number
  outputLatency?: number
}

/**
 * Measured round-trip latency estimate, in milliseconds:
 * `(baseLatency + outputLatency) * 1000`. Either field may be missing (Safari
 * exposes no `outputLatency`; some engines neither), so we sum whatever is
 * present — the readout degrades gracefully instead of reading NaN. This is a
 * report of the platform floor, not something the app can reduce.
 */
export function estimateRoundTripMs(ctx: LatencyFields): number {
  const base = typeof ctx.baseLatency === 'number' ? ctx.baseLatency : 0
  const output = typeof ctx.outputLatency === 'number' ? ctx.outputLatency : 0
  return (base + output) * 1000
}

/** Mirror of the worklet's dotted-path setter, kept in sync on the main thread. */
function applyDottedParam(patch: PatchParams, path: string, value: number): void {
  const parts = path.split('.')
  if (parts.length === 1) {
    if (path === 'subLevel') patch.subLevel = value
    else if (path === 'noiseLevel') patch.noiseLevel = value
    else if (path === 'volume') patch.volume = value
    return
  }
  const [group, field] = parts
  const target = (patch as unknown as Record<string, Record<string, number>>)[group]
  if (target && typeof target === 'object' && field in target) {
    target[field] = value
  }
}
