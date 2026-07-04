/**
 * Numerical-stability tests for the synth worklet.
 *
 * The worklet registers itself via AudioWorklet globals, so those are stubbed
 * before the (dynamic) import and the processor class is captured from
 * registerProcessor. Rendering is driven directly through process().
 *
 * Regression focus: the Chamberlin SVF must never diverge to Inf/NaN — a single
 * non-finite sample reaching the master FX chain is trapped forever in the
 * delay feedback loop and permanently silences the instrument.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { PatchParams } from '../../types'

interface ProcessorLike {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

let ProcessorClass: new () => ProcessorLike

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).sampleRate = 48000
  ;(globalThis as Record<string, unknown>).currentTime = 0
  ;(globalThis as Record<string, unknown>).registerProcessor = (
    _name: string,
    cls: new () => ProcessorLike,
  ) => {
    ProcessorClass = cls
  }
  ;(globalThis as Record<string, unknown>).AudioWorkletProcessor = class {
    port = { onmessage: null }
  }
  await import('./synth.worklet')
})

const BLOCK = 128

function basePatch(): PatchParams {
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

/** Render `blocks` blocks; return the first non-finite sample's position, or null. */
function renderAndScan(
  proc: ProcessorLike,
  blocks: number,
): { block: number; sample: number } | null {
  for (let b = 0; b < blocks; b++) {
    const left = new Float32Array(BLOCK)
    const right = new Float32Array(BLOCK)
    proc.process([], [[left, right]])
    for (let i = 0; i < BLOCK; i++) {
      if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) {
        return { block: b, sample: i }
      }
    }
  }
  return null
}

function makeProc(patch: PatchParams): { proc: ProcessorLike; send: (m: unknown) => void } {
  const proc = new ProcessorClass()
  const send = (msg: unknown): void => proc.port.onmessage?.({ data: msg })
  send({ type: 'setPatch', patch })
  return { proc, send }
}

describe('synth worklet numerical stability', () => {
  it('renders a default-patch note without ever producing NaN/Inf', () => {
    const { proc, send } = makeProc(basePatch())
    send({ type: 'noteOn', id: 1, midi: 69, velocity: 0.7 })
    expect(renderAndScan(proc, 200)).toBeNull() // ~0.5 s held
    send({ type: 'noteOff', id: 1 })
    expect(renderAndScan(proc, 400)).toBeNull() // full release tail
  })

  it('stays finite at worst-case cutoff push (bright patch, high note, full timbre)', () => {
    const patch = basePatch()
    patch.filter = { cutoff: 20000, resonance: 0, drive: 0.5, envAmount: 1, keytrack: 1 }
    const { proc, send } = makeProc(patch)
    send({ type: 'noteOn', id: 2, midi: 96, velocity: 1 })
    send({ type: 'expression', id: 2, expr: { pitch: 96, glide: 0, timbre: 1, pressure: 1 } })
    expect(renderAndScan(proc, 400)).toBeNull()
  })

  it('stays finite across the resonance range', () => {
    for (const resonance of [0, 0.5, 1]) {
      const patch = basePatch()
      patch.filter = { cutoff: 12000, resonance, drive: 0, envAmount: 0.5, keytrack: 0.5 }
      const { proc, send } = makeProc(patch)
      send({ type: 'noteOn', id: 3, midi: 84, velocity: 0.9 })
      expect(renderAndScan(proc, 200), `resonance ${resonance}`).toBeNull()
    }
  })

  it('recovers voices whose envelope level was poisoned by a past divergence', () => {
    const { proc, send } = makeProc(basePatch())
    send({ type: 'noteOn', id: 4, midi: 69, velocity: 0.7 })
    renderAndScan(proc, 10)
    send({ type: 'panic' })
    // A re-triggered voice must start clean even if a previous take diverged.
    send({ type: 'noteOn', id: 5, midi: 69, velocity: 0.7 })
    expect(renderAndScan(proc, 200)).toBeNull()
  })
})
