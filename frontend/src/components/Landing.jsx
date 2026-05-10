export default function Landing({ email, setEmail, onStart, restoring }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 md:p-8">
      <main className="flex flex-col md:flex-row w-full max-w-[900px] min-h-[540px] overflow-hidden rounded-[2rem] bg-surface-container-low shadow-2xl">
        {/* Left panel — decorative */}
        <div className="relative w-full md:w-1/2 min-h-[220px] md:min-h-full bg-gradient-to-br from-surface to-surface-container-high flex flex-col items-center justify-center overflow-hidden">
          <div className="text-center select-none">
            <div className="text-[100px] leading-none mb-2">🔥</div>
            <div className="text-5xl">⭐ 🦉 ✨</div>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent pointer-events-none" />
          <div className="absolute bottom-5 left-5 flex items-center gap-2 text-primary-container">
            <span className="material-symbols-outlined ms-fill text-lg">auto_awesome</span>
            <span className="text-xs font-bold uppercase tracking-widest">Magic Awaits</span>
          </div>
        </div>

        {/* Right panel — form */}
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center p-8 md:p-10 bg-surface">
          {/* Logo */}
          <div className="flex flex-col items-center gap-2 mb-8">
            <div className="p-3 rounded-full bg-primary-container" style={{ boxShadow: '0 0 15px rgba(255,214,0,0.4)' }}>
              <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{ fontSize: 40 }}>fireplace</span>
            </div>
            <h1 className="text-3xl font-bold text-primary-container tracking-tight">Kidly</h1>
          </div>

          <div className="w-full max-w-[340px] flex flex-col items-center text-center">
            <h2 className="text-xl font-semibold text-on-surface mb-2">Welcome, Storyteller</h2>
            <p className="text-sm text-on-surface-variant mb-8 leading-relaxed">
              Record your voice once. Kidly narrates 15 bedtime stories so your child hears <em>you</em>.
            </p>

            <div className="w-full mb-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onStart()}
                placeholder="Your email (optional — saves your voice)"
                className="w-full px-5 py-3.5 rounded-full bg-surface-container border border-outline-variant text-on-surface placeholder:text-on-surface-variant text-sm outline-none focus:border-primary-container transition-colors"
              />
              <p className="text-xs text-on-surface-variant mt-1.5 text-left pl-2">Enter email to restore your voice on any device</p>
            </div>

            <button
              onClick={onStart}
              disabled={restoring}
              className="w-full py-4 bg-primary-container text-on-primary-container font-bold rounded-full transition-all glow-primary btn-3d disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {restoring ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
                  Restoring your voice…
                </span>
              ) : (
                "Get started — it's free →"
              )}
            </button>

            <div className="flex items-center justify-center gap-4 mt-6 text-xs text-on-surface-variant flex-wrap">
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
