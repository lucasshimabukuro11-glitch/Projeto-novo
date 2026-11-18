import { useCallback, useEffect, useRef, useState } from 'react'
import { data, errorMessage } from './index'

interface Snapshot<T> {
  key: string
  data?: T
  error?: string
}

export function useResource<T>(key: string, load: () => Promise<T>, live = false) {
  const loadRef = useRef(load)
  loadRef.current = load
  const refreshRef = useRef<() => void>(() => {})
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ key })

  useEffect(() => {
    let active = true
    let request = 0
    const refresh = async () => {
      const version = ++request
      try {
        const result = await loadRef.current()
        if (active && request === version) setSnapshot({ key, data: result })
      } catch (error) {
        if (active && request === version) {
          setSnapshot(previous => ({ key, data: previous.key === key ? previous.data : undefined, error: errorMessage(error) }))
        }
      }
    }

    refreshRef.current = refresh
    void refresh()
    const unwatch = live ? data.watch(refresh) : undefined
    const interval = live ? window.setInterval(refresh, 8000) : undefined
    return () => {
      active = false
      unwatch?.()
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [key, live])

  const current = snapshot.key === key ? snapshot : { key }
  const refresh = useCallback(() => refreshRef.current(), [])
  return { ...current, pending: current.data === undefined && !current.error, refresh }
}
