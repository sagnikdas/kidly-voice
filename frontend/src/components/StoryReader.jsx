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
  const wordTimings = useMemo(() => buildWordTimings(alignment), [alignment])

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
            backgroundColor: active ? '#fef08a' : 'transparent',
            borderRadius: active ? '3px' : undefined,
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
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#fffbf5' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-amber-100 shrink-0 bg-white">
        <button
          onClick={onClose}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors"
        >
          ← Back
        </button>

        <h2
          className="font-bold text-gray-800 text-sm truncate mx-4 max-w-xs"
          style={{ fontFamily: 'Georgia, serif' }}
        >
          {title}
        </h2>

        <button
          onClick={() => setHighlightOn(h => !h)}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
            highlightOn
              ? 'bg-yellow-100 border-yellow-300 text-yellow-800'
              : 'bg-gray-100 border-gray-200 text-gray-400'
          }`}
        >
          {highlightOn ? '✦ Highlighting on' : '◇ Highlighting off'}
        </button>
      </div>

      {/* Story text */}
      <div
        className="flex-1 overflow-y-auto px-6 py-10"
        style={{
          fontFamily: 'Georgia, serif',
          fontSize: '1.125rem',
          lineHeight: 1.95,
          color: '#374151',
          maxWidth: 680,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {renderedText}
        <div style={{ height: 40 }} />
      </div>

      {/* Audio controls */}
      <div className="shrink-0 bg-white border-t border-amber-100 px-6 pt-3 pb-5">
        <audio ref={audioRef} src={audioUrl} preload="auto" className="hidden" />

        {/* Seek bar */}
        <div
          className="w-full h-1.5 bg-gray-200 rounded-full cursor-pointer mb-4"
          onClick={seek}
        >
          <div
            className="h-full bg-orange-400 rounded-full"
            style={{ width: `${progress}%`, transition: 'width 0.25s linear' }}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-gray-400 font-mono w-10">{fmt(currentTime)}</span>

          <button
            onClick={togglePlay}
            className="w-12 h-12 bg-orange-500 hover:bg-orange-600 text-white rounded-full flex items-center justify-center shadow-md transition-colors shrink-0"
            style={{ fontSize: '1.1rem' }}
          >
            {playing ? (
              <span className="flex gap-1">
                <span className="w-[3px] h-4 bg-white rounded-sm" />
                <span className="w-[3px] h-4 bg-white rounded-sm" />
              </span>
            ) : (
              <span style={{ marginLeft: 3 }}>▶</span>
            )}
          </button>

          <span className="text-xs text-gray-400 font-mono w-10 text-right">{fmt(duration)}</span>
        </div>

        <p className="text-center text-xs text-gray-300 mt-2">
          Space to play / pause · Esc to go back
        </p>
      </div>
    </div>
  )
}
