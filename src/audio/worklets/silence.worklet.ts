// Placeholder AudioWorklet processor. It exists so the scaffold exercises the
// full worklet build pipeline (TS source -> Vite `?worker&url` -> hashed asset ->
// `audioWorklet.addModule`) end to end. Real synth/DSP processors replace this.
// See NOTICE — worklet patterns derived from mdrone.

class SilenceProcessor extends AudioWorkletProcessor {
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (const output of outputs) {
      for (const channel of output) {
        channel.fill(0)
      }
    }
    // Keep the node alive; the host tears it down explicitly.
    return true
  }
}

registerProcessor('silence', SilenceProcessor)
