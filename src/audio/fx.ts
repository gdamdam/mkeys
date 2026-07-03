/**
 * Native Web Audio master FX chain for mkeys.
 *
 * Runs on the main thread (not in a worklet) using ordinary Web Audio nodes.
 * Signal path, in order:
 *
 *   input
 *     → drive   (WaveShaper soft-clip, dry/wet by FxParams.drive)
 *     → chorus  (3 modulated DelayNodes + LFOs, wet by FxParams.chorus)
 *     → delay   (DelayNode + feedback + wet mix; tempo-syncable)
 *     → reverb  (ConvolverNode with a synthesized decay impulse, wet/dry mix)
 *     → limiter (DynamicsCompressorNode configured brickwall-ish)
 *     → output
 *
 * All continuous parameter changes are applied with `setTargetAtTime` so moving
 * a knob never produces zipper noise. The reverb impulse is regenerated only
 * when {@link ReverbParams.size} actually changes (an allocation, so it is kept
 * off the per-block path).
 */

import type { DelayParams, FxParams } from '../types'

/** Seconds per quarter-note beat at `bpm`. Guards against non-positive tempo. */
export function secondsPerBeat(bpm: number): number {
  return 60 / (bpm > 0 ? bpm : 120)
}

/** Longest delay time the chain will produce, in seconds (also the node bound). */
const MAX_DELAY_SECONDS = 10
/** Feedback is capped just below unity so the delay never self-oscillates. */
const MAX_FEEDBACK = 0.95
/** Default smoothing time-constant for `setTargetAtTime`, in seconds. */
const SMOOTH_TC = 0.03

/** One chorus tap: a short modulated delay driven by its own slow LFO. */
interface ChorusVoiceCfg {
  /** Base delay in seconds. */
  delay: number
  /** LFO rate in Hz. */
  rate: number
  /** Modulation depth in seconds (peak deviation of the delay time). */
  depth: number
}

const CHORUS_VOICES: readonly ChorusVoiceCfg[] = [
  { delay: 0.015, rate: 0.6, depth: 0.003 },
  { delay: 0.02, rate: 0.37, depth: 0.0035 },
  { delay: 0.025, rate: 0.53, depth: 0.004 },
]

export class FxChain {
  readonly input: AudioNode
  readonly output: AudioNode

  private readonly ctx: AudioContext

  // Drive stage.
  private readonly driveDry: GainNode
  private readonly drivePre: GainNode
  private readonly driveWet: GainNode

  // Chorus stage.
  private readonly chorusWet: GainNode
  private readonly chorusLfos: OscillatorNode[] = []

  // Delay stage.
  private readonly delayNode: DelayNode
  private readonly delayFeedback: GainNode
  private readonly delayWet: GainNode

  // Reverb stage.
  private readonly convolver: ConvolverNode
  private readonly reverbDry: GainNode
  private readonly reverbWet: GainNode

  // Limiter stage.
  private readonly limiter: DynamicsCompressorNode

  // State needed to recompute tempo-synced delay time on tempo changes.
  private bpm = 120
  private currentDelay: DelayParams = {
    time: 0.3,
    feedback: 0.3,
    mix: 0.2,
    tempoSync: true,
    division: 8,
  }
  private lastReverbSize = -1

  // Everything created, for a clean teardown.
  private readonly allNodes: AudioNode[] = []

  constructor(ctx: AudioContext) {
    this.ctx = ctx

    this.input = ctx.createGain()
    this.output = ctx.createGain()

    // --- Drive: crossfade a clean path with a pre-gained tanh soft-clip. ---
    this.driveDry = ctx.createGain()
    this.drivePre = ctx.createGain()
    this.driveWet = ctx.createGain()
    const shaper = ctx.createWaveShaper()
    shaper.curve = makeSoftClipCurve()
    shaper.oversample = '4x'
    const driveOut = ctx.createGain()

    this.input.connect(this.driveDry).connect(driveOut)
    this.input.connect(this.drivePre)
    this.drivePre.connect(shaper).connect(this.driveWet).connect(driveOut)

    this.driveDry.gain.value = 1
    this.drivePre.gain.value = 1
    this.driveWet.gain.value = 0

    // --- Chorus: dry through + summed modulated taps. ---
    const chorusDry = ctx.createGain()
    this.chorusWet = ctx.createGain()
    const chorusOut = ctx.createGain()

    driveOut.connect(chorusDry).connect(chorusOut)
    chorusDry.gain.value = 1
    this.chorusWet.gain.value = 0

    for (const cfg of CHORUS_VOICES) {
      const tap = ctx.createDelay(0.1)
      tap.delayTime.value = cfg.delay
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = cfg.rate
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = cfg.depth
      lfo.connect(lfoGain).connect(tap.delayTime)
      driveOut.connect(tap).connect(this.chorusWet)
      lfo.start()
      this.chorusLfos.push(lfo)
      this.allNodes.push(tap, lfoGain)
    }
    this.chorusWet.connect(chorusOut)

    // --- Delay: dry through + feedback loop + wet mix. ---
    const delayDry = ctx.createGain()
    this.delayNode = ctx.createDelay(MAX_DELAY_SECONDS)
    this.delayFeedback = ctx.createGain()
    this.delayWet = ctx.createGain()
    const delayOut = ctx.createGain()

    chorusOut.connect(delayDry).connect(delayOut)
    chorusOut.connect(this.delayNode)
    this.delayNode.connect(this.delayFeedback).connect(this.delayNode)
    this.delayNode.connect(this.delayWet).connect(delayOut)

    delayDry.gain.value = 1
    this.delayNode.delayTime.value = 0.3
    this.delayFeedback.gain.value = 0
    this.delayWet.gain.value = 0

    // --- Reverb: convolution wet crossfaded against dry. ---
    this.reverbDry = ctx.createGain()
    this.convolver = ctx.createConvolver()
    this.reverbWet = ctx.createGain()
    const reverbOut = ctx.createGain()

    delayOut.connect(this.reverbDry).connect(reverbOut)
    delayOut.connect(this.convolver).connect(this.reverbWet).connect(reverbOut)
    this.rebuildImpulse(0.5)
    this.reverbDry.gain.value = 1
    this.reverbWet.gain.value = 0

    // --- Limiter: fast, high-ratio brickwall-ish master safety. ---
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.1
    this.limiter.threshold.value = -3

    reverbOut.connect(this.limiter).connect(this.output)

    this.allNodes.push(
      this.input,
      this.driveDry,
      this.drivePre,
      shaper,
      this.driveWet,
      driveOut,
      chorusDry,
      this.chorusWet,
      chorusOut,
      delayDry,
      this.delayNode,
      this.delayFeedback,
      this.delayWet,
      delayOut,
      this.reverbDry,
      this.convolver,
      this.reverbWet,
      reverbOut,
      this.limiter,
      this.output,
      ...this.chorusLfos,
    )
  }

  /** Apply a full FX parameter set, smoothing every audio-rate change. */
  setParams(fx: FxParams): void {
    // Drive: crossfade clean/saturated and push harder into the shaper.
    this.ramp(this.driveDry.gain, 1 - fx.drive)
    this.ramp(this.driveWet.gain, fx.drive)
    this.ramp(this.drivePre.gain, 1 + fx.drive * 6)

    // Chorus: keep the taps running, mix in the wet blend.
    this.ramp(this.chorusWet.gain, fx.chorus * 0.5)

    // Delay: remember params (for setTempo), then set time/feedback/mix.
    this.currentDelay = fx.delay
    this.ramp(this.delayNode.delayTime, this.computeDelayTime(fx.delay))
    this.ramp(this.delayFeedback.gain, Math.min(fx.delay.feedback, MAX_FEEDBACK))
    this.ramp(this.delayWet.gain, fx.delay.mix)

    // Reverb: rebuild the impulse only on a real size change, then crossfade.
    if (Math.abs(fx.reverb.size - this.lastReverbSize) > 0.001) {
      this.rebuildImpulse(fx.reverb.size)
    }
    this.ramp(this.reverbWet.gain, fx.reverb.mix)
    this.ramp(this.reverbDry.gain, 1 - fx.reverb.mix)

    // Limiter threshold in dB.
    this.ramp(this.limiter.threshold, fx.limiterThreshold)
  }

  /** Update the tempo; recomputes the delay time when the delay is synced. */
  setTempo(bpm: number): void {
    this.bpm = bpm
    if (this.currentDelay.tempoSync) {
      this.ramp(this.delayNode.delayTime, this.computeDelayTime(this.currentDelay))
    }
  }

  /** Stop oscillators and tear down the graph. Does not close the context. */
  dispose(): void {
    for (const lfo of this.chorusLfos) {
      try {
        lfo.stop()
      } catch {
        // Already stopped; ignore.
      }
    }
    for (const node of this.allNodes) node.disconnect()
  }

  /**
   * Delay time in seconds. When synced, follows the spec formula
   * `division * secondsPerBeat(bpm)`; otherwise the raw `time`. Always clamped
   * into a range the DelayNode can represent.
   */
  private computeDelayTime(delay: DelayParams): number {
    const raw = delay.tempoSync
      ? delay.division * secondsPerBeat(this.bpm)
      : delay.time
    return Math.min(MAX_DELAY_SECONDS, Math.max(0.0001, raw))
  }

  private rebuildImpulse(size: number): void {
    this.convolver.buffer = makeReverbImpulse(this.ctx, size)
    this.lastReverbSize = size
  }

  private ramp(param: AudioParam, value: number, tc = SMOOTH_TC): void {
    param.setTargetAtTime(value, this.ctx.currentTime, tc)
  }
}

/** A fixed symmetric tanh soft-clip transfer curve, normalised to ±1. */
function makeSoftClipCurve(samples = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT))
  const k = 3
  const norm = Math.tanh(k)
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

/**
 * Synthesize a stereo exponential-decay noise impulse. `size` (0..1) scales
 * both the tail length (0.15..4 s) and how fast it decays.
 */
function makeReverbImpulse(ctx: AudioContext, size: number): AudioBuffer {
  const clamped = size < 0 ? 0 : size > 1 ? 1 : size
  const duration = 0.15 + clamped * 3.85
  const rate = ctx.sampleRate
  const length = Math.max(1, Math.floor(rate * duration))
  const buffer = ctx.createBuffer(2, length, rate)
  // Longer sizes decay more gently; shorter sizes clamp down quickly.
  const decay = 6 - clamped * 4
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      const t = i / length
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
    }
  }
  return buffer
}
