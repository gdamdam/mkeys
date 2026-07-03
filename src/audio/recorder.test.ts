import { describe, expect, it } from 'vitest'
import { encodeWav16 } from './recorder'

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
})
