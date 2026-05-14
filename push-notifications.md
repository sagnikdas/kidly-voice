# Push Notifications — Kidly Voice

How to set up, manage, and send push notifications to users.

---

## 1. One-time setup: set ADMIN_SECRET

The admin endpoints require an `ADMIN_SECRET` key. It is not set by default.

```bash
# Step 1 — generate a secret and copy it somewhere safe (e.g. 1Password)
openssl rand -hex 32

# Step 2 — set it on Fly.io
fly secrets set ADMIN_SECRET="paste-generated-value-here" --app kidly-voice
```

You will never be able to retrieve this value from Fly again, so save it before setting it.

---

## 2. How users get subscribed

Users subscribe automatically through the app:

1. They reach the **Stories** screen after cloning their voice.
2. After **30 seconds**, a banner appears: *"Bedtime reminders — get a gentle nudge each evening."*
3. They tap **Enable** → OS shows the native notification permission dialog.
4. On approval, the browser sends the subscription to the backend and it is saved to `users.json`.

**iOS note:** Web push only works on iOS 16.4+ when the app is installed to the Home Screen. The banner does not appear on iOS unless the user is already in standalone (installed) mode.

Once dismissed or approved, the banner never shows again (stored in `localStorage`).

---

## 3. Automatic daily notification

The backend fires a push to all subscribed users automatically every day at **7:30 PM IST (14:00 UTC)**.

No action needed — it runs as a background task inside the FastAPI process. The message rotates through 4 nudges:

- *"Time for a bedtime story! 🌙"*
- *"Your little one is waiting 💫"*
- *"Sweet dreams start here 🌟"*
- *"Story time! ✨"*

If a subscription is stale (user revoked permission or uninstalled the app), it fails silently and is removed from `users.json` automatically.

---

## 4. Send a manual push (admin)

Use this to send an immediate notification to all subscribed users — useful for announcements or testing.

```bash
curl -X POST "https://kidly-voice.fly.dev/api/admin/push/notify" \
  -H "X-Admin-Key: YOUR_ADMIN_SECRET" \
  -G \
  --data-urlencode "title=Story time! ✨" \
  --data-urlencode "body=Your little one is waiting. Open Kidly tonight."
```

Replace `YOUR_ADMIN_SECRET` with the value you generated in step 1.

**Response:**
```json
{ "sent": 12, "failed": 0, "removed_stale": 0 }
```

- `sent` — notifications successfully dispatched
- `failed` — subscriptions that rejected the push
- `removed_stale` — bad subscriptions cleaned up from users.json

---

## 5. Check who is subscribed (admin)

```bash
curl "https://kidly-voice.fly.dev/api/admin/voices" \
  -H "X-Admin-Key: YOUR_ADMIN_SECRET"
```

This lists all users with a cloned voice. Users with `push_subscription` set in `users.json` are subscribed to push.

To inspect directly on the server:

```bash
fly ssh console --app kidly-voice -C "python3 -c \"
import json
data = json.load(open('/app/tmp/users.json'))
total = len(data['sessions'])
subscribed = sum(1 for s in data['sessions'].values() if s.get('push_subscription'))
print(f'Total users: {total}, Push subscribers: {subscribed}')
\""
```

---

## 6. Test the push end-to-end

1. Open `https://kidly-voice.fly.dev` in Chrome on Android (or Safari on iOS with the app installed).
2. Log in and reach the Stories screen.
3. Wait 30 seconds for the permission banner, or run this in the browser console to trigger it immediately:
   ```js
   localStorage.removeItem('kidly_push_asked'); location.reload();
   ```
4. Tap **Enable** and approve the OS dialog.
5. Send a manual push from your terminal (step 4 above).
6. The notification should appear within a few seconds, even if the browser is in the background.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 403 on admin endpoint | ADMIN_SECRET not set or wrong value | Re-run step 1; ensure exact value in header |
| `sent: 0` after notify | No users subscribed yet | Go through the subscribe flow (step 2) |
| Notification not appearing | Permission denied or browser blocked | Check browser site settings → Notifications |
| iOS not showing banner | App not installed to Home Screen | Add to Home Screen first, then reopen |
| Push works in browser but not when closed | Service worker not registered | Ensure `sw.js` is being served at `/sw.js` |
