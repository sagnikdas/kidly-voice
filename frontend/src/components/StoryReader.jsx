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

export default function StoryReader({ title, text, audioUrl, alignment, onClose }) {
  const [highlightOn, setHighlightOn] = useState(true)
  const [currentWordIdx, setCurrentWordIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const audioRef = useRef(null)
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const togglePlay = () =>
    audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()

  const seek = (e) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (audioRef.current) audioRef.current.currentTime = ratio * duration
  }

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
      <header className="fixed top-0 w-full z-10 flex justify-between items-center px-5 h-14 bg-surface border-b border-outline-variant/20">
        <button onClick={onClose} className="flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface transition-colors">
          <span className="material-symbols-outlined">arrow_back_ios_new</span>
          <span className="font-medium text-primary-container">Kidly</span>
        </button>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-high rounded-full border border-outline-variant/30">
          <span className="material-symbols-outlined ms-fill text-secondary text-base">record_voice_over</span>
          <span className="text-xs font-bold text-secondary">In Your Voice</span>
        </div>
        <button onClick={() => setHighlightOn(h => !h)} className={`flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${highlightOn ? 'bg-primary-container/20 border-primary-container/40 text-primary-fixed' : 'bg-surface-container border-outline-variant/30 text-on-surface-variant'}`}>
          {highlightOn ? '✦ Highlight' : '◇ Highlight'}
        </button>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pt-20 pb-36">
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
            style={{ fontFamily: "'Quicksand', sans-serif", fontSize: '1.1rem', lineHeight: 2, color: '#eae2cf' }}>
            {renderedText}
            <div style={{height: 20}} />
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-[600px] mx-auto px-5 mb-4">
          <div className="relative h-3 w-full bg-surface-container-highest rounded-full overflow-visible cursor-pointer" onClick={seek}>
            <div className="absolute top-0 left-0 h-full bg-secondary rounded-full transition-all" style={{width:`${progress}%`, boxShadow:'0 0 12px rgba(127,214,195,0.5)'}} />
            {progress > 0 && (
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 bg-primary-container rounded-full flex items-center justify-center border-2 border-on-primary" style={{left:`${progress}%`}}>
                <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:14}}>star</span>
              </div>
            )}
          </div>
          <div className="flex justify-between mt-1.5 text-xs text-on-surface-variant font-mono">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>
      </div>

      {/* Floating audio controls */}
      <div className="fixed bottom-0 left-0 w-full z-10 px-5 pb-10 flex flex-col items-center gap-4">
        {/* Secondary controls */}
        <div className="flex gap-4">
          <button onClick={() => { if(audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10) }}
            className="flex items-center gap-2 bg-surface-container-high text-on-surface px-4 py-3 rounded-full border border-outline-variant/20 text-sm font-medium transition-all active:scale-95">
            <span className="material-symbols-outlined text-secondary text-base">replay_10</span>
            <span className="text-xs">Replay</span>
          </button>
          <button className="flex items-center gap-2 bg-surface-container-high text-on-surface px-4 py-3 rounded-full border border-outline-variant/20 text-sm font-medium transition-all active:scale-95">
            <span className="material-symbols-outlined text-tertiary-fixed-dim text-base">bedtime</span>
            <span className="text-xs">Sleepy Mode</span>
          </button>
        </div>
        {/* Main playback */}
        <div className="flex items-center gap-6 bg-surface-container-high/90 backdrop-blur-xl px-8 py-4 rounded-full border border-outline-variant/30" style={{boxShadow:'0 8px 32px rgba(0,0,0,0.5)'}}>
          <button onClick={() => { if(audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 30) }} className="text-on-surface-variant hover:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:32}}>skip_previous</span>
          </button>
          <button onClick={togglePlay} className="w-20 h-20 bg-primary-container rounded-full flex items-center justify-center transition-all active:translate-y-1 glow-primary" style={{boxShadow:'0 4px 0 0 #e9c400'}}>
            <span className="material-symbols-outlined ms-fill text-on-primary-container" style={{fontSize:48}}>
              {playing ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <button onClick={() => { if(audioRef.current) audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 30) }} className="text-on-surface-variant hover:text-primary-fixed transition-colors">
            <span className="material-symbols-outlined" style={{fontSize:32}}>skip_next</span>
          </button>
        </div>
        <p className="text-xs text-on-surface-variant opacity-60">Space to play/pause · Esc to go back</p>
      </div>
      <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" />
    </div>
  )
}
