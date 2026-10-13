(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var form = $("form"), urlInput = $("url"), goBtn = $("go"), statusEl = $("status");
  var chart = null, allComments = [], activeFilter = "ALL";

  var YT_RE = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;

  function setStatus(kind, text) {
    statusEl.className = "status" + (kind === "error" || kind === "warn" ? " " + kind : "");
    statusEl.textContent = "";
    if (kind === "loading") {
      var s = document.createElement("span"); s.className = "spinner"; statusEl.appendChild(s);
    }
    statusEl.appendChild(document.createTextNode(text));
    statusEl.hidden = false; statusEl.style.display = "";
  }

  function card(cls, label, value, pct) {
    var d = document.createElement("div"); d.className = "card " + cls;
    d.innerHTML = '<div class="n"></div><div class="l"></div><div class="p"></div>';
    d.children[0].textContent = value; d.children[1].textContent = label;
    d.children[2].textContent = pct == null ? " " : pct + "%";
    return d;
  }

  function renderCards(s) {
    var c = $("cards"); c.textContent = "";
    c.appendChild(card("", "Retrieved", s.retrieved));
    c.appendChild(card("", "Analyzed", s.analyzed));
    c.appendChild(card("fail", "Failed", s.failed));
    c.appendChild(card("pos", "Positive", s.counts.positive, s.percentages.positive));
    c.appendChild(card("neg", "Negative", s.counts.negative, s.percentages.negative));
    c.appendChild(card("neu", "Neutral", s.counts.neutral, s.percentages.neutral));
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function renderChart(s) {
    if (chart) chart.destroy();
    if (typeof Chart === "undefined") return;
    chart = new Chart($("chart"), {
      type: "doughnut",
      data: {
        labels: ["Positive", "Negative", "Neutral"],
        datasets: [{ data: [s.counts.positive, s.counts.negative, s.counts.neutral],
          backgroundColor: [css("--pos"), css("--neg"), css("--neu")], borderWidth: 0 }]
      },
      options: { plugins: { legend: { position: "bottom", labels: { color: css("--text") } } }, cutout: "60%" }
    });
  }

  function renderMeta(data) {
    var m = $("meta"); m.textContent = "";
    var rows = [
      ["Video", data.video.url], ["Run ID", data.run_id], ["Provider", data.settings.provider],
      ["Model", data.settings.model], ["Comment limit", data.settings.max_comments],
      ["Stored", data.storage.saved ? "Yes (" + data.storage.mode + ")" : "No – saving failed"]
    ];
    rows.forEach(function (r) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = r[0]; dd.textContent = r[1]; m.appendChild(dt); m.appendChild(dd);
    });
  }

  function renderFilters() {
    var box = $("filters"); box.textContent = "";
    ["ALL", "POSITIVE", "NEGATIVE", "NEUTRAL", "FAILED"].forEach(function (f) {
      var b = document.createElement("button"); b.type = "button";
      b.textContent = f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase();
      b.setAttribute("aria-pressed", String(f === activeFilter));
      b.addEventListener("click", function () { activeFilter = f; renderFilters(); renderRows(); });
      box.appendChild(b);
    });
  }

  function labelOf(c) { return c.status === "FAILED" ? "FAILED" : c.sentiment; }

  function renderRows() {
    var body = $("rows"); body.textContent = "";
    var frag = document.createDocumentFragment(), n = 0;
    allComments.forEach(function (c, i) {
      var lab = labelOf(c);
      if (activeFilter !== "ALL" && lab !== activeFilter) return;
      n++;
      var tr = document.createElement("tr");
      var a = document.createElement("td"); a.textContent = i + 1;
      var b = document.createElement("td"); b.className = "c"; b.textContent = c.text;
      var d = document.createElement("td"), badge = document.createElement("span");
      badge.className = "badge " + lab; badge.textContent = lab === "FAILED" ? "Failed" : lab.charAt(0) + lab.slice(1).toLowerCase();
      if (c.error) badge.title = c.error;
      d.appendChild(badge);
      tr.appendChild(a); tr.appendChild(b); tr.appendChild(d); frag.appendChild(tr);
    });
    if (!n) {
      var tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 3; td.textContent = "No comments match this filter."; tr.appendChild(td); frag.appendChild(tr);
    }
    body.appendChild(frag);
  }

  function show(data) {
    allComments = data.comments; activeFilter = "ALL";
    renderCards(data.summary); renderChart(data.summary); renderMeta(data);
    renderFilters(); renderRows(); $("results").hidden = false;
    var warnings = [];
    if (data.summary.failed) warnings.push(data.summary.failed + " comment(s) could not be analyzed and are excluded from the percentages.");
    if (!data.storage.saved) warnings.push("Results could not be saved to storage.");
    if (warnings.length) setStatus("warn", warnings.join(" ")); else { statusEl.hidden = true; statusEl.style.display = "none"; }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) return setStatus("error", "Please paste a YouTube video URL.");
    if (!YT_RE.test(url)) return setStatus("error", "That doesn't look like a YouTube link.");

    goBtn.disabled = true; $("results").hidden = true;
    setStatus("loading", "Fetching and analyzing comments… this can take up to half a minute.");

    fetch(window.SOCIALPULSE_API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, max_comments: 200 })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (!r.ok) setStatus("error", (r.data.error && r.data.error.message) || "Something went wrong. Please try again.");
      else show(r.data);
    }).catch(function () {
      setStatus("error", "Could not reach the server. Check your connection and try again.");
    }).then(function () { goBtn.disabled = false; });
  });
})();
