import { useState } from 'react'

const MAX_CHARS = 3000

export default function CustomTextModal({ voiceId, sessionToken, onClose, onOpenReader }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!text.trim() || busy) return
    if (!voiceId) { setErr('No voice found — please re-record first.'); return }
    setBusy(true)
    setErr('')
    try {
      const r = await fetch('/api/voice/speak-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId, text: text.trim(), session_token: sessionToken }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Failed to generate audio')
      }
      const { audio_url, alignment } = await r.json()
      setBusy(false)
      onOpenReader({ title: 'Your custom text', text: text.trim(), audioUrl: audio_url, alignment })
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'Escape') onClose()
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
  }

  const remaining = MAX_CHARS - text.length
  const nearLimit = remaining < MAX_CHARS * 0.1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">Read custom text</h3>
            <p className="text-xs text-gray-400 mt-0.5">Paste a poem, letter, or story you wrote</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-300 hover:text-gray-500 text-xl leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pt-4 pb-5">
          <textarea
            value={text}
            onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={onKey}
            placeholder="Paste or type anything here — a bedtime story you wrote, a poem, a letter to your child…"
            rows={9}
            autoFocus
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-orange-400 outline-none text-sm resize-none bg-gray-50 leading-relaxed"
            style={{ fontFamily: 'Georgia, serif' }}
          />

          <div className="flex items-center justify-between mt-2 mb-4">
            <span className={`text-xs ${nearLimit ? 'text-amber-500 font-medium' : 'text-gray-300'}`}>
              {remaining} characters remaining
            </span>
            {err && <span className="text-xs text-red-500 ml-2 text-right">{err}</span>}
          </div>

          <button
            onClick={submit}
            disabled={busy || !text.trim()}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-xl font-semibold transition-colors inline-flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              '▶ Read in my voice'
            )}
          </button>

          <p className="text-center text-xs text-gray-300 mt-2">
            ⌘ Enter to generate · Esc to close
          </p>
        </div>
      </div>
    </div>
  )
}
