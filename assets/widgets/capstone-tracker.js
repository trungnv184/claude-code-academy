/* Lab: capstone milestone checklist. Ticks persist in localStorage (when available)
   and drive a progress ring so learners can pick the build up across sessions. */
(function () {
  "use strict";

  var KEY = "cc-academy-capstone-v1";
  var MILESTONES = [
    { id: "m0", title: "M0 · Repo setup & /init", tasks: ["Scaffold Snip (npm init, Express, better-sqlite3, Vitest)", "git init + first commit", "Run /init and read the draft CLAUDE.md"] },
    { id: "m1", title: "M1 · Hand-tune CLAUDE.md", tasks: ["Cut it under ~60 lines", "Add commands, architecture, conventions, 'never' list", "Commit CLAUDE.md"] },
    { id: "m2", title: "M2 · Settings, permissions & hooks", tasks: ["Write .claude/settings.json permissions", "Add block-dangerous.sh PreToolUse hook", "Add PostToolUse prettier hook", "Add Stop test-gate hook", "Verify with /hooks"] },
    { id: "m3", title: "M3 · Spec, plan mode, PLAN.md", tasks: ["Let Claude interview you into SPEC.md", "/clear, then plan in plan mode", "Approve and save PLAN.md"] },
    { id: "m4", title: "M4 · Implement with /goal", tasks: ["Switch to auto-accept edits", "Set the /goal condition", "Watch the evaluator reach 'met'", "Review the diff and commit at green"] },
    { id: "m5", title: "M5 · Custom skill", tasks: ["Write .claude/skills/add-endpoint/SKILL.md", "Use it to add GET /api/links/:code/stats", "Confirm the skill triggered"] },
    { id: "m6", title: "M6 · Sub-agents & worktrees", tasks: ["Create .claude/agents/code-reviewer.md", "Run the reviewer on the diff and fix findings", "Build aliases + expiry in two worktrees in parallel", "Merge both branches"] },
    { id: "m7", title: "M7 · /loop & headless CI", tasks: ["/loop babysit the open PR", "Add .github/workflows/claude-review.yml", "Watch a headless claude -p review land on a PR"] },
    { id: "m8", title: "M8 · Retro & commit the harness", tasks: ["Commit .claude/ (minus settings.local.json)", "Add one lesson learned to CLAUDE.md", "Write your retro notes"] }
  ];

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* per-visit only */ } }

  function injectCss() {
    if (document.getElementById("ct-css")) return;
    var s = document.createElement("style");
    s.id = "ct-css";
    s.textContent =
      ".ct-top{display:flex;align-items:center;gap:18px;margin-bottom:12px}" +
      ".ct-ring{flex:none}.ct-ring circle{fill:none;stroke-width:8}" +
      ".ct-ring .bg{stroke:var(--bg-sunk)}.ct-ring .fg{stroke:var(--accent);stroke-linecap:round;transition:stroke-dashoffset .4s ease}" +
      ".ct-ring text{font-family:var(--sans);font-weight:700;font-size:18px;fill:var(--ink)}" +
      ".ct-ms{border-top:1px solid var(--rule);padding:10px 0}" +
      ".ct-ms summary{cursor:pointer;display:flex;justify-content:space-between;gap:10px;font-weight:600;font-size:14.5px;list-style:none}" +
      ".ct-ms summary::-webkit-details-marker{display:none}" +
      ".ct-ms summary::before{content:'▸';color:var(--ink-3);margin-right:6px}.ct-ms[open] summary::before{content:'▾'}" +
      ".ct-ms summary span:first-child{flex:1}" +
      ".ct-task{display:flex;gap:10px;align-items:flex-start;font-size:14px;padding:5px 0 5px 20px;cursor:pointer;color:var(--ink-2)}" +
      ".ct-task input{margin-top:4px;accent-color:var(--accent)}" +
      ".ct-task.on{color:var(--ink-3);text-decoration:line-through}";
    document.head.appendChild(s);
  }

  function mount(host) {
    injectCss();
    var E = window.TUTOR.esc;
    var state = load();
    var total = MILESTONES.reduce(function (n, m) { return n + m.tasks.length; }, 0);
    var R = 34, C = 2 * Math.PI * R;

    var html = '<div class="lab-head"><span class="lab-badge">Tracker</span><span class="lab-title">Capstone milestone checklist</span></div><div class="lab-body">' +
      '<div class="ct-top"><svg class="ct-ring" width="84" height="84" viewBox="0 0 84 84" aria-hidden="true"><circle class="bg" cx="42" cy="42" r="' + R + '"/>' +
      '<circle class="fg" cx="42" cy="42" r="' + R + '" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '" transform="rotate(-90 42 42)"/><text x="42" y="48" text-anchor="middle" class="ct-pct">0%</text></svg>' +
      '<div><div style="font-weight:650">Build Snip, one milestone at a time</div><div class="ct-sum" style="color:var(--ink-3);font-size:14px"></div>' +
      '<div class="btn-row" style="margin:8px 0 0"><button class="btn ghost" type="button" data-act="reset">Reset checklist</button></div></div></div>';
    MILESTONES.forEach(function (m, mi) {
      html += '<details class="ct-ms"' + (mi === 0 ? " open" : "") + ' data-m="' + m.id + '"><summary><span>' + E(m.title) + '</span><span class="chip ct-count"></span></summary>';
      m.tasks.forEach(function (t, ti) {
        var k = m.id + "." + ti;
        html += '<label class="ct-task"><input type="checkbox" data-k="' + k + '"><span>' + E(t) + "</span></label>";
      });
      html += "</details>";
    });
    host.innerHTML = html + "</div>";

    function paint() {
      var done = 0;
      host.querySelectorAll("input[data-k]").forEach(function (cb) {
        var on = !!state[cb.getAttribute("data-k")];
        cb.checked = on;
        cb.parentNode.classList.toggle("on", on);
        if (on) done++;
      });
      MILESTONES.forEach(function (m) {
        var d = m.tasks.filter(function (_, ti) { return state[m.id + "." + ti]; }).length;
        var chip = host.querySelector('[data-m="' + m.id + '"] .ct-count');
        chip.textContent = d + "/" + m.tasks.length;
        chip.className = "chip ct-count" + (d === m.tasks.length ? " ok" : "");
      });
      var pct = Math.round(done / total * 100);
      host.querySelector(".fg").setAttribute("stroke-dashoffset", C * (1 - done / total));
      host.querySelector(".ct-pct").textContent = pct + "%";
      host.querySelector(".ct-sum").textContent = done + " of " + total + " tasks done" + (done === total ? " — you shipped it. 🎼" : "");
    }

    host.addEventListener("change", function (e) {
      var k = e.target.getAttribute && e.target.getAttribute("data-k");
      if (!k) return;
      if (e.target.checked) state[k] = 1; else delete state[k];
      save(state); paint();
    });
    host.querySelector('[data-act="reset"]').addEventListener("click", function () { state = {}; save(state); paint(); });
    paint();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=capstone-tracker]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
