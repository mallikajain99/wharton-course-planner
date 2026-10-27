// Click-path tester: many personas × many random click sequences through the real site. After EVERY action it checks
// that the screens agree with each other (calendar, Overview, Core, Majors, Electives) and that nothing broke.
// Same persona, different sequences — people click through in very different orders.
// Reproduce a failure: the error message names the persona, the seed and the full action log.
const { test, expect } = require("@playwright/test");
const personas = require("./personas.json");

const SEEDS = Number(process.env.SEEDS || 2), STEPS = Number(process.env.STEPS || 35);
const VIEWS = ["overview", "core", "majors", "electives", "calendar", "sources"];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- invariants: run after every action ----------
async function checkAll(page, errors, ctx) {
  if (errors.length) throw new Error("page error: " + errors.join(" | "));
  // switching views happens on the browser's hashchange event, just after the click — let it land (max 3 s)
  await page.waitForFunction(() => {
    const v = (location.hash || "#overview").slice(1), on = document.querySelector(".side a.go.on");
    return window.__wcp && on && on.dataset.go === (["overview", "core", "majors", "electives", "calendar", "sources"].includes(v) ? v : "overview");
  }, null, { timeout: 3000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const P = window.__wcp, out = [];
    if (!P) return ["no planner state (did the board load?)"];
    const view = (location.hash || "#overview").slice(1);
    const on = document.querySelector(".side a.go.on");
    if (!on || on.dataset.go !== (["overview", "core", "majors", "electives", "calendar", "sources"].includes(view) ? view : "overview"))
      out.push("sidebar highlight " + (on && on.dataset.go) + " but view is " + view);
    if (window.innerWidth > screen.width + 1) out.push("page zoomed out: layout is " + window.innerWidth + "px on a " + screen.width + "px screen (" + view + ")");
    if (document.documentElement.scrollWidth - window.innerWidth > 1) out.push("sideways scroll " + (document.documentElement.scrollWidth - window.innerWidth) + "px on " + view);
    const plan = P.S.plan, keys = Object.keys(plan);
    keys.forEach(k => { const t = plan[k].term; if (t && !P.TERMS.includes(t)) out.push(k + " has unknown term " + t); });
    const total = keys.reduce((s, k) => s + P.cuOf(k), 0);
    // double-counting: automatic choices stay within 2 majors per class and 2.0 CU in total
    const asg = P.assignment(), anyManual = Object.keys(asg.manual).length > 0;
    Object.keys(asg.set).forEach(k => { if (!asg.manual[k] && asg.set[k].length > 2) out.push(k + " counts toward " + asg.set[k].length + " majors automatically"); });
    if (!anyManual && P.majorState().dbl > 2 + 1e-9) out.push("double-counted " + P.majorState().dbl + " CU without any manual choice");
    if (view === "calendar") {
      const chips = [...document.querySelectorAll(".cal [data-chip], .tray [data-chip]")].map(e => e.dataset.chip);
      const seen = {}; chips.forEach(c => seen[c] = (seen[c] || 0) + 1);
      keys.forEach(k => { if (seen[k] !== 1) out.push("calendar shows " + k + " " + (seen[k] || 0) + "×"); });
      chips.forEach(c => { if (!plan[c]) out.push("calendar shows " + c + " which isn't in the plan"); });
      document.querySelectorAll("[data-status]").forEach(b => { const st = plan[b.dataset.status].status || "";
        if (!b.classList.contains(st || "none")) out.push("status button for " + b.dataset.status + " doesn't match its state " + st); });
      document.querySelectorAll(".cal tr").forEach(tr => {
        const cells = [...tr.querySelectorAll("td.slot")]; if (!cells.length) return;
        const sum = cells.flatMap(td => [...td.querySelectorAll("[data-chip]")]).reduce((s, e) => s + P.cuOf(e.dataset.chip), 0);
        const shown = parseFloat(tr.querySelector("td.tcu").textContent);
        if (Math.abs(sum - shown) > 0.01) out.push("term CU shows " + shown + " but its classes add to " + sum);
        if (sum > P.HEAVY && !tr.querySelector(".flag")) out.push("term above " + P.HEAVY + " CU without the heavy warning");
      });
    }
    if (view === "overview") {
      const hero = document.querySelector(".kpi.hero b");
      if (!hero || Math.abs(parseFloat(hero.textContent) - total) > 0.01) out.push("Overview total " + (hero && hero.textContent) + " ≠ plan " + total);
      document.querySelectorAll(".card.mini").forEach(c => { const k = c.dataset.code; if (plan[k] || P.S.dec[k] === "no") out.push("top pick " + k + " is already decided"); });
      const tl = [...document.querySelectorAll(".tl .cuv")].reduce((s, e) => s + parseFloat(e.textContent), 0);
      const placed = keys.filter(k => plan[k].term).reduce((s, k) => s + P.cuOf(k), 0);
      if (Math.abs(tl - placed) > 0.01) out.push("Overview timeline adds to " + tl + " but placed classes add to " + placed);
    }
    if (view === "electives" && P.ui.filter === "all" && !P.ui.q) {
      const col = n => [...document.querySelectorAll(".col:nth-child(" + n + ") .card[data-code]")].map(e => e.dataset.code);
      const yes = col(1), maybe = col(2), no = col(3);
      keys.filter(k => P.inElectives(k) && !plan[k].own).forEach(k => { if (!yes.includes(k)) out.push(k + " is in the plan but not in Yes"); });
      yes.forEach(k => { if (!plan[k]) out.push(k + " shows in Yes but isn't in the plan"); if (!P.inElectives(k)) out.push(k + " is core-only but shows under major & elective courses"); });
      maybe.forEach(k => { if (plan[k] || P.S.dec[k] === "no") out.push(k + " shows in Maybe but is decided"); });
      Object.keys(P.S.dec).filter(k => P.S.dec[k] === "no").forEach(k => { if (P.ui.noOpen && !no.includes(k)) out.push(k + " ruled out but not visible in No"); });
    }
    if (view === "core" || view === "majors") {
      document.querySelectorAll("input[data-pick]").forEach(i => { if (i.checked !== !!plan[i.dataset.pick]) out.push("core checkbox " + i.dataset.pick + " doesn't match the plan"); });
    }
    if (view === "majors") {
      const cards = [...document.querySelectorAll(".cg[data-major]")].map(e => e.dataset.major);
      if (cards.join("|") !== P.explored.join("|")) out.push("majors shown [" + cards + "] ≠ exploring [" + P.explored + "]");
    }
    return out;
  });
  if (r.length) throw new Error(ctx() + "\n  " + r.join("\n  "));
}

// ---------- actions ----------
async function act(page, rand, isMobile, log) {
  const pickOne = arr => arr[Math.floor(rand() * arr.length)];
  const view = await page.evaluate(() => (location.hash || "#overview").slice(1));
  const choices = ["nav", "nav", "nav", "back", "reload", "theme"];
  const per = { core: ["status", "status", "tick", "tick", "tick"], majors: ["addmajor", "dropmajor", "explore", "tick", "tick", "showall", "countfor", "countfor"],
                electives: ["decide", "decide", "decide", "decide", "filter", "search", "own"], calendar: ["lock", "resuggest", "rec", "drag", "status", "status"] };
  const a = pickOne(choices.concat(per[view] || [], per[view] || []));
  const click = async (loc, what) => { if (await loc.count()) { log.push(view + ": " + what); await loc.click(); return true; } return false; };
  switch (a) {
    case "nav": { const v = pickOne(VIEWS); log.push("go " + v); await page.click(`.side a[data-go='${v}']`); break; }
    case "back": log.push("browser back"); await page.goBack().catch(() => {}); if (!/board\.html/.test(page.url())) { log.push("(left board — forward)"); await page.goForward(); } break;
    case "reload": log.push("reload"); await page.reload(); break;
    case "theme": { const t = pickOne(["auto", "light", "dark"]); log.push("theme " + t); await page.click(`[data-theme-set='${t}']`); break; }
    case "plus": await click(page.locator(".card.mini [data-decide='yes']").nth(Math.floor(rand() * 3)), "+ top pick"); break;
    case "status": { const l = page.locator(".cst label:not(.dis):has(input[data-core])"); const n = await l.count(); if (n) await click(l.nth(Math.floor(rand() * n)), "core status"); break; }
    case "tick": { const l = page.locator("label.opt:has(input[data-pick])"); const n = await l.count(); if (n) await click(l.nth(Math.floor(rand() * n)), "tick core class"); break; }
    case "addmajor": { const opts = await page.locator("#addmaj option").evaluateAll(o => o.map(x => x.value).filter(Boolean));
      if (opts.length) { const m = pickOne(opts); log.push("majors: add " + m); await page.selectOption("#addmaj", m); await page.click("[data-addmajor='__select']"); await page.waitForLoadState(); } break; }
    case "dropmajor": { const l = page.locator(".cg [data-dropmajor]"); const n = await l.count();
      if (n) { await click(l.nth(Math.floor(rand() * n)), "remove a major"); const how = pickOne(["keep", "classes", "cancel"]);
        const b = how === "cancel" ? page.locator(".pop [data-cancel]") : page.locator(`.pop [data-how='${how}']`);
        if (await b.count()) { log.push("  → " + how); await b.click(); } else { log.push("  → cancel"); await page.locator(".pop [data-cancel]").click(); }
        await page.waitForLoadState(); } break; }
    case "countfor": { const l = page.locator("[data-countfor], [data-countauto]"); const n = await l.count(); if (n) await click(l.nth(Math.floor(rand() * n)), "change which major a class counts toward"); break; }
    case "showall": await click(page.locator("[data-showall]").first(), "show all classes in a group"); break;
    case "explore": await click(page.locator(".sugm [data-addmajor]").first(), "explore suggested major"); await page.waitForLoadState(); break;
    case "decide": { const col = pickOne([1, 2, 2, 2, 3]); const d = pickOne(["yes", "maybe", "no"]);
      const l = page.locator(`.col:nth-child(${col}) .card[data-code] [data-decide='${d}']`); const n = await l.count();
      if (n) await click(l.nth(Math.floor(rand() * Math.min(n, 8))), "col " + col + " → " + d); break; }
    case "filter": { const l = page.locator("[data-filter]"); const n = await l.count(); if (n) await click(l.nth(Math.floor(rand() * n)), "filter chip"); break; }
    case "search": { const q = pickOne(["finance", "neg", "zzz", "real estate", ""]); log.push("search '" + q + "'"); await page.fill("#q", q); break; }
    case "own": log.push("add own class"); await page.fill("#own-title", "Law School Seminar " + Math.floor(rand() * 100)); await page.press("#own-title", "Enter"); break;
    case "lock": { const l = page.locator(".cal [data-lock], .tray [data-lock]"); const n = await l.count(); if (n) await click(l.nth(Math.floor(rand() * n)), "lock/unlock"); break; }
    case "status": { const l = page.locator(".cal [data-status], .tray [data-status]"); const n = await l.count(); if (n) await click(l.nth(Math.floor(rand() * n)), "change taken/in-progress status"); break; }
    case "resuggest": await click(page.locator("[data-resuggest]"), "re-suggest"); break;
    case "rec": { const l = page.locator("label:has(input[data-rec])"); const n = await l.count(); if (n) await click(l.nth(Math.floor(rand() * n)), "toggle recruiting term"); break; }
    case "drag": if (!isMobile) { const c = page.locator(".cal .chip[draggable='true']"); const s = page.locator(".cal td.slot, .tray");
      const n = await c.count(), m = await s.count(); if (n && m) { log.push("drag a class"); await c.nth(Math.floor(rand() * n)).dragTo(s.nth(Math.floor(rand() * m)));
        const pop = page.locator(".pop button"); if (await pop.count()) { log.push("(pop-up: can't place — closed)"); await pop.first().click(); } } } break;
  }
}

for (const p of personas) {
  for (let seed = 1; seed <= SEEDS; seed++) {
    test(`${p.id} · path ${seed}`, async ({ page, isMobile }) => {
      test.setTimeout(240000);
      const errors = [], log = [];
      page.on("pageerror", e => errors.push(e.message));
      page.on("dialog", d => d.accept());
      await page.route(/goatcounter\.com|gc\.zgo\.at/, r => r.abort());
      await page.goto("/index.html");
      await page.evaluate(a => { localStorage.clear(); localStorage.setItem("wcp.answers", JSON.stringify(a)); }, p.survey);
      await page.goto("/board.html");
      const ctx = () => `persona ${p.id}, seed ${seed}${isMobile ? " (phone)" : ""}, after:\n    ` + log.slice(-12).join("\n    ");
      await checkAll(page, errors, ctx);
      const rand = rng(seed * 7919 + p.id.length * 31);
      for (let i = 0; i < STEPS; i++) {
        await act(page, rand, isMobile, log);
        for (let k = 0; k < 3; k++) {   // answer any pop-up (double-count questions etc.) with a random enabled choice
          const pop = page.locator(".pop-o .pop"); if (!(await pop.count())) break;
          const btns = pop.locator("button:not([disabled])"); const n = await btns.count(); if (!n) break;
          const b = btns.nth(Math.floor(rand() * n)); log.push("  pop-up → " + (await b.textContent()).trim()); await b.click();
          await checkAll(page, errors, ctx);
        }
        await checkAll(page, errors, ctx);
      }
      if (process.env.SHOWLOG) console.log(`${p.id} seed ${seed}${isMobile ? " phone" : ""}: ${log.length} actions — ` + log.join(" | "));
    });
  }
}
