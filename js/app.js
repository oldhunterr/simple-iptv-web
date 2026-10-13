/* ============================================================
   simple-iptv — application  (jQuery)
   Catalog browsing, filtering, favorites, history, detail modals
   and TMDB enrichment.
   ============================================================ */
(function (window, $) {
  "use strict";

  var API = window.IPTV_API;
  var STORE = window.IPTV_STORE;
  var ICON = window.IPTV_ICONS;
  var PLAYER = window.IPTV_PLAYER;
  var CFG = window.IPTV_CONFIG;

  var byId = function (id) { return document.getElementById(id); };

  var S = {
    section: CFG.defaultSection || "live",
    category: "ALL",
    search: "",
    catSearch: "",
    filters: defaultFilters(),
    data: { live: { cats: [], items: [] }, movies: { cats: [], items: [] }, series: { cats: [], items: [] } },
    loaded: { live: false, movies: false, series: false },
    visible: CFG.gridBatch || 120,
    modalMovieTmdb: null,
    modalSeriesTmdb: null
  };

  var GENRES = ["Action","Adventure","Animation","Comedy","Crime","Documentary","Drama","Family","Fantasy","Horror","Mystery","Romance","Sci-Fi","Thriller"];
  var THEMES = [["dark-glass","Dark Glass"],["oled-black","OLED Black"],["neon-cyber","Neon Cyber"],["classic-tivimate","TiviMate"]];

  function defaultFilters() {
    return { streamType: "all", resolution: "all", genres: [], minRating: 0, yearMin: 1980, yearMax: 2030, watched: "all", audio: "all", sort: "default" };
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var toastTimer = null;
  function toast(msg) {
    var t = byId("toast");
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3600);
  }

  /* ============================================================
     THEME
     ============================================================ */
  function applyTheme(settings) {
    var st = settings || STORE.getSettings();
    document.documentElement.setAttribute("data-theme", st.theme);
    var acc = (window.IPTV_ACCENTS || {})[st.accent];
    if (acc) {
      var root = document.documentElement.style;
      root.setProperty("--accent-primary", acc.primary);
      root.setProperty("--accent-hover", acc.hover);
      root.setProperty("--accent-light", acc.light);
      root.setProperty("--accent-glow", acc.glow);
    }
  }

  function buildThemePopover() {
    var st = STORE.getSettings();
    byId("theme-opts").innerHTML = THEMES.map(function (t) {
      return '<button class="theme-opt' + (st.theme === t[0] ? " on" : "") + '" data-theme="' + t[0] + '">' + t[1] + "</button>";
    }).join("");
    byId("accent-opts").innerHTML = Object.keys(window.IPTV_ACCENTS).map(function (k) {
      var c = window.IPTV_ACCENTS[k];
      return '<button class="swatch' + (st.accent === k ? " on" : "") + '" data-accent="' + k +
        '" style="background:' + c.primary + ';color:' + c.primary + '" title="' + k + '"></button>';
    }).join("");
  }

  /* ============================================================
     DATA LOADING
     ============================================================ */
  function loadSection(section, force) {
    if (section === "favorites" || section === "history") return Promise.resolve();
    if (!STORE.isConfigured()) { byId("loading").hidden = true; return Promise.resolve(); }
    if (S.loaded[section] && !force) return Promise.resolve();

    byId("loading").hidden = false;
    byId("grid").innerHTML = "";
    byId("empty").hidden = true;

    var p;
    if (section === "live") {
      p = Promise.all([API.fetchLiveCategories(force), API.fetchLiveStreams(force)])
        .then(function (r) {
          S.data.live.cats = r[0] || [];
          S.data.live.items = (r[1] || []).map(function (x) { return API.normalizeItem(x, "live"); });
        });
    } else if (section === "movies") {
      p = Promise.all([API.fetchVodCategories(force), API.fetchVodStreams(force)])
        .then(function (r) {
          S.data.movies.cats = r[0] || [];
          S.data.movies.items = (r[1] || []).map(function (x) { return API.normalizeItem(x, "movies"); });
        });
    } else {
      p = Promise.all([API.fetchSeriesCategories(force), API.fetchSeries(force)])
        .then(function (r) {
          S.data.series.cats = r[0] || [];
          S.data.series.items = (r[1] || []).map(function (x) { return API.normalizeItem(x, "series"); });
        });
    }

    return p.then(function () {
      S.loaded[section] = true;
      byId("loading").hidden = true;
      updateCounts();
      if (section === S.section) { buildCategoryList(); renderContent(); }
    }).catch(function (err) {
      byId("loading").hidden = true;
      byId("grid").innerHTML = "";
      byId("empty").hidden = false;
      byId("empty").querySelector(".empty-title").textContent = "Could not reach the IPTV portal";
      byId("empty").querySelector(".muted").textContent = String(err.message || err);
    });
  }

  function updateCounts() {
    byId("cnt-live").textContent = S.data.live.items.length;
    byId("cnt-movies").textContent = S.data.movies.items.length;
    byId("cnt-series").textContent = S.data.series.items.length;
    byId("cnt-favorites").textContent = STORE.getFavorites().length;
    byId("cnt-history").textContent = STORE.getHistory().length;
  }

  /* ============================================================
     FILTERING
     ============================================================ */
  function sourceItems() {
    if (S.section === "live") return S.data.live.items;
    if (S.section === "movies") return S.data.movies.items;
    if (S.section === "series") return S.data.series.items;
    if (S.section === "favorites") return STORE.getFavorites().map(function (f) { return f.item; });
    return [];
  }

  function matchAudio(item, target) {
    var t = (item.title || item.name || "").toLowerCase();
    var c = (item.category_name || item.group_title || "").toLowerCase();
    if (target === "dubbed") return t.indexOf("مدبلج") !== -1 || c.indexOf("مدبلج") !== -1 || t.indexOf("dubbed") !== -1;
    if (target === "subtitled") return t.indexOf("مترجم") !== -1 || c.indexOf("مترجم") !== -1 || t.indexOf("subbed") !== -1 || t.indexOf("subtitled") !== -1;
    if (target === "arabic") return /[\u0600-\u06FF]/.test(t) || c.indexOf("arabic") !== -1 || c.indexOf("عربي") !== -1 || c.indexOf("عربى") !== -1;
    if (target === "english") return /\b(english|en|us|uk)\b/.test(c);
    return true;
  }

  function applyFilters(source) {
    var f = S.filters;
    var out = source;

    if (S.category !== "ALL" && S.section !== "favorites") {
      out = out.filter(function (i) { return String(i.category_id) === S.category; });
    }
    if (S.search.trim()) {
      var q = S.search.toLowerCase().trim();
      out = out.filter(function (i) { return (i.title || i.name || "").toLowerCase().indexOf(q) !== -1; });
    }
    if (f.streamType && f.streamType !== "all") {
      out = out.filter(function (i) { return i.type === f.streamType; });
    }
    if (f.genres.length) {
      out = out.filter(function (i) {
        var g = (i.genre || "").toLowerCase();
        return f.genres.some(function (x) { return g.indexOf(x.toLowerCase()) !== -1; });
      });
    }
    if (f.minRating > 0) {
      out = out.filter(function (i) { return (parseFloat(String(i.rating || 0)) || 0) >= f.minRating; });
    }
    if (f.yearMin > 1980 || f.yearMax < 2030) {
      out = out.filter(function (i) {
        var ds = i.releaseDate || i.release_date || i.added || "";
        var m = ds.match(/\b(19\d\d|20\d\d)\b/);
        if (!m) return true;
        var y = parseInt(m[1], 10);
        return y >= f.yearMin && y <= f.yearMax;
      });
    }
    if (f.resolution && f.resolution !== "all") {
      var tr = f.resolution.toLowerCase();
      out = out.filter(function (i) {
        var t = (i.title || i.name || "").toLowerCase();
        if (tr === "4k") return t.indexOf("4k") !== -1 || t.indexOf("uhd") !== -1 || t.indexOf("2160") !== -1;
        if (tr === "1080p") return t.indexOf("1080") !== -1 || t.indexOf("fhd") !== -1 || t.indexOf("full hd") !== -1;
        if (tr === "720p") return t.indexOf("720") !== -1 || /\bhd\b/.test(t);
        return true;
      });
    }
    if (f.audio && f.audio !== "all") {
      out = out.filter(function (i) { return matchAudio(i, f.audio); });
    }
    if (f.watched && f.watched !== "all") {
      var hist = STORE.getHistory();
      out = out.filter(function (i) {
        var key = i.type + "_" + (i.type === "series" ? i.series_id : i.stream_id);
        var h = hist.filter(function (x) { return x.key === key || (i.type === "series" && x.key.indexOf("series_" + i.series_id + "_") === 0); })[0];
        var done = h && h.duration > 0 && h.lastPosition / h.duration >= 0.9;
        var prog = h && h.duration > 0 && h.lastPosition / h.duration < 0.9;
        if (f.watched === "unwatched") return !h;
        if (f.watched === "watched") return !!done;
        if (f.watched === "in-progress") return !!prog;
        return true;
      });
    }

    if (f.sort && f.sort !== "default") {
      out = out.slice().sort(function (a, b) {
        var an = a.title || a.name || "", bn = b.title || b.name || "";
        if (f.sort === "name_asc") return an.localeCompare(bn);
        if (f.sort === "name_desc") return bn.localeCompare(an);
        if (f.sort === "rating_desc") return (parseFloat(String(b.rating || 0)) || 0) - (parseFloat(String(a.rating || 0)) || 0);
        if (f.sort === "year_desc") {
          var ya = parseInt(((a.releaseDate || a.release_date || "").match(/\b(19\d\d|20\d\d)\b/) || [0, 0])[1], 10) || 0;
          var yb = parseInt(((b.releaseDate || b.release_date || "").match(/\b(19\d\d|20\d\d)\b/) || [0, 0])[1], 10) || 0;
          return yb - ya;
        }
        if (f.sort === "added_desc") return String(b.added || "").localeCompare(String(a.added || ""));
        return 0;
      });
    }
    return out;
  }

  function activeFilterCount() {
    var f = S.filters, n = 0;
    n += f.genres.length;
    if (f.minRating > 0) n++;
    if (f.yearMin > 1980 || f.yearMax < 2030) n++;
    if (f.watched !== "all") n++;
    if (f.streamType !== "all") n++;
    if (f.resolution !== "all") n++;
    if (f.audio !== "all") n++;
    if (f.sort !== "default") n++;
    return n;
  }

  /* ============================================================
     RENDERING — cards & grid
     ============================================================ */
  function cardProgress(item) {
    var itemId = item.type === "series" ? item.series_id : item.stream_id;
    if (item.type === "series") {
      var sp = STORE.getSeriesProgress(itemId);
      if (sp) return { percent: sp.percent, watched: sp.isWatched };
      return { percent: 0, watched: false };
    }
    var h = STORE.getProgress(item.type + "_" + itemId);
    if (h && h.duration > 0) {
      var p = Math.min(100, Math.floor((h.lastPosition / h.duration) * 100));
      return { percent: p, watched: p >= 90 };
    }
    return { percent: 0, watched: false };
  }

  function cardHtml(item) {
    var itemId = item.type === "series" ? item.series_id : item.stream_id;
    var poster = item.stream_icon || item.poster || item.cover || "";
    var isLive = item.type === "live";
    var title = item.name || item.title || "Untitled";
    var prog = cardProgress(item);
    var isFav = STORE.isFavorite(item.type === "vod" ? "movies" : item.type, itemId);
    var rating = item.rating !== undefined && item.rating !== null && item.rating !== "" ? String(item.rating) : "";

    var posterEl;
    if (poster) {
      posterEl = '<img src="' + esc(poster) + '" alt="' + esc(title) + '" loading="lazy" data-kind="' +
        (isLive ? "tv" : "film") + '">';
    } else {
      posterEl = '<div class="ph"><span class="ico">' + ICON.svg(isLive ? "tv" : "film") + '</span><span>' + esc(title) + "</span></div>";
    }

    return '<div class="card ' + (isLive ? "live" : "") + '" data-type="' + item.type + '" data-id="' + esc(itemId) + '">' +
      '<div class="card-poster">' + posterEl +
        '<div class="card-shade"></div>' +
        '<button class="fav-btn' + (isFav ? " on" : "") + '" data-fav="1">' + ICON.svg("heart") + "</button>" +
        '<div class="card-badges">' +
          (prog.watched ? '<span class="badge-watched"><span class="ico">' + ICON.svg("check") + '</span>Watched</span>' : "") +
          (rating ? '<span class="badge-rating">★ ' + esc(rating) + "</span>" : "") +
        "</div>" +
        '<div class="card-play"><div class="circle">' + ICON.svg("play") + "</div></div>" +
        (prog.percent > 0 && !prog.watched ? '<div class="card-progress"><i style="width:' + prog.percent + '%"></i></div>' : "") +
      "</div>" +
      '<div class="card-meta"><h3>' + esc(title) + "</h3><p>" + esc(item.type) +
        (prog.watched ? " · Watched" : prog.percent > 0 ? " · " + prog.percent + "%" : "") + "</p></div>" +
    "</div>";
  }

  var currentList = [];
  function renderContent() {
    if (S.section === "history") { renderHistory(); return; }
    byId("history-view").hidden = true;
    byId("grid").hidden = false;
    byId("empty").hidden = true;

    currentList = applyFilters(sourceItems());
    S.visible = CFG.gridBatch || 120;
    byId("current-category").textContent = currentCategoryName();
    byId("item-count").textContent = currentList.length.toLocaleString() + " items available";

    if (!currentList.length) {
      byId("grid").innerHTML = "";
      byId("empty").hidden = false;
      byId("empty").querySelector(".empty-title").textContent = "No items found";
      byId("empty").querySelector(".muted").textContent = "Try adjusting your search or filters.";
      return;
    }
    paintBatch();
  }

  function paintBatch() {
    var slice = currentList.slice(0, S.visible);
    byId("grid").innerHTML = slice.map(cardHtml).join("");

    // graceful fallback when a poster fails to load
    byId("grid").querySelectorAll("img[data-kind]").forEach(function (img) {
      img.addEventListener("error", function () {
        var ph = document.createElement("div");
        ph.className = "ph";
        ph.innerHTML = '<span class="ico">' + ICON.svg(img.getAttribute("data-kind")) +
          "</span><span>" + esc(img.alt) + "</span>";
        img.replaceWith(ph);
      });
    });

    var old = byId("load-more");
    if (old) old.remove();
    if (S.visible < currentList.length) {
      var b = document.createElement("button");
      b.className = "more-btn";
      b.id = "load-more";
      b.textContent = "Load more (" + (currentList.length - S.visible) + " remaining)";
      b.onclick = function () { S.visible += (CFG.gridBatch || 120); paintBatch(); };
      byId("content").appendChild(b);
    } else {
      var m = byId("load-more"); if (m) m.remove();
    }
    byId("grid").setAttribute("data-count", slice.length);
  }

  function currentCategoryName() {
    if (S.category === "ALL") return "All Categories";
    var cats = S.data[S.section] ? S.data[S.section].cats : [];
    var found = cats.filter(function (c) { return String(c.category_id) === S.category; })[0];
    return found ? found.category_name : "Category Items";
  }

  function renderHistory() {
    byId("grid").hidden = true;
    var v = byId("history-view");
    v.hidden = false;
    var hist = STORE.getHistory();
    var html = '<div class="hist-head"><div><h2>Watch History</h2><p class="muted" style="margin:4px 0 0;font-size:12px">' +
      hist.length + " item(s)</p></div>" +
      (hist.length ? '<button class="link danger" id="clear-history">' + ICON.svg("trash") + " Clear All</button>" : "") + "</div>";

    if (!hist.length) {
      html += '<div class="empty" style="grid-column:1/-1"><p class="empty-title">No watch history</p><p class="muted">Start watching to see progress here.</p></div>';
    } else {
      html += hist.map(function (h) {
        var pct = h.duration > 0 ? Math.min(100, Math.floor((h.lastPosition / h.duration) * 100)) : 0;
        return '<div class="hist-card" data-hist="' + esc(h.key) + '">' +
          '<div class="hist-poster">' + (h.poster ? '<img src="' + esc(h.poster) + '" alt="" loading="lazy">' : "") + "</div>" +
          '<div class="hist-body"><div><h4>' + esc(h.title) + '</h4><p class="pct">' + pct + "% watched</p></div>" +
          '<div class="hist-actions"><button class="link" data-resume="1">' + ICON.svg("play") + " Resume</button>" +
          '<button class="link danger" data-remove="1">' + ICON.svg("trash") + "</button></div></div></div>";
      }).join("");
    }
    v.innerHTML = html;
  }

  /* ============================================================
     CATEGORY SIDEBAR
     ============================================================ */
  function buildCategoryList() {
    var wrap = byId("cat-wrap");
    if (S.section === "favorites" || S.section === "history") { wrap.style.display = "none"; return; }
    wrap.style.display = "";

    var cats = (S.data[S.section] || {}).cats || [];
    var items = (S.data[S.section] || {}).items || [];

    // per-category item counts
    var counts = {};
    items.forEach(function (i) { var c = String(i.category_id); counts[c] = (counts[c] || 0) + 1; });

    var q = S.catSearch.trim().toLowerCase();
    var filtered = q
      ? cats.filter(function (c) { return String(c.category_name || "").toLowerCase().indexOf(q) !== -1; })
      : cats;

    var label = byId("cat-count-label");
    if (label) label.textContent = q ? filtered.length + " of " + cats.length : cats.length + " total";

    var html = '<button class="cat-item' + (S.category === "ALL" ? " active" : "") + '" data-cat="ALL">' +
      '<span class="cat-name">All Categories</span>' +
      '<span class="cat-count">' + items.length.toLocaleString() + "</span></button>";

    if (!filtered.length) {
      html += '<div class="cat-empty">No categories match “' + esc(S.catSearch.trim()) + '”</div>';
    } else {
      html += filtered.map(function (c) {
        var id = String(c.category_id);
        var n = counts[id] || 0;
        return '<button class="cat-item' + (S.category === id ? " active" : "") + (n ? "" : " empty") +
          '" data-cat="' + esc(id) + '" title="' + esc(c.category_name) + '">' +
          '<span class="cat-name">' + esc(c.category_name) + "</span>" +
          '<span class="cat-count">' + n.toLocaleString() + "</span></button>";
      }).join("");
    }
    byId("category-list").innerHTML = html;
  }

  /* ============================================================
     SELECTION / PLAYBACK
     ============================================================ */
  function findItem(type, id) {
    var src = type === "live" ? S.data.live.items : type === "movies" ? S.data.movies.items :
      type === "series" ? S.data.series.items : [];
    return src.filter(function (i) {
      return String(i.type === "series" ? i.series_id : i.stream_id) === String(id);
    })[0];
  }

  function selectItem(item) {
    if (!item) return;
    if (item.type === "live") {
      playLive(item);
    } else if (item.type === "movies" || item.type === "vod") {
      openMovieModal(item);
    } else if (item.type === "series") {
      openSeriesModal(item);
    }
  }

  function playLive(item) {
    var id = item.stream_id || item.id;
    PLAYER.open({
      src: API.buildStreamUrl("live", id, "ts"),
      title: item.name || item.title || "Live Stream",
      itemKey: "live_" + id, streamId: id, section: "live",
      poster: item.stream_icon || item.poster, containerExtension: "ts"
    });
  }

  function playMovie(item, tmdb) {
    var id = item.stream_id || item.id;
    var ext = item.container_extension || "mp4";
    PLAYER.open({
      src: API.buildStreamUrl("movie", id, ext),
      title: item.name || item.title || "Movie",
      itemKey: "movies_" + id, streamId: id, section: "movies",
      poster: (tmdb && tmdb.poster) || item.stream_icon || item.poster,
      backdrop: tmdb && tmdb.backdrop,
      containerExtension: ext,
      tmdbId: (tmdb && tmdb.id) || item.tmdb_id || (item.raw && item.raw.tmdb_id)
    });
  }

  function playEpisode(series, seasonNum, ep, tmdb) {
    var ext = ep.container_extension || "mp4";
    var title = series.name + " — S" + (seasonNum < 10 ? "0" : "") + seasonNum + "E" +
      (ep.episode_num < 10 ? "0" : "") + ep.episode_num + " · " + (ep.title || "Episode");
    PLAYER.open({
      src: API.buildStreamUrl("series", ep.id, ext),
      title: title,
      itemKey: "series_" + series.series_id + "_s" + seasonNum + "e" + ep.episode_num + "_" + ep.id,
      streamId: ep.id, section: "series",
      poster: series.cover || (tmdb && tmdb.poster),
      backdrop: (ep.info && ep.info.movie_image) || (tmdb && tmdb.backdrop),
      containerExtension: ext,
      tmdbId: (tmdb && tmdb.id) || (ep.info && ep.info.tmdb_id),
      tvdbId: tmdb && tmdb.tvdbId,
      seasonNum: seasonNum, episodeNum: ep.episode_num, seriesId: series.series_id
    });
  }

  /* ============================================================
     TMDB ENRICHMENT
     ============================================================ */
  function enrich(rawName, kind, existingTmdbId) {
    // returns Promise<{id, poster, backdrop, overview, credits, imdbId, tvdbId, genres}>
    var lang = CFG.language || "en-US";
    if (!API.tmdbEnabled()) return Promise.resolve(null);

    function details(id) {
      return API.tmdbDetails(kind, id, undefined, lang).then(function (d) {
        if (!d) return null;
        return {
          id: d.id, poster: API.tmdbImage(d.poster_path, "w500"),
          backdrop: API.tmdbImage(d.backdrop_path, "original"),
          overview: d.overview, credits: d.credits,
          imdbId: d.imdb_id || (d.external_ids && d.external_ids.imdb_id),
          tvdbId: d.external_ids && d.external_ids.tvdb_id,
          genres: (d.genres || []).map(function (g) { return g.name; }),
          releaseDate: d.release_date || d.first_air_date,
          rating: d.vote_average
        };
      });
    }

    if (existingTmdbId) return details(existingTmdbId);

    var variants = API.generateArabicSearchVariants(rawName);
    var year = API.cleanTitle(rawName).year;

    function tryVariant(i) {
      if (i >= variants.length) return Promise.resolve(null);
      return API.tmdbSearch(kind, variants[i], year, lang).then(function (res) {
        var results = (res && res.results) || [];
        if (results.length) {
          var match = API.findBestMatch(results, variants[i], year, kind);
          if (match && match.id) return details(match.id);
        }
        return tryVariant(i + 1);
      });
    }
    return tryVariant(0);
  }

  /* ============================================================
     MOVIE MODAL
     ============================================================ */
  function openMovieModal(item) {
    var id = item.stream_id || item.id;
    var rawTitle = item.name || item.title || "Unknown";
    var tmdb = null;

    function render(data) {
      tmdb = data || {};
      var backdrop = tmdb.backdrop || item.poster || item.stream_icon || "";
      var poster = tmdb.poster || item.stream_icon || item.cover || item.poster || "";
      var plot = (data && data.overview) || item.plot || (item.raw && item.raw.plot) || "";
      var rating = (data && data.rating) ? Number(data.rating).toFixed(1) : (item.rating || (item.raw && item.raw.rating) || "");
      var genre = (data && data.genres && data.genres.length ? data.genres.join(", ") : item.genre) || "";
      var releaseDate = (data && data.releaseDate) || (item.raw && (item.raw.releaseDate || item.raw.release_date)) || "";
      var isFav = STORE.isFavorite("movies", id);

      var credits = (data && data.credits) || null;
      var castHtml = "";
      if (credits && credits.cast && credits.cast.length) {
        castHtml = '<div class="section-title">Cast &amp; Crew</div><div class="cast-row">' +
          credits.cast.slice(0, 14).map(function (c) {
            return '<div class="cast"><div class="av">' +
              (c.profile_path ? '<img src="' + API.tmdbImage(c.profile_path, "w185") + '" alt="">' : "") +
              "</div><p>" + esc(c.name) + "</p><span>" + esc(c.character || "") + "</span></div>";
          }).join("") + "</div>";
      } else if (item.raw && item.raw.cast) {
        castHtml = '<div class="section-title">Cast</div><p class="muted">' + esc(item.raw.cast) + "</p>";
      }

      var links = "";
      if (data && data.id) links += '<a class="meta-link tmdb" href="https://www.themoviedb.org/movie/' + data.id + '" target="_blank" rel="noopener">TMDB</a>';
      if (data && data.imdbId) links += '<a class="meta-link imdb" href="https://www.imdb.com/title/' + data.imdbId + '" target="_blank" rel="noopener">IMDb</a>';

      var el = byId("movie-modal");
      el.innerHTML =
        '<div class="hero">' + (backdrop ? '<img class="bg" src="' + esc(backdrop) + '" alt="">' : "") +
          '<div class="grad"></div><div class="grad-r"></div>' +
          '<div class="hero-top">' +
            '<button class="round-btn fav' + (isFav ? " on" : "") + '" id="mv-fav">' + ICON.svg("heart") + "</button>" +
            '<button class="round-btn" id="mv-close">' + ICON.svg("x") + "</button>" +
          "</div>" +
          '<div class="hero-info">' +
            (poster ? '<img class="poster" src="' + esc(poster) + '" alt="">' : "") +
            '<div class="hi-body"><h2>' + esc(rawTitle) + "</h2>" +
              '<div class="meta-row">' +
                (rating ? '<span class="meta-chip rating">★ ' + esc(rating) + "</span>" : "") +
                (genre ? '<span class="meta-chip">' + esc(genre) + "</span>" : "") +
                (releaseDate ? "<span>" + esc(releaseDate) + "</span>" : "") +
                links +
              "</div>" +
              (plot ? '<p class="hero-plot">' + esc(plot) + "</p>" : "") +
              '<div class="hero-actions"><button class="big-play" id="mv-play"><span class="ico">' + ICON.svg("play") + "</span>Play Movie</button></div>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="modal-body">' + castHtml + "</div>";

      el.hidden = false;
      byId("mv-close").onclick = function () { el.hidden = true; el.innerHTML = ""; S.modalMovieTmdb = null; };
      byId("mv-play").onclick = function () { playMovie(item, tmdb); };
      byId("mv-fav").onclick = function () {
        var on = STORE.toggleFavorite(item);
        this.classList.toggle("on", on);
        updateCounts();
      };
    }

    // show immediately with available data, enrich when ready
    render(null);
    enrich(rawTitle, "movie", item.tmdb_id || (item.raw && item.raw.tmdb_id)).then(function (data) {
      if (data) { S.modalMovieTmdb = data; if (!byId("movie-modal").hidden) render(data); }
    });
  }

  /* ============================================================
     SERIES MODAL
     ============================================================ */
  function openSeriesModal(item) {
    var series = item.raw || item;
    var seriesId = series.series_id || item.series_id || item.id;
    var selectedSeason = 1;
    var tmdb = null;
    var seriesInfo = null;
    var tmdbEpisodes = {};          // seasonNum -> [ TMDB episode objects ]
    var themeAudio = null;
    var themePlaying = false;
    var themeBlocked = false;

    var el = byId("series-modal");
    el.hidden = false;
    el.innerHTML = '<div class="modal-body" style="padding-top:80px;text-align:center"><div class="spinner" style="margin:0 auto"></div><p class="muted">Loading series…</p></div>';

    /* ---------------- Plex theme song ---------------- */
    function stopTheme() {
      if (themeAudio) { try { themeAudio.pause(); } catch (e) {} }
      themePlaying = false;
    }

    function updateThemeBtn() {
      var btn = byId("sr-theme");
      if (!btn) return;
      btn.classList.toggle("on", themePlaying);
      btn.classList.toggle("blocked", themeBlocked && !themePlaying);
      btn.title = themePlaying ? "Mute theme song"
        : themeBlocked ? "Play theme song (autoplay was blocked)"
        : "Play theme song";
      btn.innerHTML = ICON.svg(themePlaying ? "volume" : "mute");
    }

    function themeUrl() {
      return API.themeSongUrl((tmdb && tmdb.tvdbId) || series.tvdb_id || (series.info && series.info.tvdb_id));
    }

    function startTheme() {
      var url = themeUrl();
      if (!url) return;
      if (!themeAudio) themeAudio = new Audio();
      themeAudio.src = url;
      themeAudio.volume = 0.3;
      themeAudio.play().then(function () {
        themePlaying = true; themeBlocked = false; updateThemeBtn();
      }).catch(function () {          // autoplay blocked → wait for a click
        themePlaying = false; themeBlocked = true; updateThemeBtn();
      });
    }

    function toggleTheme() {
      if (!themeAudio) { startTheme(); return; }
      if (themePlaying) { stopTheme(); themeBlocked = false; updateThemeBtn(); return; }
      themeAudio.play().then(function () {
        themePlaying = true; themeBlocked = false; updateThemeBtn();
      }).catch(function () {
        themePlaying = false; themeBlocked = true; updateThemeBtn();
      });
    }

    /* ------------- TMDB episode metadata -------------
       Fills in episode stills, titles and plot summaries that the Xtream
       portal doesn't provide (mirrors the original app's episode merge). */
    function fetchSeason(n) {
      if (!tmdb || !tmdb.id || tmdbEpisodes[n]) return Promise.resolve();
      return API.tmdbDetails("tv", tmdb.id, n, CFG.language || "en-US").then(function (d) {
        if (d && d.episodes) tmdbEpisodes[n] = d.episodes;
      }).catch(function () {});
    }

    function mergeEpisodes(rawEps, seasonNum) {
      var list = tmdbEpisodes[seasonNum] || [];
      if (!list.length) return rawEps;
      return rawEps.map(function (ep, idx) {
        var t = list.filter(function (x) { return Number(x.episode_number) === Number(ep.episode_num); })[0] || list[idx];
        if (!t) return ep;
        var still = t.still_path ? API.tmdbImage(t.still_path, "w300") : null;
        var name = t.name && t.name.trim() ? t.name : null;
        var overview = t.overview && t.overview.trim() ? t.overview : null;
        return Object.assign({}, ep, {
          title: name ? (ep.episode_num + ". " + name) : ep.title,
          info: Object.assign({}, ep.info, {
            plot: overview || (ep.info && ep.info.plot) || "",
            movie_image: still || (ep.info && ep.info.movie_image) || ep.cover_big || series.cover,
            cover_big: still || ep.cover_big || (ep.info && ep.info.movie_image) || series.cover
          })
        });
      });
    }

    API.fetchSeriesInfo(seriesId).then(function (info) {
      seriesInfo = info || {};
      var seasons = computeSeasons(seriesInfo);
      selectedSeason = seasons.indexOf(1) !== -1 ? 1 : seasons[0];

      function paint() {
        var backdrop = (tmdb && tmdb.backdrop) || (series.backdrop_path && series.backdrop_path[0]) || series.cover || item.poster || "";
        var poster = (tmdb && tmdb.poster) || series.cover || item.poster || "";
        var plot = (tmdb && tmdb.overview) || series.plot || (seriesInfo.info && seriesInfo.info.plot) || "";
        var isFav = STORE.isFavorite("series", seriesId);
        var rawEps = (seriesInfo.episodes && (seriesInfo.episodes[String(selectedSeason)] || seriesInfo.episodes[selectedSeason])) || [];
        var eps = mergeEpisodes(rawEps, selectedSeason);
        var hasTheme = !!themeUrl();

        var seasonSel = seasons.length > 1
          ? '<select class="select sm" id="sr-season">' + seasons.map(function (s) {
              return '<option value="' + s + '"' + (s === selectedSeason ? " selected" : "") + ">" +
                (s === 0 ? "Specials" : "Season " + s) + "</option>";
            }).join("") + "</select>"
          : '<span class="meta-chip">' + (selectedSeason === 0 ? "Specials" : "Season " + selectedSeason) + "</span>";

        var epsHtml = !eps.length
          ? '<div class="empty"><p class="empty-title">No episodes found</p></div>'
          : '<div class="ep-grid">' + eps.map(function (ep) {
              var key = "series_" + seriesId + "_s" + selectedSeason + "e" + ep.episode_num + "_" + ep.id;
              var h = STORE.getProgress(key);
              var pct = h && h.duration > 0 ? Math.min(100, Math.floor((h.lastPosition / h.duration) * 100)) : 0;
              var img = (ep.info && (ep.info.movie_image || ep.info.cover_big)) || ep.cover_big || poster;
              var dispTitle = ep.title ? (/^(\d+\.|E\d+)/i.test(ep.title) ? ep.title : ep.episode_num + ". " + ep.title) : "Episode " + ep.episode_num;
              var meta = [];
              if (ep.info && ep.info.duration) meta.push(esc(ep.info.duration));
              if (ep.info && ep.info.release_date) meta.push(esc(ep.info.release_date));
              else if (ep.added) meta.push(esc(String(ep.added).slice(0, 10)));
              return '<div class="ep-card" data-ep="' + esc(ep.episode_num) + '">' +
                '<div class="ep-thumb">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : "E" + ep.episode_num) +
                  (pct >= 90 ? '<span class="ep-badge">' + ICON.svg("check") + "</span>" : "") + "</div>" +
                '<div class="ep-body"><div><h4>' + esc(dispTitle) + "</h4>" +
                  (ep.info && ep.info.plot ? '<p class="plot">' + esc(ep.info.plot) + "</p>" : "") + "</div>" +
                  '<div class="ep-foot"><button class="ep-play" data-play="1">' + ICON.svg("play") +
                    (pct > 0 ? "Resume (" + pct + "%)" : "Play") + "</button>" +
                    '<span class="ep-dur">' + meta.join(" · ") + "</span></div></div></div>";
            }).join("") + "</div>";

        el.innerHTML =
          '<div class="hero">' + (backdrop ? '<img class="bg" src="' + esc(backdrop) + '" alt="">' : "") +
            '<div class="grad"></div><div class="grad-r"></div>' +
            '<div class="hero-top">' +
              (hasTheme ? '<button class="round-btn theme" id="sr-theme"></button>' : "") +
              '<button class="round-btn fav' + (isFav ? " on" : "") + '" id="sr-fav">' + ICON.svg("heart") + "</button>" +
              '<button class="round-btn" id="sr-close">' + ICON.svg("x") + "</button>" +
            "</div>" +
            '<div class="hero-info">' +
              (poster ? '<img class="poster" src="' + esc(poster) + '" alt="">' : "") +
              '<div class="hi-body"><h2>' + esc(series.name) + "</h2>" +
                '<div class="meta-row">' +
                  (series.rating ? '<span class="meta-chip rating">★ ' + esc(series.rating) + "</span>" : "") +
                  (series.genre ? '<span class="meta-chip">' + esc(series.genre) + "</span>" : "") +
                  (series.releaseDate ? "<span>" + esc(series.releaseDate) + "</span>" : "") +
                  (tmdb && tmdb.id ? '<a class="meta-link tmdb" href="https://www.themoviedb.org/tv/' + tmdb.id + '" target="_blank" rel="noopener">TMDB</a>' : "") +
                "</div>" +
                (plot ? '<p class="hero-plot">' + esc(plot) + "</p>" : "") +
              "</div></div></div>" +
          '<div class="modal-body">' +
            (tmdb && tmdb.credits && tmdb.credits.cast && tmdb.credits.cast.length
              ? '<div class="section-title">Cast &amp; Crew</div><div class="cast-row">' +
                tmdb.credits.cast.slice(0, 14).map(function (c) {
                  return '<div class="cast"><div class="av">' + (c.profile_path ? '<img src="' + API.tmdbImage(c.profile_path, "w185") + '" alt="">' : "") +
                    "</div><p>" + esc(c.name) + "</p><span>" + esc(c.character || "") + "</span></div>";
                }).join("") + "</div>" : "") +
            '<div class="season-bar"><h3 class="section-title" style="margin:0">Episodes</h3>' + seasonSel + "</div>" + epsHtml +
          "</div>";

        // graceful fallback for episode thumbnails
        el.querySelectorAll(".ep-thumb img").forEach(function (img) {
          img.addEventListener("error", function () {
            var card = img.closest(".ep-card");
            img.replaceWith(document.createTextNode("E" + (card ? card.getAttribute("data-ep") : "")));
          });
        });

        byId("sr-close").onclick = function () { stopTheme(); el.hidden = true; el.innerHTML = ""; };
        var themeBtn = byId("sr-theme");
        if (themeBtn) { themeBtn.onclick = toggleTheme; updateThemeBtn(); }
        byId("sr-fav").onclick = function () {
          var on = STORE.toggleFavorite(item);
          this.classList.toggle("on", on);
          updateCounts();
        };
        var sel = byId("sr-season");
        if (sel) sel.onchange = function () {
          selectedSeason = Number(this.value);
          fetchSeason(selectedSeason).then(function () { if (!el.hidden) paint(); });
          paint();
        };
        el.querySelectorAll(".ep-card").forEach(function (card) {
          var epNum = Number(card.getAttribute("data-ep"));
          var ep = eps.filter(function (e) { return Number(e.episode_num) === epNum; })[0];
          card.querySelector("[data-play]").onclick = function (e) {
            e.stopPropagation();
            stopTheme();
            playEpisode(series, selectedSeason, ep, tmdb);
          };
        });
      }

      paint();

      // Enrich with TMDB: backdrop / cast / plot, theme song, then episode metadata
      enrich(series.name, "tv", series.tmdb_id || (series.info && series.info.tmdb_id)).then(function (d) {
        if (!d || el.hidden) return;
        tmdb = d;
        paint();
        startTheme();
        Promise.all(seasons.map(fetchSeason)).then(function () {
          if (!el.hidden) paint();
        });
      });
    }).catch(function (err) {
      el.innerHTML = '<div class="modal-body" style="padding-top:80px;text-align:center">' +
        '<p class="empty-title">Failed to load series</p><p class="muted">' + esc(err.message || err) + "</p>" +
        '<button class="btn-primary" onclick="document.getElementById(\'series-modal\').hidden=true">Close</button></div>';
    });
  }

  function computeSeasons(info) {
    var nums = [];
    if (info.seasons) info.seasons.forEach(function (s) { if (typeof s.season_number === "number") nums.push(s.season_number); });
    if (info.episodes) Object.keys(info.episodes).forEach(function (k) { var n = Number(k); if (!isNaN(n)) nums.push(n); });
    nums = nums.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    if (!nums.length) nums.push(1);
    return nums;
  }

  /* ============================================================
     CONNECTION / SETUP
     ============================================================ */
  function setCfgStatus(msg, cls) {
    var el = byId("cfg-status");
    el.textContent = msg;
    el.className = "cfg-status" + (cls ? " " + cls : "");
  }

  function openConfig(firstRun) {
    var c = STORE.getConfig();
    byId("cfg-host").value = c.host || "";
    byId("cfg-user").value = c.username || "";
    byId("cfg-pass").value = c.password || "";
    byId("cfg-tmdb").value = c.tmdbApiKey || "";
    byId("cfg-waf").checked = c.vodWafBypass !== false;
    byId("cfg-theme").checked = c.themeSongs !== false;

    byId("cfg-title").textContent = firstRun ? "Connect to your IPTV portal" : "Connection settings";
    byId("cfg-sub").textContent = firstRun
      ? "Welcome! Enter your Xtream Codes portal details. They are stored only in this browser."
      : "Update the Xtream Codes portal details used by this app.";
    byId("cfg-cancel").hidden = !!firstRun;
    setCfgStatus("", "");
    byId("config-modal").hidden = false;
    setTimeout(function () { byId("cfg-host").focus(); }, 60);
  }

  function closeConfig() { byId("config-modal").hidden = true; }

  function formConfig() {
    return {
      host: byId("cfg-host").value.trim(),
      username: byId("cfg-user").value.trim(),
      password: byId("cfg-pass").value,
      tmdbApiKey: byId("cfg-tmdb").value.trim(),
      vodWafBypass: !!byId("cfg-waf").checked,
      themeSongs: !!byId("cfg-theme").checked
    };
  }

  /* Wipe cached catalogs (cache keys don't include the host) and re-fetch. */
  function reloadAfterConfigChange() {
    API.cacheClear();
    S.loaded = { live: false, movies: false, series: false };
    S.data = { live: { cats: [], items: [] }, movies: { cats: [], items: [] }, series: { cats: [], items: [] } };
    S.category = "ALL";
    S.search = "";
    byId("catalog-search").value = "";
    updateCounts();
    buildCategoryList();
    if (S.section === "favorites" || S.section === "history") { renderContent(); }
    else { loadSection(S.section, true); }
    setTimeout(function () {
      ["live", "movies", "series"].forEach(function (sec) {
        if (sec !== S.section) loadSection(sec, true);
      });
    }, 600);
  }

  function wireConfig() {
    byId("btn-config").onclick = function () { openConfig(false); };
    byId("cfg-cancel").onclick = closeConfig;

    byId("cfg-test").onclick = function () {
      var f = formConfig();
      if (!f.host || !f.username) { setCfgStatus("Portal URL and username are required.", "err"); return; }
      setCfgStatus("Testing connection…", "busy");
      API.testConnection(f).then(function (res) { setCfgStatus(res.message, res.ok ? "ok" : "err"); });
    };

    byId("cfg-save").onclick = function () {
      var f = formConfig();
      if (!f.host || !f.username) { setCfgStatus("Portal URL and username are required.", "err"); return; }
      STORE.saveConfig(f);
      closeConfig();
      toast("Connection saved");
      reloadAfterConfigChange();
    };

    byId("cfg-host").addEventListener("keydown", function (e) { if (e.key === "Enter") byId("cfg-save").click(); });
  }

  /* ============================================================
     UI BINDINGS
     ============================================================ */
  function setSection(section) {
    S.section = section;
    S.category = "ALL";
    S.search = "";
    byId("catalog-search").value = "";
    $("#section-nav .nav-item").removeClass("active").filter('[data-section="' + section + '"]').addClass("active");
    if (section === "history") {
      byId("current-category").textContent = "Watch History";
      byId("item-count").textContent = STORE.getHistory().length + " items";
      buildCategoryList();
      renderContent();
      return;
    }
    if (section === "favorites") {
      buildCategoryList();
      renderContent();
      return;
    }
    if (section === "live" || section === "movies" || section === "series") {
      buildCategoryList();
      if (S.loaded[section]) renderContent();
      else loadSection(section);
    }
  }

  function bindUI() {
    wireConfig();
    // nav
    $("#section-nav .nav-item").on("click", function () { setSection($(this).data("section")); });

    // catalog search
    byId("catalog-search").addEventListener("input", function () { S.search = this.value; renderContent(); });

    // category search + list
    byId("category-search").addEventListener("input", function () { S.catSearch = this.value; buildCategoryList(); });
    byId("category-list").addEventListener("click", function (e) {
      var btn = e.target.closest(".cat-item");
      if (!btn) return;
      S.category = btn.getAttribute("data-cat");
      buildCategoryList();
      renderContent();
      byId("content").scrollTop = 0;
    });

    // card interactions (delegated)
    byId("content").addEventListener("click", function (e) {
      var fav = e.target.closest(".fav-btn");
      if (fav) {
        e.stopPropagation();
        var card = fav.closest(".card");
        var item = findItem(card.getAttribute("data-type"), card.getAttribute("data-id"));
        if (item) { var on = STORE.toggleFavorite(item); fav.classList.toggle("on", on); updateCounts(); }
        return;
      }
      var card2 = e.target.closest(".card");
      if (card2) { selectItem(findItem(card2.getAttribute("data-type"), card2.getAttribute("data-id"))); return; }
    });

    // history view interactions
    byId("history-view").addEventListener("click", function (e) {
      if (e.target.closest("#clear-history")) { STORE.clearHistory(); updateCounts(); renderHistory(); byId("item-count").textContent = "0 items"; return; }
      var card = e.target.closest(".hist-card");
      if (!card) return;
      var key = card.getAttribute("data-hist");
      var h = STORE.getHistory().filter(function (x) { return x.key === key; })[0];
      if (!h) return;
      if (e.target.closest("[data-remove]")) { STORE.removeFromHistory(key); updateCounts(); renderHistory(); return; }
      if (e.target.closest("[data-resume]") || e.target.closest(".hist-body")) {
        reopenHistory(h);
      }
    });

    // filters drawer
    byId("btn-filter").onclick = function () { var d = byId("filter-drawer"); d.hidden = !d.hidden; this.classList.toggle("on", !d.hidden); };
    byId("btn-close-filter").onclick = function () { byId("filter-drawer").hidden = true; byId("btn-filter").classList.remove("on"); };
    byId("btn-reset-filters").onclick = function () { resetFilters(); refreshFilterUI(); renderContent(); };

    bindSeg("seg-stream-type", function (v) { S.filters.streamType = v; renderContent(); });
    bindSeg("seg-resolution", function (v) { S.filters.resolution = v; renderContent(); });
    bindSeg("seg-rating", function (v) { S.filters.minRating = Number(v); renderContent(); });
    bindSeg("seg-watched", function (v) { S.filters.watched = v; renderContent(); });
    bindSeg("seg-audio", function (v) { S.filters.audio = v; renderContent(); });

    byId("year-min").addEventListener("change", function () { S.filters.yearMin = parseInt(this.value, 10) || 1980; renderContent(); });
    byId("year-max").addEventListener("change", function () { S.filters.yearMax = parseInt(this.value, 10) || 2030; renderContent(); });
    byId("sort-by").addEventListener("change", function () { S.filters.sort = this.value; renderContent(); });

    byId("genre-tags").innerHTML = GENRES.map(function (g) {
      return '<button class="tag" data-genre="' + g + '">' + g + "</button>";
    }).join("");
    byId("genre-tags").addEventListener("click", function (e) {
      var t = e.target.closest(".tag");
      if (!t) return;
      var g = t.getAttribute("data-genre");
      var i = S.filters.genres.indexOf(g);
      if (i >= 0) S.filters.genres.splice(i, 1); else S.filters.genres.push(g);
      t.classList.toggle("on", i < 0);
      renderContent();
    });

    // quick pills
    renderPills();
    byId("quick-pills").addEventListener("click", function (e) {
      var p = e.target.closest(".pill");
      if (!p) return;
      var act = p.getAttribute("data-act");
      if (act === "all") resetFilters();
      if (act === "unwatched") S.filters.watched = S.filters.watched === "unwatched" ? "all" : "unwatched";
      if (act === "progress") S.filters.watched = S.filters.watched === "in-progress" ? "all" : "in-progress";
      if (act === "top") S.filters.minRating = S.filters.minRating === 8 ? 0 : 8;
      if (act === "new") S.filters.yearMin = S.filters.yearMin === 2024 ? 1980 : 2024;
      if (act === "genre") {
        var g = p.getAttribute("data-genre");
        var i = S.filters.genres.indexOf(g);
        if (i >= 0) S.filters.genres.splice(i, 1); else S.filters.genres.push(g);
      }
      refreshFilterUI();
      renderContent();
    });

    // sync
    byId("btn-sync").onclick = function () {
      API.cacheClear();
      S.loaded = { live: false, movies: false, series: false };
      byId("sync-ico").classList.add("spin");
      var done = function () { byId("sync-ico").classList.remove("spin"); };
      if (S.section === "favorites" || S.section === "history") { done(); return; }
      loadSection(S.section, true).then(done, done);
    };

    // theme popover
    byId("btn-theme").onclick = function (e) {
      e.stopPropagation();
      var p = byId("theme-popover");
      p.hidden = !p.hidden;
      if (!p.hidden) buildThemePopover();
    };
    byId("theme-popover").addEventListener("click", function (e) {
      e.stopPropagation();
      var t = e.target.closest(".theme-opt");
      var a = e.target.closest(".swatch");
      if (t) { STORE.saveSettings({ theme: t.getAttribute("data-theme") }); applyTheme(); buildThemePopover(); }
      if (a) { STORE.saveSettings({ accent: a.getAttribute("data-accent") }); applyTheme(); buildThemePopover(); }
      if (e.target.closest("#btn-reset-data")) {
        if (confirm("Clear favorites, history and settings?")) {
          STORE.resetAllData(); updateCounts(); setSection("live");
        }
      }
    });
    document.addEventListener("click", function () { byId("theme-popover").hidden = true; });

    // modal backdrop close (esc handled in player)
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      ["movie-modal", "series-modal"].forEach(function (id) {
        var m = byId(id); if (m && !m.hidden) { m.hidden = true; m.innerHTML = ""; }
      });
    });
  }

  function bindSeg(id, cb) {
    byId(id).addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      b.parentNode.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      cb(b.getAttribute("data-v"));
    });
  }

  function resetFilters() { S.filters = defaultFilters(); }

  function refreshFilterUI() {
    setSeg("seg-stream-type", S.filters.streamType);
    setSeg("seg-resolution", S.filters.resolution);
    setSeg("seg-rating", String(S.filters.minRating));
    setSeg("seg-watched", S.filters.watched);
    setSeg("seg-audio", S.filters.audio);
    byId("year-min").value = S.filters.yearMin;
    byId("year-max").value = S.filters.yearMax;
    byId("sort-by").value = S.filters.sort;
    byId("genre-tags").querySelectorAll(".tag").forEach(function (t) {
      t.classList.toggle("on", S.filters.genres.indexOf(t.getAttribute("data-genre")) >= 0);
    });
    var n = activeFilterCount();
    byId("filter-badge").hidden = n === 0;
    byId("filter-badge").textContent = n;
    byId("filter-count-label").hidden = n === 0;
    byId("filter-count-label").textContent = n + " active";
    renderPills();
  }

  function setSeg(id, v) {
    byId(id).querySelectorAll("button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-v") === v);
    });
  }

  function renderPills() {
    var f = S.filters;
    var isDefault = f.genres.length === 0 && f.minRating === 0 && f.yearMin === 1980 && f.watched === "all";
    var html = "";
    html += pill("all", "All Content", isDefault, "");
    html += pill("unwatched", "Unwatched", f.watched === "unwatched", "");
    html += pill("progress", "In Progress", f.watched === "in-progress", "");
    html += pill("top", "Top Rated (8+)", f.minRating === 8, "amber");
    html += pill("new", "2024+ New", f.yearMin === 2024, "purple");
    ["Action", "Comedy", "Drama", "Sci-Fi", "Horror", "Animation"].forEach(function (g) {
      html += '<button class="pill' + (f.genres.indexOf(g) >= 0 ? " on" : "") + '" data-act="genre" data-genre="' + g + '">' + g + "</button>";
    });
    byId("quick-pills").innerHTML = html;
  }

  function pill(act, label, on, cls) {
    return '<button class="pill' + (on ? " on " + (cls || "") : "") + '" data-act="' + act + '">' + label + "</button>";
  }

  /* ============================================================
     HISTORY RESUME
     ============================================================ */
  function reopenHistory(h) {
    if (h.section === "series") {
      // go to series modal
      var item = findItem("series", h.seriesId || h.id);
      if (item) { openSeriesModal(item); return; }
    }
    PLAYER.open({
      src: h.streamUrl || API.buildStreamUrl(h.section === "live" ? "live" : "movie", h.streamId || h.id, h.containerExtension || "mp4"),
      title: h.title, itemKey: h.key, streamId: h.streamId || h.id, section: h.section,
      poster: h.poster, containerExtension: h.containerExtension || "mp4"
    });
  }

  /* ============================================================
     SCROLL (infinite batch)
     ============================================================ */
  function bindScroll() {
    byId("content").addEventListener("scroll", function () {
      if (byId("grid").hidden) return;
      var c = byId("content");
      if (c.scrollHeight - c.scrollTop - c.clientHeight < 700) {
        if (S.visible < currentList.length) { S.visible += (CFG.gridBatch || 120); paintBatch(); }
      }
    });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    applyTheme();
    bindUI();
    bindScroll();
    byId("content").scrollTop = 0;
    setSection(S.section);

    // First run: ask for the portal details before trying to load anything.
    if (!STORE.isConfigured()) { openConfig(true); return; }

    // lazy-load the other sections in the background so counts + switching are instant
    setTimeout(function () {
      ["live", "movies", "series"].forEach(function (sec) {
        if (sec !== S.section) loadSection(sec).then(function () { if (sec === S.section) renderContent(); });
      });
    }, 900);
  }

  $(boot);

  window.IPTV_APP = {
    toast: toast,
    onPlayerClosed: function () { updateCounts(); if (S.section === "history") renderHistory(); else renderContent(); },
    state: S,
    refresh: function () { updateCounts(); renderContent(); }
  };
})(window, jQuery);
