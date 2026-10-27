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
    if (!s.recruitTerms) s.recruitTerms = recruitFromSurvey();
    return s;
  }
  // Recruiting semesters come straight from the survey ("Which semesters will you be recruiting?");
  // older answers that named a recruiting type are mapped once.
  function recruitFromSurvey() {
    var yt = /2027$/.test(A["class"] || "") ? { "Fall of year 1": "Fall '25", "Spring of year 1": "Spring '26", "Fall of year 2": "Fall '26", "Spring of year 2": "Spring '27" }
                                             : { "Fall of year 1": "Fall '26", "Spring of year 1": "Spring '27", "Fall of year 2": "Fall '27", "Spring of year 2": "Spring '28" };
    if (A.recruit_terms) return A.recruit_terms.map(function (x) { return yt[x]; }).filter(Boolean);
    if (/^Mature/.test(A.recruiting || "")) return [yt["Fall of year 1"]];
    if (/^Enterprise/.test(A.recruiting || "")) return [yt["Spring of year 1"], yt["Spring of year 2"]];
    return [];
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

  // ---------- majors (each from its official department page — see D.majors[].source) ----------
  var ALLM = {}; D.majors.forEach(function (m) { ALLM[m.name] = m; });
  var explored = (A.majors || []).filter(function (m) { return ALLM[m]; });
  var PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#9b59b6", "#c0392b", "#16a085", "#d4a017", "#5d6d7e"];
  var MAJ_COLOR = {}, MAJ_SHORT = {};
  explored.forEach(function (m, i) { MAJ_COLOR[m] = PALETTE[i % PALETTE.length]; MAJ_SHORT[m] = ALLM[m].short || m; });
  function upper(c, dept, incCore) { return codesOf(c).some(function (x) { return x.indexOf(dept + " ") === 0 && +x.slice(-4) >= (incCore ? 6000 : 7000); }); }
  function listed(c, codes) { return codesOf(c).some(function (x) { return (codes || []).indexOf(x) >= 0; }); }
  function inGroup(c, g) { return g.dept ? upper(c, g.dept, g.include_core) : listed(c, g.codes); }
  function reqOf(m) { return (m.required || []).map(canon); }
  var REQ_MAJ = {};
  explored.forEach(function (n) { reqOf(ALLM[n]).forEach(function (c) { REQ_MAJ[c] = n; }); });
  function eligible(c, m) {
    return reqOf(m).indexOf(c) >= 0 || listed(c, m.core_one_of) || (m.groups || []).some(function (g) { return inGroup(c, g); });
  }
  function majorsFor(code) { return explored.filter(function (n) { return eligible(code, ALLM[n]); }); }

  // ---------- scoring (no AI) ----------
  var FEATURE_TEXT = { role: "your goal: %s", ind: "your interest in %s", topic: "a topic you want: %s",
    major: "counts toward %s, which you're exploring", bg: "builds on your %s background", skill: "uses your %s skills" };
  function features(s) {
    var f = {};
    [["roles", "role"], ["industries", "ind"], ["topics", "topic"], ["background", "bg"], ["skills", "skill"], ["majors", "major"]]
      .forEach(function (p) { (s[p[0]] || []).forEach(function (v) {
        if (String(v).indexOf("Other: ") === 0) return;
        if (p[1] === "major" && D.majorAlias[v]) v = D.majorAlias[v];   // weights were learned under older names
        f[p[1] + ":" + v] = 1; }); });
    if (s.recruiting) f["rec:" + s.recruiting.split(" —")[0]] = 1;
    else if (s.recruit_terms) {
      var rt = s.recruit_terms;
      f["rec:" + (!rt.length || rt.indexOf("Not recruiting") >= 0 ? "Not recruiting"
        : rt.some(function (x) { return /^Spring/.test(x); }) ? "Enterprise / startup recruiting" : "Mature recruiting")] = 1;
    }
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
  var STARTS = { "Summer '25": "2025-08-01", "Fall '25": "2025-08-25", "Spring '26": "2026-01-14", "Summer '26": "2026-08-01",
    "Fall '26": "2026-08-25", "Spring '27": "2027-01-14", "Fall '27": "2027-08-25", "Spring '28": "2028-01-14" };
  var TODAY = new Date().toISOString().slice(0, 10);
  function started(e) { return e.term && STARTS[e.term] && TODAY >= STARTS[e.term]; }
  var TARGET = 4.5, QCAP = 3, RQCAP = 2;
  var HEAVY = 5.5;   // warning only — no hard limit (testing found 2027 students could pile 13.5 CU into one term)

  // ---------- plan ----------
  function entries() { return Object.keys(S.plan).map(function (k) { return Object.assign({ code: k }, S.plan[k]); }); }
  function cuOf(code) { var e = S.plan[code]; return e && e.own ? e.cu : (BY[code] ? BY[code].cu : (e ? e.cu : 0)); }
  function isQuant(code) { return !!(BY[code] && BY[code].quant); }
  // anonymous usage counts: event names only, never answers or class picks
  function countEvent(name, title, once) {
    try {
      if (once) { if (localStorage.getItem("wcp.ev." + name)) return; localStorage.setItem("wcp.ev." + name, "1"); }
      if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: name, title: title, event: true });
    } catch (e) {}
  }
  function addToPlan(code, extra) {
    if (S.plan[code]) return;
    countEvent("plan-started", "Plan started", true);
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
    var heavy = S.recruitTerms || [];
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
      // …and before any already-placed class that needs it as a prerequisite (found by testing, Oct 27)
      var needers = Object.keys(D.prereqs).filter(function (k) { return D.prereqs[k].indexOf(c) >= 0 && FUTURE.indexOf(termOf[k]) >= 0; });
      var before = needers.length ? Math.min.apply(null, needers.map(function (k) { return FUTURE.indexOf(termOf[k]); })) : FUTURE.length;
      var opts = FUTURE.slice(start, Math.max(start + 1, before)); if (!opts.length) opts = FUTURE.slice(-1);
      var off = offered(c), runs = off ? opts.filter(function (t) { return t.indexOf(off[0]) === 0; }) : [];
      if (off && off[2] === "year1") runs = runs.filter(function (t) { return t === TERMS[2]; });
      if (off && runs.length) opts = runs;   // only the semesters the department says it runs
      var core = tier(c) === 0;
      var spreadCore = /^No — spread/.test(A.frontload || "");   //
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
      var slot = (cu >= 1 || FULLHALF[c]) ? "Full" : (off && off[1] === "Q1") ? "Q1" : (load[pick].Q1 <= load[pick].Q2 ? "Q1" : "Q2");
      if (off) why += off && runs.length ? " · offered in " + off[0] + (off[1] ? " " + off[1] : "") + " (department schedule)" : " · usually offered in " + off[0] + " — no such term left in your plan";
      add(pick, slot, cu, c);
      placed[c] = [pick, slot, why]; termOf[c] = pick;
    });
    return placed;
  }
  // Published term data (HCM only so far): season, optional quarter, optional "year1"
  function offered(c) { var x = (D.termOffered || {}).courses || {}; var hit = codesOf(c).filter(function (k) { return x[k]; })[0]; return hit ? x[hit] : null; }
  function offTerm(c, term) { var o = offered(c); return !!(o && term && term.indexOf(o[0]) !== 0); }
  function savePlaced(p) { Object.keys(p).forEach(function (c) { var e = S.plan[c]; e.term = p[c][0]; e.slot = p[c][1]; e.why = p[c][2]; }); }
  // After any placement: a class must come after its prerequisite. If it doesn't, move the class that needs the
  // prerequisite to the semester after it (never a locked or already-started class).
  function fixPrereqs() {
    Object.keys(D.prereqs).forEach(function (k) {
      var e = S.plan[k]; if (!e || !e.term || e.locked || started(e)) return;
      D.prereqs[k].forEach(function (p) {
        var pe = S.plan[p]; if (!pe || !pe.term) return;
        var ti = FUTURE.indexOf(e.term), pi = FUTURE.indexOf(pe.term);
        if (pi < 0 || ti > pi) return;
        if (pi + 1 < FUTURE.length) { e.term = FUTURE[pi + 1]; e.why = "moved after its prerequisite " + p; }
        else e.why = "should come after its prerequisite " + p + " — no later semester left";
      });
    });
  }
  function placeNew() { savePlaced(schedule(false)); fixPrereqs(); }
  function resuggest() { savePlaced(schedule(true)); fixPrereqs(); S.changes = 0; }
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
  // Statistics counts the course actually taken: STAT 6130 = 1.0, STAT 6210 by placement = 0.5
  // — so core totals 9.5, or 9.0 with 6210.
  // Same for Corporate finance (FNCE 6110 1.0 / 6210 0.5) and Macroeconomics (FNCE 6130 1.0 / 6230 0.5) —
  //
  function areaNeed(a) {
    if (["Statistics", "Corporate finance", "Macroeconomics"].indexOf(a.name) < 0 || S.core[a.name] === "substituted") return a.need;
    var got = a.options.map(function (o) { return canon(o.code); }).filter(function (c) { return S.plan[c]; });
    return got.length ? Math.min.apply(null, got.map(cuOf)) : 1.0;
  }
  function coreState() {
    var out = [];
    D.core.forEach(function (sec) {
      var t = 0, p = 0, need = 0, waived = 0, open = [];
      sec.areas.forEach(function (a) {
        if (!a.need) return;
        var st = S.core[a.name], an = areaNeed(a);
        if (st === "waived") { waived += an; return; }
        need += an;
        var opts = st === "substituted" ? subOptions(a).map(function (c) { return c.code; }) : a.options.map(function (o) { return canon(o.code); });
        var picked = opts.filter(function (c) { return S.plan[c]; });
        var tt = 0, pp = 0;
        if (st === "substituted") { if (picked.length) { if (started(S.plan[picked[0]])) tt = an; else pp = an; } }
        else picked.forEach(function (c) { var cu = cuOf(c); if (started(S.plan[c])) tt += cu; else pp += cu; });
        tt = Math.min(tt, an); pp = Math.min(pp, an - tt);
        t += tt; p += pp;
        if (tt + pp < an) open.push(a.name);
      });
      out.push({ name: sec.section, t: t, p: p, need: need, extra: waived ? fmt(waived) + " waived" : "", open: open });
    });
    return out;
  }
  // OIDD flex core: which picked options are filling it (first ones up to 1.0 CU), for the "not_with_flex" rules
  function flexUsed() {
    var out = {}, have = 0, st = S.core["Operations, Information & Decisions"];
    if (st === "waived" || st === "substituted") return out;
    D.core.forEach(function (s) { s.areas.forEach(function (a) {
      if (a.name !== "Operations, Information & Decisions") return;
      a.options.forEach(function (o) { var c = canon(o.code); if (S.plan[c] && have < 1.0) { out[c] = 1; have += cuOf(c); } });
    }); });
    return out;
  }
  function majorProgress(m) {
    var t = 0, p = 0, open = [], used = {}, groups = [], applied = {};
    var rules = m.enforced || [], flex = flexUsed();
    var inSet = function (c, codes) { return listed(c, codes); };
    var countAs = function (c) {
      var r = rules.filter(function (x) { return x.type === "count_as" && listed(c, [x.code]); })[0];
      if (r) { applied[r.text] = 1; return Math.min(r.cu, cuOf(c)); }
      return cuOf(c);
    };
    var blocked = function (c, cu) {   // would counting c break a rule?
      return rules.some(function (r) {
        if (!inSet(c, r.codes || [])) return false;
        var counted = Object.keys(used).filter(function (u) { return inSet(u, r.codes); });
        var hit = r.type === "one_of" ? counted.length >= 1
          : r.type === "max_n" ? counted.length >= r.n
          : r.type === "max_cu" ? counted.reduce(function (s, u) { return s + cuOf(u); }, 0) + cu > r.cu + 1e-9
          : r.type === "not_with_flex" ? !!flex[c] : false;
        if (hit) applied[r.text] = 1;
        return hit;
      });
    };
    var add = function (c, cu) { if (started(S.plan[c])) t += cu; else p += cu; };
    var reqNeed = 0;
    reqOf(m).forEach(function (c) { var cu = BY[c] ? BY[c].cu : 1; reqNeed += cu;
      if (S.plan[c]) { add(c, cuOf(c)); used[c] = 1; } else open.push(c); });
    if (m.core_one_of) {
      reqNeed += 0.5;
      var co = Object.keys(S.plan).filter(function (c) { return listed(c, m.core_one_of); });
      if (co.length) { add(co[0], cuOf(co[0])); used[co[0]] = 1; } else open.push(m.core_one_of.join(" or "));
    }
    var need = Math.max(0, (m.total || 0) - reqNeed), et = 0, ep = 0;
    (m.groups || []).slice().sort(function (a, b) { return (b.min ? 1 : 0) - (a.min ? 1 : 0); }).forEach(function (g) {
      var gt = 0, gp = 0, cap = g.max != null ? g.max : 99, picked = [];
      Object.keys(S.plan).forEach(function (c) {
        if (used[c] || S.plan[c].own || !inGroup(c, g)) return;
        if (CORE_CODES[c] && !g.include_core && !listed(c, g.codes)) return;   // core counts only where a major says so
        var cu = countAs(c); if (gt + gp + cu > cap + 1e-9 || blocked(c, cu)) return;
        used[c] = 1; picked.push(c);
        if (started(S.plan[c])) gt += cu; else gp += cu;
      });
      groups.push({ g: g, have: gt + gp, picked: picked });
      if (g.min && gt + gp < g.min) open.push(g.label);
      et += gt; ep += gp;
    });
    et = Math.min(et, need); ep = Math.min(ep, need - et);
    return { t: t + et, p: p + ep, need: m.total, open: open, groups: groups, counted: used, applied: applied };
  }
  function majorState() {
    var rows = [], counts = {};
    explored.forEach(function (n) {
      var m = ALLM[n]; if (!m.total) return;
      var r = majorProgress(m);
      Object.keys(r.counted).forEach(function (c) { if (!CORE_CODES[c]) (counts[c] = counts[c] || {})[n] = 1; });
      rows.push({ name: n, t: r.t, p: r.p, need: m.total, extra: "", open: r.open });
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
      + "<b>Take</b>, <b>Waived</b> or <b>Substituted</b> — then tick the classes you've taken, are taking, or plan to take. Areas stay unanswered until you choose.</div>"
      + "<p class='sub'>Wharton: leaving flexible core to your final semester can limit your choices, because of course availability.</p>";
    var short = ["FNCE 6210", "FNCE 6230"].filter(function (c) { return S.plan[c]; });
    if (short.length === 2) h += "<div class='watch capwarn'>Wharton doesn't allow using both FNCE 6210 and FNCE 6230 for the flexible core — take the full version of one.</div>";
    if (short.length && (explored.indexOf("Finance") >= 0 || explored.indexOf("Quantitative Finance") >= 0))
      h += "<div class='watch capwarn'>Finance majors can't take FNCE 6210 or FNCE 6230 — you're exploring a Finance major.</div>";
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
        else { var an = areaNeed(a); met = have >= an && (an > 0 || picked > 0); status = met ? "✓ covered" : (an ? fmt(have) + " of " + fmt(an) + " CU" : "not selected");
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
    if (!explored.length) h += "<p class='sub'>You didn't pick a major to explore — redo the survey any time to add one.</p>";
    explored.forEach(function (a) { (ALLM[a].exclusive || []).forEach(function (b) {
      if (explored.indexOf(b) >= 0 && a < b) h += "<div class='watch capwarn'>Wharton doesn't allow " + esc(a) + " together with " + esc(b) + " — you can explore both, but only declare one.</div>"; }); });
    h += "<div class='grid'>";
    explored.forEach(function (n) {
      var m = ALLM[n], r = m.total ? majorProgress(m) : null;
      h += "<div class='cg'><div class='gh'><span class='gn'>" + esc(n) + (m.stem ? " <span class='nt'>STEM</span>" : "") + "</span><span class='gs'>"
        + (r ? fmt(r.t + r.p) + " of " + fmt(m.total) + " CU" : "self-designed — not tracked") + "</span></div>";
      if (m.apply_note) h += "<div class='startbanner'>" + esc(m.apply_note) + "</div>";
      if (m.prereq_note) h += "<div class='nt'>" + esc(m.prereq_note) + "</div>";
      reqOf(m).forEach(function (c) {
        var k = BY[c];
        h += "<label class='opt'><input type='checkbox' data-pick='" + esc(c) + "'" + (S.plan[c] ? " checked" : "") + (k ? "" : " disabled") + "><span><b>" + esc(c) + "</b> "
          + esc(k ? k.title : "") + (k ? " · " + fmt(k.cu) + " CU" : "") + " <span class='nt'>Required" + (k ? "" : " — not in this year's course list") + "</span></span></label>";
      });
      if (m.core_one_of) h += "<div class='nt'>Plus one of " + esc(m.core_one_of.join(" / ")) + " (core).</div>";
      (r ? r.groups : (m.groups || []).map(function (g) { return { g: g, have: 0, picked: [] }; })).forEach(function (x) {
        var g = x.g, goal = g.min ? fmt(x.have) + " of " + fmt(g.min) + " CU" + (x.have >= g.min ? " ✓" : "") : fmt(x.have) + " CU (up to " + fmt(g.max != null ? g.max : m.total) + ")";
        //
        var goneList = g.codes ? g.codes.filter(function (c) { return (m.notOffered || []).indexOf(c) >= 0; }) : [];
        var availCU = g.codes ? g.codes.filter(function (c) { return BY[canon(c)] && (m.notOffered || []).indexOf(c) < 0; })
                                       .map(canon).filter(function (c, i, a) { return a.indexOf(c) === i; }).reduce(function (s, c) { return s + BY[c].cu; }, 0) : 99;
        var tight = g.min && availCU < 2 * g.min;
        h += "<div class='pill'><span>" + esc(g.label) + "</span><span>" + goal + "</span></div>"
          + (x.picked.length ? "<div class='nt'>Picked: " + esc(x.picked.join(", ")) + "</div>"
             : "<div class='nt'>" + (g.dept ? "Any upper-level " + esc(g.dept) + " course." : "Pick from Electives below — use the " + esc(MAJ_SHORT[n]) + " filter.") + "</div>")
          + (goneList.length ? "<div class='gonewarn'>⚠ Not in this year's course list, so you can't pick " + (goneList.length > 1 ? "them" : "it") + " now: "
             + esc(goneList.join(", ")) + ". " + (goneList.length > 1 ? "They" : "It") + " may be offered in another year — check with the department."
             + (tight ? " <b>Fewer options than usual for this requirement this year.</b>" : "") + "</div>" : "");
      });
      if ((m.enforced || []).length) h += "<div class='rules'><b>Rules for this major</b><div class='nt'>Fine print from the major's official page that changes how classes count. The planner applies these to your progress automatically.</div><ul>" + m.enforced.map(function (x) {
          return "<li>" + esc(x.text) + (r && r.applied[x.text] ? " <span class='appl'>applied to your plan</span>" : "") + "</li>"; }).join("") + "</ul></div>";
      if (m.rules) h += "<div class='nt'>" + esc(m.rules) + "</div>";
      h += "<div class='nt'>Source: <a target='_blank' rel='noopener' href='" + esc(m.source) + "'>official major page</a>" + (m.source_note ? " (" + esc(m.source_note) + ")" : "")
        + " · pulled " + esc(D.majorsPulled) + "</div></div>";
    });
    h += "</div>";
    var dbl = majorState().dbl;
    if (explored.length > 1) h += "<div class='watch" + (dbl > D.doubleCap ? " capwarn" : "") + "'>" + fmt(dbl) + " CU of your picks count toward two majors. Wharton caps this at 2.0 CU total.</div>";
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
    h += "<div class='chips'>" + [["all", "All"], ["rec", "Recommended for you"]].concat(explored.map(function (m) { return [m, MAJ_SHORT[m]]; })).concat(explored.length ? [["none", "Not in your majors"]] : []).map(function (f) {
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
    var heavy = S.recruitTerms || [];
    var h = "<h2 id='calendar'>Calendar</h2><p class='sub'>Suggested placements fill each semester to about 4.5 CU, schedule core first, keep recruiting terms lighter "
      + "and spread quant-heavy courses. Drag to try a class elsewhere — that doesn't lock it; click 🔓 when you're sure.</p>"
      + "<div class='startbanner'><b>Heads up:</b> this planner doesn't know which semester most classes actually run, so a suggested term may not match when a class is offered. The exception is Health Care Management classes, which follow the HCM department's published schedule. Check the course schedule in Course Match before you register.</div>";
    h += "<div class='cst'><span class='cst-l'>Recruiting in:</span>" + TERMS.filter(function (t) { return !/^Summer/.test(t); }).map(function (t) {
      return "<label><input type='checkbox' data-rec='" + esc(t) + "'" + (heavy.indexOf(t) >= 0 ? " checked" : "") + "> " + esc(t) + "</label>";
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
      + (offTerm(e.code, e.term) ? "<span class='offwarn' title='The department lists this class in " + esc(offered(e.code)[0]) + "'>⚠ usually " + esc(offered(e.code)[0]) + "</span> " : "")
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
      + "<p><b>Majors and their requirements</b> come from each department's official page, linked from Wharton's <a target='_blank' rel='noopener' href='" + esc(D.majorsMaster) + "'>MBA majors list</a>. "
      + "<b>Pulled " + esc(D.majorsPulled) + ".</b> Some listed courses aren't in this year's course list; requirements can change — confirm with your academic advisor.</p>"
      + "<details><summary>" + D.majors.length + " majors — source pages</summary><ul>" + D.majors.map(function (m) {
          return "<li><a target='_blank' rel='noopener' href='" + esc(m.source) + "'>" + esc(m.name) + "</a>" + (m.source_note ? " <span class='nt'>(" + esc(m.source_note) + ")</span>" : "") + "</li>"; }).join("") + "</ul></details>"
      + "<p class='sub'>Recommendations come from patterns learned from 132 sample student profiles — no AI runs while you use this, and nothing you enter leaves your browser.</p></section>";
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
    if (t.dataset.rec) {
      var r = (S.recruitTerms || []).filter(function (x) { return x !== t.dataset.rec; });
      if (t.checked) r.push(t.dataset.rec);
      S.recruitTerms = r; return commit();
    }
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
    countEvent("feedback-opened", "Feedback opened", false);
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
  window.__wcp = { offered: offered, S: S, addToPlan: addToPlan, removeFromPlan: removeFromPlan, schedule: schedule, resuggest: resuggest,
                   render: render, LABEL: LABEL, SCORE: SCORE, coreState: coreState, majorState: majorState };   // for tests
  if (localStorage.getItem("wcp.state") === null) placeNew();
  try { var st = JSON.parse(localStorage.getItem("wcp.state")); if (st && st.rescore) { delete S.rescore; } } catch (e) {}
  commit();
})();
