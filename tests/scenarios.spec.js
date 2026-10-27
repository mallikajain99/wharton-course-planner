// Scripted scenarios — the specific paths a student takes, each checked at every step (test-plan section B).
const { test, expect } = require("@playwright/test");
const personas = require("./personas.json");
const P = id => personas.find(p => p.id === id).survey;

test.beforeEach(async ({ page }) => {
  page.on("pageerror", e => { throw new Error("Page error: " + e.message); });
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
const calTerm = (page, code) => page.locator(`.cal [data-chip='${code}']`).evaluate(e => e.closest("td").dataset.term);

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
  await expect(page.locator(".kpi").nth(2)).toContainText("+1 more");
  await page.click("text=Update survey");
  await expect(page.locator("input[name='majors'][value='Finance']")).toBeChecked();
  await expect(page.locator("input[name='majors'][value='Real Estate']")).not.toBeChecked();
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
  for (const c of ["ACCT 6110", "FNCE 6110", "MGMT 6120"]) expect(await calTerm(page, c)).toBe("Spring '27");
});

test("Statistics: Take lists STAT 6130, Placement lists STAT 6210, Waived is allowed", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  const card = page.locator(".cg", { hasText: "Statistics" }).first();
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
  const loads = await page.locator(".cal tr").evaluateAll(rows => rows.filter(r => r.querySelector("td.tcu"))
    .map(r => [r.querySelector("td.tn").textContent.match(/^\w+ '\d\d/)[0], parseFloat(r.querySelector("td.tcu").textContent)]));
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
  await expect(page.locator(".tl")).toContainText("Spring '27");
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
  await expect(page.locator(".resug")).toContainText("Re-places every unlocked");
});

test("calendar: nothing is marked taken until the student says so; status cycles; legend explains it", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  await page.locator("label:has(input[data-core='Marketing Management'][value='take'])").click();
  await page.locator("input[data-pick='MKTG 6110']").check();
  await view(page, "calendar");
  await expect(page.locator(".legendbox")).toContainText("Locked");
  await expect(page.locator(".legendbox")).toContainText("the planner never guesses");
  const b = page.locator("[data-status='MKTG 6110']");
  await expect(b).toHaveText("Not started");
  await b.click(); await expect(page.locator("[data-status='MKTG 6110']")).toContainText("In progress");
  await page.locator("[data-status='MKTG 6110']").click(); await expect(page.locator("[data-status='MKTG 6110']")).toContainText("Taken");
  await view(page, "overview");
  await expect(page.locator(".summ")).toContainText("0.5 / 3.5");
  await view(page, "calendar");
  await page.locator("[data-status='MKTG 6110']").click(); await expect(page.locator("[data-status='MKTG 6110']")).toHaveText("Not started");
});

test("a core substitute counts as core, not as a major/elective course", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  const card = page.locator(".cg", { hasText: "Accounting" }).first();
  await card.locator("label:has(input[value='substituted'])").click();
  const sub = card.locator("input[data-pick]").first(); const code = await sub.getAttribute("data-pick");
  await sub.check();
  await view(page, "electives");
  await expect(page.locator(`.card[data-code='${code}']`)).toHaveCount(0);
  await view(page, "calendar");
  await expect(page.locator(`[data-chip='${code}'] .ctags`)).toContainText("Core");
});

test("first-fall slots: BEPP 6110 Q1, BEPP 6120 Q2 (even if 6110 waived), STAT 6130 full, STAT 6210 Q1", async ({ page }) => {
  await board(page, P("q01-01"), "#core");
  const slotOf = code => page.locator(`.cal [data-chip='${code}']`).evaluate(e => e.closest("td").dataset.term + " " + e.closest("td").dataset.slot);
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
  await page.locator(".cg", { hasText: "Statistics" }).first().locator("label:has(input[value='substituted'])").click();
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
