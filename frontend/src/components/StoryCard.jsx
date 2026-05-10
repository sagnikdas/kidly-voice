export default function StoryCard({ story, hasPlayed, loading, onPlayClick, featured }) {
  const EMOJI_BG = {
    kindness: 'from-rose-900 to-pink-900',
    courage: 'from-blue-900 to-indigo-900',
    friendship: 'from-purple-900 to-violet-900',
    gratitude: 'from-amber-900 to-yellow-900',
    generosity: 'from-green-900 to-emerald-900',
    bravery: 'from-sky-900 to-blue-900',
    perseverance: 'from-orange-900 to-amber-900',
    helpfulness: 'from-teal-900 to-cyan-900',
    empathy: 'from-rose-900 to-red-900',
    creativity: 'from-violet-900 to-purple-900',
    love: 'from-red-900 to-rose-900',
    'self-worth': 'from-yellow-900 to-amber-900',
    responsibility: 'from-emerald-900 to-teal-900',
    comfort: 'from-sky-900 to-cyan-900',
  }
  const bg = EMOJI_BG[story.moral] || 'from-surface-container to-surface-container-highest'

  if (featured) {
    return (
      <div onClick={() => !loading && onPlayClick(story)}
        className="relative overflow-hidden rounded-xl bg-surface-container-high cursor-pointer transition-transform active:scale-[0.99] border-b-4 border-primary-container/20"
        style={{boxShadow: '0 4px 24px rgba(0,0,0,0.4)'}}>
        <div className={`w-full h-48 bg-gradient-to-br ${bg} flex items-center justify-center`}>
          <span className="text-[80px]">{story.emoji}</span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-6">
          <span className="text-primary-container text-xs font-bold uppercase tracking-widest mb-1">Featured Story</span>
          <h2 className="text-xl font-bold text-primary mb-3">{story.title}</h2>
          <div className="flex items-center gap-4">
            {loading ? (
              <div className="w-14 h-14 bg-primary-container rounded-full flex items-center justify-center">
                <span className="w-6 h-6 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="w-14 h-14 bg-primary-container rounded-full flex items-center justify-center" style={{boxShadow:'0 4px 15px rgba(255,214,0,0.5)'}}>
                <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:32}}>
                  {hasPlayed ? 'replay' : 'play_arrow'}
                </span>
              </div>
            )}
            <span className="text-sm text-primary font-medium">{story.subtitle}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div onClick={() => !loading && onPlayClick(story)}
      className={`relative overflow-hidden rounded-xl bg-surface-container-high cursor-pointer transition-transform active:scale-[0.98] border-b-4 ${hasPlayed ? 'border-secondary-container/40' : 'border-surface-container-highest'}`}
      style={{boxShadow: '0 2px 12px rgba(0,0,0,0.3)'}}>
      <div className={`w-full h-36 bg-gradient-to-br ${bg} flex items-center justify-center`}>
        <span className="text-[56px]">{story.emoji}</span>
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent flex flex-col justify-end p-4">
        <h3 className="text-sm font-bold text-primary mb-1 leading-tight">{story.title}</h3>
        <p className="text-xs text-on-surface-variant line-clamp-1 mb-3">{story.subtitle}</p>
        <div className="flex items-center justify-between">
          {loading ? (
            <div className="w-10 h-10 bg-primary-container rounded-full flex items-center justify-center">
              <span className="w-4 h-4 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasPlayed ? 'bg-secondary-container' : 'bg-primary-container'}`}>
              <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:20}}>
                {hasPlayed ? 'replay' : 'play_arrow'}
              </span>
            </div>
          )}
          {hasPlayed && <span className="text-xs text-secondary-fixed font-bold">✓ Played</span>}
        </div>
      </div>
    </div>
  )
}
