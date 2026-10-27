/* Wharton course planner — runs entirely in the browser; plans are saved in localStorage and never sent anywhere.
   Recommendations: per-answer weights learned from 100 AI-rated sample student profiles + a growth rule. No AI at run time. */
(function () {
  "use strict";
  var D = window.PLANNER_DATA;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fmt = function (x) { return (Math.round(x * 100) / 100).toString(); };

  // ---------- load ----------
  var A;
  try { A = JSON.parse(localStorage.getItem("wcp.answers") || "null"); } catch (e) { A = null; }
  if (!A) { location.href = "index.html"; return; }
  var S = load();
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem("wcp.state") || "null"); } catch (e) {}
    if (!s) s = { plan: {}, dec: {}, core: {}, changes: 0, recruiting: null, ownN: 0 };
    if (!s.recruiting) s.recruiting = /^Mature/.test(A.recruiting || "") ? "mature" : /^Enterprise/.test(A.recruiting || "") ? "enterprise" : "none";
    return s;
  }
  function save() { try { localStorage.setItem("wcp.state", JSON.stringify(S)); } catch (e) {} }
  var theme = localStorage.getItem("wcp.theme");
  if (theme) document.documentElement.dataset.theme = theme;

  // ---------- courses ----------
  var BY = {}, ALSO = {};
  D.courses.forEach(function (c) {
    if (!BY[c.canon]) BY[c.canon] = Object.assign({}, c, { code: c.canon });
    if (c.code !== c.canon) (ALSO[c.canon] = ALSO[c.canon] || []).push(c.code);
  });
  var codesOf = function (c) { return [c].concat(ALSO[c] || []); };
  var CORE_CODES = {};
  D.core.forEach(function (s) { s.areas.forEach(function (a) { a.options.forEach(function (o) { CORE_CODES[canon(o.code)] = true; }); }); });
  D.required.forEach(function (c) { CORE_CODES[c] = true; });
  function canon(c) { var x = D.courses.filter(function (k) { return k.code === c; })[0]; return x ? x.canon : c; }
  var FULLHALF = {}; D.fullHalf.forEach(function (c) { FULLHALF[c] = 1; });
  var DEPTH = { Skip: 0, Fluent: 1, Solid: 2, Deep: 3 }, KNOW = { None: 0, Some: 1, Working: 2, Expert: 3 };

  // ---------- majors ----------
  function inRule(code, rule) {
    return codesOf(code).some(function (c) { return rule === "FNCE7+" ? /^FNCE [78]\d{3}$/.test(c) : rule.indexOf(c) >= 0; });
  }
  var MAJ = D.majors;
  var MAJ_COLOR = { "Finance": "#2a78d6", "Entrepreneurship & Innovation": "#eb6834", "AI for Business": "#1baf7a" };
  var MAJ_SHORT = { "Finance": "Finance", "Entrepreneurship & Innovation": "E&I", "AI for Business": "AI" };
  var REQ_MAJ = {};
  MAJ.forEach(function (m) { m.required.forEach(function (r) { REQ_MAJ[r.code] = m.name; }); });
  function majorsFor(code) {
    var out = [];
    MAJ.forEach(function (m) {
      if (REQ_MAJ[code] === m.name || m.buckets.some(function (b) { return inRule(code, b.rule); })) out.push(m.name);
    });
    return out;
  }
  var explored = (A.majors || []).map(function (m) { return D.surveyMajor[m]; }).filter(Boolean);
  var exploredMissing = (A.majors || []).filter(function (m) { return !D.surveyMajor[m] && !/^(Not sure|Other)/.test(m); });

  // ---------- scoring (no AI) ----------
  var FEATURE_TEXT = { role: "your goal: %s", ind: "your interest in %s", topic: "a topic you want: %s",
    major: "counts toward %s, which you're exploring", bg: "builds on your %s background", skill: "uses your %s skills" };
  function features(s) {
    var f = {};
    [["roles", "role"], ["industries", "ind"], ["topics", "topic"], ["background", "bg"], ["skills", "skill"], ["majors", "major"]]
      .forEach(function (p) { (s[p[0]] || []).forEach(function (v) { if (String(v).indexOf("Other: ") !== 0) f[p[1] + ":" + v] = 1; }); });
    if (s.recruiting) f["rec:" + s.recruiting.split(" —")[0]] = 1;
    Object.keys(s.depth_want || {}).forEach(function (k) { f["want:" + k + "=" + s.depth_want[k]] = 1; });
    Object.keys(s.depth_know || {}).forEach(function (k) { f["know:" + k + "=" + s.depth_know[k]] = 1; });
    return f;
  }
  var F = features(A), FIDX = {};
  D.features.forEach(function (n, i) { if (F[n]) FIDX[i] = n; });
  var want = {}, know = {};
  Object.keys(A.depth_want || {}).forEach(function (k) { want[k] = DEPTH[A.depth_want[k]]; });
  Object.keys(A.depth_know || {}).forEach(function (k) { know[k] = KNOW[A.depth_know[k]] || 0; });
  var SCORE = {}, LABEL = {}, WHY = {};
  Object.keys(D.base).forEach(function (c) {
    if (CORE_CODES[c] || !BY[c]) return;
    var v = D.base[c], ws = [];
    (D.weights[c] || []).forEach(function (p) { if (FIDX[p[0]] !== undefined) { v += p[1]; ws.push([p[1], FIDX[p[0]]]); } });
    var t = BY[c], grew = null;
    if (t.level === "Intro" || t.level === "Fluent") t.areas.slice(0, 2).forEach(function (area, i) {
      if ((want[area] || 0) >= 1 && (want[area] || 0) > (know[area] || 0)) { v += D.growth * (i ? 0.5 : 1); grew = grew || area; }
    });
    SCORE[c] = v;
    LABEL[c] = v >= D.best ? "Best fit" : v >= D.good ? "Good fit" : "";
    ws.sort(function (a, b) { return b[0] - a[0]; });
    var why = [];
    ws.forEach(function (w) {
      var pre = w[1].split(":")[0], val = w[1].slice(pre.length + 1);
      if (w[0] > 0.2 && FEATURE_TEXT[pre] && why.length < 3) why.push(FEATURE_TEXT[pre].replace("%s", val));
    });
    if (grew && why.length < 3) why.push("a foundation in " + grew + ", which you want to grow");
    WHY[c] = why;
  });

  // ---------- terms + dates ----------
  var c27 = /2027$/.test(A["class"] || "");
  var TERMS = c27 ? ["Summer '25", "Fall '25", "Spring '26", "Fall '26", "Spring '27"] : ["Summer '26", "Fall '26", "Spring '27", "Fall '27", "Spring '28"];
  var FUTURE = c27 ? ["Spring '27"] : ["Spring '27", "Fall '27", "Spring '28"];
  var RECRUIT = c27 ? { mature: ["Fall '25"], enterprise: ["Spring '26", "Spring '27"], none: [] }
                    : { mature: ["Fall '26"], enterprise: ["Spring '27", "Spring '28"], none: [] };
  var STARTS = { "Summer '25": "2025-08-01", "Fall '25": "2025-08-25", "Spring '26": "2026-01-14", "Summer '26": "2026-08-01",
    "Fall '26": "2026-08-25", "Spring '27": "2027-01-14", "Fall '27": "2027-08-25", "Spring '28": "2028-01-14" };
  var TODAY = new Date().toISOString().slice(0, 10);
  function started(e) { return e.term && STARTS[e.term] && TODAY >= STARTS[e.term]; }
  var TARGET = 4.5, QCAP = 3, RQCAP = 2;
  var HEAVY = 5.5;   // warning only — no hard limit

  // ---------- plan ----------
  function entries() { return Object.keys(S.plan).map(function (k) { return Object.assign({ code: k }, S.plan[k]); }); }
  function cuOf(code) { var e = S.plan[code]; return e && e.own ? e.cu : (BY[code] ? BY[code].cu : (e ? e.cu : 0)); }
  function isQuant(code) { return !!(BY[code] && BY[code].quant); }
  function addToPlan(code, extra) {
    if (S.plan[code]) return;
    S.plan[code] = Object.assign({ term: null, slot: null, locked: false, why: null }, extra || {});
    delete S.dec[code];
    S.changes += 1;
    placeNew();
  }
  function removeFromPlan(code) { if (S.plan[code]) { delete S.plan[code]; S.changes += 1; } }

  function schedule(full) {
    var fixed = {}, todo = [];
    entries().forEach(function (e) {
      if ((e.term && started(e)) || e.locked || (!full && e.term)) fixed[e.code] = [e.term, e.slot || "Full"];
      else if (full || e.why !== "parked") todo.push(e);
    });
    var load = {};
    FUTURE.forEach(function (t) { load[t] = { cu: 0, q: 0, Q1: 0, Q2: 0 }; });
    function add(t, slot, cu, code) {
      var L = load[t]; if (!L) return;
      L.cu += cu; L.q += isQuant(code) ? 1 : 0;
      if (slot === "Q1" || slot === "Q2") L[slot] += cu; else { L.Q1 += cu / 2; L.Q2 += cu / 2; }
    }
    Object.keys(fixed).forEach(function (c) { add(fixed[c][0], fixed[c][1], cuOf(c), c); });
    var heavy = RECRUIT[S.recruiting] || [];
    var qcap = function (t) { return heavy.indexOf(t) >= 0 ? RQCAP : QCAP; };
    var early = {}; Object.keys(REQ_MAJ).forEach(function (c) { early[c] = 1; });
    Object.keys(D.prereqs).forEach(function (k) { D.prereqs[k].forEach(function (p) { early[p] = 1; }); });
    var tier = function (c) { return CORE_CODES[c] ? 0 : early[c] ? 1 : 2; };
    todo.sort(function (a, b) {
      return tier(a.code) - tier(b.code) || (isQuant(b.code) - isQuant(a.code)) || (cuOf(b.code) - cuOf(a.code)) || (a.code < b.code ? -1 : 1);
    });
    var termOf = {}; Object.keys(fixed).forEach(function (c) { termOf[c] = fixed[c][0]; });
    var placed = {};
    todo.forEach(function (e) {
      var c = e.code, cu = cuOf(c);
      var after = (D.prereqs[c] || []).map(function (p) { return FUTURE.indexOf(termOf[p]); }).filter(function (i) { return i >= 0; });
      var start = after.length ? Math.max.apply(null, after) + 1 : 0;
      var opts = FUTURE.slice(start); if (!opts.length) opts = FUTURE.slice(-1);
      var core = tier(c) === 0;
      var spreadCore = /^No — spread/.test(A.frontload || "");
      var why = core ? (spreadCore ? "core requirement — spread across your semesters, as you asked" : "core requirement — scheduled as early as possible") : early[c] ? "needed early for your major" : "elective — placed to balance credits";
      var fits = function (t) { return !isQuant(c) || load[t].q < qcap(t); };
      var order = (core && !spreadCore) ? opts.slice() : opts.slice().sort(function (x, y) {
        return ((heavy.indexOf(x) >= 0) - (heavy.indexOf(y) >= 0)) || (load[x].cu - load[y].cu) || (opts.indexOf(x) - opts.indexOf(y));
      });
      var pick = order.filter(function (t) { return load[t].cu + cu <= TARGET && fits(t); })[0];
      if (!pick) {
        var c2 = opts.filter(fits);
        pick = (c2.length ? c2 : opts).slice().sort(function (x, y) {
          return ((heavy.indexOf(x) >= 0) - (heavy.indexOf(y) >= 0)) || (load[x].cu - load[y].cu);
        })[0];
        why += c2.length ? "; above 4.5 CU — extra placed in the lightest term" : "; this term ends up quant-heavy";
      }
      if (heavy.indexOf(pick) >= 0) why += " · recruiting term (kept lighter)";
      var slot = (cu >= 1 || FULLHALF[c]) ? "Full" : (load[pick].Q1 <= load[pick].Q2 ? "Q1" : "Q2");
      add(pick, slot, cu, c);
      placed[c] = [pick, slot, why]; termOf[c] = pick;
    });
    return placed;
  }
  function savePlaced(p) { Object.keys(p).forEach(function (c) { var e = S.plan[c]; e.term = p[c][0]; e.slot = p[c][1]; e.why = p[c][2]; }); }
  function placeNew() { savePlaced(schedule(false)); }
  function resuggest() { savePlaced(schedule(true)); S.changes = 0; }
  function slotOk(code, slot) {
    var cu = cuOf(code);
    if (!slot) return true;
    if (slot === "Full") return cu >= 1 || !!FULLHALF[code];
    return cu < 1 && !FULLHALF[code];
  }

  // ---------- core ----------
  function subOptions(area) {
    var r = D.groupRules[area.name] || {}, s = r.subs;
    if (!s) return [];
    if (Array.isArray(s)) return s.map(function (c) { return BY[canon(c)]; }).filter(Boolean);
    return Object.keys(BY).map(function (c) { return BY[c]; }).filter(function (c) {
      return c.code.indexOf(s.dept + " ") === 0 && +c.code.slice(-4) >= 7000 && c.cu >= s.min_cu;
    });
  }
  function coreState() {
    var out = [];
    D.core.forEach(function (sec) {
      var t = 0, p = 0, need = 0, waived = 0, open = [];
      sec.areas.forEach(function (a) {
        if (!a.need) return;
        var st = S.core[a.name];
        if (st === "waived") { waived += a.need; return; }
        need += a.need;
        var opts = st === "substituted" ? subOptions(a).map(function (c) { return c.code; }) : a.options.map(function (o) { return canon(o.code); });
        var picked = opts.filter(function (c) { return S.plan[c]; });
        var tt = 0, pp = 0;
        if (st === "substituted") { if (picked.length) { if (started(S.plan[picked[0]])) tt = a.need; else pp = a.need; } }
        else picked.forEach(function (c) { var cu = cuOf(c); if (started(S.plan[c])) tt += cu; else pp += cu; });
        tt = Math.min(tt, a.need); pp = Math.min(pp, a.need - tt);
        t += tt; p += pp;
        if (tt + pp < a.need) open.push(a.name);
      });
      out.push({ name: sec.section, t: t, p: p, need: need, extra: waived ? fmt(waived) + " waived" : "", open: open });
    });
    return out;
  }
  function majorState() {
    var rows = [], counts = {};
    MAJ.filter(function (m) { return explored.indexOf(m.name) >= 0; }).forEach(function (m) {
      var t = 0, p = 0, open = [];
      m.required.forEach(function (r) {
        var c = canon(r.code), e = S.plan[c];
        if (e) { if (started(e)) t += r.cu; else p += r.cu; } else open.push(r.code);
      });
      m.buckets.forEach(function (b) {
        var tt = 0, pp = 0;
        Object.keys(S.plan).forEach(function (c) {
          if (CORE_CODES[c] || REQ_MAJ[c] || !inRule(c, b.rule)) return;
          (counts[c] = counts[c] || {})[m.name] = 1;
          if (started(S.plan[c])) tt += cuOf(c); else pp += cuOf(c);
        });
        tt = Math.min(tt, b.need); pp = Math.min(pp, b.need - tt);
        t += tt; p += pp;
        if (tt + pp < b.need) open.push(b.label);
      });
      rows.push({ name: m.name, t: t, p: p, need: m.total, extra: "", open: open });
    });
    var dbl = 0;
    Object.keys(counts).forEach(function (c) { if (Object.keys(counts[c]).length > 1) dbl += cuOf(c); });
    return { rows: rows, dbl: dbl };
  }

  // ---------- render ----------
  var ui = { filter: "all", q: "", noOpen: false, maybeMore: 60 };
  function bar(t, p, need) {
    var tw = need ? Math.min(100, 100 * t / need) : 0, pw = need ? Math.min(100 - tw, 100 * p / need) : 0;
    return "<div class='sbar'><span class='st' style='width:" + tw + "%'></span><span class='sp' style='width:" + pw + "%'></span></div>";
  }
  function summary() {
    var rows = coreState(), ms = majorState(), tt = 0, tp = 0;
    entries().forEach(function (e) { if (started(e)) tt += cuOf(e.code); else tp += cuOf(e.code); });
    var h = "<section class='summ'><div class='summ-h'>Your plan</div>";
    rows.concat(ms.rows).forEach(function (r) {
      h += "<a class='srow' href='#" + (r.name.indexOf("core") >= 0 ? "core" : "majors") + "' title='" + esc(r.open.length ? "Still open: " + r.open.join(", ") : "Covered") + "'>"
        + "<span class='sn'>" + esc(r.name) + "</span>" + bar(r.t, r.p, r.need)
        + "<span class='sv'>" + fmt(r.t + r.p) + " / " + fmt(r.need) + " CU" + (r.extra ? " <span class='sx'>· " + esc(r.extra) + "</span>" : "") + "</span></a>";
    });
    var cls = ms.dbl > D.doubleCap ? "dover" : ms.dbl >= D.doubleCap ? "dat" : "";
    h += "<div class='srow tot'><span class='sn'>Total</span>" + bar(tt, tp, 19) + "<span class='sv'>" + fmt(tt + tp) + " / 19 CU <span class='sx " + cls + "'>· double-counted " + fmt(ms.dbl) + " / 2.0</span></span></div>"
      + "<div class='skey'><span class='k st'></span> taken / in progress &nbsp; <span class='k sp'></span> planned · hover a row for what's still open</div></section>";
    return h;
  }
  function coreView() {
    var h = "<h2 id='core'>Core requirements</h2><div class='startbanner'><b>Start here.</b> For each area, choose how you're meeting it — "
      + "<b>Take</b>, <b>Waived</b> or <b>Substituted</b> — then tick the classes you've taken, are taking, or plan to take. Areas stay unanswered until you choose.</div>";
    D.core.forEach(function (sec) {
      h += "<div class='sect'>" + esc(sec.section) + "</div><div class='grid'>";
      sec.areas.forEach(function (a) {
        var st = S.core[a.name], r = D.groupRules[a.name] || {};
        var can = { take: true, waived: !!r.waive, substituted: !!r.subs };
        var opts = st === "substituted" ? subOptions(a).map(function (c) { return { code: c.code, title: c.title, cu: c.cu, note: "" }; }) : a.options.map(function (o) { return Object.assign({}, o, { code: canon(o.code) }); });
        var have = opts.filter(function (o) { return S.plan[o.code]; }).reduce(function (s, o) { return s + o.cu; }, 0);
        var picked = opts.filter(function (o) { return S.plan[o.code]; }).length;
        var status, met;
        if (!st) { status = "choose: Take · Waived · Substituted"; met = false; }
        else if (st === "waived") { status = "✓ waived"; met = true; }
        else if (st === "substituted") { met = picked > 0; status = met ? "✓ substituted" : "pick a substitute"; }
        else { met = have >= a.need && (a.need > 0 || picked > 0); status = met ? "✓ covered" : (a.need ? fmt(have) + " of " + fmt(a.need) + " CU" : "not selected");
               if (a.rule === "pick one" && picked > 1) { status = "⚠ " + picked + " selected — pick one"; met = false; } }
        h += "<div class='cg" + (met ? " met" : "") + (st ? "" : " unanswered") + "'><div class='gh'><span class='gn'>" + esc(a.name) + "</span><span class='gs'>" + esc(a.rule) + " · " + esc(status) + "</span></div>";
        h += "<div class='cst'><span class='cst-l'>Status:</span>" + [["take", "Take"], ["waived", "Waived"], ["substituted", "Substituted"]].map(function (v) {
          return "<label class='" + (can[v[0]] ? "" : "dis") + "'" + (can[v[0]] ? "" : " title='" + (v[0] === "waived" ? "This area can't be waived" : "No substitution is documented for this area") + "'") + "><input type='radio' name='cs-" + esc(a.name) + "' data-core='" + esc(a.name) + "' value='" + v[0] + "'" + (st === v[0] ? " checked" : "") + (can[v[0]] ? "" : " disabled") + "> " + v[1] + "</label>";
        }).join("") + "</div>";
        if (r.note) h += "<div class='nt'>" + esc(r.note) + "</div>";
        h += "<div class='" + (st === "waived" ? "waivedlist" : st === "substituted" ? "subs" : "") + "'>";
        opts.forEach(function (o) {
          var on = !!S.plan[o.code];
          h += "<label class='opt'>" + (st === "waived" ? "" : "<input type='checkbox' data-pick='" + esc(o.code) + "'" + (on ? " checked" : "") + ">")
            + "<span><b>" + esc(o.code) + "</b> " + esc(o.title) + " · " + fmt(o.cu) + " CU" + (o.note ? "<span class='nt'>" + esc(o.note) + "</span>" : "") + "</span></label>";
        });
        h += "</div></div>";
      });
      h += "</div>";
    });
    return h;
  }
  function majorsView() {
    var h = "<h2 id='majors'>Majors you're exploring</h2>";
    var ms = MAJ.filter(function (m) { return explored.indexOf(m.name) >= 0; });
    if (!ms.length) h += "<p class='sub'>None of the majors you chose have requirement data yet.</p>";
    h += "<div class='grid'>";
    ms.forEach(function (m) {
      var st = majorState().rows.filter(function (r) { return r.name === m.name; })[0];
      h += "<div class='cg'><div class='gh'><span class='gn'>" + esc(m.name) + "</span><span class='gs'>" + fmt(st.t + st.p) + " of " + fmt(m.total) + " CU</span></div>";
      m.required.forEach(function (r) {
        var c = canon(r.code);
        h += "<label class='opt'><input type='checkbox' data-pick='" + esc(c) + "'" + (S.plan[c] ? " checked" : "") + "><span><b>" + esc(r.code) + "</b> " + esc(r.title) + " · " + fmt(r.cu) + " CU <span class='nt'>Required</span></span></label>";
      });
      m.buckets.forEach(function (b) {
        var picked = Object.keys(S.plan).filter(function (c) { return !CORE_CODES[c] && !REQ_MAJ[c] && inRule(c, b.rule); });
        var have = picked.reduce(function (s, c) { return s + cuOf(c); }, 0);
        h += "<div class='pill'><span>" + esc(b.label) + "</span><span>" + fmt(have) + " of " + fmt(b.need) + " CU" + (have >= b.need ? " ✓" : "") + "</span></div>"
          + (picked.length ? "<div class='nt'>Picked: " + esc(picked.join(", ")) + "</div>" : "<div class='nt'>Pick from Electives below — use the " + esc(MAJ_SHORT[m.name]) + " filter.</div>");
      });
      h += "</div>";
    });
    h += "</div>";
    if (exploredMissing.length) h += "<p class='sub'>Requirements for " + esc(exploredMissing.join(", ")) + " aren't loaded yet — only Finance, Entrepreneurship & Innovation and AI for Business are so far.</p>";
    var dbl = majorState().dbl;
    if (ms.length > 1) h += "<div class='watch" + (dbl > D.doubleCap ? " capwarn" : "") + "'>" + fmt(dbl) + " CU of your picks count toward two majors. Wharton caps this at 2.0 CU total.</div>";
    return h;
  }
  function card(c, col) {
    var k = BY[c], lab = LABEL[c] || "", tags = majorsFor(c);
    var h = "<div class='card' data-code='" + esc(c) + "'><div class='mvs'>"
      + [["✓", "yes", "Pick it — into your plan"], ["?", "maybe", "Back to Maybe"], ["✕", "no", "Not for me"]].map(function (b) {
        return "<button class='mv" + (col === b[1] ? " on" : "") + "' data-decide='" + b[1] + "' title='" + b[2] + "'>" + b[0] + "</button>";
      }).join("") + "</div>";
    if (lab) h += "<div class='reason " + (lab === "Best fit" ? "best" : "poss") + "'>" + (lab === "Best fit" ? "★ " : "") + lab + "</div>";
    h += "<div class='t'><a target='_blank' rel='noopener' href='https://catalog.upenn.edu/search/?P=" + encodeURIComponent(c) + "'>" + esc(c) + "</a> " + esc(k.title) + "</div>";
    if (ALSO[c]) h += "<div class='nt'>Same class, also listed as " + esc(ALSO[c].join(", ")) + "</div>";
    h += "<div class='meta'><span class='cu'>" + fmt(k.cu) + " CU</span>" + (k.quant ? "<span class='cu' title='quant-heavy course'>∑</span>" : "")
      + tags.map(function (m) { return "<span class='tag mj' style='--c:" + MAJ_COLOR[m] + "'><i></i>" + esc(MAJ_SHORT[m]) + "</span>"; }).join("") + "</div>";
    if (k.summary) h += "<div class='sum'>" + esc(k.summary) + "</div>";
    if (lab && WHY[c] && WHY[c].length) h += "<div class='why'>Why: " + esc(WHY[c].join("; ")) + ".</div>";
    return h + "</div>";
  }
  function electivesView() {
    var all = Object.keys(BY).filter(function (c) { return !CORE_CODES[c]; });
    var match = function (c) {
      var k = BY[c], t = majorsFor(c);
      if (ui.q && (c + " " + k.title + " " + k.summary).toLowerCase().indexOf(ui.q.toLowerCase()) < 0) return false;
      if (ui.filter === "rec") return !!LABEL[c];
      if (ui.filter === "none") return !t.length;
      if (ui.filter !== "all") return t.indexOf(ui.filter) >= 0;
      return true;
    };
    var yes = all.filter(function (c) { return S.plan[c]; }), no = all.filter(function (c) { return !S.plan[c] && S.dec[c] === "no"; });
    var maybe = all.filter(function (c) { return !S.plan[c] && S.dec[c] !== "no"; }).sort(function (a, b) { return (SCORE[b] || -99) - (SCORE[a] || -99); });
    var nRec = all.filter(function (c) { return LABEL[c]; }).length;
    var h = "<h2 id='electives'>Electives — the full catalog</h2><p class='sub'>Everything starts in <b>Maybe</b>, sorted by how well it matches your answers. "
      + nRec + " classes are labeled <b>Best fit</b> or <b>Good fit</b>; the rest are unlabeled, not ruled out. ✓ adds a class to your plan and calendar, ✕ moves it to No.</p>";
    h += "<div class='chips'>" + [["all", "All"], ["rec", "Recommended for you"], ["Finance", "Finance"], ["Entrepreneurship & Innovation", "E&I"], ["AI for Business", "AI"], ["none", "Not in a major"]].map(function (f) {
      return "<button class='chip" + (ui.filter === f[0] ? " on" : "") + "' data-filter='" + esc(f[0]) + "'>" + esc(f[1]) + "</button>";
    }).join("") + "<input id='q' class='search' placeholder='Search classes' value='" + esc(ui.q) + "'></div>";
    var own = entries().filter(function (e) { return e.own; });
    h += "<div class='board'>";
    h += "<div class='col'><h3>✓ Yes <span class='ct'>" + (yes.length + own.length) + "</span></h3><div class='colsub'>your picks — in your plan</div>"
      + "<div class='card ownadd'><div class='t'>+ Add a class you don't see</div><div class='nt'>Another Penn school, or missing from Wharton's list. Press Enter to add.</div>"
      + "<div class='ownrow'><input class='ownin' id='own-code' placeholder='Code (optional)' maxlength='9'><input class='ownin' id='own-title' placeholder='Class name' maxlength='120'>"
      + "<select class='ownin' id='own-cu'><option value='0.5'>0.5 CU</option><option value='1' selected>1 CU</option><option value='1.5'>1.5 CU</option><option value='2'>2 CU</option></select></div></div>"
      + own.map(function (e) { return "<div class='card own'><div class='mvs'><button class='mv' data-delown='" + esc(e.code) + "' title='Delete'>✕</button></div><div class='reason'>Added by you</div><div class='t'>" + esc(e.shown ? e.shown + " " : "") + esc(e.title) + "</div><div class='meta'><span class='cu'>" + fmt(e.cu) + " CU</span></div><div class='nt'>Not on Wharton's list, so it counts toward no major.</div></div>"; }).join("")
      + yes.filter(match).map(function (c) { return card(c, "yes"); }).join("") + "</div>";
    var mshow = maybe.filter(match);
    h += "<div class='col'><h3>? Maybe <span class='ct'>" + maybe.length + "</span></h3><div class='colsub'>best match first</div>"
      + mshow.slice(0, ui.maybeMore).map(function (c) { return card(c, "maybe"); }).join("")
      + (mshow.length > ui.maybeMore ? "<button class='seemore' data-more='1'>Show more (" + (mshow.length - ui.maybeMore) + ")</button>" : "") + "</div>";
    h += "<div class='col no'><h3>✕ No <span class='ct'>" + no.length + "</span></h3><div class='colsub'>classes you ruled out</div>"
      + (ui.noOpen ? no.filter(match).map(function (c) { return card(c, "no"); }).join("") : "")
      + (no.length ? "<button class='seemore' data-noopen='1'>" + (ui.noOpen ? "Hide" : "Show") + "</button>" : "") + "</div>";
    return h + "</div>";
  }
  function calendarView() {
    var heavy = RECRUIT[S.recruiting] || [];
    var h = "<h2 id='calendar'>Calendar</h2><p class='sub'>Suggested placements fill each semester to about 4.5 CU, schedule core first, keep recruiting terms lighter "
      + "and spread quant-heavy courses. Drag to try a class elsewhere — that doesn't lock it; click 🔓 when you're sure. <b>Which terms each class is offered isn't known.</b></p>";
    h += "<div class='cst'><span class='cst-l'>Recruiting:</span>" + [["mature", "Mature (busy first fall)"], ["enterprise", "Enterprise / startup (busy spring)"], ["none", "Not recruiting"]].map(function (v) {
      return "<label><input type='radio' name='rec' data-rec='" + v[0] + "'" + (S.recruiting === v[0] ? " checked" : "") + "> " + v[1] + "</label>";
    }).join("") + "</div>";
    h += "<div class='resug'><button data-resuggest='1'>↻ Re-suggest</button> <span class='sub'>Re-places every 🔓 suggested class. <b>🔒 Locked classes never move.</b></span>"
      + (S.changes >= 3 ? " <span class='nudge'>You've added or removed " + S.changes + " classes since the last full suggestion — click Re-suggest for a fresh layout. Your 🔒 locked classes won't move.</span>" : "") + "</div>";
    h += "<table class='cal'><tr><th>Term</th><th>Full semester</th><th>Q1</th><th>Q2</th><th class='cu'>CU</th></tr>";
    var es = entries();
    TERMS.forEach(function (t) {
      var tcu = 0, nq = 0;
      h += "<tr><td class='tn'>" + esc(t) + (heavy.indexOf(t) >= 0 ? "<div class='rec'>recruiting term</div>" : "") + "</td>";
      ["Full", "Q1", "Q2"].forEach(function (s) {
        var cell = es.filter(function (e) { return e.term === t && (e.slot || "Full") === s; });
        cell.sort(function (a, b) { return (b.locked || started(b)) - (a.locked || started(a)); });
        h += "<td class='slot' data-term=\"" + esc(t) + "\" data-slot='" + s + "'>" + cell.map(chip).join("") + "</td>";
      });
      es.forEach(function (e) { if (e.term === t) { tcu += cuOf(e.code); nq += isQuant(e.code) ? 1 : 0; } });
      h += "<td class='tcu'>" + fmt(tcu) + (tcu > HEAVY ? "<div class='flag'>⚠ heavy — more than a typical semester; move or drop classes</div>" : "") + (nq ? "<div class='" + (nq > QCAP ? "flag" : "qcount") + "'>∑ " + nq + " quant-heavy " + (nq === 1 ? "course" : "courses") + "</div>" : "") + "</td></tr>";
    });
    h += "</table><div class='tray slot' data-term='' data-slot=''><b>Needs a term</b> " + (es.filter(function (e) { return !e.term; }).map(chip).join("") || "<span class='cu'>none</span>") + "</div>";
    return h;
  }
  function chip(e) {
    var done = started(e), locked = done || e.locked;
    var tags = done ? [] : [];
    var k = BY[e.code];
    var cat = CORE_CODES[e.code] ? "Core" : e.own ? "Added by you" : null;
    var mj = e.own ? [] : majorsFor(e.code).filter(function (m) { return explored.indexOf(m) >= 0 || REQ_MAJ[e.code] === m; });
    return "<div class='chip " + (done ? "done" : locked ? "locked" : "sugg") + "' draggable='" + (done ? "false" : "true") + "' data-chip='" + esc(e.code) + "'" + (e.why ? " title=\"" + esc(e.why) + "\"" : "") + ">"
      + (done ? "<span class='lk'>✔</span>" : "<button class='lk' data-lock='" + esc(e.code) + "' title='" + (locked ? "Locked in — click to unlock" : "Suggested — click to lock in") + "'>" + (locked ? "🔒" : "🔓") + "</button>")
      + "<b>" + esc(e.own ? (e.shown || "") : e.code) + "</b> " + esc(e.own ? e.title : k ? k.title : "") + " <span class='cu'>" + fmt(cuOf(e.code)) + "</span>" + (isQuant(e.code) ? " <span class='qh'>∑</span>" : "")
      + "<div class='ctags'>" + (cat ? "<span class='tag mj' style='--c:#8a857c'><i></i>" + cat + "</span>" : "")
      + mj.map(function (m) { return "<span class='tag mj' style='--c:" + MAJ_COLOR[m] + "'><i></i>" + esc(MAJ_SHORT[m]) + "</span>"; }).join("")
      + (!cat && !mj.length ? "<span class='tag mj' style='--c:#b9b4aa'><i></i>Elective</span>" : "") + "</div></div>";
  }
  function sourcesView() {
    return "<section class='srcs'><h2>Sources</h2><p>Every class comes from the <a target='_blank' rel='noopener' href='" + esc(D.courseListUrl) + "'>Wharton MBA course list</a> (Excel export). "
      + "<b>Wharton classes only — classes from other Penn schools aren't included.</b> Use “+ Add a class you don't see” for those.</p>"
      + "<p class='when'><b>Exported " + esc(D.exported) + ".</b> Classes are subject to change since the export — check the live list before you register.</p>"
      + "<ul>" + D.sources.map(function (s) { return "<li><a target='_blank' rel='noopener' href='" + esc(s[1]) + "'>" + esc(s[0]) + "</a></li>"; }).join("") + "</ul>"
      + "<p class='sub'>Recommendations come from patterns learned from 100 sample student profiles — no AI runs while you use this, and nothing you enter leaves your browser. "
      + "Major requirements cover Finance, Entrepreneurship & Innovation and AI for Business so far; check every requirement with your academic advisor.</p></section>";
  }
  function render() {
    var y = window.scrollY;
    $("#app").innerHTML = summary() + "<nav class='nav'><a href='#core'>Core</a><a href='#majors'>Majors</a><a href='#electives'>Electives</a><a href='#calendar'>Calendar</a></nav>"
      + coreView() + majorsView() + electivesView() + calendarView() + sourcesView();
    window.scrollTo(0, y);
  }
  function commit() { save(); render(); }

  // ---------- events ----------
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.core) { S.core[t.dataset.core] = t.value; return commit(); }
    if (t.dataset.pick) { if (t.checked) addToPlan(t.dataset.pick); else removeFromPlan(t.dataset.pick); return commit(); }
    if (t.dataset.rec) { S.recruiting = t.dataset.rec; return commit(); }
  });
  document.addEventListener("input", function (e) {
    if (e.target.id === "q") { ui.q = e.target.value; var pos = e.target.selectionStart; render(); var q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || !e.target.classList.contains("ownin")) return;
    var title = $("#own-title").value.trim(), code = $("#own-code").value.trim().toUpperCase().replace(/\s+/g, " ");
    if (!title) return $("#own-title").focus();
    var m = code.match(/^([A-Z]{3,4}) ?(\d{4})$/);
    if (code && !m) return alert("Course code should look like LAW 6010 — or leave it blank.");
    if (m && BY[canon(m[1] + " " + m[2])]) { addToPlan(canon(m[1] + " " + m[2])); return commit(); }
    S.ownN += 1;
    var key = "OWN " + S.ownN;
    S.plan[key] = { term: null, slot: null, locked: false, why: null, own: true, title: title, cu: parseFloat($("#own-cu").value), shown: m ? m[1] + " " + m[2] : "" };
    S.changes += 1; placeNew(); commit();
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-decide],[data-filter],[data-more],[data-noopen],[data-lock],[data-resuggest],[data-delown],[data-theme-set],[data-startover],[data-feedback]");
    if (!b) return;
    var d = b.dataset;
    if (d.decide) {
      var c = b.closest(".card").dataset.code;
      if (d.decide === "yes") addToPlan(c);
      else { removeFromPlan(c); if (d.decide === "no") S.dec[c] = "no"; else delete S.dec[c]; }
      return commit();
    }
    if (d.filter) { ui.filter = d.filter; ui.maybeMore = 60; return render(); }
    if (d.more) { ui.maybeMore += 60; return render(); }
    if (d.noopen) { ui.noOpen = !ui.noOpen; return render(); }
    if (d.lock) { e.preventDefault(); var en = S.plan[d.lock]; en.locked = !en.locked; return commit(); }
    if (d.resuggest) { resuggest(); return commit(); }
    if (d.delown) { delete S.plan[d.delown]; S.changes += 1; return commit(); }
    if (d.themeSet) {
      if (d.themeSet === "auto") { localStorage.removeItem("wcp.theme"); delete document.documentElement.dataset.theme; }
      else { localStorage.setItem("wcp.theme", d.themeSet); document.documentElement.dataset.theme = d.themeSet; }
      return;
    }
    if (d.startover) {
      if (!confirm("Start over? This clears your survey answers and your plan in this browser.")) return;
      ["wcp.answers", "wcp.state", "wcp.surveyFeedback"].forEach(function (k) { localStorage.removeItem(k); });
      location.href = "index.html"; return;
    }
    if (d.feedback) return feedback();
  });
  var dragCode = null;
  document.addEventListener("dragstart", function (e) { var c = e.target.closest && e.target.closest("[data-chip]"); if (c) { dragCode = c.dataset.chip; e.dataTransfer.setData("text/plain", dragCode); } });
  document.addEventListener("dragover", function (e) { if (dragCode && e.target.closest && e.target.closest(".slot")) e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    var s = dragCode && e.target.closest && e.target.closest(".slot"); if (!s) return;
    e.preventDefault();
    var en = S.plan[dragCode], slot = s.dataset.slot || null;
    if (!slotOk(dragCode, slot)) {
      var cu = cuOf(dragCode);
      popup("Can't place that there", cu >= 1 ? "It's a full-credit (" + fmt(cu) + " CU) class, so it runs the whole semester — use the Full semester column."
        : FULLHALF[dragCode] ? "It's half-credit but runs the whole semester — use the Full semester column." : "It's a half-credit class, so it runs for one quarter — use Q1 or Q2.");
      dragCode = null; return;
    }
    en.term = s.dataset.term || null; en.slot = slot; en.why = en.term ? "you moved this here" : "parked";
    dragCode = null; commit();
  });
  function popup(title, text) {
    var o = document.createElement("div");
    o.className = "pop-o"; o.innerHTML = "<div class='pop'><b>" + esc(title) + "</b><p>" + esc(text) + "</p><button>Got it</button></div>";
    o.onclick = function (ev) { if (ev.target === o || ev.target.tagName === "BUTTON") o.remove(); };
    document.body.appendChild(o);
  }
  function feedback() {
    var sf = {}; try { sf = JSON.parse(localStorage.getItem("wcp.surveyFeedback") || "{}"); } catch (e) {}
    var o = document.createElement("div");
    o.className = "pop-o";
    o.innerHTML = "<div class='pop wide'><b>Feedback</b><p>What worked, what didn't, what you'd change? Click Copy, then text or email it back to whoever shared this with you. Nothing is sent automatically.</p>"
      + "<textarea id='fbtext' rows='6' placeholder='Your thoughts…'></textarea><div class='row'><button id='fbcopy' class='pri'>Copy</button> <button id='fbclose'>Close</button></div></div>";
    document.body.appendChild(o);
    $("#fbclose").onclick = function () { o.remove(); };
    $("#fbcopy").onclick = function () {
      var plan = entries().map(function (e) { return (e.own ? e.title : e.code) + (e.term ? " (" + e.term + ")" : ""); });
      var recs = Object.keys(LABEL).filter(function (c) { return LABEL[c]; });
      var txt = "Course planner feedback\n\n" + $("#fbtext").value + "\n\n— Survey notes: " + JSON.stringify(sf)
        + "\n— Picked (" + plan.length + "): " + plan.join(", ") + "\n— Recommended picked: " + recs.filter(function (c) { return S.plan[c]; }).length + " of " + recs.length
        + "\n— Ruled out recommended: " + recs.filter(function (c) { return S.dec[c] === "no"; }).join(", ");
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { $("#fbcopy").textContent = "Copied ✓"; },
        function () { $("#fbtext").value = txt; $("#fbtext").select(); $("#fbcopy").textContent = "Select-all copied text above"; });
    };
  }
  window.__wcp = { S: S, addToPlan: addToPlan, removeFromPlan: removeFromPlan, schedule: schedule, resuggest: resuggest,
                   render: render, LABEL: LABEL, SCORE: SCORE, coreState: coreState, majorState: majorState };   // for tests
  if (localStorage.getItem("wcp.state") === null) placeNew();
  try { var st = JSON.parse(localStorage.getItem("wcp.state")); if (st && st.rescore) { delete S.rescore; } } catch (e) {}
  commit();
})();
