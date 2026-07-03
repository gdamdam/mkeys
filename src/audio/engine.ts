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
import { applyMacros } from './macros'
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
  private fx: FxChain | null = null
  private master: GainNode | null = null
  private recorder: MasterRecorder | null = null
  private running = false

  // Authoritative main-thread mirror of patch/fx, so macro merges and setParam
  // layer onto a known-complete base.
  private patch: PatchParams = defaultPatch()
  private fxState: FxParams = defaultFx()
  private bpm = 120

  /** True once {@link start} has completed and the graph is live. */
  isRunning(): boolean {
    return this.running
  }

  /** The master output node (post-FX). Null until {@link start}. */
  get masterGain(): GainNode | null {
    return this.master
  }

  /**
   * Create and wire the audio graph. MUST be called from a user gesture so the
   * AudioContext is allowed to start. Idempotent — a second call is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) return
    const ctx = new AudioContext()
    await ctx.resume()

    // Register both worklet modules before instantiating any node from them.
    await ctx.audioWorklet.addModule(synthWorkletUrl)
    await ctx.audioWorklet.addModule(recorderWorkletUrl)

    const node = new AudioWorkletNode(ctx, 'mkeys-synth', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    const fx = new FxChain(ctx)
    const master = ctx.createGain()
    master.gain.value = 1

    // synth → FX → master → destination.
    node.connect(fx.input)
    fx.output.connect(master)
    master.connect(ctx.destination)

    this.ctx = ctx
    this.node = node
    this.fx = fx
    this.master = master
    this.recorder = new MasterRecorder(ctx, master)
    this.running = true

    // Push the current mirrored state into the fresh graph.
    this.post({ type: 'setPatch', patch: this.patch })
    this.post({ type: 'setTempo', bpm: this.bpm })
    fx.setParams(this.fxState)
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

  /** Replace the whole patch (e.g. loading a preset). */
  setPatch(patch: PatchParams): void {
    this.patch = patch
    this.post({ type: 'setPatch', patch })
  }

  /** Set one dotted patch field (e.g. 'filter.cutoff'); keeps the mirror in sync. */
  setParam(path: string, value: number): void {
    applyDottedParam(this.patch, path, value)
    this.post({ type: 'setParam', path, value })
  }

  /** Replace the master-FX state. */
  setFx(fx: FxParams): void {
    this.fxState = fx
    this.fx?.setParams(fx)
  }

  /**
   * Apply the four performance macros: derive patch/fx overrides, shallow-merge
   * them onto the current mirrored state, and push the merged result.
   */
  setMacros(macros: Macros): void {
    const { patch, fx } = applyMacros(macros)
    this.patch = { ...this.patch, ...patch }
    this.fxState = { ...this.fxState, ...fx }
    this.post({ type: 'setPatch', patch: this.patch })
    this.fx?.setParams(this.fxState)
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
    this.fx?.dispose()
    this.master?.disconnect()
    void this.ctx?.close()
    this.ctx = null
    this.node = null
    this.fx = null
    this.master = null
    this.recorder = null
    this.running = false
  }

  private post(cmd: WorkletCommand): void {
    this.node?.port.postMessage(cmd)
  }
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
