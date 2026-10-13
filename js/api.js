/* ============================================================
   simple-iptv — data layer
   Talks *directly* to the Xtream Codes portal, TMDB and TheIntroDB
   from the browser. No server, no proxy.
   ============================================================ */
(function (window) {
  "use strict";

  var cfg = window.IPTV_CONFIG || {};

  function normalizeHost(host) {
    host = String(host || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(host)) host = "http://" + host;
    return host;
  }

  function apiBase() {
    return normalizeHost(cfg.host) + "/player_api.php";
  }

  /* ---------------------------------------------------------------
     Tiny TTL cache (memory + localStorage) so section switches are instant
     and a page refresh doesn't hammer the portal.
     --------------------------------------------------------------- */
  var _mem = {};
  var LS_PREFIX = "simple_iptv_cache_";

  function cacheGet(key) {
    var now = Date.now();
    var e = _mem[key];
    if (e && e.exp > now) return e.data;
    try {
      var raw = localStorage.getItem(LS_PREFIX + key);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && p.exp > now) { _mem[key] = p; return p.data; }
      }
    } catch (err) {}
    return undefined;
  }

  function cacheSet(key, data, ttlMs) {
    var entry = { data: data, exp: Date.now() + (ttlMs || 3600000) };
    _mem[key] = entry;
    try {
      var json = JSON.stringify(entry);
      if (json.length > 2 * 1024 * 1024) return;   // too big for localStorage — keep in memory only
      localStorage.setItem(LS_PREFIX + key, json);
    } catch (err) {}
  }

  function cacheClear() {
    _mem = {};
    try {
      Object.keys(localStorage)
        .filter(function (k) { return k.indexOf(LS_PREFIX) === 0; })
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (err) {}
  }

  /* ---------------------------------------------------------------
     Xtream Codes player_api
     --------------------------------------------------------------- */
  var TTL = {
    get_live_categories: 24 * 3600e3,
    get_live_streams: 24 * 3600e3,
    get_vod_categories: 24 * 3600e3,
    get_vod_streams: 24 * 3600e3,
    get_series_categories: 24 * 3600e3,
    get_series: 24 * 3600e3,
    get_series_info: 1800e3,
    get_vod_info: 1800e3
  };

  function buildPlayerApiUrl(action, extra) {
    var url = new URL(apiBase());
    url.searchParams.set("username", cfg.username);
    url.searchParams.set("password", cfg.password);
    url.searchParams.set("action", action);
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        if (extra[k] === undefined || extra[k] === null) return;
        url.searchParams.set(k, extra[k]);
      });
    }
    return url.toString();
  }

  function playerApi(action, extra, force) {
    var key = "xt:" + action + ":" + JSON.stringify(extra || {});
    if (!force) {
      var hit = cacheGet(key);
      if (hit !== undefined) return Promise.resolve(hit);
    }
    var url = buildPlayerApiUrl(action, extra);
    return fetch(url, { headers: { Accept: "application/json" } })
      .then(function (res) {
        if (!res.ok) throw new Error("portal " + action + " → HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        // Xtream sometimes returns "" or {"user_info":...} on failure
        if (data === "" || data === null) throw new Error("empty response for " + action);
        cacheSet(key, data, TTL[action] || 600e3);
        return data;
      });
  }

  /* ---------------------------------------------------------------
     Stream URL builder —  host/type/user/pass/id.ext
     --------------------------------------------------------------- */
  // Some Xtream panels sit behind a WAF that 403s *browser* User-Agents on VOD
  // paths whose filename ends in a media extension, while the CDN behind the
  // redirect serves the file fine. Appending an encoded space breaks the WAF
  // pattern. Live paths are exempt (they are not blocked).
  function wafSuffix(pathType) {
    return (pathType !== "live" && cfg.vodWafBypass !== false) ? "%20" : "";
  }

  function buildStreamUrl(type, streamId, container, withWafSuffix) {
    var host = normalizeHost(cfg.host);
    var pathType = type === "movie" ? "movie" : type === "series" ? "series" : "live";
    var id = String(streamId);
    var ext = container;
    if (id.indexOf(".") !== -1) {
      var parts = id.split(".");
      id = parts[0];
      if (!ext) ext = parts[1];
    }
    if (!ext) ext = pathType === "live" ? "ts" : "mp4";
    var useSuffix = (withWafSuffix === undefined) ? true : !!withWafSuffix;
    return host + "/" + pathType + "/" +
      encodeURIComponent(cfg.username) + "/" +
      encodeURIComponent(cfg.password) + "/" +
      id + "." + ext + (useSuffix ? wafSuffix(pathType) : "");
  }

  /* Flip the WAF-bypass suffix — used by the player to auto-retry the other
     form when a portal turns out to need (or reject) the workaround. */
  function alternateStreamUrl(url, type) {
    if (type === "live") return url;
    if (new RegExp("\\.(?:" + VOD_EXT + ")%20(\\?|$)", "i").test(url)) return stripWafBypass(url);
    if (/%20(\?|$)/.test(url)) return url.replace(/%20(\?|$)/, "$1");
    var w = applyWafBypass(url);
    return w !== url ? w : url + "%20";
  }

  /* ---------------------------------------------------------------
     Plex theme songs (https, no CORS needed for <audio>)
     --------------------------------------------------------------- */
  function themeSongUrl(tvdbId) {
    if (!cfg.themeSongs || tvdbId === undefined || tvdbId === null || String(tvdbId).trim() === "") return "";
    return "https://tvthemes.plexapp.com/" + encodeURIComponent(String(tvdbId).trim()) + ".mp3";
  }

  /* ---------------------------------------------------------------
     TMDB (direct browser calls — CORS enabled by TMDB)
     --------------------------------------------------------------- */
  function tmdbKey() { return cfg.tmdbApiKey || ""; }
  var TMDB = "https://api.themoviedb.org/3";

  function tmdbFetch(path, params) {
    if (!tmdbKey()) return Promise.resolve(null);
    var url = new URL(TMDB + path);
    url.searchParams.set("api_key", tmdbKey());
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== "")
        url.searchParams.set(k, params[k]);
    });
    var key = "tmdb:" + path + ":" + JSON.stringify(params || {});
    var hit = cacheGet(key);
    if (hit !== undefined) return Promise.resolve(hit);
    return fetch(url.toString(), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) cacheSet(key, d, 86400e3); return d; })
      .catch(function () { return null; });
  }

  function tmdbSearch(kind /* "movie" | "tv" */, query, year, lang) {
    var p = { query: query, language: lang || cfg.language || "en-US" };
    if (year) p[kind === "tv" ? "first_air_date_year" : "primary_release_year"] = year;
    return tmdbFetch("/search/" + kind, p);
  }

  function tmdbDetails(kind /* "movie" | "tv" */, id, season, lang) {
    var L = lang || cfg.language || "en-US";
    if (kind === "tv" && season !== undefined && season !== null && season !== "") {
      return tmdbFetch("/tv/" + id + "/season/" + season, { language: L });
    }
    return tmdbFetch("/" + kind + "/" + id,
      { language: L, append_to_response: "external_ids,credits,images" });
  }

  /* ---------------------------------------------------------------
     TheIntroDB (skip intro / recap / outro)
     --------------------------------------------------------------- */
  function introTimestamps(id, season, episode, idType) {
    if (!cfg.introDbEnabled) return Promise.resolve(null);
    var url = new URL("https://api.theintrodb.org/v3/media");
    url.searchParams.set(idType === "tmdb" ? "tmdb_id" : "tvdb_id", String(id));
    url.searchParams.set("season", String(season));
    url.searchParams.set("episode", String(episode));
    var key = "intro:" + id + ":" + season + ":" + episode;
    var hit = cacheGet(key);
    if (hit !== undefined) return Promise.resolve(hit);
    return fetch(url.toString(), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) cacheSet(key, d, 86400e3); return d; })
      .catch(function () { return null; });
  }

  /* ---------------------------------------------------------------
     Title helpers (ported from the original formatters/tmdb libs)
     --------------------------------------------------------------- */
  function cleanTitle(rawName) {
    if (!rawName) return { title: "" };
    var title = String(rawName);
    var year;
    title = title.replace(/^(EN|UK|US|FR|DE|AR|ES|PT|IT|RU|TR|IN|PK)[:| -]\s*/i, "");
    var ym = title.match(/[\(\[](\d{4})(?:-\d{4})?[\)\]]/);
    if (ym) year = ym[1];
    title = title.replace(/[\(\[].*?[\)\]]/g, "");
    title = title.replace(/\b(3d|4k|8k|fhd|uhd|hd|sd|hevc|h264|h265|x264|x265|10bit|1080p|720p|480p|2160p|1080i|web-dl|webrip|bluray|hdrip|dvdrip|dual[- ]audio|multi[- ]audio|multi|dubbed|subbed|eng|arb|ara|ar|fr|es|de|it|ru|tr)\b/gi, "");
    title = title.replace(/\b(s\d+|season\s*\d+|ep\s*\d+|episode\s*\d+)\b/gi, "");
    title = title.replace(/(مترجم|المترجم|مدبلج|المدبلج|مترجم للعربية|مدبلج للعربية)/g, "");
    var hasLatin = /[a-zA-Z]/.test(title);
    var hasArabic = /[\u0600-\u06FF]/.test(title);
    if (hasLatin && hasArabic) title = title.replace(/[\u0600-\u06FF]+/g, "");
    title = title.trim()
      .replace(/^[-_\s|\\/]+|[-_\s|\\/]+$/g, "")
      .replace(/\s*[-_|\\/]+\s*/g, " ")
      .replace(/\s+/g, " ");
    return { title: title || rawName, year: year };
  }

  function normalizeArabicText(str) {
    if (!str) return "";
    return String(str)
      .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
      .toLowerCase().trim();
  }

  function generateArabicSearchVariants(rawName) {
    var t = cleanTitle(rawName).title;
    if (!t) return [];
    var variants = [t];
    if (!/[\u0600-\u06FF]/.test(t)) return variants;
    var hamza = t
      .replace(/(^|\s)الام(?=\s|$)/g, "$1الأم")
      .replace(/(^|\s)ابلة(?=\s|$)/g, "$1أبلة")
      .replace(/(^|\s)ان(?=\s|$)/g, "$1إن")
      .replace(/(^|\s)انت(?=\s|$)/g, "$1أنت")
      .replace(/(^|\s)ام(?=\s|$)/g, "$1أم")
      .replace(/(^|\s)اخ(?=\s|$)/g, "$1أخ")
      .replace(/(^|\s)اخت(?=\s|$)/g, "$1أخت")
      .replace(/(^|\s)اب(?=\s|$)/g, "$1أب");
    if (hamza !== t && variants.indexOf(hamza) === -1) variants.push(hamza);
    var startAlif = t.replace(/(^|\s)الا/g, "$1الأ").replace(/(^|\s)ا/g, "$1أ");
    if (startAlif !== t && variants.indexOf(startAlif) === -1) variants.push(startAlif);
    return variants;
  }

  function findBestMatch(results, query, year, targetType) {
    if (!results || !results.length) return null;
    var tt = String(query).toLowerCase().trim();
    var ntt = normalizeArabicText(query);
    var best = null, max = -1;
    results.forEach(function (item) {
      var type = item.media_type || targetType;
      if (type !== targetType && results.length > 1) return;
      var score = 0;
      var names = [item.name, item.title, item.original_name, item.original_title]
        .filter(function (n) { return n && typeof n === "string"; })
        .map(function (n) { return n.toLowerCase().trim(); });
      var norm = names.map(normalizeArabicText);
      if (names.indexOf(tt) !== -1 || norm.indexOf(ntt) !== -1) score += 100;
      else if (names.some(function (n) { return n.indexOf(tt) !== -1 || tt.indexOf(n) !== -1; }) ||
               norm.some(function (n) { return n.indexOf(ntt) !== -1 || ntt.indexOf(n) !== -1; })) score += 50;
      else {
        var words = tt.split(/\s+/).filter(function (w) { return w.length > 1; });
        var hits = 0;
        names.forEach(function (n) { words.forEach(function (w) { if (n.indexOf(w) !== -1) hits++; }); });
        score += hits * 10;
      }
      var date = item.first_air_date || item.release_date || "";
      if (year && date.indexOf(year) === 0) score += 40;
      if (item.popularity) score += Math.min(10, item.popularity / 10);
      if (score > max) { max = score; best = item; }
    });
    return best || results[0];
  }

  function tmdbImage(path, size) {
    if (!path) return "";
    if (/^https?:/i.test(path)) return path;
    return "https://image.tmdb.org/t/p/" + (size || "w500") + path;
  }

  /* ---------------------------------------------------------------
     M3U / M3U8 playlists
     --------------------------------------------------------------- */
  var SXXEXX = /\b[Ss](\d{1,2})\s*[Ee](\d{1,3})\b/;
  var SXXEXX_X = /\b(\d{1,2})x(\d{2,3})\b/;
  var VOD_EXT = "mp4|mkv|avi|mov|m4v|webm|wmv";

  function isM3U() { return String(cfg.sourceType || "xtream") === "m3u"; }
  function m3uSourceUrl() { return String(cfg.m3uUrl || "").trim(); }

  function hashStr(s) {
    var h = 0, i;
    for (i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return "m" + (h >>> 0).toString(36);
  }

  function slug(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 70) || "x";
  }

  function extOf(url) {
    var m = String(url).split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : "";
  }

  /* Insert/remove the WAF-bypass suffix on an already-complete stream URL
     (used for M3U entries, whose URLs are given in full). */
  function applyWafBypass(url) {
    if (cfg.vodWafBypass === false) return url;
    var s = String(url);
    if (!/\/(movie|series)\//i.test(s)) return url;      // live/M3U URLs untouched
    var m = s.match(new RegExp("^(.*?\\.(?:" + VOD_EXT + "))(\\?.*)?$", "i"));
    if (!m) return url;
    if (/%20$/i.test(m[1])) return url;
    return m[1] + "%20" + (m[2] || "");
  }

  function stripWafBypass(url) {
    return String(url).replace(new RegExp("(\\.(?:" + VOD_EXT + "))%20(\\?|$)", "i"), "$1$2");
  }

  function parseExtinf(line) {
    var e = { name: "", logo: "", group: "", tvgId: "", tvgName: "" };
    var re = /([A-Za-z0-9_-]+)="([^"]*)"/g, m;
    while ((m = re.exec(line)) !== null) {
      var k = m[1].toLowerCase();
      if (k === "tvg-logo") e.logo = m[2];
      else if (k === "group-title") e.group = m[2];
      else if (k === "tvg-id") e.tvgId = m[2];
      else if (k === "tvg-name") e.tvgName = m[2];
    }
    // The display name is everything after the first comma that is outside quotes.
    var inQ = false, cut = -1, i;
    for (i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') inQ = !inQ;
      else if (c === "," && !inQ) { cut = i; break; }
    }
    if (cut >= 0) e.name = line.slice(cut + 1).trim();
    if (!e.name) e.name = e.tvgName || e.tvgId || "Unnamed";
    return e;
  }

  /* Time-sliced parse so huge playlists don't freeze the UI. */
  function parseM3U(text, onProgress) {
    return new Promise(function (resolve) {
      var entries = [], cur = null, i = 0, len = text.length;
      function step() {
        var t0 = Date.now();
        while (i < len && Date.now() - t0 < 25) {
          var nl = text.indexOf("\n", i);
          if (nl === -1) nl = len;
          var line = text.slice(i, nl);
          i = nl + 1;
          if (line.length && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
          if (!line) continue;
          if (line.charCodeAt(0) === 35) {                       // '#'
            if (line.lastIndexOf("#EXTINF:", 0) === 0) cur = parseExtinf(line);
            continue;                                            // skip #EXTGRP/#EXTVLCOPT
          }
          var u = line.trim();
          if (!u) continue;
          if (cur) { cur.url = u; entries.push(cur); cur = null; }
          else entries.push({ name: "", logo: "", group: "", url: u });
        }
        if (onProgress) onProgress(len ? i / len : 1, entries.length);
        if (i < len) setTimeout(step, 0);
        else resolve(entries);
      }
      step();
    });
  }

  function classifyEntry(e) {
    var url = e.url || "", name = e.name || "", grp = String(e.group || "").toLowerCase();
    if (/\/movie\//i.test(url)) return "movies";
    if (/\/series\//i.test(url)) return "series";
    // Only treat something as a series if it actually looks episodic — a group
    // called "Series" is usually just 24/7 drama channels, not episodes.
    if (SXXEXX.test(name) || SXXEXX_X.test(name)) return "series";
    if (/(movie|film|cinema|vod|أفلام|افلام)/.test(grp)) return "movies";
    if (new RegExp("\\.(" + VOD_EXT + ")(\\?|$)", "i").test(url)) return "movies";
    return "live";
  }

  function parseEpisodeName(name) {
    var m = name.match(SXXEXX) || name.match(SXXEXX_X);
    if (!m) return null;
    var idx = m.index;
    return {
      series: name.slice(0, idx).replace(/[\s._\-–]+$/, "").trim() || name,
      season: parseInt(m[1], 10),
      episode: parseInt(m[2], 10),
      epTitle: name.slice(idx + m[0].length).replace(/^[\s._\-–:]+/, "").trim()
    };
  }

  /* Turn parsed entries into the same {cats, items} shape the UI expects. */
  function buildM3UCatalog(entries) {
    var out = {
      live: { cats: [], items: [] },
      movies: { cats: [], items: [] },
      series: { cats: [], items: [] }
    };
    var seen = { live: {}, movies: {}, series: {} };
    var seriesMap = {}, seriesOrder = [];

    function catFor(section, name) {
      var n = name || "Uncategorised";
      var id = slug(n);
      if (!seen[section][id]) {
        seen[section][id] = { category_id: id, category_name: n };
        out[section].cats.push(seen[section][id]);
      }
      return id;
    }

    entries.forEach(function (e) {
      if (!e.url) return;
      var kind = classifyEntry(e);
      var catId = catFor(kind, e.group);
      var title = e.name || e.url;

      if (kind === "series") {
        var p = parseEpisodeName(title);
        var sName = p ? p.series : title;
        var sid = "m3u-" + slug(sName);
        var s = seriesMap[sid];
        if (!s) {
          s = seriesMap[sid] = {
            id: sid, series_id: sid, title: sName, name: sName, type: "series",
            poster: e.logo, cover: e.logo, category_id: catId,
            genre: e.group || "", m3u_episodes: [], raw: { name: sName, series_id: sid, category_id: catId, cover: e.logo }
          };
          seriesOrder.push(sid);
        }
        if (!s.cover && e.logo) { s.cover = e.logo; s.poster = e.logo; }
        s.m3u_episodes.push({
          id: hashStr(e.url), stream_url: applyWafBypass(e.url),
          episode_num: p ? p.episode : s.m3u_episodes.length + 1,
          season_num: p ? p.season : 1,
          title: (p && p.epTitle) ? p.epTitle : title,
          container_extension: extOf(e.url) || "mp4",
          info: { movie_image: e.logo, cover_big: e.logo }
        });
        return;
      }

      var isMovie = kind === "movies";
      out[kind].items.push({
        id: hashStr(e.url), stream_id: hashStr(e.url),
        stream_url: isMovie ? applyWafBypass(e.url) : e.url,
        title: title, name: title, type: isMovie ? "movies" : "live",
        poster: e.logo, stream_icon: e.logo, category_id: catId,
        genre: e.group || "",
        container_extension: extOf(e.url) || (isMovie ? "mp4" : "ts"),
        raw: e
      });
    });

    seriesOrder.forEach(function (sid) { out.series.items.push(seriesMap[sid]); });
    return out;
  }

  /* Download + parse a playlist, cached in memory for the session. */
  function loadM3UPlaylist(force, onProgress) {
    var url = m3uSourceUrl();
    if (!url) return Promise.reject(new Error("No M3U playlist URL configured."));
    var key = "m3u:" + url;
    if (!force) {
      var hit = cacheGet(key);
      if (hit !== undefined) return Promise.resolve(hit);
    }
    if (onProgress) onProgress(-1, 0, "Downloading playlist…");
    return fetch(url, { headers: { Accept: "*/*" } })
      .then(function (r) {
        if (!r.ok) throw new Error("Playlist request failed (HTTP " + r.status + ")");
        return r.text();
      })
      .then(function (text) {
        if (!text || text.indexOf("#EXTM3U") === -1)
          throw new Error("That URL did not return an M3U playlist.");
        return parseM3U(text, function (frac, count) {
          if (onProgress) onProgress(frac, count, "Parsing playlist…");
        });
      })
      .then(function (entries) {
        var catalog = buildM3UCatalog(entries);
        cacheSet(key, catalog, 6 * 3600e3);          // memory-first (too big for localStorage)
        return catalog;
      });
  }

  /* ---------------------------------------------------------------
     Normalisation of catalog items (mirrors types/iptv normalizeCatalogItem)
     --------------------------------------------------------------- */
  function normalizeItem(raw, type) {
    if (type === "live") {
      return {
        id: raw.stream_id, stream_id: raw.stream_id, title: raw.name, name: raw.name,
        type: "live", poster: raw.stream_icon, stream_icon: raw.stream_icon,
        category_id: raw.category_id, rating: raw.rating, added: raw.added,
        epg_channel_id: raw.epg_channel_id, container_extension: "ts", raw: raw
      };
    }
    if (type === "movies" || type === "vod") {
      return {
        id: raw.stream_id, stream_id: raw.stream_id, title: raw.name, name: raw.name,
        type: "movies", poster: raw.stream_icon, stream_icon: raw.stream_icon,
        category_id: raw.category_id, rating: raw.rating, added: raw.added,
        container_extension: raw.container_extension || "mp4",
        plot: raw.plot, genre: raw.genre, raw: raw
      };
    }
    return {
      id: raw.series_id, series_id: raw.series_id, title: raw.name, name: raw.name,
      type: "series", poster: raw.cover, cover: raw.cover,
      category_id: raw.category_id, rating: raw.rating,
      added: raw.last_modified, plot: raw.plot, genre: raw.genre, raw: raw
    };
  }

  window.IPTV_API = {
    normalizeHost: normalizeHost,
    buildStreamUrl: buildStreamUrl,
    alternateStreamUrl: alternateStreamUrl,
    themeSongUrl: themeSongUrl,
    playerApi: playerApi,
    buildPlayerApiUrl: buildPlayerApiUrl,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    cacheClear: cacheClear,
    tmdbSearch: tmdbSearch,
    tmdbDetails: tmdbDetails,
    tmdbImage: tmdbImage,
    tmdbEnabled: function () { return !!tmdbKey(); },
    introTimestamps: introTimestamps,
    cleanTitle: cleanTitle,
    generateArabicSearchVariants: generateArabicSearchVariants,
    findBestMatch: findBestMatch,
    normalizeItem: normalizeItem,

    /* M3U source */
    isM3U: isM3U,
    m3uSourceUrl: m3uSourceUrl,
    loadM3UPlaylist: loadM3UPlaylist,
    parseM3U: parseM3U,
    buildM3UCatalog: buildM3UCatalog,
    applyWafBypass: applyWafBypass,
    hashStr: hashStr,

    /* Verify the configured source — returns {ok, message, info}. */
    testConnection: function (override) {
      var srcType = (override && override.sourceType) || cfg.sourceType || "xtream";

      if (srcType === "m3u") {
        var purl = String((override && override.m3uUrl) || cfg.m3uUrl || "").trim();
        if (!purl) return Promise.resolve({ ok: false, message: "Enter an M3U playlist URL." });
        return fetch(purl, { headers: { Accept: "*/*" } })
          .then(function (r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
          })
          .then(function (text) {
            if (!text || text.indexOf("#EXTM3U") === -1)
              return { ok: false, message: "That URL is reachable but is not an M3U playlist." };
            var n = (text.match(/#EXTINF/g) || []).length;
            var g = {};
            var re = /group-title="([^"]*)"/g, m;
            while ((m = re.exec(text)) !== null) g[m[1]] = 1;
            return { ok: true, message: "Playlist OK — " + n.toLocaleString() + " entries, " +
              Object.keys(g).length + " groups" };
          })
          .catch(function (err) {
            return { ok: false, message: "Could not load the playlist: " + (err.message || err) };
          });
      }

      var host = normalizeHost((override && override.host) || cfg.host);
      var user = (override && override.username) || cfg.username;
      var pass = (override && override.password) || cfg.password;
      if (!host || !user) return Promise.resolve({ ok: false, message: "Portal URL and username are required." });
      var url = new URL(host + "/player_api.php");
      url.searchParams.set("username", user);
      url.searchParams.set("password", pass);
      return fetch(url.toString(), { headers: { Accept: "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (d) {
          var info = d && d.user_info;
          if (!info) return { ok: false, message: "Unexpected response — is this an Xtream portal?" };
          if (String(info.auth) === "0") return { ok: false, message: "Login rejected — check username / password.", info: info };
          return {
            ok: true,
            message: "Connected" + (info.status ? " (" + info.status + ")" : "") +
              (info.exp_date && String(info.exp_date) !== "null" ? " — expires " + new Date(Number(info.exp_date) * 1000).toLocaleDateString() : ""),
            info: info
          };
        })
        .catch(function (err) {
          return { ok: false, message: "Could not reach the portal: " + (err.message || err) +
            " (check the URL, and that the portal allows cross-origin requests)" };
        });
    },

    // Convenience wrappers used by the app
    fetchLiveCategories: function (f) { return window.IPTV_API.playerApi("get_live_categories", {}, f); },
    fetchLiveStreams: function (f) { return window.IPTV_API.playerApi("get_live_streams", {}, f); },
    fetchVodCategories: function (f) { return window.IPTV_API.playerApi("get_vod_categories", {}, f); },
    fetchVodStreams: function (f) { return window.IPTV_API.playerApi("get_vod_streams", {}, f); },
    fetchSeriesCategories: function (f) { return window.IPTV_API.playerApi("get_series_categories", {}, f); },
    fetchSeries: function (f) { return window.IPTV_API.playerApi("get_series", {}, f); },
    fetchSeriesInfo: function (id, f) { return window.IPTV_API.playerApi("get_series_info", { series_id: id }, f); },
    fetchVodInfo: function (id, f) { return window.IPTV_API.playerApi("get_vod_info", { vod_id: id }, f); }
  };
})(window);
