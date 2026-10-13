/* ============================================================
   simple-iptv — persistence (localStorage)
   Favorites, watch history / resume positions, and UI settings.
   ============================================================ */
(function (window) {
  "use strict";

  var FAV_KEY = "simple_iptv_favorites_v1";
  var HIST_KEY = "simple_iptv_history_v1";
  var SET_KEY = "simple_iptv_settings_v1";

  function ls() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function read(key, fallback) {
    var s = ls();
    if (!s) return fallback;
    try { var raw = s.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }

  function write(key, val) {
    var s = ls();
    if (!s) return;
    try { s.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function keyFor(section, id) { return section + "_" + id; }

  /* ------------------------- Favorites ------------------------- */
  function getFavorites() { return read(FAV_KEY, []); }

  function isFavorite(section, id) {
    var k = keyFor(section, id);
    return getFavorites().some(function (f) { return f.key === k; });
  }

  function toggleFavorite(item) {
    var favs = getFavorites();
    var section = item.type === "vod" ? "movies" : item.type;
    var itemId = item.type === "series" ? item.series_id : item.stream_id;
    var k = keyFor(section, itemId);
    var idx = -1;
    favs.forEach(function (f, i) { if (f.key === k) idx = i; });
    var nowFav;
    if (idx >= 0) { favs.splice(idx, 1); nowFav = false; }
    else {
      favs.unshift({
        key: k, id: itemId, section: section,
        title: item.name || item.title || "Untitled",
        poster: item.poster || item.stream_icon || item.cover,
        rating: item.rating !== undefined && item.rating !== null ? String(item.rating) : "",
        item: item, addedAt: Date.now()
      });
      nowFav = true;
    }
    write(FAV_KEY, favs);
    return nowFav;
  }

  function removeFavorite(section, id) {
    var k = keyFor(section, id);
    write(FAV_KEY, getFavorites().filter(function (f) { return f.key !== k; }));
  }

  /* ---------------------- Watch history ------------------------ */
  function getHistory() { return read(HIST_KEY, []); }

  function saveProgress(rec) {
    // rec: { key, id, section, title, poster, lastPosition, duration }
    var hist = getHistory();
    var idx = -1;
    hist.forEach(function (h, i) { if (h.key === rec.key) idx = i; });
    var merged = Object.assign({}, idx >= 0 ? hist[idx] : {}, rec, { updatedAt: Date.now() });
    if (idx >= 0) hist[idx] = merged; else hist.unshift(merged);
    // keep the list bounded
    if (hist.length > 500) hist = hist.slice(0, 500);
    write(HIST_KEY, hist);
  }

  function getProgress(key) {
    var h = getHistory();
    for (var i = 0; i < h.length; i++) if (h[i].key === key) return h[i];
    return null;
  }

  function getSeriesProgress(seriesId) {
    var target = String(seriesId);
    var items = getHistory().filter(function (h) {
      return h.section === "series" && (
        String(h.id) === target ||
        h.key === "series_" + target ||
        h.key.indexOf("series_" + target + "_") === 0
      );
    });
    if (!items.length) return null;
    items.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var latest = items[0];
    var percent = latest.duration > 0
      ? Math.min(100, Math.floor((latest.lastPosition / latest.duration) * 100)) : 0;
    var completed = items.filter(function (h) {
      return h.duration > 0 && h.lastPosition / h.duration >= 0.9;
    }).length;
    return { percent: percent, isWatched: percent >= 90 || completed > 0, latest: latest, count: items.length };
  }

  function removeFromHistory(key) {
    write(HIST_KEY, getHistory().filter(function (h) { return h.key !== key; }));
  }

  function clearHistory() { write(HIST_KEY, []); }

  /* ------------------------- Settings -------------------------- */
  var DEFAULT_SETTINGS = {
    theme: (window.IPTV_CONFIG && window.IPTV_CONFIG.theme) || "dark-glass",
    accent: (window.IPTV_CONFIG && window.IPTV_CONFIG.accent) || "cyan",
    view: "grid"
  };

  function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, read(SET_KEY, {}));
  }

  function saveSettings(patch) {
    var next = Object.assign(getSettings(), patch || {});
    write(SET_KEY, next);
    return next;
  }

  function resetAllData() {
    var s = ls();
    if (!s) return;
    [FAV_KEY, HIST_KEY, SET_KEY].forEach(function (k) { s.removeItem(k); });
    window.IPTV_API.cacheClear();
  }

  /* --------------------- Portal configuration ------------------ */
  // Stored separately from UI preferences so it can be reset on its own.
  // Loaded immediately (below) so the API layer sees it before first use.
  var PORTAL_KEY = "simple_iptv_portal_v1";
  var PORTAL_FIELDS = ["host", "username", "password", "tmdbApiKey", "vodWafBypass", "themeSongs", "language"];

  function getConfig() {
    var out = {};
    PORTAL_FIELDS.forEach(function (k) { out[k] = window.IPTV_CONFIG[k]; });
    return out;
  }

  function saveConfig(patch) {
    var saved = read(PORTAL_KEY, {});
    PORTAL_FIELDS.forEach(function (k) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, k)) {
        saved[k] = patch[k];
        window.IPTV_CONFIG[k] = patch[k];   // api.js holds a live reference
      }
    });
    write(PORTAL_KEY, saved);
    return getConfig();
  }

  function isConfigured() {
    var c = window.IPTV_CONFIG;
    return !!(c.host && String(c.host).trim() && c.username && String(c.username).trim());
  }

  function applySavedConfig() {
    var saved = read(PORTAL_KEY, null);
    if (!saved) return false;
    PORTAL_FIELDS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(saved, k)) window.IPTV_CONFIG[k] = saved[k];
    });
    return true;
  }

  applySavedConfig(); // run at load time

  window.IPTV_STORE = {
    getConfig: getConfig,
    saveConfig: saveConfig,
    isConfigured: isConfigured,
    applySavedConfig: applySavedConfig,
    clearSavedConfig: function () { var s = ls(); if (s) s.removeItem(PORTAL_KEY); },
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    toggleFavorite: toggleFavorite,
    removeFavorite: removeFavorite,
    getHistory: getHistory,
    saveProgress: saveProgress,
    getProgress: getProgress,
    getSeriesProgress: getSeriesProgress,
    removeFromHistory: removeFromHistory,
    clearHistory: clearHistory,
    getSettings: getSettings,
    saveSettings: saveSettings,
    resetAllData: resetAllData
  };
})(window);
