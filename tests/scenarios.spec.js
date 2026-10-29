// Scripted scenarios — the specific paths a student takes, each checked at every step (test-plan section B).
const { test, expect } = require("@playwright/test");
const personas = require("./personas.json");
const P = id => personas.find(p => p.id === id).survey;

test.beforeEach(async ({ page }, info) => {
  page.on("pageerror", e => { throw new Error("Page error: " + e.message); });
  // the double-count pop-ups are tested on their own (tests named "prompt"); elsewhere they'd sit in front of every click
  if (!/prompt/.test(info.title)) await page.addInitScript(() => localStorage.setItem("wcp.noDoublePrompt", "1"));
  page.on("dialog", d => d.accept());
  await page.route(/goatcounter\.com|gc\.zgo\.at/, r => r.abort());
});
async function board(page, survey, hash = "") {
  await page.goto("/index.html");
  await page.evaluate(a => { localStorage.clear(); localStorage.setItem("wcp.answers", JSON.stringify(a)); }, survey);
  await page.goto("/board.html" + hash);
  await expect(page.locator(".side a.go.on")).toBeVisible();
}
const view = async (page, v) => { await page.click(`.side a[data-go='${v}']`); await expect(page.locator(".side a.go.on")).toHaveAttribute("data-go", v); };
const calTerm = (page, code) => page.locator(`.cal [data-chip='${code}']`).evaluate(e => e.closest(".slot").dataset.term);

test("five majors: all five show, then drop to two — tags, filters, overview and the survey follow", async ({ page }) => {
  await board(page, P("x-five-majors"), "#majors");
  await expect(page.locator(".cg[data-major]")).toHaveCount(5);
  await view(page, "electives");
  for (const m of ["Finance", "E&I", "Marketing", "Management", "Real Estate"]) await expect(page.locator(".chips")).toContainText(m);
  await view(page, "majors");
  for (const m of ["Marketing", "Management", "Real Estate"]) {
    await page.click(`.cg [data-dropmajor='${m}']`);
    await expect(page.locator(".pop")).toContainText("Remove " + m);           // asks first
    await page.click(`.pop [data-how='keep']`);
    await expect(page.locator(`.cg[data-major='${m}']`)).toHaveCount(0);
  }
  await expect(page.locator(".cg[data-major]")).toHaveCount(2);
  await expect(page.locator(".side a.go.on")).toHaveAttribute("data-go", "majors");   // stays on Majors after the reload
  await view(page, "overview");
  await expect(page.locator(".kpi[href='#majors']:not(.dblk)")).toHaveCount(2);           // one ring per major
  await expect(page.locator(".kpi.dblk")).toContainText("/ 2.0");
  await page.click("text=Update survey");
  await expect(page.locator("input[name='majors'][value='Finance']")).toBeChecked();
  await expect(page.locator("input[name='majors'][value='Real Estate']")).not.toBeChecked();
});

test("× on a calendar class: unlocked goes with Undo, removed = decided No, locked and taken ask first", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 2400 });
  await board(page, P("x-five-majors"), "#calendar");
  for (let i = 0; i < 4; i++) await page.locator("[data-addplan]").first().click();   // plans start empty — add four from the majors list
  await expect(page.locator(".cal .chip.k")).toHaveCount(4);
  const codes = await page.locator(".cal .chip.k.sugg").evaluateAll(els => els.map(e => e.dataset.chip));
  expect(codes.length).toBeGreaterThan(3);
  const [a, b, c] = codes;
  const chipOf = code => page.locator(`.cal [data-chip='${code}']`);
  // unlocked: straight away, bottom note with Undo
  await chipOf(a).hover(); await chipOf(a).locator(".kx").click();
  await expect(chipOf(a)).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Removed " + a);
  await page.click(".toast .undo");
  await expect(chipOf(a)).toHaveCount(1);
  await chipOf(a).hover(); await chipOf(a).locator(".kx").click();
  await expect(chipOf(a)).toHaveCount(0);
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem("wcp.state")).dec[k], a)).toBe("no");   // removed = decided No
  await page.click("[data-resuggest]");
  await expect(chipOf(a)).toHaveCount(0);                                                                // Re-suggest leaves it out
  // locked: warns, Keep it keeps it, Remove removes it
  await chipOf(b).locator(".lk").click();
  await chipOf(b).hover(); await chipOf(b).locator(".kx").click();
  await expect(page.locator(".pop")).toContainText("Remove a locked class?");
  await page.click(".pop [data-cancel]");
  await expect(chipOf(b)).toHaveCount(1);
  await chipOf(b).hover(); await chipOf(b).locator(".kx").click();
  await page.click(".pop [data-rmgo]");
  await expect(chipOf(b)).toHaveCount(0);
  // taken: stronger wording
  await chipOf(c).locator(".stb").click(); await chipOf(c).locator(".stb").click();
  await chipOf(c).hover(); await chipOf(c).locator(".kx").click();
  await expect(page.locator(".pop")).toContainText("Remove a class you've taken?");
  await page.click(".pop [data-cancel]");
  await expect(chipOf(c)).toHaveCount(1);
});

test("Export to Excel: downloads a valid workbook whose numbers match the dashboard", async ({ page }, info) => {
  await page.setViewportSize({ width: 1400, height: 2400 });
  await board(page, P("x-five-majors"), "#core");
  await page.locator("label:has(input[data-core='Leadership'][value='take'])").click();
  await page.locator("input[data-pick='MGMT 6100']").check();
  await view(page, "calendar");
  for (let i = 0; i < 6; i++) await page.locator("[data-addplan]").first().click();
  const first = page.locator(".cal .chip.k").first();
  await first.locator(".stb").click(); await first.locator(".stb").click();   // one class taken
  const chips = await page.locator(".cal .chip.k").count();
  await view(page, "overview");
  const total = (await page.locator(".kpi.hero b").innerText()).split(" /")[0];
  const rings = await page.locator(".kpis.majrow .kpi").evaluateAll(els => els.map(e => [e.querySelector("small").innerText, e.querySelector("b").innerText]));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-export]")]);
  expect(dl.suggestedFilename()).toMatch(/^wharton-plan-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const file = info.outputPath("plan.xlsx"); await dl.saveAs(file);
  const { execFileSync } = require("child_process");
  const check = execFileSync("python3", [__dirname + "/read_xlsx.py", file, "--check"]).toString();
  expect(check).toContain("XLSX OK");
  const dump = execFileSync("python3", [__dirname + "/read_xlsx.py", file]).toString();
  const tabs = [...dump.matchAll(/^=== (.*)$/gm)].map(m => m[1]);
  expect(tabs.slice(0, 6)).toEqual(["README", "Survey responses", "Summary", "Schedule", "Core", "Flex"]);
  expect(tabs[tabs.length - 1]).toBe("Remaining Wharton classes");
  expect(tabs.filter(t => t.startsWith("Major - "))).toHaveLength(P("x-five-majors").majors.length);
  const tab = name => dump.split("=== " + name + "\n")[1].split("\n=== ")[0].split("\n").map(l => l.split("\t"));
  expect(tab("Schedule").length - 1).toBe(chips);                                   // one row per class on the calendar
  expect(tab("Summary").find(r => r[0] === "Total planned")[1]).toBe(total);        // same total as the Overview
  expect(tab("Schedule").some(r => r[5] === "Taken")).toBe(true);
  for (const [, got] of rings) expect(dump).toContain(got.replace(" / ", " of ") + " CU");   // each major's progress
  expect(dump).not.toContain("HYPERLINK");                                             // links come out as their text
  expect(tab("README").some(r => r[1] && r[1].startsWith("https://"))).toBe(true);
});

test("update note: hidden while current, shows when a newer version is published, × hides it, Refresh keeps the plan", async ({ page }) => {
  let live = null;   // null = serve the real version.txt (same as the page)
  await page.route(/version\.txt/, r => live ? r.fulfill({ body: live + "\n" }) : r.continue());
  await board(page, P("x-five-majors"), "#calendar");
  await page.locator("[data-addplan]").first().click();
  await page.waitForTimeout(3500);                                  // the first automatic check
  await expect(page.locator(".updnote")).toHaveCount(0);            // same version → nothing
  live = "newer1";
  await page.evaluate(() => window.__wcpCheckUpdate());
  await expect(page.locator(".updnote")).toContainText("A new version of the planner is ready");
  await page.click(".updnote .x");
  await expect(page.locator(".updnote")).toHaveCount(0);
  await page.evaluate(() => window.__wcpCheckUpdate());
  await page.waitForTimeout(500);
  await expect(page.locator(".updnote")).toHaveCount(0);            // dismissed until the next update
  live = "newer2";
  await page.evaluate(() => window.__wcpCheckUpdate());
  await expect(page.locator(".updnote")).toBeVisible();
  const chips = await page.locator(".cal .chip.k").count();
  await Promise.all([page.waitForEvent("load"), page.click(".updnote .go")]);
  await expect(page.locator(".cal .chip.k")).toHaveCount(chips);    // plan survives the refresh
});

test("a class filling the OIDD flex core isn't tagged or exported as counting toward E&I / AI", async ({ page }, info) => {
  await page.setViewportSize({ width: 1400, height: 2400 });
  const survey = Object.assign({}, P("x-five-majors"), { class: "Class of 2028", majors: ["Artificial Intelligence for Business", "Entrepreneurship & Innovation", "Finance"] });
  await page.goto("/index.html");
  await page.evaluate(a => {
    localStorage.clear(); localStorage.setItem("wcp.answers", JSON.stringify(a));
    localStorage.setItem("wcp.state", JSON.stringify({ plan: { "OIDD 6120": { term: "Fall '26", slot: "Q2", locked: true }, "OIDD 6620": { term: "Fall '27", slot: "Q2", locked: true } },
      dec: {}, core: { "Operations, Information & Decisions": "take" }, changes: 0, ownN: 0 }));
  }, survey);
  await page.goto("/board.html#calendar");
  const tags = await page.locator(".cal [data-chip='OIDD 6620'] .kbot").innerText();
  expect(tags).not.toMatch(/E&I|AI for Business/);
  const sheets = await page.evaluate(() => window.__wcpExport());
  const cell = r => r.map(x => x && typeof x === "object" ? x.v : x);
  const ei = sheets.find(s => s.name === "Major - E&I").rows.map(cell).find(r => r[0] === "OIDD 6620");
  expect(ei[7]).toBe("No — filling your OIDD flex core");
  const sched = sheets.find(s => s.name === "Schedule").rows.map(cell).find(r => r[2] === "OIDD 6620");
  expect(sched[7]).toBe("Flex core (Operations, Information & Decisions)");
  const summ = sheets.find(s => s.name === "Summary").rows.map(cell).map(r => r.join(" ")).join("\n");
  expect(summ).not.toContain("OIDD 6620");
});

test("Electives page shows the Total card: same total as the Overview, CU and classes to go", async ({ page }) => {
  await board(page, P("x-five-majors"), "#calendar");
  for (let i = 0; i < 3; i++) await page.locator("[data-addplan]").first().click();
  await view(page, "overview");
  const total = await page.locator(".kpi.hero b").innerText();
  await view(page, "electives");
  await expect(page.locator(".ehead .kpi.mini b")).toHaveText(total);
  const left = 19 - parseFloat(total);
  await expect(page.locator(".ehead .kpi.mini")).toContainText(`CU to go · about ${Math.ceil(left)} class`);
  await page.locator(".board .col:nth-child(2) .card [data-decide='yes']").first().click();               // ✓ a class → the card updates
  await expect(page.locator(".ehead .kpi.mini b")).not.toHaveText(total);
});

test("Maybe shows every recommendation, tops up to 20 only when fewer are left, and one click shows the rest", async ({ page }) => {
  await board(page, P("x-five-majors"), "#electives");
  const cards = page.locator(".col:nth-child(2) .card[data-code]");
  const info = await page.evaluate(() => { const L = window.__wcp.LABEL, S = window.__wcp.S;
    const rec = Object.keys(L).filter(c => L[c] && !S.plan[c] && S.dec[c] !== "no"); return { rec }; });
  const total = Number(await page.locator(".col:nth-child(2) h3 .ct").innerText().then(t => t.match(/\d+/)[0]));
  expect(await cards.count()).toBe(Math.max(info.rec.length, 20));                         // all recommended, nothing extra
  await expect(page.locator(".col:nth-child(2) .ct")).toContainText("recommended");
  // decide all but 5 recommendations → 5 recommended + 15 others = 20
  await page.evaluate(keep => { const S = window.__wcp.S, L = window.__wcp.LABEL;
    Object.keys(L).filter(c => L[c] && !S.plan[c]).slice(keep).forEach(c => { S.dec[c] = "no"; }); window.__wcp.fresh(); window.__wcp.render(); }, 5);
  await expect(cards).toHaveCount(20);
  await expect(page.locator(".col:nth-child(2) .mdiv")).toHaveText(/Other Wharton classes/i);
  // decide them all → 20 others with "Show the rest"; one click shows every remaining class
  await page.evaluate(() => { const S = window.__wcp.S, L = window.__wcp.LABEL;
    Object.keys(L).filter(c => L[c] && !S.plan[c]).forEach(c => { S.dec[c] = "no"; }); window.__wcp.fresh(); window.__wcp.render(); });
  await expect(cards).toHaveCount(20);
  await expect(page.locator(".col:nth-child(2) .colsub")).toContainText("decided on all your recommendations");
  const rest = page.locator("[data-others]");
  await expect(rest).toContainText("Show the rest");
  await rest.click();
  const left = Number((await page.locator(".col:nth-child(2) h3 .ct").innerText()).match(/\d+/)[0]);
  await expect(cards).toHaveCount(left);
  await expect(page.locator("[data-others], .col:nth-child(2) [data-more]")).toHaveCount(0);   // no "show more" steps
  expect(total).toBeGreaterThan(20);
});

test("Maybe: search looks through every class, not just recommendations", async ({ page }) => {
  await board(page, P("x-five-majors"), "#electives");
  const other = await page.evaluate(() => { const L = window.__wcp.LABEL; return Object.keys(window.__wcp.SCORE).find(c => !L[c] && !window.__wcp.CORE_CODES[c]); });
  await expect(page.locator(`.col:nth-child(2) .card[data-code='${other}']`)).toHaveCount(0);
  await page.fill("#q", other);
  await expect(page.locator(`.col:nth-child(2) .card[data-code='${other}']`)).toHaveCount(1);
});

test("wide screens: page content reaches the right edge like the top bar (no white space)", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "laptop widths only");
  await board(page, P("x-five-majors"), "#overview");
  for (const w of [1512, 1728, 2048]) {
    await page.setViewportSize({ width: w, height: 900 });
    const [app, top] = await page.evaluate(() => [document.querySelector("#app").getBoundingClientRect().right, document.querySelector(".top").getBoundingClientRect().right]);
    expect(Math.abs(app - top)).toBeLessThan(2);
    expect(app).toBeGreaterThan(w - 2);
  }
});

test("phone: Next floats above the tab bar while scrolling; laptop keeps it at the bottom", async ({ page }, info) => {
  await board(page, P("x-five-majors"), "#electives");
  const pos = await page.locator(".next").evaluate(e => getComputedStyle(e).position);
  if (info.project.name === "phone") {
    expect(pos).toBe("fixed");
    await page.mouse.wheel(0, 1500);
    await expect(page.locator(".next a")).toBeInViewport();
  } else expect(pos).not.toBe("fixed");
});

test("Electives Total card over 19 behaves like the Overview (teal 19–21, red over 21)", async ({ page }) => {
  await board(page, P("x-five-majors"), "#calendar");
  for (let i = 0; i < 22; i++) await page.locator("[data-addplan]").first().click();
  await view(page, "electives");
  for (let i = 0; i < 8; i++) await page.locator(".board .col:nth-child(2) .card [data-decide='yes']").first().click();
  const mini = await page.locator(".ehead .kpi.mini").innerText();
  expect(mini).toMatch(/up to 21 covered|you'd pay for/);                          // past 19
  await view(page, "overview");
  expect(await page.locator(".kpi.hero").innerText()).toBe(mini);                  // identical to the Overview card
});

test("Core table: tiles count areas, Needs action filter, semester picker moves (not locks), status set from Core", async ({ page }) => {
  await board(page, P("x-five-majors"), "#core");
  await page.locator("label:has(input[data-core='Leadership'][value='take'])").click();
  await page.locator("input[data-pick='MGMT 6100']").check();
  const tiles = page.locator(".ctile b");
  const [cov, need] = [await tiles.nth(0).innerText(), await tiles.nth(1).innerText()];
  const total = Number(cov.split("/")[1]);
  expect(Number(cov.split("/")[0]) + Number(need)).toBe(total);
  expect(await page.locator("tr.crow").count()).toBe(total);
  await page.click("[data-cfilter='need']");
  await expect(page.locator("tr.crow")).toHaveCount(Number(need));
  await expect(page.locator("tr.crow", { hasText: "Leadership" })).toHaveCount(0);   // covered → hidden under Needs action
  await page.click("[data-cfilter='all']");
  await page.locator("label:has(input[data-core='Accounting'][value='take'])").click();
  await page.locator("input[data-pick='ACCT 6110']").check();
  const sel = page.locator("select[data-when='ACCT 6110']");
  await expect(page.locator(".copt.on", { hasText: "ACCT 6110" })).toContainText("suggested");
  const target = await sel.locator("option").last().getAttribute("value");
  await sel.selectOption(target);
  await expect(page.locator(".copt.on", { hasText: "ACCT 6110" })).not.toContainText("suggested");
  const e = await page.evaluate(() => JSON.parse(localStorage.getItem("wcp.state")).plan["ACCT 6110"]);
  expect(e.term + "|" + (e.slot || "")).toBe(target);
  expect(e.locked).toBeFalsy();                                                        // moving doesn't lock — same as dragging on the Calendar
  await page.locator(".copt.on", { hasText: "ACCT 6110" }).locator("[data-status]").click();
  await expect(page.locator(".copt.on", { hasText: "ACCT 6110" }).locator("[data-status]")).toContainText("In progress");
  await view(page, "calendar");
  await expect(page.locator(".cal [data-chip='ACCT 6110'] .stb")).toContainText("In progress");   // same status everywhere
});

test("pre-term: MGMT 6100 is offered only the summer, every other class never the summer", async ({ page }) => {
  await board(page, Object.assign({}, P("x-five-majors"), { class: "Class of 2028" }), "#core");
  await page.locator("label:has(input[data-core='Leadership'][value='take'])").click();
  await page.locator("input[data-pick='MGMT 6100']").check();
  await page.locator("label:has(input[data-core='Accounting'][value='take'])").click();
  await page.locator("input[data-pick='ACCT 6110']").check();
  expect(await page.locator("select[data-when='MGMT 6100'] option").allInnerTexts()).toEqual(["Summer '26"]);
  await expect(page.locator(".copt.on", { hasText: "MGMT 6100" })).toContainText("suggested");
  const acct = await page.locator("select[data-when='ACCT 6110'] option").allInnerTexts();
  expect(acct.some(t => /Summer/.test(t))).toBe(false);
});

test("add a major from the Majors page", async ({ page }) => {
  await board(page, P("x-no-majors"), "#majors");
  await expect(page.locator(".cg[data-major]")).toHaveCount(0);
  await page.selectOption("#addmaj", "Finance");
  await page.click("[data-addmajor='__select']");
  await expect(page.locator(".cg[data-major='Finance']")).toBeVisible();
  await expect(page.locator("#addmaj option[value='Finance']")).toHaveCount(0);
});

test("'suggest some for me': suggestions appear, Explore adds one, suggestions give way", async ({ page }) => {
  await board(page, P("x-not-sure"), "#majors");
  const sug = page.locator(".sugm .cg");
  expect(await sug.count()).toBeGreaterThan(0);
  await expect(sug.first()).toContainText("of your recommended classes count toward it");
  const name = await sug.first().locator("[data-addmajor]").getAttribute("data-addmajor");
  await sug.first().locator("[data-addmajor]").click();
  await expect(page.locator(`.cg[data-major='${name}']`)).toBeVisible();
  await expect(page.locator(".sugm")).toHaveCount(0);
  await view(page, "electives");
  await expect(page.locator(".chips")).toContainText(/./);
});

test("one fixed-core class → it shows on the calendar in the first fall; MGMT 6100 in the first summer", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  await page.locator("label:has(input[data-core='Marketing Management'][value='take'])").click();
  await page.locator("input[data-pick='MKTG 6110']").check();
  await view(page, "calendar");
  expect(await calTerm(page, "MKTG 6110")).toBe("Fall '26");
  await view(page, "overview");
  await expect(page.locator(".kpi.hero b")).toContainText("0.5 / 19");
  await view(page, "core");
  await page.locator("label:has(input[data-core='Leadership'][value='take'])").click();
  await page.locator("input[data-pick='MGMT 6100']").check();
  await view(page, "calendar");
  expect(await calTerm(page, "MGMT 6100")).toBe("Summer '26");
  await page.click("[data-resuggest]");
  expect(await calTerm(page, "MGMT 6100")).toBe("Summer '26");   // Re-suggest keeps it there
});

test("three flex-core classes → all three on the calendar, early when front-loading", async ({ page }) => {
  const s = Object.assign({}, P("q01-01"), { frontload: "Yes — get core done early" });
  await board(page, s, "#core");
  for (const [area, code] of [["Accounting", "ACCT 6110"], ["Corporate finance", "FNCE 6110"], ["Management", "MGMT 6120"]]) {
    await page.locator(`label:has(input[data-core='${area}'][value='take'])`).click();
    await page.locator(`input[data-pick='${code}']`).first().check();
  }
  await view(page, "calendar");
  for (const c of ["ACCT 6110", "FNCE 6110", "MGMT 6120"]) expect(await calTerm(page, c)).toBe("Fall '26");   // first fall, after fixed core
});

test("flex core fills the first fall only after fixed core; electives never go there", async ({ page }) => {
  const s = Object.assign({}, P("q01-01"), { class: "Class of 2028", frontload: "Yes — get core done early", recruit_terms: ["Not recruiting"] });
  await board(page, s, "#core");
  for (const [area, code] of [["Marketing Management", "MKTG 6110"], ["Microeconomics", "BEPP 6110"], ["Statistics", "STAT 6130"]]) {
    await page.locator(`label:has(input[data-core='${area}'][value='take'])`).click();
    await page.locator(`input[data-pick='${code}']`).check();
  }
  for (const [area, code] of [["Accounting", "ACCT 6110"], ["Corporate finance", "FNCE 6110"], ["Management", "MGMT 6120"], ["Macroeconomics", "FNCE 6130"]]) {
    await page.locator(`label:has(input[data-core='${area}'][value='take'])`).click();
    await page.locator(`input[data-pick='${code}']`).first().check();
  }
  await view(page, "electives");
  for (let i = 0; i < 3; i++) await page.locator(".col:nth-child(2) .card[data-code]").first().locator("[data-decide='yes']").click();
  await view(page, "calendar"); await page.click("[data-resuggest]");
  const plan = await page.evaluate(() => window.__wcp.S.plan);
  const cu = await page.evaluate(() => Object.fromEntries(Object.keys(window.__wcp.S.plan).map(k => [k, window.__wcp.cuOf(k)])));
  for (const c of ["MKTG 6110", "BEPP 6110", "STAT 6130"]) expect(plan[c].term, c).toBe("Fall '26");
  const fall = Object.keys(plan).filter(k => plan[k].term === "Fall '26").reduce((t, k) => t + cu[k], 0);
  expect(fall).toBeLessThanOrEqual(4.5);
  for (const k of Object.keys(plan)) if (!/^(MKTG 6110|BEPP 6110|STAT 6130|ACCT 6110|FNCE 6110|MGMT 6120|FNCE 6130)$/.test(k)) expect(plan[k].term, k).not.toBe("Fall '26");
});

test("Statistics: Take lists STAT 6130, Placement lists STAT 6210, Waived is allowed", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  const card = page.locator(".crow", { hasText: "Statistics" }).first();
  await expect(card.locator(".cst")).toContainText("Placement");
  await card.locator("label:has(input[value='take'])").click();
  await expect(card.locator("input[data-pick='STAT 6130']")).toHaveCount(1);
  await expect(card.locator("input[data-pick='STAT 6210']")).toHaveCount(0);
  await card.locator("label:has(input[value='substituted'])").click();
  await expect(card.locator("input[data-pick='STAT 6210']")).toHaveCount(1);
  await expect(card.locator("input[data-pick='STAT 6130']")).toHaveCount(0);
  await card.locator("input[data-pick='STAT 6210']").check();
  await expect(card).toContainText("✓ placed");
  await expect(card.locator("label:has(input[value='waived'])")).not.toHaveClass(/dis/);
  await card.locator("label:has(input[value='waived'])").click();
  await expect(card).toContainText("✓ waived");
});

test("yes / no / maybe: each column, the calendar and the overview stay in step", async ({ page }) => {
  await board(page, P("q02-03"), "#electives");
  const first = page.locator(".col:nth-child(2) .card[data-code]").first(); const a = await first.getAttribute("data-code");
  await first.locator("[data-decide='no']").click();
  await expect(page.locator(`.col:nth-child(3) .card[data-code='${a}']`)).toBeVisible();     // No is visible right away
  const second = page.locator(".col:nth-child(2) .card[data-code]").first(); const b = await second.getAttribute("data-code");
  await second.locator("[data-decide='yes']").click();
  await expect(page.locator(`.col:nth-child(1) .card[data-code='${b}']`)).toBeVisible();
  await view(page, "calendar");
  await expect(page.locator(`.cal [data-chip='${b}'], .tray [data-chip='${b}']`)).toHaveCount(1);
  await view(page, "electives");
  await page.locator(`.col:nth-child(1) .card[data-code='${b}'] [data-decide='maybe']`).click();
  await expect(page.locator(`.col:nth-child(2) .card[data-code='${b}']`)).toBeVisible();
  await view(page, "calendar");
  await expect(page.locator(`[data-chip='${b}']`)).toHaveCount(0);
  await view(page, "electives");
  await page.locator(`.col:nth-child(3) .card[data-code='${a}'] [data-decide='yes']`).click();
  await expect(page.locator(`.col:nth-child(1) .card[data-code='${a}']`)).toBeVisible();
  await expect(page.locator(`.col:nth-child(3) .card[data-code='${a}']`)).toHaveCount(0);
});

test("many electives spread across semesters — recruiting terms stay lighter, nothing over the limit", async ({ page }) => {
  const s = Object.assign({}, P("q03-05"), { class: "Class of 2028", recruit_terms: ["Spring of year 1", "Spring of year 2"] });
  await board(page, s, "#electives");
  for (let i = 0; i < 12; i++) await page.locator(".col:nth-child(2) .card[data-code]").first().locator("[data-decide='yes']").click();
  await view(page, "calendar");
  const loads = await page.locator(".cal .r3").evaluateAll(rows => rows.map(r => [r.dataset.termRow, parseFloat(r.querySelector(".tcu").textContent)]));
  const L = Object.fromEntries(loads);
  for (const t of ["Spring '27", "Fall '27", "Spring '28"]) expect(L[t], t).toBeGreaterThan(0);   // spread, not piled into one term
  for (const t in L) expect(L[t], t).toBeLessThanOrEqual(5.5);
  expect(L["Fall '27"]).toBeGreaterThanOrEqual(Math.max(L["Spring '27"], L["Spring '28"]) - 1);
});

test("survey: edit from review jumps to that question and comes back; no blank depth row", async ({ page }) => {
  await page.goto("/index.html"); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click("#next");
  for (let i = 0; i < 9; i++) await page.click("#next");
  await expect(page.locator(".part.on table.grid tr")).toHaveCount(18);   // 2 header rows + 16 areas, no extra row
  await page.click("#next");
  await expect(page.getByText("Check your answers")).toBeVisible();
  await page.click("[data-edit='4']");
  await expect(page.locator(".part.on .panel h1")).toContainText("roles");
  await page.locator(".q[data-q='roles'] label:has(input[value='Consulting'])").click();
  await expect(page.locator("#next")).toContainText("Back to review");
  await page.click("#next");
  await expect(page.locator("#review")).toContainText("Consulting");
});

test("update survey keeps every pick, term, lock and status — and recalibrates majors and recruiting terms", async ({ page }) => {
  await board(page, Object.assign({}, P("q04-02"), { class: "Class of 2028", recruit_terms: ["Fall of year 1"] }), "#electives");
  for (let i = 0; i < 3; i++) await page.locator(".col:nth-child(2) .card[data-code]").first().locator("[data-decide='yes']").click();
  await view(page, "calendar");
  await page.locator(".cal .lk.off").first().click();
  await page.locator(".cal .stb").first().click();
  const snap = () => page.evaluate(() => JSON.stringify(Object.entries(window.__wcp.S.plan).map(([k, v]) => [k, v.term, v.slot, !!v.locked, v.status || ""]).sort()));
  const before = await snap();
  await page.click("text=Update survey");
  await page.click("#next");
  for (let i = 0; i < 6; i++) await page.click("#next");                       // question 1 → 7, the recruiting question
  await page.locator(".q[data-q='recruit_terms'] label:has(input[value='Fall of year 1'])").click();
  await page.locator(".q[data-q='recruit_terms'] label:has(input[value='Spring of year 2'])").click();
  await page.click("#next"); await page.click("#next");                          // frontload → majors
  await page.locator(".q[data-q='majors'] label:has(input[value='Real Estate'])").click();
  for (let i = 0; i < 3; i++) await page.click("#next");
  await page.waitForURL(/board\.html/);
  expect(await snap()).toEqual(before);                                           // nothing picked, moved, unlocked or unmarked
  expect(await page.evaluate(() => window.__wcp.S.recruitTerms)).toEqual(["Spring '28"]);
  expect(await page.evaluate(() => window.__wcp.explored)).toContain("Real Estate");
});

test("browser Back moves between views", async ({ page }) => {
  await board(page, P("q01-01"));
  await view(page, "core"); await view(page, "calendar");
  await page.goBack();
  await expect(page.locator(".side a.go.on")).toHaveAttribute("data-go", "core");
});

test("Class of 2027 gets 2025–27 semesters everywhere", async ({ page }) => {
  await board(page, P("x-2027"), "#calendar");
  await expect(page.locator(".cal")).toContainText("Fall '25");
  await view(page, "overview");
  await expect(page.locator(".ocal")).toContainText("Spring '27");
});

test("a class not offered this year can still be picked — with a double-check warning everywhere it shows", async ({ page }) => {
  const s = Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Artificial Intelligence for Business"] });
  await board(page, s, "#majors");
  await expect(page.locator("[data-dropmajor]").first()).toHaveText("Remove major");
  const row = page.locator("label.opt:has(input[data-pick='MGMT 8020'])");
  if (!(await row.count())) await page.locator("[data-showall]").nth(1).click();
  await expect(row).toContainText("double-check this class is being offered");
  await row.locator("input").check();
  await expect(row.locator("input")).toBeChecked();
  await view(page, "electives");
  await expect(page.locator(".col:nth-child(1) .card[data-code='MGMT 8020']")).toContainText("double-check");
  await view(page, "calendar");
  await expect(page.locator("[data-chip='MGMT 8020']")).toContainText("check it's offered");
  await view(page, "electives");
  await page.locator(".col:nth-child(1) .card[data-code='MGMT 8020'] [data-delown]").click();
  await expect(page.locator(".card[data-code='MGMT 8020']")).toHaveCount(0);
});

test("lock icons: locked and unlocked look different", async ({ page }) => {
  await board(page, P("q02-03"), "#electives");
  await page.locator(".col:nth-child(2) .card[data-code]").first().locator("[data-decide='yes']").click();
  await view(page, "calendar");
  const btn = page.locator(".cal .lk.off, .tray .lk.off").first();
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator(".cal .lk.on, .tray .lk.on").first()).toBeVisible();
  await expect(page.locator(".legendbox")).toContainText("Suggested");
});

test("calendar: nothing is marked taken until the student says so; status cycles; legend explains it", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  await page.locator("label:has(input[data-core='Marketing Management'][value='take'])").click();
  await page.locator("input[data-pick='MKTG 6110']").check();
  await view(page, "calendar");
  await expect(page.locator(".legendbox")).toContainText("Locked");
  await expect(page.locator(".legendbox")).toContainText("click to change");
  const b = page.locator("[data-status='MKTG 6110']");
  await expect(b).toHaveText("Not started");
  await b.click(); await expect(page.locator("[data-status='MKTG 6110']")).toContainText("In progress");
  await page.locator("[data-status='MKTG 6110']").click(); await expect(page.locator("[data-status='MKTG 6110']")).toContainText("Taken");
  await view(page, "overview");
  expect(await page.evaluate(() => window.__wcp.coreState()[0].t)).toBeCloseTo(0.5, 5);   // taken counts as done (fixed core 0.5 of 3.5)
  await view(page, "calendar");
  await page.locator("[data-status='MKTG 6110']").click(); await expect(page.locator("[data-status='MKTG 6110']")).toHaveText("Not started");
});

test("a core substitute counts as core, not as a major/elective course", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  const card = page.locator(".crow", { hasText: "Accounting" }).first();
  await card.locator("label:has(input[value='substituted'])").click();
  const sub = card.locator("input[data-pick]").first(); const code = await sub.getAttribute("data-pick");
  await sub.check();
  await view(page, "electives");
  await expect(page.locator(`.card[data-code='${code}']`)).toHaveCount(0);
  await view(page, "calendar");
  await expect(page.locator(`[data-chip='${code}'] .kbot`)).toContainText("Core");
});

test("first-fall slots: BEPP 6110 Q1, BEPP 6120 Q2 (even if 6110 waived), STAT 6130 full, STAT 6210 Q1", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  const slotOf = code => page.locator(`.cal [data-chip='${code}']`).evaluate(e => e.closest(".slot").dataset.term + " " + e.closest(".slot").dataset.slot);
  await page.locator("label:has(input[data-core='Microeconomics'][value='take'])").click();
  await page.locator("input[data-pick='BEPP 6110']").check();
  await page.locator("input[data-pick='BEPP 6120']").check();
  await page.locator("label:has(input[data-core='Statistics'][value='take'])").click();
  await page.locator("input[data-pick='STAT 6130']").check();
  await view(page, "calendar");
  expect(await slotOf("BEPP 6110")).toBe("Fall '26 Q1");
  expect(await slotOf("BEPP 6120")).toBe("Fall '26 Q2");
  expect(await slotOf("STAT 6130")).toBe("Fall '26 Full");
  await page.click("[data-resuggest]");
  expect(await slotOf("BEPP 6120")).toBe("Fall '26 Q2");
  await view(page, "core");
  await page.locator("input[data-pick='BEPP 6110']").uncheck();
  await page.locator(".crow", { hasText: "Statistics" }).first().locator("label:has(input[value='substituted'])").click();
  await page.locator("input[data-pick='STAT 6210']").check();
  await view(page, "calendar");
  expect(await slotOf("BEPP 6120")).toBe("Fall '26 Q2");
  expect(await slotOf("STAT 6210")).toBe("Fall '26 Q1");
});

test("marking a class in progress or taken locks it", async ({ page }) => {
  await board(page, P("q02-03"), "#electives");
  const code = await page.locator(".col:nth-child(2) .card[data-code]").first().getAttribute("data-code");
  await page.locator(".col:nth-child(2) .card[data-code]").first().locator("[data-decide='yes']").click();
  await view(page, "calendar");
  await expect(page.locator(`[data-chip='${code}'] .lk`)).toHaveClass(/off/);
  await page.locator(`[data-status='${code}']`).click();
  await expect(page.locator(`[data-chip='${code}'] .lk`)).toHaveClass(/on/);
  expect(await page.evaluate(c => window.__wcp.S.plan[c].locked, code)).toBe(true);
});

test("yes / no on Major & elective courses shows on the Majors page (ticked / crossed out)", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Real Estate"] }), "#electives");
  await page.click("[data-filter='Real Estate']");
  const cards = page.locator(".col:nth-child(2) .card[data-code]");
  const a = await cards.nth(0).getAttribute("data-code"); await cards.nth(0).locator("[data-decide='yes']").click();
  const b = await cards.nth(0).getAttribute("data-code"); await cards.nth(0).locator("[data-decide='no']").click();
  await view(page, "majors");
  for (let i = 0; i < 8; i++) { const m = page.locator("[data-showall]", { hasText: "Show all" }); if (!(await m.count())) break; await m.first().click(); }
  await expect(page.locator(`input[data-pick='${a}']`).first()).toBeChecked();
  await expect(page.locator(`label.opt.ruled:has(input[data-pick='${b}'])`).first()).toContainText("ruled out");
  await page.locator(`input[data-pick='${b}']`).first().check();
  await view(page, "electives");
  await page.click("[data-filter='all']");
  await expect(page.locator(`.col:nth-child(1) .card[data-code='${b}']`)).toBeVisible();
});

test("remove a major: Cancel keeps it; 'and its classes' removes only that major's own classes", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Real Estate", "Finance"] }), "#majors");
  const re = page.locator(".cg[data-major='Real Estate']");
  const reOnly = await re.locator("input[data-pick]").evaluateAll(xs => xs.map(x => x.dataset.pick).filter(c => /^REAL /.test(c)).slice(0, 2));
  for (const c of reOnly) await page.locator(`.cg[data-major='Real Estate'] input[data-pick='${c}']`).check();
  await page.locator(".cg[data-major='Finance'] input[data-pick]").first().check();
  const fin = await page.locator(".cg[data-major='Finance'] input[data-pick]").first().getAttribute("data-pick");
  await page.click(".cg [data-dropmajor='Real Estate']");
  await page.click(".pop [data-cancel]");
  await expect(page.locator(".cg[data-major='Real Estate']")).toHaveCount(1);
  await page.click(".cg [data-dropmajor='Real Estate']");
  for (const c of reOnly) await expect(page.locator(".pop")).toContainText(c);
  await page.click(".pop [data-how='classes']");
  await expect(page.locator(".cg[data-major='Real Estate']")).toHaveCount(0);
  const plan = await page.evaluate(() => Object.keys(window.__wcp.S.plan));
  for (const c of reOnly) expect(plan).not.toContain(c);
  expect(plan).toContain(fin);
});

test("double-counting: auto-trims to 2.0 CU, override wins (red if over), back to automatic restores", async ({ page }) => {
  const s = Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Finance", "Entrepreneurship & Innovation", "Artificial Intelligence for Business"] });
  await board(page, s, "#majors");
  await page.evaluate(() => { ["FNCE 7500", "FNCE 7800", "MKTG 7270", "MKTG 7340"].forEach(c => window.__wcp.addToPlan(c)); window.__wcp.render(); });
  const st = () => page.evaluate(() => ({ dbl: window.__wcp.majorState().dbl, a: window.__wcp.assignment() }));
  let r = await st();
  expect(r.dbl).toBeLessThanOrEqual(2);
  const trimmedClass = Object.keys(r.a.trimmed)[0];
  expect(trimmedClass).toBeTruthy();
  for (let i = 0; i < 8; i++) { const m = page.locator("[data-showall]", { hasText: "Show all" }); if (!(await m.count())) break; await m.first().click(); }
  await expect(page.locator(".cnt").filter({ has: page.locator(`[data-countfor^='${trimmedClass}||']`) }).first()).toContainText("only — keeps you within");
  // override: count the trimmed class toward both → over the cap, red
  const off = page.locator(`[data-countfor^='${trimmedClass}||']:not(.on)`).first();
  await off.click();
  r = await st();
  expect(r.a.manual[trimmedClass]).toBe(1);
  expect(r.a.set[trimmedClass].length).toBe(2);                      // the student's choice is kept…
  expect(r.dbl).toBeLessThanOrEqual(2);                               // …and another automatic class is trimmed instead
  expect(Object.keys(r.a.trimmed).some(k => k !== trimmedClass)).toBe(true);
  // only the student's own choices can push past the cap — then it shows red
  await page.evaluate(() => { const P = window.__wcp, a = P.assignment(); P.S.count = {};
    ["FNCE 7500", "FNCE 7800", "MKTG 7270", "MKTG 7340"].forEach(c => { P.S.count[c] = (a.set[c] || []).concat(a.trimmed[c] || []); }); P.render(); });
  r = await st();
  expect(r.dbl).toBeGreaterThan(2);
  await view(page, "overview");
  await expect(page.locator(".kpi.dblk.over")).toBeVisible();
  await page.evaluate(c => { const P = window.__wcp; P.S.count = {}; P.S.count[c] = P.assignment().set[c].concat(P.assignment().trimmed[c] || []); P.render(); }, trimmedClass);
  // the class's tags follow the choice
  await view(page, "electives");
  await expect(page.locator(`.col:nth-child(1) .card[data-code='${trimmedClass}'] .tag.mj.off`)).toHaveCount(0);
  await view(page, "majors");
  for (let i = 0; i < 8; i++) { const m = page.locator("[data-showall]", { hasText: "Show all" }); if (!(await m.count())) break; await m.first().click(); }
  await page.locator(`[data-countauto='${trimmedClass}']`).first().click();
  r = await st();
  expect(r.dbl).toBeLessThanOrEqual(2);
  // turning a major off removes the class from that major's progress
  const before = await page.evaluate(() => window.__wcp.majorState().rows.find(x => x.name === "Finance"));
  await page.locator("[data-countfor='FNCE 7500||Finance']").first().click();
  const after = await page.evaluate(() => window.__wcp.majorState().rows.find(x => x.name === "Finance"));
  expect(before.t + before.p - (after.t + after.p)).toBeCloseTo(1, 5);
  await view(page, "electives");
  await expect(page.locator(".col:nth-child(1) .card[data-code='FNCE 7500'] .tag.mj.off")).toContainText("Finance");
});

test("electives page explains it's the complete list; 'All other Wharton electives' filter", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { majors: ["Finance"] }), "#electives");
  await expect(page.locator(".sub").first()).toContainText("Every Wharton class outside core");
  await page.click("[data-filter='none']");
  await expect(page.locator("[data-filter='none']")).toHaveText("All other Wharton electives");
  const tagged = await page.locator(".col:nth-child(2) .card .tag.mj").count();
  expect(tagged).toBe(0);
});

const DBL = Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Finance", "Entrepreneurship & Innovation", "Artificial Intelligence for Business"] });
async function addViaSearch(page, code) {
  await page.fill("#q", code);
  await page.locator(`.col:nth-child(2) .card[data-code='${code}'] [data-decide='yes']`).click();
}

test("double-count prompt: picking a class that fits two majors asks how to count it", async ({ page }) => {
  await board(page, DBL, "#electives");
  await addViaSearch(page, "FNCE 7500");
  const pop = page.locator(".pop.dblpop");
  await expect(pop).toContainText("FNCE 7500 can count toward");
  await expect(pop).toContainText("0 of 2.0 CU");
  await pop.locator("[data-dbl='FNCE 7500||Finance']").click();
  expect(await page.evaluate(() => window.__wcp.assignment().set["FNCE 7500"])).toEqual(["Finance"]);
  await addViaSearch(page, "FNCE 7800");
  await page.locator(".pop.dblpop button.pri").first().click();            // count toward both
  expect((await page.evaluate(() => window.__wcp.assignment().set["FNCE 7800"])).length).toBe(2);
  await page.fill("#q", "");
  await expect(page.locator(".col:nth-child(1) .card[data-code='FNCE 7800'] .twice")).toBeVisible();
});

test("double-count prompt: when the limit is full, 'both' is disabled with a red warning", async ({ page }) => {
  await board(page, DBL, "#electives");
  await page.evaluate(() => { const P = window.__wcp; ["FNCE 7500", "MKTG 7340", "FNCE 7800"].forEach(c => P.addToPlan(c));
    P.S.count = { "FNCE 7500": ["Finance", "Entrepreneurship & Innovation"], "MKTG 7340": ["Entrepreneurship & Innovation", "Artificial Intelligence for Business"], "FNCE 7800": ["Finance", "Artificial Intelligence for Business"] }; P.render(); });
  expect(await page.evaluate(() => window.__wcp.dblUsed())).toBe(2);
  await addViaSearch(page, "MKTG 7270");
  const pop = page.locator(".pop.dblpop");
  await expect(pop.locator(".warnr")).toContainText("over Wharton's limit");
  await expect(pop.locator("button.pri").first()).toBeDisabled();
  await pop.locator("[data-cancel]").click();
  expect(await page.evaluate(() => window.__wcp.dblUsed())).toBeLessThanOrEqual(2);
});

test("double-count prompt: removing a class that counted twice offers the room to another class", async ({ page }) => {
  await board(page, DBL, "#electives");
  await page.evaluate(() => { const P = window.__wcp; ["FNCE 7500", "MKTG 7340", "FNCE 7800", "MKTG 7270"].forEach(c => P.addToPlan(c));
    P.S.count = { "FNCE 7500": ["Finance", "Entrepreneurship & Innovation"], "MKTG 7340": ["Entrepreneurship & Innovation", "Artificial Intelligence for Business"], "FNCE 7800": ["Finance", "Artificial Intelligence for Business"], "MKTG 7270": ["Artificial Intelligence for Business"] }; P.render(); });
  await page.locator(".col:nth-child(1) .card[data-code='MKTG 7340'] [data-decide='maybe']").click();
  const pop = page.locator(".pop.dblpop");
  await expect(pop).toContainText("You freed up double-counting room");
  await expect(pop).toContainText("MKTG 7270");
  await pop.locator("[data-dbl^='MKTG 7270||']").click();
  expect((await page.evaluate(() => window.__wcp.assignment().set["MKTG 7270"])).length).toBe(2);
});

test("double-count panel on the Majors page shows usage and which classes count twice", async ({ page }) => {
  await board(page, DBL, "#majors");
  await page.evaluate(() => { const P = window.__wcp; ["FNCE 7500", "FNCE 7800"].forEach(c => P.addToPlan(c)); P.render(); });
  const panel = page.locator(".dblpanel");
  await expect(panel).toContainText("1.5 of 2.0 CU used");
  await expect(panel).toContainText("FNCE 7500");
  await expect(panel).toContainText("FNCE 7800");
});

test("flex classes a major lists show under that major and on Major & elective courses; fixed core never does", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Artificial Intelligence for Business", "Entrepreneurship & Innovation"] }), "#majors");
  for (let i = 0; i < 8; i++) { const m = page.locator("[data-showall]", { hasText: "Show all" }); if (!(await m.count())) break; await m.first().click(); }
  await expect(page.locator(".cg[data-major='Artificial Intelligence for Business'] input[data-pick='OIDD 6620']")).toHaveCount(1);
  await expect(page.locator(".cg[data-major='Entrepreneurship & Innovation'] input[data-pick='OIDD 6140']")).toHaveCount(1);
  await view(page, "electives");
  await page.fill("#q", "OIDD 6620");
  await expect(page.locator(".card[data-code='OIDD 6620']")).toContainText("flex core");
  await page.fill("#q", "MGMT 6100");
  await expect(page.locator(".card[data-code='MGMT 6100']")).toHaveCount(0);   // fixed core: never here
  await page.fill("#q", "");
  await page.fill("#q", "OIDD 6620");
  await page.locator(".card[data-code='OIDD 6620'] [data-decide='yes']").click();
  await view(page, "core");
  await expect(page.locator("input[data-pick='OIDD 6620']").first()).toBeChecked();   // same class, fills flex too
});

test("flex vs. major, one job per class (E&I): ticked in Core it fills flex; switch it to the major; ticked on the major it counts there", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Entrepreneurship & Innovation"] }), "#core");
  const oidd = page.locator(".crow", { hasText: "Operations, Information" }).first();
  await oidd.locator("label:has(input[value='take'])").click();
  await oidd.locator("input[data-pick='OIDD 6140']").check();
  await page.locator(".crow", { hasText: "Operations, Information" }).first().locator("input[data-pick='OIDD 6120']").check();   // 0.5 + 0.5 = the 1.0 CU flex
  await expect(page.locator(".crow", { hasText: "Operations, Information" }).first()).toContainText("✓ covered");
  await view(page, "majors");
  const ei = page.locator(".cg[data-major='Entrepreneurship & Innovation']");
  for (let i = 0; i < 6; i++) { const m = ei.locator("[data-showall]", { hasText: "Show all" }); if (!(await m.count())) break; await m.first().click(); }
  await expect(ei).toContainText("Selected for flex core requirement");
  const before = await page.evaluate(() => window.__wcp.majorState().rows[0]);
  await ei.locator("[data-use='OIDD 6140||major']").click();
  const after = await page.evaluate(() => window.__wcp.majorState().rows[0]);
  expect(after.t + after.p).toBeGreaterThan(before.t + before.p);
  await view(page, "core");
  await expect(page.locator(".crow", { hasText: "Operations, Information" }).first()).not.toContainText("✓ covered");
  await expect(page.locator(".usenote")).toContainText("Counting for E&I — not this flex requirement");
  await page.click("[data-use='OIDD 6140||flex']");
  await expect(page.locator(".crow", { hasText: "Operations, Information" }).first()).toContainText("✓ covered");
  // ticking a flex-type class on the major's card makes it count for the major
  await view(page, "majors");
  for (let i = 0; i < 6; i++) { const m = page.locator("[data-showall]", { hasText: "Show all" }); if (!(await m.count())) break; await m.first().click(); }
  await page.locator(".cg[data-major='Entrepreneurship & Innovation'] input[data-pick='OIDD 6620']").check();
  expect(await page.evaluate(() => window.__wcp.usedForMajor("OIDD 6620"))).toBe(true);
});

test("majors that allow it (OIDD major) count a flex class toward both", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Operations, Information and Decisions"] }), "#core");
  const oidd = page.locator(".crow", { hasText: "Operations, Information" }).first();
  await oidd.locator("label:has(input[value='take'])").click();
  await oidd.locator("input[data-pick='OIDD 6110']").check();
  await page.locator(".crow", { hasText: "Operations, Information" }).first().locator("input[data-pick='OIDD 6120']").check();
  await expect(page.locator(".crow", { hasText: "Operations, Information" }).first()).toContainText("✓ covered");
  const r = await page.evaluate(() => window.__wcp.majorState().rows[0]);
  expect(r.t + r.p).toBeGreaterThan(0);
  await view(page, "majors");
  await expect(page.locator(".usenote")).toHaveCount(0);
});

test("department majors count 6000-level electives (MGMT 6910 → Management, OIDD 6540 → MAOM / OIDD)", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Management", "Operations, Information and Decisions"] }), "#majors");
  await page.evaluate(() => { ["MGMT 6910", "OIDD 6540"].forEach(c => window.__wcp.addToPlan(c)); window.__wcp.render(); });
  const rows = await page.evaluate(() => Object.fromEntries(window.__wcp.majorState().rows.map(r => [r.name, r.t + r.p])));
  expect(rows["Management"]).toBeGreaterThan(0);
  expect(rows["Operations, Information and Decisions"]).toBeGreaterThan(0);
});

test("OIDD: at most 1 CU of independent study + Global Modular Courses counts, and the rule says so", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Operations, Information and Decisions"] }), "#majors");
  await page.evaluate(() => { ["OIDD 8970", "OIDD 8990"].forEach(c => window.__wcp.addToPlan(c)); window.__wcp.render(); });
  const r = await page.evaluate(() => window.__wcp.majorState().rows[0]);
  expect(r.t + r.p).toBeLessThanOrEqual(1);
  await expect(page.locator(".cg[data-major='Operations, Information and Decisions'] .rules")).toContainText("At most 1 CU of independent study and Global Modular Courses");
  await expect(page.locator(".cg[data-major='Operations, Information and Decisions'] .rules .appl")).toBeVisible();
});

test("'Also requires' checklist: Business Analytics shows the Statistics core and OIDD pieces, met by picking or waiving", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Business Analytics"] }), "#majors");
  const card = page.locator(".cg[data-major='Business Analytics']");
  await expect(card.locator(".chk.no")).toHaveCount(3);
  expect(await page.evaluate(() => window.__wcp.majorState().rows[0].need)).toBe(4);   // still 4 CU of electives
  await view(page, "core");
  await page.locator(".crow", { hasText: "Statistics" }).first().locator("label:has(input[value='waived'])").click();
  const oidd = page.locator(".crow", { hasText: "Operations, Information" }).first();
  await oidd.locator("label:has(input[value='take'])").click();
  await oidd.locator("input[data-pick='OIDD 6120']").check();
  await view(page, "majors");
  await expect(page.locator(".cg[data-major='Business Analytics'] .chk.ok")).toHaveCount(2);
  await expect(page.locator(".cg[data-major='Business Analytics'] .chk.no")).toContainText("OIDD 6110 or OIDD 6150");
});

test("Microeconomics: waiving covers BEPP 6110 only — BEPP 6120 is still required", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028" }), "#core");
  const before = await page.evaluate(() => window.__wcp.coreState()[0].need);
  const micro = () => page.locator(".crow", { hasText: "Microeconomics" }).first();
  await micro().locator("label:has(input[value='waived'])").click();
  await expect(micro()).toContainText("still need BEPP 6120");
  await expect(micro().locator("input[data-pick='BEPP 6110']")).toHaveCount(0);
  await expect(micro().locator("input[data-pick='BEPP 6120']")).toHaveCount(1);
  expect(await page.evaluate(() => window.__wcp.coreState()[0].need)).toBeCloseTo(before - 0.5, 5);   // only 6110's 0.5 CU waived
  await micro().locator("input[data-pick='BEPP 6120']").check();
  await expect(micro()).toContainText("✓ covered (BEPP 6110 waived)");
  await view(page, "calendar");
  await expect(page.locator(".cal [data-chip='BEPP 6120']")).toBeVisible();
});

test("major class lists: picked first, Maybe next, crossed-out (ruled out) last", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Real Estate"] }), "#electives");
  await page.click("[data-filter='Real Estate']");
  const cards = page.locator(".col:nth-child(2) .card[data-code]");
  const no1 = await cards.nth(0).getAttribute("data-code"); await cards.nth(0).locator("[data-decide='no']").click();
  const yes1 = await cards.nth(0).getAttribute("data-code"); await cards.nth(0).locator("[data-decide='yes']").click();
  await view(page, "majors");
  for (let i = 0; i < 6; i++) { const m = page.locator("[data-showall]", { hasText: "Show all" }); if (!(await m.count())) break; await m.first().click(); }
  const order = await page.locator(".cg[data-major='Real Estate'] .pill:has-text('Real Estate electives') ~ label.opt").evaluateAll(ls => ls.map(l => [l.querySelector("input").dataset.pick, l.classList.contains("ruled"), l.querySelector("input").checked]));
  const firstRuled = order.findIndex(x => x[1]);
  expect(firstRuled).toBeGreaterThan(-1);
  expect(order.slice(firstRuled).every(x => x[1])).toBe(true);        // nothing unruled after the first crossed-out row
  expect(order.findIndex(x => x[2])).toBeLessThan(order.findIndex(x => !x[2]));   // picked before the rest
  expect(order.map(x => x[0])).toContain(no1);
});

test("section caps: extra credit in one AI pillar doesn't fill another (3.0 of 4, with a note)", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Artificial Intelligence for Business"] }), "#majors");
  await page.evaluate(() => { ["STAT 7230", "LGST 6420", "MGMT 7310", "MGMT 8130", "OIDD 6670"].forEach(c => window.__wcp.addToPlan(c)); window.__wcp.render(); });
  const r = await page.evaluate(() => window.__wcp.majorState().rows[0]);
  expect(r.t + r.p).toBeCloseTo(3, 5);
  expect(r.open).toContain("Pillar F (Foundations)");
  await expect(page.locator(".cg[data-major='Artificial Intelligence for Business'] .overnote")).toContainText("doesn't count toward the 4 CU major");
  await expect(page.locator(".cg[data-major='Artificial Intelligence for Business'] .gh")).toContainText("3 of 4 CU");
});

test("section caps: a major with room beyond its minimums (BEES) lets extra count up to that room", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Business, Energy, Environment and Sustainability"] }), "#majors");
  const r = await page.evaluate(() => { const P = window.__wcp, D = window.PLANNER_DATA, m = D.majors.find(x => x.name.startsWith("Business, Energy"));
    m.groups[0].codes.filter(c => D.courses.some(k => k.code === c)).forEach(c => P.addToPlan(c)); P.render(); return P.majorState().rows[0]; });
  expect(r.t + r.p).toBeCloseTo(4, 5);   // 3 CU Environmental minimum + the 1 CU of room
});

test("waiving a core area takes its classes off the calendar; Placement swaps STAT 6130 out", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Finance"] }), "#core");
  const mm = () => page.locator(".crow", { hasText: "Marketing Management" }).first();
  await mm().locator("label:has(input[value='take'])").click();
  await mm().locator("input[data-pick='MKTG 6110']").check();
  await view(page, "calendar");
  await expect(page.locator("[data-chip='MKTG 6110']")).toHaveCount(1);
  await view(page, "core");
  await mm().locator("label:has(input[value='waived'])").click();
  await view(page, "calendar");
  await expect(page.locator("[data-chip='MKTG 6110']")).toHaveCount(0);
  await view(page, "core");
  const st = () => page.locator(".crow", { hasText: "Statistics" }).first();
  await st().locator("label:has(input[value='take'])").click();
  await st().locator("input[data-pick='STAT 6130']").check();
  await st().locator("label:has(input[value='substituted'])").click();
  expect(await page.evaluate(() => !!window.__wcp.S.plan["STAT 6130"])).toBe(false);
  await view(page, "calendar");
  await expect(page.locator("[data-chip='STAT 6130']")).toHaveCount(0);
});

test("a waived class that also counts toward an explored major stays (MKTG 6110 for Marketing)", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Marketing"] }), "#core");
  const mm = () => page.locator(".crow", { hasText: "Marketing Management" }).first();
  await mm().locator("label:has(input[value='take'])").click();
  await mm().locator("input[data-pick='MKTG 6110']").check();
  await mm().locator("label:has(input[value='waived'])").click();
  expect(await page.evaluate(() => !!window.__wcp.S.plan["MKTG 6110"])).toBe(true);
});

test("dragging a class moves it without locking it; a moved first-year class stays put after reload", async ({ page, isMobile }) => {
  test.skip(isMobile, "drag and drop is a desktop gesture");
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028" }), "#core");
  await page.locator("label:has(input[data-core='Communication'][value='take'])").click();
  await page.locator("input[data-pick='WHCP 6140']").check().catch(async () => page.locator(".crow", { hasText: "Communication" }).first().locator("input[data-pick]").first().check());
  const code = await page.evaluate(() => Object.keys(window.__wcp.S.plan)[0]);
  await view(page, "calendar");
  await page.setViewportSize({ width: 1440, height: 2600 });   // keep the target on screen — a mid-drag scroll cancels a browser drag
  await page.locator(`.cal [data-chip='${code}']`).dragTo(page.locator(`.cal .slot[data-term="Spring '27"][data-slot='Q1']`));
  if (await page.locator(".pop button").count()) {   // a full-semester class can't go in a quarter — use the Full column
    await page.locator(".pop button").click();
    await page.locator(`.cal [data-chip='${code}']`).dragTo(page.locator(`.cal .slot[data-term="Spring '27"][data-slot='Full']`));
  }
  const e = await page.evaluate(c => window.__wcp.S.plan[c], code);
  expect(e.term).toBe("Spring '27");
  expect(!!e.locked).toBe(false);
  await page.reload();
  expect(await page.evaluate(c => window.__wcp.S.plan[c].term, code)).toBe("Spring '27");
});

test("survey has the light/dark switch and the choice carries to the board", async ({ page }) => {
  await page.goto("/index.html"); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.click(".themesw [data-theme-set='dark']");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.locator(".themesw [data-theme-set='dark']")).toHaveClass(/on/);
  await page.click("#next");
  await expect(page.locator(".themesw")).toBeVisible();
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.evaluate(a => localStorage.setItem("wcp.answers", JSON.stringify(a)), P("q01-01"));
  await page.goto("/board.html");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.goto("/index.html");
  await page.click(".themesw [data-theme-set='auto']");
  expect(await page.evaluate(() => document.documentElement.dataset.theme || "")).toBe("");
  expect(await page.evaluate(() => localStorage.getItem("wcp.theme"))).toBe("auto");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme || "")).toBe("");   // Auto sticks
});

test("light is the default on both pages, even when the device is in dark mode", async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: "dark" }); const page = await ctx.newPage();
  await page.route(/goatcounter\.com|gc\.zgo\.at/, r => r.abort());
  await page.goto("/index.html"); await page.evaluate(() => localStorage.clear()); await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await expect(page.locator(".themesw [data-theme-set='light']")).toHaveClass(/on/);
  await page.evaluate(a => localStorage.setItem("wcp.answers", JSON.stringify(a)), P("q01-01"));
  await page.goto("/board.html");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await expect(page.locator(".theme [data-theme-set='light']")).toHaveClass(/on/);
  await ctx.close();
});

test("survey answer lists are alphabetical where it makes sense; catch-alls last; timelines unchanged", async ({ page }) => {
  await page.goto("/index.html"); await page.evaluate(() => localStorage.clear()); await page.reload();
  const opts = q => page.locator(`.q[data-q='${q}'] .opts input`).evaluateAll(xs => xs.map(x => x.value));
  for (const q of ["background", "skills", "roles", "industries", "topics", "majors"]) {
    const v = (await opts(q)).filter(x => x !== "__other" && !/^(None of these|Undecided|Not sure)/.test(x));
    expect(v, q).toEqual([...v].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  }
  expect((await opts("skills")).slice(-1)[0]).toBe("None of these");
  expect((await opts("roles")).filter(x => x !== "__other").slice(-1)[0]).toBe("Undecided");
  expect((await opts("majors")).slice(-1)[0]).toMatch(/^Not sure/);
  expect(await opts("recruit_terms")).toEqual(["Fall of year 1", "Spring of year 1", "Fall of year 2", "Spring of year 2", "Not recruiting"]);
});

test("feedback: Send opens the Google Form with Where = the page (board) or 'Q1 · question' (survey)", async ({ page }) => {
  await page.addInitScript(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  await board(page, P("q01-01"), "#majors");
  await page.click("[data-feedback]");
  await expect(page.locator(".pop")).toContainText("Feedback on the Majors page");
  await page.fill("#fbtext", "The pillars are clear.");
  await page.click("#fbsend");
  let u = decodeURIComponent((await page.evaluate(() => window.__opened[0])).replace(/\+/g, " "));
  expect(u).toContain("docs.google.com/forms");
  expect(u).toContain("entry.1919234374=Majors page");
  expect(u).toContain("entry.499249756=The pillars are clear.");
  await page.goto("/index.html"); await page.click("#next");
  await page.click(".part.on [data-fb]");
  await page.fill(".part.on [data-fbt]", "Add Class of 2029?");
  await page.click(".part.on [data-fbsend]");
  u = decodeURIComponent((await page.evaluate(() => window.__opened[0])));
  expect(u).toContain("entry.1919234374=Q1 · Which class are you in?");
  expect(u).toContain("entry.499249756=Add Class of 2029?");
  await expect(page.locator("footer .privacy, .privacy").first()).toContainText("Google Forms");
});

test("overview: How it works, compact calendar (Summer is one box), What's left with links", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Finance"] }), "#core");
  await page.locator("label:has(input[data-core='Leadership'][value='take'])").click();
  await page.locator("input[data-pick='MGMT 6100']").check();
  await view(page, "overview");
  await expect(page.locator(".how")).toContainText("Pick classes in Core, Majors and Electives");
  await expect(page.locator(".oterm").first()).toContainText("Pre-term");
  await expect(page.locator(".oterm").first()).toContainText("MGMT 6100");
  await expect(page.locator(".left .todo").first()).toBeVisible();
  await expect(page.locator(".left")).toContainText("FNCE 6110 is required and not picked yet");
  await page.locator(".left .todo", { hasText: "FNCE 6110" }).click();
  await expect(page.locator(".side a.go.on")).toHaveAttribute("data-go", "majors");
});

test("calendar: Show filter fades other classes; + Add from a major adds and shows the 'Added to' note", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028", majors: ["Finance"] }), "#calendar");
  await page.locator(".mc .tp.add").first().click();
  await expect(page.locator(".toast")).toContainText("Added");
  await page.evaluate(() => { window.__wcp.addToPlan("FNCE 7500"); window.__wcp.render(); });   // a Finance elective, so "Core & flex" has something to fade
  await expect(page.locator(".cal [data-chip]").first()).toBeVisible();
  await page.click("[data-show='core']");
  await expect(page.locator("[data-show='core']")).toHaveClass(/on/);
  const dims = await page.locator(".cal .chip.dim").count();
  const all = await page.locator(".cal .chip").count();
  expect(dims).toBeGreaterThan(0); expect(dims).toBeLessThanOrEqual(all);
  await page.click("[data-show='all']");
  await expect(page.locator(".cal .chip.dim")).toHaveCount(0);
});

test("status back to Not started unlocks — unless the class was locked by hand first", async ({ page }) => {
  await board(page, P("q02-03"), "#electives");
  const cards = page.locator(".col:nth-child(2) .card[data-code]");
  const a = await cards.nth(0).getAttribute("data-code"); await cards.nth(0).locator("[data-decide='yes']").click();
  const b = await cards.nth(0).getAttribute("data-code"); await cards.nth(0).locator("[data-decide='yes']").click();
  await view(page, "calendar");
  const locked = c => page.evaluate(x => !!window.__wcp.S.plan[x].locked, c);
  for (let i = 0; i < 3; i++) await page.locator(`[data-status='${a}']`).click();   // in progress → taken → not started
  expect(await locked(a)).toBe(false);
  await page.locator(`[data-chip='${b}'] [data-lock]`).click();                      // locked by hand first
  for (let i = 0; i < 3; i++) await page.locator(`[data-status='${b}']`).click();
  expect(await locked(b)).toBe(true);
});

test("total over 19 shows the teal overfill; over 21 turns red with a warning in What's left and on the Calendar", async ({ page }) => {
  await board(page, Object.assign({}, P("q01-01"), { class: "Class of 2028" }), "#overview");
  const fill = n => page.evaluate(n => { const P = window.__wcp; Object.keys(P.LABEL).filter(c => !P.S.plan[c]).slice(0, 40).forEach(c => { if (Object.keys(P.S.plan).reduce((t, k) => t + P.cuOf(k), 0) < n) P.addToPlan(c); }); P.render(); }, n);
  await fill(19.5);
  const t1 = await page.evaluate(() => Object.keys(window.__wcp.S.plan).reduce((t, k) => t + window.__wcp.cuOf(k), 0));
  if (t1 > 19 && t1 <= 21) { await expect(page.locator(".kpi.hero")).toContainText("up to 21 covered"); await expect(page.locator(".kpi.hero .captag.ok")).toBeVisible(); }
  await fill(22);
  await expect(page.locator(".kpi.hero.capbad")).toBeVisible();
  await expect(page.locator(".kpi.hero .captag.bad")).toContainText("you'd pay for");
  await expect(page.locator(".left .todo").first()).toContainText("over the 21 CU tuition covers");
  await view(page, "calendar");
  await expect(page.locator(".capwarn2")).toContainText("over the 21 CU tuition covers");
});

test("overview calendar: unlocked classes are dashed, locked ones solid", async ({ page }) => {
  await board(page, P("q02-03"), "#electives");
  for (let i = 0; i < 2; i++) await page.locator(".col:nth-child(2) .card[data-code]").first().locator("[data-decide='yes']").click();
  await view(page, "calendar");
  const code = await page.locator(".cal [data-chip]").first().getAttribute("data-chip");
  await page.locator(`[data-chip='${code}'] [data-lock]`).click();
  await view(page, "overview");
  expect(await page.locator(".oc.unl").count()).toBeGreaterThan(0);
  expect(await page.locator(".oc:not(.unl)").count()).toBeGreaterThan(0);
});
