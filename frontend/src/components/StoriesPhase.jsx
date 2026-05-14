import { useState, useEffect } from 'react'
import StoryCard from './StoryCard'
import StoryReader from './StoryReader'
import { STORIES } from '../data/stories'

const CATEGORIES = ['All', '🌙 Bedtime', '⚔️ Adventure', '🐾 Animals', '✨ Heartfelt']
const CATEGORY_MORALS = {
  '🌙 Bedtime': ['comfort', 'love', 'gratitude'],
  '⚔️ Adventure': ['courage', 'bravery', 'perseverance', 'responsibility'],
  '🐾 Animals': ['kindness', 'friendship', 'helpfulness', 'empathy'],
  '✨ Heartfelt': ['creativity', 'self-worth', 'generosity'],
}


export default function StoriesPhase({ voiceId, sessionToken, isDemo, email, setEmail, userDisplay, onReRecord, onLogout, onOpenSettings, voiceJustCreated, onToastDismissed }) {
  const [playedKeys, setPlayedKeys] = useState(() => {
    try { const s = localStorage.getItem(`kidly_played_${voiceId}`); return new Set(s ? JSON.parse(s) : []) }
    catch { return new Set() }
  })
  const [cachedKeys, setCachedKeys] = useState(() => {
    try { const s = localStorage.getItem(`kidly_cached_${voiceId}`); return new Set(s ? JSON.parse(s) : []) }
    catch { return new Set() }
  })
  const [cachedChecked, setCachedChecked] = useState(false) // true after first server fetch; gates the progress banner
  const [audioCache, setAudioCache] = useState({})       // `${voiceId}:${story.key}` → { audioUrl, text }
  const [loadingKey, setLoadingKey] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [readerState, setReaderState] = useState(null)   // { title, text, audioUrl }

  // Feedback state
  const [feedbackEmail, setFeedbackEmail] = useState(email || '')
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [submitted, setSubmitted] = useState(() => !!localStorage.getItem('kidly_feedback_submitted'))
  const [submitting, setSubmitting] = useState(false)

  // Toast
  const [showToast, setShowToast] = useState(voiceJustCreated)

  // Category filter
  const [activeCategory, setActiveCategory] = useState('All')
  const filteredStories = activeCategory === 'All' ? STORIES : STORIES.filter(s => CATEGORY_MORALS[activeCategory]?.includes(s.moral))

  // When voiceId changes, reload persisted state for the new voice
  useEffect(() => {
    try { const s = localStorage.getItem(`kidly_played_${voiceId}`); setPlayedKeys(new Set(s ? JSON.parse(s) : [])) }
    catch { setPlayedKeys(new Set()) }
    try { const s = localStorage.getItem(`kidly_cached_${voiceId}`); setCachedKeys(new Set(s ? JSON.parse(s) : [])) }
    catch { setCachedKeys(new Set()) }
    setCachedChecked(false)
    setAudioCache({})
    setReaderState(null)
    setLoadError('')
    setSelectedKey(null)
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
  // Sets cachedChecked=true so the progress banner only appears after we know the real count.
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
    const check = async () => {
      if (cancelled) return
      try {
        const r = await fetch(`/api/stories/preload-status?voice_id=${encodeURIComponent(voiceId)}`)
        if (!r.ok || cancelled) return
        const status = await r.json()
        const r2 = await fetch(`/api/stories/cached?voice_id=${encodeURIComponent(voiceId)}&session_token=${encodeURIComponent(sessionToken)}`)
        if (r2.ok && !cancelled) {
          const data = await r2.json()
          if (data?.cached) setCachedKeys(new Set(data.cached))
        }
        if (!status.done && !cancelled) timer = setTimeout(check, 15000)
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

  const dismissToast = () => { setShowToast(false); onToastDismissed?.() }

  const handlePlayClick = async (story) => {
    if (!voiceId) { setLoadError('No voice found — please re-record.'); return }

    const cacheKey = `${voiceId}:${story.key}`

    // Serve from in-session cache — no network call needed.
    if (audioCache[cacheKey]) {
      setReaderState({ title: story.title, emoji: story.emoji, ...audioCache[cacheKey] })
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
      setPlayedKeys(prev => new Set([...prev, story.key]))
      setCachedKeys(prev => new Set([...prev, story.key]))
      setReaderState({ title: story.title, emoji: story.emoji, ...entry })
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setLoadingKey(null)
    }
  }

  const handleSubmit = async () => {
    if (!feedbackEmail && !feedbackMsg) return
    setSubmitting(true)
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: feedbackEmail, message: feedbackMsg }),
      })
      if (feedbackEmail) setEmail(feedbackEmail)
      localStorage.setItem('kidly_feedback_submitted', '1')
      setSubmitted(true)
    } catch {
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  const hasPlayed = playedKeys.size > 0

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

      {/* Demo mode banner */}
      {isDemo && (
        <div className="fixed top-0 inset-x-0 z-50 bg-secondary-container text-on-secondary-container px-4 py-3 flex items-center justify-between gap-4 text-sm">
          <span>
            <strong>Demo voice active</strong> — you're hearing a sample voice, not your own.
          </span>
          <button
            onClick={onReRecord}
            className="shrink-0 bg-primary-container text-on-primary-container font-semibold px-4 py-1.5 rounded-full text-xs hover:opacity-90 transition-opacity"
          >
            Record my voice →
          </button>
        </div>
      )}

      {/* Voice-ready toast */}
      {showToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-secondary-container text-on-secondary-container px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold">
          <span>🎉 Your voice is ready! Pick a story below.</span>
          <button onClick={dismissToast} className="hover:text-on-surface ml-1">✕</button>
        </div>
      )}

      <div className={`min-h-screen bg-background text-on-surface ${isDemo ? 'pt-16' : ''}`} style={{paddingBottom:'calc(100px + var(--sab))'}}>
        {/* Top bar */}
        <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 bg-surface border-b border-outline-variant/20 h-header safe-top" style={{top: isDemo ? 48 : 0}}>
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
        </header>

        <main className="max-w-[800px] mx-auto px-6 pt-header">
          {/* Mascot greeting */}
          <div className="flex items-center gap-5 mb-6 bg-surface-container-low p-5 rounded-xl border-b-4 border-surface-container-highest">
            <div className="text-5xl shrink-0">🦉</div>
            <div>
              <h1 className="text-lg font-bold text-primary-fixed mb-0.5">Hoo-hoo! Ready for a story?</h1>
              <p className="text-sm text-on-surface-variant">Pick a magical world to start tonight's adventure!</p>
            </div>
          </div>

          {/* Error banner */}
          {loadError && (
            <div className="mb-4 bg-error-container/20 border border-error/30 rounded-xl px-4 py-3 text-error text-sm flex items-center justify-between">
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} className="ml-4 text-error hover:text-on-surface">✕</button>
            </div>
          )}

          {/* Category pills */}
          <div className="mb-6 -mx-6 px-6 overflow-x-auto no-scrollbar">
            <div className="flex gap-3 pb-2">
              {CATEGORIES.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className={`flex-shrink-0 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                    activeCategory === cat
                      ? 'bg-primary-container text-on-primary-container btn-3d-sm'
                      : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface border-b-4 border-surface-container-highest'
                  }`}>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Story generation progress — only shown after server confirms count, and only if not all ready */}
          {!isDemo && cachedChecked && cachedKeys.size < STORIES.length && (
            <div className="mb-4 flex items-center gap-2.5 bg-surface-container-high border border-outline-variant/20 rounded-xl px-4 py-2.5">
              <span className="w-3 h-3 border-2 border-on-surface-variant/30 border-t-on-surface-variant rounded-full animate-spin shrink-0" />
              <span className="text-xs text-on-surface-variant">
                Generating your stories — <strong className="text-on-surface">{cachedKeys.size} of {STORIES.length}</strong> ready
              </span>
            </div>
          )}

          {/* Stories grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {filteredStories.map(story => (
              <StoryCard
                key={story.key}
                story={story}
                hasPlayed={playedKeys.has(story.key)}
                loading={loadingKey === story.key}
                isCached={cachedKeys.has(story.key)}
                onPlayClick={s => setSelectedKey(s.key)}
                isSelected={selectedKey === story.key}
              />
            ))}
          </div>

          {/* Feedback section */}
          {hasPlayed && !submitted && (
            <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-6 max-w-lg mx-auto mb-6">
              <h3 className="font-bold text-on-surface mb-1">Love Kidly? Tell us! 🙏</h3>
              <p className="text-sm text-on-surface-variant mb-4">Your feedback helps us grow.</p>
              <div className="space-y-3">
                <input type="email" value={feedbackEmail} onChange={e => setFeedbackEmail(e.target.value)} placeholder="Your email address" className="w-full px-4 py-2.5 border border-outline-variant rounded-xl bg-surface text-on-surface placeholder:text-on-surface-variant text-sm outline-none focus:border-primary-container" />
                <textarea value={feedbackMsg} onChange={e => setFeedbackMsg(e.target.value)} placeholder="What do you love? What could be better?" rows={3} className="w-full px-4 py-2.5 border border-outline-variant rounded-xl bg-surface text-on-surface placeholder:text-on-surface-variant text-sm resize-none outline-none focus:border-primary-container" />
                <button onClick={handleSubmit} disabled={submitting || (!feedbackEmail && !feedbackMsg)} className="px-6 py-2.5 bg-primary-container text-on-primary-container rounded-full text-sm font-bold btn-3d disabled:opacity-40">
                  {submitting ? 'Sending…' : 'Send feedback →'}
                </button>
              </div>
            </div>
          )}
          {submitted && (
            <div className="bg-secondary-container/20 border border-secondary/20 rounded-xl p-6 text-center max-w-lg mx-auto mb-6">
              <div className="text-3xl mb-2">🙏</div>
              <h3 className="font-bold text-on-surface">Thank you!</h3>
              <p className="text-sm text-on-surface-variant mt-1">Your feedback means the world to us.</p>
            </div>
          )}
        </main>

        {/* Generating banner — shown while TTS is being created */}
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

        {/* Go bar — appears when a story is selected and not loading */}
        {selectedKey && !loadingKey && (() => {
          const sel = STORIES.find(s => s.key === selectedKey)
          return (
            <div className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-on-primary-container"
                 style={{bottom:'calc(24px + var(--sab))', background:'var(--color-primary-container, #ffd600)', boxShadow:'0 4px 20px rgba(255,214,0,0.4)'}}>
              <span className="text-2xl leading-none select-none">{sel?.emoji}</span>
              <span className="text-sm font-bold max-w-[160px] truncate">{sel?.title}</span>
              <button
                onClick={() => sel && handlePlayClick(sel)}
                className="ml-1 flex items-center gap-1.5 bg-black/20 hover:bg-black/30 px-4 py-1.5 rounded-full text-sm font-bold transition-colors"
              >
                <span className="material-symbols-outlined ms-fill text-base">play_arrow</span>
                {cachedKeys.has(sel?.key) ? '⚡ Play' : 'Go'}
              </button>
              <button
                onClick={() => setSelectedKey(null)}
                className="flex items-center justify-center w-7 h-7 rounded-full bg-black/20 hover:bg-black/30 transition-colors shrink-0"
                aria-label="Dismiss"
              >
                <span className="material-symbols-outlined text-on-primary-container" style={{fontSize:16}}>close</span>
              </button>
            </div>
          )
        })()}

      </div>
    </>
  )
}
