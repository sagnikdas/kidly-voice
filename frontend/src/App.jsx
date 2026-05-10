import { useState, useEffect } from 'react'
import Landing from './components/Landing'
import RecordPhase from './components/RecordPhase'
import CloningPhase from './components/CloningPhase'
import StoriesPhase from './components/StoriesPhase'

export default function App() {
  const [phase, setPhase] = useState('landing')
  const [email, setEmail] = useState('')
  const [voiceId, setVoiceId] = useState(() => localStorage.getItem('kidly_voice_id') || '')
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('kidly_session_token') || '')
  const [isDemo, setIsDemo] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [voiceJustCreated, setVoiceJustCreated] = useState(false)
  const [sessionId] = useState(() => {
    let id = localStorage.getItem('kidly_session')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('kidly_session', id)
    }
    return id
  })
  const [recordings, setRecordings] = useState([])

  useEffect(() => {
    // Both must be present — if session_token is missing the voice can't be used.
    if (voiceId && sessionToken) {
      setPhase('stories')
    } else if (voiceId && !sessionToken) {
      localStorage.removeItem('kidly_voice_id')
      setVoiceId('')
    }
  }, [])

  const onVoiceReady = (id, token) => {
    localStorage.setItem('kidly_voice_id', id)
    localStorage.setItem('kidly_session_token', token)
    setVoiceId(id)
    setSessionToken(token)
    setVoiceJustCreated(true)
    setPhase('stories')
  }

  const onReRecord = async () => {
    const oldVoiceId = voiceId
    const wasDemo = isDemo
    localStorage.removeItem('kidly_voice_id')
    localStorage.removeItem('kidly_session_token')
    setVoiceId('')
    setSessionToken('')
    setIsDemo(false)
    setVoiceJustCreated(false)
    setRecordings([])
    setPhase('record')
    // Never delete the shared demo voice from ElevenLabs.
    if (oldVoiceId && !wasDemo) {
      fetch(`/api/admin/voices/${oldVoiceId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const onStart = async () => {
    if (email.trim()) {
      // Try to restore a saved voice for this email.
      setRestoring(true)
      try {
        const r = await fetch(`/api/user/lookup?email=${encodeURIComponent(email.trim())}`)
        if (r.ok) {
          const { voice_id, session_token } = await r.json()
          if (voice_id && session_token) {
            localStorage.setItem('kidly_voice_id', voice_id)
            localStorage.setItem('kidly_session_token', session_token)
            setVoiceId(voice_id)
            setSessionToken(session_token)
            setIsDemo(false)
            setPhase('stories')
            return
          }
        }
      } catch {}
      finally { setRestoring(false) }
      // Email not found — go to record flow.
      setPhase('record')
      return
    }

    // No email — try the demo voice so users can experience the product first.
    try {
      const r = await fetch('/api/voice/default')
      if (r.ok) {
        const { voice_id, session_token } = await r.json()
        if (voice_id && session_token) {
          setVoiceId(voice_id)
          setSessionToken(session_token)
          setIsDemo(true)
          setPhase('stories')
          return
        }
      }
    } catch {}

    // Demo mode disabled or unavailable — go straight to recording.
    setPhase('record')
  }

  return (
    <div className="min-h-screen">
      {phase === 'landing' && (
        <Landing
          email={email}
          setEmail={setEmail}
          restoring={restoring}
          onStart={onStart}
        />
      )}
      {phase === 'record' && (
        <RecordPhase
          sessionId={sessionId}
          onBack={() => setPhase('landing')}
          onRecordingsReady={(recs) => {
            setRecordings(recs)
            setPhase('cloning')
          }}
        />
      )}
      {phase === 'cloning' && (
        <CloningPhase
          sessionId={sessionId}
          recordings={recordings}
          email={email}
          onVoiceReady={onVoiceReady}
          onBack={() => setPhase('record')}
        />
      )}
      {phase === 'stories' && (
        <StoriesPhase
          voiceId={voiceId}
          sessionToken={sessionToken}
          isDemo={isDemo}
          email={email}
          setEmail={setEmail}
          onReRecord={onReRecord}
          voiceJustCreated={voiceJustCreated}
          onToastDismissed={() => setVoiceJustCreated(false)}
        />
      )}
    </div>
  )
}
