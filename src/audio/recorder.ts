/**
 * MasterRecorder — 16-bit stereo PCM WAV capture of the mkeys master bus.
 *
 * Taps the master output in parallel through the `mkeys-recorder-tap` worklet,
 * batches Float32 frames on the audio thread, concatenates them on the main
 * thread, and on stop encodes a 16-bit little-endian PCM WAV Blob with a proper
 * RIFF/WAVE header at the AudioContext's sample rate.
 *
 * The tap is a parallel branch (worklet with no output), so recording never
 * interrupts the signal reaching the destination. A fresh tap node is built per
 * take; the worklet terminates itself after emitting its final chunk.
 */

/** A batched-frames message from the tap worklet. */
interface ChunkMsg {
  type: 'chunk'
  samples: [Float32Array, Float32Array]
}
interface DoneMsg {
  type: 'done'
}
type RecorderOutMsg = ChunkMsg | DoneMsg

/** Max wait for the worklet's "done" ack on stop, so stop() never hangs. */
const DONE_ACK_TIMEOUT_MS = 2000

/**
 * Encode stereo Float32 channels as a 16-bit little-endian PCM WAV.
 * Returns a complete RIFF buffer ready to wrap in a Blob.
 */
export function encodeWav16(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const numCh = 2
  const length = Math.min(left.length, right.length)
  const bytesPerSample = 2
  const blockAlign = numCh * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = length * blockAlign
  const totalSize = 44 + dataSize

  const ab = new ArrayBuffer(totalSize)
  const view = new DataView(ab)
  const writeString = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, totalSize - 8, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < length; i++) {
    const l = Math.max(-1, Math.min(1, left[i]))
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true)
    offset += 2
    const r = Math.max(-1, Math.min(1, right[i]))
    view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7fff, true)
    offset += 2
  }

  return ab
}

export class MasterRecorder {
  private readonly ctx: AudioContext
  private readonly tapNode: AudioNode
  private node: AudioWorkletNode | null = null
  private chunksL: Float32Array[] = []
  private chunksR: Float32Array[] = []
  private totalFrames = 0
  private capturing = false
  private donePromise: Promise<void> | null = null

  /**
   * @param ctx     the running AudioContext
   * @param tapNode the node to tap in parallel (e.g. the engine's master gain)
   */
  constructor(ctx: AudioContext, tapNode: AudioNode) {
    this.ctx = ctx
    this.tapNode = tapNode
  }

  /** True while a capture is in progress. */
  isRecording(): boolean {
    return this.capturing
  }

  /** Begin capturing. The `mkeys-recorder-tap` module must already be added. */
  async start(): Promise<void> {
    if (this.capturing) return
    if (this.ctx.state === 'suspended') await this.ctx.resume()

    let node: AudioWorkletNode
    try {
      node = new AudioWorkletNode(this.ctx, 'mkeys-recorder-tap', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      })
    } catch {
      throw new Error('Recorder worklet not ready. Wait a moment and try again.')
    }

    this.chunksL = []
    this.chunksR = []
    this.totalFrames = 0

    let resolveDone!: () => void
    this.donePromise = new Promise<void>((r) => {
      resolveDone = r
    })

    node.port.onmessage = (e: MessageEvent<RecorderOutMsg>) => {
      const msg = e.data
      if (!msg) return
      if (msg.type === 'chunk') {
        const [l, r] = msg.samples
        this.chunksL.push(l)
        this.chunksR.push(r)
        this.totalFrames += l.length
      } else if (msg.type === 'done') {
        resolveDone()
      }
    }

    // Parallel tap — leaves the path to destination untouched.
    this.tapNode.connect(node)
    node.port.postMessage({ type: 'start' })
    this.node = node
    this.capturing = true
  }

  /**
   * Stop capturing and resolve with the encoded 16-bit WAV Blob. Resolves with
   * an empty stereo WAV if nothing was captured.
   */
  async stop(): Promise<Blob> {
    const node = this.node
    if (!node || !this.capturing) {
      return new Blob([encodeWav16(new Float32Array(0), new Float32Array(0), this.ctx.sampleRate)], {
        type: 'audio/wav',
      })
    }
    this.capturing = false

    node.port.postMessage({ type: 'stop' })
    await this.awaitDoneAck()

    try {
      this.tapNode.disconnect(node)
    } catch {
      // Already disconnected.
    }
    node.port.onmessage = null
    this.node = null

    const left = concat(this.chunksL, this.totalFrames)
    const right = concat(this.chunksR, this.totalFrames)
    this.chunksL = []
    this.chunksR = []

    const wav = encodeWav16(left, right, this.ctx.sampleRate)
    return new Blob([wav], { type: 'audio/wav' })
  }

  /** Best-effort teardown for engine disposal. Idempotent. */
  dispose(): void {
    const node = this.node
    if (node) {
      try {
        node.port.postMessage({ type: 'stop' })
      } catch {
        // ignore
      }
      node.port.onmessage = null
      try {
        this.tapNode.disconnect(node)
      } catch {
        // ignore
      }
    }
    this.node = null
    this.capturing = false
    this.donePromise = null
    this.chunksL = []
    this.chunksR = []
    this.totalFrames = 0
  }

  /** Await the worklet's "done", but never longer than the timeout. */
  private async awaitDoneAck(): Promise<void> {
    const done = this.donePromise
    if (!done) return
    await Promise.race([
      done,
      new Promise<void>((resolve) => {
        setTimeout(resolve, DONE_ACK_TIMEOUT_MS)
      }),
    ])
  }
}

function concat(chunks: Float32Array[], totalFrames: number): Float32Array {
  const out = new Float32Array(totalFrames)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
