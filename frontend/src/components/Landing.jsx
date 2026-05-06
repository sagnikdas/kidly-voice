export default function Landing({ email, setEmail, onStart }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      {/* Hero */}
      <div className="text-center max-w-xl w-full">
        <div className="text-7xl mb-6 select-none">🌙</div>
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4 leading-tight">
          Hear bedtime stories<br />
          <span className="text-orange-500">in your own voice</span>
        </h1>
        <p className="text-lg text-gray-500 mb-10 leading-relaxed">
          Record your voice once. Kidly narrates 15 beautiful children's stories
          in your words — so your little one hears <em>you</em>, even when you're not there.
        </p>

        {/* Email input */}
        <div className="mb-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onStart()}
            placeholder="Your email (optional — to save your voice)"
            className="w-full px-5 py-3 rounded-2xl border-2 border-amber-200 focus:border-orange-400 outline-none text-gray-700 bg-white text-base"
          />
          <p className="text-xs text-gray-400 mt-1.5 text-left pl-1">
            Enter your email to restore your voice model when you come back later
          </p>
        </div>

        {/* CTA */}
        <button
          onClick={onStart}
          className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-white text-lg font-semibold rounded-2xl transition-colors shadow-lg shadow-orange-100"
        >
          Get started — it's free →
        </button>

        {/* Trust signals */}
        <div className="flex items-center justify-center gap-6 mt-8 text-sm text-gray-400 flex-wrap">
          <span>✓ No account needed</span>
          <span>✓ Takes 2 minutes</span>
          <span>✓ 15 stories ready</span>
        </div>
      </div>

      {/* Feature cards */}
      <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-2xl w-full">
        {[
          {
            icon: '🎙️',
            title: 'Record once',
            desc: 'Read a short passage aloud — 60 seconds is all it takes to clone your voice.',
          },
          {
            icon: '✨',
            title: 'Instant magic',
            desc: 'AI voice technology creates a private voice model that sounds just like you — ready in under a minute.',
          },
          {
            icon: '📖',
            title: '15 stories',
            desc: 'Pick any story and hear it in your voice. Replays are instant and free.',
          },
        ].map((f) => (
          <div
            key={f.title}
            className="bg-white rounded-2xl p-6 text-center border border-amber-100 shadow-sm"
          >
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="font-semibold text-gray-800 mb-2">{f.title}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
