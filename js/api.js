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
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry)); } catch (err) {}
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
    if (/%20$/.test(url)) return url.replace(/%20$/, "");
    return url + "%20";
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

    /* Verify portal credentials — returns {ok, message, info}. */
    testConnection: function (override) {
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
