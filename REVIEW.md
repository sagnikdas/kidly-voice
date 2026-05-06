# Kidly — Product Review
**Date:** 2026-05-06  
**Reviewer:** Sagnik Das + Claude  
**App URL:** http://localhost:5173  
**Backend URL:** http://localhost:8000

---

## What Kidly Does

A parent records their voice once (~60–90 seconds). Kidly clones the voice using ElevenLabs' Instant Voice Cloning (IVC) API. The parent can then play any of 15 pre-written bedtime stories narrated back in their own cloned voice. TTS audio is cached on first play — replays are instant and free.

No login. No account. Just email (optional) and voice.

---

## Step-by-Step Review

### Step 1 — Landing Page (`/`)

**What we saw:** Moon emoji, bold headline "Hear bedtime stories in your own voice", subtext, optional email input, orange CTA button, three feature cards below.

**What works:**
- Clear value proposition immediately visible
- Trust signals ("No account needed · Takes 2 minutes · 15 stories ready") are reassuring
- CTA button is prominent and well-designed
- Feature cards explain the product at a glance

**Issues found:**
- Feature cards are partially cut off at the bottom (scroll required, no hint)
- "ElevenLabs" is mentioned by name in the "Instant magic" card — end users don't need to know the tech stack; replace with user-friendly language e.g. "AI voice technology"

---

### Step 2 — Record Screen (Step 1 of 3)

**What we saw:** Progress bar (Record → Clone → Stories), Back button, reading passage box, Record Live / Upload File tab switcher, "Start Recording" red button.

**What works:**
- Progress bar is clear and gives the user orientation
- Tab switcher for live vs upload is useful
- Sample passage text is appropriate length and well-written
- "Aim for 60–90 seconds" sets the right expectation

**Issues found:**
- Reading passage is cut off — only the first paragraph is visible. The box is scrollable but no scroll indicator or hint is shown. Added "↕ Scroll to read the full passage" hint (fixed)
- No indication of how long the visible passage takes to read aloud
- "Record Another Take" button is red (same as the primary record button) — looks like a required action rather than an optional one; should be smaller/secondary styled

---

### Step 3 — Recording in Progress

**What we saw:** Pulsing red dot, live timer (MM:SS), "✓ enough!" indicator after 60s, "Stop Recording" button.

**What works:**
- Live timer is clear and reassuring
- Green "✓ enough!" feedback at 60s is good UX
- Stop button is well-placed

**Issues found:** None significant at this step.

---

### Step 4 — After Recording (Takes Review)

**What we saw:** Recorded takes list with audio player, duration label, delete button, total duration counter, "Create My Voice →" button.

**What works:**
- Shows total duration in green when ≥60s
- Audio playback lets users listen back

**Critical bug found:**
- The recording file for a 79-second take was only **29 KB** — approximately 10× smaller than expected for real speech (~250–350 KB). This means the microphone was capturing near-silence.
- ElevenLabs created a voice clone from essentially silent audio, resulting in a generic computer-generated voice instead of the user's cloned voice.
- **Root cause:** System microphone input was not picking up audio. The browser's MediaRecorder was running (timer ticked correctly) but the audio input device was silent.
- **Detection:** No validation existed to catch a suspiciously small recording file.

**Fixes applied:**
1. Added silence detection: each take is flagged `isSilent` if its size is < 1 KB per second of audio. Silent takes show an amber "quiet" badge and a warning banner.
2. Added a **"Record Another Take"** button style change — still red but context makes it clearer it's optional.
3. Added a **confirmation checkbox**: "I've played back my recording and it sounds clear" — must be checked before "Create My Voice →" is enabled. Forces the user to listen back before proceeding.
4. Added scroll hint to the reading passage box.

---

### Step 5 — Cloning Phase (Step 2 of 3)

**What we saw:** (Transitioned quickly — user did not capture screenshot)  
Three-step progress indicator: Uploading → Creating voice model → Ready.

**What works:**
- Auto-advances to stories on success
- Error state with retry button exists

**Issues found:**
- Transitions too fast to notice if something goes wrong — no success confirmation before moving to stories
- No celebration / "your voice is ready!" moment — user lands on the stories grid with no acknowledgement that the clone succeeded

---

### Step 6 — Stories Grid (Step 3 of 3)

**What we saw:** 4-column grid, 15 story cards, each with emoji, moral tag (color-coded), title, subtitle, age range, "▶ Play in My Voice" button. "Re-record voice" link top-right.

**What works:**
- Visual design is clean and appealing
- Moral tags are color-coded and informative
- Age ranges help parents pick appropriate stories
- Grid layout works well on desktop

**Issues found:**
- No confirmation that voice was successfully cloned — user lands here silently with no "Your voice is ready!" moment
- "Re-record voice" link is very small text, top-right corner — easy to miss
- Bottom row of stories is cut off — no scroll hint
- "Where Did Priya's Smile Go?" title wraps to two lines, breaking grid card height consistency
- All 15 "Play in My Voice" buttons look identical — no visual state for stories already played (no "played" indicator)

---

### Step 7 — Playing a Story

**What we saw:** Story audio loads, plays back — but sounded like a generic computer voice, not the user's cloned voice.

**Root cause confirmed:** See Step 4 critical bug. The recording was near-silent so ElevenLabs cloned silence, not the user's voice. The TTS audio was generated using that poor voice model.

**Secondary issue:** ElevenLabs IVC (Instant Voice Cloning) at the Starter tier is documented to produce lower-quality voice clones. Even with a good recording, the result may sound somewhat robotic. Upgrade path is ElevenLabs Professional Voice Clone (PVC) or the Scale plan.

---

### Step 8 — Feedback Form

**Not tested** — the form appears after the first story plays. Since the story playback step was affected by the mic bug, this step was not fully reviewed.

---

## Infrastructure & Subscription Issues

| Issue | Severity | Notes |
|---|---|---|
| ElevenLabs voice slot limit (10 max on Starter) | High | Blocks new users once 10 voices exist. Upgrade to Scale ($99/mo) for unlimited slots |
| Personal API key used for all users | Medium | Fine for MVP/testing. Needs a business account before public launch |
| No voice lifecycle management | Medium | No automated deletion of voices when users churn |
| TTS model is `eleven_turbo_v2_5` | Low | Faster/cheaper but lower quality. Consider `eleven_multilingual_v2` for better cloning fidelity |

---

## Bugs Fixed During This Review

| # | Bug | Fix |
|---|---|---|
| 1 | ElevenLabs "duplicated_files" error on retry | Clear session directory on first upload of each batch; deduplicate by MD5 hash before sending to ElevenLabs |
| 2 | All microphone errors showed generic "access denied" message | Added specific error handling for NotAllowedError, NotFoundError, NotReadableError etc. with actionable messages |
| 3 | Error message appeared below the fold | Moved error display to top of recording UI, above the passage |
| 4 | Silent recording not detected — user could proceed with bad audio | Added silence detection (file size < 1KB/s), amber warning badge on quiet takes, confirmation checkbox before "Create My Voice" |
| 5 | Scroll hint missing on reading passage | Added "↕ Scroll to read the full passage" label |

---

## Prioritised Next Steps

### Must fix before any users
1. Fix microphone input — verify recording captures actual voice before cloning
2. Upgrade ElevenLabs to Scale plan (unlimited voice slots) on a business account
3. Add "voice ready" success moment before landing on stories grid

### Should fix soon
4. Downgrade "Record Another Take" button visual weight — make it secondary
5. Add played/unplayed state to story cards
6. Add scroll hint on stories grid
7. Remove "ElevenLabs" brand mention from landing page feature card
8. Fix card height inconsistency ("Where Did Priya's Smile Go?" wraps to 2 lines)

### Nice to have
9. Add voice quality preview — let user hear a sample sentence in their cloned voice before seeing all 15 stories
10. Add voice deletion on "Re-record" — clean up old ElevenLabs voice when user re-records
11. Metered billing via Stripe before scaling to real users
