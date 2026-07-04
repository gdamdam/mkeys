import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

// Emit a JSON list of the content-hashed build assets (JS/CSS/worklet) so the
// service worker can precache them at install. The SW activates only after the
// first visit's assets have already loaded, so without an explicit manifest those
// hashed files would not be cached until re-requested — breaking the first
// offline load. Paths are relative to the app base; the SW prepends its scope.
//
// Also stamps a build fingerprint into the (verbatim-copied) public/sw.js so its
// bytes change between deploys: browsers skip the SW update when the bytes are
// identical, so without this precache() would run exactly once per client, ever,
// and every later deploy's new hashed assets would never be precached.
function precacheManifest(): Plugin {
  let outDir = 'dist'
  let root = process.cwd()
  let buildHash = 'dev'
  return {
    name: 'mkeys-precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
      root = config.root
    },
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => !fileName.endsWith('.html') && fileName !== 'precache-manifest.json')
        .sort()
      // Derive the fingerprint from the content-hashed asset names, so it changes
      // iff any asset changes.
      buildHash = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify(assets),
      })
    },
    // Public files are copied verbatim before closeBundle, so patch the written
    // sw.js on disk. Fall back to the public source if it isn't there yet.
    closeBundle() {
      const dest = resolve(root, outDir, 'sw.js')
      const source = existsSync(dest) ? dest : resolve(root, 'public/sw.js')
      if (!existsSync(source)) return
      const patched = readFileSync(source, 'utf8').replace(/__BUILD_HASH__/g, buildHash)
      writeFileSync(dest, patched)
    },
  }
}

// Custom domain serves from the root, so base is '/'. VITE_BASE_PATH allows
// building for a subpath preview (e.g. GitHub Pages project sites) if needed.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [react(), precacheManifest()],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
