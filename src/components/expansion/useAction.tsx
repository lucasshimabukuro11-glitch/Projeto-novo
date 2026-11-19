import { useRef, useState } from 'react'
import { errorMessage } from '../../data'
import { Notice } from '../ui'

export function useAction(refresh?: () => void) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null)

  async function run(action: () => Promise<unknown>, message: string) {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setFeedback(null)
    try {
      await action()
      setFeedback({ message })
      refresh?.()
      return true
    } catch (issue) {
      setFeedback({ message: errorMessage(issue), error: true })
      return false
    } finally {
      setBusy(false)
      lock.current = false
    }
  }

  const notice = feedback && <Notice tone={feedback.error ? 'danger' : 'success'}>{feedback.message}</Notice>
  return { run, busy, notice }
}
