import { seedDemo } from './demo-seed'
import type { DemoState } from './demo-seed'
import { seedExpansion } from './expansion/seed'
import type { DemoExpansion } from './expansion/seed'

let connection: Promise<IDBDatabase> | undefined
let channel: BroadcastChannel | undefined
const changes = new EventTarget()

function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('eventpass-demo', 2)
    request.onupgradeneeded = change => {
      const store = change.oldVersion === 0
        ? request.result.createObjectStore('application')
        : request.transaction!.objectStore('application')
      const previous = store.get('state')
      previous.onsuccess = () => {
        const state = previous.result as DemoState | undefined ?? seedDemo()
        state.expansion ??= seedExpansion(state)
        store.put(state, 'state')
      }
    }
    request.onblocked = () => reject(new Error('Feche outras abas do EventScan para atualizar a demonstração.'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        connection = undefined
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
  return connection
}

function noticeChannel() {
  if (!channel && 'BroadcastChannel' in globalThis) {
    channel = new BroadcastChannel('eventpass-demo-changes')
    channel.onmessage = () => changes.dispatchEvent(new Event('change'))
  }
  return channel
}

export async function transact<T>(write: boolean, action: (state: DemoState & { expansion: DemoExpansion }) => T): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('application', write ? 'readwrite' : 'readonly')
    const store = transaction.objectStore('application')
    const request = store.get('state')
    let result: T
    let failure: unknown

    request.onsuccess = () => {
      try {
        const state = request.result as DemoState & { expansion: DemoExpansion }
        result = action(state)
        if (write) store.put(state, 'state')
      } catch (error) {
        failure = error
        transaction.abort()
      }
    }

    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('A demonstração não pôde salvar a operação.'))
    transaction.oncomplete = () => {
      if (write) {
        changes.dispatchEvent(new Event('change'))
        noticeChannel()?.postMessage(null)
      }
      resolve(result)
    }
  })
}


export function watchDemo(listener: () => void) {
  noticeChannel()
  changes.addEventListener('change', listener)
  return () => changes.removeEventListener('change', listener)
}
