import { describe, expect, it } from 'vitest'
import { MODES, SESSION_VERSION } from './types'

describe('types contract', () => {
  it('exposes a non-empty, major-first mode list', () => {
    expect(MODES.length).toBeGreaterThan(0)
    expect(MODES).toContain('major')
    // APPEND-ONLY ordering: major must remain index 0.
    expect(MODES[0]).toBe('major')
  })

  it('has a positive session schema version', () => {
    expect(SESSION_VERSION).toBeGreaterThan(0)
  })
})
