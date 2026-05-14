import { useState, useEffect, useRef, useCallback } from 'react'
import Landing from './components/Landing'
import RecordPhase from './components/RecordPhase'
import CloningPhase from './components/CloningPhase'
import StoriesPhase from './components/StoriesPhase'
import SettingsDrawer from './components/SettingsDrawer'
import { OSContext, detectOS } from './utils/os'

export default function App() {
  const [os] = useState(detectOS)
  const [phase, setPhase] = useState('landing')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [voiceId, setVoiceId] = useState(() => localStorage.getItem('kidly_voice_id') || '')
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('kidly_session_token') || '')
  const [userDisplay, setUserDisplay] = useState(() => localStorage.getItem('kidly_user_display') || '')
  const [theme, setThemeState] = useState(() => localStorage.getItem('kidly_theme') || 'dark')
  const [fontSize, setFontSizeState] = useState(() => localStorage.getItem('kidly_font_size') || 'md')
  const [showSettings, setShowSettings] = useState(false)

  const sessionTokenRef = useRef(sessionToken)
  useEffect(() => { sessionTokenRef.current = sessionToken }, [sessionToken])

  const applySettings = useCallback((s) => {
    if (!s) return
    if (s.theme) { setThemeState(s.theme); localStorage.setItem('kidly_theme', s.theme) }
    if (s.font_size) { setFontSizeState(s.font_size); localStorage.setItem('kidly_font_size', s.font_size) }
    // Pass streak + played progress to StoriesPhase for cross-device merge
    setInitialProgress({
      streak_count:     s.streak_count     ?? null,
      streak_last_date: s.streak_last_date ?? null,
      played_keys:      s.played_keys      ?? null,
    })
  }, [])

  const settingsSaveTimer = useRef(null)
  const setTheme = (t) => {
    setThemeState(t)
    localStorage.setItem('kidly_theme', t)
    clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = setTimeout(() => {
      if (!sessionTokenRef.current) return
      fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionTokenRef.current, theme: t }),
      }).catch(() => {})
    }, 1500)
  }
  const setFontSize = (s) => {
    setFontSizeState(s)
    localStorage.setItem('kidly_font_size', s)
    clearTimeout(settingsSaveTimer.current)
    settingsSaveTimer.current = setTimeout(() => {
      if (!sessionTokenRef.current) return
      fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionTokenRef.current, font_size: s }),
      }).catch(() => {})
    }, 1500)
  }

  useEffect(() => {
    document.documentElement.dataset.os = os
  }, [os])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const sizes = { sm: '14px', md: '16px', lg: '19px' }
    document.documentElement.style.fontSize = sizes[fontSize] || '16px'
  }, [fontSize])

  const [isDemo, setIsDemo] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [voiceJustCreated, setVoiceJustCreated] = useState(false)
  const [initialProgress, setInitialProgress] = useState(null)
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
    if (voiceId && sessionToken) {
      setPhase('stories')
      // Restore server-side settings (may differ from localStorage on a new device)
      fetch(`/api/user/settings?session_token=${encodeURIComponent(sessionToken)}`)
        .then(r => r.ok ? r.json() : null)
        .then(applySettings)
        .catch(() => {})
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
          const { voice_id, session_token, settings } = await r.json()
          if (voice_id && session_token) {
            localStorage.setItem('kidly_voice_id', voice_id)
            localStorage.setItem('kidly_session_token', session_token)
            localStorage.setItem('kidly_user_display', email.trim())
            setVoiceId(voice_id)
            setSessionToken(session_token)
            setUserDisplay(email.trim())
            applySettings(settings)
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
          const { voice_id, session_token, settings } = await r.json()
          if (voice_id && session_token) {
            localStorage.setItem('kidly_voice_id', voice_id)
            localStorage.setItem('kidly_session_token', session_token)
            localStorage.setItem('kidly_user_display', mobile.trim())
            setVoiceId(voice_id)
            setSessionToken(session_token)
            setUserDisplay(mobile.trim())
            applySettings(settings)
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
    <OSContext.Provider value={os}>
    <div className="min-h-screen">
      <SettingsDrawer
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        theme={theme}
        setTheme={setTheme}
        fontSize={fontSize}
        setFontSize={setFontSize}
        userDisplay={userDisplay}
        onReRecord={phase === 'stories' ? onReRecord : undefined}
      />
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
        <div key="ph-stories" style={{animation: 'fadeUp 0.35s ease-out both'}}>
          <StoriesPhase
            voiceId={voiceId}
            sessionToken={sessionToken}
            isDemo={isDemo}
            email={email}
            setEmail={setEmail}
            userDisplay={userDisplay}
            onReRecord={onReRecord}
            onLogout={onLogout}
            onOpenSettings={() => setShowSettings(true)}
            voiceJustCreated={voiceJustCreated}
            onToastDismissed={() => setVoiceJustCreated(false)}
            initialProgress={initialProgress}
          />
        </div>
      )}
    </div>
    </OSContext.Provider>
  )
}
