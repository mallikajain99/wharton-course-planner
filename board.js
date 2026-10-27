/* Wharton course planner — runs entirely in the browser; plans are saved in localStorage and never sent anywhere.
   Recommendations: per-answer weights learned from 100 AI-rated sample student profiles + a growth rule. No AI at run time. */
(function () {
  "use strict";
  var D = window.PLANNER_DATA;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  // U.S. date format everywhere on screen: 2026-10-27 → 10/27/2026
  var usDate = function (iso) { var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[2] + "/" + m[3] + "/" + m[1] : String(iso || ""); };
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
  //
  // STAT 6130 runs the full first fall, accelerated STAT 6210 is first-fall Q1.
  var FIRST_FALL_SLOT = { "BEPP 6110": "Q1", "BEPP 6120": "Q2", "STAT 6130": "Full", "STAT 6210": "Q1" };
  var FIXED_CORE = {};
  D.core.forEach(function (s) { if (/fixed/i.test(s.section)) s.areas.forEach(function (a) {
    a.options.forEach(function (o) { FIXED_CORE[canon(o.code)] = 1; }); }); });
  var DEPTH = { Skip: 0, Fluent: 1, Solid: 2, Deep: 3 }, KNOW = { None: 0, Some: 1, Working: 2, Expert: 3 };

  // ---------- majors (each from its official department page — see D.majors[].source) ----------
  var ALLM = {}; D.majors.forEach(function (m) { ALLM[m.name] = m; });
  var explored = (A.majors || []).filter(function (m) { return ALLM[m]; });
  var PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#9b59b6", "#c0392b", "#16a085", "#d4a017", "#5d6d7e"];
  var MAJ_COLOR = {}, MAJ_SHORT = {};
  explored.forEach(function (m, i) { MAJ_COLOR[m] = PALETTE[i % PALETTE.length]; MAJ_SHORT[m] = ALLM[m].short || m; });
  // "Any course in the department" = every class in its MBA course list; core is excluded by the callers unless the
  // major includes it. (Was 7000+ only — an assumption that dropped 6000-level electives like OIDD 6540 and MGMT 6910;
  // the major-rules audit caught it, Oct 27.)
  function upper(c, dept) { return codesOf(c).some(function (x) { return x.indexOf(dept + " ") === 0; }); }
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
    if (t.level === "Intro" || t.level === "Fluent") (t.xareas || []).forEach(function (area) {   // newer areas count as secondary
      if ((want[area] || 0) >= 1 && (want[area] || 0) > (know[area] || 0)) { v += D.growth * 0.5; grew = grew || area; }
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
  // Taken / in progress is the student's own choice on the calendar — never inferred from today's date
  function started(e) { return !!e && (e.status === "taken" || e.status === "inprogress"); }
  var TARGET = 4.5, RTARGET = 3.5, QCAP = 3, RQCAP = 2;   // recruiting terms aim lower
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
  var MISSING = D.missingInfo || {};
  function addToPlan(code, extra) {
    fresh();
    if (!BY[code] && BY[canon(code)]) code = canon(code);   // a cross-listed code → the class's main code
    if (S.plan[code]) return;
    if (!BY[code] && MISSING[code]) extra = Object.assign({ missing: true, title: MISSING[code].title || "", cu: MISSING[code].cu || 1 }, extra || {});
    countEvent("plan-started", "Plan started", true);
    S.plan[code] = Object.assign({ term: null, slot: null, locked: false, why: null }, extra || {});
    delete S.dec[code];
    S.changes += 1;
    placeNew();
  }
  function removeFromPlan(code) { fresh(); if (S.plan[code]) { delete S.plan[code]; S.changes += 1; } }

  function schedule(full) {
    var fixed = {}, todo = [];
    entries().forEach(function (e) {
      var pinned = (FIXED_CORE[e.code] || e.code === "MGMT 6100") && !e.locked && !started(e) && !(e.moved && !full);   // always re-placed by the first-year rule
      if (!pinned && ((e.term && started(e)) || e.locked || (!full && e.term))) fixed[e.code] = [e.term, e.slot || "Full"];
      else if (full || e.why !== "parked") todo.push(e);
    });
    var load = {};
    // flex core may also go in the first fall, after fixed core; other classes start with FUTURE
    var PLACEABLE = FUTURE.indexOf(TERMS[1]) < 0 ? [TERMS[1]].concat(FUTURE) : FUTURE;
    PLACEABLE.forEach(function (t) { load[t] = { cu: 0, q: 0, Q1: 0, Q2: 0 }; });
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
    var tier = function (c) { return FIXED_CORE[c] || c === "MGMT 6100" ? -1 : CORE_CODES[c] ? 0 : early[c] ? 1 : 2; };   // fixed core first, then flex
    var tgt = function (t) { return heavy.indexOf(t) >= 0 ? RTARGET : TARGET; };
    var room = function (t, cu) { return (load[t].cu + cu) / tgt(t); };   // share of the term's target used after adding this class
    var firstFall = TERMS[1], fq = { Q1: 0, Q2: 0 };
    todo.sort(function (a, b) {
      return tier(a.code) - tier(b.code) || (isQuant(b.code) - isQuant(a.code)) || (cuOf(b.code) - cuOf(a.code)) || (a.code < b.code ? -1 : 1);
    });
    var termOf = {}; Object.keys(fixed).forEach(function (c) { termOf[c] = fixed[c][0]; });
    var placed = {};
    todo.forEach(function (e) {
      var c = e.code, cu = cuOf(c);
      // MGMT 6100 is taken by everyone in the first summer, before school starts
      if (c === "MGMT 6100") { placed[c] = [TERMS[0], "Q1", "everyone takes this in the summer before the first fall"]; termOf[c] = TERMS[0]; return; }
      // Fixed core is taken in the first fall at Wharton — place it there even when that term has started
      if (FIXED_CORE[c]) {
        var fs = FIRST_FALL_SLOT[c] || ((cu >= 1 || FULLHALF[c]) ? "Full" : (fq.Q1 <= fq.Q2 ? "Q1" : "Q2")); if (fs !== "Full") fq[fs] += cu;
        add(firstFall, fs, cu, c);
        placed[c] = [firstFall, fs, "fixed core — taken in your first fall"]; termOf[c] = firstFall; return;
      }
      var SEQ = tier(c) === 0 ? PLACEABLE : FUTURE;
      var after = (D.prereqs[c] || []).map(function (p) { return SEQ.indexOf(termOf[p]); }).filter(function (i) { return i >= 0; });
      var start = after.length ? Math.max.apply(null, after) + 1 : 0;
      // …and before any already-placed class that needs it as a prerequisite (found by testing, Oct 27)
      var needers = Object.keys(D.prereqs).filter(function (k) { return D.prereqs[k].indexOf(c) >= 0 && SEQ.indexOf(termOf[k]) >= 0; });
      var before = needers.length ? Math.min.apply(null, needers.map(function (k) { return SEQ.indexOf(termOf[k]); })) : SEQ.length;
      var opts = SEQ.slice(start, Math.max(start + 1, before)); if (!opts.length) opts = SEQ.slice(-1);
      var off = offered(c), runs = off ? opts.filter(function (t) { return t.indexOf(off[0]) === 0; }) : [];
      if (off && off[2] === "year1") runs = runs.filter(function (t) { return t === TERMS[2]; });
      if (off && runs.length) opts = runs;   // only the semesters the department says it runs
      var core = tier(c) === 0;
      var spreadCore = /^No — spread/.test(A.frontload || "");   //
      var why = core ? (spreadCore ? "core requirement — spread across your semesters, as you asked" : "core requirement — scheduled as early as possible") : early[c] ? "needed early for your major" : "elective — placed to balance credits";
      var fits = function (t) { return !isQuant(c) || load[t].q < qcap(t); };
      // front-loaded core: earliest term with room; everything else: the term with the most room left against its target
      var order = (core && !spreadCore) ? opts.slice() : opts.slice().sort(function (x, y) {
        return (room(x, cu) - room(y, cu)) || (opts.indexOf(x) - opts.indexOf(y));
      });
      var pick = order.filter(function (t) { return load[t].cu + cu <= tgt(t) && fits(t); })[0];
      if (!pick) {
        var c2 = opts.filter(fits);
        pick = (c2.length ? c2 : opts).slice().sort(function (x, y) { return (room(x, cu) - room(y, cu)) || (opts.indexOf(x) - opts.indexOf(y)); })[0];
        why += c2.length ? "; every term is full — placed where there's the most room" : "; this term ends up quant-heavy";
      }
      if (heavy.indexOf(pick) >= 0) why += " · recruiting term (aims for 3.5 CU)";
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
  function savePlaced(p) { Object.keys(p).forEach(function (c) { var e = S.plan[c]; e.term = p[c][0]; e.slot = p[c][1]; e.why = p[c][2]; delete e.moved; }); }
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
  // Placement areas (Statistics): "Take" lists the full course only; the placement course appears under "Placement"
  function takeOptions(a) {
    var r = D.groupRules[a.name] || {};
    return r.placement && Array.isArray(r.subs) ? a.options.filter(function (o) { return r.subs.indexOf(o.code) < 0; }) : a.options;
  }
  // A class picked as a core substitute (or placement) counts toward core — not an elective
  // computed once per change, not once per lookup (testing found the double-count rule made big plans slow)
  var MEMO = {};
  function memo(k, fn) { if (!(k in MEMO)) MEMO[k] = fn(); return MEMO[k]; }
  function fresh() { MEMO = {}; }
  function coreSubs() { return memo("subs", coreSubs0); }
  function coreSubs0() {
    var out = {};
    D.core.forEach(function (sec) { sec.areas.forEach(function (a) {
      if (S.core[a.name] === "substituted") subOptions(a).forEach(function (k) { if (S.plan[k.code]) out[k.code] = a.name; }); }); });
    return out;
  }
  var FLEX_AREA = {};
  D.core.forEach(function (s) { if (!/fixed/i.test(s.section)) s.areas.forEach(function (a) { a.options.forEach(function (o) { FLEX_AREA[canon(o.code)] = a.name; }); }); });
  // Major & elective courses = everything outside core, plus flex classes that count toward a major being explored
  function inElectives(c) {
    if (coreSubs()[c] || FIXED_CORE[c]) return false;
    if (!CORE_CODES[c]) return true;   // D.required lists every core option (fixed and flex), so it can't tell them apart
    return !!FLEX_AREA[c] && majorsFor(c).length > 0;
  }
  //
  // Management class stayed on the calendar). Waived → its classes leave (only waive_only ones for a partial waiver);
  // Placement/Substituted → the "Take" classes leave; Take → placement/substitute classes leave. A class that also counts
  // toward a major being explored stays.
  function dropInapplicable(areaName) {
    D.core.forEach(function (sec) { sec.areas.forEach(function (a) {
      if (areaName && a.name !== areaName) return;
      var st = S.core[a.name], r = D.groupRules[a.name] || {}; if (!st) return;
      var takeC = takeOptions(a).map(function (o) { return canon(o.code); });
      var subC = st === "substituted" ? subOptions(a).map(function (k) { return k.code; }) : [];
      var drop = st === "waived" ? (r.waive_only ? r.waive_only.map(canon) : a.options.map(function (o) { return canon(o.code); }))
        : st === "substituted" ? takeC.filter(function (c) { return subC.indexOf(c) < 0; })
        : (r.placement && Array.isArray(r.subs) ? r.subs.map(canon) : []);
      drop.forEach(function (c) { if (S.plan[c] && !majorsFor(c).length) { delete S.plan[c]; S.changes += 1; } });
    }); });
    fresh();
  }
  function countsAsCore(c) { return !!CORE_CODES[c] || !!coreSubs()[c]; }
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
        var st = S.core[a.name], an = areaNeed(a), wo = (D.groupRules[a.name] || {}).waive_only;
        if (st === "waived" && !wo) { waived += an; return; }
        if (st === "waived" && wo) {   // e.g. Microeconomics: BEPP 6110 waived, BEPP 6120 still required
          var wcu = a.options.filter(function (o) { return wo.indexOf(o.code) >= 0; }).reduce(function (t, o) { return t + o.cu; }, 0);
          waived += wcu; an = an - wcu; need += an;
          var rest = a.options.map(function (o) { return canon(o.code); }).filter(function (c) { return wo.indexOf(c) < 0 && S.plan[c]; });
          var t2 = 0, p2 = 0; rest.forEach(function (c) { var cu = cuOf(c); if (started(S.plan[c])) t2 += cu; else p2 += cu; });
          t2 = Math.min(t2, an); p2 = Math.min(p2, an - t2); t += t2; p += p2; if (t2 + p2 < an) open.push(a.name); return;
        }
        need += an;
        var opts = st === "substituted" ? subOptions(a).map(function (c) { return c.code; }) : takeOptions(a).map(function (o) { return canon(o.code); });
        var picked = opts.filter(function (c) { return S.plan[c] && !usedForMajor(c); });
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
  //
  // Differences, Management): S.use[c] = "major" means it counts for the major and not toward the OIDD flex core.
  function noFlexMajors(c) { return explored.filter(function (n) { return (ALLM[n].enforced || []).some(function (r) { return r.type === "not_with_flex" && listed(c, r.codes); }); }); }
  function usedForMajor(c) { return (S.use || {})[c] === "major" && noFlexMajors(c).length > 0; }
  function flexUsed() {
    var out = {}, have = 0, st = S.core["Operations, Information & Decisions"];
    if (st === "waived" || st === "substituted") return out;
    D.core.forEach(function (s) { s.areas.forEach(function (a) {
      if (a.name !== "Operations, Information & Decisions") return;
      a.options.map(function (o) { return canon(o.code); })
        .sort(function (x, y) { return ((S.use || {})[y] === "flex") - ((S.use || {})[x] === "flex"); })
        .forEach(function (c) { if (S.plan[c] && !usedForMajor(c) && have < 1.0) { out[c] = 1; have += cuOf(c); } });
    }); });
    return out;
  }
  // Double-counting: a class counts toward every major that lists it, at most two majors, and
  // at most 2.0 CU of double-counted classes in total. Over that, unset classes are trimmed one major at a time — first
  // where it costs no major any credit, else from the major that's fullest without it. A student's own choice
  // (S.count) always wins, even over the cap — then the warning turns red.
  function assignment() { return memo("asg", assignment0); }
  function assignment0() {
    var set = {}, manual = {}, trimmed = {};
    Object.keys(S.plan).forEach(function (c) {
      if (S.plan[c].own || FIXED_CORE[c] || coreSubs()[c]) return;
      var el = explored.filter(function (n) { return ALLM[n] && ALLM[n].total && eligible(c, ALLM[n]); });
      if (!el.length) return;
      if (S.count && S.count[c]) { manual[c] = 1; set[c] = el.filter(function (n) { return S.count[c].indexOf(n) >= 0; }); }
      else set[c] = el.slice();
    });
    var have = function (n) { return Object.keys(set).reduce(function (t, c) { return t + (set[c].indexOf(n) >= 0 ? cuOf(c) : 0); }, 0); };
    var dbl = function () { return Object.keys(set).reduce(function (t, c) { return t + (set[c].length > 1 ? cuOf(c) : 0); }, 0); };
    var trim = function (c, n) { set[c] = set[c].filter(function (x) { return x !== n; }); (trimmed[c] = trimmed[c] || []).push(n); };
    var best = function (cands) {
      var opts = [];
      cands.forEach(function (c) { set[c].forEach(function (n) {
        if (reqOf(ALLM[n]).indexOf(c) >= 0) return;                 // never trim a class from the major that requires it
        var left = have(n) - cuOf(c), total = ALLM[n].total;
        opts.push({ c: c, n: n, free: left >= total - 1e-9, full: left / total });
      }); });
      opts.sort(function (a, b) { return (b.free - a.free) || (b.full - a.full) || (a.c < b.c ? -1 : 1); });
      return opts[0];
    };
    var guard = 0;
    while (guard++ < 200) {   // at most two majors per class
      var three = Object.keys(set).filter(function (c) { return !manual[c] && set[c].length > 2; });
      if (!three.length) break;
      var o = best(three); if (!o) break; trim(o.c, o.n);
    }
    while (guard++ < 400 && dbl() > D.doubleCap + 1e-9) {   // at most 2.0 CU double-counted
      var o2 = best(Object.keys(set).filter(function (c) { return !manual[c] && set[c].length > 1; }));
      if (!o2) break; trim(o2.c, o2.n);
    }
    return { set: set, manual: manual, trimmed: trimmed };
  }
  function countsFor(c, n) { var a = assignment(); return !a.set[c] || a.set[c].indexOf(n) >= 0; }
  // "Also requires" conditions (no credit): met by any listed class in the plan, or by waiving the named core area
  function checkMet(k) { return (k.area && S.core[k.area] === "waived") || (k.codes || []).some(function (c) { return !!S.plan[canon(c)]; }); }
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
      if (S.plan[c] && countsFor(c, m.name)) { add(c, cuOf(c)); used[c] = 1; } else open.push(c); });
    if (m.core_one_of) {
      reqNeed += 0.5;
      var co = Object.keys(S.plan).filter(function (c) { return listed(c, m.core_one_of); });
      if (co.length) { add(co[0], cuOf(co[0])); used[co[0]] = 1; } else open.push(m.core_one_of.join(" or "));
    }
    var need = Math.max(0, (m.total || 0) - reqNeed), et = 0, ep = 0;
    (m.groups || []).slice().sort(function (a, b) { return (b.min ? 1 : 0) - (a.min ? 1 : 0); }).forEach(function (g) {
      var gt = 0, gp = 0, cap = g.max != null ? g.max : 99, picked = [];
      Object.keys(S.plan).forEach(function (c) {
        if (used[c] || S.plan[c].own || !inGroup(c, g) || !countsFor(c, m.name)) return;
        if (CORE_CODES[c] && !listed(c, g.codes) && (!g.include_core || FIXED_CORE[c])) return;   // core counts only where a major says so; fixed core never via a department rule
        var cu = countAs(c); if (gt + gp + cu > cap + 1e-9 || blocked(c, cu)) return;
        used[c] = 1; picked.push(c);
        if (started(S.plan[c])) gt += cu; else gp += cu;
      });
      groups.push({ g: g, have: gt + gp, taken: gt, picked: picked });
      if (g.min && gt + gp < g.min) open.push(g.label);
    });
    // Each section counts up to its minimum; extra only counts if the major has room beyond the sum of the minimums
    //
    var mins = groups.reduce(function (t, x) { return t + (x.g.min || 0); }, 0), slack = Math.max(0, need - mins);
    var base = 0, extra = 0, taken = 0;
    groups.forEach(function (x) {
      if (x.g.min) { base += Math.min(x.have, x.g.min); extra += Math.max(0, x.have - x.g.min); } else extra += x.have;
      taken += x.taken;
    });
    var credited = Math.min(need, base + Math.min(slack, extra));
    groups.forEach(function (x) { x.over = x.g.min ? Math.max(0, x.have - x.g.min) : 0; });
    var unused = Math.max(0, base + extra - credited);
    et = Math.min(taken, credited); ep = credited - et;
    var out_unused = unused;
    (m.checks || []).forEach(function (k) { if (!checkMet(k)) open.push(k.label); });
    return { t: t + et, p: p + ep, need: m.total, open: open, groups: groups, counted: used, applied: applied, unused: out_unused, slack: slack };
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
  var ui = { filter: "all", q: "", noOpen: true, maybeMore: 60, showAll: {} };   // No column open by default
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
    var h = "<h2>Core requirements</h2><div class='startbanner'><b>Start here.</b> For each area, choose how you're meeting it — "
      + "<b>Take</b>, <b>Waived</b>, <b>Placement</b> or <b>Substituted</b> (where allowed) — then tick the classes you've taken, are taking, or plan to take. Areas stay unanswered until you choose.</div>";
    var short = ["FNCE 6210", "FNCE 6230"].filter(function (c) { return S.plan[c]; });
    if (short.length === 2) h += "<div class='watch capwarn'>Wharton doesn't allow using both FNCE 6210 and FNCE 6230 for the flexible core — take the full version of one.</div>";
    if (short.length && (explored.indexOf("Finance") >= 0 || explored.indexOf("Quantitative Finance") >= 0))
      h += "<div class='watch capwarn'>Finance majors can't take FNCE 6210 or FNCE 6230 — you're exploring a Finance major.</div>";
    D.core.forEach(function (sec) {
      h += "<div class='sect'>" + esc(sec.section) + "</div><div class='grid'>";
      sec.areas.forEach(function (a) {
        var st = S.core[a.name], r = D.groupRules[a.name] || {};
        // waived is blocked only where a source says it can't be waived; undocumented areas stay clickable with a caution
        var can = { take: true, waived: r.waive !== false, substituted: !!r.subs };
        var opts = st === "substituted" ? subOptions(a).map(function (c) { return { code: c.code, title: c.title, cu: c.cu, note: "" }; }) : takeOptions(a).map(function (o) { return Object.assign({}, o, { code: canon(o.code) }); });
        var counts = function (o) { return S.plan[o.code] && !usedForMajor(o.code); };   // a class switched to a major doesn't cover flex
        var have = opts.filter(counts).reduce(function (s, o) { return s + o.cu; }, 0);
        var picked = opts.filter(counts).length;
        var status, met;
        if (!st) { status = "choose: " + ["Take"].concat(can.waived ? ["Waived"] : [], can.substituted ? [r.placement ? "Placement" : "Substituted"] : []).join(" · "); met = false; }
        else if (st === "waived" && r.waive_only) {   // partial waiver: the rest is still required
          var restOpts = opts.filter(function (o) { return r.waive_only.indexOf(o.code) < 0; });
          met = restOpts.every(function (o) { return S.plan[o.code]; });
          status = met ? "✓ covered (" + r.waive_only.join(", ") + " waived)" : r.waive_only.join(", ") + " waived · still need " + restOpts.filter(function (o) { return !S.plan[o.code]; }).map(function (o) { return o.code; }).join(", ");
        }
        else if (st === "waived") { status = "✓ waived"; met = true; }
        else if (st === "substituted") { met = picked > 0; status = met ? (r.placement ? "✓ placed" : "✓ substituted") : (r.placement ? "tick the placement class" : "pick a substitute"); }
        else { var an = areaNeed(a); met = have >= an && (an > 0 || picked > 0); status = met ? "✓ covered" : (an ? fmt(have) + " of " + fmt(an) + " CU" : "not selected");
               if (a.rule === "pick one" && picked > 1) { status = "⚠ " + picked + " selected — pick one"; met = false; } }
        h += "<div class='cg" + (met ? " met" : "") + (st ? "" : " unanswered") + "'><div class='gh'><span class='gn'>" + esc(a.name) + "</span><span class='gs'>" + esc(a.rule) + " · " + esc(status) + "</span></div>";
        h += "<div class='cst'><span class='cst-l'>Status:</span>" + [["take", "Take"], ["waived", "Waived"], ["substituted", r.placement ? "Placement" : "Substituted"]].map(function (v) {
          return "<label class='" + (can[v[0]] ? "" : "dis") + "'" + (can[v[0]] ? "" : " title='" + (v[0] === "waived" ? "This area can't be waived" : "No substitution is documented for this area") + "'") + "><input type='radio' name='cs-" + esc(a.name) + "' data-core='" + esc(a.name) + "' value='" + v[0] + "'" + (st === v[0] ? " checked" : "") + (can[v[0]] ? "" : " disabled") + "> " + v[1] + "</label>";
        }).join("") + "</div>";
        if (r.note) h += "<div class='nt'>" + esc(r.note) + "</div>";
        if (r.waive == null && st === "waived") h += "<div class='nt'>Waiver rules for this area aren't loaded here — confirm on MBA Inside before relying on it.</div>";
        h += "<div class='" + (st === "waived" && !r.waive_only ? "waivedlist" : st === "substituted" ? "subs" : "") + "'>";
        opts.forEach(function (o) {
          var on = !!S.plan[o.code], um = on && usedForMajor(o.code);
          var gone = st === "waived" && (!r.waive_only || r.waive_only.indexOf(o.code) >= 0);   // waived classes can't be ticked
          h += "<label class='opt" + (gone && r.waive_only ? " waivedone" : "") + "'>" + (gone ? "" : "<input type='checkbox' data-pick='" + esc(o.code) + "'" + (on ? " checked" : "") + ">")
            + "<span><b>" + esc(o.code) + "</b> " + esc(o.title) + " · " + fmt(o.cu) + " CU" + (o.note ? "<span class='nt'>" + esc(o.note) + "</span>" : "") + "</span></label>"
            + (um ? "<div class='usenote'>Counting for " + esc(noFlexMajors(o.code).map(function (m) { return MAJ_SHORT[m]; }).join(" + ")) + " — not this flex requirement. <button class='usebtn' data-use='" + esc(o.code + "||flex") + "'>Use for flex core instead</button></div>" : "");
        });
        h += "</div></div>";
      });
      h += "</div>";
    });
    return h;
  }
  function majorsView() {
    var h = "<h2>Majors you're exploring</h2><p class='sub'>Add or drop majors any time — your picked classes stay in your plan either way.</p>";
    var others = D.majors.filter(function (m) { return explored.indexOf(m.name) < 0; });
    if (others.length) h += "<div class='addm'><select id='addmaj' class='ownin'><option value=''>Add a major…</option>"
      + others.map(function (m) { return "<option value='" + esc(m.name) + "'>" + esc(m.name) + "</option>"; }).join("") + "</select>"
      + "<button class='pri' data-addmajor='__select'>Add</button></div>";
    h += dblPanel();
    // "Not sure — suggest some for me" (and no majors picked): rank majors by how many of the student's recommended classes count toward them
    var notSure = (A.majors || []).some(function (x) { return /^Not sure/.test(x); });
    if (notSure || !explored.length) {
      var sug = D.majors.filter(function (m) { return explored.indexOf(m.name) < 0 && m.total; }).map(function (m) {
        var hits = Object.keys(LABEL).filter(function (c) { return LABEL[c] && BY[c] && eligible(c, m); });
        var pts = hits.reduce(function (t, c) { return t + (LABEL[c] === "Best fit" ? 2 : 1); }, 0);
        return { m: m, hits: hits.sort(function (a, b) { return SCORE[b] - SCORE[a]; }), pts: pts };
      }).filter(function (x) { return x.pts > 0; }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, 3);
      h += "<div class='startbanner'><b>Suggested majors for you.</b> Ranked by how many of your Best fit and Good fit classes count toward each one. "
        + "Click <b>Explore</b> to track a major here — you can add or drop majors any time.</div><div class='grid sugm'>";
      sug.forEach(function (x) {
        var nb = x.hits.filter(function (c) { return LABEL[c] === "Best fit"; }).length;
        h += "<div class='cg'><div class='gh'><span class='gn'>" + esc(x.m.name) + "</span><span class='gs'>" + fmt(x.m.total) + " CU major</span></div>"
          + "<div class='nt'>" + x.hits.length + " of your recommended classes count toward it (" + nb + " Best fit), for example:</div><ul class='sugl'>"
          + x.hits.slice(0, 3).map(function (c) { return "<li><b>" + esc(c) + "</b> " + esc(BY[c].title) + "</li>"; }).join("") + "</ul>"
          + (x.m.apply_note ? "<div class='nt'>" + esc(x.m.apply_note) + "</div>" : "")
          + "<button class='pri' data-addmajor='" + esc(x.m.name) + "'>Explore this major</button></div>";
      });
      if (!sug.length) h += "<p class='sub'>None of your recommended classes line up with a major yet — try adding more interests in the survey.</p>";
      h += "</div>";
    }
    explored.forEach(function (a) { (ALLM[a].exclusive || []).forEach(function (b) {
      if (explored.indexOf(b) >= 0 && a < b) h += "<div class='watch capwarn'>Wharton doesn't allow " + esc(a) + " together with " + esc(b) + " — you can explore both, but only declare one.</div>"; }); });
    h += "<div class='grid'>";
    explored.forEach(function (n) {
      var m = ALLM[n], r = m.total ? majorProgress(m) : null;
      h += "<div class='cg' data-major='" + esc(n) + "'><div class='gh'><span class='gn'>" + esc(n) + (m.stem ? " <span class='nt'>STEM</span>" : "") + "</span><span class='gs'>"
        + (r ? fmt(r.t + r.p) + " of " + fmt(m.total) + " CU" : "self-designed — not tracked") + "</span></div>"
        + "<button class='dropm' data-dropmajor='" + esc(n) + "' title='Your classes stay in your plan'>Remove major</button>";
      if (m.apply_note) h += "<div class='startbanner'>" + esc(m.apply_note) + "</div>";
      if (m.prereq_note) h += "<div class='nt'>" + esc(m.prereq_note) + "</div>";
      //
      var optRow = function (c, note) {
        var k = BY[c], lab = LABEL[c], mi = MISSING[c];
        if (!k) return "<label class='opt'><input type='checkbox' data-pick='" + esc(c) + "'" + (S.plan[c] ? " checked" : "") + "><span><b>" + esc(c) + "</b> "
          + esc(mi && mi.title ? mi.title : "") + " · " + (mi && mi.cu ? fmt(mi.cu) + " CU" : "CU not listed — counted as 1") + " <span class='offwarn'>⚠ Not in this year's course list — double-check this class is being offered</span></span></label>";
        var no = !S.plan[c] && S.dec[c] === "no", ct = countToggle(c);
        if (S.plan[c] && noFlexMajors(c).indexOf(n) >= 0 && flexUsed()[c])
          ct = "<div class='usenote'>Selected for flex core requirement — not counting toward " + esc(MAJ_SHORT[n]) + ". <button class='usebtn' data-use='" + esc(c + "||major") + "'>Count for " + esc(MAJ_SHORT[n]) + " instead</button></div>" + ct;
        return "<label class='opt" + (no ? " ruled" : "") + "'><input type='checkbox' data-pick='" + esc(c) + "'" + (S.plan[c] ? " checked" : "") + "><span><b>" + esc(c) + "</b> "
          + esc(k.title) + " · " + fmt(k.cu) + " CU" + (no ? " <span class='nt'>ruled out — tick to add it back</span>" : "") + (lab ? " <span class='fit " + (lab === "Best fit" ? "best" : "poss") + "'>" + lab + "</span>" : "")
          + (note ? " <span class='nt'>" + note + "</span>" : "") + "</span></label>" + ct;
      };
      var req = reqOf(m), reqHave = req.filter(function (c) { return S.plan[c]; }).reduce(function (t, c) { return t + cuOf(c); }, 0);
      h += "<div class='pill'><span>Required</span><span>" + (req.length ? fmt(reqHave) + " of " + fmt(req.reduce(function (t, c) { return t + (BY[c] ? BY[c].cu : 0); }, 0)) + " CU" + (reqHave && req.every(function (c) { return S.plan[c]; }) ? " ✓" : "") : "") + "</span></div>";
      h += req.length ? req.map(function (c) { return optRow(c, ""); }).join("") : "<div class='nt'>None.</div>";
      if (m.core_one_of) h += "<div class='nt'>Plus one of " + esc(m.core_one_of.join(" / ")) + " (core).</div>";
      if ((m.checks || []).length) h += "<div class='pill'><span>Also requires</span><span>no extra credit</span></div>" + m.checks.map(function (k) {
          var ok = checkMet(k);
          return "<div class='chk " + (ok ? "ok" : "no") + "'>" + (ok ? "✓ " : "⚠ ") + esc(k.label) + (ok ? "" : " — not in your plan yet") + "</div>"; }).join("");
      (r ? r.groups : (m.groups || []).map(function (g) { return { g: g, have: 0, picked: [] }; })).forEach(function (x, gi) {
        var g = x.g, goal = g.min ? fmt(x.have) + " of " + fmt(g.min) + " CU" + (x.have >= g.min ? " ✓" : "") : fmt(x.have) + " CU (up to " + fmt(g.max != null ? g.max : m.total) + ")";
        //
        var goneList = g.codes ? g.codes.filter(function (c) { return (m.notOffered || []).indexOf(c) >= 0; }) : [];
        var availCU = g.codes ? g.codes.filter(function (c) { return BY[canon(c)] && (m.notOffered || []).indexOf(c) < 0; })
                                       .map(canon).filter(function (c, i, a) { return a.indexOf(c) === i; }).reduce(function (s, c) { return s + BY[c].cu; }, 0) : 99;
        var tight = g.min && availCU < 2 * g.min;
        var cands = Object.keys(BY).filter(function (c) { return inGroup(c, g) && req.indexOf(c) < 0
            && (!CORE_CODES[c] || listed(c, g.codes) || (g.include_core && !FIXED_CORE[c])); })   //
          .concat((g.codes || []).filter(function (c) { return !BY[canon(c)] && req.indexOf(c) < 0; }))   // listed by the major, not offered this year
          // order: picked → still in Maybe (best match first, not-offered after) → ruled out last
          .map(function (c, i) { return [c, i]; })
          .sort(function (x, y) {
            var rank = function (c) { return S.plan[c] ? 0 : S.dec[c] === "no" ? 3 : BY[c] ? 1 : 2; };
            return (rank(x[0]) - rank(y[0])) || ((SCORE[y[0]] || -99) - (SCORE[x[0]] || -99)) || (x[1] - y[1]);
          }).map(function (x) { return x[0]; });
        var key = n + "|" + gi, all = ui.showAll[key], shown = all ? cands : cands.slice(0, 8);
        var label = /elective/i.test(g.label) ? g.label : "Electives · " + g.label;
        var overNote = r && x.over > 0 && r.unused > 1e-9 ? "<div class='overnote'>" + fmt(x.over) + " CU over this section's minimum — " + (r.slack > 0 ? "only " + fmt(r.slack) + " CU of extra credit can count toward the major" : "extra here doesn't count toward the " + fmt(m.total) + " CU major") + ".</div>" : "";
        h += "<div class='pill'><span>" + esc(label) + "</span><span>" + goal + "</span></div>" + overNote
          + (g.dept ? "<div class='nt'>Any upper-level " + esc(g.dept) + " course counts — " + cands.length + " in this year's list, best matches for you first.</div>" : "")
          + shown.map(function (c) { return optRow(c, ""); }).join("")
          + (cands.length > 8 ? "<button class='seemore' data-showall='" + esc(key) + "'>" + (all ? "Show fewer" : "Show all " + cands.length) + "</button>" : "")
          + (!cands.length ? "<div class='nt'>No classes for this in this year's course list.</div>" : "")
          + (tight ? "<div class='gonewarn'>Fewer options than usual for this requirement in this year's course list.</div>" : "");
      });
      if ((m.enforced || []).length) h += "<div class='rules'><b>Rules for this major</b><div class='nt'>Fine print from the major's official page that changes how classes count. The planner applies these to your progress automatically.</div><ul>" + m.enforced.map(function (x) {
          return "<li>" + esc(x.text) + (r && r.applied[x.text] ? " <span class='appl'>applied to your plan</span>" : "") + "</li>"; }).join("") + "</ul></div>";
      if (m.rules) h += "<div class='nt'>" + esc(m.rules) + "</div>";
      h += "<div class='nt'>Source: <a target='_blank' rel='noopener' href='" + esc(m.source) + "'>official major page</a>" + (m.source_note ? " (" + esc(m.source_note) + ")" : "")
        + " · pulled " + esc(usDate(D.majorsPulled)) + "</div></div>";
    });
    h += "</div>";
    var dbl = majorState().dbl;
    if (explored.length > 1) h += "<div class='watch" + (dbl > D.doubleCap ? " capwarn" : "") + "'>" + fmt(dbl) + " CU of your picks count toward two majors. Wharton caps this at 2.0 CU total.</div>";
    return h;
  }
  function majorTags(c) {
    var a = S.plan[c] ? assignment() : null, el = majorsFor(c);
    return (a && a.set[c] && a.set[c].length > 1 ? "<span class='twice' title='Counts toward two majors — uses " + fmt(cuOf(c)) + " of your 2.0 CU double-count limit'>×2 counts twice</span>" : "") + el.map(function (m) {
      var flexOnly = S.plan[c] && flexUsed()[c] && noFlexMajors(c).indexOf(m) >= 0;   // doing flex duty, so not this major
      var off = flexOnly || (a && a.set[c] && a.set[c].indexOf(m) < 0);
      return "<span class='tag mj" + (off ? " off" : "") + "' style='--c:" + MAJ_COLOR[m] + "'" + (off ? " title='Not counting toward " + esc(MAJ_SHORT[m]) + (flexOnly ? " — selected for your flex core requirement" : a.manual[c] ? " — your choice" : " — keeps you within Wharton's double-count limits") + "'" : "") + "><i></i>" + esc(MAJ_SHORT[m]) + "</span>";
    }).join("");
  }
  // ---- double-counting prompts: so a good double count isn't missed and none happens by accident
  function dblMajors(c) { return majorsFor(c).filter(function (m) { return ALLM[m] && ALLM[m].total; }); }
  function isDouble(c) { var a = assignment(); return !!(a.set[c] && a.set[c].length > 1); }
  function dblUsed(except) { var a = assignment(); return Object.keys(a.set).reduce(function (t, k) { return t + (k !== except && a.set[k].length > 1 ? cuOf(k) : 0); }, 0); }
  function couldDouble() {   // picked classes that fit 2+ majors but count toward only one
    var a = assignment();
    return Object.keys(a.set).filter(function (k) { return a.set[k].length < 2 && dblMajors(k).length > 1; });
  }
  function promptOff() { try { return localStorage.getItem("wcp.noDoublePrompt") === "1"; } catch (e) { return false; } }
  function askDouble(c) {
    var el = dblMajors(c); if (el.length < 2 || promptOff() || !S.plan[c]) return;
    var used = dblUsed(c), cu = cuOf(c), fits = used + cu <= D.doubleCap + 1e-9, cur = assignment().set[c] || [];
    var o = document.createElement("div"); o.className = "pop-o";
    var pairs = el.length === 2 ? [el] : el.map(function (x, i) { return el.slice(i + 1).map(function (y) { return [x, y]; }); }).reduce(function (a, b) { return a.concat(b); }, []);
    o.innerHTML = "<div class='pop wide dblpop'><b>" + esc(c) + " can count toward " + el.map(function (m) { return esc(MAJ_SHORT[m]); }).join(" and ") + "</b>"
      + "<p>Wharton lets a class count toward up to two majors, with at most 2.0 CU of double-counted classes in total. You're using <strong>" + fmt(used) + " of 2.0 CU</strong>"
      + (fits ? " — counting this one twice would bring you to " + fmt(used + cu) + "." : ".</p><p class='warnr'>⚠ Counting this " + fmt(cu) + " CU class twice would put you at " + fmt(used + cu) + " of 2.0 CU — over Wharton's limit. Pick one major, or stop double-counting another class on the Majors page first.") + "</p>"
      + "<div class='row'>" + pairs.map(function (pr) { return "<button class='pri' data-dbl='" + esc(c + "||" + pr.join("|")) + "'" + (fits ? "" : " disabled") + ">Count toward both " + esc(MAJ_SHORT[pr[0]]) + " + " + esc(MAJ_SHORT[pr[1]]) + "</button>"; }).join("")
      + el.map(function (m) { return "<button data-dbl='" + esc(c + "||" + m) + "'>Only " + esc(MAJ_SHORT[m]) + "</button>"; }).join("")
      + "<button data-cancel='1'>Decide later</button></div>"
      + "<p class='nt'>Now counting toward: " + (cur.length ? cur.map(function (m) { return esc(MAJ_SHORT[m]); }).join(" + ") : "none") + ". You can change this any time on the Majors page.</p></div>";
    o.onclick = function (ev) {
      var t = ev.target.closest && ev.target.closest("[data-dbl],[data-cancel]");
      if (ev.target === o || (t && t.dataset.cancel)) return o.remove();
      if (t && t.dataset.dbl && !t.disabled) { var p2 = t.dataset.dbl.split("||"); S.count = S.count || {}; S.count[p2[0]] = p2[1].split("|"); o.remove(); commit(); }
    };
    document.body.appendChild(o);
  }
  function freedDouble(c) {
    var cands = couldDouble(); if (!cands.length || promptOff()) return;
    var used = dblUsed(), room = D.doubleCap - used;
    var fit = cands.filter(function (k) { return cuOf(k) <= room + 1e-9; }); if (!fit.length) return;
    var o = document.createElement("div"); o.className = "pop-o";
    o.innerHTML = "<div class='pop wide dblpop'><b>You freed up double-counting room</b><p>" + esc(c) + " was counting toward two majors. You're now using <strong>" + fmt(used) + " of 2.0 CU</strong>. "
      + "These classes in your plan could count twice instead:</p>"
      + fit.map(function (k) { var el = dblMajors(k); return "<div class='dblrow'><span><strong>" + esc(k) + "</strong> " + esc(BY[k] ? BY[k].title : "") + " · " + fmt(cuOf(k)) + " CU</span>"
          + "<button class='pri' data-dbl='" + esc(k + "||" + el.slice(0, 2).join("|")) + "'>Count toward " + esc(el.slice(0, 2).map(function (m) { return MAJ_SHORT[m]; }).join(" + ")) + "</button></div>"; }).join("")
      + "<div class='row'><button data-cancel='1'>Not now</button></div></div>";
    o.onclick = function (ev) {
      var t = ev.target.closest && ev.target.closest("[data-dbl],[data-cancel]");
      if (ev.target === o || (t && t.dataset.cancel)) return o.remove();
      if (t && t.dataset.dbl) { var p2 = t.dataset.dbl.split("||"); S.count = S.count || {}; S.count[p2[0]] = p2[1].split("|"); o.remove(); commit(); }
    };
    document.body.appendChild(o);
  }
  function dblPanel() {
    if (explored.filter(function (n) { return ALLM[n] && ALLM[n].total; }).length < 2) return "";
    var a = assignment(), used = dblUsed(), twice = Object.keys(a.set).filter(function (k) { return a.set[k].length > 1; }), could = couldDouble();
    var cls = used > D.doubleCap + 1e-9 ? " over" : used >= D.doubleCap - 1e-9 ? " full" : "";
    return "<div class='dblpanel" + cls + "'><div class='dbh'><b>Double-counting</b><span>" + fmt(used) + " of 2.0 CU used</span></div>"
      + "<div class='sbar'><span class='st' style='width:" + Math.min(100, 50 * used) + "%'></span></div>"
      + "<div class='nt'>A class can count toward up to two majors; Wharton allows 2.0 CU of these in total. Change any class with its <b>Counts toward</b> buttons below.</div>"
      + (twice.length ? "<div class='dbl-l'><b>Counting twice:</b> " + twice.map(function (k) { return esc(k) + " (" + esc(a.set[k].map(function (m) { return MAJ_SHORT[m]; }).join(" + ")) + ", " + fmt(cuOf(k)) + " CU)"; }).join(" · ") + "</div>" : "<div class='dbl-l'>No classes are counting twice yet.</div>")
      + (could.length ? "<div class='dbl-l'><b>Could count twice:</b> " + could.map(function (k) { return esc(k) + " (" + esc(dblMajors(k).map(function (m) { return MAJ_SHORT[m]; }).join(" / ")) + ")"; }).join(" · ")
          + (used + Math.min.apply(null, could.map(cuOf)) <= D.doubleCap + 1e-9 ? " — you have room for more." : " — no room left under the 2.0 CU limit.") + "</div>" : "")
      + (used > D.doubleCap + 1e-9 ? "<div class='warnr'>⚠ Over Wharton's 2.0 CU limit — set one of these classes to count toward a single major.</div>" : "")
      + "</div>";
  }
  function countToggle(c) {
    if (!S.plan[c]) return "";
    var a = assignment(), el = majorsFor(c).filter(function (m) { return ALLM[m] && ALLM[m].total; });
    if (el.length < 2 || !a.set[c]) return "";
    var on = a.set[c], man = !!a.manual[c];
    return "<div class='cnt'><span class='cst-l'>Counts toward:</span>" + el.map(function (m) {
        return "<button class='cntb" + (on.indexOf(m) >= 0 ? " on" : "") + "' data-countfor='" + esc(c + "||" + m) + "'>" + (on.indexOf(m) >= 0 ? "✓ " : "") + esc(MAJ_SHORT[m]) + "</button>"; }).join("")
      + (man ? "<button class='cntauto' data-countauto='" + esc(c) + "'>Back to automatic</button>" : "")
      + (!man && (a.trimmed[c] || []).length ? "<div class='nt'>Counting toward " + esc(on.map(function (m) { return MAJ_SHORT[m]; }).join(" + ")) + " only — keeps you within Wharton's limit (2.0 CU double-counted, two majors per class). Click a major to change it.</div>" : "")
      + (on.length > 2 ? "<div class='nt warnr'>⚠ A class can count toward at most two majors.</div>" : "")
      + "</div>";
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
    if (FLEX_AREA[c]) h += "<div class='nt flexnote'>Also fills your " + esc(FLEX_AREA[c]) + " flex core</div>";
    h += "<div class='meta'><span class='cu'>" + fmt(k.cu) + " CU</span>" + (k.quant ? "<span class='cu' title='quant-heavy course'>∑</span>" : "")
      + majorTags(c) + "</div>";
    if (k.summary) h += "<div class='sum'>" + esc(k.summary) + "</div>";
    if (lab && WHY[c] && WHY[c].length) h += "<div class='why'>Why: " + esc(WHY[c].join("; ")) + ".</div>";
    return h + "</div>";
  }
  function electivesView() {
    var subs = coreSubs(), all = Object.keys(BY).filter(inElectives);
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
    var h = "<h2>Major & elective courses</h2><p class='sub'><b>This is the complete list of every Wharton class outside core and flex core</b> — "
      + (explored.length ? "use the buttons below to narrow it: one per major you're exploring, or <b>All other Wharton electives</b> for every class that doesn't count toward your core, flex core or majors. " : "")
      + "Classes that count toward a major are tagged with its name. "
      + (Object.keys(subs).length ? "Classes you're using as a core substitute are counted under Core instead. " : "")
      + "Everything starts in <b>Maybe</b>, sorted by how well it matches your answers. "
      + nRec + " classes are labeled <b>Best fit</b> or <b>Good fit</b>; the rest are unlabeled, not ruled out. ✓ adds a class to your plan and calendar, ✕ moves it to No.</p>";
    h += "<div class='chips'>" + [["all", "All"]].concat(explored.map(function (m) { return [m, MAJ_SHORT[m]]; })).concat(explored.length ? [["none", "All other Wharton electives"]] : []).map(function (f) {
      return "<button class='chip" + (ui.filter === f[0] ? " on" : "") + "' data-filter='" + esc(f[0]) + "'>" + esc(f[1]) + "</button>";
    }).join("") + "<input id='q' class='search' placeholder='Search classes' value='" + esc(ui.q) + "'></div>";
    var own = entries().filter(function (e) { return e.own; });
    h += "<div class='board'>";
    h += "<div class='col'><h3>✓ Yes <span class='ct'>" + (yes.length + own.length + entries().filter(function (e) { return e.missing; }).length) + "</span></h3><div class='colsub'>your picks — in your plan</div>"
      + "<div class='card ownadd'><div class='t'>+ Add a class you don't see</div><div class='nt'>Another Penn school, or missing from Wharton's list. Press Enter to add.</div>"
      + "<div class='ownrow'><input class='ownin' id='own-code' placeholder='Code (optional)' maxlength='9'><input class='ownin' id='own-title' placeholder='Class name' maxlength='120'>"
      + "<select class='ownin' id='own-cu'><option value='0.5'>0.5 CU</option><option value='1' selected>1 CU</option><option value='1.5'>1.5 CU</option><option value='2'>2 CU</option></select></div></div>"
      + entries().filter(function (e) { return e.missing; }).map(function (e) { return "<div class='card own' data-code='" + esc(e.code) + "'><div class='mvs'><button class='mv' data-delown='" + esc(e.code) + "' title='Remove from your plan'>✕</button></div>"
          + "<div class='t'>" + esc(e.code) + (e.title ? " " + esc(e.title) : "") + "</div><div class='meta'><span class='cu'>" + fmt(e.cu) + " CU</span></div><div class='offwarn'>⚠ Not in this year's course list — double-check this class is being offered</div></div>"; }).join("")
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
  // Lock icons — closed + filled vs. open shackle + outline
  var LOCK_ON = "<svg class='ico' viewBox='0 0 24 24'><rect x='5' y='11' width='14' height='10' rx='2' fill='currentColor'/><path d='M8 11V7a4 4 0 0 1 8 0v4' fill='none' stroke='currentColor' stroke-width='2.2'/></svg>";
  var LOCK_OFF = "<svg class='ico' viewBox='0 0 24 24'><rect x='5' y='11' width='14' height='10' rx='2' fill='none' stroke='currentColor' stroke-width='2'/><path d='M8 11V7a4 4 0 0 1 7.6-1.8' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round'/></svg>";
  function calendarView() {
    var heavy = S.recruitTerms || [];
    var h = "<h2>Calendar</h2><p class='sub'>Suggested placements fill each semester to about 4.5 CU, schedule core first, keep recruiting terms lighter "
      + "and spread quant-heavy courses. Drag to try a class elsewhere — that doesn't lock it; click <span class='lkdemo off'>" + LOCK_OFF + "</span> to lock a class in when you're sure.</p>"
      + "<div class='startbanner'><b>Heads up:</b> this planner doesn't know which semester most classes actually run, so a suggested term may not match when a class is offered. The exception is Health Care Management classes, which follow the HCM department's published schedule. Check the course schedule in Course Match before you register.</div>";
    h += "<div class='cst'><span class='cst-l'>Recruiting in:</span>" + TERMS.filter(function (t) { return !/^Summer/.test(t); }).map(function (t) {
      return "<label><input type='checkbox' data-rec='" + esc(t) + "'" + (heavy.indexOf(t) >= 0 ? " checked" : "") + "> " + esc(t) + "</label>";
    }).join("") + "</div>";
    h += "<div class='resug'><button data-resuggest='1'>↻ Re-suggest</button> <span class='sub'>Re-places every unlocked <span class='lkdemo off'>" + LOCK_OFF + "</span> suggested class. <b><span class='lkdemo on'>" + LOCK_ON + "</span> Locked classes never move.</b></span>"
      + (S.changes >= 3 ? " <span class='nudge'>You've added or removed " + S.changes + " classes since the last full suggestion — click Re-suggest for a fresh layout. Your <span class='lkdemo on'>" + LOCK_ON + "</span> locked classes won't move.</span>" : "") + "</div>";
    h += "<div class='legendbox'><b>How to use the calendar</b>"
      + "<div><span class='lk off'>" + LOCK_OFF + "</span> <b>Unlocked</b> — our suggestion; Re-suggest may move it. Click the icon to lock it.</div>"
      + "<div><span class='lk on'>" + LOCK_ON + "</span> <b>Locked</b> — stays in this term. Click again to unlock.</div>"
      + "<div><span class='stb none'>Not started</span> <span class='stb inprogress'>◐ In progress</span> <span class='stb taken'>✓ Taken</span> — click the button on the right of a class to change it. "
      + "Taken and in-progress classes stay where they are and show as done in your progress bars. You set this yourself; the planner never guesses.</div>"
      + "<div>Drag a class to another term or quarter to move it.</div></div>";
    h += "<table class='cal'><tr><th>Term</th><th>Full semester</th><th>Q1</th><th>Q2</th><th class='cu'>CU</th></tr>";
    var es = entries();
    TERMS.forEach(function (t) {
      var tcu = 0, nq = 0;
      h += "<tr><td class='tn'>" + esc(t) + (heavy.indexOf(t) >= 0 ? "<div class='rec'>recruiting term</div>" : "") + "</td>";
      ["Full", "Q1", "Q2"].forEach(function (s) {
        var cell = es.filter(function (e) { return e.term === t && (e.slot || "Full") === s; });
        cell.sort(function (a, b) { return (!!b.locked || started(b)) - (!!a.locked || started(a)); });
        h += "<td class='slot' data-term=\"" + esc(t) + "\" data-slot='" + s + "'>" + cell.map(chip).join("") + "</td>";
      });
      es.forEach(function (e) { if (e.term === t) { tcu += cuOf(e.code); nq += isQuant(e.code) ? 1 : 0; } });
      h += "<td class='tcu'>" + fmt(tcu) + (tcu > HEAVY ? "<div class='flag'>⚠ heavy — more than a typical semester; move or drop classes</div>" : "") + (nq ? "<div class='" + (nq > QCAP ? "flag" : "qcount") + "'>∑ " + nq + " quant-heavy " + (nq === 1 ? "course" : "courses") + "</div>" : "") + "</td></tr>";
    });
    h += "</table><div class='tray slot' data-term='' data-slot=''><b>Needs a term</b> " + (es.filter(function (e) { return !e.term; }).map(chip).join("") || "<span class='cu'>none</span>") + "</div>";
    return h;
  }
  var STATUS = { "": ["", "Not started", "Mark as in progress"], inprogress: ["◐", "In progress", "Mark as taken"], taken: ["✓", "Taken", "Mark as not started"] };
  function chip(e) {
    var st = e.status || "", locked = !!e.locked;
    var k = BY[e.code];
    var cat = countsAsCore(e.code) ? "Core" : e.own ? "Added by you" : null;
    var mj = e.own ? [] : majorsFor(e.code).filter(function (m) { return explored.indexOf(m) >= 0 || REQ_MAJ[e.code] === m; });
    return "<div class='chip " + (st === "taken" ? "done" : st === "inprogress" ? "inprog" : locked ? "locked" : "sugg") + "' draggable='true' data-chip='" + esc(e.code) + "'" + (e.why ? " title=\"" + esc(e.why) + "\"" : "") + ">"
      + "<div class='crow'><button class='lk " + (locked ? "on" : "off") + "' data-lock='" + esc(e.code) + "' title='" + (locked ? "Locked in this term — click to unlock" : "Suggested — click to lock it in this term") + "'>" + (locked ? LOCK_ON : LOCK_OFF) + "</button>"
      + "<span class='ct2'>" + (e.missing ? "<span class='offwarn' title='Not in this year's course list'>⚠ check it's offered</span> " : "")
      + (offTerm(e.code, e.term) ? "<span class='offwarn' title='The department lists this class in " + esc(offered(e.code)[0]) + "'>⚠ usually " + esc(offered(e.code)[0]) + "</span> " : "")
      + "<b>" + esc(e.own ? (e.shown || "") : e.code) + "</b> " + esc(e.own || e.missing ? e.title : k ? k.title : "") + " <span class='cu'>" + fmt(cuOf(e.code)) + "</span>" + (isQuant(e.code) ? " <span class='qh'>∑</span>" : "") + "</span>"
      + "<button class='stb " + (st || "none") + "' data-status='" + esc(e.code) + "' title='" + STATUS[st][2] + "'>" + (STATUS[st][0] ? STATUS[st][0] + " " : "") + STATUS[st][1] + "</button></div>"
      + "<div class='ctags'>" + (cat ? "<span class='tag mj' style='--c:#8a857c'><i></i>" + cat + "</span>" : "")
      + (e.own ? "" : majorTags(e.code))
      + (!cat && !mj.length ? "<span class='tag mj' style='--c:#b9b4aa'><i></i>Elective</span>" : "") + "</div></div>";
  }
  function sourcesView() {
    return "<section class='srcs'><h2>Sources</h2><p>Every class comes from the <a target='_blank' rel='noopener' href='" + esc(D.courseListUrl) + "'>Wharton MBA course list</a> (Excel export). "
      + "<b>Wharton classes only — classes from other Penn schools aren't included.</b> Use “+ Add a class you don't see” for those.</p>"
      + "<p class='when'><b>Exported " + esc(usDate(D.exported)) + ".</b> Classes are subject to change since the export — check the live list before you register.</p>"
      + "<ul>" + D.sources.map(function (s) { return "<li><a target='_blank' rel='noopener' href='" + esc(s[1]) + "'>" + esc(s[0]) + "</a></li>"; }).join("") + "</ul>"
      + "<p><b>Majors and their requirements</b> come from each department's official page, linked from Wharton's <a target='_blank' rel='noopener' href='" + esc(D.majorsMaster) + "'>MBA majors list</a>. "
      + "<b>Pulled " + esc(usDate(D.majorsPulled)) + ".</b> Some listed courses aren't in this year's course list; requirements can change — confirm with your academic advisor.</p>"
      + "<details><summary>" + D.majors.length + " majors — source pages</summary><ul>" + D.majors.map(function (m) {
          return "<li><a target='_blank' rel='noopener' href='" + esc(m.source) + "'>" + esc(m.name) + "</a>" + (m.source_note ? " <span class='nt'>(" + esc(m.source_note) + ")</span>" : "") + "</li>"; }).join("") + "</ul></details>"
      + "<p class='sub'>Recommendations come from patterns learned from 132 sample student profiles — no AI runs while you use this, and nothing you enter leaves your browser.</p></section>";
  }
  // ---------- Overview ----------
  function ring(pct, color, label, rest) {
    pct = Math.max(0, Math.min(100, pct));
    return "<div class='dn' style='background:conic-gradient(" + color + " 0 " + pct + "%," + (rest || "var(--soft)") + " 0)'><i>" + label + "</i></div>";
  }
  function overviewView() {
    var core = coreState(), ms = majorState(), tt = 0, tp = 0;
    entries().forEach(function (e) { if (started(e)) tt += cuOf(e.code); else tp += cuOf(e.code); });
    var cHave = core.reduce(function (s, r) { return s + r.t + r.p; }, 0), cNeed = core.reduce(function (s, r) { return s + r.need; }, 0);
    var tot = tt + tp, pct = 100 * tot / 19;
    var elect = entries().filter(function (e) { return !countsAsCore(e.code); });
    var h = "<h2>Your two years at Wharton</h2><p class='sub'>" + esc(A["class"] || "") + (explored.length ? " · exploring " + esc(explored.map(function (m) { return MAJ_SHORT[m]; }).join(", ")) : "")
      + ". Work through the steps in order — Core, Majors, Major & elective courses, then Calendar.</p>";
    //
    var cpct = cNeed ? 100 * cHave / cNeed : 0;
    h += "<div class='kpis'>"
      + "<a class='kpi hero' href='#calendar'>" + ring(pct, "#fff", Math.round(pct) + "%", "rgba(255,255,255,.22)") + "<div><small>Total planned</small><b>" + fmt(tot) + " / 19</b><small>"
        + (tot >= 19 ? "all 19 CU planned" : fmt(19 - tot) + " CU to go") + "</small></div></a>"
      + "<a class='kpi' href='#core'>" + ring(cpct, "var(--teal)", Math.round(cpct) + "%") + "<div><small>Core</small><b>" + fmt(cHave) + " / " + fmt(cNeed) + "</b><small>"
        + core.filter(function (r) { return r.open.length; }).length + " still open</small></div></a>";
    if (ms.rows.length > 1) { var du = dblUsed();
      h += "<a class='kpi dblk" + (du > D.doubleCap + 1e-9 ? " over" : "") + "' href='#majors'>" + ring(50 * du, du > D.doubleCap + 1e-9 ? "var(--red)" : "var(--orange)", fmt(du)) + "<div><small>Double-counted</small><b>" + fmt(du) + " / 2.0</b><small>"
        + (du > D.doubleCap + 1e-9 ? "over Wharton's limit" : couldDouble().length && du < D.doubleCap ? couldDouble().length + " more could count twice" : "of Wharton's limit") + "</small></div></a>"; }
    h += "<a class='kpi num' href='#electives'><div><small>Major & elective courses</small><b>" + elect.length + "</b><small>picked</small></div></a></div>";
    h += "<div class='kpis majrow'>";
    ms.rows.forEach(function (r) {
      var p2 = r.need ? 100 * (r.t + r.p) / r.need : 0;
      h += "<a class='kpi' href='#majors'>" + ring(p2, "var(--acc)", Math.round(p2) + "%") + "<div><small>" + esc(MAJ_SHORT[r.name] || r.name) + "</small><b>" + fmt(r.t + r.p) + " / " + fmt(r.need) + "</b><small>"
        + fmt(Math.max(0, r.need - r.t - r.p)) + " CU to go</small></div></a>";
    });
    if (!ms.rows.length) h += "<a class='kpi' href='#majors'><div><small>Majors</small><b>None yet</b><small>add one any time</small></div></a>";
    h += "</div>";
    // timeline: CU per term, split core / major / electives
    var es = entries(), max = 6;
    h += "<div class='ov'><div class='box'><h4>Your two years <a href='#calendar'>Open calendar →</a></h4><div class='tl'>";
    TERMS.forEach(function (t) {
      var parts = { core: 0, maj: 0, el: 0 };
      es.forEach(function (e) { if (e.term !== t) return; var cu = cuOf(e.code);
        if (countsAsCore(e.code)) parts.core += cu; else if (!e.own && (REQ_MAJ[e.code] || majorsFor(e.code).length)) parts.maj += cu; else parts.el += cu; });
      var sum = parts.core + parts.maj + parts.el;
      h += "<span class='tn2'>" + esc(t) + ((S.recruitTerms || []).indexOf(t) >= 0 ? "<small>recruiting</small>" : "") + "</span><div class='track'>"
        + [["core", "c-core", "Core"], ["maj", "c-maj", "Major"], ["el", "c-el", "Elect."]].map(function (x) {
          return parts[x[0]] ? "<span class='" + x[1] + "' style='width:" + (100 * parts[x[0]] / max) + "%' title='" + x[2] + ": " + fmt(parts[x[0]]) + " CU'>" + fmt(parts[x[0]]) + "</span>" : ""; }).join("")
        + "</div><span class='cuv" + (sum > HEAVY ? " hv" : "") + "'>" + fmt(sum) + " CU" + (sum > HEAVY ? " ⚠" : "") + "</span>";
    });
    var unplaced = es.filter(function (e) { return !e.term; }).length;
    h += "</div><div class='legend'><span><i class='c-core'></i>Core</span><span><i class='c-maj'></i>Majors</span><span><i class='c-el'></i>Electives</span>"
      + (unplaced ? "<span>· " + unplaced + " class" + (unplaced > 1 ? "es need" : " needs") + " a term</span>" : "") + "</div></div></div>";
    return h + summary();
  }
  var VIEWS = ["overview", "core", "majors", "electives", "calendar"];
  var NEXT = { overview: ["core", "Start with Core"], core: ["majors", "Next: Majors"], majors: ["electives", "Next: Major & elective courses"], electives: ["calendar", "Next: Calendar"] };
  // The node test harness has no location.hash — it renders every view on one page so all checks still apply.
  var ALL_VIEWS = typeof location.hash !== "string";
  function currentView() { var v = (location.hash || "").slice(1); return VIEWS.indexOf(v) >= 0 || v === "sources" ? v : "overview"; }
  var lastView = null;
  function render() {
    fresh();
    var y = window.scrollY, v = currentView(), h;
    if (ALL_VIEWS) h = overviewView() + coreView() + majorsView() + electivesView() + calendarView() + sourcesView();
    else {
      h = { overview: overviewView, core: coreView, majors: majorsView, electives: electivesView, calendar: calendarView, sources: sourcesView }[v]();
      if (NEXT[v]) h += "<div class='next'><a href='#" + NEXT[v][0] + "'>" + NEXT[v][1] + " →</a></div>";
      if (v === "overview") h += sourcesView();
    }
    $("#app").innerHTML = h;
    try { [].forEach.call(document.querySelectorAll(".side a.go"), function (a) { a.classList.toggle("on", a.dataset.go === v); }); } catch (e) {}
    window.scrollTo(0, v === lastView ? y : 0);
    lastView = v;
  }
  try { window.addEventListener("hashchange", render); } catch (e) {}
  function commit() { fresh(); save(); render(); }

  // ---------- events ----------
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.core) { S.core[t.dataset.core] = t.value; dropInapplicable(t.dataset.core); return commit(); }
    if (t.dataset.pick) { var pk = t.dataset.pick, wasD = isDouble(pk), mcard = t.closest && t.closest(".cg[data-major]");
      S.use = S.use || {};
      if (t.checked && mcard && noFlexMajors(pk).indexOf(mcard.dataset.major) >= 0) S.use[pk] = "major";   // ticked on a major's card
      else if (t.checked && !mcard && FLEX_AREA[pk]) S.use[pk] = "flex";                                   // ticked on the Core page
      if (!t.checked) delete S.use[pk]; if (t.checked) addToPlan(pk); else removeFromPlan(pk); commit();
      return t.checked ? askDouble(pk) : (wasD ? freedDouble(pk) : null); }
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
    var b = e.target.closest && e.target.closest("[data-decide],[data-filter],[data-more],[data-noopen],[data-lock],[data-resuggest],[data-delown],[data-theme-set],[data-startover],[data-feedback],[data-addmajor],[data-dropmajor],[data-showall],[data-status],[data-countfor],[data-countauto],[data-use]");
    if (!b) return;
    var d = b.dataset;
    if (d.decide) {
      var c = b.closest(".card").dataset.code, wasDbl = isDouble(c), had = !!S.plan[c];
      if (d.decide === "yes") addToPlan(c);
      else { removeFromPlan(c); if (d.decide === "no") S.dec[c] = "no"; else delete S.dec[c]; }
      commit();
      return d.decide === "yes" && !had ? askDouble(c) : (d.decide !== "yes" && wasDbl ? freedDouble(c) : null);
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
    if (d.status) { e.preventDefault(); var se = S.plan[d.status]; se.status = se.status === "" || !se.status ? "inprogress" : se.status === "inprogress" ? "taken" : ""; if (!se.status) delete se.status;
      else se.locked = true;   // in progress or taken locks it in place
      return commit(); }
    if (d.use) { e.preventDefault(); var up = d.use.split("||"); S.use = S.use || {}; S.use[up[0]] = up[1]; return commit(); }
    if (d.countfor) { e.preventDefault(); var cp = d.countfor.split("||"), cur = assignment().set[cp[0]] || [];
      S.count = S.count || {}; var nx = cur.indexOf(cp[1]) >= 0 ? cur.filter(function (x) { return x !== cp[1]; }) : cur.concat([cp[1]]);
      S.count[cp[0]] = nx; return commit(); }
    if (d.countauto) { e.preventDefault(); if (S.count) delete S.count[d.countauto]; return commit(); }
    if (d.showall) { ui.showAll[d.showall] = !ui.showAll[d.showall]; return render(); }
    if (d.dropmajor && !d.how) return removeMajorDialog(d.dropmajor);
    if (d.addmajor || d.dropmajor) {   // majors live in the survey answers, so Update survey shows the same list
      if (d.how === "classes") {   // remove the classes that count only toward this major (never taken / in-progress ones)
        var others = explored.filter(function (x) { return x !== d.dropmajor; });
        majorOnlyClasses(d.dropmajor, others).forEach(function (c) { delete S.plan[c]; S.changes += 1; });
        save();
      }
      var name = d.addmajor === "__select" ? ($("#addmaj") || {}).value : d.addmajor;
      if (d.addmajor && !name) return;
      var keep = (A.majors || []).filter(function (x) { return !/^Not sure/.test(x) && x !== name && x !== d.dropmajor; });
      A.majors = d.addmajor ? keep.concat([name]) : keep;
      try { localStorage.setItem("wcp.answers", JSON.stringify(A)); } catch (e2) {}
      location.reload(); return;
    }
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
    en.moved = true;   // dragging moves, it doesn't lock — but a moved first-year class isn't snapped back
    dragCode = null; commit();
  });
  //
  function majorOnlyClasses(name, others) {
    return Object.keys(S.plan).filter(function (c) {
      var e = S.plan[c];
      return !e.own && !countsAsCore(c) && !started(e) && eligible(c, ALLM[name])
        && !others.some(function (o) { return ALLM[o] && eligible(c, ALLM[o]); });
    });
  }
  function removeMajorDialog(name) {
    var others = explored.filter(function (x) { return x !== name; }), cls = majorOnlyClasses(name, others);
    var o = document.createElement("div");
    o.className = "pop-o";
    o.innerHTML = "<div class='pop wide'><b>Remove " + esc(name) + "?</b>"
      + "<p>" + (cls.length ? cls.length + " class" + (cls.length > 1 ? "es" : "") + " in your plan count only toward this major: " + esc(cls.join(", ")) + "." : "None of your picked classes count only toward this major.")
      + " Classes that also count toward another major you're exploring, and classes marked taken or in progress, are always kept.</p>"
      + "<div class='row'><button class='pri' data-dropmajor='" + esc(name) + "' data-how='keep'>Remove major, keep its classes</button>"
      + (cls.length ? "<button class='danger' data-dropmajor='" + esc(name) + "' data-how='classes'>Remove major and its classes</button>" : "")
      + "<button data-cancel='1'>Cancel</button></div></div>";
    o.onclick = function (ev) { if (ev.target === o || (ev.target.dataset && ev.target.dataset.cancel)) o.remove(); };
    document.body.appendChild(o);
  }
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
                   render: render, LABEL: LABEL, SCORE: SCORE, coreState: coreState, majorState: majorState,
                   cuOf: cuOf, flexUsed: flexUsed, dropInapplicable: dropInapplicable, usedForMajor: usedForMajor, countsAsCore: countsAsCore, inElectives: inElectives, assignment: assignment, dblUsed: dblUsed, explored: explored, TERMS: TERMS, CORE_CODES: CORE_CODES, HEAVY: HEAVY, ui: ui, A: A, started: started };   // for tests
  dropInapplicable(null);   // tidy plans saved before this rule
  placeNew();   // also moves saved fixed-core classes to their first-year terms
  // After "Update survey": keep every pick, term, lock and status; only the answers-driven parts recalibrate
  // (recommendations and majors are recomputed from the answers on load; recruiting terms follow the new answers)
  if (S.rescore) { delete S.rescore; S.recruitTerms = recruitFromSurvey(); save(); }
  commit();
})();
