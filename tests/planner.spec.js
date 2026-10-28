// End-to-end: a student takes the survey and uses the planner, in a real browser (desktop and phone sizes).
const { test, expect } = require("@playwright/test");

async function takeSurvey(page, opts = {}) {
  await page.goto("/index.html");
  await expect(page.getByText("Privacy:")).toBeVisible();
  const pick = async (qid, value) => page.locator(`.q[data-q='${qid}'] label:has(input[value="${value}"])`).click();
  const next = () => page.click("#next");
  await next();                                   // welcome → question 1 (one question per screen)
  await pick("class", opts.klass || "Class of 2028"); await next();
  await pick("background", "Consulting");
  await pick("background", "__other");
  await page.fill("[data-other='background']", "Teacher"); await next();
  const letter = await page.locator(".part.on .opts label:has(input[value='Excel modeling']) kbd").textContent();
  await page.keyboard.press(letter.toLowerCase());   // keyboard: that option's letter picks it
  await expect(page.locator("input[name='skills'][value='Excel modeling']")).toBeChecked(); await next();
  await pick("roles", "Founder / startup");
  await pick("roles", "Product management"); await next();
  await pick("industries", "AI / software"); await next();
  await pick("topics", "Negotiation"); await next();
  await pick("recruit_terms", "Spring of year 1");
  await pick("recruit_terms", "Fall of year 2"); await next();
  await pick("frontload", opts.frontload || "Yes — get core done early"); await page.keyboard.press("Enter");
  await pick("majors", "Finance");
  await pick("majors", "Entrepreneurship & Innovation"); await next();
  await page.locator("input[name='depth_know__0'][value='Some']").locator("..").click();
  await page.locator("input[name='depth_want__0'][value='Solid']").locator("..").click(); await next();
  // → review → submit
  await expect(page.getByText("Check your answers")).toBeVisible();
  await expect(page.locator("#review")).toContainText("Other: Teacher");
  await next();
  await page.waitForURL(/board\.html/);
}
const view = (page, v) => page.click(`.side a[data-go='${v}']`);

test.beforeEach(async ({ page }) => {
  page.on("pageerror", e => { throw new Error("Page error: " + e.message); });
  // never send test traffic to the real usage counter; record what would have been sent instead
  await page.route(/goatcounter\.com|gc\.zgo\.at/, r => r.abort());
  await page.addInitScript(() => localStorage.setItem("wcp.noDoublePrompt", "1"));   // double-count pop-ups have their own tests
  await page.addInitScript(() => { window.__gc = []; window.goatcounter = { count: o => window.__gc.push(o) };
    try { const prev = JSON.parse(sessionStorage.getItem("__gc") || "[]"); window.__gc = prev; } catch (e) {}
    window.addEventListener("beforeunload", () => sessionStorage.setItem("__gc", JSON.stringify(window.__gc))); });
  await page.goto("/index.html");
  await page.evaluate(() => localStorage.clear());
});

test("survey → board shows summary, Start here, recommendations and privacy", async ({ page }) => {
  await takeSurvey(page);
  await expect(page.locator(".side a.go.on")).toHaveText("Overview");
  await expect(page.locator(".summ-h")).toHaveText("Your plan");
  expect(await page.locator(".kpi").count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".tl")).toBeVisible();
  await expect(page.getByText("Not a fit")).toHaveCount(0);
  await expect(page.locator(".pv")).toContainText("Saved only in this browser");
  await expect(page.locator("footer .privacy")).toContainText("Nothing you enter is stored on a server");
  await view(page, "core");
  await expect(page.locator(".side a.go.on")).toHaveText("Core");
  await expect(page.getByText("Start here.")).toBeVisible();
  await view(page, "electives");
  await expect(page.locator(".reason.best, .reason.poss").first()).toBeVisible();
});

test("core: choosing a status and ticking a class updates the area and the calendar", async ({ page }) => {
  await takeSurvey(page);
  await view(page, "core");
  await page.locator("label:has(input[data-core='Accounting'][value='waived'])").click();
  await expect(page.locator(".cg", { hasText: "Accounting" }).first()).toContainText("✓ waived");
  await page.locator("label:has(input[data-core='Corporate finance'][value='take'])").click();
  await page.locator("input[data-pick='FNCE 6110']").first().check();
  await expect(page.locator(".cg", { hasText: "Corporate finance" }).first()).toContainText("✓ covered");
  await view(page, "calendar");
  await expect(page.locator(".cal [data-chip='FNCE 6110']")).toBeVisible();
});

test("electives: ✓ adds to Yes + calendar, ✕ moves to No, filters and search work", async ({ page }) => {
  await takeSurvey(page);
  await view(page, "electives");
  const first = page.locator(".col:nth-child(2) .card").first();
  const code = await first.getAttribute("data-code");
  await first.locator("[data-decide='yes']").click();
  await expect(page.locator(`.col:nth-child(1) .card[data-code='${code}']`)).toBeVisible();
  await view(page, "calendar");
  await expect(page.locator(`.cal [data-chip='${code}'], .tray [data-chip='${code}']`)).toBeVisible();
  await view(page, "electives");
  const second = page.locator(".col:nth-child(2) .card").first();
  const code2 = await second.getAttribute("data-code");
  await second.locator("[data-decide='no']").click();
  await expect(page.locator(`.col:nth-child(2) .card[data-code='${code2}']`)).toHaveCount(0);
  await expect(page.locator("[data-filter='rec']")).toHaveCount(0);   // "Recommended for you" filter was removed
  await expect(page.locator(".col:nth-child(2) .card").first().locator(".reason")).toBeVisible();   // best match first
  await page.fill("#q", "Negotiations");
  await expect(page.locator(".col:nth-child(2) .card").first()).toContainText("Negotiation");
});

test("calendar: lock, invalid drop shows a pop-up, Re-suggest keeps locks", async ({ page, isMobile }) => {
  await takeSurvey(page);
  await view(page, "electives");
  for (let i = 0; i < 3; i++) await page.locator(".col:nth-child(2) .card").first().locator("[data-decide='yes']").click();
  await view(page, "calendar");
  const chip = page.locator(".cal .chip.sugg").first();
  const code = await chip.getAttribute("data-chip");
  await chip.locator("[data-lock]").click();
  await expect(page.locator(`.cal .chip.locked[data-chip='${code}']`)).toBeVisible();
  const before = await page.locator(`.cal [data-chip='${code}']`).evaluate(e => e.closest("td").dataset.term + e.closest("td").dataset.slot);
  await page.click("[data-resuggest]");
  const after = await page.locator(`.cal [data-chip='${code}']`).evaluate(e => e.closest("td").dataset.term + e.closest("td").dataset.slot);
  expect(after).toBe(before);
  if (!isMobile) {
    const full = page.locator(".cal .chip").filter({ has: page.locator(".cu", { hasText: /^1$/ }) }).first();
    if (await full.count()) {
      await full.dragTo(page.locator(".cal td.slot[data-slot='Q1']").first());
      await expect(page.locator(".pop")).toContainText("Can't place that there");
      await page.locator(".pop button").click();
    }
  }
});

test("add your own class, theme toggle persists, feedback opens", async ({ page }) => {
  await takeSurvey(page);
  await view(page, "electives");
  await page.fill("#own-title", "Negotiation Workshop (Law School)");
  await page.press("#own-title", "Enter");
  await expect(page.locator(".card.own")).toContainText("Negotiation Workshop");
  await page.click("[data-theme-set='dark']");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.click("[data-feedback]");
  await expect(page.locator(".pop")).toContainText("Nothing is sent until you do");
});

test("redo survey is prefilled; start over clears everything", async ({ page }) => {
  await takeSurvey(page);
  await page.click("text=Update survey");
  await expect(page.locator("input[name='class'][value='Class of 2028']")).toBeChecked();
  await expect(page.locator("[data-other='background']")).toHaveValue("Teacher");
  await page.goto("/board.html");
  page.on("dialog", d => d.accept());
  await page.click("[data-startover]");
  await page.waitForURL(/index\.html/);
  expect(await page.evaluate(() => localStorage.getItem("wcp.state"))).toBeNull();
});

test("recruiting semesters from the survey are the ones kept lighter", async ({ page }) => {
  await takeSurvey(page);
  await view(page, "calendar");
  await expect(page.locator("input[data-rec=\"Spring '27\"]")).toBeChecked();
  await expect(page.locator("input[data-rec=\"Fall '27\"]")).toBeChecked();
  await expect(page.locator("input[data-rec=\"Spring '28\"]")).not.toBeChecked();
  await expect(page.locator("td.tn", { hasText: "Spring '27" })).toContainText("recruiting term");
});

test("usage counts send event names only — never answers", async ({ page }) => {
  await takeSurvey(page);
  await view(page, "electives");
  await page.locator(".col:nth-child(2) .card").first().locator("[data-decide='yes']").click();
  await page.locator(".col:nth-child(2) .card").first().locator("[data-decide='yes']").click();
  await page.click("[data-feedback]");
  const sent = await page.evaluate(() => window.__gc);
  const names = sent.map(o => o.path);
  expect(names).toContain("survey-completed");
  expect(names.filter(n => n === "plan-started").length).toBe(1);
  expect(names).toContain("feedback-opened");
  const payload = JSON.stringify(sent);
  for (const answer of ["Teacher", "Founder", "Finance", "hands-on", "No travel"]) expect(payload).not.toContain(answer);
  await expect(page.locator("footer .privacy")).toContainText("We count anonymous visits");
});

test("no sideways scrolling on the page", async ({ page }) => {
  await takeSurvey(page);
  for (const v of ["overview", "core", "majors", "electives", "calendar", "sources"]) {
    await view(page, v);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, v).toBeLessThanOrEqual(1);
  }
});
