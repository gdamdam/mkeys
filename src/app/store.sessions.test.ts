/**
 * Truthful session-operation results (§15) at the store level. Uses
 * fake-indexeddb so the store's real save/load/delete path runs against a real
 * IndexedDB, and drops the global to exercise the failure path.
 */
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { instrumentStore } from './store'
import { AUTOSAVE_KEY } from '../persistence/db'
import * as db from '../persistence/db'

afterEach(async () => {
  for (const rec of await db.list()) await db.del(rec.id)
})

describe('session-operation results are truthful (§15)', () => {
  it('saveSession reports success only after the write commits, and lists it', async () => {
    const res = await instrumentStore.saveSession('My Take')
    expect(res.ok).toBe(true)
    const listed = instrumentStore.getSnapshot().savedSessions
    const row = listed.find((s) => s.name === 'My Take')
    expect(row).toBeDefined()
    expect(typeof row!.updatedAt).toBe('number') // saved/updated timestamp
  })

  it('saveSession reports failure (and keeps no false success) when storage is unavailable', async () => {
    const saved = globalThis.indexedDB
    // @ts-expect-error — simulate an environment with no IndexedDB.
    delete globalThis.indexedDB
    try {
      const res = await instrumentStore.saveSession('Doomed')
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/unavailable|full/i)
    } finally {
      globalThis.indexedDB = saved
    }
  })

  it('loadSession of a missing id fails truthfully', async () => {
    const res = await instrumentStore.loadSession('no-such-id')
    expect(res.ok).toBe(false)
  })

  it('the reserved autosave slot cannot be loaded or deleted as a session (§5)', async () => {
    expect((await instrumentStore.loadSession(AUTOSAVE_KEY)).ok).toBe(false)
    expect((await instrumentStore.deleteSession(AUTOSAVE_KEY)).ok).toBe(false)
  })

  it('a round-trip save then load restores the session', async () => {
    instrumentStore.setBpm(96)
    const save = await instrumentStore.saveSession('Tempo Take')
    expect(save.ok).toBe(true)
    const id = instrumentStore.getSnapshot().savedSessions.find((s) => s.name === 'Tempo Take')!.id
    instrumentStore.setBpm(120) // change away
    const load = await instrumentStore.loadSession(id)
    expect(load.ok).toBe(true)
    expect(instrumentStore.getSnapshot().session.bpm).toBe(96)
  })
})
