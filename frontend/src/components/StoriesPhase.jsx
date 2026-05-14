import { useState, useEffect, useMemo } from 'react'
import StoryCard from './StoryCard'
import StoryReader from './StoryReader'
import { STORIES } from '../data/stories'
import { haptic } from '../utils/haptic'
import { useOS } from '../utils/os'

const MOODS = [
  { id: 'all',       emoji: '🌟', label: 'All',       desc: `${STORIES.length} stories`, gradient: 'from-zinc-800 to-zinc-700',          morals: null },
  { id: 'cozy',      emoji: '😴', label: 'Cozy',      desc: 'Calm & dreamy',              gradient: 'from-sky-950 to-blue-900',           morals: ['comfort', 'love', 'gratitude'] },
  { id: 'brave',     emoji: '⚔️', label: 'Brave',     desc: 'Bold adventures',            gradient: 'from-amber-950 to-orange-900',       morals: ['courage', 'bravery', 'perseverance', 'responsibility'] },
  { id: 'animals',   emoji: '🐾', label: 'Animals',   desc: 'Furry friends',              gradient: 'from-green-950 to-emerald-900',      morals: ['kindness', 'friendship', 'helpfulness', 'empathy'] },
  { id: 'heartfelt', emoji: '✨', label: 'Heartfelt', desc: 'Big feelings',               gradient: 'from-violet-950 to-purple-900',      morals: ['creativity', 'self-worth', 'generosity'] },
]

function updateStreak() {
  const today = new Date().toISOString().slice(0, 10)
  const last = localStorage.getItem('kidly_streak_last_date')
  if (last === today) return parseInt(localStorage.getItem('kidly_streak_count') || '1', 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const current = parseInt(localStorage.getItem('kidly_streak_count') || '0', 10)
  const next = last === yesterday ? current + 1 : 1
  localStorage.setItem('kidly_streak_count', String(next))
  localStorage.setItem('kidly_streak_last_date', today)
  return next
}

export default function StoriesPhase({ voiceId, sessionToken, userDisplay, onReRecord, onLogout, onOpenSettings, voiceJustCreated, onToastDismissed, initialProgress }) {
  const os = useOS()
  const [playedKeys, setPlayedKeys] = useState(() => {
    try { const s = localStorage.getItem(`kidly_played_${voiceId}`); return new Set(s ? JSON.parse(s) : []) }
    catch { return new Set() }
  })
  const [cachedKeys, setCachedKeys] = useState(() => {
    try { const s = localStorage.getItem(`kidly_cached_${voiceId}`); return new Set(s ? JSON.parse(s) : []) }
    catch { return new Set() }
  })
  const [cachedChecked, setCachedChecked] = useState(false)
  const [preloadDone, setPreloadDone] = useState(false)
  const [audioCache, setAudioCache] = useState({})       // `${voiceId}:${story.key}` → { audioUrl, text }
  const [loadingKey, setLoadingKey] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [readerState, setReaderState] = useState(null)   // { title, emoji, text, audioUrl }
  const [activeMood, setActiveMood] = useState('all')
  const [streak, setStreak] = useState(() => parseInt(localStorage.getItem('kidly_streak_count') || '0', 10))


  // Toast
  const [showToast, setShowToast] = useState(voiceJustCreated)

  const filteredStories = useMemo(() => {
    const mood = MOODS.find(m => m.id === activeMood)
    if (!mood?.morals) return STORIES
    return STORIES.filter(s => mood.morals.includes(s.moral))
  }, [activeMood])

  // When voiceId changes, reload persisted state for the new voice
  useEffect(() => {
    try { const s = localStorage.getItem(`kidly_played_${voiceId}`); setPlayedKeys(new Set(s ? JSON.parse(s) : [])) }
    catch { setPlayedKeys(new Set()) }
    try { const s = localStorage.getItem(`kidly_cached_${voiceId}`); setCachedKeys(new Set(s ? JSON.parse(s) : [])) }
    catch { setCachedKeys(new Set()) }
    setCachedChecked(false)
    setPreloadDone(false)
    setAudioCache({})
    setReaderState(null)
    setLoadError('')
  }, [voiceId])

  // Persist played + cached keys to localStorage whenever they change
  useEffect(() => {
    if (!voiceId) return
    localStorage.setItem(`kidly_played_${voiceId}`, JSON.stringify([...playedKeys]))
  }, [playedKeys, voiceId])

  useEffect(() => {
    if (!voiceId) return
    localStorage.setItem(`kidly_cached_${voiceId}`, JSON.stringify([...cachedKeys]))
  }, [cachedKeys, voiceId])

  // On mount, fetch ground-truth cached list from server (catches stories cached on another device).
  useEffect(() => {
    if (!voiceId || !sessionToken) return
    fetch(`/api/stories/cached?voice_id=${encodeURIComponent(voiceId)}&session_token=${encodeURIComponent(sessionToken)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.cached) setCachedKeys(new Set(data.cached)) })
      .catch(() => {})
      .finally(() => setCachedChecked(true))
  }, [voiceId, sessionToken])

  // Poll preload-status while background generation is running, updating ⚡ badges live.
  useEffect(() => {
    if (!voiceId || !sessionToken) return
    let cancelled = false
    let timer

    const ensurePreload = () => {
      fetch('/api/stories/preload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, session_token: sessionToken }),
      }).catch(() => {})
    }

    const refreshCached = async () => {
      const r2 = await fetch(`/api/stories/cached?voice_id=${encodeURIComponent(voiceId)}&session_token=${encodeURIComponent(sessionToken)}`)
      if (r2.ok && !cancelled) {
        const data = await r2.json()
        if (data?.cached) setCachedKeys(new Set(data.cached))
      }
    }

    const check = async () => {
      if (cancelled) return
      try {
        const r = await fetch(`/api/stories/preload-status?voice_id=${encodeURIComponent(voiceId)}&session_token=${encodeURIComponent(sessionToken)}`)
        if (!r.ok || cancelled) return
        const status = await r.json()
        await refreshCached()
        if (status.done) {
          setPreloadDone(true)
          return
        }
        // Preload not done — ensure task is running (safe if already running)
        ensurePreload()
        if (!cancelled) timer = setTimeout(check, 15000)
      } catch {}
    }

    timer = setTimeout(check, 8000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [voiceId, sessionToken])

  useEffect(() => {
    if (!voiceJustCreated) return
    const t = setTimeout(() => { setShowToast(false); onToastDismissed?.() }, 5000)
    return () => clearTimeout(t)
  }, [voiceJustCreated, onToastDismissed])

  // Merge server-side progress (streak + played keys) with local state.
  // Server wins when its date is newer or streak is longer; played keys are unioned.
  useEffect(() => {
    if (!initialProgress) return
    const { streak_count, streak_last_date, played_keys } = initialProgress

    if (streak_count !== null && streak_last_date) {
      const localDate  = localStorage.getItem('kidly_streak_last_date') || ''
      const localCount = parseInt(localStorage.getItem('kidly_streak_count') || '0', 10)
      const serverWins = streak_last_date > localDate ||
        (streak_last_date === localDate && streak_count > localCount)
      if (serverWins) {
        localStorage.setItem('kidly_streak_count', String(streak_count))
        localStorage.setItem('kidly_streak_last_date', streak_last_date)
        setStreak(streak_count)
      }
    }

    if (played_keys?.length) {
      setPlayedKeys(prev => {
        const merged = new Set([...prev, ...played_keys])
        localStorage.setItem(`kidly_played_${voiceId}`, JSON.stringify([...merged]))
        return merged
      })
    }
  }, [initialProgress]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismissToast = () => { setShowToast(false); onToastDismissed?.() }

  // Persist streak + played progress to server (fire-and-forget)
  const saveProgressToServer = (newStreak, newPlayedKeys) => {
    if (!sessionToken) return
    const date = localStorage.getItem('kidly_streak_last_date') || ''
    fetch('/api/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_token: sessionToken,
        streak_count: newStreak,
        streak_last_date: date,
        played_keys: [...newPlayedKeys],
      }),
    }).catch(() => {})
  }

  const handlePlayClick = async (story) => {
    haptic.medium()
    if (!voiceId) { setLoadError('No voice found — please re-record.'); return }

    const cacheKey = `${voiceId}:${story.key}`

    if (audioCache[cacheKey]) {
      setReaderState({ title: story.title, emoji: story.emoji, ...audioCache[cacheKey] })
      const newStreak = updateStreak()
      setStreak(newStreak)
      setPlayedKeys(prev => { saveProgressToServer(newStreak, prev); return prev })
      return
    }

    setLoadingKey(story.key)
    setLoadError('')
    try {
      const r = await fetch('/api/stories/speak-timestamped', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, story_key: story.key, session_token: sessionToken }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Failed to load story')
      }
      const { audio_url, story_text } = await r.json()
      const entry = { audioUrl: audio_url, text: story_text }
      setAudioCache(prev => ({ ...prev, [cacheKey]: entry }))
      const newStreak = updateStreak()
      setStreak(newStreak)
      setPlayedKeys(prev => {
        const next = new Set([...prev, story.key])
        saveProgressToServer(newStreak, next)
        return next
      })
      setCachedKeys(prev => new Set([...prev, story.key]))
      setReaderState({ title: story.title, emoji: story.emoji, ...entry })
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setLoadingKey(null)
    }
  }


  return (
    <>
      {/* Story reader overlay */}
      {readerState && (
        <StoryReader
          title={readerState.title}
          emoji={readerState.emoji}
          text={readerState.text}
          audioUrl={readerState.audioUrl}
          onClose={() => setReaderState(null)}
          onOpenSettings={onOpenSettings}
        />
      )}

      {/* Voice-ready toast */}
      {showToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-secondary-container text-on-secondary-container px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold">
          <span>🎉 Your voice is ready! Pick a story below.</span>
          <button onClick={dismissToast} className="hover:text-on-surface ml-1">✕</button>
        </div>
      )}

      <div className="min-h-screen bg-background text-on-surface" style={{paddingBottom:'calc(100px + var(--sab))'}}>
        {/* Top bar — iOS: centered title; Android/web: left-aligned */}
        <header className="fixed top-0 w-full z-50 flex items-center justify-between px-6 bg-surface border-b border-outline-variant/20 h-header safe-top relative">
          {os === 'ios' ? (
            <>
              {/* iOS: settings icon on left, centered brand, user/logout on right */}
              <button onClick={onOpenSettings}
                className="flex items-center justify-center text-primary-container active:opacity-60 shrink-0 min-w-[44px] min-h-[44px]">
                <span className="material-symbols-outlined" style={{fontSize:22}}>settings</span>
              </button>
              <span className="absolute left-1/2 -translate-x-1/2 text-lg font-bold text-primary-container pointer-events-none">Kidly</span>
              <div className="flex items-center gap-2 min-w-0">
                {userDisplay && (
                  <span className="text-xs text-primary-container truncate max-w-[100px]">{userDisplay}</span>
                )}
                <button onClick={onLogout}
                  className="flex items-center justify-center text-primary-container active:opacity-60 shrink-0 min-w-[44px] min-h-[44px]">
                  <span className="material-symbols-outlined" style={{fontSize:20}}>logout</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Android / web: brand on left, actions on right */}
              <span className="text-lg font-bold text-primary-container">Kidly</span>
              <div className="flex items-center gap-3 min-w-0">
                {userDisplay && (
                  <span className="text-xs text-primary-container truncate max-w-[140px]">{userDisplay}</span>
                )}
                <button onClick={onLogout}
                  className="flex items-center gap-1 text-xs text-primary-container active:opacity-70 transition-opacity shrink-0 min-h-[44px] px-2">
                  <span className="material-symbols-outlined" style={{fontSize:14}}>logout</span>
                  Logout
                </button>
                <button onClick={onOpenSettings}
                  className="flex items-center justify-center text-primary-container active:opacity-70 transition-opacity shrink-0 min-w-[44px] min-h-[44px]">
                  <span className="material-symbols-outlined" style={{fontSize:22}}>settings</span>
                </button>
              </div>
            </>
          )}
        </header>

        <main className="max-w-[800px] mx-auto px-6 pt-header">
          {/* Mascot greeting + streak */}
          <div className="flex items-center gap-4 mb-6 bg-surface-container-low p-5 rounded-xl border-b-4 border-surface-container-highest">
            <div className="text-5xl shrink-0">🦉</div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-primary-fixed mb-0.5">Hoo-hoo! Ready for a story?</h1>
              <p className="text-sm text-on-surface-variant">Pick a magical world to start tonight's adventure!</p>
            </div>
            {streak >= 1 && (
              <div className="shrink-0 flex flex-col items-center bg-surface-container rounded-xl px-3 py-2 border border-outline-variant/20">
                <span className="text-xl">🔥</span>
                <span className="text-sm font-extrabold text-primary-fixed leading-tight">{streak}</span>
                <span className="text-[10px] text-on-surface-variant leading-tight">night{streak !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Error banner */}
          {loadError && (
            <div className="mb-4 bg-error-container/20 border border-error/30 rounded-xl px-4 py-3 text-error text-sm flex items-center justify-between">
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} className="ml-4 text-error hover:text-on-surface">✕</button>
            </div>
          )}

          {/* Mood picker */}
          <div className="mb-6 flex gap-2">
            {MOODS.map((mood, i) => {
              const count = mood.morals
                ? STORIES.filter(s => mood.morals.includes(s.moral)).length
                : STORIES.length
              const active = activeMood === mood.id
              return (
                <button
                  key={mood.id}
                  onClick={() => { haptic.select(); setActiveMood(mood.id) }}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl transition-all bg-gradient-to-br ${mood.gradient} md-ripple ${
                    active ? 'ring-2 ring-primary-container scale-[1.03]' : 'opacity-55 hover:opacity-80'
                  }`}
                  style={{
                    animation: `staggerIn 0.35s ease-out ${i * 0.05}s both`,
                    boxShadow: active
                      ? '0 0 18px rgba(255,214,0,0.35), 0 4px 12px rgba(0,0,0,0.5)'
                      : '0 2px 8px rgba(0,0,0,0.4)',
                  }}
                >
                  <span className="text-xl">{mood.emoji}</span>
                  <span className="text-xs font-bold text-white leading-tight">{mood.label}</span>
                  <span className="text-[10px] text-white/60">{count}</span>
                </button>
              )
            })}
          </div>

          {/* Story generation progress */}
          {!preloadDone && cachedChecked && cachedKeys.size < STORIES.length && (
            <div className="mb-4 flex items-center gap-2.5 bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-2.5">
              <span className="w-3 h-3 border-2 border-on-surface-variant/30 border-t-on-surface-variant rounded-full animate-spin shrink-0" />
              <span className="text-xs text-on-surface-variant">
                Generating your stories — <strong className="text-on-surface">{cachedKeys.size} of {STORIES.length}</strong> ready
              </span>
            </div>
          )}

          {/* Stories grid — re-keyed on mood change so cards stagger in on filter switch */}
          <div key={activeMood} className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {filteredStories.map((story, i) => (
              <StoryCard
                key={story.key}
                story={story}
                hasPlayed={playedKeys.has(story.key)}
                loading={loadingKey === story.key}
                isCached={cachedKeys.has(story.key)}
                onPlayClick={s => { haptic.medium(); handlePlayClick(s) }}
                isSelected={loadingKey === story.key}
                animStyle={{animation: `staggerIn 0.3s ease-out ${i * 0.04}s both`}}
              />
            ))}
          </div>

        </main>

        {/* Generating banner */}
        {loadingKey && (() => {
          const s = STORIES.find(s => s.key === loadingKey)
          return (
            <div className="fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-5 py-3 rounded-2xl shadow-xl text-on-primary-container"
                 style={{bottom:'calc(24px + var(--sab))', background:'var(--color-primary-container, #ffd600)', boxShadow:'0 4px 20px rgba(255,214,0,0.4)'}}>
              <span className="w-4 h-4 border-2 border-on-primary-container/50 border-t-on-primary-container rounded-full animate-spin shrink-0" />
              <div className="text-left">
                <p className="text-sm font-bold leading-tight">
                  {cachedKeys.has(s?.key) ? 'Loading story…' : 'Generating in your voice…'}
                </p>
                <p className="text-xs opacity-70 leading-tight mt-0.5">
                  {s?.emoji} {s?.title}{!cachedKeys.has(s?.key) && ' · 30–60 sec'}
                </p>
              </div>
            </div>
          )
        })()}


      </div>
    </>
  )
}
