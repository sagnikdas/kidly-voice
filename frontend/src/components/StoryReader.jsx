import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

function buildWordTimings(alignment) {
  if (!alignment?.characters) return []
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment
  const words = []
  let wStart = null, wEnd = null
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i]
    if (!ch || /\s/.test(ch)) {
      if (wStart !== null) { words.push({ start: wStart, end: wEnd }); wStart = null }
    } else {
      if (wStart === null) wStart = starts[i]
      wEnd = ends[i]
    }
  }
  if (wStart !== null) words.push({ start: wStart, end: wEnd })
  return words
}

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

export default function StoryReader({ title, text, audioUrl, alignment, onClose, onOpenSettings }) {
  const [highlightOn, setHighlightOn] = useState(true)
  const [currentWordIdx, setCurrentWordIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const audioRef = useRef(null)
  const progressBarRef = useRef(null)
  const wordRefs = useRef([])
  const wordTimings = useMemo(() => {
    if (alignment?.characters) return buildWordTimings(alignment)
    return buildEvenTimings(text, duration)
  }, [alignment, text, duration])

  const handleTimeUpdate = useCallback(() => {
    const t = audioRef.current?.currentTime ?? 0
    setCurrentTime(t)
    if (!wordTimings.length) return
    const idx = findWordIdx(wordTimings, t)
    setCurrentWordIdx(idx)
    if (idx >= 0 && wordRefs.current[idx]) {
      wordRefs.current[idx].scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
  }, [wordTimings])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onEnded = () => { setPlaying(false); setCurrentWordIdx(-1) }
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

  // Android hardware back + iOS swipe-back → close the reader
  useEffect(() => {
    window.history.pushState({ kidlyReader: true }, '')
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [onClose])

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

  const togglePlay = () =>
    audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()

  const seekToClient = useCallback((clientX) => {
    if (!duration || !audioRef.current || !progressBarRef.current) return
    const rect = progressBarRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    audioRef.current.currentTime = ratio * duration
  }, [duration])

  // Render text with per-word spans
  const paragraphs = text.split(/\n\n+/)
  let wIdx = 0
  const renderedText = paragraphs.map((para, pIdx) => {
    const parts = para.split(/(\s+)/)
    const nodes = parts.map((part, partIdx) => {
      if (/^\s+$/.test(part)) return <span key={partIdx}>{part}</span>
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
      <p key={pIdx} style={{ marginBottom: '1.6rem' }}>
        {nodes}
      </p>
    )
  })

  const progress = duration ? (currentTime / duration) * 100 : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-on-surface">
      {/* Header */}
      <header className="fixed top-0 w-full z-10 flex justify-between items-center px-5 bg-surface border-b border-outline-variant/20 h-header safe-top">
        <div className="flex items-center gap-1">
          <button onClick={() => window.history.back()} className="flex items-center justify-center min-w-[44px] min-h-[44px] active:opacity-75 transition-opacity">
            <span className="material-symbols-outlined text-on-surface-variant">arrow_back_ios_new</span>
          </button>
          <button onClick={() => window.history.back()} className="text-2xl font-extrabold text-primary-container tracking-tight active:opacity-75 transition-opacity">
            Kidly
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high rounded-full border border-outline-variant/30">
          <span className="material-symbols-outlined ms-fill text-secondary text-base">record_voice_over</span>
          <span className="text-xs font-bold text-secondary">In Your Voice</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setHighlightOn(h => !h)} className={`flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-full border transition-colors min-h-[44px] ${highlightOn ? 'bg-primary-container/20 border-primary-container/40 text-primary-fixed' : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'}`}>
            {highlightOn ? '✦ Highlight' : '◇ Highlight'}
          </button>
          <button onClick={onOpenSettings} className="flex items-center justify-center min-w-[44px] min-h-[44px] text-on-surface-variant active:text-on-surface transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:22}}>settings</span>
          </button>
        </div>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pt-header pb-56">
        {/* Story emoji illustration */}
        <div className="w-full max-w-[700px] mx-auto px-5 mb-6">
          <div className="relative aspect-[4/2] rounded-xl overflow-hidden bg-gradient-to-br from-surface-container to-surface-container-highest flex items-center justify-center border-4 border-surface-container-highest">
            <span className="text-[80px]">📖</span>
            <div className="absolute inset-0" style={{background: 'radial-gradient(circle at center, transparent 0%, rgba(22,19,9,0.4) 100%)'}} />
          </div>
        </div>

        {/* Story title and text */}
        <div className="w-full max-w-[700px] mx-auto px-5 text-center mb-6">
          <h1 className="text-2xl font-bold text-primary-fixed mb-4">{title}</h1>
          {/* Highlighted text */}
          <div className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10 text-left"
            style={{ fontFamily: "'Quicksand', sans-serif", fontSize: '1.1rem', lineHeight: 2, color: 'var(--color-on-surface)' }}>
            {renderedText}
            <div style={{height: 20}} />
          </div>
        </div>

      </div>

      {/* Fixed bottom controls */}
      <div className="fixed bottom-0 left-0 w-full z-10 bg-surface/80 backdrop-blur-xl border-t border-outline-variant/20 px-5 pt-3 safe-bottom flex flex-col items-center gap-3" style={{paddingBottom:'calc(20px + var(--sab))'}}>
        {/* Seek bar */}
        <div className="w-full max-w-[560px]">
          <div
            ref={progressBarRef}
            className="relative flex items-center w-full h-8 cursor-pointer"
            onMouseDown={e => seekToClient(e.clientX)}
            onTouchStart={e => seekToClient(e.touches[0].clientX)}
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
          <button onClick={() => { if(audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10) }}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:28}}>replay_10</span>
          </button>
          <button onClick={() => { if(audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 30) }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:30}}>skip_previous</span>
          </button>
          <button onClick={togglePlay} className="w-16 h-16 bg-primary-container rounded-full flex items-center justify-center transition-all active:translate-y-1 glow-primary" style={{boxShadow:'0 4px 0 0 #e9c400'}}>
            <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:40}}>
              {playing ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <button onClick={() => { if(audioRef.current) audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 30) }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:30}}>skip_next</span>
          </button>
          <button onClick={() => { if(audioRef.current) audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 10) }}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] text-on-surface-variant active:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:28}}>forward_10</span>
          </button>
        </div>
      </div>
      <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" />
    </div>
  )
}
