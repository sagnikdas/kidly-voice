import { useState } from 'react'

export default function SettingsDrawer({ isOpen, onClose, theme, setTheme, fontSize, setFontSize, userDisplay }) {
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

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[60] bg-surface rounded-t-3xl border-t border-outline-variant/30 px-5 pt-4 max-h-[88vh] overflow-y-auto" style={{paddingBottom:'calc(40px + var(--sab))'}}>
        <div className="w-10 h-1 bg-outline-variant rounded-full mx-auto mb-5" />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-on-surface">Settings</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
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
              <button key={val} onClick={() => setTheme(val)}
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
              <button key={val} onClick={() => setFontSize(val)}
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

        {/* Help & Feedback */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">💬</span>
            <span className="text-sm font-semibold text-on-surface">Help & Feedback</span>
          </div>
          {submitted ? (
            <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-5 text-center">
              <div className="text-3xl mb-2">🙏</div>
              <p className="text-sm font-bold text-on-surface">Thank you!</p>
              <p className="text-xs text-on-surface-variant mt-1">We'll get back to you soon.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <input type="email" value={feedbackEmail} onChange={e => setFeedbackEmail(e.target.value)}
                placeholder="Your email (optional)"
                className="w-full px-4 py-2.5 border border-outline-variant rounded-xl bg-surface-container text-on-surface placeholder:text-on-surface-variant text-sm outline-none focus:border-primary-container" />
              <textarea value={feedbackMsg} onChange={e => setFeedbackMsg(e.target.value)}
                placeholder="Questions, feedback, or bug reports…"
                rows={3}
                className="w-full px-4 py-2.5 border border-outline-variant rounded-xl bg-surface-container text-on-surface placeholder:text-on-surface-variant text-sm resize-none outline-none focus:border-primary-container" />
              <button onClick={handleFeedback}
                disabled={submitting || (!feedbackEmail && !feedbackMsg)}
                className="w-full py-3 bg-primary-container text-on-primary-container rounded-full text-sm font-bold btn-3d disabled:opacity-40 transition-opacity">
                {submitting ? 'Sending…' : 'Send feedback →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
