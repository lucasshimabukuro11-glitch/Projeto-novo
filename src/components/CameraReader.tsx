import { useEffect, useRef } from 'react'
import type { IScannerControls } from '@zxing/browser'

export function CameraReader({ onRead, onError }: { onRead: (result: string) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const callbacks = useRef({ onRead, onError })
  callbacks.current = { onRead, onError }

  useEffect(() => {
    const video = videoRef.current!
    let controls: IScannerControls | undefined
    let stream: MediaStream | undefined
    let stopped = false

    const stop = () => {
      controls?.stop()
      stream?.getTracks().forEach(track => track.stop())
      video.srcObject = null
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          callbacks.current.onError('A câmera precisa de HTTPS ou localhost. Você pode digitar o código abaixo.')
          return
        }
        const { BrowserQRCodeReader } = await import('@zxing/browser')
        if (stopped) return
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
        if (stopped) {
          stop()
          return
        }
        controls = await new BrowserQRCodeReader().decodeFromStream(
          stream,
          video,
          (result, _error, scanner) => {
            if (result && !stopped) {
              stopped = true
              scanner.stop()
              callbacks.current.onRead(result.getText())
            }
          },
        )
        if (stopped) stop()
      } catch (issue) {
        if (stopped) return
        stop()
        const denied = issue instanceof Error && issue.name === 'NotAllowedError'
        callbacks.current.onError(denied
          ? 'O acesso à câmera foi negado. Permita o acesso no navegador ou digite o código.'
          : 'Não foi possível abrir a câmera. Confira se ela está disponível ou digite o código.')
      }
    }

    void start()
    return () => {
      stopped = true
      stop()
    }
  }, [])

  return <video ref={videoRef} className="scanner-video" muted autoPlay playsInline aria-label="Prévia da câmera para leitura do QR Code" />
}
