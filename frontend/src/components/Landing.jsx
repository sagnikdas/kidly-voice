import { useState } from 'react'

// Local (no +): exactly 10 digits.  International (with +): country code + 10–13 digits.
const isValidMobile = (val) => {
  const stripped = (val || '').replace(/[\s\-\(\)\.]/g, '')
  if (stripped.startsWith('+')) return /^\+[1-9]\d{9,13}$/.test(stripped)
  return /^[1-9]\d{9}$/.test(stripped)
}

// RFC-5321-style email: local@domain.tld, tld ≥ 2 chars
const isValidEmail = (val) => {
  return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test((val || '').trim())
}

export default function Landing({ email, setEmail, mobile, setMobile, onStart, onGoToStories, canGoToStories, restoring }) {
  const [mobileTouched, setMobileTouched] = useState(false)
  const [emailTouched,  setEmailTouched]  = useState(false)

  const mobileVal  = mobile || ''
  const mobileOk   = isValidMobile(mobileVal)
  const emailOk    = isValidEmail(email)
  const canProceed = mobileOk || emailOk

  // Show error only when field has content AND has been blurred AND is still invalid
  const showMobileError = mobileTouched && mobileVal.trim().length > 0 && !mobileOk
  const showEmailError  = emailTouched  && email.trim().length   > 0 && !emailOk

  const mobileBorder = mobileOk
    ? 'border-green-500'
    : showMobileError
      ? 'border-red-500'
      : 'border-outline-variant focus:border-primary-container'

  const emailBorder = emailOk
    ? 'border-green-500'
    : showEmailError
      ? 'border-red-500'
      : 'border-outline-variant focus:border-primary-container'

  const handleSubmit = () => {
    if (!canProceed || restoring) return
    // Mark both as touched so any invalid field shows its error on submit attempt
    setMobileTouched(true)
    setEmailTouched(true)
    if (canProceed) onStart()
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

          {/* Logo */}
          <div className="mb-8">
            {canGoToStories ? (
              <button onClick={onGoToStories}
                className="text-5xl font-extrabold text-primary-container hover:opacity-80 transition-opacity tracking-tight">
                Kidly
              </button>
            ) : (
              <h1 className="text-5xl font-extrabold text-primary-container tracking-tight">Kidly</h1>
            )}
          </div>

          <div className="w-full max-w-[340px] flex flex-col items-center text-center">
            <h2 className="text-xl font-semibold text-on-surface mb-2">Welcome, Storyteller</h2>
            <p className="text-sm text-on-surface-variant mb-6 leading-relaxed">
              Record your voice once. Kidly narrates 15 bedtime stories so your child hears <em>you</em>.
            </p>

            <div className="w-full space-y-1 mb-4">

              {/* Mobile field */}
              <div className="relative">
                <input
                  type="tel"
                  value={mobileVal}
                  onChange={e => setMobile(e.target.value)}
                  onBlur={() => setMobileTouched(true)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="Mobile number  e.g. +91 98765 43210"
                  className={`w-full px-5 py-3.5 pr-10 rounded-full bg-surface-container border text-on-surface placeholder:text-on-surface-variant text-sm outline-none transition-colors ${mobileBorder}`}
                />
                {mobileOk && (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500 font-bold text-sm">✓</span>
                )}
              </div>
              {showMobileError && (
                <p className="text-xs text-red-400 text-left pl-4 pb-1">
                  Enter a 10-digit number (e.g. 9876543210) or include country code (e.g. +91 98765 43210)
                </p>
              )}

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px" style={{background:'rgba(255,255,255,0.12)'}} />
                <span className="text-xs text-on-surface-variant shrink-0">or</span>
                <div className="flex-1 h-px" style={{background:'rgba(255,255,255,0.12)'}} />
              </div>

              {/* Email field */}
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                  placeholder="Email address  e.g. name@example.com"
                  className={`w-full px-5 py-3.5 pr-10 rounded-full bg-surface-container border text-on-surface placeholder:text-on-surface-variant text-sm outline-none transition-colors ${emailBorder}`}
                />
                {emailOk && (
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500 font-bold text-sm">✓</span>
                )}
              </div>
              {showEmailError && (
                <p className="text-xs text-red-400 text-left pl-4 pb-1">
                  Enter a valid email address (e.g. name@example.com)
                </p>
              )}

              {/* Hint when both fields are empty */}
              {!mobileVal && !email && (
                <p className="text-xs text-on-surface-variant text-left pl-4 pt-1">
                  You must enter a valid mobile number or email address.
                </p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={restoring || !canProceed}
              className="w-full py-4 bg-primary-container text-on-primary-container font-bold rounded-full transition-all glow-primary btn-3d disabled:opacity-50 disabled:cursor-not-allowed mb-6"
            >
              {restoring ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
                  Restoring your voice…
                </span>
              ) : (
                "Get Started — It's free for limited time"
              )}
            </button>

            <div className="flex items-center justify-center gap-4 text-xs text-on-surface-variant flex-wrap">
              <span className="flex items-center gap-1"><span className="text-secondary">✓</span> No password</span>
              <span className="flex items-center gap-1"><span className="text-secondary">✓</span> 2 minutes</span>
              <span className="flex items-center gap-1"><span className="text-secondary">✓</span> 15 stories</span>
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}
