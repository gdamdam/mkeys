/**
 * Thin, fully guarded IndexedDB wrapper for persisting sessions + autosave.
 *
 * Every call is try/catch-guarded and resolves to null/undefined on ANY
 * failure (missing IndexedDB, blocked upgrade, quota, aborted txn) — it never
 * throws and never rejects. IndexedDB is absent in the node test environment,
 * so this module is intentionally NOT unit-tested; it stays a dumb, defensive
 * adapter with all real logic living in the pure `session.ts`.
 */

import { sanitizeSession } from './session'
import type { Session } from '../types'

const DB_NAME = 'mkeys'
const DB_VERSION = 1
const SESSION_STORE = 'sessions'
const AUTOSAVE_KEY = 'autosave'

/** A stored session record: a sanitized Session plus its lookup id. */
export interface StoredSession {
  id: string
  session: Session
}

/** True when the IndexedDB API is available in the current environment. */
function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

/** Promisify an IDBRequest; resolves null on error instead of rejecting. */
function requestToPromise<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

/**
 * Open (and if needed create/upgrade) the database. Resolves null if
 * IndexedDB is unavailable or the open fails for any reason.
 */
export function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        try {
          const db = req.result
          if (!db.objectStoreNames.contains(SESSION_STORE)) {
            db.createObjectStore(SESSION_STORE, { keyPath: 'id' })
          }
        } catch {
          /* swallow — resolve path below handles failure */
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** Run `fn` inside a transaction on the sessions store; null on any failure. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T | null>,
): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(SESSION_STORE, mode)
    const store = tx.objectStore(SESSION_STORE)
    const result = await fn(store)
    return result
  } catch {
    return null
  } finally {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }
}

/** Fetch and sanitize a stored session by id. Null if missing or on error. */
export async function get(id: string): Promise<Session | null> {
  return withStore('readonly', async (store) => {
    const rec = await requestToPromise<StoredSession | undefined>(
      store.get(id) as IDBRequest<StoredSession | undefined>,
    )
    if (!rec) return null
    return sanitizeSession(rec.session)
  })
}

/** Store a session under `id`. Resolves true on success, false on failure. */
export async function put(id: string, session: Session): Promise<boolean> {
  const record: StoredSession = { id, session: sanitizeSession(session) }
  const result = await withStore('readwrite', async (store) => {
    const res = await requestToPromise(store.put(record))
    // put resolves the key on success; null signals an error.
    return res === null ? null : true
  })
  return result === true
}

/** Delete a stored session by id. Resolves true if the op completed. */
export async function del(id: string): Promise<boolean> {
  const result = await withStore('readwrite', async (store) => {
    await requestToPromise(store.delete(id))
    return true
  })
  return result === true
}

/** List all stored sessions (sanitized). Empty array on any failure. */
export async function list(): Promise<StoredSession[]> {
  const result = await withStore('readonly', async (store) => {
    const all = await requestToPromise<StoredSession[]>(
      store.getAll() as IDBRequest<StoredSession[]>,
    )
    if (!all) return []
    return all.map((rec) => ({ id: rec.id, session: sanitizeSession(rec.session) }))
  })
  return result ?? []
}

/** Persist the autosave slot. Resolves true on success. */
export async function putAutosave(session: Session): Promise<boolean> {
  return put(AUTOSAVE_KEY, session)
}

/** Read the autosave slot, or null if none / on failure. */
export async function getAutosave(): Promise<Session | null> {
  return get(AUTOSAVE_KEY)
}

/** Clear the autosave slot. */
export async function deleteAutosave(): Promise<boolean> {
  return del(AUTOSAVE_KEY)
}
