import { useState } from 'react'

const isValidEmail = (val) =>
  /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test((val || '').trim())

export default function Landing({ email, setEmail, onSendLink, sending, sendError, verifyError }) {
  const [touched, setTouched] = useState(false)
  const [sent, setSent] = useState(false)

  const emailOk = isValidEmail(email)
  const showError = touched && email.trim().length > 0 && !emailOk
  const borderClass = emailOk
    ? 'border-green-500'
    : showError
      ? 'border-red-500'
      : 'border-outline-variant focus:border-primary-container'

  const handleSubmit = async () => {
    setTouched(true)
    if (!emailOk || sending) return
    const ok = await onSendLink(email.trim())
    if (ok) setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 md:p-8">
      <main className="flex flex-col md:flex-row w-full max-w-[900px] min-h-[580px] overflow-hidden rounded-[2rem] shadow-2xl">

        {/* ── Left hero panel ── */}
        <div className="relative w-full md:w-1/2 min-h-[260px] md:min-h-full flex flex-col justify-between overflow-hidden p-8 select-none"
             style={{background:'linear-gradient(135deg,#1e1b4b 0%,#312e81 45%,#4c1d95 100%)'}}>
          <span className="absolute top-6  right-12 text-yellow-200 opacity-60 text-2xl">✦</span>
          <span className="absolute top-20 right-6  text-yellow-100 opacity-30 text-sm">✦</span>
          <span className="absolute top-10 left-28  text-purple-300 opacity-40 text-xs">✦</span>
          <span className="absolute bottom-28 left-8 text-yellow-200 opacity-25 text-xl">✦</span>

          <div className="text-8xl leading-none">🌙</div>

          <div className="mt-auto">
            <p className="text-white text-3xl font-bold leading-tight mb-3">
              "Sleep tight,<br/>little one..."
            </p>
            <p className="text-purple-300 text-sm leading-relaxed mb-6">
              Record your voice once — Kidly narrates any bedtime story in <em>your</em> voice, every night.
            </p>
            <div className="flex flex-wrap gap-2">
              {['🦊 The Brave Little Fox', '🌙 The Sleep Fairy', '⭐ Star Who Feared Dark'].map(s => (
                <span key={s} className="text-xs text-purple-200 px-3 py-1 rounded-full"
                      style={{background:'rgba(255,255,255,0.1)'}}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center p-8 md:p-10 bg-surface">

          <div className="mb-8">
            <h1 className="text-5xl font-extrabold text-primary-container tracking-tight">Kidly</h1>
          </div>

          <div className="w-full max-w-[340px] flex flex-col items-center text-center">
            {sent ? (
              /* ── Check-inbox state ── */
              <div className="space-y-5 w-full">
                <div className="text-5xl">📬</div>
                <h2 className="text-xl font-semibold text-on-surface">Check your inbox</h2>
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  We sent a sign-in link to <strong className="text-on-surface">{email}</strong>.
                  <br/>The link expires in 15 minutes.
                </p>
                <p className="text-xs text-on-surface-variant">
                  Didn't get it?{' '}
                  <button
                    onClick={() => { setSent(false); setTouched(false) }}
                    className="text-primary-container underline underline-offset-2 hover:opacity-80"
                  >
                    Try a different email
                  </button>
                </p>
              </div>
            ) : (
              /* ── Email form state ── */
              <>
                <h2 className="text-xl font-semibold text-on-surface mb-2">Welcome, Storyteller</h2>
                <p className="text-sm text-on-surface-variant mb-6 leading-relaxed">
                  Enter your email and we'll send you a magic link — no password needed.
                </p>

                {verifyError && (
                  <div className="w-full mb-4 px-4 py-3 rounded-xl bg-error/10 border border-error/30 text-error text-sm text-left">
                    {verifyError}
                  </div>
                )}

                <div className="w-full space-y-3 mb-4">
                  <div className="relative">
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      onBlur={() => setTouched(true)}
                      onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                      placeholder="your@email.com"
                      className={`w-full px-5 py-3.5 pr-10 rounded-full bg-surface-container border text-on-surface placeholder:text-on-surface-variant text-sm outline-none transition-colors ${borderClass}`}
                    />
                    {emailOk && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500 font-bold text-sm">✓</span>
                    )}
                  </div>
                  {showError && (
                    <p className="text-xs text-red-400 text-left pl-4">
                      Enter a valid email address
                    </p>
                  )}
                  {sendError && (
                    <p className="text-xs text-red-400 text-left pl-4">{sendError}</p>
                  )}
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={sending || !emailOk}
                  className="w-full py-4 bg-primary-container text-on-primary-container font-bold rounded-full transition-all glow-primary btn-3d disabled:opacity-50 disabled:cursor-not-allowed mb-6"
                >
                  {sending ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
                      Sending link…
                    </span>
                  ) : (
                    'Send me a magic link →'
                  )}
                </button>

                <div className="flex items-center justify-center gap-4 text-xs text-on-surface-variant flex-wrap">
                  <span className="flex items-center gap-1"><span className="text-secondary">✓</span> No password</span>
                  <span className="flex items-center gap-1"><span className="text-secondary">✓</span> 2 minutes</span>
                  <span className="flex items-center gap-1"><span className="text-secondary">✓</span> 15 stories</span>
                </div>
              </>
            )}
          </div>
        </div>

      </main>
    </div>
  )
}
