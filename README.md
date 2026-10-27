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
3. **Majors.** Required courses and elective buckets with progress, plus Wharton's double-counting rule (at most
   2.0 CU counting toward two majors). Requirement data so far: Finance, Entrepreneurship & Innovation, and AI for
   Business.
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
- 100 varied sample student profiles were written and each was rated course-by-course by an AI model, using only
  the profile's survey answers.
- From those ratings the planner learned, for every course, how much each survey answer raises or lowers the
  chance it's a fit — with shrinkage so thin evidence doesn't produce noisy weights. A small rule boosts
  foundational classes in areas where you want to grow beyond what you know.
- Cutoffs for *Best fit* and *Good fit* were calibrated on held-out profiles: Best-fit classes were picks about
  three-quarters of the time, Good-fit classes more often than not.

### How it was tested

Several designs were compared against expert-written answer keys for held-out student profiles, scored on how
many of the expert's top 20 classes each design surfaced:

| Approach | Expert's top 20 found in the top 30 recommendations |
|---|---|
| Hand-written rules | ~11 |
| **Learned weights (this planner)** | **~12, with more right labels and fewer wrong ones** |
| Live AI ranking per student | ~17 |
| A second independent expert | ~19 |

Live AI ranks best but costs money per student; the learned version captures part of that judgment at zero
running cost. Training on more profiles didn't move the held-out results, which pointed to the limit being the
per-answer model rather than the data.

## Sources

- Courses: [Wharton MBA elective course list](https://mba.wharton.upenn.edu/elective-course-list/), Excel
  export of Oct 21 2026. Classes change during the year — check the live list before registering.
- Wharton classes only; other Penn schools aren't included (add them yourself with "+ Add a class you don't see").
- Core and major rules from Wharton's MBA program pages and the Penn catalog. Always confirm with your academic
  advisor.

## Running it

It's static HTML and JavaScript — open `index.html` in a browser, or serve the folder with any static host.
`data.js` holds the course list, tags, learned weights and requirement rules.
