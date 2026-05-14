import { useState } from 'react'
import { useOS } from '../utils/os'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

export default function PushPermission({ sessionToken, onDismiss }) {
  const os = useOS()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // iOS requires the app to be installed (standalone) for push to work
  const isIosStandalone = os === 'ios' && window.navigator.standalone === true

  if (os === 'ios' && !isIosStandalone) return null

  const handleEnable = async () => {
    setLoading(true)
    setError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        localStorage.setItem('kidly_push_asked', '1')
        onDismiss()
        return
      }

      const reg = await navigator.serviceWorker.ready
      const keyRes = await fetch('/api/push/vapid-public-key')
      if (!keyRes.ok) throw new Error('Push not configured')
      const { publicKey } = await keyRes.json()

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken, subscription: sub.toJSON() }),
      })

      localStorage.setItem('kidly_push_asked', '1')
      onDismiss()
    } catch (err) {
      setError('Could not enable notifications.')
      setLoading(false)
    }
  }

  const handleDismiss = () => {
    localStorage.setItem('kidly_push_asked', '1')
    onDismiss()
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div
        className="bg-surface-container-high border border-outline-variant/30 rounded-2xl shadow-2xl px-4 py-4 max-w-sm mx-auto"
        style={{ boxShadow: '0 -4px 32px rgba(0,0,0,0.5)' }}
      >
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0 mt-0.5">🔔</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-on-surface leading-tight">
              Bedtime reminders
            </p>
            <p className="text-xs text-on-surface-variant leading-snug mt-1">
              Get a gentle nudge each evening so you never miss story time.
            </p>
            {error && <p className="text-xs text-error mt-1">{error}</p>}
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 text-on-surface-variant hover:text-on-surface text-lg leading-none ml-1"
          >✕</button>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleDismiss}
            className="flex-1 py-2 rounded-full border border-outline-variant text-on-surface-variant text-xs font-semibold"
          >
            Not now
          </button>
          <button
            onClick={handleEnable}
            disabled={loading}
            className="flex-1 py-2 rounded-full bg-primary-container text-on-primary-container text-xs font-bold btn-3d disabled:opacity-60"
          >
            {loading ? '…' : 'Enable'}
          </button>
        </div>
      </div>
    </div>
  )
}
