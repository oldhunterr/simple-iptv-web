# Simple IPTV

A stripped-down, **serverless** IPTV web app: plain **HTML + CSS + JavaScript + jQuery**.
No Next.js, no Node, no build step, no proxy — just open `index.html`.

Migrated from the `iptv-web-main` Next.js application.

---

## Quick start

1. Open **`index.html`** in any modern browser.
2. On first run the app asks **how to load your channels** — pick either:

   **A. Xtream Codes** (portal API — gives exact live/movie/series types)

   | Field | Example |
   |-------|---------|
   | Portal URL | `http://your-portal.example:8080` |
   | Username | your Xtream username |
   | Password | your Xtream password |

   **B. M3U playlist link** (any `.m3u` / `.m3u8` URL)

   | Field | Example |
   |-------|---------|
   | Playlist URL | `https://iptv-org.github.io/iptv/languages/ara.m3u` |

   Optionally add a **TMDB API key** to get posters, plots, cast and episode info.
3. Click **Test connection**, then **Save & Continue**. Details are stored in
   your browser (localStorage) and reused on every later visit.

Switch source any time from **Connection** in the sidebar.

> Want to ship it pre-filled for your own users? Put the values in `js/config.js`
> — they pre-fill the setup form and connect immediately.

> If your browser blocks `file://` requests, serve the folder with any static
> file server (`python -m http.server`, VS Code "Live Server", `npx serve`, …).

---

## M3U playlist support

Point the app at any M3U/M3U8 link and it builds the catalog client-side:

- **Parses** `#EXTINF` attributes — `tvg-logo`, `group-title`, `tvg-id`, `tvg-name`
  (attributes in any order; names containing commas are handled; `#EXTGRP` and
  `#EXTVLCOPT` lines are tolerated).
- **Groups** become sidebar categories, with per-category item counts.
- **Classifies** each entry into Live / Movies / Series using, in order:
  `/movie/` or `/series/` in the URL → episode markers (`S01E01`, `1x03`) in the
  name → movie-ish group names → VOD file extensions. Everything else is Live.
  A group literally called "Series" is treated as Live unless the entries
  actually look episodic — those are usually 24/7 drama channels.
- **Groups episodes** into series: `Breaking Bad S01E01` / `S02E01` become one
  series with proper seasons, opened in the normal series modal.
- **Plays** HLS (`.m3u8`) via hls.js, MPEG-TS via mpegts.js, and everything else
  via the native video element.

Works with Xtream M3U exports too — `…/get.php?username=…&password=…&type=m3u_plus`
— where `/movie/` and `/series/` paths give exact classification, and the
VOD compatibility suffix is applied automatically.

Large playlists are parsed in time-sliced chunks with a live progress readout,
so a 100 MB / 400k-entry playlist won't freeze the tab.


---

## What it does

| Area | Details |
|------|---------|
| **Sources** | Xtream Codes portal **or** any M3U/M3U8 playlist link |
| **Live TV** | All live channels, category sidebar with **per-category item counts** + category search, instant playback |
| **Movies** | VOD catalog with details modal (plot, cast, rating, TMDB/IMDb links) |
| **Series** | Seasons + episodes, **TMDB episode stills / titles / plots**, **Plex theme songs**, resume progress |
| **Favorites** | Heart any item; saved in `localStorage` |
| **History** | Resume-watching list with progress %, resume/clear |
| **Search** | Global search + per-category search |
| **Filters** | Stream type, resolution, genre, min rating, year range, watched status, audio/translation tag, sort order |
| **Player** | HLS (`hls.js`), MPEG-TS (`mpegts.js`) and native HTML5; seek, volume, speed, fullscreen, keyboard shortcuts (space/←/→/↑/↓/M/F/Esc), resume banner, auto-save progress |
| **Skip Intro** | Optional — pulls intro/recap/outro markers from TheIntroDB |
| **Metadata** | TMDB lookup with Arabic title-variant matching (posters, backdrops, plots, cast) |
| **Theming** | 4 theme presets (Dark Glass / OLED Black / Neon Cyber / TiviMate) + 6 accent colours |

## What was removed (vs. the Next.js original)

- ❌ User profiles, avatars, profile switching
- ❌ Parental controls, PIN / PIN hashing, kids mode, adult-category locks
- ❌ Server-side downloads + IndexedDB download queue + SSE progress feed
- ❌ `SettingsShell` (download quality, storage quota, etc.)
- ❌ EPG grid
- ❌ Metadata-audit debug modal
- ❌ Every `/api/*` route — the browser now calls Xtream / TMDB / TheIntroDB **directly**

## Layout

```
simple-iptv/
├── index.html          # markup / shell
├── css/
│   └── styles.css      # all styling (theme + accent via CSS variables)
├── js/
│   ├── config.js       # OPTIONAL defaults — blank by default (setup form is used)
│   ├── api.js          # Xtream client, stream-URL builder, TMDB, IntroDB, title matching
│   ├── storage.js      # localStorage: portal config, favorites, history, settings
│   ├── icons.js        # inline SVG icon set (no icon library)
│   ├── player.js       # HLS/MPEG-TS/native player + controls
│   └── app.js          # catalog, filtering, modals, rendering
└── vendor/
    ├── jquery.min.js
    ├── hls.min.js
    └── mpegts.min.js
```

## How it talks to the portal

- **API:**  `GET {host}/player_api.php?username=…&password=…&action=…`
- **Streams:** `{host}/{live|movie|series}/{username}/{password}/{stream_id}.{ext}`

Responses are cached in memory + `localStorage` (24 h for catalogs) so section
switching is instant. **Sync** in the header clears the cache and re-fetches.

## VOD compatibility mode (movies / series that return 403)

Some Xtream panels sit behind a WAF that **rejects browser User-Agents on VOD
paths ending in a media extension** (`/movie/…/123.mp4` → HTTP 403), while the
CDN that the portal redirects to serves the file to browsers just fine. Live
paths are not affected.

A browser cannot change its own `User-Agent`, so the app works around it by
appending an encoded space to the filename (`…/123.mp4%20`), which breaks the
WAF pattern while the CDN still serves the file. This is **on by default**
(uncheck *VOD compatibility mode* in Connection settings if your portal 404s on
it). The player also auto-retries the opposite form once if playback errors, so
it self-corrects either way.

## Notes & caveats

- **Credentials live in the browser's localStorage** (or `js/config.js` if you
  pre-fill it). That is inherent to a no-backend build — the browser must know
  the portal user/password to talk to it.
- The portal must send permissive `Access-Control-Allow-Origin` headers
  (most Xtream panels do). If a portal doesn't, a small CORS proxy is required —
  which would reintroduce a server.
- TMDB enrichment and theme songs are skipped automatically when disabled or
  when no TMDB key is set.
- Live channels play as MPEG-TS via `mpegts.js`; HLS (`.m3u8`) uses `hls.js`;
  movies/series use the native `<video>` element.
- Browser autoplay policies may block the theme song until you click; the button
  turns amber to indicate that.
