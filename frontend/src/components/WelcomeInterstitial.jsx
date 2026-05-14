export default function WelcomeInterstitial({ email, onGetStarted }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-8">

        <div className="space-y-2">
          <div className="text-7xl">🌙</div>
          <h1 className="text-3xl font-extrabold text-primary-container tracking-tight">Welcome to Kidly</h1>
          {email && (
            <p className="text-sm text-on-surface-variant truncate">{email}</p>
          )}
        </div>

        <p className="text-on-surface-variant text-base leading-relaxed">
          You're 2 minutes away from hearing <strong className="text-on-surface">15 bedtime stories</strong> in your own voice.
        </p>

        <div className="space-y-3 text-left">
          {[
            { n: '1', emoji: '🎙️', label: 'Record your voice', desc: 'Read one minute of any text aloud' },
            { n: '2', emoji: '🧠', label: 'We clone it',       desc: 'AI learns your unique voice instantly' },
            { n: '3', emoji: '📖', label: 'Stories are ready', desc: '15 tales narrated in your voice, tonight' },
          ].map(({ n, emoji, label, desc }) => (
            <div key={n} className="flex items-start gap-4 bg-surface-container rounded-xl px-4 py-3">
              <div className="text-2xl shrink-0">{emoji}</div>
              <div>
                <p className="text-sm font-semibold text-on-surface">{label}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onGetStarted}
          className="w-full py-4 bg-primary-container text-on-primary-container font-bold rounded-full transition-all glow-primary btn-3d"
        >
          Record my voice →
        </button>

        <p className="text-xs text-on-surface-variant">Free during early access · No credit card needed</p>
      </div>
    </div>
  )
}
