import { describe, expect, it } from 'vitest'
import { nextTabIndex } from './tablist'

describe('nextTabIndex — WAI-ARIA tablist keyboard nav (§20)', () => {
  it('ArrowRight advances and wraps', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1)
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0)
  })
  it('ArrowLeft retreats and wraps', () => {
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0)
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2)
  })
  it('Home/End jump to the ends', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0)
    expect(nextTabIndex('End', 0, 3)).toBe(2)
  })
  it('returns null for non-tablist keys', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull()
    expect(nextTabIndex('a', 0, 3)).toBeNull()
    expect(nextTabIndex(' ', 0, 3)).toBeNull()
  })
  it('returns null for an empty tablist', () => {
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull()
  })
})
