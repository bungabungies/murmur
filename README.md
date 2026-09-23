# murmur — V1

A local-first, mobile-first diary / life-log prototype designed around **minimum input**:

- multiple text entries per day
- multiple photos per entry
- voice notes with browser-native speech-to-text when available
- automatic daily emotional color + short caption using lightweight on-device heuristics
- archive calendar and monthly history
- natural text search
- quiet retrospective insights
- export/import backup
- installable PWA shell

## Run it

Because microphone permissions and the PWA service worker require a secure context, serve the folder rather than opening `index.html` directly.

```bash
cd murmur_app
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a browser.

For an iPhone, the cleanest next step is to deploy the folder to an HTTPS host (for example Vercel, Netlify, Cloudflare Pages, or GitHub Pages) and then use **Share → Add to Home Screen** in Safari.

## Privacy in this V1

Entries, photos and voice clips are stored in the browser's **IndexedDB on the device**. Nothing is sent to an AI service or remote server.

That means:

- deleting browser/site data can delete the diary
- use **… → export archive** to make backups
- the mood/theme read is deliberately lightweight and local
- photo content is not analyzed; captions/text/transcripts are what influence the day's vibe
- 

## Next build if you want real AI

The current prototype is intentionally local and dependency-free. The natural V2 would add an encrypted backend plus an AI endpoint that can:

- understand image content and the feeling attached to it
- create restrained daily summaries
- answer questions like “when did I first start talking about him?” semantically rather than exact keyword search
- find recurring people/themes even when you use different wording

Keep API keys on a server, never inside `app.js`.
