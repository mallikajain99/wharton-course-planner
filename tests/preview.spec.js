// Regenerates preview-overview.jpg — the picture of a sample plan on the welcome screen (laptop only).
// Runs with the full suite before every push, so the picture always matches the live site. The student is made up.
const { test, expect } = require("@playwright/test");
const path = require("path");
const personas = require("./personas.json");

test("welcome preview: regenerate the sample-plan picture, and it shows on laptop only", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "captured once, at laptop size");
  test.setTimeout(120000);
  const survey = Object.assign({}, personas.find(p => p.id === "x-five-majors").survey,
    { class: "Class of 2028", majors: ["Artificial Intelligence for Business", "Entrepreneurship & Innovation", "Finance"], recruit_terms: ["Spring of year 1"] });
  const P = (term, slot, status) => ({ term, slot, locked: !!status, why: null, status });
  const state = { plan: { "MGMT 6100": P("Summer '26", null, "taken"), "BEPP 6110": P("Fall '26", "Q1", "taken"), "BEPP 6120": P("Fall '26", "Q2", "inprogress"), "STAT 6210": P("Fall '26", "Q1", "taken"),
      "ACCT 6110": P("Fall '26", "Full", "inprogress"), "FNCE 6110": P("Fall '26", "Full", "inprogress"), "MGMT 6120": P("Fall '26", "Full", "inprogress"),
      "FNCE 6130": P(null, null), "MKTG 6120": P(null, null), "OIDD 6120": P(null, null), "OIDD 6620": P(null, null), "LGST 6120": P(null, null), "WHCP 6140": P(null, null) },
    dec: {}, core: { "Leadership": "take", "Marketing Management": "waived", "Microeconomics": "take", "Statistics": "substituted", "Writing requirement": "waived", "Communication": "take",
      "Accounting": "take", "Corporate finance": "take", "Macroeconomics": "take", "Management": "take", "Marketing strategy": "take", "Operations, Information & Decisions": "take", "Legal studies & ethics": "take" },
    changes: 0, ownN: 0, use: { "OIDD 6120": "flex", "OIDD 6620": "flex" } };
  await page.route(/goatcounter\.com|gc\.zgo\.at/, r => r.abort());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/index.html");
  await page.evaluate(([a, s]) => { localStorage.clear(); localStorage.setItem("wcp.answers", JSON.stringify(a)); localStorage.setItem("wcp.state", JSON.stringify(s)); localStorage.setItem("wcp.noDoublePrompt", "1"); }, [survey, state]);
  await page.goto("/board.html#calendar");
  for (let i = 0; i < 7; i++) await page.locator("[data-addplan]").first().click();
  await page.click("[data-resuggest]");
  await page.goto("/board.html#overview");
  await page.waitForTimeout(3200);   // let the "Added…" notes fade
  await page.addStyleTag({ content: ".toast,.updnote,.side,footer,.next{display:none!important}.shell{display:block!important}" });
  await page.waitForTimeout(200);
  await page.locator("#app").screenshot({ path: path.join(__dirname, "..", "preview-overview.jpg"), type: "jpeg", quality: 82 });
  // the welcome screen shows it beside the steps on a laptop…
  await page.goto("/index.html");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/index.html");
  await expect(page.locator(".welcome .pv img")).toBeVisible();
  expect(await page.locator(".welcome .pv img").evaluate(i => i.naturalWidth)).toBeGreaterThan(800);
  // …and not on a phone
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".welcome .pv")).toBeHidden();
});
