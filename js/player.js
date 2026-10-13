/* ============================================================
   simple-iptv — video player
   Handles HLS (hls.js), MPEG-TS (mpegts.js) and plain HTML5
   playback, custom controls, resume, and skip-intro.
   ============================================================ */
(function (window, $) {
  "use strict";

  var API = window.IPTV_API;
  var STORE = window.IPTV_STORE;
  var ICON = window.IPTV_ICONS;

  var video, shell, modal, ui;
  var hlsPlayer = null, mpegtsPlayer = null;
  var media = null;
  var saveTimer = null;
  var hideTimer = null;
  var skipData = null, skipActive = null;
  var wafRetried = false;

  function el(id) { return document.getElementById(id); }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) return "00:00";
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return h > 0 ? h + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s);
  }

  function setIcon(btn, name) {
    if (!btn) return;
    btn.innerHTML = ICON.svg(name);
  }

  function activeSkip(time) {
    if (!skipData) return null;
    var kinds = ["intro", "recap", "credits"];
    for (var i = 0; i < kinds.length; i++) {
      var seg = normSeg(skipData[kinds[i]]);
      if (seg && time >= seg.start && time < seg.end) return { kind: kinds[i], seg: seg };
    }
    return null;
  }

  function normSeg(raw) {
    if (!raw) return null;
    var seg = Array.isArray(raw) ? raw[0] : raw;
    if (!seg) return null;
    var start = seg.start_ms !== undefined ? seg.start_ms : seg.start;
    var end = seg.end_ms !== undefined ? seg.end_ms : seg.end;
    if (typeof start !== "number" || typeof end !== "number") return null;
    if (start > 10000 || end > 10000 || seg.start_ms !== undefined) { start /= 1000; end /= 1000; }
    if (end <= start) return null;
    return { start: start, end: end };
  }

  function destroyPlayers() {
    if (hlsPlayer) { try { hlsPlayer.destroy(); } catch (e) {} hlsPlayer = null; }
    if (mpegtsPlayer) { try { mpegtsPlayer.destroy(); } catch (e) {} mpegtsPlayer = null; }
  }

  function initPlayback() {
    var src = media.src;
    var ext = media.containerExtension || "mp4";
    var isHls = /\.m3u8(\?|$)/i.test(src) || ext === "m3u8";
    var isTs = /\.ts(\?|$)/i.test(src) || ext === "ts" || ext === "mpegts";

    video.poster = media.poster || "";
    destroyPlayers();

    if (isHls && window.Hls && window.Hls.isSupported()) {
      hlsPlayer = new window.Hls({ enableWorker: true, lowLatencyMode: media.section === "live" });
      hlsPlayer.loadSource(src);
      hlsPlayer.attachMedia(video);
      hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, function () { tryPlay(); });
      hlsPlayer.on(window.Hls.Events.ERROR, function (evt, data) {
        if (!data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hlsPlayer.startLoad();
        else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hlsPlayer.recoverMediaError();
        else { showError("Playback error: " + (data.details || "unknown")); }
      });
    } else if (isTs && window.mpegts && window.mpegts.isSupported()) {
      mpegtsPlayer = window.mpegts.createPlayer({ type: "mpegts", isLive: media.section === "live", url: src });
      mpegtsPlayer.attachMediaElement(video);
      mpegtsPlayer.on(window.mpegts.Events.ERROR, function () { showError("Stream error — the channel may be offline."); });
      mpegtsPlayer.load();
      tryPlay();
    } else {
      video.src = src;
      tryPlay();
    }
  }

  var playWarned = false;
  function tryPlay() {
    var p = video.play();
    if (p && p.catch) p.catch(function (err) {
      if (!playWarned) { playWarned = true; toast("Press play to start (autoplay was blocked)."); }
    });
  }

  function showError(msg) {
    var box = el("player-error");
    box.textContent = msg;
    box.hidden = false;
  }

  /* Native (progressive) VOD playback failed — most often because the portal's
     WAF rejected this exact URL form. Retry once with the other suffix. */
  function handleNativeError() {
    if (!media || wafRetried) return;
    if (media.section === "live") return;
    if (hlsPlayer || mpegtsPlayer) return;   // only plain <video> playback
    if (!video.error) return;
    wafRetried = true;
    var kind = media.section === "series" ? "series" : "movie";
    var alt = API.alternateStreamUrl(media.src, kind);
    media.src = alt;
    video.src = alt;
    tryPlay();
    toast("Retrying stream with an alternate URL…");
  }

  function toast(msg) {
    if (window.IPTV_APP && window.IPTV_APP.toast) window.IPTV_APP.toast(msg);
  }

  /* ---------------- progress ---------------- */
  function saveProgress() {
    if (!media) return;
    if (video.duration > 0 && video.currentTime > 2) {
      STORE.saveProgress({
        key: media.itemKey, id: media.streamId, section: media.section,
        title: media.title, poster: media.poster || media.backdrop,
        lastPosition: Math.floor(video.currentTime),
        duration: Math.floor(video.duration)
      });
    }
  }

  /* ---------------- skip intro ---------------- */
  function loadSkip() {
    skipData = null; skipActive = null; el("skip-btn").hidden = true;
    var id = (media.tmdbId !== undefined && media.tmdbId !== null && String(media.tmdbId).trim() !== "")
      ? media.tmdbId : media.tvdbId;
    var idType = (id === media.tmdbId) ? "tmdb" : "tvdb";
    if (id === undefined || id === null || media.seasonNum === undefined || media.episodeNum === undefined) return;
    API.introTimestamps(id, media.seasonNum, media.episodeNum, idType).then(function (data) {
      if (!data) return;
      // Accept either nested {intro:{start,end}} or flat intro_start/intro_end shapes
      skipData = {
        intro: data.intro || data.intro_segments || (data.intro_start ? { start: data.intro_start, end: data.intro_end } : null),
        recap: data.recap || data.recap_segments,
        credits: data.credits || data.credits_segments || data.outro
      };
    });
  }

  function refreshSkipBtn() {
    var hit = activeSkip(video.currentTime);
    skipActive = hit;
    var btn = el("skip-btn");
    if (!hit) { btn.hidden = true; return; }
    var label = hit.kind === "intro" ? "Skip Intro" : hit.kind === "recap" ? "Skip Recap" : "Skip Outro";
    btn.innerHTML = ICON.svg("skip") + "<span>" + label + "</span>";
    btn.hidden = false;
  }

  /* ---------------- controls ---------------- */
  function showUI() {
    ui.classList.remove("hide");
    if (hideTimer) clearTimeout(hideTimer);
    if (!video.paused) hideTimer = setTimeout(function () { ui.classList.add("hide"); }, 3000);
  }

  function updatePlayIcon() {
    setIcon(el("btn-play"), video.paused ? "play" : "pause");
    el("play-circle").style.display = video.paused ? "grid" : "none";
  }

  function updateTime() {
    var d = isFinite(video.duration) ? video.duration : 0;
    el("time-display").textContent = fmt(video.currentTime) + " / " + fmt(d);
    var seek = el("seek");
    if (d > 0) {
      seek.max = d;
      seek.value = video.currentTime;
      var pct = (video.currentTime / d) * 100;
      seek.style.background = "linear-gradient(to right, var(--accent-light) " + pct + "%, var(--border-subtle) " + pct + "%)";
    } else {
      seek.value = 0;
    }
  }

  function seekTo(t) {
    if (!isFinite(video.duration)) { if (t !== 0) return; }
    video.currentTime = Math.max(0, Math.min(video.duration || t, t));
    updateTime();
  }

  /* ---------------- public open/close ---------------- */
  function open(m) {
    media = m;
    playWarned = false;
    wafRetried = false;
    el("player-error").hidden = true;
    el("player-title").textContent = m.title || "Now Playing";
    el("player-title").title = m.title || "";
    modal.hidden = false;
    ui.classList.remove("hide");
    video.volume = 1; video.muted = false;
    el("volume").value = 1;
    el("speed").value = "1"; video.playbackRate = 1;
    setIcon(el("btn-mute"), "volume");
    loadSkip();
    initPlayback();

    // resume banner
    var saved = STORE.getProgress(m.itemKey);
    if (saved && saved.lastPosition > 10 && saved.duration > 0 && (saved.duration - saved.lastPosition) > 20) {
      el("resume-time").textContent = fmt(saved.lastPosition);
      el("resume-banner").hidden = false;
      el("resume-banner").dataset.pos = saved.lastPosition;
    } else {
      el("resume-banner").hidden = true;
    }

    saveTimer = setInterval(saveProgress, 4000);
  }

  function close() {
    saveProgress();
    if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
    destroyPlayers();
    try { video.pause(); } catch (e) {}
    video.removeAttribute("src");
    try { video.load(); } catch (e) {}
    modal.hidden = true;
    el("resume-banner").hidden = true;
    el("skip-btn").hidden = true;
    skipData = null;
    var m = media;
    media = null;
    if (window.IPTV_APP && window.IPTV_APP.onPlayerClosed) window.IPTV_APP.onPlayerClosed(m);
  }

  function bind() {
    video = el("video"); shell = el("player-shell"); modal = el("player-modal"); ui = el("player-ui");

    setIcon(el("btn-play"), "play");
    setIcon(el("btn-mute"), "volume");
    setIcon(el("btn-fs"), "expand");
    setIcon(el("btn-back10"), "back10");
    setIcon(el("btn-fwd10"), "fwd10");

    el("player-close").innerHTML = ICON.svg("x");
    el("play-circle").innerHTML = ICON.svg("play");

    video.addEventListener("play", function () { updatePlayIcon(); showUI(); });
    video.addEventListener("pause", function () { updatePlayIcon(); showUI(); });
    video.addEventListener("timeupdate", function () { updateTime(); refreshSkipBtn(); });
    video.addEventListener("durationchange", updateTime);
    video.addEventListener("volumechange", function () {
      el("volume").value = video.muted ? 0 : video.volume;
      setIcon(el("btn-mute"), video.muted || video.volume === 0 ? "mute" : "volume");
    });
    video.addEventListener("ended", function () { saveProgress(); });
    video.addEventListener("error", handleNativeError);

    el("player-close").onclick = close;
    el("btn-play").onclick = function () { video.paused ? video.play() : video.pause(); };
    el("player-center").onclick = function () { video.paused ? video.play() : video.pause(); };
    el("btn-back10").onclick = function () { seekTo(video.currentTime - 10); };
    el("btn-fwd10").onclick = function () { seekTo(video.currentTime + 10); };
    el("btn-mute").onclick = function () { video.muted = !video.muted; };

    el("seek").addEventListener("input", function (e) { seekTo(parseFloat(e.target.value)); });
    el("volume").addEventListener("input", function (e) {
      var v = parseFloat(e.target.value);
      video.volume = v; video.muted = v === 0;
    });
    el("speed").addEventListener("change", function (e) { video.playbackRate = parseFloat(e.target.value); });

    el("btn-fs").onclick = toggleFullscreen;
    el("player-shell").addEventListener("dblclick", toggleFullscreen);

    el("btn-resume").onclick = function () {
      seekTo(parseFloat(el("resume-banner").dataset.pos));
      el("resume-banner").hidden = true;
    };
    el("btn-restart").onclick = function () { seekTo(0); el("resume-banner").hidden = true; };
    el("btn-resume-x").onclick = function () { el("resume-banner").hidden = true; };

    el("skip-btn").onclick = function () { if (skipActive) { seekTo(skipActive.seg.end); refreshSkipBtn(); } };

    shell.addEventListener("mousemove", showUI);
    shell.addEventListener("touchstart", showUI);

    document.addEventListener("keydown", function (e) {
      if (modal.hidden) return;
      var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      switch (e.code) {
        case "Space": e.preventDefault(); video.paused ? video.play() : video.pause(); break;
        case "ArrowLeft": e.preventDefault(); seekTo(video.currentTime - 5); break;
        case "ArrowRight": e.preventDefault(); seekTo(video.currentTime + 5); break;
        case "ArrowUp": e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); break;
        case "ArrowDown": e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); break;
        case "KeyM": video.muted = !video.muted; break;
        case "KeyF": toggleFullscreen(); break;
        case "Escape": if (!document.fullscreenElement) close(); break;
      }
    });

    document.addEventListener("fullscreenchange", function () {
      setIcon(el("btn-fs"), document.fullscreenElement ? "shrink" : "expand");
    });
  }

  function toggleFullscreen() {
    var el = shell;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || function () {}).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen || function () {}).call(document);
    }
  }

  // Scripts sit at the end of <body>, so the DOM is already parsed; guard anyway.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.IPTV_PLAYER = { open: open, close: close, isOpen: function () { return modal && !modal.hidden; } };
})(window, jQuery);
