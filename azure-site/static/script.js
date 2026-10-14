(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var form = $("form"), urlInput = $("url"), goBtn = $("go"), statusEl = $("status"), clearBtn = $("clear");
  var chart = null, current = null, allComments = [], activeFilter = "ALL", query = "", loadTimer = null;

  var YT_RE = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;
  var LABELS = { POSITIVE: "Positive", NEGATIVE: "Negative", NEUTRAL: "Neutral", FAILED: "Failed" };
  var COLOR_VAR = { POSITIVE: "--pos", NEGATIVE: "--neg", NEUTRAL: "--neu", FAILED: "--fail" };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // ---------- Theme ----------
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  $("theme").addEventListener("click", function () {
    var next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("sp-theme", next); } catch (e) {}
    if (current) renderChart(current.summary);
  });
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onScheme = function () { if (current) renderChart(current.summary); };
    if (mq.addEventListener) mq.addEventListener("change", onScheme); else if (mq.addListener) mq.addListener(onScheme);
  }

  // ---------- Status + loading ----------
  function setStatus(kind, text) {
    statusEl.className = "status" + (kind ? " " + kind : "");
    statusEl.textContent = text;
    statusEl.hidden = false;
  }
  function hideStatus() { statusEl.hidden = true; }

  function startLoading() {
    var box = $("loading"), steps = box.querySelectorAll(".steps li"), bar = box.querySelector(".progress span");
    var t0 = Date.now();
    box.hidden = false;
    function tick() {
      var s = (Date.now() - t0) / 1000;
      $("elapsed").textContent = Math.floor(s);
      var stage = s < 2 ? 0 : s < 20 ? 1 : 2;
      for (var i = 0; i < steps.length; i++) steps[i].className = i < stage ? "done" : i === stage ? "active" : "";
      // Ease towards 92% — the real finish snaps it to 100%.
      bar.style.width = (92 * (1 - Math.exp(-s / 9))).toFixed(1) + "%";
    }
    tick();
    loadTimer = setInterval(tick, 250);
  }
  function stopLoading() {
    clearInterval(loadTimer);
    $("loading").hidden = true;
    $("loading").querySelector(".progress span").style.width = "0";
  }

  // ---------- Overview ----------
  function videoId(data) {
    var id = data.video && data.video.video_id;
    return typeof id === "string" && /^[\w-]{6,20}$/.test(id) ? id : null;
  }
  function safeUrl(u) { return typeof u === "string" && /^https:\/\//i.test(u) ? u : null; }

  function renderOverview(data) {
    var s = data.summary, id = videoId(data), url = safeUrl(data.video && data.video.url);
    var thumb = $("thumb"), img = $("thumb-img");
    if (id) {
      img.src = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
      img.alt = "Thumbnail for video " + id;
      thumb.href = url || "https://www.youtube.com/watch?v=" + id;
      thumb.hidden = false;
    } else thumb.hidden = true;

    var p = s.percentages, net = Math.round((p.positive - p.negative) * 10) / 10;
    var mood = $("mood-label").parentNode, label, cls, text;
    if (!s.analyzed) { label = "No data"; cls = "neu"; text = "No comments could be analyzed."; }
    else {
      if (net >= 20) { label = "Mostly positive"; cls = "pos"; }
      else if (net >= 5) { label = "Leaning positive"; cls = "pos"; }
      else if (net <= -20) { label = "Mostly negative"; cls = "neg"; }
      else if (net <= -5) { label = "Leaning negative"; cls = "neg"; }
      else { label = "Mixed"; cls = "neu"; }
      text = "Based on " + s.analyzed + " analyzed comment" + (s.analyzed === 1 ? "" : "s") +
        ". Net score = % positive − % negative.";
    }
    mood.className = "mood " + cls;
    $("mood-label").textContent = label;
    $("mood-score").textContent = s.analyzed ? "Net " + (net > 0 ? "+" : "") + net : "";
    $("mood-score").hidden = !s.analyzed;
    $("mood-text").textContent = text;

    var stack = $("stack"), legend = $("legend");
    stack.textContent = ""; legend.textContent = "";
    stack.setAttribute("aria-label", "Positive " + p.positive + "%, negative " + p.negative + "%, neutral " + p.neutral + "%");
    [["POSITIVE", p.positive], ["NEUTRAL", p.neutral], ["NEGATIVE", p.negative]].forEach(function (r) {
      var seg = el("span"); seg.style.background = "var(" + COLOR_VAR[r[0]] + ")"; seg.style.flex = r[1] + " 0 0";
      if (r[1]) stack.appendChild(seg);
      var li = el("li"), dot = el("i"); dot.style.background = "var(" + COLOR_VAR[r[0]] + ")";
      li.appendChild(dot); li.appendChild(document.createTextNode(LABELS[r[0]] + " "));
      li.appendChild(el("b", null, r[1] + "%"));
      legend.appendChild(li);
    });
  }

  // ---------- Cards ----------
  function card(cls, label, value, sub) {
    var d = el("div", "card " + cls);
    d.appendChild(el("div", "l", label));
    d.appendChild(el("div", "n", value));
    d.appendChild(el("div", "p", sub == null ? "" : sub));
    return d;
  }
  function renderCards(s) {
    var c = $("cards"); c.textContent = "";
    c.appendChild(card("total", "Retrieved", s.retrieved, "top-level comments"));
    c.appendChild(card("done", "Analyzed", s.analyzed, s.retrieved ? Math.round(100 * s.analyzed / s.retrieved) + "% success" : ""));
    c.appendChild(card("pos", "Positive", s.counts.positive, s.percentages.positive + "%"));
    c.appendChild(card("neg", "Negative", s.counts.negative, s.percentages.negative + "%"));
    c.appendChild(card("neu", "Neutral", s.counts.neutral, s.percentages.neutral + "%"));
    c.appendChild(card("fail", "Failed", s.failed, "excluded from %"));
  }

  // ---------- Chart ----------
  function renderChart(s) {
    if (chart) { chart.destroy(); chart = null; }
    var top = [["positive", "Positive"], ["negative", "Negative"], ["neutral", "Neutral"]]
      .sort(function (a, b) { return s.percentages[b[0]] - s.percentages[a[0]]; })[0];
    $("center-val").textContent = s.analyzed ? s.percentages[top[0]] + "%" : "—";
    $("center-lbl").textContent = s.analyzed ? top[1] : "no data";
    if (typeof Chart === "undefined") return;
    chart = new Chart($("chart"), {
      type: "doughnut",
      data: {
        labels: ["Positive", "Negative", "Neutral"],
        datasets: [{
          data: [s.counts.positive, s.counts.negative, s.counts.neutral],
          backgroundColor: [css("--pos"), css("--neg"), css("--neu")],
          borderColor: css("--panel"), borderWidth: 3, hoverOffset: 6, borderRadius: 4
        }]
      },
      options: {
        maintainAspectRatio: false, cutout: "68%",
        plugins: {
          legend: { position: "bottom", labels: { color: css("--text"), usePointStyle: true, pointStyle: "circle", padding: 16 } },
          tooltip: { callbacks: { label: function (ctx) {
            var pct = s.analyzed ? Math.round(1000 * ctx.raw / s.analyzed) / 10 : 0;
            return " " + ctx.label + ": " + ctx.raw + " (" + pct + "%)";
          } } }
        }
      }
    });
  }

  // ---------- Meta ----------
  function copyBtn(value) {
    var b = el("button", "copy", "Copy"); b.type = "button";
    b.addEventListener("click", function () {
      var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1400); };
      if (navigator.clipboard) navigator.clipboard.writeText(value).then(done, function () {});
    });
    return b;
  }
  function renderMeta(data) {
    var m = $("meta"); m.textContent = "";
    function row(label, node) {
      m.appendChild(el("dt", null, label));
      var dd = el("dd"); [].concat(node).forEach(function (n) { dd.appendChild(typeof n === "string" ? document.createTextNode(n) : n); });
      m.appendChild(dd);
    }
    var url = safeUrl(data.video.url), link;
    if (url) { link = el("a", null, url); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; }
    row("Video", link || String(data.video.url || "—"));
    row("Run ID", [el("span", "mono", data.run_id), copyBtn(data.run_id)]);
    if (data.created_at) {
      var d = new Date(data.created_at);
      row("Created", isNaN(d) ? String(data.created_at) : d.toLocaleString());
    }
    row("Provider", String(data.settings.provider));
    row("Model", el("span", "mono", data.settings.model));
    row("Comment limit", String(data.settings.max_comments));
    var saved = data.storage.saved;
    row("Stored", el("span", "pill " + (saved ? "ok" : "bad"), saved ? "Saved · " + data.storage.mode : "Saving failed"));
    if (saved && data.storage.location) row("Location", el("span", "mono", data.storage.location));
  }

  // ---------- Comments ----------
  function labelOf(c) { return c.status === "FAILED" ? "FAILED" : c.sentiment; }

  function renderFilters() {
    var box = $("filters"), counts = { ALL: allComments.length, POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, FAILED: 0 };
    allComments.forEach(function (c) { var l = labelOf(c); if (l in counts) counts[l]++; });
    box.textContent = "";
    ["ALL", "POSITIVE", "NEGATIVE", "NEUTRAL", "FAILED"].forEach(function (f) {
      if (f === "FAILED" && !counts.FAILED) return;
      var b = el("button"); b.type = "button";
      if (f !== "ALL") { var dot = el("i"); dot.style.background = "var(" + COLOR_VAR[f] + ")"; b.appendChild(dot); }
      b.appendChild(document.createTextNode(f === "ALL" ? "All" : LABELS[f]));
      b.appendChild(el("span", "k", counts[f]));
      b.setAttribute("aria-pressed", String(f === activeFilter));
      b.addEventListener("click", function () { activeFilter = f; renderFilters(); renderRows(); });
      box.appendChild(b);
    });
  }

  // Appends text to `parent`, wrapping case-insensitive matches of `q` in <mark>. Uses text nodes only (no HTML).
  function appendHighlighted(parent, text, q) {
    if (!q) { parent.textContent = text; return; }
    var lower = text.toLowerCase(), i = 0, j;
    while ((j = lower.indexOf(q, i)) !== -1) {
      if (j > i) parent.appendChild(document.createTextNode(text.slice(i, j)));
      parent.appendChild(el("mark", null, text.slice(j, j + q.length)));
      i = j + q.length;
    }
    if (i < text.length) parent.appendChild(document.createTextNode(text.slice(i)));
  }

  function renderRows() {
    var list = $("rows"); list.textContent = "";
    var frag = document.createDocumentFragment(), n = 0;
    allComments.forEach(function (c, i) {
      var lab = labelOf(c), text = String(c.text || "");
      if (activeFilter !== "ALL" && lab !== activeFilter) return;
      if (query && text.toLowerCase().indexOf(query) === -1) return;
      n++;
      var li = el("li", "comment " + lab);
      li.appendChild(el("span", "idx", "#" + (i + 1)));
      var body = el("div"), p = el("p", "c");
      appendHighlighted(p, text, query);
      body.appendChild(p);
      if (c.error) body.appendChild(el("span", "err", c.error));
      li.appendChild(body);
      li.appendChild(el("span", "badge " + lab, LABELS[lab] || lab));
      frag.appendChild(li);
    });
    if (!n) frag.appendChild(el("li", "empty", query ? "No comments match “" + query + "”." : "No comments in this category."));
    list.appendChild(frag);
    $("shown").textContent = n === allComments.length ? "(" + n + ")" : "(" + n + " of " + allComments.length + ")";
  }

  $("search").addEventListener("input", function () { query = this.value.trim().toLowerCase(); renderRows(); });

  // ---------- Export ----------
  function download(name, type, content) {
    var a = el("a"), blobUrl = URL.createObjectURL(new Blob([content], { type: type }));
    a.href = blobUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
  }
  function csvCell(v) {
    v = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; // neutralise spreadsheet formula injection
    return '"' + v.replace(/"/g, '""') + '"';
  }
  $("dl-json").addEventListener("click", function () {
    if (current) download("socialpulse-" + current.run_id + ".json", "application/json", JSON.stringify(current, null, 2));
  });
  $("dl-csv").addEventListener("click", function () {
    if (!current) return;
    var lines = [["index", "sentiment", "status", "error", "text"].join(",")];
    current.comments.forEach(function (c, i) {
      lines.push([i + 1, labelOf(c), c.status, c.error, c.text].map(csvCell).join(","));
    });
    download("socialpulse-" + current.run_id + ".csv", "text/csv;charset=utf-8", "﻿" + lines.join("\r\n"));
  });

  // ---------- Flow ----------
  function show(data) {
    current = data; allComments = data.comments || []; activeFilter = "ALL";
    query = ""; $("search").value = "";
    $("results").hidden = false;
    renderOverview(data); renderCards(data.summary); renderChart(data.summary); renderMeta(data);
    renderFilters(); renderRows();
    var warnings = [];
    if (data.summary.failed) warnings.push(data.summary.failed + " comment(s) could not be analyzed and are excluded from the percentages.");
    if (!data.storage.saved) warnings.push("Results could not be saved to storage.");
    if (warnings.length) setStatus("warn", warnings.join(" ")); else hideStatus();
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  urlInput.addEventListener("input", function () { clearBtn.hidden = !urlInput.value; });
  clearBtn.addEventListener("click", function () { urlInput.value = ""; clearBtn.hidden = true; urlInput.focus(); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return setStatus("error", "Please paste a YouTube video URL."); }
    if (!YT_RE.test(url)) return setStatus("error", "That doesn't look like a YouTube link.");

    goBtn.disabled = true; goBtn.querySelector(".go-label").textContent = "Analyzing…";
    $("results").hidden = true; hideStatus(); startLoading();

    fetch(window.SOCIALPULSE_API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, max_comments: 200 })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      stopLoading();
      if (!r.ok) setStatus("error", (r.data.error && r.data.error.message) || "Something went wrong. Please try again.");
      else show(r.data);
    }).catch(function () {
      stopLoading();
      setStatus("error", "Could not reach the server. Check your connection and try again.");
    }).then(function () {
      goBtn.disabled = false; goBtn.querySelector(".go-label").textContent = "Analyze";
    });
  });
})();
