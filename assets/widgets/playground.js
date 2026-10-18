/* Playground: a stateful, simulated Claude Code session.
   Commands change shared state (mode, goal, hooks, files, context) and later
   commands respect it — e.g. an installed PreToolUse hook blocks `rm -rf`,
   plan mode blocks edits, and an active /goal adds an evaluator after each turn. */
(function () {
  "use strict";

  var MODES = ["default", "acceptEdits", "plan", "auto"];
  var MODE_LABEL = {
    default: "default — asks before edits",
    acceptEdits: "⏵⏵ accept edits on",
    plan: "⏸ plan mode on",
    auto: "⏵⏵ auto mode on"
  };
  var INITIAL_FILES = ["README.md", "package.json", "src/App.jsx", "src/index.css", "src/App.test.jsx", "build/"];

  var HOOK_CATALOG = {
    "block-rm": { event: "PreToolUse", matcher: "Bash", desc: "exit 2 on rm -rf / force push" },
    "format": { event: "PostToolUse", matcher: "Edit|Write", desc: "prettier --write on changed file" },
    "test-gate": { event: "Stop", matcher: "", desc: "block stop while tests fail" }
  };
  var SKILLS = [
    { name: "release-notes", desc: "Write release notes from git log. Use when asked for a changelog or release notes.", re: /release notes|changelog/i },
    { name: "add-component", desc: "Scaffold a React component + test. Use when asked to create a new component.", re: /\b(new|create|scaffold)\b.*\bcomponent\b/i }
  ];
  var AGENTS = [
    { name: "Explore", src: "built-in", desc: "read-only codebase search" },
    { name: "Plan", src: "built-in", desc: "read-only research for plan mode" },
    { name: "general-purpose", src: "built-in", desc: "all tools, multi-step tasks" },
    { name: "code-reviewer", src: ".claude/agents", desc: "reviews diffs, read-only tools" }
  ];
  var MISSIONS = [
    { id: "init", text: "Create project memory with /init" },
    { id: "plan", text: "Get a plan (not edits) out of plan mode" },
    { id: "hookblock", text: "Install the block-rm hook, then ask Claude to delete the build folder" },
    { id: "goal", text: "Set a /goal and watch the evaluator reach “met”" },
    { id: "skill", text: "Trigger a skill without naming it (hint: release notes)" },
    { id: "agent", text: "Delegate a review to the code-reviewer sub-agent" }
  ];

  var S = {
    mode: 0, goal: null, goalTurns: 0, hooks: [], files: INITIAL_FILES.slice(), turns: 0, done: {}, newFiles: {}
  };

  function mode() { return MODES[S.mode]; }
  function has(f) { return S.files.indexOf(f) !== -1; }
  function addFile(f) { if (!has(f)) { S.files.push(f); S.newFiles[f] = 1; } }
  function hook(id) { return S.hooks.indexOf(id) !== -1; }
  function ctxPct() { return Math.min(98, 9 + S.turns * 6); }
  function complete(id) { S.done[id] = 1; }

  var E, panel;

  /* ---------- Side panel ---------- */
  function render() {
    if (!panel) return;
    var m = mode();
    var html = '<div class="pg-card"><div class="pg-h">Permission mode</div>' +
      '<div class="pg-modes">' + MODES.map(function (x, i) {
        return '<button type="button" class="pg-mode' + (i === S.mode ? " on" : "") + '" data-mode="' + i + '">' + x + "</button>";
      }).join("") + '</div><div class="pg-sub">Type <code>shift+tab</code> to cycle</div></div>';

    html += '<div class="pg-card"><div class="pg-h">Goal</div>' +
      (S.goal ? '<div class="pg-goal">◎ ' + E(S.goal) + '</div><div class="pg-sub">evaluated after every turn · <code>/goal clear</code> to remove</div>'
              : '<div class="pg-sub">No goal. Try <code>/goal all tests pass and the toggle works</code></div>') + "</div>";

    html += '<div class="pg-card"><div class="pg-h">Hooks</div>' +
      (S.hooks.length ? "<ul class=\"pg-list\">" + S.hooks.map(function (h) {
        var d = HOOK_CATALOG[h];
        return "<li><span class=\"chip vio\">" + d.event + "</span> <code>" + E(h) + "</code><div class=\"pg-sub\">" + (d.matcher ? E(d.matcher) + " · " : "") + E(d.desc) + "</div></li>";
      }).join("") + "</ul>" : '<div class="pg-sub">None installed. Try <code>/hooks install block-rm</code></div>') + "</div>";

    html += '<div class="pg-card"><div class="pg-h">Context</div>' +
      '<div class="progress-bar" style="height:10px"><span style="width:' + ctxPct() + '%;' + (ctxPct() > 75 ? "background:var(--red)" : "") + '"></span></div>' +
      '<div class="pg-sub">' + ctxPct() + "% used · " + S.turns + " turn" + (S.turns === 1 ? "" : "s") + "</div></div>";

    html += '<div class="pg-card"><div class="pg-h">Project files <span class="pg-sub">~/todo-app</span></div><ul class="pg-files">' +
      S.files.slice().sort().map(function (f) {
        return "<li" + (S.newFiles[f] ? ' class="new"' : "") + ">" + (/\/$/.test(f) ? "📁 " : "📄 ") + E(f) + (S.newFiles[f] ? ' <span class="chip ok">new</span>' : "") + "</li>";
      }).join("") + "</ul></div>";

    html += '<div class="pg-card"><div class="pg-h">Missions <span class="pg-sub">' + Object.keys(S.done).length + "/" + MISSIONS.length + "</span></div><ul class=\"pg-missions\">" +
      MISSIONS.map(function (x) { return "<li class=\"" + (S.done[x.id] ? "done" : "") + "\"><span>" + (S.done[x.id] ? "✓" : "○") + "</span>" + E(x.text) + "</li>"; }).join("") + "</ul></div>";

    panel.innerHTML = html;
  }
  function R() { return ["fn", render, 30]; }

  /* ---------- Goal evaluator, appended after work turns ---------- */
  function afterTurn(steps, evidence) {
    S.turns++;
    if (hook("test-gate")) steps.push(["hook", "Stop hook test-gate → npm test ✓ green, stop allowed"]);
    if (S.goal) {
      S.goalTurns++;
      // The evaluator can't run tools: it only accepts evidence already shown in the transcript.
      if (/test/i.test(S.goal) && !evidence.tests) {
        steps.push(["hook", "◎ Goal evaluator → not yet met: no test output shown in the transcript"]);
        steps.push(["claude", "The goal needs proof. Running the suite."]);
        steps.push(["tool", "Bash(npm test)"], ["toolout", "✓ 9 passed"]);
        S.turns++;
      }
      if (/lint/i.test(S.goal) && !evidence.lint) {
        steps.push(["hook", "◎ Goal evaluator → not yet met: lint result not shown"]);
        steps.push(["claude", "Continuing — the goal also requires a clean lint."]);
        steps.push(["tool", "Bash(npm run lint)"], ["toolout", "✗ 1 problem: 'useEffect' is defined but never used"]);
        steps.push(["tool", "Edit(src/App.jsx)"], ["tool", "Bash(npm run lint)"], ["toolout", "✓ 0 problems"]);
        S.goalTurns++; S.turns++;
      }
      steps.push(["hook", "◎ Goal evaluator → met: " + S.goal]);
      steps.push(["ok", "✓ Goal achieved after " + S.goalTurns + " turn" + (S.goalTurns === 1 ? "" : "s") + " — goal cleared"]);
      steps.push(["fn", function () { S.goal = null; S.goalTurns = 0; complete("goal"); render(); }, 30]);
    }
    if (ctxPct() > 85) steps.push(["sys", "  Context is getting full — consider /compact or /clear (state lives in files)."]);
    steps.push(R());
    return steps;
  }

  /* ---------- Generic task: gather → act → verify, respecting mode ---------- */
  function featureFile(input) {
    var map = [[/dark|theme/i, "src/ThemeToggle.jsx"], [/login|auth/i, "src/Login.jsx"], [/search|filter/i, "src/SearchBar.jsx"],
               [/due|date/i, "src/DueDate.jsx"], [/test/i, "src/App.test.jsx"], [/style|css|color/i, "src/index.css"]];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(input)) return map[i][1];
    var w = (input.match(/[a-z]{4,}/gi) || ["Feature"]).filter(function (x) { return !/^(please|could|would|make|with|that|this|from|into|have|some|the|add|build|create|implement)$/i.test(x); })[0] || "Feature";
    return "src/" + w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() + ".jsx";
  }

  function task(input) {
    // "implement the plan" reuses the file from the last plan-mode answer.
    var followsPlan = S.lastPlan && /implement|the plan|go ahead|do it|proceed/i.test(input);
    var file = followsPlan ? S.lastPlan : featureFile(input), m = mode(), steps = [];
    if (followsPlan && m !== "plan") { input = S.lastPlanTask; S.lastPlan = null; }
    steps.push(["tool", "Grep(\"" + (input.split(/\s+/).slice(-2).join(" ").replace(/"/g, "")) + "\")"], ["toolout", "src/App.jsx:12, src/index.css:3"]);
    steps.push(["tool", "Read(src/App.jsx)"], ["toolout", "Read 84 lines"]);
    if (has("CLAUDE.md")) steps.push(["sys", "  (following CLAUDE.md: pnpm, Vitest, named exports)"]);

    if (m === "plan") {
      steps.push(["plan", "Plan: " + input]);
      steps.push(["plan", "  1. Create " + file + " (state + UI)"]);
      steps.push(["plan", "  2. Wire it into src/App.jsx"]);
      steps.push(["plan", "  3. Add tests to src/App.test.jsx, then run npm test"]);
      steps.push(["sys", "  Edits are blocked in plan mode. Approve by switching mode (shift+tab) and asking me to implement."]);
      S.lastPlan = file; S.lastPlanTask = input;
      steps.push(["fn", function () { complete("plan"); }, 10]);
      S.turns++;
      steps.push(R());
      return steps;
    }

    function edit(tool, f) {
      if (m === "default") steps.push(["mode", "  ? Allow " + tool + "(" + f + ")?  ▸ Yes  (simulated: you approved)"]);
      steps.push(["tool", tool + "(" + f + ")"]);
      steps.push(["fn", function () { addFile(f); render(); }, 20]);
      if (hook("format")) steps.push(["hook", "PostToolUse format → prettier --write " + f + " ✓"]);
    }
    edit(has(file) ? "Edit" : "Write", file);
    edit("Edit", "src/App.jsx");
    edit("Edit", "src/App.test.jsx");
    steps.push(["tool", "Bash(npm test)"]);
    if (m === "default") steps.push(["sys", "  (allowed by settings: Bash(npm test *))"]);
    steps.push(["toolout", "✓ 9 passed (2 new)"]);
    steps.push(["claude", "Done: " + input.replace(/\.$/, "") + ". Created/updated " + file + ", wired into App.jsx, 2 new tests passing."]);
    return afterTurn(steps, { tests: true });
  }

  /* ---------- Command handlers ---------- */
  function handle(raw) {
    var input = raw.trim(), low = input.toLowerCase(), steps;

    if (low === "shift+tab" || low === "shift tab" || low === "/mode") {
      S.mode = (S.mode + 1) % MODES.length;
      return [["mode", "  " + MODE_LABEL[mode()]], R()];
    }
    if (low === "/help") {
      return [
        ["sys", "Playground commands (simulated):"],
        ["sys", "  shift+tab            cycle mode: default → acceptEdits → plan → auto"],
        ["sys", "  /init                create CLAUDE.md          /context   context usage"],
        ["sys", "  /plan [task]         plan mode (+ plan task)   /clear     reset conversation"],
        ["sys", "  /goal <condition>    set a goal  ·  /goal  status  ·  /goal clear"],
        ["sys", "  /hooks               list  ·  /hooks install block-rm|format|test-gate  ·  /hooks remove <id>"],
        ["sys", "  /agents  /skills     list sub-agents / skills  ·  /loop 5m <prompt>"],
        ["sys", "Or just ask: “add a dark mode toggle”, “delete the build folder”,"],
        ["sys", "“write release notes”, “use the code-reviewer agent to review my changes”"]
      ];
    }
    if (low === "/init") {
      if (has("CLAUDE.md")) return [["tool", "Read(CLAUDE.md)"], ["claude", "CLAUDE.md already exists. Suggestion: add the test command and a 'Never' section — keep it under ~60 lines."]];
      S.turns++;
      return [
        ["tool", "Glob(**/*)"], ["toolout", S.files.length + " files"],
        ["tool", "Read(package.json)"], ["toolout", "react 18 · vite · vitest · pnpm"],
        ["tool", "Write(CLAUDE.md)"],
        ["fn", function () { addFile("CLAUDE.md"); complete("init"); render(); }, 20],
        ["toolout", "# todo-app\n## Commands\n- pnpm dev · pnpm test · pnpm lint\n## Conventions\n- Named exports, Vitest + Testing Library"],
        ["claude", "Created CLAUDE.md. It loads into every session from now on — future answers will follow it."],
        R()
      ];
    }
    if (low === "/context") {
      var p = ctxPct(), bar = "";
      for (var i = 0; i < 30; i++) bar += i < Math.round(p / 100 * 30) ? "▓" : "░";
      return [
        ["sys", "Context usage (simulated)"],
        ["sys", "  " + bar + "  " + p + "%"],
        ["sys", "  system + tools ~9% · memory " + (has("CLAUDE.md") ? "~1%" : "0%") + " · messages ~" + Math.max(0, p - 9) + "% (" + S.turns + " turns)"],
        ["sys", p > 60 ? "  Tip: /compact or /clear — persist state to files first." : "  Plenty of room."]
      ];
    }
    if (low === "/clear") {
      S.turns = 0; S.goal = null; S.goalTurns = 0;
      return [["clear"], ["sys", "(conversation cleared · files kept · goal removed · CLAUDE.md reloads next message)"], R()];
    }
    if (low === "/compact") {
      S.turns = Math.floor(S.turns / 3);
      return [["sys", "Compacting conversation…"], ["sys", "  Summarized history; key decisions preserved."], R()];
    }
    if (low.indexOf("/plan") === 0) {
      S.mode = 2;
      var t = input.slice(5).trim();
      steps = [["mode", "  " + MODE_LABEL.plan], R()];
      return t ? steps.concat(task(t)) : steps.concat([["sys", "  Plan mode: I'll read and propose, but not edit. What should we plan?"]]);
    }
    if (low.indexOf("/goal") === 0) {
      var cond = input.slice(5).trim();
      if (!cond) return [["sys", S.goal ? "◎ Active goal: " + S.goal + " (" + S.goalTurns + " turns so far)" : "No active goal. Usage: /goal <condition>"]];
      if (/^(clear|stop|off|reset|none|cancel)$/i.test(cond)) { S.goal = null; S.goalTurns = 0; return [["sys", "Goal cleared."], R()]; }
      S.goal = cond; S.goalTurns = 0;
      steps = [["hook", "◎ Goal set: " + cond], ["sys", "  A Stop-hook evaluator will check the transcript after every turn."], R()];
      if (mode() === "plan") return steps.concat([["sys", "  You're in plan mode — the goal can't be met without edits. shift+tab to switch, then give me a task."]]);
      return steps.concat(task(cond));
    }
    if (low.indexOf("/hooks") === 0) {
      var parts = low.split(/\s+/);
      if (parts[1] === "install" && HOOK_CATALOG[parts[2]]) {
        if (!hook(parts[2])) S.hooks.push(parts[2]);
        var h = HOOK_CATALOG[parts[2]];
        return [["tool", "Edit(.claude/settings.json)"], ["fn", function () { addFile(".claude/settings.json"); addFile(".claude/hooks/" + parts[2] + ".sh"); render(); }, 20],
          ["hook", "Installed " + parts[2] + " → " + h.event + (h.matcher ? " [" + h.matcher + "]" : "") + ": " + h.desc], R()];
      }
      if (parts[1] === "remove" && hook(parts[2])) {
        S.hooks.splice(S.hooks.indexOf(parts[2]), 1);
        return [["sys", "Removed hook " + parts[2] + "."], R()];
      }
      if (parts[1]) return [["err", "Unknown hook. Available: " + Object.keys(HOOK_CATALOG).join(", ")]];
      if (!S.hooks.length) return [["sys", "No hooks configured."], ["sys", "  Install a demo: /hooks install block-rm · format · test-gate"]];
      return [["sys", "Configured hooks:"]].concat(S.hooks.map(function (id) {
        var d = HOOK_CATALOG[id];
        return ["hook", "  " + d.event + (d.matcher ? " [" + d.matcher + "]" : "") + "  " + id + " — " + d.desc];
      }));
    }
    if (low === "/agents") {
      return [["sys", "Sub-agents:"]].concat(AGENTS.map(function (a) { return ["agent", "  " + a.name + "  (" + a.src + ") — " + a.desc]; }))
        .concat([["sys", "  Ask: “use the code-reviewer agent to review my changes”"]]);
    }
    if (low === "/skills") {
      return [["sys", "Skills (only name + description are in context until used):"]].concat(SKILLS.map(function (s) { return ["sys", "  /" + s.name + " — " + s.desc]; }));
    }
    if (low.indexOf("/loop") === 0) {
      var lp = input.slice(5).trim(), iv = (lp.match(/^(\d+[smhd])\s+/) || [])[1];
      var body = iv ? lp.slice(iv.length).trim() : lp;
      if (!body) body = "check the build and fix anything broken";
      return [["sys", "⟳ Scheduled: “" + body + "” " + (iv ? "every " + iv : "(self-paced)")],
        ["sys", "  [run 1] Bash(npm test) → ✗ 1 failed · fixing…"], ["tool", "Edit(src/App.jsx)"], ["toolout", "✓ 9 passed"],
        ["sys", "  [run 2] Bash(npm test) → ✓ green · nothing to do"],
        ["sys", "  (in a real session this keeps firing while the session is idle — Esc stops a self-paced loop)"]];
    }
    if (low.charAt(0) === "/") return [["err", "Unknown command in this simulator. Type /help."]];

    /* --- natural-language prompts --- */
    if (/\brm -rf\b|delete .*(build|folder|dir)|remove .*build|clean .*build/i.test(input)) {
      steps = [["tool", "Bash(rm -rf build/)"]];
      if (mode() === "plan") {
        steps.push(["sys", "  Plan mode: commands that modify files are not run. Plan: 1) rm -rf build/  2) rebuild with pnpm build"]);
      } else if (hook("block-rm")) {
        steps.push(["hook", "PreToolUse block-rm → exit 2: \"Blocked by project policy: rm -rf. Ask the user to run it.\""]);
        steps.push(["claude", "A project hook blocked that. If you really want build/ gone, run `! rm -rf build` yourself."]);
        steps.push(["fn", function () { complete("hookblock"); }, 10]);
      } else {
        if (mode() !== "auto") steps.push(["mode", "  ? Allow Bash(rm -rf build/)?  ▸ Yes  (simulated: you approved — approval fatigue is real)"]);
        steps.push(["fn", function () { var i = S.files.indexOf("build/"); if (i !== -1) S.files.splice(i, 1); render(); }, 20]);
        steps.push(["toolout", "(deleted)"]);
        steps.push(["claude", "Deleted build/. Tip: install a guardrail with /hooks install block-rm and try again."]);
      }
      S.turns++;
      return steps.concat([R()]);
    }
    var skill = SKILLS.filter(function (s) { return s.re.test(input); })[0];
    if (skill) {
      steps = [["sys", "  Matched skill description → loading full SKILL.md"], ["tool", "Skill(" + skill.name + ")"],
        ["toolout", "Loaded .claude/skills/" + skill.name + "/SKILL.md"], ["fn", function () { complete("skill"); }, 10]];
      if (skill.name === "release-notes") {
        steps.push(["tool", "Bash(git log --oneline v1.2.0..HEAD)"], ["toolout", "14 commits"]);
        if (mode() === "plan") steps.push(["plan", "Draft release notes (not written — plan mode): Features · Fixes · Internal"]);
        else { steps.push(["tool", "Write(CHANGELOG.md)"], ["fn", function () { addFile("CHANGELOG.md"); render(); }, 20]); steps.push(["claude", "Wrote CHANGELOG.md: 3 features, 5 fixes, grouped per the skill's template."]); }
        return afterTurn(steps, {});
      }
      return steps.concat(task(input));
    }
    if (/review|code-reviewer|sub-?agent|delegate/i.test(input)) {
      steps = [["agent", "⏺ code-reviewer(Review uncommitted changes)"], ["toolout", "Fresh context · tools: Read, Grep, Glob, Bash"],
        ["toolout", "Read 4 files · git diff (+86 −12)"],
        ["agent", "  Should fix: ThemeToggle.jsx:9 reads localStorage without try/catch"],
        ["agent", "  Nit: App.test.jsx — test name doesn't describe behavior"],
        ["agent", "  Verdict: CHANGES REQUESTED"],
        ["claude", "The reviewer worked in its own context — only this summary entered ours. Want me to fix the Should-fix item?"],
        ["fn", function () { complete("agent"); }, 10]];
      return afterTurn(steps, {});
    }
    if (/^(hi|hello|hey)\b/i.test(input)) return [["claude", "Hi! Give me a task (“add a dark mode toggle”) or type /help."]];
    return task(input);
  }

  function injectCss() {
    if (document.getElementById("pg-css")) return;
    var s = document.createElement("style");
    s.id = "pg-css";
    s.textContent =
      ".pg-card{background:var(--bg-elev);border:1px solid var(--rule);border-radius:12px;padding:12px 14px;margin-bottom:12px;font-size:14px}" +
      ".pg-h{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-3);margin-bottom:8px;display:flex;justify-content:space-between}" +
      ".pg-sub{font-size:12.5px;color:var(--ink-3);margin-top:4px;text-transform:none;letter-spacing:0;font-weight:400}" +
      ".pg-modes{display:grid;grid-template-columns:1fr 1fr;gap:6px}" +
      ".pg-mode{font:inherit;font-size:12.5px;font-family:var(--mono);padding:6px;border-radius:7px;border:1px solid var(--rule);background:var(--bg);color:var(--ink-2);cursor:pointer}" +
      ".pg-mode.on{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".pg-goal{font-weight:600;color:var(--violet)}" +
      ".pg-list,.pg-files,.pg-missions{list-style:none;margin:0;padding:0}" +
      ".pg-list li{margin-bottom:8px}.pg-files li{font-family:var(--mono);font-size:12.5px;padding:2px 0}" +
      ".pg-files li.new{color:var(--green)}" +
      ".pg-missions li{display:grid;grid-template-columns:20px 1fr;gap:4px;padding:3px 0;color:var(--ink-2)}" +
      ".pg-missions li.done{color:var(--green)}";
    document.head.appendChild(s);
  }

  window.TUTOR.ready(function () {
    var host = document.getElementById("pg-term");
    panel = document.getElementById("pg-panel");
    if (!host || !panel) return;
    E = window.TUTOR.esc;
    injectCss();
    var term = window.TUTOR.terminal(host, {
      title: "claude — ~/todo-app (playground)",
      placeholder: "Try: add a dark mode toggle  ·  /help",
      hints: ["/help", "shift+tab", "/init", "/plan add a search bar", "/hooks install block-rm", "delete the build folder",
              "/goal tests pass, lint is clean and the dark mode toggle works", "write release notes", "use the code-reviewer agent to review my changes", "/context", "/clear"],
      banner: [
        ["sys", "✻ Welcome to the Claude Code playground (simulated)", 60],
        ["sys", "  cwd: ~/todo-app · a tiny React app with a test suite", 60],
        ["sys", "  Everything here is scripted — but state is real: modes, hooks and goals affect what happens next.", 60],
        ["sys", "  Type /help or pick a suggestion below.", 60]
      ],
      fallback: handle
    });
    panel.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-mode]");
      if (!b) return;
      S.mode = +b.getAttribute("data-mode");
      term.print("mode", "  " + MODE_LABEL[mode()]);
      render();
    });
    var reset = document.getElementById("pg-reset");
    if (reset) reset.addEventListener("click", function () {
      S.mode = 0; S.goal = null; S.goalTurns = 0; S.hooks = []; S.files = INITIAL_FILES.slice(); S.turns = 0; S.done = {}; S.newFiles = {};
      term.reset(); term.print("sys", "(playground reset)"); render();
    });
    render();
  });
})();
