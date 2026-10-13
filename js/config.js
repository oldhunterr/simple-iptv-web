/* ============================================================
   simple-iptv — configuration
   ------------------------------------------------------------
   These are only *fallback defaults*.

   By default they are BLANK, so the app asks every new user for
   the portal URL / username / password on first run and remembers
   them in the browser (Connection settings).

   If you want to ship the app pre-filled for your own users,
   put the values here — they will be used to pre-fill the setup
   form and to connect immediately.
   ============================================================ */
window.IPTV_CONFIG = {
  // --- Source: "xtream" (Xtream Codes portal) or "m3u" (playlist link) ---
  sourceType: "xtream",

  // --- Xtream Codes portal (blank = ask the user) --------------
  host: "",
  username: "",
  password: "",

  // --- M3U playlist link (used when sourceType === "m3u") ------
  // e.g. "https://iptv-org.github.io/iptv/languages/ara.m3u"
  m3uUrl: "",

  // --- Metadata enrichment (optional) --------------------------
  // TMDB API key — powers posters, plots, cast and episode info.
  tmdbApiKey: "",

  // --- Feature toggles -----------------------------------------
  introDbEnabled: true,     // Skip-Intro markers from TheIntroDB
  themeSongs: true,         // Plex theme songs on the series page

  // Some Xtream panels sit behind a WAF that rejects *browser* User-Agents on
  // VOD paths ending in a media extension (HTTP 403), while the CDN behind the
  // redirect serves the file fine. Appending an encoded space breaks the WAF
  // pattern and the stream plays. Turn OFF only if your portal 404s on it —
  // the player also auto-retries with the other form, so this is just the
  // first form it tries.
  vodWafBypass: true,

  // --- Preferences ---------------------------------------------
  defaultSection: "live",   // live | movies | series
  gridBatch: 120,           // items added per infinite-scroll batch
  theme: "dark-glass",      // dark-glass | oled-black | neon-cyber | classic-tivimate
  accent: "cyan",           // cyan | amber | emerald | purple | pink | crimson
  language: "en-US"         // metadata language
};

/* Accent colour swatches (mirrors the original app's palette). */
window.IPTV_ACCENTS = {
  cyan:    { primary: "#06b6d4", hover: "#0891b2", light: "#22d3ee", glow: "rgba(6,182,212,.35)" },
  amber:   { primary: "#f59e0b", hover: "#d97706", light: "#fbbf24", glow: "rgba(245,158,11,.35)" },
  emerald: { primary: "#10b981", hover: "#059669", light: "#34d399", glow: "rgba(16,185,129,.35)" },
  purple:  { primary: "#8b5cf6", hover: "#7c3aed", light: "#a78bfa", glow: "rgba(139,92,246,.35)" },
  pink:    { primary: "#ec4899", hover: "#db2777", light: "#f472b6", glow: "rgba(236,72,153,.35)" },
  crimson: { primary: "#ef4444", hover: "#dc2626", light: "#f87171", glow: "rgba(239,68,68,.35)" }
};
