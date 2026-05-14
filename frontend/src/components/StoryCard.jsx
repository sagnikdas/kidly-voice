const MORAL_BG = {
  kindness:       'from-rose-950 to-pink-900',
  courage:        'from-blue-950 to-indigo-900',
  friendship:     'from-purple-950 to-violet-900',
  gratitude:      'from-amber-950 to-yellow-900',
  generosity:     'from-green-950 to-emerald-900',
  bravery:        'from-sky-950 to-blue-900',
  perseverance:   'from-orange-950 to-amber-900',
  helpfulness:    'from-teal-950 to-cyan-900',
  empathy:        'from-rose-950 to-red-900',
  creativity:     'from-violet-950 to-purple-900',
  love:           'from-red-950 to-rose-900',
  'self-worth':   'from-yellow-950 to-amber-900',
  responsibility: 'from-emerald-950 to-teal-900',
  comfort:        'from-sky-950 to-cyan-900',
}

export default function StoryCard({ story, hasPlayed, loading, isCached, onPlayClick, isSelected, animStyle }) {
  const bg = MORAL_BG[story.moral] || 'from-surface-container to-surface-container-high'

  return (
    <div
      onClick={() => !loading && onPlayClick(story)}
      className={`overflow-hidden rounded-2xl bg-surface-container-high cursor-pointer transition-all active:scale-[0.97] border-2 md-ripple ${
        isSelected ? 'border-primary-container' : 'border-transparent hover:border-outline-variant/30'
      }`}
      style={{
        boxShadow: isSelected
          ? '0 0 0 3px rgba(255,214,0,0.25), 0 4px 20px rgba(0,0,0,0.5)'
          : '0 2px 12px rgba(0,0,0,0.35)',
        ...animStyle,
      }}
    >
      {/* Emoji tile */}
      <div className={`h-24 bg-gradient-to-br ${bg} flex items-end justify-end p-3 relative`}>
        {isCached && !loading && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/40 backdrop-blur-sm px-1.5 py-0.5 rounded-full">
            <span className="text-[10px] leading-none">⚡</span>
            <span className="text-[9px] font-bold text-white/90 uppercase tracking-wide">Ready</span>
          </div>
        )}
        <span className="text-[52px] leading-none select-none drop-shadow-lg">{story.emoji}</span>
      </div>

      {/* Text + play */}
      <div className="p-3">
        <h3 className="text-sm font-bold text-primary leading-snug mb-0.5 line-clamp-2">{story.title}</h3>
        <p className="text-xs text-on-surface-variant line-clamp-1 mb-3">{story.subtitle}</p>

        <div className="flex items-center justify-between">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              loading ? 'bg-surface-container' : hasPlayed ? 'bg-secondary-container' : 'bg-primary-container'
            }`}
            style={!loading && !hasPlayed ? {boxShadow:'0 2px 8px rgba(255,214,0,0.4)'} : {}}
          >
            {loading ? (
              <span className="w-3.5 h-3.5 border-2 border-on-surface-variant border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:16}}>
                {hasPlayed ? 'replay' : 'play_arrow'}
              </span>
            )}
          </div>
          {hasPlayed && (
            <span className="text-[10px] text-secondary-fixed font-bold uppercase tracking-wide">✓ Played</span>
          )}
        </div>
      </div>
    </div>
  )
}
