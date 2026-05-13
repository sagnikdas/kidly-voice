import { useState, useRef, useEffect } from 'react'

const SAMPLE_TEXT = `Hello, my little one. I'm recording my voice just for you — so whenever you want to hear me, I'll always be right here.

Every day I watch you grow braver, kinder, and more wonderful than the day before. You make me so proud in ways I never knew were possible.

When things feel scary or too big, close your eyes and listen to my voice. I am with you. I am always with you.

The world ahead is full of beautiful things — mountains to climb, new friends to meet, music that will make your heart dance, and stories still waiting to be lived. There is so much goodness ahead of you.

And no matter how tall you grow, no matter where life takes you, you will always be my child. And I will always be right here.

Now settle in, get comfortable, and let me tell you a story. Once upon a time, in a land not so very far away, something truly wonderful was about to begin.`

function fmt(s) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function ProgressBar({ step }) {
  const steps = ['Record', 'Create Voice', 'Stories']
  return (
    <div className="flex gap-2 w-full max-w-[300px]">
      {steps.map((label, i) => (
        <div key={label} className="flex flex-col items-center gap-1 flex-1">
          <div className={`h-2.5 w-full rounded-full transition-colors ${
            i < step ? 'bg-secondary-fixed' : i === step ? 'bg-primary-container' : 'bg-surface-container-highest'
          }`} />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${
            i === step ? 'text-primary-container' : i < step ? 'text-secondary-fixed' : 'text-on-surface-variant'
          }`}>{label}</span>
        </div>
      ))}
    </div>
  )
}

function micErrMsg(e) {
  if (!e) return 'Could not access microphone.'
  switch (e.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone permission denied. Click the 🔒 icon in your address bar, allow microphone, then refresh and try again.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone found. Please connect a microphone and try again.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Microphone is in use by another app. Close other apps using the mic and try again.'
    case 'OverconstrainedError':
      return 'Microphone constraints could not be satisfied. Try a different browser.'
    default:
      return `Microphone error (${e.name}): ${e.message || 'unknown'}. Try refreshing the page.`
  }
}

// ─── Record Live ────────────────────────────────────────────────────────────

function RecordLive({ onReady }) {
  // phase: 'idle' | 'recording' | 'review'
  const [phase, setPhase] = useState('idle')
  const [take, setTake] = useState(null)
  const [timer, setTimer] = useState(0)
  const [err, setErr] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [starting, setStarting] = useState(false)   // waiting for mic permission
  const [micBlocked, setMicBlocked] = useState(false)
  const [micLevel, setMicLevel] = useState(0)        // 0–100, live mic volume

  const recRef      = useRef(null)
  const chunksRef   = useRef([])
  const t0Ref       = useRef(null)
  const tickRef     = useRef(null)
  const levelRafRef = useRef(null)
  const analyserRef = useRef(null)
  const audioCtxRef = useRef(null)
  const takeRef     = useRef(take)
  takeRef.current   = take

  useEffect(() => {
    navigator.permissions?.query({ name: 'microphone' }).then(status => {
      if (status.state === 'denied') setMicBlocked(true)
      status.onchange = () => setMicBlocked(status.state === 'denied')
    }).catch(() => {})
    return () => {
      clearInterval(tickRef.current)
      cancelAnimationFrame(levelRafRef.current)
      try { recRef.current?.stop() } catch {}
      try { audioCtxRef.current?.close() } catch {}
      if (takeRef.current?.url) URL.revokeObjectURL(takeRef.current.url)
    }
  }, [])

  const startRec = async () => {
    if (starting) return
    setErr('')
    setStarting(true)
    if (!navigator.mediaDevices?.getUserMedia) {
      setStarting(false)
      setErr('Your browser does not support audio recording. Please try Chrome or Safari.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      setStarting(false)

      // Live mic level meter via Web Audio analyser
      try {
        const ctx      = new AudioContext()
        audioCtxRef.current = ctx
        const source   = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
        const buf = new Uint8Array(analyser.frequencyBinCount)
        const pollLevel = () => {
          analyser.getByteFrequencyData(buf)
          const avg = buf.reduce((s, v) => s + v, 0) / buf.length
          setMicLevel(Math.min(100, Math.round(avg * 2.5)))
          levelRafRef.current = requestAnimationFrame(pollLevel)
        }
        pollLevel()
      } catch {}

      // Try formats in order; fall back to browser default if none match.
      const CANDIDATES = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'video/mp4',
        '',
      ]
      const preferred = CANDIDATES.find(m => m === '' || MediaRecorder.isTypeSupported(m)) ?? ''
      let mr
      try {
        mr = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream)
      } catch {
        mr = new MediaRecorder(stream)
      }
      const actualMime = mr.mimeType

      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        cancelAnimationFrame(levelRafRef.current)
        setMicLevel(0)
        try { audioCtxRef.current?.close(); audioCtxRef.current = null } catch {}
        const blob = new Blob(chunksRef.current, { type: actualMime || 'audio/webm' })
        const ms   = Date.now() - t0Ref.current
        const isSilent = blob.size < (ms / 1000) * 200
        setTake({ blob, ms, url: URL.createObjectURL(blob), mime: actualMime, isSilent, isFile: false })
        setPhase('review')
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start(100)
      t0Ref.current = Date.now()
      recRef.current = mr
      setTimer(0)
      setPhase('recording')
      tickRef.current = setInterval(() => setTimer(s => s + 1), 1000)
    } catch (e) {
      setStarting(false)
      setErr(micErrMsg(e))
    }
  }

  const stopRec = () => {
    recRef.current?.stop()
    clearInterval(tickRef.current)
    // phase moves to 'review' inside mr.onstop
  }

  const reRecord = () => {
    if (take?.url) URL.revokeObjectURL(take.url)
    setTake(null)
    setConfirmed(false)
    setPhase('idle')
  }

  const durationSec = take ? take.ms / 1000 : 0
  const hasEnough   = durationSec >= 60

  return (
    <div className="w-full space-y-5">

      {/* Microphone blocked — detected before click */}
      {micBlocked && (
        <div className="bg-error-container/20 border border-error/30 rounded-xl px-4 py-3 text-error text-sm leading-relaxed">
          Microphone is blocked for this site. Click the 🔒 icon in your browser's address bar, set Microphone to "Allow", then refresh the page.
        </div>
      )}

      {/* Microphone error — detected after click */}
      {err && (
        <div className="bg-error-container/20 border border-error/30 rounded-xl px-4 py-3 text-error text-sm leading-relaxed">
          {err}
        </div>
      )}

      {/* Reading passage — always visible */}
      <div className="w-full bg-surface-container-high rounded-xl p-5 relative overflow-hidden border border-outline-variant/20">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-primary-container rounded-l-xl" />
        <div className="pl-4">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Read Aloud</span>
            <span className="material-symbols-outlined ms-fill text-secondary text-xl">auto_stories</span>
          </div>
          <div className="max-h-52 overflow-y-auto no-scrollbar">
            <p className="text-on-surface leading-9 whitespace-pre-line text-[15px] italic font-medium">{SAMPLE_TEXT}</p>
          </div>
          <div className="flex items-center gap-2 mt-3 text-secondary-fixed text-sm">
            <span className="material-symbols-outlined text-sm">info</span>
            <span className="text-xs text-on-surface-variant">Speak naturally, like reading a bedtime story</span>
          </div>
        </div>
      </div>

      {/* ── Phase: idle ── */}
      {phase === 'idle' && (
        <div className="text-center py-4">
          {starting ? (
            <div className="space-y-3">
              <div className="w-24 h-24 rounded-full bg-surface-container-highest flex items-center justify-center mx-auto animate-pulse">
                <span className="material-symbols-outlined text-on-surface-variant" style={{fontSize:48}}>mic</span>
              </div>
              <p className="text-sm text-on-surface-variant">Waiting for microphone…</p>
              <p className="text-xs text-primary-fixed">Check your browser for a permission prompt.</p>
            </div>
          ) : (
            <>
              <button onClick={startRec} className="w-24 h-24 rounded-full bg-primary-container flex items-center justify-center mx-auto btn-3d-sm glow-primary">
                <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:48}}>mic</span>
              </button>
              <p className="text-primary-fixed font-semibold mt-4 text-lg">Tap to Record</p>
              <p className="text-xs text-on-surface-variant mt-2">Read the passage above naturally — aim for at least 60 seconds</p>
            </>
          )}
        </div>
      )}

      {/* ── Phase: recording ── */}
      {phase === 'recording' && (
        <div className="text-center space-y-4">
          {/* Timer */}
          <div className="inline-flex items-center gap-3 bg-surface-container-high border border-outline-variant/30 px-8 py-3 rounded-full">
            <span className="w-3 h-3 bg-error rounded-full animate-pulse" />
            <span className="font-mono text-2xl font-bold text-on-surface tabular-nums">{fmt(timer)}</span>
            {timer >= 60 && <span className="text-xs font-bold text-secondary-fixed bg-secondary-container/30 px-2 py-0.5 rounded-full">✓ enough</span>}
          </div>
          {/* Waveform bars */}
          <div className="flex items-center justify-center gap-1.5 h-16">
            {Array.from({length:11}).map((_,i) => {
              const base = 12 + i * 3
              const active = micLevel > (i/11)*100
              return (
                <div key={i} className="w-2 rounded-full transition-all duration-75"
                  style={{ height: active ? Math.max(base, (micLevel/100)*56) : base,
                    backgroundColor: active ? '#ffd600' : '#393528' }} />
              )
            })}
          </div>
          {micLevel < 5 && <p className="text-xs text-error">⚠️ No mic signal — check System Settings → Sound → Input</p>}
          <button onClick={stopRec} className="px-8 py-3 bg-surface-container-high hover:bg-surface-container-highest text-on-surface rounded-full font-semibold transition-colors border border-outline-variant/30">
            Stop Recording
          </button>
        </div>
      )}

      {/* ── Phase: review ── */}
      {phase === 'review' && take && (
        <div className="w-full bg-surface-container-high rounded-xl overflow-hidden border border-outline-variant/20">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-outline-variant/20">
            <div>
              <h3 className="font-semibold text-on-surface">Your recording</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">Play it back — make sure your voice is clear</p>
            </div>
            <button onClick={reRecord} className="text-xs text-on-surface-variant hover:text-error underline underline-offset-2 transition-colors">↺ Re-record</button>
          </div>
          <div className="px-5 py-4 space-y-4">
            <audio controls src={take.url} className="w-full" style={{height:40}} />
            {take.isSilent && <div className="bg-error-container/20 border border-error/30 rounded-xl px-4 py-3 text-error text-sm">⚠️ Very little audio — try re-recording with microphone level increased.</div>}
            <div className={`flex items-center gap-2 text-sm font-medium ${hasEnough ? 'text-secondary-fixed' : 'text-primary-fixed'}`}>
              {hasEnough ? <>
                <span className="w-5 h-5 bg-secondary-container rounded-full flex items-center justify-center text-xs text-on-secondary-container">✓</span>
                {durationSec.toFixed(0)}s — good length!
              </> : <>
                <span className="w-5 h-5 bg-primary-container rounded-full flex items-center justify-center text-xs text-on-primary-container">!</span>
                {durationSec.toFixed(0)}s — need {Math.ceil(60 - durationSec)}s more
              </>}
            </div>
            {hasEnough ? (<>
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-primary-container shrink-0" />
                <span className="text-sm text-on-surface-variant leading-snug">I've listened back and my voice sounds clear — no excessive background noise</span>
              </label>
              <button onClick={() => onReady([take])} disabled={!confirmed} className="w-full py-3.5 bg-primary-container text-on-primary-container rounded-full font-bold transition-all btn-3d disabled:opacity-40 disabled:cursor-not-allowed glow-primary">
                Upload & Continue →
              </button>
            </>) : (
              <button onClick={reRecord} className="w-full py-3.5 bg-surface-container-highest text-on-surface rounded-full font-semibold transition-colors">Re-record — read the full passage</button>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

// ─── Upload Files ────────────────────────────────────────────────────────────

function UploadFiles({ onReady }) {
  const [files, setFiles]     = useState([])
  const [dragging, setDragging] = useState(false)
  const filesRef = useRef(files)
  filesRef.current = files

  useEffect(() => () => {
    filesRef.current.forEach(f => { try { URL.revokeObjectURL(f.url) } catch {} })
  }, [])

  const getAudioDuration = (file) =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file)
      const a = new Audio()
      a.preload = 'metadata'
      const t = setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} resolve(null) }, 3000)
      a.onloadedmetadata = () => {
        clearTimeout(t)
        try { URL.revokeObjectURL(url) } catch {}
        resolve(isFinite(a.duration) ? Math.round(a.duration * 1000) : null)
      }
      a.onerror = () => { clearTimeout(t); resolve(null) }
      a.src = url
    })

  const addFiles = async (fileList) => {
    const entries = await Promise.all(
      Array.from(fileList).map(async (file) => {
        const durationMs = await getAudioDuration(file)
        const isSilent = durationMs ? file.size < (durationMs / 1000) * 1000 : false
        return { file, url: URL.createObjectURL(file), durationMs, isSilent }
      })
    )
    setFiles(prev => [...prev, ...entries])
  }

  const removeFile = (i) => {
    setFiles(prev => {
      URL.revokeObjectURL(prev[i].url)
      return prev.filter((_, j) => j !== i)
    })
  }

  const knownSec      = files.reduce((s, f) => s + (f.durationMs || 0) / 1000, 0)
  const allUnknown    = files.length > 0 && files.every(f => f.durationMs === null)
  const hasEnough     = knownSec >= 60 || allUnknown
  const hasSilent     = files.some(f => f.isSilent)

  const fakeTakes = files.map(f => ({
    blob: f.file,
    ms:   f.durationMs || 0,
    url:  f.url,
    mime: f.file.type || 'audio/mpeg',
    isFile: true,
  }))

  return (
    <div className="w-full space-y-4">

      <label
        className={`block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? 'border-primary-container bg-primary-container/10' : 'border-outline-variant hover:border-primary-container/50 hover:bg-surface-container-high'
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        <input type="file" accept="audio/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        <div className="text-4xl mb-2">📂</div>
        <p className="text-on-surface font-semibold">Drop audio files here</p>
        <p className="text-on-surface-variant text-sm mt-1">or click to browse — mp3 · m4a · wav · webm</p>
      </label>

      {hasSilent && (
        <div className="bg-error-container/20 border border-error/30 rounded-xl px-4 py-3 text-error text-sm">
          ⚠️ One or more files appear very quiet. Play them back to confirm your voice is clearly audible.
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-xl px-4 py-2 border ${
              f.isSilent ? 'bg-error-container/10 border-error/20' : 'bg-surface-container-high border-outline-variant/20'
            }`}>
              <audio controls src={f.url} className="flex-1 h-8" style={{ minWidth: 0 }} />
              <span className="text-xs text-on-surface-variant shrink-0">
                {f.durationMs ? `${(f.durationMs / 1000).toFixed(1)}s` : '?'}
              </span>
              {f.isSilent && <span className="text-xs text-error shrink-0">quiet</span>}
              <button onClick={() => removeFile(i)} className="text-on-surface-variant hover:text-error shrink-0">✕</button>
            </div>
          ))}

          {allUnknown ? (
            <p className="text-sm font-medium text-primary-fixed">
              ⚠️ Couldn't detect audio length — please make sure your recording is at least 60 seconds.
            </p>
          ) : (
            <p className={`text-sm font-medium ${hasEnough ? 'text-secondary-fixed' : 'text-primary-fixed'}`}>
              Total: {knownSec.toFixed(0)}s
              {hasEnough ? ' ✓ Ready!' : ` — need ${Math.ceil(60 - knownSec)}s more`}
            </p>
          )}

          <button
            onClick={() => onReady(fakeTakes)}
            disabled={!hasEnough}
            className="w-full py-3.5 bg-primary-container text-on-primary-container rounded-full font-bold transition-all btn-3d disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
          >
            Upload & Continue →
          </button>
        </div>
      )}

    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function RecordPhase({ sessionId, onBack, onRecordingsReady }) {
  const [mode, setMode] = useState('record')

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 h-14 bg-surface border-b border-outline-variant/20">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined">arrow_back_ios_new</span>
          </button>
          <h1 className="text-lg font-bold text-primary-container">Kidly</h1>
        </div>
      </header>

      <main className="pt-20 pb-24 px-6 max-w-[680px] mx-auto flex flex-col items-center">
        {/* Step indicator */}
        <div className="w-full flex flex-col items-center gap-2 mb-8">
          <span className="text-xs font-bold text-secondary-fixed uppercase tracking-widest">Step 1 of 3</span>
          <ProgressBar step={0} />
          <h2 className="text-xl font-semibold text-on-surface mt-1">
            {mode === 'record' ? 'Record Your Voice' : 'Upload Audio'}
          </h2>
        </div>

        {/* Tab switcher */}
        <div className="w-full flex bg-surface-container-high rounded-xl p-1 mb-6 gap-1">
          <button
            onClick={() => setMode('record')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mode === 'record' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            🎙 Record Live
          </button>
          <button
            onClick={() => setMode('upload')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              mode === 'upload' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            📁 Upload File
          </button>
        </div>

        <div className={mode === 'record' ? '' : 'hidden'}><RecordLive onReady={onRecordingsReady} /></div>
        <div className={mode === 'upload' ? '' : 'hidden'}><UploadFiles onReady={onRecordingsReady} /></div>
      </main>
    </div>
  )
}
