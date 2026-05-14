import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { haptic } from '../utils/haptic'
import { useOS } from '../utils/os'

function buildEvenTimings(text, duration) {
  if (!duration || !text) return []
  const wordCount = text.split(/\n\n+/).reduce((n, para) => {
    return n + para.split(/(\s+)/).filter(p => !/^\s+$/.test(p) && p.length > 0).length
  }, 0)
  if (!wordCount) return []
  const perWord = duration / wordCount
  return Array.from({ length: wordCount }, (_, i) => ({
    start: i * perWord,
    end: (i + 1) * perWord,
  }))
}

function findWordIdx(words, time) {
  let lo = 0, hi = words.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].end < time) lo = mid + 1
    else if (words[mid].start > time) hi = mid - 1
    else return mid
  }
  return lo < words.length ? lo : -1
}

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function fmtSleep(s) {
  if (!s || s <= 0) return '--'
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Generates looping ambient sound via Web Audio API.
// type: null | 'rain' | 'forest' | 'ocean' | 'brown' — null stops playback.
function useAmbientSound(type) {
  useEffect(() => {
    if (!type) return
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    let ctx
    try { ctx = new AudioCtx() } catch { return }

    const frameCount = Math.floor(ctx.sampleRate * 10)
    const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
    const data = buffer.getChannelData(0)

    if (type === 'brown') {
      // Integrate white noise — each sample is a weighted sum of the previous,
      // producing a spectrum that rolls off at 6 dB/octave (deep, warm rumble).
      let last = 0
      for (let i = 0; i < frameCount; i++) {
        const w = Math.random() * 2 - 1
        last = (last + 0.02 * w) / 1.02
        data[i] = last * 3.5
      }
    } else {
      // Pink noise (Paul Kellett's method) — 3 dB/octave roll-off, natural-sounding.
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0
      for (let i = 0; i < frameCount; i++) {
        const w = Math.random() * 2 - 1
        b0 = 0.99886*b0 + w*0.0555179
        b1 = 0.99332*b1 + w*0.0750759
        b2 = 0.96900*b2 + w*0.1538520
        b3 = 0.86650*b3 + w*0.3104856
        b4 = 0.55000*b4 + w*0.5329522
        b5 = -0.7616*b5 - w*0.0168980
        data[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11
        b6 = w * 0.115926
      }
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'

    const gain = ctx.createGain()
    gain.gain.value = 0

    const cfgs = {
      rain:   { freq: 1000, Q: 0.7, vol: 0.28 },
      forest: { freq: 280,  Q: 0.7, vol: 0.13 },
      ocean:  { freq: 400,  Q: 0.5, vol: 0.12 },
      brown:  { freq: 600,  Q: 0.5, vol: 0.20 },
    }
    const { freq, Q, vol } = cfgs[type]
    filter.frequency.value = freq
    filter.Q.value = Q

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    source.start()
    ctx.resume().catch(() => {})
    gain.gain.setTargetAtTime(vol, ctx.currentTime, 2.0)

    // Ocean: slow LFO (~0.1 Hz) on gain to simulate the swell and retreat of waves.
    let lfo = null
    if (type === 'ocean') {
      lfo = ctx.createOscillator()
      lfo.frequency.value = 0.1
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 0.08
      lfo.connect(lfoGain)
      lfoGain.connect(gain.gain)
      lfo.start()
    }

    return () => {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.8)
      lfo?.stop()
      setTimeout(() => { try { source.stop(); ctx.close() } catch {} }, 2000)
    }
  }, [type])
}

function Confetti({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000)
    return () => clearTimeout(t)
  }, [onDone])

  const particles = useMemo(() =>
    Array.from({ length: 28 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      color: ['#ffd600','#7fd6c3','#ff6b6b','#a78bfa','#34d399','#fb923c'][i % 6],
      size: 6 + Math.floor(Math.random() * 10),
      delay: `${(Math.random() * 1.5).toFixed(2)}s`,
      duration: `${(3.5 + Math.random() * 2.0).toFixed(2)}s`,
      borderRadius: i % 3 === 0 ? '50%' : '3px',
    }))
  , [])

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none overflow-hidden">
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute',
          left: p.left,
          top: '-20px',
          width: p.size,
          height: p.size,
          background: p.color,
          borderRadius: p.borderRadius,
          animation: `confettiFall ${p.duration} ${p.delay} ease-in forwards`,
        }} />
      ))}
    </div>
  )
}

const SPEEDS = [1, 0.8, 1.2]
const AMBIENTS = [null, 'rain', 'forest', 'ocean', 'brown']
const SLEEP_OPTIONS = [null, 10, 15, 20, 25, 30, 45]
const AMBIENT_LABEL = { rain: '🌧 Rain', forest: '🌲 Forest', ocean: '🌊 Ocean', brown: '☁️ Brown' }

export default function StoryReader({ title, emoji, text, audioUrl, onClose, onOpenSettings }) {
  const os = useOS()
  const [highlightOn, setHighlightOn] = useState(true)
  const [currentWordIdx, setCurrentWordIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [ambient, setAmbient] = useState(null)
  const [sleepMins, setSleepMins] = useState(null)
  const [sleepRemaining, setSleepRemaining] = useState(null)
  const [showConfetti, setShowConfetti] = useState(false)
  const [readAlong, setReadAlong] = useState(false)
  const [currentParaIdx, setCurrentParaIdx] = useState(-1)

  const audioRef = useRef(null)
  const progressBarRef = useRef(null)
  const wordRefs = useRef([])
  const paraRefs = useRef([])
  const wordParaMapRef = useRef([])
  const currentParaIdxRef = useRef(-1)
  const readAlongRef = useRef(false)
  useEffect(() => { readAlongRef.current = readAlong }, [readAlong])
  const userScrollingRef = useRef(false)
  const scrollResumeTimerRef = useRef(null)
  const playingRef = useRef(false)
  const [scrollLocked, setScrollLocked] = useState(false)

  useAmbientSound(ambient)

  // Apply playback speed
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed])

  // Sleep timer — counts down and pauses audio when it expires
  useEffect(() => {
    if (!sleepMins) { setSleepRemaining(null); return }
    const endTime = Date.now() + sleepMins * 60_000
    setSleepRemaining(sleepMins * 60)
    const tick = setInterval(() => {
      const rem = Math.round((endTime - Date.now()) / 1000)
      if (rem <= 0) {
        audioRef.current?.pause()
        setAmbient(null)
        setSleepMins(null)
        setSleepRemaining(null)
        clearInterval(tick)
      } else {
        setSleepRemaining(rem)
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [sleepMins])

  // Reset read-along paragraph state when mode is toggled off
  useEffect(() => {
    if (!readAlong) { currentParaIdxRef.current = -1; setCurrentParaIdx(-1) }
  }, [readAlong])

  const wordTimings = useMemo(() => buildEvenTimings(text, duration), [text, duration])

  const handleTimeUpdate = useCallback(() => {
    const t = audioRef.current?.currentTime ?? 0
    setCurrentTime(t)
    if (!wordTimings.length) return
    const idx = findWordIdx(wordTimings, t)
    setCurrentWordIdx(idx)
    if (idx < 0 || userScrollingRef.current) return
    if (readAlongRef.current) {
      const paraIdx = wordParaMapRef.current[idx] ?? -1
      if (paraIdx !== currentParaIdxRef.current) {
        currentParaIdxRef.current = paraIdx
        setCurrentParaIdx(paraIdx)
        if (paraIdx >= 0) paraRefs.current[paraIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    } else {
      wordRefs.current[idx]?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
  }, [wordTimings])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => { setPlaying(true); playingRef.current = true }
    const onPause = () => {
      setPlaying(false); playingRef.current = false
      clearTimeout(scrollResumeTimerRef.current)
      userScrollingRef.current = false; setScrollLocked(false)
    }
    const onEnded = () => {
      setPlaying(false); playingRef.current = false
      setCurrentWordIdx(-1); setShowConfetti(true)
      clearTimeout(scrollResumeTimerRef.current)
      userScrollingRef.current = false; setScrollLocked(false)
    }
    const onMeta = () => setDuration(audio.duration)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('loadedmetadata', onMeta)
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('loadedmetadata', onMeta)
    }
  }, [handleTimeUpdate])

  useEffect(() => {
    audioRef.current?.play().catch(() => {})
    return () => { audioRef.current?.pause() }
  }, [audioUrl])

  useEffect(() => {
    window.history.pushState({ kidlyReader: true }, '')
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [onClose])

  const togglePlay = () => {
    haptic.medium()
    audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()
  }

  const seekToClient = useCallback((clientX) => {
    if (!duration || !audioRef.current || !progressBarRef.current) return
    const rect = progressBarRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    audioRef.current.currentTime = ratio * duration
  }, [duration])

  // Non-passive touch listeners so e.preventDefault() actually suppresses scroll while seeking.
  useEffect(() => {
    const bar = progressBarRef.current
    if (!bar) return
    const seek = (e) => { e.preventDefault(); seekToClient(e.touches[0].clientX) }
    bar.addEventListener('touchstart', seek, { passive: false })
    bar.addEventListener('touchmove', seek, { passive: false })
    return () => {
      bar.removeEventListener('touchstart', seek)
      bar.removeEventListener('touchmove', seek)
    }
  }, [seekToClient])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { window.history.back(); return }
      if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleManualScroll = useCallback(() => {
    if (!playingRef.current) return
    if (!userScrollingRef.current) { userScrollingRef.current = true; setScrollLocked(true) }
    clearTimeout(scrollResumeTimerRef.current)
    scrollResumeTimerRef.current = setTimeout(() => {
      userScrollingRef.current = false; setScrollLocked(false)
    }, 4000)
  }, [])

  const cycleSpeed = () => { haptic.select(); setSpeed(s => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]) }
  const cycleAmbient = () => { haptic.select(); setAmbient(a => AMBIENTS[(AMBIENTS.indexOf(a) + 1) % AMBIENTS.length]) }
  const cycleSleep = () => { haptic.light(); setSleepMins(s => SLEEP_OPTIONS[(SLEEP_OPTIONS.indexOf(s) + 1) % SLEEP_OPTIONS.length]) }

  // Render text with per-word spans; also populate wordParaMapRef for read-along paragraph tracking.
  wordParaMapRef.current = []
  let wIdx = 0
  const paragraphs = text.split(/\n\n+/)
  const renderedText = paragraphs.map((para, pIdx) => {
    const isActivePara = readAlong && pIdx === currentParaIdx
    const parts = para.split(/(\s+)/)
    const nodes = parts.map((part, partIdx) => {
      if (/^\s+$/.test(part)) return <span key={partIdx}>{part}</span>
      wordParaMapRef.current[wIdx] = pIdx
      const myIdx = wIdx++
      const active = highlightOn && myIdx === currentWordIdx
      return (
        <span
          key={partIdx}
          ref={el => { wordRefs.current[myIdx] = el }}
          style={{
            backgroundColor: active ? 'rgba(255,214,0,0.3)' : 'transparent',
            borderRadius: active ? '4px' : undefined,
            padding: active ? '0 2px' : undefined,
            transition: 'background-color 0.1s',
          }}
        >
          {part}
        </span>
      )
    })
    return (
      <p
        key={pIdx}
        ref={el => { paraRefs.current[pIdx] = el }}
        style={{
          marginBottom: readAlong ? '2rem' : '1.6rem',
          opacity: readAlong && currentParaIdx >= 0 ? (isActivePara ? 1 : 0.4) : 1,
          borderLeft: readAlong ? `3px solid ${isActivePara ? 'rgba(255,214,0,0.7)' : 'transparent'}` : 'none',
          paddingLeft: readAlong ? '12px' : '0',
          transition: 'opacity 0.4s, border-color 0.4s',
        }}
      >
        {nodes}
      </p>
    )
  })

  const progress = duration ? (currentTime / duration) * 100 : 0
  const sleepDisplay = sleepMins
    ? (sleepRemaining ? fmtSleep(sleepRemaining) : `${sleepMins}m`)
    : 'Sleep'

  const goBack = () => { haptic.light(); window.history.back() }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-on-surface anim-reader" style={{animation: 'readerEnter 0.38s cubic-bezier(0.22, 1, 0.36, 1) both'}}>
      {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

      {/* Header — iOS: centered title + ‹ Stories back text; Android: left brand + icon back */}
      {os === 'ios' ? (
        <header className="fixed top-0 w-full z-10 flex items-center justify-between px-4 bg-surface/95 backdrop-blur-md border-b border-outline-variant/20 h-header safe-top relative">
          {/* iOS back: chevron + "Stories" label (HIG nav bar pattern) */}
          <button onClick={goBack} className="flex items-center gap-0.5 min-h-[44px] min-w-[80px] transition-opacity">
            <span className="material-symbols-outlined text-primary-container" style={{fontSize:22}}>chevron_left</span>
            <span className="text-sm font-semibold text-primary-container">Stories</span>
          </button>
          {/* Centered title — absolute so left/right buttons can be independent */}
          <span className="absolute left-1/2 -translate-x-1/2 text-base font-bold text-on-surface pointer-events-none">Kidly</span>
          {/* Right: icon-only actions to stay compact */}
          <div className="flex items-center gap-0.5 min-w-[80px] justify-end">
            <button
              onClick={() => setHighlightOn(h => !h)}
              className={`flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full transition-opacity ${highlightOn ? 'text-primary-fixed' : 'text-on-surface-variant'}`}
              title={highlightOn ? 'Highlight on' : 'Highlight off'}
            >
              <span className="text-base">{highlightOn ? '✦' : '◇'}</span>
            </button>
            <button onClick={onOpenSettings} className="flex items-center justify-center min-w-[44px] min-h-[44px] text-on-surface-variant transition-opacity">
              <span className="material-symbols-outlined" style={{fontSize:22}}>settings</span>
            </button>
          </div>
        </header>
      ) : (
        <header className="fixed top-0 w-full z-10 flex justify-between items-center px-5 bg-surface border-b border-outline-variant/20 h-header safe-top">
          <div className="flex items-center gap-1">
            {/* Android: standard back arrow (Material icon, no text label) */}
            <button onClick={goBack} className="flex items-center justify-center min-w-[44px] min-h-[44px] active:opacity-75 transition-opacity">
              <span className="material-symbols-outlined text-on-surface-variant">
                {os === 'android' ? 'arrow_back' : 'arrow_back_ios_new'}
              </span>
            </button>
            <button onClick={goBack} className="text-2xl font-extrabold text-primary-container tracking-tight active:opacity-75 transition-opacity">
              Kidly
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high rounded-full border border-outline-variant/30">
            <span className="material-symbols-outlined ms-fill text-secondary text-base">record_voice_over</span>
            <span className="text-xs font-bold text-secondary">In Your Voice</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHighlightOn(h => !h)}
              className={`flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-full border transition-colors min-h-[44px] ${highlightOn ? 'bg-primary-container/20 border-primary-container/40 text-primary-fixed' : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'}`}
            >
              {highlightOn ? '✦ Highlight' : '◇ Highlight'}
            </button>
            <button onClick={onOpenSettings} className="flex items-center justify-center min-w-[44px] min-h-[44px] text-on-surface-variant active:text-on-surface transition-colors">
              <span className="material-symbols-outlined" style={{fontSize:22}}>settings</span>
            </button>
          </div>
        </header>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pt-header pb-80" onScroll={handleManualScroll}>
        {/* Story emoji illustration — hero scale-in */}
        <div className="w-full max-w-[700px] mx-auto px-5 mb-6" style={{animation: 'heroScale 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.12s both'}}>
          <div className="relative aspect-[4/2] rounded-xl overflow-hidden bg-gradient-to-br from-surface-container to-surface-container-highest flex items-center justify-center border-4 border-surface-container-highest">
            <span className="text-[80px]">{emoji || '📖'}</span>
            <div className="absolute inset-0" style={{background: 'radial-gradient(circle at center, transparent 0%, rgba(22,19,9,0.4) 100%)'}} />
          </div>
        </div>

        {/* Story title and text */}
        <div className="w-full max-w-[700px] mx-auto px-5 text-center mb-6">
          <h1 className="text-2xl font-bold text-primary-fixed mb-4">{title}</h1>
          <div
            className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10 text-left"
            style={{
              fontFamily: "'Quicksand', sans-serif",
              fontSize: readAlong ? '1.45rem' : '1.1rem',
              lineHeight: readAlong ? 2.3 : 2,
              color: 'var(--color-on-surface)',
              transition: 'font-size 0.3s, line-height 0.3s',
            }}
          >
            {renderedText}
            <div style={{height: 20}} />
          </div>
        </div>
      </div>

      {/* Back-to-reading snap button — shown when user has manually scrolled away during playback */}
      {scrollLocked && playing && (
        <button
          onClick={() => {
            clearTimeout(scrollResumeTimerRef.current)
            userScrollingRef.current = false
            setScrollLocked(false)
            const idx = currentWordIdx
            if (readAlongRef.current) {
              const paraIdx = wordParaMapRef.current[idx] ?? -1
              if (paraIdx >= 0) paraRefs.current[paraIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            } else if (idx >= 0) {
              wordRefs.current[idx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }
          }}
          className="fixed left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold shadow-xl"
          style={{
            bottom: 'calc(230px + var(--sab))',
            background: 'var(--color-primary-container, #ffd600)',
            color: 'var(--color-on-primary-container)',
            boxShadow: '0 4px 20px rgba(255,214,0,0.45)',
            animation: 'fadeUp 0.2s ease-out both',
          }}
        >
          <span className="material-symbols-outlined ms-fill" style={{fontSize:14}}>my_location</span>
          Back to reading
        </button>
      )}

      {/* Fixed bottom controls */}
      <div
        className="fixed bottom-0 left-0 w-full z-10 bg-surface/80 backdrop-blur-xl border-t border-outline-variant/20 px-5 pt-3 safe-bottom flex flex-col items-center gap-3"
        style={{paddingBottom:'calc(14px + var(--sab))'}}
      >
        {/* Seek bar */}
        <div className="w-full max-w-[560px]">
          <div
            ref={progressBarRef}
            className="relative flex items-center w-full h-8 cursor-pointer"
            onMouseDown={e => seekToClient(e.clientX)}
            onMouseMove={e => e.buttons === 1 && seekToClient(e.clientX)}
          >
            <div className="pointer-events-none absolute w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
              <div className="h-full bg-secondary rounded-full" style={{width:`${progress}%`, boxShadow:'0 0 10px rgba(127,214,195,0.5)', transition:'width 0.1s linear'}} />
            </div>
            {progress > 0 && (
              <div className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-primary-container rounded-full border-2 border-on-primary" style={{left:`${progress}%`}} />
            )}
          </div>
          <div className="flex justify-between text-xs text-on-surface-variant font-mono -mt-1">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Playback controls — all tap targets ≥44px */}
        <div className="flex items-center gap-5">
          <button
            onClick={() => { haptic.light(); if(audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10) }}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors"
          >
            <span className="material-symbols-outlined" style={{fontSize:28}}>replay_10</span>
          </button>
          <button
            onClick={() => { haptic.light(); if(audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 30) }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors"
          >
            <span className="material-symbols-outlined" style={{fontSize:30}}>fast_rewind</span>
          </button>
          <button
            onClick={togglePlay}
            className="w-16 h-16 bg-primary-container rounded-full flex items-center justify-center transition-all active:translate-y-1 active:scale-95 glow-primary md-ripple"
            style={{boxShadow:'0 4px 0 0 #e9c400'}}
          >
            <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:40}}>
              {playing ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <button
            onClick={() => { haptic.light(); if(audioRef.current) audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 30) }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors"
          >
            <span className="material-symbols-outlined" style={{fontSize:30}}>fast_forward</span>
          </button>
          <button
            onClick={() => { haptic.light(); if(audioRef.current) audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 10) }}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors"
          >
            <span className="material-symbols-outlined" style={{fontSize:28}}>forward_10</span>
          </button>
        </div>

        {/* Extra controls strip: speed · ambient · sleep · read-along */}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <button
            onClick={cycleSpeed}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold min-h-[36px] transition-colors ${speed !== 1 ? 'bg-primary-container/20 border-primary-container/40 text-primary-fixed' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant'}`}
          >
            <span className="material-symbols-outlined" style={{fontSize:13}}>speed</span>
            {speed === 1 ? '1×' : `${speed}×`}
          </button>

          <button
            onClick={cycleAmbient}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold min-h-[36px] transition-colors ${ambient ? 'bg-secondary-container/30 border-secondary/40 text-secondary-fixed' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant'}`}
          >
            {ambient ? AMBIENT_LABEL[ambient] : '♫ Ambient'}
          </button>

          <button
            onClick={cycleSleep}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold min-h-[36px] transition-colors ${sleepMins ? 'bg-primary-container/20 border-primary-container/40 text-primary-fixed' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant'}`}
          >
            <span className="material-symbols-outlined" style={{fontSize:13}}>bedtime</span>
            {sleepDisplay}
          </button>

          <button
            onClick={() => setReadAlong(r => !r)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold min-h-[36px] transition-colors ${readAlong ? 'bg-primary-container/20 border-primary-container/40 text-primary-fixed' : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant'}`}
          >
            <span className="material-symbols-outlined" style={{fontSize:13}}>menu_book</span>
            {readAlong ? 'Reading' : 'Read along'}
          </button>
        </div>
      </div>

      <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" />
    </div>
  )
}
