/* Lab: write a /goal condition, score it for verifiability, then watch a
   simulated session where a fast evaluator model judges each turn.
   Vague goals end in false "met" or runaway loops; good goals converge with evidence. */
(function () {
  "use strict";

  var PRESETS = [
    { label: "Vague", text: "make the cart work properly" },
    { label: "Half-specified", text: "fix the coupon bug, make sure tests pass and the code is clean" },
    { label: "Unbounded", text: "npm test -- tests/cart exits 0 and npm run typecheck exits 0" },
    { label: "Good", text: "npm test -- tests/cart exits 0 and npm run typecheck exits 0, with the final output shown in the transcript, or stop after 15 turns" }
  ];

  var RE_EVIDENCE = /\b(npm|pnpm|yarn|bun|npx|pytest|go test|cargo|tsc|make [a-z-]+ (test|check|lint)|jest|vitest|curl|eslint|ruff|mypy)\b|exits? (with )?(code )?0|exit code|output|shown|prints?|returns? \d|\d+ (tests?|errors?|warnings?)|lighthouse|coverage/i;
  var RE_MEASURABLE = /exits? (with )?(code )?0|\b(0|zero|no) (errors?|warnings?|failures?)|\ball\b.*\b(pass|green)|\b\d+%|\bat least \d+|\bunder \d+|\bbelow \d+|[<>]=?\s?\d+|\bevery\b/i;
  var RE_BOUND = /stop after \d+|or stop|at most \d+ turns|within \d+ turns|max(imum)? (of )?\d+ turns|after \d+ turns/i;
  var RE_VAGUE = /\b(properly|correctly|clean|nice|better|good|well|improve[sd]?|optimi[sz]e[sd]?|robust|polish(ed)?|works?|working)\b/i;

  function analyze(text) {
    var t = text.trim();
    var evidence = RE_EVIDENCE.test(t);
    var measurable = RE_MEASURABLE.test(t);
    var bounded = RE_BOUND.test(t);
    var vagueHits = (t.match(new RegExp(RE_VAGUE.source, "gi")) || []);
    var score = (evidence ? 40 : 0) + (measurable ? 30 : 0) + (bounded ? 20 : 0) + (vagueHits.length ? 0 : 10);
    return { evidence: evidence, measurable: measurable, bounded: bounded, vague: vagueHits, score: Math.min(100, score) };
  }

  // Build a scripted session from the analysis.
  function scenario(a) {
    var T = [];
    if (!a.evidence) {
      T.push({ act: "Read src/cart/total.ts, Grep(\"coupon\")", ev: "—", v: "not yet met", why: "No change made yet." });
      T.push({ act: "Edit(total.ts): round coupon with Math.floor", ev: "Claude: \"Fixed the coupon calculation! The cart works properly now.\"", v: "met", why: "Transcript claims the cart works. Nothing in the condition demands proof, so the claim is accepted." });
      return { turns: T, outcome: "false-met",
        note: "The evaluator can't run tools. It reads the transcript, and the transcript says \"works properly\", so the goal is \"met\". Behind the scenes, npm test still fails 2 of 12 cart tests. Name the evidence you want to see." };
    }
    T.push({ act: "Read + Grep the cart module", ev: "—", v: "not yet met", why: "No test output in the transcript yet." });
    T.push({ act: "Bash(npm test -- tests/cart)", ev: "✗ 2 failed, 10 passed", v: "not yet met", why: "Transcript shows failing tests." });
    T.push({ act: "Edit(total.ts): apply coupon before tax", ev: "—", v: "not yet met", why: "Change made but no fresh test output." });
    T.push({ act: "Bash(npm test -- tests/cart)", ev: "✓ 12 passed", v: "not yet met", why: "Tests green; typecheck not yet shown." });
    if (!a.measurable) {
      // Evidence exists but part of the condition is subjective: the evaluator can't close it.
      var subj = a.vague.length ? a.vague[0] : "the subjective part";
      var i;
      for (i = 0; i < 18; i++) {
        T.push({ act: i % 2 ? "Edit: rename variables, extract helper" : "Bash(npm test -- tests/cart)",
          ev: i % 2 ? "—" : "✓ 12 passed",
          v: "not yet met", why: "Tests pass, but nothing in the transcript proves the code is \"" + subj + "\". The evaluator keeps asking for more." });
        if (a.bounded && T.length >= 15) break;
      }
      return { turns: T, outcome: a.bounded ? "bounded-stop" : "runaway",
        note: a.bounded
          ? "Tests passed on turn 4, but \"" + subj + "\" can't be proven from a transcript, so the loop spun until the turn bound. The bound saved you; a measurable condition would have finished on turn 5."
          : "Tests passed on turn 4, but \"" + subj + "\" can't be proven from a transcript, so the evaluator never says met. With no bound, this keeps burning turns until you interrupt. (Cut off here at turn " + T.length + ".)" };
    }
    T.push({ act: "Bash(npm run typecheck)", ev: "tsc --noEmit · 0 errors · exit 0", v: "met", why: "Transcript shows both commands exiting 0." });
    return { turns: T, outcome: a.bounded ? "converged" : "converged-unbounded",
      note: a.bounded
        ? "Converged in 5 turns on hard evidence. The bound never fired, but it's there if the task turns out to be impossible."
        : "Converged — this time. Without a bound, a genuinely impossible task (a flaky test, a missing API key) would loop until you notice. Add \"or stop after N turns\"." };
  }

  var VERDICT_CHIP = { "met": "ok", "not yet met": "warn", "impossible": "bad" };
  var OUTCOME = {
    "false-met": ["bad", "False \"met\" — premature victory"],
    "runaway": ["bad", "Runaway loop — never converges"],
    "bounded-stop": ["warn", "Stopped by turn bound — wasted turns"],
    "converged": ["ok", "Converged with evidence"],
    "converged-unbounded": ["warn", "Converged, but unbounded"]
  };

  function mount(host) {
    var E = window.TUTOR.esc;
    host.innerHTML =
      '<div class="lab-head"><span class="lab-badge">Lab</span><span class="lab-title">Goal-condition evaluator</span></div>' +
      '<div class="lab-body">' +
        '<p>Write a <code>/goal</code> condition for the task <em>"the checkout total is wrong when a coupon is applied"</em>, or start from a preset. The lab scores how verifiable it is, then simulates a session where a small, fast evaluator model reads the transcript after each turn and answers <strong>met</strong> or <strong>not yet met</strong>.</p>' +
        '<div class="btn-row gl-presets">' + PRESETS.map(function (p, i) { return '<button class="btn" data-p="' + i + '">' + E(p.label) + "</button>"; }).join("") + "</div>" +
        '<label for="gl-text">Goal condition</label>' +
        '<textarea id="gl-text" class="gl-text" style="min-height:70px;font-family:var(--sans);font-size:14.5px"></textarea>' +
        '<div class="gl-score" style="margin:12px 0"></div>' +
        '<div class="btn-row"><button class="btn primary" data-act="run">▶ Run simulated session</button><button class="btn ghost" data-act="stop" disabled>■ Interrupt (Esc)</button></div>' +
        '<div class="gl-turns" style="margin-top:8px"></div>' +
        '<div class="gl-outcome"></div>' +
      "</div>";

    var ta = host.querySelector(".gl-text");
    var scoreEl = host.querySelector(".gl-score");
    var turnsEl = host.querySelector(".gl-turns");
    var outEl = host.querySelector(".gl-outcome");
    var runBtn = host.querySelector('[data-act="run"]');
    var stopBtn = host.querySelector('[data-act="stop"]');
    var timer = null;

    function chk(ok, label, hint) {
      return '<div style="display:flex;gap:8px;align-items:baseline;margin:4px 0;font-size:14px"><span class="chip ' + (ok ? "ok" : "bad") + '">' + (ok ? "✓" : "✗") + "</span><span><strong>" + label + "</strong> <span style=\"color:var(--ink-3)\">" + hint + "</span></span></div>";
    }

    function paintScore() {
      var a = analyze(ta.value);
      var color = a.score >= 90 ? "var(--green)" : a.score >= 60 ? "var(--amber)" : "var(--red)";
      scoreEl.innerHTML =
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:6px"><span style="font-size:13px;color:var(--ink-3)">Verifiability</span>' +
        '<div class="progress-bar" style="flex:1;height:10px"><span style="width:' + a.score + "%;background:" + color + '"></span></div><strong style="font-size:14px">' + a.score + "/100</strong></div>" +
        chk(a.evidence, "Names evidence", "a command, exit code or output the transcript can show") +
        chk(a.measurable, "Measurable", "pass/fail, exit 0, a number — not a feeling") +
        chk(a.bounded, "Bounded", "\"or stop after N turns\" so impossible tasks end") +
        chk(!a.vague.length, "No subjective words", a.vague.length ? "found: " + a.vague.map(function (v) { return "\"" + E(v) + "\""; }).join(", ") : "nothing like \"clean\" or \"properly\"");
      return a;
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null; runBtn.disabled = false; stopBtn.disabled = true;
    }

    function run() {
      stop();
      var a = paintScore();
      if (!ta.value.trim()) { outEl.innerHTML = '<div class="callout warn"><div class="callout-icon">!</div><div><p>Write a condition first.</p></div></div>'; return; }
      var sc = scenario(a), i = 0, cost = 0;
      turnsEl.innerHTML = '<div style="font-size:12.5px;color:var(--ink-3);margin:6px 0">Each row: Claude\'s turn → what the transcript shows → the evaluator\'s verdict</div>';
      outEl.innerHTML = "";
      runBtn.disabled = true; stopBtn.disabled = false;
      timer = setInterval(function () {
        if (i >= sc.turns.length) {
          stop();
          var o = OUTCOME[sc.outcome];
          outEl.innerHTML = '<div class="callout ' + (o[0] === "ok" ? "tip" : o[0] === "warn" ? "warn" : "danger") + '"><div class="callout-icon">' + (o[0] === "ok" ? "✓" : "✗") + '</div><div><div class="callout-title">' + o[1] + " · " + sc.turns.length + " turns · ~$" + cost.toFixed(2) + "</div><p>" + E(sc.note) + "</p></div></div>";
          return;
        }
        var t = sc.turns[i]; cost += 0.04 + i * 0.006;
        var row = document.createElement("div");
        row.style.cssText = "display:grid;grid-template-columns:44px 1fr 120px;gap:10px;align-items:start;padding:8px 0;border-top:1px solid var(--rule);font-size:13.5px";
        row.innerHTML = '<div style="color:var(--ink-3);font-family:var(--mono)">#' + (i + 1) + "</div>" +
          "<div><div style=\"font-family:var(--mono);font-size:12.5px\">" + E(t.act) + "</div>" +
          (t.ev !== "—" ? '<div style="font-family:var(--mono);font-size:12px;color:var(--ink-2);margin-top:2px">⎿ ' + E(t.ev) + "</div>" : "") +
          '<div style="font-size:12.5px;color:var(--ink-3);margin-top:3px">Evaluator: ' + E(t.why) + "</div></div>" +
          '<div style="text-align:right"><span class="chip ' + VERDICT_CHIP[t.v] + '">' + t.v + "</span></div>";
        turnsEl.appendChild(row);
        i++;
      }, 520);
    }

    host.querySelectorAll("[data-p]").forEach(function (b) {
      b.addEventListener("click", function () { stop(); ta.value = PRESETS[+b.getAttribute("data-p")].text; paintScore(); turnsEl.innerHTML = ""; outEl.innerHTML = ""; });
    });
    ta.addEventListener("input", paintScore);
    runBtn.addEventListener("click", run);
    stopBtn.addEventListener("click", function () {
      stop();
      outEl.innerHTML = '<div class="callout info"><div class="callout-icon">⏹</div><div><p>Interrupted. In Claude Code, <kbd>Esc</kbd> interrupts the current turn; <code>/goal clear</code> removes the goal so Claude may stop.</p></div></div>';
    });
    ta.value = PRESETS[0].text;
    paintScore();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=goal-lab]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
