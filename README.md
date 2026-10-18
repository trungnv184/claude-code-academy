# Conducting Claude

A free, hands-on course on agentic engineering with Claude Code. It covers the agent loop, CLAUDE.md, plan mode, goals and loops, hooks, skills and sub-agent orchestration. Each topic is a long-form lesson with interactive labs that run in the browser.

**Live site:** https://trungnv184.github.io/claude-code-academy/

Every push to `main` redeploys automatically through `.github/workflows/pages.yml`.

## Run it

It's a static site with no build step:

```bash
# any static server works
python3 -m http.server 8765
open http://localhost:8765
```

You can also open `index.html` directly from disk. Fonts load from Google Fonts. Everything else is local.

## Verify

Start the server first, then run:

```bash
scripts/smoke.sh                  # every page loads without JS errors; screenshots go to .smoke/
node scripts/check-labs.mjs       # clicks every lab, quiz and terminal hint; reports JS errors
node scripts/check-mobile.mjs     # no horizontal scroll at 390px phone width
```

All three need Google Chrome, and each should print `ok` for every page.

## Structure

```
index.html                 landing + curriculum
playground.html            full simulated Claude Code session (state machine)
lessons/01..09-*.html      lessons (essay + labs + terminal sim + quiz)
assets/styles.css          design system (light/dark tokens, lab + terminal components)
assets/app.js              shell: top bar, sidebar, progress, TUTOR.terminal, TUTOR.quiz
assets/widgets/*.js        one interactive lab per file, mounted via data-widget="…"
scripts/smoke.sh           headless-Chrome smoke test (JS errors + screenshots)
```

## Curriculum

| # | Lesson | Lab |
|---|--------|-----|
| 1 | The Agent Loop | Step through a verified and an unverified agent run |
| 2 | Context Is the Program | CLAUDE.md linter |
| 3 | Plan Before You Code | Plan vs. no-plan simulator, mode cycling |
| 4 | Goals & Loops | Goal-condition evaluator simulator |
| 5 | Hooks | Hook playground and settings.json generator |
| 6 | Skills | Skill builder and trigger tester |
| 7 | Sub-agents & the Orchestra | Parallel orchestration timeline |
| 8 | Capstone: ship "Snip" | Milestone tracker and full build replay |
| 9 | Cheat sheet & final exam | Searchable reference and a 15-question exam |

## Adding a lesson

1. Copy `lessons/01-agent-loop.html` and change `data-lesson`, the title and the content.
2. Register the lesson in the `LESSONS` array in `assets/app.js`.
3. Put any new lab in `assets/widgets/<name>.js`. Write it as an IIFE that calls `TUTOR.ready(...)` and mounts on `[data-widget=<name>]`.
4. Run `scripts/smoke.sh`. It must print `ok` for every page.

The terminal sessions are scripted simulations for teaching, not a real model. Check the [official docs](https://code.claude.com/docs) for current behavior.
