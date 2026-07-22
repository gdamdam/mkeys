import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeWav16, MasterRecorder } from './recorder'
import { maxRecordingFrames } from '../limits'

/** Read an ASCII tag from a DataView. */
function tag(view: DataView, offset: number): string {
  let s = ''
  for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

describe('encodeWav16', () => {
  it('writes a valid 16-bit stereo RIFF/WAVE header', () => {
    const frames = 8
    const left = new Float32Array(frames)
    const right = new Float32Array(frames)
    const sampleRate = 48000
    const view = new DataView(encodeWav16(left, right, sampleRate))

    expect(tag(view, 0)).toBe('RIFF')
    expect(tag(view, 8)).toBe('WAVE')
    expect(tag(view, 12)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16) // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(2) // stereo
    expect(view.getUint32(24, true)).toBe(sampleRate)
    expect(view.getUint16(32, true)).toBe(4) // block align = 2ch * 2 bytes
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(tag(view, 36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(frames * 4) // dataSize
  })

  it('sizes the buffer as 44-byte header + interleaved 16-bit stereo data', () => {
    const frames = 100
    const buf = encodeWav16(new Float32Array(frames), new Float32Array(frames), 44100)
    expect(buf.byteLength).toBe(44 + frames * 2 * 2)
  })

  it('byteRate = sampleRate * channels * bytesPerSample', () => {
    const sampleRate = 44100
    const view = new DataView(encodeWav16(new Float32Array(1), new Float32Array(1), sampleRate))
    expect(view.getUint32(28, true)).toBe(sampleRate * 2 * 2)
  })

  it('encodes full-scale samples to the 16-bit peak and clamps out-of-range', () => {
    const left = new Float32Array([1, -1, 2]) // 2 is out of range → clamps to +1
    const right = new Float32Array([0, 0, 0])
    const view = new DataView(encodeWav16(left, right, 48000))
    // Interleaved: L0,R0,L1,R1,L2,R2 — each 2 bytes, starting at offset 44.
    expect(view.getInt16(44, true)).toBe(0x7fff) // +1.0
    expect(view.getInt16(48, true)).toBe(-0x8000) // -1.0
    expect(view.getInt16(52, true)).toBe(0x7fff) // +2.0 clamped
  })

  it('uses the shorter channel length when channels differ', () => {
    const buf = encodeWav16(new Float32Array(10), new Float32Array(4), 48000)
    // length = min(10,4) = 4 frames
    expect(buf.byteLength).toBe(44 + 4 * 4)
  })

  it('an empty capture encodes to a bare 44-byte header (the empty-WAV sentinel)', () => {
    expect(encodeWav16(new Float32Array(0), new Float32Array(0), 48000).byteLength).toBe(44)
  })
})

describe('recording capacity limit (§9)', () => {
  type Port = { onmessage: ((e: { data: unknown }) => void) | null; postMessage: () => void }
  let lastPort: Port | null = null

  class FakeAudioWorkletNode {
    port: Port = { onmessage: null, postMessage: () => {} }
    constructor() {
      lastPort = this.port // capture the port (not `this`) so the test can feed messages
    }
  }

  const fakeCtx = { sampleRate: 8, state: 'running', resume: async () => {} }
  const fakeTap = { connect: () => {}, disconnect: () => {} }

  afterEach(() => {
    vi.unstubAllGlobals()
    lastPort = null
  })

  const feedChunk = (frames: number): void => {
    lastPort?.onmessage?.({
      data: { type: 'chunk', samples: [new Float32Array(frames), new Float32Array(frames)] },
    })
  }

  it('maxRecordingFrames scales with the sample rate', () => {
    expect(maxRecordingFrames(48000)).toBe(maxRecordingFrames(24000) * 2)
    expect(maxRecordingFrames(8)).toBeGreaterThan(0)
  })

  it('fires the auto-stop callback exactly once when the ceiling is reached', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const rec = new MasterRecorder(fakeCtx as unknown as AudioContext, fakeTap as unknown as AudioNode)
    let limitFired = 0
    rec.onLimitReached = () => limitFired++
    await rec.start()

    const cap = maxRecordingFrames(fakeCtx.sampleRate)
    feedChunk(cap) // reaches the ceiling
    expect(limitFired).toBe(1)
    expect(rec.isLimitReached()).toBe(true)
    expect(rec.elapsedSeconds()).toBeCloseTo(cap / fakeCtx.sampleRate, 5)

    feedChunk(10) // further chunks must NOT re-fire the callback
    expect(limitFired).toBe(1)
  })

  it('stop() with nothing captured yields an empty (header-only) WAV', async () => {
    vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
    const rec = new MasterRecorder(fakeCtx as unknown as AudioContext, fakeTap as unknown as AudioNode)
    const blob = await rec.stop()
    expect(blob.size).toBe(44) // the store refuses to download a 44-byte blob
  })
})
