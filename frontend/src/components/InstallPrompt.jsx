import { useState } from 'react'
import { useOS } from '../utils/os'

// iOS share icon — inline SVG matching the actual Safari share button shape
function IOSShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         style={{display:'inline',verticalAlign:'middle',margin:'0 2px'}}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  )
}

export default function InstallPrompt({ deferredPrompt, onDismiss }) {
  const os = useOS()
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    if (!deferredPrompt) return
    setInstalling(true)
    try {
      deferredPrompt.prompt()
      await deferredPrompt.userChoice
    } finally {
      onDismiss()
    }
  }

  // ── iOS — custom instruction sheet (Safari has no native prompt) ──
  if (os === 'ios') {
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-50 px-4 pb-safe"
        style={{paddingBottom:'max(1.5rem, env(safe-area-inset-bottom))'}}
      >
        <div className="bg-surface-container-high border border-outline-variant/30 rounded-2xl shadow-2xl p-5 max-w-sm mx-auto"
             style={{boxShadow:'0 -4px 32px rgba(0,0,0,0.5)'}}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🌙</div>
              <div>
                <p className="font-bold text-on-surface text-sm">Add Kidly to Home Screen</p>
                <p className="text-xs text-on-surface-variant mt-0.5">Use it like an app — no browser bar</p>
              </div>
            </div>
            <button onClick={onDismiss}
                    className="text-on-surface-variant hover:text-on-surface shrink-0 ml-2 text-lg leading-none">✕</button>
          </div>

          <div className="bg-surface-container rounded-xl px-4 py-3 space-y-2 mb-4">
            <div className="flex items-center gap-3 text-sm text-on-surface">
              <span className="w-6 h-6 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-xs font-bold shrink-0">1</span>
              <span>Tap <IOSShareIcon/> <strong>Share</strong> at the bottom of Safari</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-on-surface">
              <span className="w-6 h-6 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-xs font-bold shrink-0">2</span>
              <span>Tap <strong>"Add to Home Screen"</strong></span>
            </div>
            <div className="flex items-center gap-3 text-sm text-on-surface">
              <span className="w-6 h-6 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-xs font-bold shrink-0">3</span>
              <span>Tap <strong>"Add"</strong> — done!</span>
            </div>
          </div>

          <button onClick={onDismiss}
                  className="w-full py-3 rounded-full bg-primary-container text-on-primary-container font-bold text-sm btn-3d">
            Got it
          </button>
        </div>
      </div>
    )
  }

  // ── Android / Desktop — native install banner ──
  const isDesktop = os === 'web'
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4"
      style={{paddingBottom:'max(1rem, env(safe-area-inset-bottom))'}}
    >
      <div className="flex items-center gap-3 bg-surface-container-high border border-outline-variant/30 rounded-2xl shadow-2xl px-4 py-3 max-w-sm mx-auto"
           style={{boxShadow:'0 -4px 32px rgba(0,0,0,0.5)'}}>
        <div className="text-2xl shrink-0">🌙</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface leading-tight">Install Kidly</p>
          <p className="text-xs text-on-surface-variant leading-tight mt-0.5">
            {isDesktop ? 'Add to your desktop for quick access' : 'Add to your home screen'}
          </p>
        </div>
        <button
          onClick={handleInstall}
          disabled={installing}
          className="shrink-0 px-4 py-2 bg-primary-container text-on-primary-container rounded-full text-xs font-bold btn-3d disabled:opacity-60"
        >
          {installing ? '…' : 'Install'}
        </button>
        <button onClick={onDismiss}
                className="shrink-0 text-on-surface-variant hover:text-on-surface text-lg leading-none ml-1">✕</button>
      </div>
    </div>
  )
}
