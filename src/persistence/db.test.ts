/**
 * IndexedDB adapter integration tests (§5 hidden autosave, §15 truthful write
 * results). Uses fake-indexeddb to provide a real IDB implementation in the
 * Node test environment.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import * as db from './db'
import { defaultSession } from './session'

afterEach(async () => {
  // Clear everything the fake IDB accumulated between cases.
  for (const rec of await db.list()) await db.del(rec.id)
  await db.deleteAutosave()
})

describe('db adapter round-trips (§15)', () => {
  it('put reports true and get returns the stored, sanitized session', async () => {
    const s = { ...defaultSession(), name: 'Take 1', bpm: 96 }
    expect(await db.put('s1', s)).toBe(true)
    const back = await db.get('s1')
    expect(back?.name).toBe('Take 1')
    expect(back?.bpm).toBe(96)
  })

  it('get returns null for a missing record', async () => {
    expect(await db.get('does-not-exist')).toBeNull()
  })

  it('del reports true and removes the record', async () => {
    await db.put('s2', defaultSession())
    expect(await db.del('s2')).toBe(true)
    expect(await db.get('s2')).toBeNull()
  })
})

describe('autosave is hidden from the named-session library (§5)', () => {
  it('list() never includes the reserved autosave slot', async () => {
    await db.putAutosave({ ...defaultSession(), name: 'working' })
    await db.put('named-1', { ...defaultSession(), name: 'My Session' })
    const listed = await db.list()
    expect(listed.some((r) => r.id === db.AUTOSAVE_KEY)).toBe(false)
    expect(listed.some((r) => r.id === 'named-1')).toBe(true)
  })

  it('the autosave slot is still readable via getAutosave', async () => {
    await db.putAutosave({ ...defaultSession(), name: 'working', bpm: 100 })
    const back = await db.getAutosave()
    expect(back?.bpm).toBe(100)
  })
})

describe('graceful failure when IndexedDB is unavailable (§15)', () => {
  it('reports failure without throwing', async () => {
    const saved = globalThis.indexedDB
    // @ts-expect-error — simulate an environment with no IndexedDB.
    delete globalThis.indexedDB
    try {
      expect(await db.put('x', defaultSession())).toBe(false)
      expect(await db.get('x')).toBeNull()
      expect(await db.list()).toEqual([])
    } finally {
      globalThis.indexedDB = saved
    }
  })
})
