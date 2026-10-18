/* Lab: the same task, run with and without a plan, side by side.
   Compares diff size, rework (lines thrown away) and wrong-approach risk.
   One scenario deliberately shows when planning is NOT worth it. */
(function () {
  "use strict";

  var SCENARIOS = {
    oauth: {
      label: "Add “Sign in with Google”",
      prompt: "Add Google sign-in to the app.",
      noPlan: {
        steps: [
          ["act", "Installs passport + passport-google-oauth20"],
          ["act", "Writes a new Express session layer (src/auth/session.ts)"],
          ["act", "Adds /auth/google routes and a users.google_id column"],
          ["verify", "Tests fail: app already uses NextAuth with JWT sessions"],
          ["act", "Tries to bridge passport sessions into NextAuth…"],
          ["act", "Gives up on the bridge, rips out passport, adds NextAuth GoogleProvider"],
          ["verify", "Tests pass. Two leftover migrations and a dead session table remain"]
        ],
        diff: 640, rework: 410, turns: 31, risk: "high",
        verdict: "Built a correct solution to the wrong architecture. You find out 400 lines in."
      },
      plan: {
        steps: [
          ["gather", "Explore: auth is NextAuth v5 with JWT sessions (src/auth.ts)"],
          ["gather", "Explore: users table already has an accounts relation"],
          ["plan", "Plan: add GoogleProvider → env vars → account-linking rule → button → e2e test"],
          ["you", "You: “Use the existing accounts table; no new columns.” Plan updated, then approved"],
          ["act", "Implements 4 small steps, running tests after each"],
          ["verify", "Unit + e2e green; no migration needed"]
        ],
        diff: 140, rework: 0, turns: 14, risk: "low",
        verdict: "Two minutes of reading the plan caught the architecture mismatch before any code existed."
      }
    },
    dates: {
      label: "Migrate moment → date-fns",
      prompt: "Replace moment.js with date-fns everywhere.",
      noPlan: {
        steps: [
          ["act", "Search-and-replace on the 12 files that import moment"],
          ["verify", "Typecheck fails in 5 files (mutable moment vs immutable date-fns)"],
          ["act", "Fixes those 5; misses timezone handling in reports/"],
          ["verify", "Tests green, but reports/ has no tests. Silent off-by-one-day bug ships"]
        ],
        diff: 380, rework: 90, turns: 18, risk: "medium",
        verdict: "Looked done. The risky part (timezones, untested code) was never surfaced."
      },
      plan: {
        steps: [
          ["gather", "Explore: 47 call sites; 6 use .tz(); reports/ has zero tests"],
          ["plan", "Plan: add characterization tests for reports/ first → migrate leaf utils → timezone sites last"],
          ["you", "You approve, and ask for date-fns-tz for the 6 tz call sites"],
          ["act", "Writes 9 characterization tests, then migrates in 3 commits"],
          ["verify", "All green, including the new reports/ tests that caught a DST edge case"]
        ],
        diff: 420, rework: 0, turns: 22, risk: "low",
        verdict: "Slightly more turns, but the plan turned the hidden risk into an explicit step."
      }
    },
    rename: {
      label: "Fix a typo in a button label",
      prompt: "The checkout button says “Purchace”. Fix it.",
      noPlan: {
        steps: [
          ["act", "Grep “Purchace” → 2 hits; edits both"],
          ["verify", "Snapshot test updated and green"]
        ],
        diff: 4, rework: 0, turns: 3, risk: "low",
        verdict: "Perfect. The whole change fits in one sentence, so no plan was needed."
      },
      plan: {
        steps: [
          ["gather", "Explore: finds the 2 occurrences"],
          ["plan", "Plan: 1) edit Button.tsx 2) edit i18n/en.json 3) update snapshot"],
          ["you", "You read and approve a plan for a 4-line change…"],
          ["act", "Edits both files"],
          ["verify", "Snapshot test green"]
        ],
        diff: 4, rework: 0, turns: 6, risk: "low",
        verdict: "Same result, double the turns. If you can describe the diff in one sentence, skip the plan."
      }
    }
  };

  var CHIP = { gather: "info", plan: "warn", you: "vio", act: "", verify: "ok" };
  var RISK = { low: "ok", medium: "warn", high: "bad" };

  function mount(host) {
    var E = window.TUTOR.esc;
    var opts = Object.keys(SCENARIOS).map(function (k) { return '<option value="' + k + '">' + E(SCENARIOS[k].label) + "</option>"; }).join("");
    host.innerHTML =
      '<div class="lab-head"><span class="lab-badge">Lab</span><span class="lab-title">Same task, with and without a plan</span></div>' +
      '<div class="lab-body">' +
        '<div class="lab-row" style="align-items:end"><div><label for="ps-task">Pick a task</label><select id="ps-task" class="ps-task">' + opts + '</select></div>' +
        '<div class="btn-row" style="margin:0"><button class="btn primary" data-act="run">▶ Run both</button><button class="btn ghost" data-act="reset">Reset</button></div></div>' +
        '<p class="ps-prompt" style="margin:14px 0 4px;color:var(--ink-2)"></p>' +
        '<div class="lab-row ps-cols" style="margin-top:12px"></div>' +
        '<div class="ps-verdict"></div>' +
      '</div>';

    var sel = host.querySelector(".ps-task"), cols = host.querySelector(".ps-cols"), verdict = host.querySelector(".ps-verdict");
    var timers = [];

    function column(title, run, key) {
      return '<div class="ps-col" data-k="' + key + '" style="border:1px solid var(--rule);border-radius:10px;padding:12px 14px;background:var(--bg)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><strong style="font-size:14.5px">' + title + '</strong>' +
        '<span class="chip ps-risk" style="visibility:hidden">risk</span></div>' +
        '<ol class="ps-steps" style="list-style:none;padding:0;margin:0;min-height:120px"></ol>' +
        '<div class="ps-metrics" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;font-size:12px;color:var(--ink-3);visibility:hidden">' +
          '<div><strong style="display:block;font-size:18px;color:var(--ink)">' + run.diff + '</strong>lines in diff</div>' +
          '<div><strong style="display:block;font-size:18px;color:' + (run.rework ? "var(--red)" : "var(--ink)") + '">' + run.rework + '</strong>lines thrown away</div>' +
          '<div><strong style="display:block;font-size:18px;color:var(--ink)">' + run.turns + '</strong>turns</div>' +
        '</div></div>';
    }

    function clear() { timers.forEach(clearTimeout); timers = []; }

    function setup() {
      clear();
      var s = SCENARIOS[sel.value];
      host.querySelector(".ps-prompt").innerHTML = "Prompt: <em>" + E(s.prompt) + "</em>";
      cols.innerHTML = column("Without a plan", s.noPlan, "noPlan") + column("Plan mode first", s.plan, "plan");
      verdict.innerHTML = "";
    }

    function play() {
      setup();
      var s = SCENARIOS[sel.value];
      var done = 0;
      ["noPlan", "plan"].forEach(function (k) {
        var run = s[k], col = cols.querySelector('[data-k="' + k + '"]'), ol = col.querySelector(".ps-steps");
        run.steps.forEach(function (st, i) {
          timers.push(setTimeout(function () {
            var li = document.createElement("li");
            li.style.cssText = "display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:13.5px;line-height:1.45";
            li.innerHTML = '<span class="chip ' + CHIP[st[0]] + '" style="flex:none;min-width:58px;justify-content:center">' + st[0] + "</span><span>" + E(st[1]) + "</span>";
            ol.appendChild(li);
            if (i === run.steps.length - 1) {
              col.querySelector(".ps-metrics").style.visibility = "visible";
              var rk = col.querySelector(".ps-risk");
              rk.style.visibility = "visible"; rk.textContent = run.risk + " risk"; rk.className = "chip ps-risk " + RISK[run.risk];
              if (++done === 2) showVerdict(s);
            }
          }, 450 * (i + 1)));
        });
      });
    }

    function showVerdict(s) {
      var skip = sel.value === "rename";
      verdict.innerHTML = '<div class="callout ' + (skip ? "info" : "tip") + '"><div class="callout-icon">' + (skip ? "ℹ️" : "✓") + '</div><div>' +
        '<p><strong>Without a plan:</strong> ' + E(s.noPlan.verdict) + '</p><p><strong>With a plan:</strong> ' + E(s.plan.verdict) + "</p></div></div>";
    }

    sel.addEventListener("change", setup);
    host.querySelector('[data-act="run"]').addEventListener("click", play);
    host.querySelector('[data-act="reset"]').addEventListener("click", setup);
    setup();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=plan-sim]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
