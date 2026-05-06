const MORAL_COLORS = {
  kindness:       'bg-pink-50 text-pink-600 border-pink-100',
  courage:        'bg-blue-50 text-blue-600 border-blue-100',
  friendship:     'bg-purple-50 text-purple-600 border-purple-100',
  gratitude:      'bg-amber-50 text-amber-600 border-amber-100',
  generosity:     'bg-green-50 text-green-600 border-green-100',
  bravery:        'bg-indigo-50 text-indigo-600 border-indigo-100',
  perseverance:   'bg-orange-50 text-orange-600 border-orange-100',
  helpfulness:    'bg-teal-50 text-teal-600 border-teal-100',
  empathy:        'bg-rose-50 text-rose-600 border-rose-100',
  creativity:     'bg-violet-50 text-violet-600 border-violet-100',
  love:           'bg-red-50 text-red-500 border-red-100',
  'self-worth':   'bg-yellow-50 text-yellow-600 border-yellow-100',
  responsibility: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  comfort:        'bg-sky-50 text-sky-600 border-sky-100',
}

export default function StoryCard({ story, hasPlayed, loading, onPlayClick, listMode }) {
  const moralColor = MORAL_COLORS[story.moral] || 'bg-gray-50 text-gray-500 border-gray-100'

  const playBtn = (
    <button
      onClick={() => onPlayClick(story)}
      disabled={loading}
      className={`shrink-0 font-semibold rounded-xl transition-colors text-sm ${
        loading
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed px-4 py-2'
          : hasPlayed
          ? 'bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 px-4 py-2'
          : 'bg-orange-500 hover:bg-orange-600 text-white px-4 py-2'
      }`}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-orange-300 border-t-orange-600 rounded-full animate-spin block" />
      ) : hasPlayed ? (
        '▶ Play again'
      ) : (
        '▶ Play'
      )}
    </button>
  )

  if (listMode) {
    return (
      <div
        className={`flex items-center gap-4 bg-white px-4 py-3 rounded-xl border shadow-sm hover:shadow-md transition-shadow ${
          hasPlayed ? 'border-green-200' : 'border-gray-100'
        }`}
      >
        <span className="text-2xl shrink-0">{story.emoji}</span>

        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-800 text-sm truncate">{story.title}</h3>
          <p className="text-gray-400 text-xs truncate mt-0.5">{story.subtitle}</p>
        </div>

        <span className={`hidden sm:inline text-xs font-medium px-2 py-0.5 rounded-full border shrink-0 ${moralColor}`}>
          {story.moral}
        </span>

        <span className="hidden md:inline text-xs text-gray-300 shrink-0">Ages {story.ageRange}</span>

        {hasPlayed && (
          <span className="text-green-500 text-xs font-semibold shrink-0">✓</span>
        )}

        {playBtn}
      </div>
    )
  }

  // Grid card
  return (
    <div
      className={`bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-3 hover:shadow-md transition-shadow border ${
        hasPlayed ? 'border-green-200' : 'border-gray-100'
      }`}
    >
      <div className="flex items-start justify-between">
        <span className="text-3xl leading-none">{story.emoji}</span>
        <div className="flex items-center gap-1.5">
          {hasPlayed && (
            <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded-full">
              ✓
            </span>
          )}
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${moralColor}`}>
            {story.moral}
          </span>
        </div>
      </div>

      <div className="flex-1">
        <h3 className="font-bold text-gray-800 text-sm leading-snug min-h-[2.5rem]">{story.title}</h3>
        <p className="text-gray-400 text-xs mt-0.5 leading-tight">{story.subtitle}</p>
      </div>

      <p className="text-xs text-gray-300">Ages {story.ageRange}</p>

      <button
        onClick={() => onPlayClick(story)}
        disabled={loading}
        className={`w-full py-2 rounded-xl text-sm font-semibold transition-colors ${
          loading
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : hasPlayed
            ? 'bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200'
            : 'bg-orange-500 hover:bg-orange-600 text-white'
        }`}
      >
        {loading ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <span className="w-3 h-3 border-2 border-orange-300 border-t-orange-600 rounded-full animate-spin" />
            Loading…
          </span>
        ) : hasPlayed ? (
          '▶ Play Again'
        ) : (
          '▶ Play in My Voice'
        )}
      </button>
    </div>
  )
}
