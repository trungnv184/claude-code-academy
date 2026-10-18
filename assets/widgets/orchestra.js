/* Lab: orchestration timeline simulator.
   Schedules a feature's subtasks (with dependencies and file ownership) across
   1–5 agents under three strategies, then animates a Gantt chart and reports
   wall-clock time, tokens, main-context size, merge conflicts and escaped bugs.
   All numbers are illustrative — the point is the shape of the trade-offs. */
(function () {
  "use strict";

  var MIN_PER_UNIT = 4;          // 1 work unit ≈ 4 minutes of agent time
  var TOK_PER_UNIT = 9000;       // tokens consumed per unit of work
  var SUBAGENT_BRIEF = 0.5;      // units of overhead per delegated task (brief + summary)
  var SUBAGENT_REGATHER = 6000;  // tokens a fresh sub-agent spends re-reading context
  var AGENT_WARMUP = 15000;      // tokens each parallel agent spends loading project context once
  var USD_PER_MTOK = 6;          // blended illustrative price

  var TASKS = [
    { id: "T1", name: "Explore auth module", units: 3, deps: [], files: [], color: "info" },
    { id: "T2", name: "API: /sessions endpoint", units: 5, deps: ["T1"], files: ["session.ts", "routes.ts"], color: "vio" },
    { id: "T3", name: "DB: migration + model", units: 4, deps: ["T1"], files: ["schema.prisma", "session.ts"], color: "warn" },
    { id: "T4", name: "UI: login form", units: 5, deps: ["T1"], files: ["Login.tsx"], color: "ok" },
    { id: "T5", name: "Tests: API + DB", units: 4, deps: ["T2", "T3"], files: ["session.test.ts"], color: "bad" },
    { id: "T6", name: "Docs + changelog", units: 2, deps: ["T2", "T4"], files: ["README.md"], color: "info" }
  ];
  var BUGS_SEEDED = 3;

  var STRATS = {
    seq: { label: "Single agent, sequential", note: "One context does everything, in order." },
    fan: { label: "Parallel fan-out", note: "A lead delegates ready tasks to sub-agents; only summaries come back." },
    rev: { label: "Fan-out + fresh reviewer", note: "Same, plus a read-only reviewer with a clean context at the end." }
  };

  function simulate(strategy, agents, ownership) {
    var parallel = strategy !== "seq";
    var lanes = parallel ? agents : 1;
    var laneFree = []; for (var i = 0; i < lanes; i++) laneFree.push(0);
    var done = {}, finish = {}, running = [], bars = [], t = 0, remaining = TASKS.slice();

    function dur(task) { return task.units + (parallel ? SUBAGENT_BRIEF : 0); }
    function ready(task) { return task.deps.every(function (d) { return done[d]; }); }
    function locked(task) {
      if (!ownership) return false;
      return running.some(function (r) { return r.task.files.some(function (f) { return task.files.indexOf(f) >= 0; }); });
    }

    var guard = 0;
    while ((remaining.length || running.length) && guard++ < 100) {
      // Start everything that can start now.
      for (var k = 0; k < remaining.length; k++) {
        var task = remaining[k];
        if (!ready(task) || locked(task)) continue;
        var lane = -1;
        for (var l = 0; l < lanes; l++) if (laneFree[l] <= t + 1e-9) { lane = l; break; }
        if (lane < 0) break;
        var bar = { task: task, lane: lane, start: t, end: t + dur(task) };
        laneFree[lane] = bar.end; running.push(bar); bars.push(bar);
        remaining.splice(k, 1); k--;
      }
      if (!running.length) break;
      // Advance to the next completion.
      var next = Math.min.apply(null, running.map(function (r) { return r.end; }));
      t = next;
      running = running.filter(function (r) {
        if (r.end <= t + 1e-9) { done[r.task.id] = true; finish[r.task.id] = r.end; return false; }
        return true;
      });
    }

    var end = Math.max.apply(null, bars.map(function (b) { return b.end; }));
    var reviewBars = [];
    if (strategy === "rev") {
      var r1 = { task: { id: "R", name: "Review diff (fresh context)", units: 3, files: [], color: "warn" }, lane: lanes, start: end, end: end + 3 };
      var r2 = { task: { id: "F", name: "Fix review findings", units: 1.5, files: [], color: "vio" }, lane: 0, start: end + 3, end: end + 4.5 };
      reviewBars = [r1, r2]; end = r2.end;
    }

    // Merge conflicts: overlapping bars on different lanes sharing a file.
    var conflicts = [];
    for (var a = 0; a < bars.length; a++) for (var b = a + 1; b < bars.length; b++) {
      var A = bars[a], B = bars[b];
      if (A.lane === B.lane) continue;
      var overlap = A.start < B.end - 1e-9 && B.start < A.end - 1e-9;
      var shared = A.task.files.filter(function (f) { return B.task.files.indexOf(f) >= 0; });
      if (overlap && shared.length) conflicts.push(A.task.id + " & " + B.task.id + " both edit " + shared.join(", "));
    }

    // Tokens: sequential re-reads a growing context; sub-agents pay a re-gather cost each.
    var tokens = 0, mainCtx = 0;
    if (!parallel) {
      var acc = 0;
      TASKS.forEach(function (task) { acc += task.units * TOK_PER_UNIT; tokens += task.units * TOK_PER_UNIT + acc * 0.15; });
      mainCtx = acc;
    } else {
      TASKS.forEach(function (task) { tokens += task.units * TOK_PER_UNIT + SUBAGENT_REGATHER; });
      tokens += lanes * AGENT_WARMUP;
      mainCtx = 4000 + TASKS.length * 1800;
    }
    if (strategy === "rev") { tokens += 3 * TOK_PER_UNIT + SUBAGENT_REGATHER + 1.5 * TOK_PER_UNIT; mainCtx += 2500; }

    var caught = strategy === "seq" ? 1 : strategy === "fan" ? 1 : 3;
    var escaped = BUGS_SEEDED - caught + (strategy !== "seq" ? conflicts.length ? 1 : 0 : 0);
    escaped = Math.max(0, Math.min(BUGS_SEEDED + 1, escaped));
    if (strategy === "rev" && conflicts.length) escaped = 0; // reviewer catches the bad merge too

    return { bars: bars.concat(reviewBars), lanes: lanes + (strategy === "rev" ? 1 : 0), end: end, tokens: tokens, mainCtx: mainCtx,
             conflicts: conflicts, escaped: escaped, parallel: parallel, laneCount: lanes };
  }

  function fmtTok(n) { return n >= 1000 ? Math.round(n / 1000) + "k" : String(Math.round(n)); }

  function mount(host) {
    var E = window.TUTOR.esc;
    if (!document.getElementById("orch-style")) {
      var st = document.createElement("style"); st.id = "orch-style";
      st.textContent =
        ".orch-gantt{position:relative;margin:14px 0 4px;border:1px solid var(--rule);border-radius:10px;padding:10px 12px;background:var(--bg)}" +
        ".orch-lane{display:grid;grid-template-columns:86px 1fr;align-items:center;gap:10px;height:38px}" +
        ".orch-lane-name{font-family:var(--mono);font-size:12px;color:var(--ink-3)}" +
        ".orch-track{position:relative;height:28px;border-left:1px dashed var(--rule)}" +
        ".orch-bar{position:absolute;top:2px;height:24px;border-radius:6px;font-size:11.5px;font-weight:600;padding:0 7px;line-height:24px;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:0;transition:width .5s ease;border:1px solid transparent}" +
        ".orch-bar.conflict{outline:2px solid var(--red);outline-offset:1px}" +
        ".orch-axis{display:flex;justify-content:space-between;margin-left:96px;font-size:11.5px;color:var(--ink-3);margin-top:4px}" +
        ".orch-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}" +
        ".orch-stat{border:1px solid var(--rule);border-radius:10px;padding:10px 12px;background:var(--bg)}" +
        ".orch-stat b{display:block;font-family:var(--serif);font-size:22px;line-height:1.2}" +
        ".orch-stat span{font-size:12px;color:var(--ink-3)}" +
        "@media (max-width:600px){.orch-stats{grid-template-columns:1fr 1fr}.orch-lane{grid-template-columns:60px 1fr}.orch-axis{margin-left:70px}}";
      document.head.appendChild(st);
    }

    host.innerHTML =
      '<div class="lab-head"><span class="lab-badge">Lab</span><span class="lab-title">Orchestration timeline</span></div>' +
      '<div class="lab-body">' +
        '<p>Feature: <em>"Add session-based login."</em> Six subtasks; the tests need the API and DB, the docs need the API and UI, and everything needs the initial exploration. Pick a strategy and a team size, then run it.</p>' +
        '<div class="lab-row">' +
          '<div><label for="orch-strat">Strategy</label><select id="orch-strat">' +
            Object.keys(STRATS).map(function (k) { return '<option value="' + k + '">' + STRATS[k].label + "</option>"; }).join("") +
          '</select><div class="orch-note" style="font-size:13px;color:var(--ink-3);margin-top:6px"></div></div>' +
          '<div><label for="orch-n">Parallel agents: <span class="orch-n-val">3</span></label>' +
            '<input type="range" id="orch-n" min="1" max="5" value="3" style="width:100%">' +
            '<label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:8px"><input type="checkbox" id="orch-own"> Enforce file ownership (never two agents on one file)</label></div>' +
        '</div>' +
        '<div class="btn-row"><button class="btn primary" data-act="run">▶ Run simulation</button><button class="btn ghost" data-act="compare">Compare 1–5 agents</button></div>' +
        '<div class="orch-gantt" aria-live="polite"></div><div class="orch-axis"></div>' +
        '<div class="orch-stats"></div>' +
        '<div class="orch-msg"></div>' +
        '<p style="font-size:13px;color:var(--ink-3);margin:10px 0 0">Illustrative model: 1 unit ≈ ' + MIN_PER_UNIT + ' min. Sub-agents pay a briefing/summary overhead and re-read context; a single agent pays for an ever-growing context instead.</p>' +
      '</div>';

    var $ = function (s) { return host.querySelector(s); };
    var strat = $("#orch-strat"), n = $("#orch-n"), own = $("#orch-own");
    strat.value = "fan";

    function syncControls() {
      $(".orch-n-val").textContent = strat.value === "seq" ? "1 (fixed)" : n.value;
      n.disabled = strat.value === "seq";
      $(".orch-note").textContent = STRATS[strat.value].note;
    }

    function run() {
      syncControls();
      var res = simulate(strat.value, +n.value, own.checked);
      var gantt = $(".orch-gantt");
      gantt.innerHTML = "";
      var conflictIds = {};
      res.conflicts.forEach(function (c) { c.replace(/(T\d)/g, function (m) { conflictIds[m] = 1; }); });
      for (var l = 0; l < res.lanes; l++) {
        var isReviewer = strat.value === "rev" && l === res.lanes - 1;
        var laneName = !res.parallel ? "main" : isReviewer ? "reviewer" : "agent " + (l + 1);
        var row = document.createElement("div"); row.className = "orch-lane";
        row.innerHTML = '<div class="orch-lane-name">' + laneName + '</div><div class="orch-track"></div>';
        gantt.appendChild(row);
        var track = row.querySelector(".orch-track");
        res.bars.filter(function (b) { return b.lane === l; }).forEach(function (b, idx) {
          var div = document.createElement("div");
          div.className = "orch-bar chip " + b.task.color + (conflictIds[b.task.id] ? " conflict" : "");
          div.style.left = (b.start / res.end * 100) + "%";
          div.title = b.task.id + " · " + b.task.name + " · " + Math.round((b.end - b.start) * MIN_PER_UNIT) + " min" + (b.task.files.length ? " · " + b.task.files.join(", ") : "");
          div.textContent = b.task.id + " " + b.task.name;
          track.appendChild(div);
          var w = ((b.end - b.start) / res.end * 100) + "%";
          setTimeout(function () { div.style.width = w; }, 80 + b.start / res.end * 900);
        });
      }
      var minutes = Math.round(res.end * MIN_PER_UNIT);
      $(".orch-axis").innerHTML = "<span>0</span><span>" + Math.round(minutes / 2) + " min</span><span>" + minutes + " min</span>";
      var cost = res.tokens / 1e6 * USD_PER_MTOK;
      $(".orch-stats").innerHTML =
        '<div class="orch-stat"><b>' + minutes + ' min</b><span>wall-clock</span></div>' +
        '<div class="orch-stat"><b>' + fmtTok(res.tokens) + '</b><span>total tokens (~$' + cost.toFixed(2) + ')</span></div>' +
        '<div class="orch-stat"><b>' + fmtTok(res.mainCtx) + '</b><span>main context at end</span></div>' +
        '<div class="orch-stat"><b style="color:' + (res.escaped ? "var(--red)" : "var(--green)") + '">' + res.escaped + ' / ' + BUGS_SEEDED + '</b><span>bugs reaching you</span></div>';
      var msg = "";
      if (res.conflicts.length) msg += '<div class="callout danger" style="margin:14px 0 0"><div class="callout-icon">⚡</div><div><div class="callout-title">Merge conflict risk</div><p>' +
        res.conflicts.map(E).join("<br>") + '. Fix it with file ownership (tick the box), sequencing, or <code>isolation: worktree</code> plus a deliberate merge step.</p></div></div>';
      if (!res.parallel) msg += '<div class="callout warn" style="margin:14px 0 0"><div class="callout-icon">◔</div><div><p>One agent carried every file read and test log in a single window (' + fmtTok(res.mainCtx) + ' tokens). Each later task pays to re-read all of it — and attention to early details degrades.</p></div></div>';
      if (strat.value === "rev") msg += '<div class="callout tip" style="margin:14px 0 0"><div class="callout-icon">✓</div><div><p>The reviewer added ~' + Math.round(4.5 * MIN_PER_UNIT) + ' minutes and caught what the authors couldn\'t see in their own work. A fresh context has no attachment to the code it\'s reading.</p></div></div>';
      $(".orch-msg").innerHTML = msg;
    }

    function compare() {
      var s = strat.value === "seq" ? "fan" : strat.value;
      strat.value = s; syncControls();
      var rows = [1, 2, 3, 4, 5].map(function (k) { var r = simulate(s, k, own.checked); return { k: k, min: Math.round(r.end * MIN_PER_UNIT), tok: r.tokens, conf: r.conflicts.length }; });
      var seq = simulate("seq", 1, false);
      var html = '<div class="table-wrap" style="margin:14px 0 0"><table><thead><tr><th>Agents</th><th>Wall-clock</th><th>Tokens</th><th>Conflicts</th></tr></thead><tbody>' +
        '<tr><td>sequential</td><td>' + Math.round(seq.end * MIN_PER_UNIT) + ' min</td><td>' + fmtTok(seq.tokens) + '</td><td>0</td></tr>' +
        rows.map(function (r) { return "<tr><td>" + r.k + "</td><td>" + r.min + " min</td><td>" + fmtTok(r.tok) + "</td><td>" + r.conf + "</td></tr>"; }).join("") +
        '</tbody></table></div><p style="font-size:14px;margin:10px 0 0">Notice the curve flatten after 3 agents: the dependency graph only ever has three tasks ready at once. Beyond that, extra agents sit idle — while every agent you spin up still pays to load the project context.</p>';
      $(".orch-msg").innerHTML = html;
    }

    strat.addEventListener("change", run);
    n.addEventListener("input", run);
    own.addEventListener("change", run);
    $('[data-act="run"]').addEventListener("click", run);
    $('[data-act="compare"]').addEventListener("click", function () { run(); compare(); });
    run();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=orchestra]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
