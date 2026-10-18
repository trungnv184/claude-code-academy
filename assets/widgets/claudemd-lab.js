/* Lab: a CLAUDE.md linter.
   Scores a CLAUDE.md against practical heuristics as you type,
   explains each finding, and can load an improved example. */
(function () {
  "use strict";

  var MEDIOCRE = [
    "# Project",
    "",
    "This is our app. Please write good code and follow best practices.",
    "IMPORTANT: be careful. IMPORTANT: don't break things. IMPORTANT: write clean code.",
    "",
    "We use React and some backend stuff. ALWAYS use TypeScript. NEVER use any.",
    "",
    "Our staging key is sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c so you can test payments.",
    "",
    "## API docs",
    "(pasted from the wiki)",
    "GET /api/v1/users returns a list of users with fields id, name, email, created_at, updated_at, role, avatar_url, locale, timezone, last_login_at, ...",
    "GET /api/v1/users/:id returns a single user with fields id, name, email, created_at, updated_at, role, avatar_url, locale, timezone, last_login_at, ...",
    "POST /api/v1/users creates a user with fields name, email, role, avatar_url, locale, timezone, ...",
    "",
    "Try to make the code nice."
  ].join("\n");

  var IMPROVED = [
    "# shop-web",
    "",
    "Next.js 15 storefront + tRPC API. Postgres via Prisma. pnpm workspace.",
    "",
    "## Commands",
    "- `pnpm dev` — start app on :3000",
    "- `pnpm test` — Vitest unit tests (run a single file: `pnpm test path/to/file`)",
    "- `pnpm typecheck && pnpm lint` — run both before saying a task is done",
    "- `pnpm db:migrate` — apply Prisma migrations (never edit applied migrations)",
    "",
    "## Architecture",
    "- `app/` routes (server components by default) → `server/routers/*` tRPC → `server/services/*` → Prisma",
    "- Business logic lives in services, never in route handlers",
    "- API reference: @docs/api.md (read it before touching `server/routers`)",
    "",
    "## Conventions",
    "- TypeScript strict; no `any` without a `// reason:` comment",
    "- Money is integer cents (`priceCents`), never floats",
    "- Tests sit next to code as `*.test.ts`; add one for every bug fix",
    "",
    "## Workflow",
    "- For multi-file changes, propose a plan first",
    "- Secrets come from `.env.local` (gitignored); never read or print it",
    "- YOU MUST run `pnpm typecheck && pnpm test` and show the result before reporting done"
  ].join("\n");

  // Each rule returns null (pass) or { level, msg, fix }.
  var RULES = [
    { id: "commands", weight: 20, check: function (t) {
      return /^#+\s*(commands|scripts|build|dev(elopment)?\s*commands|how to run)/im.test(t) ? null :
        { level: "bad", msg: "No commands section.", fix: "Add a '## Commands' list with the exact build, test, lint and typecheck commands. This is the highest-value content in any CLAUDE.md." };
    }},
    { id: "verify", weight: 20, check: function (t) {
      return /(npm|pnpm|yarn|bun)\s+(run\s+)?(test|typecheck|lint|check)|pytest|go test|cargo (test|check)|tsc\b|make test|mvn test|gradle test/i.test(t) ? null :
        { level: "bad", msg: "No verification command.", fix: "Name the command that proves the work is correct (e.g. `pnpm test && pnpm typecheck`) and tell Claude to run it before claiming done." };
    }},
    { id: "secrets", weight: 25, check: function (t) {
      return /(sk-(live|test|proj|ant)?-?[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]\s*\S{6,}|api[_-]?key\s*[:=]\s*\S{12,})/i.test(t) ?
        { level: "bad", msg: "Looks like a secret is committed in the file.", fix: "Remove it and rotate it. CLAUDE.md is checked into git and loaded into every session. Point to where secrets live (e.g. `.env.local`) instead." } : null;
    }},
    { id: "vague", weight: 10, check: function (t) {
      var hits = t.match(/\b(good code|best practices|clean code|be careful|make (the )?code nice|high quality|don'?t break things|properly)\b/gi);
      return hits ? { level: "warn", msg: "Vague instructions: " + unique(hits).map(q).join(", ") + ".", fix: "Replace each with something checkable: 'Use 2-space indentation', 'Money is integer cents', 'Add a test for every bug fix'." } : null;
    }},
    { id: "shouting", weight: 10, check: function (t) {
      var n = (t.match(/\b(IMPORTANT|CRITICAL|MUST|NEVER|ALWAYS)\b/g) || []).length;
      return n > 3 ? { level: "warn", msg: n + " shouted keywords (IMPORTANT/MUST/NEVER...).", fix: "Emphasis works when it's rare. Keep it for the one or two rules that truly matter, and move anything that must never happen into a hook." } : null;
    }},
    { id: "length", weight: 10, check: function (t) {
      var lines = t.split("\n").length;
      if (lines > 200) return { level: "bad", msg: lines + " lines. Over the ~200-line guideline.", fix: "Every line costs context in every session. Move reference material to separate files and @import them, or split into .claude/rules/*.md." };
      if (lines < 6) return { level: "warn", msg: "Very short (" + lines + " lines).", fix: "A few lines of commands, architecture and conventions pays for itself quickly. Try /init for a starting draft." };
      return null;
    }},
    { id: "dump", weight: 10, check: function (t) {
      var longLines = t.split("\n").filter(function (l) { return l.length > 140; }).length;
      var pasted = /\(pasted|copied from|from the wiki|see below for full/i.test(t);
      return (longLines >= 3 || pasted) ? { level: "warn", msg: "Looks like pasted reference docs.", fix: "Don't inline API docs or wiki pages. Put them in docs/*.md and reference them with @docs/api.md so they load only when needed." } : null;
    }},
    { id: "architecture", weight: 10, check: function (t) {
      return /^#+\s*(architecture|structure|layout|overview|project map)/im.test(t) || /src\/|app\/|server\/|lib\//.test(t) ? null :
        { level: "warn", msg: "No map of the codebase.", fix: "Add 3–6 bullets on where things live (e.g. 'routes → services → db'). It saves Claude dozens of exploratory reads." };
    }}
  ];

  function unique(a) { var s = {}; return a.filter(function (x) { x = x.toLowerCase(); return s[x] ? false : (s[x] = true); }); }
  function q(s) { return "“" + s + "”"; }

  function lint(text) {
    var total = 0, got = 0, findings = [];
    RULES.forEach(function (r) {
      total += r.weight;
      var f = r.check(text);
      if (f) { f.id = r.id; findings.push(f); if (f.level === "warn") got += r.weight * 0.4; }
      else got += r.weight;
    });
    return { score: Math.round(got / total * 100), findings: findings };
  }

  function mount(host) {
    var E = window.TUTOR.esc;
    host.innerHTML =
      '<div class="lab-head"><span class="lab-badge">Lab</span><span class="lab-title">Lint a CLAUDE.md</span></div>' +
      '<div class="lab-body">' +
        '<p>The file below is the kind of CLAUDE.md that accumulates in real repos. Edit it and the score updates live. Try fixing each finding, or load the improved version to compare.</p>' +
        '<div class="lab-row">' +
          '<div><label for="cm-text">CLAUDE.md</label><textarea id="cm-text" class="cm-text" rows="18" spellcheck="false"></textarea>' +
            '<div class="btn-row"><button class="btn" data-act="improved">Load improved example</button><button class="btn ghost" data-act="reset">Reset to original</button></div></div>' +
          '<div><label>Score</label>' +
            '<div style="display:flex;align-items:baseline;gap:10px"><span class="cm-score" style="font-family:var(--serif);font-size:44px;font-weight:600;line-height:1">0</span><span style="color:var(--ink-3)">/ 100</span><span class="cm-grade chip"></span></div>' +
            '<div class="progress-bar" style="height:8px;margin:10px 0 14px"><span class="cm-bar"></span></div>' +
            '<label>Findings</label><ul class="cm-findings" style="list-style:none;padding:0;margin:0"></ul>' +
          '</div>' +
        '</div>' +
      '</div>';

    var ta = host.querySelector(".cm-text");
    var scoreEl = host.querySelector(".cm-score"), bar = host.querySelector(".cm-bar"), grade = host.querySelector(".cm-grade");
    var list = host.querySelector(".cm-findings");

    function update() {
      var r = lint(ta.value);
      scoreEl.textContent = r.score;
      bar.style.width = r.score + "%";
      bar.style.background = r.score >= 85 ? "var(--green)" : r.score >= 55 ? "var(--amber)" : "var(--red)";
      grade.textContent = r.score >= 85 ? "Ship it" : r.score >= 55 ? "Needs work" : "Rewrite";
      grade.className = "cm-grade chip " + (r.score >= 85 ? "ok" : r.score >= 55 ? "warn" : "bad");
      if (!r.findings.length) {
        list.innerHTML = '<li class="callout tip" style="margin:0"><div class="callout-icon">✓</div><div><p>No findings. Concise, specific and checkable. Remember it\'s still advisory, so put hard rules in hooks.</p></div></li>';
        return;
      }
      list.innerHTML = r.findings.map(function (f) {
        return '<li style="padding:10px 0;border-top:1px solid var(--rule)"><div style="display:flex;gap:8px;align-items:flex-start">' +
          '<span class="chip ' + (f.level === "bad" ? "bad" : "warn") + '" style="flex:none">' + (f.level === "bad" ? "fix" : "improve") + '</span>' +
          '<div><div style="font-weight:600;font-size:14px">' + E(f.msg) + '</div><div style="font-size:13.5px;color:var(--ink-2);margin-top:2px">' + E(f.fix) + "</div></div></div></li>";
      }).join("");
    }

    ta.value = MEDIOCRE;
    ta.addEventListener("input", update);
    host.querySelector('[data-act="improved"]').addEventListener("click", function () { ta.value = IMPROVED; update(); });
    host.querySelector('[data-act="reset"]').addEventListener("click", function () { ta.value = MEDIOCRE; update(); });
    update();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=claudemd-lab]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
