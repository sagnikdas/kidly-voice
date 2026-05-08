import { useState, useEffect } from 'react'
import Landing from './components/Landing'
import RecordPhase from './components/RecordPhase'
import CloningPhase from './components/CloningPhase'
import StoriesPhase from './components/StoriesPhase'

export default function App() {
  const [phase, setPhase] = useState('landing')
  const [email, setEmail] = useState('')
  const [voiceId, setVoiceId] = useState(() => localStorage.getItem('kidly_voice_id') || '')
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
    if (voiceId) setPhase('stories')
  }, [])

  const onVoiceReady = (id) => {
    localStorage.setItem('kidly_voice_id', id)
    setVoiceId(id)
    setVoiceJustCreated(true)
    setPhase('stories')
  }

  const onReRecord = async () => {
    const oldVoiceId = voiceId
    localStorage.removeItem('kidly_voice_id')
    setVoiceId('')
    setVoiceJustCreated(false)
    setRecordings([])
    setPhase('record')
    // Best-effort deletion — don't block the UI
    if (oldVoiceId) {
      fetch(`/api/admin/voices/${oldVoiceId}`, { method: 'DELETE' }).catch(() => {})
    }
  }

  const onStart = async () => {
    if (email.trim()) {
      setRestoring(true)
      try {
        const r = await fetch(`/api/user/lookup?email=${encodeURIComponent(email.trim())}`)
        if (r.ok) {
          const { voice_id } = await r.json()
          if (voice_id) {
            localStorage.setItem('kidly_voice_id', voice_id)
            setVoiceId(voice_id)
            setPhase('stories')
            return
          }
        }
      } catch {}
      finally {
        setRestoring(false)
      }
    }
    setPhase('record')
  }

  return (
    <div className="min-h-screen" style={{ background: '#fffbf5' }}>
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
