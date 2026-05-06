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
  const steps = ['Record', 'Clone', 'Stories']
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-sm font-medium ${
            i === step ? 'text-orange-500' : i < step ? 'text-green-500' : 'text-gray-300'
          }`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              i < step ? 'bg-green-500 text-white' : i === step ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-400'
            }`}>
              {i < step ? '✓' : i + 1}
            </span>
            {label}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-6 h-0.5 ${i < step ? 'bg-green-400' : 'bg-gray-200'}`} />
          )}
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

  const recRef    = useRef(null)
  const chunksRef = useRef([])
  const t0Ref     = useRef(null)
  const tickRef   = useRef(null)
  const takeRef   = useRef(take)
  takeRef.current = take

  useEffect(() => {
    // Check if mic permission was previously denied
    navigator.permissions?.query({ name: 'microphone' }).then(status => {
      if (status.state === 'denied') setMicBlocked(true)
      status.onchange = () => setMicBlocked(status.state === 'denied')
    }).catch(() => {})
    return () => {
      clearInterval(tickRef.current)
      try { recRef.current?.stop() } catch {}
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

      // Try formats in order; fall back to browser default if none match.
      // We read mr.mimeType AFTER construction — that's the format the browser
      // actually chose (e.g. Safari internally uses mp4 regardless of what we ask).
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
      const actualMime = mr.mimeType  // what the browser actually uses

      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: actualMime || 'audio/webm' })
        const ms   = Date.now() - t0Ref.current
        const isSilent = blob.size < (ms / 1000) * 500  // ~500 B/s minimum for any real audio
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
    <div className="space-y-6">

      {/* Microphone blocked — detected before click */}
      {micBlocked && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm leading-relaxed">
          Microphone is blocked for this site. Click the 🔒 icon in your browser's address bar, set Microphone to "Allow", then refresh the page.
        </div>
      )}

      {/* Microphone error — detected after click */}
      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm leading-relaxed">
          {err}
        </div>
      )}

      {/* Reading passage — always visible */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm max-h-60 overflow-y-auto">
        <p className="text-xs text-gray-400 mb-3 font-medium tracking-wide uppercase">Read this aloud ↕ scroll for more</p>
        <p className="text-gray-700 leading-9 whitespace-pre-line text-[15px]" style={{ fontFamily: 'Georgia, serif' }}>
          {SAMPLE_TEXT}
        </p>
      </div>

      {/* ── Phase: idle ── */}
      {phase === 'idle' && (
        <div className="text-center py-2">
          {starting ? (
            <div className="space-y-2">
              <div className="inline-flex items-center gap-3 px-8 py-3.5 bg-gray-100 rounded-full text-gray-600 font-semibold text-base">
                <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                Waiting for microphone…
              </div>
              <p className="text-xs text-amber-600 font-medium">
                Check your browser's address bar — it may be asking for microphone permission.
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={startRec}
                className="inline-flex items-center gap-3 px-10 py-3.5 bg-red-500 hover:bg-red-600 text-white rounded-full font-semibold text-base transition-colors shadow-md shadow-red-100"
              >
                <span className="w-3 h-3 bg-white rounded-full" />
                Start Recording
              </button>
              <p className="text-xs text-gray-400 mt-3">Read the passage above naturally — aim for 60–90 seconds</p>
            </>
          )}
        </div>
      )}

      {/* ── Phase: recording ── */}
      {phase === 'recording' && (
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-3 bg-red-50 border border-red-100 px-8 py-3 rounded-full">
            <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            <span className="font-mono text-2xl font-semibold text-gray-800 tabular-nums">{fmt(timer)}</span>
            {timer >= 60 && (
              <span className="text-green-600 text-xs font-bold bg-green-50 px-2 py-0.5 rounded-full">✓ enough</span>
            )}
          </div>
          <div>
            <button
              onClick={stopRec}
              className="px-8 py-2.5 bg-gray-800 hover:bg-gray-900 text-white rounded-full font-semibold transition-colors"
            >
              Stop Recording
            </button>
          </div>
          <p className="text-xs text-gray-400">Recording… keep going until you've read the whole passage</p>
        </div>
      )}

      {/* ── Phase: review ── */}
      {phase === 'review' && take && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-50">
            <div>
              <h3 className="font-semibold text-gray-800">Your recording</h3>
              <p className="text-xs text-gray-400 mt-0.5">Play it back — make sure your voice is clear</p>
            </div>
            <button
              onClick={reRecord}
              className="text-xs text-gray-400 hover:text-red-500 underline underline-offset-2 transition-colors shrink-0 ml-4"
            >
              ↺ Re-record
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Audio player */}
            <audio
              controls
              src={take.url}
              className="w-full"
              style={{ height: 40 }}
            />

            {/* Silent warning */}
            {take.isSilent && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-amber-800 text-sm leading-relaxed">
                ⚠️ This recording appears to have very little audio data. Try re-recording — if the problem persists, increase your microphone input level in System Settings → Sound → Input, or switch to Chrome.
              </div>
            )}

            {/* Duration status */}
            <div className={`flex items-center gap-2 text-sm font-medium ${hasEnough ? 'text-green-600' : 'text-amber-600'}`}>
              {hasEnough ? (
                <>
                  <span className="w-4 h-4 bg-green-500 text-white rounded-full flex items-center justify-center text-xs">✓</span>
                  {durationSec.toFixed(0)}s — good length!
                </>
              ) : (
                <>
                  <span className="w-4 h-4 bg-amber-400 text-white rounded-full flex items-center justify-center text-xs">!</span>
                  {durationSec.toFixed(0)}s — need {Math.ceil(60 - durationSec)}s more for a good voice clone
                </>
              )}
            </div>

            {/* Confirmation + upload — only when long enough */}
            {hasEnough ? (
              <>
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={e => setConfirmed(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-orange-500 shrink-0"
                  />
                  <span className="text-sm text-gray-600 leading-snug">
                    I've listened back and my voice sounds clear — no excessive background noise
                  </span>
                </label>

                <button
                  onClick={() => onReady([take])}
                  disabled={!confirmed}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-2xl font-semibold transition-colors"
                >
                  Upload & Continue →
                </button>
              </>
            ) : (
              /* Too short — prompt to re-record */
              <button
                onClick={reRecord}
                className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-2xl font-semibold transition-colors"
              >
                Re-record — read the full passage
              </button>
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
    <div className="space-y-4">

      <label
        className={`block border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? 'border-orange-500 bg-orange-50' : 'border-orange-200 hover:border-orange-400 hover:bg-orange-50'
        }`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
      >
        <input type="file" accept="audio/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        <div className="text-4xl mb-2">📂</div>
        <p className="text-gray-700 font-semibold">Drop audio files here</p>
        <p className="text-gray-400 text-sm mt-1">or click to browse — mp3 · m4a · wav · webm · ogg</p>
      </label>

      {hasSilent && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-amber-800 text-sm">
          ⚠️ One or more files appear very quiet. Play them back to confirm your voice is clearly audible.
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-xl px-4 py-2 border ${
              f.isSilent ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'
            }`}>
              <audio controls src={f.url} className="flex-1 h-8" style={{ minWidth: 0 }} />
              <span className="text-xs text-gray-400 shrink-0">
                {f.durationMs ? `${(f.durationMs / 1000).toFixed(1)}s` : '?'}
              </span>
              {f.isSilent && <span className="text-xs text-amber-600 shrink-0">quiet</span>}
              <button onClick={() => removeFile(i)} className="text-gray-300 hover:text-red-400 shrink-0">✕</button>
            </div>
          ))}

          {allUnknown ? (
            <p className="text-sm font-medium text-amber-600">
              ⚠️ Couldn't detect audio length — please make sure your recording is at least 60 seconds.
            </p>
          ) : (
            <p className={`text-sm font-medium ${hasEnough ? 'text-green-600' : 'text-amber-600'}`}>
              Total: {knownSec.toFixed(0)}s
              {hasEnough ? ' ✓ Ready!' : ` — need ${Math.ceil(60 - knownSec)}s more`}
            </p>
          )}

          <button
            onClick={() => onReady(fakeTakes)}
            disabled={!hasEnough}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-2xl font-semibold transition-colors"
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
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <ProgressBar step={0} />

        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1">
          ← Back
        </button>

        <h2 className="text-2xl font-bold text-gray-800 mb-1">Record your voice</h2>
        <p className="text-gray-500 text-sm mb-6">
          Read the passage aloud naturally. Aim for 60–90 seconds — the more the better.
        </p>

        {/* Tab switcher */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
          <button
            onClick={() => setMode('record')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'record' ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            🎙 Record Live
          </button>
          <button
            onClick={() => setMode('upload')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'upload' ? 'bg-white shadow text-gray-800' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            📁 Upload File
          </button>
        </div>

        {mode === 'record' && <RecordLive onReady={onRecordingsReady} />}
        {mode === 'upload' && <UploadFiles onReady={onRecordingsReady} />}
      </div>
    </div>
  )
}
