import { useState } from 'react'

function SectionLabel({ icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 18 }}>{icon}</span>
      <span className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">{children}</span>
    </div>
  )
}

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
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[60] bg-surface-container-low rounded-t-3xl border-t border-outline-variant/20 px-6 pt-3 max-h-[90vh] overflow-y-auto no-scrollbar"
        style={{ paddingBottom: 'calc(32px + var(--sab))' }}
      >
        {/* Drag handle */}
        <div className="w-9 h-1 bg-outline-variant/60 rounded-full mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-bold text-on-surface">Settings</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-container text-on-surface-variant active:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-outline-variant/20 mb-6" />

        {/* Theme */}
        <section className="mb-6">
          <SectionLabel icon="contrast">Appearance</SectionLabel>
          <div className="flex bg-surface-container rounded-2xl p-1 gap-1">
            {[
              { val: 'dark',  icon: 'dark_mode',  label: 'Dark'  },
              { val: 'light', icon: 'light_mode', label: 'Light' },
            ].map(({ val, icon, label }) => (
              <button
                key={val}
                onClick={() => setTheme(val)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  theme === val
                    ? 'bg-primary-container text-on-primary-container shadow-sm'
                    : 'text-on-surface-variant active:bg-surface-container-high'
                }`}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Text Size */}
        <section className="mb-6">
          <SectionLabel icon="text_fields">Text Size</SectionLabel>
          <div className="flex bg-surface-container rounded-2xl p-1 gap-1">
            {[
              { val: 'sm', label: 'Small',  size: 'text-xs'  },
              { val: 'md', label: 'Medium', size: 'text-sm'  },
              { val: 'lg', label: 'Large',  size: 'text-base' },
            ].map(({ val, label, size }) => (
              <button
                key={val}
                onClick={() => setFontSize(val)}
                className={`flex-1 py-2.5 rounded-xl font-semibold transition-all ${size} ${
                  fontSize === val
                    ? 'bg-primary-container text-on-primary-container shadow-sm'
                    : 'text-on-surface-variant active:bg-surface-container-high'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-on-surface-variant/60 mt-2 text-center">Applies to story text</p>
        </section>

        {/* Divider */}
        <div className="h-px bg-outline-variant/20 mb-6" />

        {/* Feedback */}
        <section>
          <SectionLabel icon="chat_bubble">Help &amp; Feedback</SectionLabel>
          {submitted ? (
            <div className="bg-surface-container rounded-2xl p-6 text-center">
              <span className="material-symbols-outlined ms-fill text-secondary" style={{ fontSize: 36 }}>favorite</span>
              <p className="text-sm font-bold text-on-surface mt-2">Thank you!</p>
              <p className="text-xs text-on-surface-variant mt-1">We'll be in touch soon.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <input
                type="email"
                value={feedbackEmail}
                onChange={e => setFeedbackEmail(e.target.value)}
                placeholder="Your email (optional)"
                className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/50 text-sm outline-none focus:border-primary-container transition-colors"
              />
              <textarea
                value={feedbackMsg}
                onChange={e => setFeedbackMsg(e.target.value)}
                placeholder="Questions, ideas, or bug reports…"
                rows={3}
                className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/30 text-on-surface placeholder:text-on-surface-variant/50 text-sm resize-none outline-none focus:border-primary-container transition-colors"
              />
              <button
                onClick={handleFeedback}
                disabled={submitting || (!feedbackEmail && !feedbackMsg)}
                className="w-full py-3 bg-primary-container text-on-primary-container rounded-xl text-sm font-bold btn-3d disabled:opacity-40 transition-opacity"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
                    Sending…
                  </span>
                ) : 'Send feedback'}
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
