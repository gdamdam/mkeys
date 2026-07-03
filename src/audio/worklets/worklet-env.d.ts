// Ambient declarations for the AudioWorkletGlobalScope API. TypeScript's `dom`
// lib does not ship these (they exist only inside a worklet, not on window), so
// worklet sources authored in TS under this directory would otherwise fail to
// type-check. Kept alongside the worklets so the surface is self-documenting.

interface AudioWorkletProcessor {
  readonly port: MessagePort
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void

declare const sampleRate: number
declare const currentTime: number
declare const currentFrame: number
