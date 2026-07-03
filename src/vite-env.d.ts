/// <reference types="vite/client" />

// Injected by Vite's `define` from package.json at build time.
declare const __APP_VERSION__: string

// AudioWorklet processors are authored in TypeScript under src/audio/worklets/
// and bundled as standalone ESM modules. The `?worker&url` query asks Vite to
// emit each worklet as its own hashed file and hand back the URL string, which
// is then passed to `audioContext.audioWorklet.addModule(url)` at runtime.
declare module '*?worker&url' {
  const src: string
  export default src
}
