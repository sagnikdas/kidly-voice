# Kidly — TTS Provider Analysis & Architecture Decision

**Date:** May 2026  
**Context:** MVP phase, targeting 1,000 users in 6 months, budget $30–60/month infra.

---

## The Problem with ElevenLabs at Scale

### Two bottlenecks

**1. Voice slot ceiling (the hard wall)**

Each cloned voice on ElevenLabs occupies a permanent slot until manually deleted.

| Plan | Monthly cost | Voice slots | Users supported |
|---|---|---|---|
| Pro | $99 | 30 | 30 max, full stop |
| Scale | $330 | 160 | 160 max |
| Business | $1,320 | 660 | 660 max |

At 160+ users you're forced to $1,320/month. Each tier jump is ~4× cost.

**2. Character quota (cost scales with users)**

Each new user generates all 15 stories = 21,749 chars (measured from actual story content).

| Plan | Chars/month | New users/month supported |
|---|---|---|
| Creator $22 | 100K | ~4 |
| Pro $99 | 500K | ~23 |
| Scale $330 | 2M | ~92 |
| Business $1,320 | 10M | ~460 |

For 1,000 users in 6 months (~167 new/month), ElevenLabs requires the Business plan at $1,320/month — roughly $6,977 over 6 months for API costs alone.

---

## The Architecture Unlock: Delete-After-Generate

### Core insight

The slot problem is self-inflicted. Voices only need to exist long enough to generate audio.

**Current flow (broken at scale):**
```
Clone voice → keep voice on ElevenLabs forever → serve TTS on demand
Slots used = total registered users  ← this is the wall
```

**New flow (unlimited users):**
```
Clone voice → generate all 15 stories (background job) → DELETE voice from ElevenLabs
Slots used = concurrent onboardings only (~3–10 at peak)
```

A voice slot is held for ~8 minutes (time to generate 15 × ~1,449 char stories), then freed. With Creator plan (10 slots), you can onboard unlimited total users — just not 11+ simultaneously.

### What this changes

| | Before | After |
|---|---|---|
| Slots needed | = total users | 3–10 (concurrent only) |
| User ceiling | 160 (Scale plan) | Unlimited |
| Plan needed | Scale → Business | Creator ($22) |
| Monthly slot cost | $330–$1,320 | $22 |

### Full proposed architecture

```
User onboards:
  1. Record voice (browser → server upload)
  2. POST /api/voice/clone → ElevenLabs /v1/voices/add → voice_id
  3. Background job: generate all 15 stories
       for each story: POST /v1/text-to-speech/{voice_id} → save MP3 to server disk
  4. DELETE /v1/voices/{voice_id} from ElevenLabs → slot freed
  5. Frontend polls GET /api/stories/ready/{session_token} → shows progress (7/15...)
  6. On complete: frontend downloads all 15 MP3s → stores in browser IndexedDB
  7. All future plays: served from IndexedDB — zero server calls, zero API cost

New device or cleared cache:
  → Re-download from server (MP3s stored permanently on Fly.io volume)
```

---

## Client-Side Caching (IndexedDB)

### Why this matters

Currently every story play hits the server. With IndexedDB:

```
First play:
  Browser → Server → (ElevenLabs TTS on cache miss) → MP3 → Browser → IndexedDB

Every replay (same device):
  Browser → IndexedDB → play
  Zero server calls. Zero bandwidth. Zero cost.
```

### Implementation sketch (frontend)

```javascript
async function playStory(voiceId, storyKey, audioUrl) {
  const cacheKey = `${voiceId}:${storyKey}`;
  
  // Check IndexedDB first
  let blob = await localforage.getItem(cacheKey);
  
  if (!blob) {
    // Download from server once
    const res = await fetch(audioUrl);
    blob = await res.blob();
    await localforage.setItem(cacheKey, blob);
  }
  
  // Play from local blob
  const url = URL.createObjectURL(blob);
  new Audio(url).play();
}
```

### Storage per user

| What | Size |
|---|---|
| 15 MP3s (mp3_22050_32, ~2 min each) | 15 × 0.45 MB = **6.75 MB** |
| Browser IndexedDB | ~7 MB (trivial) |
| Server volume per user | ~7 MB (permanent backup) |
| Server volume at 1,000 users | ~7 GB → 10 GB volume |

---

## Provider Comparison

### Actual story sizes (measured)

```
Average per story  :  1,449 chars  (~2 min audio)
Total all 15       : 21,749 chars
Preview text       :    149 chars
Full onboarding    : 21,898 chars per user (one-time)
```

### Variable cost per new user (all 15 stories, never repeats)

| Provider | Rate | Cost per user | Quality | Slot limits |
|---|---|---|---|---|
| ElevenLabs IVC | ~$0.22/1K chars | **$4.78** | ★★★★★ Best | 10–660 (plan-dependent) |
| Cartesia Sonic | ~$0.065/1K chars | **$1.41** | ★★★★ Good | None |
| Fish Audio | ~$0.015/1K chars | **$0.33** | ★★★ (test needed) | None |

---

## 6-Month Cost Projection (1,000 users)

Growth model: 50 → 100 → 150 → 200 → 250 → 250 new users/month

### Fish Audio

| Month | New users | Total users | API cost | Fly.io | Monthly total |
|---|---|---|---|---|---|
| M1 | 50 | 50 | $16.31 | $7.00 | **$23** ✅ |
| M2 | 100 | 150 | $32.62 | $7.00 | **$40** ✅ |
| M3 | 150 | 300 | $48.94 | $7.50 | **$56** ✅ |
| M4 | 200 | 500 | $65.25 | $8.00 | **$73** ⚠️ |
| M5 | 250 | 750 | $81.56 | $8.50 | **$90** ⚠️ |
| M6 | 250 | 1,000 | $81.56 | $9.00 | **$91** ⚠️ |
| | | | | **6-month total** | **$373** |

Months 1–3 within $60 budget. Months 4–6 drift to $73–91 — by then 500+ users should have revenue to cover it.

### ElevenLabs (for comparison, current provider)

| Month | New users | Plan needed | Monthly total |
|---|---|---|---|
| M1 | 50 | Scale $330 | $337 |
| M2 | 100 | Business $1,320 | $1,327 |
| M3–M6 | 150–250 | Business $1,320 | $1,327–$1,329 |
| | | **6-month total** | **$6,977** |

### Summary

| Provider | 6-month total | User limit | Quality |
|---|---|---|---|
| Fish Audio | **$373** | None | Needs testing |
| Cartesia | ~$1,133 | None | Good |
| ElevenLabs | **$6,977** | Plan-dependent | Best |

---

## Fixed vs Variable Cost (final architecture)

### Fixed (same every month)

| Component | Cost |
|---|---|
| Fly.io machine (shared-cpu-1x, 512 MB, always-on) | $5.70/month |
| Fly.io volume (grows 3 GB → 10 GB over 6 months) | $0.45 → $1.50/month |
| **Total fixed** | **~$7–9/month** |

No API subscription fee needed (use pay-as-you-go).

### Variable (per new user, one-time charge, never repeats)

```
Fish Audio:    $0.33/user  (21,749 chars × $0.015/1K)
Cartesia:      $1.41/user  (21,749 chars × $0.065/1K)
ElevenLabs:    $4.78/user  (21,749 chars × $0.22/1K)
```

### Monthly cost formula

```
Monthly bill = ~$8 fixed + (new_users_that_month × $0.33)
```

At Fish Audio rates, 100 new users = $41/month total. 250 new users = $91/month.

---

## MVP Phase: No Onboarding Bottleneck

For maximum user growth with zero artificial limits:

| Constraint | Before | After (delete-after-generate) |
|---|---|---|
| Voice slot ceiling | = total users (hard wall) | 3–10 concurrent (no ceiling) |
| Character quota | Hard monthly cap by plan | Pay-as-you-go overage |
| Users blocked during burst | Yes (slot exhaustion) | No (queue + background job) |
| Monthly cost predictability | Unpredictable plan jumps | Linear: $0.33 × new users |

---

## Decision Tree

```
Can Fish Audio cloning quality pass a parent's ear test?
  │
  ├─ YES → Fish Audio
  │          $0.33/user, no limits, $373 total for 1,000 users
  │
  ├─ CLOSE ENOUGH → Cartesia  
  │          $1.41/user, no limits, $1,133 total for 1,000 users
  │
  └─ NO → ElevenLabs + delete-after-generate
               $4.78/user, no limits (just cost), $6,977 total
               Budget needs to be $300–400/month
```

---

## Next Step

Test Fish Audio voice quality before committing to any migration.

See `fish-audio-test/` folder — a standalone Python script that:
1. Clones your voice using Fish Audio
2. Generates one story in your cloned voice
3. Saves `output.mp3` so you can compare against ElevenLabs output

If the voice sounds like you reading to your child, the migration is worth it.
