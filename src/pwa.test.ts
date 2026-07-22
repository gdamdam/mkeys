/**
 * Service-worker safety invariants (§19). The SW itself only runs in a browser,
 * but these source-level guards catch the regressions that matter on a shared
 * origin: it must never purge caches it doesn't own, and it must only answer
 * same-origin requests.
 */
import { describe, expect, it } from 'vitest'
// Vite serves the SW source as a raw string (vite/client `?raw` module type).
import sw from '../public/sw.js?raw'

describe('service worker (§19)', () => {
  it('names its caches in the mkeys- namespace', () => {
    expect(sw).toContain('mkeys-shell-')
    expect(sw).toContain('mkeys-runtime-')
  })

  it('only ever deletes mkeys-owned caches on activate (shared-origin safe)', () => {
    // The activate handler must filter to our namespace before deleting.
    expect(sw).toMatch(/key\.startsWith\(['"]mkeys-['"]\)/)
  })

  it('restricts the fetch handler to same-origin GET requests', () => {
    expect(sw).toContain("request.method !== 'GET'")
    expect(sw).toContain('self.location.origin')
  })
})
