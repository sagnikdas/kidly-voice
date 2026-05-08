import { useState, useEffect } from 'react'
import StoryCard from './StoryCard'
import StoryReader from './StoryReader'
import CustomTextModal from './CustomTextModal'
import { STORIES } from '../data/stories'

export default function StoriesPhase({ voiceId, sessionToken, isDemo, email, setEmail, onReRecord, voiceJustCreated, onToastDismissed }) {
  const [viewMode, setViewMode] = useState('grid')
  const [playedKeys, setPlayedKeys] = useState(new Set())
  const [audioCache, setAudioCache] = useState({})       // story.key → { audioUrl, alignment, text }
  const [loadingKey, setLoadingKey] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [readerState, setReaderState] = useState(null)   // { title, text, audioUrl, alignment }
  const [showCustomModal, setShowCustomModal] = useState(false)

  // Feedback state
  const [feedbackEmail, setFeedbackEmail] = useState(email || '')
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Toast
  const [showToast, setShowToast] = useState(voiceJustCreated)

  // Reset per-voice state when the voice changes (e.g. after re-recording)
  useEffect(() => {
    setPlayedKeys(new Set())
    setAudioCache({})
    setReaderState(null)
    setLoadError('')
  }, [voiceId])

  useEffect(() => {
    if (!voiceJustCreated) return
    const t = setTimeout(() => { setShowToast(false); onToastDismissed?.() }, 5000)
    return () => clearTimeout(t)
  }, [voiceJustCreated, onToastDismissed])

  const dismissToast = () => { setShowToast(false); onToastDismissed?.() }

  const handlePlayClick = async (story) => {
    if (!voiceId) { setLoadError('No voice found — please re-record.'); return }

    // Serve from in-session cache — no network call needed.
    if (audioCache[story.key]) {
      setReaderState({ title: story.title, ...audioCache[story.key] })
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
      const { audio_url, alignment, story_text } = await r.json()
      const entry = { audioUrl: audio_url, alignment, text: story_text }
      setAudioCache(prev => ({ ...prev, [story.key]: entry }))
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
        <div className="fixed top-0 inset-x-0 z-50 bg-indigo-600 text-white px-4 py-3 flex items-center justify-between gap-4 text-sm">
          <span>
            <strong>Demo voice active</strong> — you're hearing a sample voice, not your own.
          </span>
          <button
            onClick={onReRecord}
            className="shrink-0 bg-white text-indigo-700 font-semibold px-4 py-1.5 rounded-full text-xs hover:bg-indigo-50 transition-colors"
          >
            Record my voice →
          </button>
        </div>
      )}

      {/* Voice-ready toast */}
      {showToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-green-600 text-white px-5 py-3 rounded-2xl shadow-lg text-sm font-semibold">
          <span>🎉 Your voice is ready! Pick a story below.</span>
          <button onClick={dismissToast} className="text-green-200 hover:text-white ml-1">✕</button>
        </div>
      )}

      <div className={`min-h-screen px-4 py-10 ${isDemo ? 'pt-20' : ''}`}>
        <div className="max-w-4xl mx-auto">

          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Choose a story 🌙</h2>
              <p className="text-gray-500 text-sm mt-1">
                Tap any story to read it in your cloned voice with word-by-word highlighting.
              </p>
            </div>
            <button
              onClick={onReRecord}
              className="text-xs text-gray-400 hover:text-gray-600 underline mt-1 shrink-0 ml-4"
            >
              Re-record voice
            </button>
          </div>

          {/* Error banner */}
          {loadError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm flex items-center justify-between">
              <span>{loadError}</span>
              <button onClick={() => setLoadError('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
            </div>
          )}

          {/* Toolbar: view toggle */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-400">{STORIES.length} stories</p>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  viewMode === 'grid' ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                ⊞ Grid
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  viewMode === 'list' ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                ≡ List
              </button>
            </div>
          </div>

          {/* Stories */}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-3">
              {STORIES.map((story) => (
                <StoryCard
                  key={story.key}
                  story={story}
                  hasPlayed={playedKeys.has(story.key)}
                  loading={loadingKey === story.key}
                  onPlayClick={handlePlayClick}
                  listMode={false}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {STORIES.map((story) => (
                <StoryCard
                  key={story.key}
                  story={story}
                  hasPlayed={playedKeys.has(story.key)}
                  loading={loadingKey === story.key}
                  onPlayClick={handlePlayClick}
                  listMode={true}
                />
              ))}
            </div>
          )}

          <p className="text-center text-xs text-gray-300 mb-12">↓ Scroll to see all stories</p>

          {/* Feedback */}
          {hasPlayed && !submitted && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 max-w-lg mx-auto">
              <h3 className="font-bold text-gray-800 mb-1">Love Kidly? Tell us!</h3>
              <p className="text-sm text-gray-500 mb-4">
                Your feedback helps us grow. Leave your email and we'll keep you posted.
              </p>
              <div className="space-y-3">
                <input
                  type="email"
                  value={feedbackEmail}
                  onChange={(e) => setFeedbackEmail(e.target.value)}
                  placeholder="Your email address"
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:border-orange-400 outline-none text-sm bg-white"
                />
                <textarea
                  value={feedbackMsg}
                  onChange={(e) => setFeedbackMsg(e.target.value)}
                  placeholder="What do you love? What could be better?"
                  rows={3}
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-xl focus:border-orange-400 outline-none text-sm resize-none bg-white"
                />
                <button
                  onClick={handleSubmit}
                  disabled={submitting || (!feedbackEmail && !feedbackMsg)}
                  className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl text-sm font-semibold transition-colors"
                >
                  {submitting ? 'Sending…' : 'Send feedback →'}
                </button>
              </div>
            </div>
          )}

          {submitted && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center max-w-lg mx-auto">
              <div className="text-3xl mb-2">🙏</div>
              <h3 className="font-bold text-gray-800">Thank you!</h3>
              <p className="text-sm text-gray-500 mt-1">Your feedback means the world to us.</p>
            </div>
          )}
        </div>
      </div>

      {/* Floating custom text button */}
      <button
        onClick={() => setShowCustomModal(true)}
        className="fixed bottom-7 right-7 z-30 flex items-center gap-2 bg-gray-800 hover:bg-gray-900 text-white pl-4 pr-5 py-3 rounded-full shadow-xl font-semibold text-sm transition-colors"
      >
        <span className="text-base">✏️</span>
        Custom text
      </button>
    </>
  )
}
