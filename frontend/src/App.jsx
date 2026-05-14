import { useState, useEffect, useRef, useCallback } from 'react'
import Landing from './components/Landing'
import WelcomeInterstitial from './components/WelcomeInterstitial'
import RecordPhase from './components/RecordPhase'
import CloningPhase from './components/CloningPhase'
import StoriesPhase from './components/StoriesPhase'
import SettingsDrawer from './components/SettingsDrawer'
import { OSContext, detectOS } from './utils/os'

export default function App() {
  const [os] = useState(detectOS)
  const [phase, setPhase] = useState('landing')
  const [email, setEmail] = useState('')
  const [voiceId, setVoiceId] = useState(() => localStorage.getItem('kidly_voice_id') || '')
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('kidly_session_token') || '')
  const [userDisplay, setUserDisplay] = useState(() => localStorage.getItem('kidly_user_display') || '')
  const [theme, setThemeState] = useState(() => localStorage.getItem('kidly_theme') || 'dark')
  const [fontSize, setFontSizeState] = useState(() => localStorage.getItem('kidly_font_size') || 'md')
  const [showSettings, setShowSettings] = useState(false)

  // Magic-link flow state
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [verifyError, setVerifyError] = useState('')

  const sessionTokenRef = useRef(sessionToken)
  useEffect(() => { sessionTokenRef.current = sessionToken }, [sessionToken])

  const applySettings = useCallback((s) => {
    if (!s) return
    if (s.theme) { setThemeState(s.theme); localStorage.setItem('kidly_theme', s.theme) }
    if (s.font_size) { setFontSizeState(s.font_size); localStorage.setItem('kidly_font_size', s.font_size) }
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

  useEffect(() => { document.documentElement.dataset.os = os }, [os])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => {
    const sizes = { sm: '14px', md: '16px', lg: '19px' }
    document.documentElement.style.fontSize = sizes[fontSize] || '16px'
  }, [fontSize])

  const [voiceJustCreated, setVoiceJustCreated] = useState(false)
  const [initialProgress, setInitialProgress] = useState(null)
  const [sessionId] = useState(() => {
    let id = localStorage.getItem('kidly_session')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('kidly_session', id) }
    return id
  })
  const [recordings, setRecordings] = useState([])

  const verifyToken = useCallback(async (token) => {
    setPhase('verifying')
    setVerifyError('')
    try {
      const r = await fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      const data = await r.json()
      if (!r.ok) {
        setVerifyError(data.detail || 'Link is invalid or expired. Please request a new one.')
        setPhase('landing')
        return
      }
      const { session_token, voice_id, email: verifiedEmail, is_new_user, settings } = data
      localStorage.setItem('kidly_session_token', session_token)
      setSessionToken(session_token)
      if (verifiedEmail) {
        setEmail(verifiedEmail)
        localStorage.setItem('kidly_user_display', verifiedEmail)
        setUserDisplay(verifiedEmail)
      }
      if (voice_id) {
        localStorage.setItem('kidly_voice_id', voice_id)
        setVoiceId(voice_id)
      }
      applySettings(settings)
      if (is_new_user) {
        setPhase('welcome')
      } else {
        setPhase('stories')
        fetch(`/api/user/settings?session_token=${encodeURIComponent(session_token)}`)
          .then(r => r.ok ? r.json() : null)
          .then(applySettings)
          .catch(() => {})
      }
    } catch {
      setVerifyError('Something went wrong. Please request a new link.')
      setPhase('landing')
    }
  }, [applySettings])

  // On mount: handle ?token= magic link, or restore existing session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      history.replaceState({}, '', window.location.pathname)
      verifyToken(token)
      return
    }
    if (voiceId && sessionToken) {
      setPhase('stories')
      fetch(`/api/user/settings?session_token=${encodeURIComponent(sessionToken)}`)
        .then(r => r.ok ? r.json() : null)
        .then(applySettings)
        .catch(() => {})
      return
    }
    // Session exists but no voice yet (setup was interrupted)
    if (!voiceId && sessionToken) {
      setPhase('welcome')
      return
    }
    // Clear stale voice_id with no session
    if (voiceId) {
      localStorage.removeItem('kidly_voice_id')
      setVoiceId('')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onSendLink = async (emailAddr) => {
    setSending(true)
    setSendError('')
    try {
      const r = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailAddr }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        setSendError(j.detail || 'Could not send link. Please try again.')
        return false
      }
      return true
    } catch {
      setSendError('Network error — please try again.')
      return false
    } finally {
      setSending(false)
    }
  }

  const onVoiceReady = (id, token) => {
    localStorage.setItem('kidly_voice_id', id)
    localStorage.setItem('kidly_session_token', token)
    setVoiceId(id)
    setSessionToken(token)
    setVoiceJustCreated(true)
    setPhase('stories')
  }

  const onReRecord = () => {
    localStorage.removeItem('kidly_voice_id')
    setVoiceId('')
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
    setUserDisplay('')
    setVoiceJustCreated(false)
    setRecordings([])
    setPhase('landing')
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
          onSendLink={onSendLink}
          sending={sending}
          sendError={sendError}
          verifyError={verifyError}
        />
      )}

      {phase === 'verifying' && (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-6xl">🌙</div>
            <div className="flex items-center gap-2 text-on-surface font-semibold">
              <span className="w-4 h-4 border-2 border-primary-container border-t-transparent rounded-full animate-spin" />
              Signing you in…
            </div>
          </div>
        </div>
      )}

      {phase === 'welcome' && (
        <WelcomeInterstitial
          email={email}
          onGetStarted={() => setPhase('record')}
        />
      )}

      {phase === 'record' && (
        <RecordPhase
          sessionId={sessionId}
          onBack={() => setPhase(sessionToken && !voiceId ? 'welcome' : 'landing')}
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
          sessionToken={sessionToken}
          onVoiceReady={onVoiceReady}
          onBack={() => setPhase('record')}
        />
      )}

      {phase === 'stories' && (
        <div key="ph-stories" style={{animation: 'fadeUp 0.35s ease-out both'}}>
          <StoriesPhase
            voiceId={voiceId}
            sessionToken={sessionToken}
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
