/**
 * mkeys master-recorder tap AudioWorklet (`mkeys-recorder-tap`).
 *
 * A pass-through capture node: it has one input and no output, so it taps the
 * master signal in parallel without altering the path to the destination. While
 * capturing it batches Float32 stereo frames and transfers them to the main
 * thread, which concatenates them and encodes a WAV on stop (see recorder.ts).
 *
 * Message protocol:
 *   main → node : { type:'start' }                       begin capturing
 *   main → node : { type:'stop' }                        flush + finish
 *   node → main : { type:'chunk', samples:[L, R] }       batched Float32 frames
 *   node → main : { type:'done' }                        final chunk sent
 *
 * Pattern derived from mdrone's fx-recorder-tap (see NOTICE).
 */

const BLOCK = 128
/** 32 × 128 ≈ 93 ms at 44.1k — infrequent messaging, small stop-tail loss. */
const BATCH_BLOCKS = 32
const BATCH_FRAMES = BATCH_BLOCKS * BLOCK

interface StartMsg {
  type: 'start'
}
interface StopMsg {
  type: 'stop'
}
type RecorderInMsg = StartMsg | StopMsg

class RecorderTapProcessor extends AudioWorkletProcessor {
  private capturing = false
  private stopped = false
  private bufL = new Float32Array(BATCH_FRAMES)
  private bufR = new Float32Array(BATCH_FRAMES)
  private blockInBatch = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<RecorderInMsg>) => {
      const msg = e.data
      if (!msg) return
      if (msg.type === 'start') {
        this.capturing = true
        this.blockInBatch = 0
      } else if (msg.type === 'stop') {
        if (this.blockInBatch > 0) this.flush()
        this.capturing = false
        try {
          this.port.postMessage({ type: 'done' })
        } catch {
          // Port already closed; nothing to do.
        }
        // A fresh tap is built per take, so terminate rather than idle-live.
        this.stopped = true
      }
    }
  }

  private flush(): void {
    const frames = this.blockInBatch * BLOCK
    // Slice to the exact frame count so a partial final batch carries no stale
    // samples from the previous full batch into the WAV.
    const left = this.bufL.slice(0, frames)
    const right = this.bufR.slice(0, frames)
    try {
      this.port.postMessage({ type: 'chunk', samples: [left, right] }, [left.buffer, right.buffer])
    } catch {
      // Port closed mid-flush; drop the batch.
    }
    this.bufL = new Float32Array(BATCH_FRAMES)
    this.bufR = new Float32Array(BATCH_FRAMES)
    this.blockInBatch = 0
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false
    if (!this.capturing) return true
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const inL = input[0]
    const inR = input.length > 1 ? input[1] : inL
    const offset = this.blockInBatch * BLOCK
    this.bufL.set(inL, offset)
    this.bufR.set(inR, offset)
    this.blockInBatch += 1
    if (this.blockInBatch >= BATCH_BLOCKS) this.flush()
    return true
  }
}

registerProcessor('mkeys-recorder-tap', RecorderTapProcessor)
