import { useState, useEffect } from 'react'
import Landing from './components/Landing'
import RecordPhase from './components/RecordPhase'
import CloningPhase from './components/CloningPhase'
import StoriesPhase from './components/StoriesPhase'

export default function App() {
  const [phase, setPhase] = useState('landing')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [voiceId, setVoiceId] = useState(() => localStorage.getItem('kidly_voice_id') || '')
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('kidly_session_token') || '')
  const [userDisplay, setUserDisplay] = useState(() => localStorage.getItem('kidly_user_display') || '')
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
    const display = email.trim() || mobile.trim()
    if (display) { localStorage.setItem('kidly_user_display', display); setUserDisplay(display) }
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
    if (oldVoiceId && !wasDemo) {
      fetch(`/api/admin/voices/${oldVoiceId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const onLogout = () => {
    localStorage.removeItem('kidly_voice_id')
    localStorage.removeItem('kidly_session_token')
    localStorage.removeItem('kidly_user_display')
    setVoiceId('')
    setSessionToken('')
    setEmail('')
    setMobile('')
    setUserDisplay('')
    setIsDemo(false)
    setVoiceJustCreated(false)
    setRecordings([])
    setPhase('landing')
  }

  const onStart = async () => {
    if (email.trim()) {
      setRestoring(true)
      try {
        const r = await fetch(`/api/user/lookup?email=${encodeURIComponent(email.trim())}`)
        if (r.ok) {
          const { voice_id, session_token } = await r.json()
          if (voice_id && session_token) {
            localStorage.setItem('kidly_voice_id', voice_id)
            localStorage.setItem('kidly_session_token', session_token)
            localStorage.setItem('kidly_user_display', email.trim())
            setVoiceId(voice_id)
            setSessionToken(session_token)
            setUserDisplay(email.trim())
            setIsDemo(false)
            setPhase('stories')
            return
          }
        }
      } catch {}
      finally { setRestoring(false) }
      setPhase('record')
      return
    }

    if (mobile.trim()) {
      setRestoring(true)
      try {
        const r = await fetch(`/api/user/lookup?mobile=${encodeURIComponent(mobile.trim())}`)
        if (r.ok) {
          const { voice_id, session_token } = await r.json()
          if (voice_id && session_token) {
            localStorage.setItem('kidly_voice_id', voice_id)
            localStorage.setItem('kidly_session_token', session_token)
            localStorage.setItem('kidly_user_display', mobile.trim())
            setVoiceId(voice_id)
            setSessionToken(session_token)
            setUserDisplay(mobile.trim())
            setIsDemo(false)
            setPhase('stories')
            return
          }
        }
      } catch {}
      finally { setRestoring(false) }
      setPhase('record')
      return
    }

    // No identifier — try the demo voice.
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

    setPhase('record')
  }

  return (
    <div className="min-h-screen">
      {phase === 'landing' && (
        <Landing
          email={email}
          setEmail={setEmail}
          mobile={mobile}
          setMobile={setMobile}
          restoring={restoring}
          onStart={onStart}
          canGoToStories={!!(voiceId && sessionToken)}
          onGoToStories={() => setPhase('stories')}
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
          mobile={mobile}
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
          userDisplay={userDisplay}
          onReRecord={onReRecord}
          onLogout={onLogout}
          voiceJustCreated={voiceJustCreated}
          onToastDismissed={() => setVoiceJustCreated(false)}
        />
      )}
    </div>
  )
}
