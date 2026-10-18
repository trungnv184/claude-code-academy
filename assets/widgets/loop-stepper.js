/* Lab: step through an agent loop iteration by iteration.
   Shows what enters the context window each turn, and what happens
   when the "verify" step is skipped (premature victory). */
(function () {
  "use strict";

  var RUN_VERIFIED = [
    { phase: "gather", title: "Read the task", detail: "User: \"The checkout total is wrong when a coupon is applied. Fix it.\"", tokens: 400, action: "—" },
    { phase: "gather", title: "Search the codebase", detail: "Grep(\"coupon\") → src/cart/total.ts, src/cart/total.test.ts", tokens: 1800, action: "Grep" },
    { phase: "gather", title: "Read the suspect file", detail: "Read(src/cart/total.ts) → discount applied after tax, not before", tokens: 5200, action: "Read" },
    { phase: "act", title: "Write a failing test first", detail: "Edit(total.test.ts) → expect(total({subtotal:100, coupon:10, tax:0.1})).toBe(99)", tokens: 6100, action: "Edit" },
    { phase: "verify", title: "Run the test — confirm it fails", detail: "Bash(npm test total) → ✗ expected 99, received 100", tokens: 6900, action: "Bash" },
    { phase: "act", title: "Fix the code", detail: "Edit(total.ts) → apply coupon to subtotal before computing tax", tokens: 7600, action: "Edit" },
    { phase: "verify", title: "Run the test again", detail: "Bash(npm test total) → ✓ 12 passed", tokens: 8300, action: "Bash" },
    { phase: "verify", title: "Run the full suite + types", detail: "Bash(npm test && tsc --noEmit) → ✓ 148 passed, 0 type errors", tokens: 9400, action: "Bash" },
    { phase: "done", title: "Report with evidence", detail: "\"Fixed: coupon now applied pre-tax. Added a regression test. Full suite green.\"", tokens: 9700, action: "—", outcome: "ok" }
  ];

  var RUN_UNVERIFIED = [
    { phase: "gather", title: "Read the task", detail: "User: \"The checkout total is wrong when a coupon is applied. Fix it.\"", tokens: 400, action: "—" },
    { phase: "gather", title: "Search the codebase", detail: "Grep(\"coupon\") → src/cart/total.ts", tokens: 1800, action: "Grep" },
    { phase: "act", title: "Edit what looks wrong", detail: "Edit(total.ts) → rounds the coupon with Math.floor (a plausible guess)", tokens: 3000, action: "Edit" },
    { phase: "done", title: "Declare victory", detail: "\"Fixed the coupon calculation!\" — no test was run. The real bug (tax order) is still there.", tokens: 3200, action: "—", outcome: "bad" }
  ];

  var COLORS = { gather: "info", act: "vio", verify: "ok", done: "warn" };
  var LIMIT = 12000; // a toy context budget so the meter is readable

  function mount(host) {
    var E = window.TUTOR.esc;
    host.innerHTML =
      '<div class="lab-head"><span class="lab-badge">Lab</span><span class="lab-title">Step through an agent loop</span></div>' +
      '<div class="lab-body">' +
        '<p>Task: <em>"The checkout total is wrong when a coupon is applied."</em> Step through each turn and watch two things: which phase the agent is in, and how fast the context window fills up.</p>' +
        '<div class="btn-row" role="group" aria-label="Choose a run">' +
          '<button class="btn primary" data-run="verified">Run with verification</button>' +
          '<button class="btn" data-run="unverified">Run without verification</button>' +
        '</div>' +
        '<div style="display:flex;gap:10px;align-items:center;margin:14px 0 6px;font-size:13px;color:var(--ink-3)">' +
          '<span>Context used</span><div class="progress-bar" style="flex:1;height:10px"><span class="ctx-fill"></span></div><span class="ctx-num">0</span>' +
        '</div>' +
        '<ol class="ls-steps" style="list-style:none;padding:0;margin:14px 0 0"></ol>' +
        '<div class="btn-row"><button class="btn" data-act="next">Next turn →</button><button class="btn ghost" data-act="all">Show all</button><button class="btn ghost" data-act="reset">Reset</button></div>' +
        '<div class="ls-verdict"></div>' +
      '</div>';

    var runKey = "verified", i = 0;
    var list = host.querySelector(".ls-steps");
    var fill = host.querySelector(".ctx-fill");
    var num = host.querySelector(".ctx-num");
    var verdict = host.querySelector(".ls-verdict");

    function steps() { return runKey === "verified" ? RUN_VERIFIED : RUN_UNVERIFIED; }

    function render() {
      var s = steps();
      list.innerHTML = "";
      for (var k = 0; k < i; k++) {
        var st = s[k];
        var li = document.createElement("li");
        li.style.cssText = "display:grid;grid-template-columns:84px 1fr;gap:12px;padding:10px 0;border-top:1px solid var(--rule)";
        li.innerHTML = '<div><span class="chip ' + COLORS[st.phase] + '">' + st.phase + '</span></div>' +
          '<div><div style="font-weight:600;font-size:14.5px">' + (k + 1) + ". " + E(st.title) + '</div>' +
          '<div style="font-family:var(--mono);font-size:12.5px;color:var(--ink-2);margin-top:2px">' + E(st.detail) + "</div></div>";
        list.appendChild(li);
      }
      var used = i ? s[i - 1].tokens : 0;
      fill.style.width = Math.min(100, used / LIMIT * 100) + "%";
      num.textContent = used.toLocaleString() + " tok";
      host.querySelector('[data-act="next"]').disabled = i >= s.length;
      verdict.innerHTML = "";
      if (i >= s.length) {
        var last = s[s.length - 1];
        verdict.innerHTML = last.outcome === "ok"
          ? '<div class="callout tip"><div class="callout-icon">✓</div><div><div class="callout-title">Verified done</div><p>Three of nine turns were verification. That isn\'t overhead — it\'s the only reason you can trust the final message. Note the bug was in a different place than the obvious guess.</p></div></div>'
          : '<div class="callout danger"><div class="callout-icon">✗</div><div><div class="callout-title">Premature victory</div><p>Fewer turns, fewer tokens, a confident summary — and the bug is still there. Without a check it can\'t fake, the agent stops at the first plausible answer. Lessons 4 and 5 make this impossible.</p></div></div>';
      }
    }

    host.querySelectorAll("[data-run]").forEach(function (b) {
      b.addEventListener("click", function () {
        runKey = b.getAttribute("data-run"); i = 1;
        host.querySelectorAll("[data-run]").forEach(function (x) { x.classList.toggle("primary", x === b); });
        render();
      });
    });
    host.querySelector('[data-act="next"]').addEventListener("click", function () { if (i < steps().length) { i++; render(); } });
    host.querySelector('[data-act="all"]').addEventListener("click", function () { i = steps().length; render(); });
    host.querySelector('[data-act="reset"]').addEventListener("click", function () { i = 0; render(); });
    render();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=loop-stepper]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
