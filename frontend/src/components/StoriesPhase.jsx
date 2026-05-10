import { useState, useEffect } from 'react'
import StoryCard from './StoryCard'
import StoryReader from './StoryReader'
import CustomTextModal from './CustomTextModal'
import { STORIES } from '../data/stories'

const CATEGORIES = ['All', '🌙 Bedtime', '⚔️ Adventure', '🐾 Animals', '✨ Heartfelt']
const CATEGORY_MORALS = {
  '🌙 Bedtime': ['comfort', 'love', 'gratitude'],
  '⚔️ Adventure': ['courage', 'bravery', 'perseverance', 'responsibility'],
  '🐾 Animals': ['kindness', 'friendship', 'helpfulness', 'empathy'],
  '✨ Heartfelt': ['creativity', 'self-worth', 'generosity'],
}

function VoiceSelect({ value, options, onChange }) {
  const groups = options.reduce((g, v) => {
    ;(g[v.group] = g[v.group] || []).push(v)
    return g
  }, {})
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex-1 text-sm border border-outline-variant rounded-lg px-2 py-1.5 bg-surface-container text-on-surface outline-none focus:border-primary-container"
    >
      <option value="">My cloned voice</option>
      {Object.entries(groups).map(([group, voices]) => (
        <optgroup key={group} label={group}>
          {voices.map(v => (
            <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

export default function StoriesPhase({ voiceId, sessionToken, isDemo, email, setEmail, onReRecord, voiceJustCreated, onToastDismissed }) {
  const [playedKeys, setPlayedKeys] = useState(new Set())
  const [audioCache, setAudioCache] = useState({})       // `${voiceId}:${story.key}` → { audioUrl, alignment, text }
  const [loadingKey, setLoadingKey] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [readerState, setReaderState] = useState(null)   // { title, text, audioUrl, alignment }
  const [preloadStatus, setPreloadStatus] = useState({ total: 0, ready: 0, done: false })
  const [showCustomModal, setShowCustomModal] = useState(false)

  // TEMP: voice picker for testing
  const [testVoiceId, setTestVoiceId] = useState('')
  const [voiceOptions, setVoiceOptions] = useState([])

  // Feedback state
  const [feedbackEmail, setFeedbackEmail] = useState(email || '')
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Toast
  const [showToast, setShowToast] = useState(voiceJustCreated)

  // Category filter
  const [activeCategory, setActiveCategory] = useState('All')
  const filteredStories = activeCategory === 'All' ? STORIES : STORIES.filter(s => CATEGORY_MORALS[activeCategory]?.includes(s.moral))

  // Reset per-voice state when the voice changes (e.g. after re-recording)
  useEffect(() => {
    setPlayedKeys(new Set())
    setAudioCache({})
    setReaderState(null)
    setLoadError('')
    setPreloadStatus({ total: 0, ready: 0, done: false })
  }, [voiceId])

  // Poll preload status until all stories are ready.
  useEffect(() => {
    if (!voiceId || isDemo) return
    let cancelled = false

    const poll = async () => {
      try {
        const r = await fetch(`/api/stories/preload-status?voice_id=${voiceId}`)
        if (!r.ok || cancelled) return
        const data = await r.json()
        if (!cancelled) {
          setPreloadStatus(data)
          if (!data.done) setTimeout(poll, 2000)
        }
      } catch {}
    }

    poll()
    return () => { cancelled = true }
  }, [voiceId, isDemo])

  // TEMP: load Fish Audio voice list for testing
  useEffect(() => {
    fetch('/api/debug/voices')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.voices) setVoiceOptions(data.voices) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!voiceJustCreated) return
    const t = setTimeout(() => { setShowToast(false); onToastDismissed?.() }, 5000)
    return () => clearTimeout(t)
  }, [voiceJustCreated, onToastDismissed])

  const dismissToast = () => { setShowToast(false); onToastDismissed?.() }

  const handlePlayClick = async (story) => {
    if (!voiceId) { setLoadError('No voice found — please re-record.'); return }

    const effectiveVoiceId = testVoiceId || voiceId
    const cacheKey = `${effectiveVoiceId}:${story.key}`

    // Serve from in-session cache — no network call needed.
    if (audioCache[cacheKey]) {
      setReaderState({ title: story.title, ...audioCache[cacheKey] })
      return
    }

    setLoadingKey(story.key)
    setLoadError('')
    try {
      let r
      if (testVoiceId) {
        // TEMP: use debug endpoint that skips session validation
        r = await fetch('/api/debug/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: testVoiceId, story_key: story.key }),
        })
      } else {
        r = await fetch('/api/stories/speak-timestamped', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice_id: voiceId, story_key: story.key, session_token: sessionToken }),
        })
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Failed to load story')
      }
      const { audio_url, alignment, story_text } = await r.json()
      const entry = { audioUrl: audio_url, alignment, text: story_text }
      setAudioCache(prev => ({ ...prev, [cacheKey]: entry }))
      setPlayedKeys(prev => new Set([...prev, story.key]))
      setReaderState({ title: story.title, ...entry })
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setLoadingKey(null)
    }
  }

  const openCustomReader = ({ title, text, audioUrl, alignment }) => {
    setShowCustomModal(false)
    setReaderState({ title, text, audioUrl, alignment })
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
          text={readerState.text}
          audioUrl={readerState.audioUrl}
          alignment={readerState.alignment}
          onClose={() => setReaderState(null)}
        />
      )}

      {/* Custom text modal */}
      {showCustomModal && (
        <CustomTextModal
          voiceId={voiceId}
          sessionToken={sessionToken}
          onClose={() => setShowCustomModal(false)}
          onOpenReader={openCustomReader}
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

      <div className={`min-h-screen bg-background text-on-surface pb-32 ${isDemo ? 'pt-16' : ''}`}>
        {/* Top bar */}
        <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-14 bg-surface border-b border-outline-variant/20" style={{top: isDemo ? 48 : 0}}>
          <span className="text-lg font-bold text-primary-container">Kidly</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-high rounded-full border border-outline-variant/30">
              <span className="material-symbols-outlined ms-fill text-primary-container text-base">lock</span>
              <span className="text-xs font-bold text-on-surface">Kid-Lock</span>
            </div>
            <button onClick={onReRecord} className="text-xs text-on-surface-variant hover:text-on-surface underline">Re-record</button>
          </div>
        </header>

        <main className="max-w-[800px] mx-auto px-6 pt-20">
          {/* Mascot greeting */}
          <div className="flex items-center gap-5 mb-6 bg-surface-container-low p-5 rounded-xl border-b-4 border-surface-container-highest">
            <div className="text-5xl shrink-0">🦉</div>
            <div>
              <h1 className="text-lg font-bold text-primary-fixed mb-0.5">Hoo-hoo! Ready for a story?</h1>
              <p className="text-sm text-on-surface-variant">Pick a magical world to start tonight's adventure!</p>
            </div>
          </div>

          {/* Preload status */}
          {preloadStatus.total > 0 && !preloadStatus.done && (
            <div className="mb-4 flex items-center gap-2 bg-surface-container border border-outline-variant/20 rounded-xl px-4 py-2.5 text-sm text-secondary-fixed">
              <span className="w-3.5 h-3.5 border-2 border-secondary-fixed border-t-transparent rounded-full animate-spin shrink-0" />
              <span>Preparing stories… <strong>{preloadStatus.ready}/{preloadStatus.total}</strong> ready</span>
            </div>
          )}

          {/* Error banner */}
          {loadError && (
            <div className="mb-4 bg-error-container/20 border border-error/30 rounded-xl px-4 py-3 text-error text-sm flex items-center justify-between">
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} className="ml-4 text-error hover:text-on-surface">✕</button>
            </div>
          )}

          {/* Voice picker (testing - keep same logic) */}
          {voiceOptions.length > 0 && (
            <div className="mb-4 flex items-center gap-3 bg-surface-container border border-outline-variant/20 rounded-xl px-4 py-3">
              <span className="text-xs font-semibold text-secondary-fixed shrink-0">🧪 Test voice</span>
              <VoiceSelect value={testVoiceId} options={voiceOptions} onChange={v => { setTestVoiceId(v); setAudioCache({}) }} />
              {testVoiceId && <button onClick={() => { setTestVoiceId(''); setAudioCache({}) }} className="text-xs text-on-surface-variant hover:text-error shrink-0">✕ Reset</button>}
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

          {/* Stories bento grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {/* Featured first story */}
            {filteredStories.length > 0 && (
              <div className="sm:col-span-2">
                <StoryCard story={filteredStories[0]} hasPlayed={playedKeys.has(filteredStories[0].key)} loading={loadingKey === filteredStories[0].key} onPlayClick={handlePlayClick} featured={true} />
              </div>
            )}
            {/* Rest of stories */}
            {filteredStories.slice(1).map(story => (
              <StoryCard key={story.key} story={story} hasPlayed={playedKeys.has(story.key)} loading={loadingKey === story.key} onPlayClick={handlePlayClick} />
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

        {/* Bottom nav */}
        <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pt-3 pb-8 bg-surface-container-high rounded-t-xl" style={{boxShadow: '0 -4px 20px rgba(255,214,0,0.1)'}}>
          <div className="flex flex-col items-center justify-center bg-primary-container text-on-primary-container rounded-xl px-5 py-2 btn-3d-sm">
            <span className="material-symbols-outlined ms-fill text-xl">auto_stories</span>
            <span className="text-[10px] font-bold">Library</span>
          </div>
          <button onClick={() => setShowCustomModal(true)} className="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2 hover:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined text-xl">magic_button</span>
            <span className="text-[10px] font-bold">Custom</span>
          </button>
          <button onClick={onReRecord} className="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2 hover:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined text-xl">mic</span>
            <span className="text-[10px] font-bold">Re-record</span>
          </button>
          <div className="flex flex-col items-center justify-center text-on-surface-variant px-4 py-2">
            <span className="material-symbols-outlined text-xl">space_dashboard</span>
            <span className="text-[10px] font-bold">Dashboard</span>
          </div>
        </nav>
      </div>
    </>
  )
}
