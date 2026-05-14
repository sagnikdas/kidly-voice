import { useState, useEffect, useRef } from 'react'

const STEPS = [
  { label: 'Uploading your recordings…' },
  { label: 'Creating voice model…' },
  { label: 'Your voice is ready!' },
]

export default function CloningPhase({ sessionId, recordings, email, sessionToken, onVoiceReady, onBack }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [err, setErr] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [voiceId, setVoiceId] = useState('')
  const [clonedToken, setClonedToken] = useState('')

  // Preview state
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewErr, setPreviewErr] = useState('')
  const audioRef = useRef(null)

  // Generation counter: prevents React StrictMode's double-invocation of useEffect
  // from firing two concurrent clone requests to Fish Audio.
  const runGenRef = useRef(0)

  useEffect(() => {
    const gen = ++runGenRef.current
    run(gen)
  }, [retryCount])

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [])

  const run = async (gen) => {
    setErr('')
    setStepIdx(0)
    setVoiceId('')
    setClonedToken('')
    setPreviewUrl('')
    setPreviewBusy(false)
    setPreviewErr('')

    try {
      for (let i = 0; i < recordings.length; i++) {
        const take = recordings[i]
        const fd = new FormData()
        if (take.isFile) {
          fd.append('file', take.blob, take.blob.name || `file-${i + 1}.mp3`)
        } else {
          const ext = (take.mime || '').includes('mp4') ? 'm4a' : 'webm'
          fd.append('file', take.blob, `take-${i + 1}.${ext}`)
        }
        fd.append('session_id', sessionId)
        fd.append('is_first', i === 0 ? 'true' : 'false')
        const r = await fetch('/api/recording', { method: 'POST', body: fd })
        if (!r.ok) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.detail || `Upload ${i + 1} failed`)
        }
      }

      // Only the most recent run proceeds to clone — cancels StrictMode duplicate.
      if (runGenRef.current !== gen) return

      setStepIdx(1)
      const label = email ? `${email.split('@')[0]}'s Kidly Voice` : 'My Kidly Voice'
      const r = await fetch('/api/voice/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, session_token: sessionToken, label }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Voice cloning failed')
      }
      const { voice_id, session_token: returnedToken } = await r.json()

      if (runGenRef.current !== gen) return

      // Kick off background pre-generation of all 15 stories so the voice slot
      // can be freed on Fish Audio once they're all cached on disk.
      fetch('/api/stories/preload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id, session_token: returnedToken }),
      }).catch(() => {})

      setVoiceId(voice_id)
      setClonedToken(returnedToken)
      setStepIdx(2)
    } catch (e) {
      if (runGenRef.current !== gen) return
      setErr(e.message)
    }
  }

  const loadPreview = async () => {
    if (previewBusy || !voiceId) return
    setPreviewBusy(true)
    setPreviewErr('')
    try {
      const r = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, session_token: clonedToken }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Could not load preview')
      }
      const { audio_url } = await r.json()
      setPreviewUrl(audio_url)
      setTimeout(() => audioRef.current?.play(), 50)
    } catch (e) {
      setPreviewErr(e.message)
    } finally {
      setPreviewBusy(false)
    }
  }

  if (err) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-5">
          <div className="text-5xl">⚠️</div>
          <h2 className="text-xl font-bold text-on-surface">Something went wrong</h2>
          <p className="text-error text-sm leading-relaxed">{err}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={onBack} className="px-5 py-3 border border-outline-variant text-on-surface-variant hover:text-on-surface rounded-full text-sm font-medium transition-colors">← Re-record</button>
            <button onClick={() => setRetryCount(c => c+1)} className="px-5 py-3 bg-primary-container text-on-primary-container rounded-full text-sm font-bold transition-colors btn-3d">Try again</button>
          </div>
        </div>
      </div>
    )
  }

  // Celebration screen
  if (stepIdx === 2 && voiceId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="text-6xl">🎉</div>
          <div>
            <h2 className="text-2xl font-bold text-on-surface">Your voice is ready!</h2>
            <p className="text-on-surface-variant text-sm mt-2">We cloned your voice successfully. Want to hear how it sounds?</p>
          </div>

          {/* Preview section */}
          <div className="bg-surface-container-high border border-outline-variant/20 rounded-xl p-5 space-y-3">
            {!previewUrl ? (
              <button onClick={loadPreview} disabled={previewBusy} className="w-full py-3 bg-primary-container text-on-primary-container rounded-full text-sm font-bold transition-all btn-3d glow-primary disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {previewBusy ? <><span className="w-3.5 h-3.5 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin"/>Loading sample…</> : '▶ Hear a sample in my voice'}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-secondary-fixed font-medium">Your cloned voice:</p>
                <audio ref={audioRef} controls src={previewUrl} className="w-full" style={{height:32}} />
              </div>
            )}
            {previewErr && <p className="text-xs text-error">{previewErr}</p>}
          </div>

          {email && (
            <p className="text-xs text-secondary-fixed font-medium">✓ Voice saved to {email} — recoverable from any device</p>
          )}

          <button onClick={() => onVoiceReady(voiceId, clonedToken)} className="w-full py-4 bg-surface-container-high text-on-surface rounded-full font-bold transition-colors hover:bg-surface-container-highest">
            Go to Stories →
          </button>
        </div>
      </div>
    )
  }

  // Progress screen
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        <div className="text-6xl mb-6">🧠</div>
        <h2 className="text-2xl font-bold text-on-surface mb-8">Creating your voice…</h2>
        <div className="space-y-4 text-left mb-8">
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${i < stepIdx ? 'bg-secondary-container text-on-secondary-container' : i === stepIdx ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                {i < stepIdx ? '✓' : i === stepIdx ? <span className="w-3.5 h-3.5 border-2 border-on-primary-container border-t-transparent rounded-full animate-spin block" /> : i + 1}
              </div>
              <span className={`text-sm ${i < stepIdx ? 'text-secondary-fixed font-medium' : i === stepIdx ? 'text-on-surface font-semibold' : 'text-on-surface-variant'}`}>{step.label}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-on-surface-variant">This takes about 30 seconds — hang tight!</p>
      </div>
    </div>
  )
}
