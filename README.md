# Wharton MBA course planner

Wharton MBA course planner — a short survey turns your goals into personalized recommendations across 270+
Wharton courses, tracks core, flex core and major requirements, and builds a two-year calendar. Built solo with
Claude Code.

**Try it:** https://mallikajain99.github.io/wharton-course-planner/

## What it does

1. **Survey (about 3 minutes).** Background, skills, goals, industries, recruiting timeline, the majors you're
   exploring, how much you already know and want to learn in each area, and whether to front-load core.
2. **Core and flex core.** Every requirement area, marked *Take*, *Waived* or *Substituted*, with the documented
   substitute lists.
3. **Majors.** All 22 Wharton MBA majors, each with its required courses, elective groups (minimums and caps),
   progress, which majors can't be combined, and Wharton's double-counting rule (at most 2.0 CU counting toward
   two majors).
4. **Electives.** The full catalog in Yes / Maybe / No columns. Everything starts in *Maybe*; classes that match
   your answers are labeled **Best fit** or **Good fit** with the reason. Nothing is ever labeled "not a fit" —
   the planner highlights, the student decides.
5. **Calendar.** Classes are placed automatically: core first (or spread out, your choice), about 4.5 CU per
   semester, lighter recruiting terms, quant-heavy courses spread out. Drag to rearrange, lock what you're sure
   of, and re-suggest the rest.

Your answers and plan are saved in your own browser (localStorage). Nothing is sent anywhere.

## How the recommendations work

No AI runs while you use the planner, so it's free to host and private by design. Instead:

- Every course was tagged once (area, depth level, quant load, roles and industries it serves).
- 132 varied sample student profiles (including 32 added for the newest majors) were written and each was rated course-by-course by an AI model, using only
  the profile's survey answers.
- From those ratings the planner learned, for every course, how much each survey answer raises or lowers the
  chance it's a fit — with shrinkage so thin evidence doesn't produce noisy weights. A small rule boosts
  foundational classes in areas where you want to grow beyond what you know.
- Cutoffs for *Best fit* and *Good fit* were calibrated on held-out profiles: Best-fit classes were picks about
  three-quarters of the time, Good-fit classes more often than not.

### How it was tested

Each approach was scored against **expert answer keys** — an advisor-style pick of the 20 best electives for each
sample student, written from that student's full profile (more than the survey captures). Every model was tested
only on students it was never trained on.

| Approach | Tested on | Expert's top 20 found in its top 20 | …in its top 30 |
|---|---|---|---|
| Hand-written rules | 5 profiles | 7.4 | 10.6 |
| **Learned weights (this planner)** | **132 profiles, 5-fold cross-validation** | **10.4** | **13.1** |
| Live AI ranking per student | 5 profiles | 14.2 | 16.6 |
| A second independent expert | 5 profiles | 17.8 | 19.2 |

Live AI ranks best but costs money for every student; the learned version captures part of that judgment at zero
running cost. Experiments that didn't make the cut: more detailed course tags (+0.3 classes), two extra survey
questions about favorite topics and goals for electives (+0.2), and sharing weights across courses with the same
tags (worse, −1.0). Adding 32 profiles for the four newest majors lifted those students by +1.3 classes. Beyond that, training on more profiles didn't move held-out results either — the limit is judging full course
descriptions, which only live AI does.

## Sources

- Courses: [Wharton MBA elective course list](https://mba.wharton.upenn.edu/elective-course-list/), Excel
  export of Oct 21 2026. Classes change during the year — check the live list before registering.
- Wharton classes only; other Penn schools aren't included (add them yourself with "+ Add a class you don't see").
- Majors: each major's official department page, linked from Wharton's
  [MBA majors list](https://mba.wharton.upenn.edu/mba-majors/), pulled Oct 27 2026 (every source is linked in the
  planner). Some listed courses aren't in this year's course list.
- Core rules from Wharton's MBA program pages. Always confirm requirements with your academic advisor.

## Running it

It's static HTML and JavaScript — open `index.html` in a browser, or serve the folder with any static host.
`data.js` holds the course list, tags, learned weights and requirement rules.

## Tests

- **Browser tests** (`tests/planner.spec.js`, Playwright): a student takes the survey and uses the planner in a
  real browser, at desktop and phone sizes — survey answers, core statuses, picking and ruling out classes,
  filters and search, calendar locks and Re-suggest, adding your own class, dark mode, redo and start over, and
  no sideways scrolling. Run with `npm install && npx playwright install chromium && npm test`.
- A separate scripted suite (kept with the data pipeline) runs the planner's logic for 106 sample students
  and checks over 1,800 rules: scores match the evaluated model, valid calendar slots, locked classes never
  move, waived areas leave the totals, and more.
