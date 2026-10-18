# Conducting Claude (tutorial site)

Static site. No build step, no frameworks, no npm dependencies. Must keep working from `file://`.

## Commands
- Preview: `python3 -m http.server 8765` then open http://localhost:8765
- Verify (run before saying "done"): `scripts/smoke.sh` → every page must print `ok`
- JS syntax: `node --check assets/app.js assets/widgets/*.js`

## Conventions
- Lessons follow the structure of `lessons/01-agent-loop.html`: eyebrow, h1, dek, byline, objectives, `data-toc`, essay sections, ≥1 lab, terminal sim, key takeaways, quiz.
- Widgets: ES5-style IIFE in `assets/widgets/<name>.js`, mounted via `TUTOR.ready` on `[data-widget=<name>]`. No external libraries.
- Colors only via CSS tokens in `assets/styles.css`; every new color needs a dark-mode value.
- Wrap all `localStorage` access in try/catch.
- Voice: long-form, opinionated, concrete. Use real config that people can copy. Paraphrase external authors and link them. Never invent quotes.
- Facts about Claude Code must match the official docs (https://code.claude.com/docs). If unsure, leave it out.
