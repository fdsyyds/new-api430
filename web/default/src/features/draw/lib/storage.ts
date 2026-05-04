import { DRAW_HISTORY_LIMIT } from '../constants'
import type { DrawHistoryRecord } from '../types'

const DB_NAME = 'new-api-draw-history'
const STORE_NAME = 'records'
const DB_VERSION = 1

function canUseIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

function openHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error('IndexedDB is not available'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  const db = await openHistoryDb()

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const request = handler(store)

    if (request) {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    } else {
      tx.oncomplete = () => resolve()
    }

    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }).finally(() => db.close())
}

export async function getDrawHistory(
  userId?: number
): Promise<DrawHistoryRecord[]> {
  if (!canUseIndexedDb()) return []

  const records = await withStore<DrawHistoryRecord[]>(
    'readonly',
    (store) => store.getAll() as IDBRequest<DrawHistoryRecord[]>
  )

  if (!Array.isArray(records)) return []

  return records
    .filter((record) => userId === undefined || record.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveDrawHistoryRecord(
  record: DrawHistoryRecord
): Promise<DrawHistoryRecord[]> {
  await withStore('readwrite', (store) => {
    store.put(record)
  })

  const records = await getDrawHistory(record.userId)
  const staleRecords = records.slice(DRAW_HISTORY_LIMIT)

  if (staleRecords.length > 0) {
    await withStore('readwrite', (store) => {
      staleRecords.forEach((item) => store.delete(item.id))
    })
  }

  return getDrawHistory(record.userId)
}

export async function deleteDrawHistoryRecord(
  id: string,
  userId?: number
): Promise<DrawHistoryRecord[]> {
  await withStore('readwrite', (store) => {
    store.delete(id)
  })

  return getDrawHistory(userId)
}

export async function clearDrawHistory(userId?: number): Promise<void> {
  if (userId !== undefined) {
    const records = await getDrawHistory(userId)
    await withStore('readwrite', (store) => {
      records.forEach((record) => store.delete(record.id))
    })
    return
  }

  await withStore('readwrite', (store) => {
    store.clear()
  })
}
