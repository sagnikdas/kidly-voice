import { useState, useEffect, useRef } from 'react'

const STEPS = [
  { label: 'Uploading your recordings…' },
  { label: 'Creating voice model…' },
  { label: 'Your voice is ready!' },
]

export default function CloningPhase({ sessionId, recordings, email, onVoiceReady, onBack }) {
  const [stepIdx, setStepIdx] = useState(0)
  const [err, setErr] = useState('')
  const [retryCount, setRetryCount] = useState(0)
  const [voiceId, setVoiceId] = useState('')

  // Preview state
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewErr, setPreviewErr] = useState('')
  const audioRef = useRef(null)

  useEffect(() => {
    run()
  }, [retryCount])

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [])

  const run = async () => {
    setErr('')
    setStepIdx(0)
    setVoiceId('')
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

      setStepIdx(1)
      const label = email ? `${email.split('@')[0]}'s Kidly Voice` : 'My Kidly Voice'
      const r = await fetch('/api/voice/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, label }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Voice cloning failed')
      }
      const { voice_id } = await r.json()

      setVoiceId(voice_id)
      setStepIdx(2)
    } catch (e) {
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
        body: JSON.stringify({ voice_id: voiceId }),
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
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-5xl">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800">Something went wrong</h2>
          <p className="text-red-500 text-sm leading-relaxed">{err}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={onBack}
              className="px-5 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium transition-colors"
            >
              ← Re-record
            </button>
            <button
              onClick={() => setRetryCount((c) => c + 1)}
              className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Celebration screen
  if (stepIdx === 2 && voiceId) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="text-6xl">🎉</div>
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Your voice is ready!</h2>
            <p className="text-gray-500 text-sm mt-2">
              We cloned your voice successfully. Want to hear how it sounds?
            </p>
          </div>

          {/* Preview section */}
          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-5 space-y-3">
            {!previewUrl ? (
              <button
                onClick={loadPreview}
                disabled={previewBusy}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-xl text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
              >
                {previewBusy ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Loading sample…
                  </>
                ) : (
                  '▶ Hear a sample in my voice'
                )}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-orange-700 font-medium">Your cloned voice:</p>
                <audio ref={audioRef} controls src={previewUrl} className="w-full" style={{ height: 32 }} />
              </div>
            )}
            {previewErr && (
              <p className="text-xs text-red-500">{previewErr}</p>
            )}
          </div>

          <button
            onClick={() => onVoiceReady(voiceId)}
            className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-2xl font-semibold transition-colors"
          >
            Go to Stories →
          </button>
        </div>
      </div>
    )
  }

  // Progress screen
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center">
        <div className="text-6xl mb-6">🧠</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-8">Creating your voice…</h2>

        <div className="space-y-4 text-left mb-8">
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-colors ${
                  i < stepIdx
                    ? 'bg-green-500 text-white'
                    : i === stepIdx
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-300'
                }`}
              >
                {i < stepIdx ? (
                  '✓'
                ) : i === stepIdx ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin block" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${
                  i < stepIdx
                    ? 'text-green-600 font-medium'
                    : i === stepIdx
                    ? 'text-gray-800 font-semibold'
                    : 'text-gray-300'
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-400">This takes about 30 seconds — hang tight!</p>
      </div>
    </div>
  )
}
