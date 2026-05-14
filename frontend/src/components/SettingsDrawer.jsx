import { useState } from 'react'
import { haptic } from '../utils/haptic'
import { useOS } from '../utils/os'

export default function SettingsDrawer({ isOpen, onClose, theme, setTheme, fontSize, setFontSize, userDisplay, onReRecord }) {
  const os = useOS()
  const [feedbackEmail, setFeedbackEmail] = useState(userDisplay?.includes('@') ? userDisplay : '')
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleFeedback = async () => {
    if (!feedbackEmail && !feedbackMsg) return
    setSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: feedbackEmail, message: feedbackMsg }),
      })
      setSubmitted(true)
    } catch {
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  // iOS: 28px top corners (HIG modal sheet), taller handle bar
  // Android: 16px (M3 bottom sheet spec), slim handle
  // web: 24px default
  const sheetRadius = os === 'ios' ? 'rounded-t-[28px]' : os === 'android' ? 'rounded-t-2xl' : 'rounded-t-3xl'
  const handleCls  = os === 'ios' ? 'w-10 h-1.5' : 'w-8 h-1'

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" style={{animation: 'backdropFade 0.25s ease-out both'}} onClick={() => { haptic.light(); onClose() }} />
      <div className={`fixed bottom-0 left-0 right-0 z-[60] bg-surface ${sheetRadius} border-t border-outline-variant/30 px-5 pt-4 max-h-[88vh] overflow-y-auto anim-drawer`} style={{paddingBottom:'calc(40px + var(--sab))', animation: 'drawerEnter 0.38s cubic-bezier(0.22, 1, 0.36, 1) both'}}>
        <div className={`${handleCls} bg-outline-variant rounded-full mx-auto mb-5`} />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-on-surface">Settings</h2>
          <button onClick={() => { haptic.light(); onClose() }} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Theme */}
        <div className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🌗</span>
            <span className="text-sm font-semibold text-on-surface">Theme</span>
          </div>
          <div className="flex gap-2">
            {[['dark', '🌙 Dark'], ['light', '☀️ Light']].map(([val, label]) => (
              <button key={val} onClick={() => { haptic.select(); setTheme(val) }}
                className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2 ${
                  theme === val
                    ? 'bg-primary-container text-on-primary-container border-primary-container'
                    : 'bg-surface-container-high text-on-surface-variant border-transparent hover:border-outline-variant'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Font size */}
        <div className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🔤</span>
            <span className="text-sm font-semibold text-on-surface">Text Size</span>
          </div>
          <div className="flex gap-2">
            {[['sm', 'Small', 'text-xs'], ['md', 'Medium', 'text-sm'], ['lg', 'Large', 'text-base']].map(([val, label, cls]) => (
              <button key={val} onClick={() => { haptic.select(); setFontSize(val) }}
                className={`flex-1 py-3 rounded-xl font-bold transition-all border-2 ${cls} ${
                  fontSize === val
                    ? 'bg-primary-container text-on-primary-container border-primary-container'
                    : 'bg-surface-container-high text-on-surface-variant border-transparent hover:border-outline-variant'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant mt-2 text-center">Changes apply across all pages</p>
        </div>

        {/* Voice */}
        {onReRecord && (
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base">🎙</span>
              <span className="text-sm font-semibold text-on-surface">Your Voice</span>
            </div>
            <button
              onClick={() => { onClose(); onReRecord() }}
              className="w-full py-3 rounded-xl text-sm font-bold transition-all border-2 bg-surface-container-high text-on-surface-variant border-transparent hover:border-outline-variant"
            >
              Re-record my voice
            </button>
          </div>
        )}

        {/* Help & Feedback */}
        <div className="rounded-2xl overflow-hidden border border-outline-variant/20" style={{background:'linear-gradient(135deg, rgba(255,214,0,0.08) 0%, rgba(127,214,195,0.06) 100%)'}}>
          {/* Header band */}
          <div className="px-5 pt-5 pb-4 border-b border-outline-variant/15">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-9 h-9 rounded-xl bg-primary-container/20 flex items-center justify-center shrink-0">
                <span className="text-lg">💌</span>
              </div>
              <div>
                <p className="text-sm font-bold text-on-surface leading-tight">Share your thoughts</p>
                <p className="text-xs text-on-surface-variant leading-tight">We read every message personally</p>
              </div>
            </div>
          </div>

          <div className="px-5 py-4">
            {submitted ? (
              <div className="py-6 text-center">
                <div className="text-4xl mb-3">🙏</div>
                <p className="text-sm font-bold text-on-surface">Thank you so much!</p>
                <p className="text-xs text-on-surface-variant mt-1">We'll get back to you soon.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Prompt chips */}
                <div className="flex gap-2 flex-wrap">
                  {['✨ Love something', '🐛 Found a bug', '💡 Have an idea'].map(chip => (
                    <button key={chip} onClick={() => setFeedbackMsg(m => m ? m : chip.slice(2).trim())}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-full bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:border-outline-variant transition-colors">
                      {chip}
                    </button>
                  ))}
                </div>

                <textarea value={feedbackMsg} onChange={e => setFeedbackMsg(e.target.value)}
                  placeholder="What's on your mind? Every word helps us build a better Kidly…"
                  rows={3}
                  className="w-full px-4 py-3 border border-outline-variant/40 rounded-xl bg-surface-container text-on-surface placeholder:text-on-surface-variant/60 text-sm resize-none outline-none focus:border-primary-container transition-colors" />

                <input type="email" value={feedbackEmail} onChange={e => setFeedbackEmail(e.target.value)}
                  placeholder="Your email — so we can reply (optional)"
                  className="w-full px-4 py-2.5 border border-outline-variant/40 rounded-xl bg-surface-container text-on-surface placeholder:text-on-surface-variant/60 text-sm outline-none focus:border-primary-container transition-colors" />

                <button onClick={handleFeedback}
                  disabled={submitting || (!feedbackEmail && !feedbackMsg)}
                  className="w-full py-3 bg-primary-container text-on-primary-container rounded-xl text-sm font-bold btn-3d disabled:opacity-40 transition-opacity flex items-center justify-center gap-2 md-ripple">
                  {submitting
                    ? <><span className="w-4 h-4 border-2 border-on-primary-container/40 border-t-on-primary-container rounded-full animate-spin" /> Sending…</>
                    : <><span className="material-symbols-outlined ms-fill" style={{fontSize:16}}>send</span> Send feedback</>
                  }
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
