/* Lab: build a SKILL.md and test whether a prompt would trigger it.
   The trigger tester is a keyword-overlap heuristic for teaching purposes —
   Claude actually decides by reading descriptions with the model, not by counting words. */
(function () {
  "use strict";

  var STOP = ("a an the and or but for to of in on at by with from into this that these those it its is are was were be been " +
    "do does did can could should would will i me my we our you your he she they them their what which who when how why " +
    "please help want need make get some any all just also about use using used as if then than so not no yes up out " +
    "new add run check").split(" ");

  var INSTALLED = [
    { name: "release-notes", description: "Generate release notes and a changelog entry from git commits between two tags. Groups changes into features, fixes and breaking changes.",
      when: "Use when the user asks for release notes, a changelog, what changed since a version, or is preparing a release or tag." },
    { name: "api-conventions", description: "REST API conventions for this repo: route naming, error envelopes, pagination, validation with zod, and status codes.",
      when: "Use when creating, changing or reviewing an HTTP endpoint, route, controller or API response." },
    { name: "db-migrations", description: "How to write safe Prisma database migrations: additive changes, backfills, and zero-downtime column renames.",
      when: "Use when changing the database schema, adding a column or table, or writing a migration." },
    { name: "fix-issue", description: "Fix a GitHub issue end to end: read it, reproduce, write a failing test, fix, open a PR.",
      when: "", userOnly: true }
  ];

  var EXAMPLES = {
    good: {
      name: "pdf-forms",
      description: "Fill, extract and validate PDF form fields using the bundled pypdf script. Handles checkboxes, dropdowns and signature fields.",
      when: "Use when the user mentions a PDF, a fillable form, AcroForm fields, or wants to read or populate a form.",
      body: "# PDF forms\n\n## Steps\n1. List fields: `python ${CLAUDE_SKILL_DIR}/scripts/fields.py <file.pdf>`\n2. Map the user's data to field names; ask if a field is ambiguous.\n3. Fill: `python ${CLAUDE_SKILL_DIR}/scripts/fill.py <file.pdf> data.json out.pdf`\n4. Verify by re-listing fields in out.pdf and comparing values.\n\n## Gotchas\n- Checkbox values are usually /Yes or /Off, not true/false.\n- See reference/field-types.md for dropdown edge cases."
    },
    bad: {
      name: "Helper Stuff",
      description: "Helps with various things.",
      when: "",
      body: "Do the task well. Be careful and write good code."
    }
  };

  function stem(w) {
    return w.replace(/(ing|ed|es|s)$/, "").replace(/(.)\1$/, "$1");
  }
  function tokens(text) {
    return (text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
      .filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; })
      .map(stem);
  }
  function unique(arr) { var seen = {}; return arr.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; }); }

  function yamlValue(s) {
    s = s.trim();
    if (!s) return '""';
    if (/[:#]\s|^[\[{>|*&!%@`'"-]|\s$/.test(s)) return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    return s;
  }

  function lint(f) {
    var out = [];
    var nameOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.name) && f.name.length <= 64;
    if (!f.name) out.push(["bad", "Name is empty. It defaults to the folder name, but set it so /" + "name is predictable."]);
    else if (!nameOk) out.push(["bad", "Name should be lowercase-with-hyphens (≤64 chars). It becomes the slash command: /" + f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")]);
    else out.push(["ok", "Name is a valid slash command: /" + f.name]);

    var d = f.description.trim();
    if (!d) out.push(["bad", "No description. Claude decides whether to load a skill almost entirely from this field."]);
    else {
      if (d.length < 40) out.push(["warn", "Description is very short (" + d.length + " chars). Say what it does AND what inputs/domains it covers."]);
      var vague = (d.match(/\b(helps?|stuff|things|various|misc|utility|general|good)\b/gi) || []);
      if (vague.length) out.push(["warn", "Vague words: \"" + unique(vague.map(function (v) { return v.toLowerCase(); })).join("\", \"") + "\". Replace with concrete nouns a user would actually type."]);
      var kw = unique(tokens(d + " " + f.when));
      if (kw.length < 6) out.push(["warn", "Only " + kw.length + " distinctive keywords. Add the terms people use: file types, tools, verbs (" + "e.g. \"PDF\", \"changelog\", \"migration\")."]);
      else out.push(["ok", kw.length + " distinctive keywords — good surface area for matching."]);
      if (!f.when.trim() && !/\b(use (this )?when|when the user|whenever)\b/i.test(d))
        out.push(["warn", "No trigger context. Add when_to_use (or \"Use when…\" in the description) so Claude knows WHEN, not just WHAT."]);
      if (d.length > 1024) out.push(["warn", "Description is long. It's loaded in every session — keep it tight; put detail in the body."]);
    }

    var lines = f.body.split("\n").length;
    var words = f.body.trim() ? f.body.trim().split(/\s+/).length : 0;
    if (!f.body.trim()) out.push(["warn", "Body is empty. The body is the playbook Claude follows once the skill loads."]);
    else if (lines > 500) out.push(["bad", "Body is " + lines + " lines. Keep SKILL.md under ~500 lines; move detail into supporting files it links to."]);
    else if (words < 25) out.push(["warn", "Body is thin (" + words + " words). Generic advice (\"write good code\") adds nothing the model doesn't already know — add steps, commands, gotchas."]);
    else out.push(["ok", "Body: " + lines + " lines, " + words + " words. Loaded only when the skill is used."]);
    if (/\b(be careful|write good code|do (it|the task) well|best practices)\b/i.test(f.body))
      out.push(["warn", "Platitudes detected. Skills earn their keep with specifics: exact commands, file paths, edge cases."]);
    return out;
  }

  function score(prompt, skill) {
    var p = unique(tokens(prompt));
    if (!p.length) return { s: 0, hits: [] };
    var desc = tokens(skill.description + " " + (skill.when || "") + " " + skill.name.replace(/-/g, " "));
    // Display the user's own words, not their stems.
    var raw = {};
    (prompt.toLowerCase().match(/[a-z0-9]+/g) || []).forEach(function (w) { if (!raw[stem(w)]) raw[stem(w)] = w; });
    var hits = p.filter(function (w) { return desc.indexOf(w) >= 0; }).map(function (w) { return raw[w] || w; });
    // Normalize by prompt length (sqrt keeps long prompts from collapsing every score to ~0).
    return { s: Math.min(1, hits.length / Math.sqrt(p.length * 1.6)), hits: hits };
  }

  function mount(host) {
    var E = window.TUTOR.esc;
    host.innerHTML =
      '<div class="lab-head"><span class="lab-badge">Lab</span><span class="lab-title">Skill builder &amp; trigger tester</span></div>' +
      '<div class="lab-body">' +
        '<p>Write a skill on the left; the generated <code>SKILL.md</code> and a lint report update live. Then type prompts into the tester to see whether your skill — or one of four "installed" skills — would most plausibly be picked.</p>' +
        '<div class="btn-row"><button class="btn" data-ex="good">Load a good example</button><button class="btn" data-ex="bad">Load a bad example</button><button class="btn ghost" data-ex="clear">Clear</button></div>' +
        '<div class="lab-row">' +
          '<div>' +
            '<label for="sk-name">name</label><input type="text" id="sk-name" spellcheck="false">' +
            '<label for="sk-desc" style="margin-top:12px">description <span style="font-weight:400;color:var(--ink-3)">— always in context</span></label><textarea id="sk-desc" style="min-height:70px;font-family:var(--sans)"></textarea>' +
            '<label for="sk-when" style="margin-top:12px">when_to_use <span style="font-weight:400;color:var(--ink-3)">— optional, appended to description</span></label><textarea id="sk-when" style="min-height:56px;font-family:var(--sans)"></textarea>' +
            '<label for="sk-body" style="margin-top:12px">body <span style="font-weight:400;color:var(--ink-3)">— loaded only when used</span></label><textarea id="sk-body" style="min-height:170px"></textarea>' +
          '</div>' +
          '<div>' +
            '<label>.claude/skills/<span class="sk-dir">your-skill</span>/SKILL.md</label><pre class="out sk-out" style="max-height:300px;overflow:auto"></pre>' +
            '<label style="margin-top:12px">Lint</label><ul class="sk-lint" style="list-style:none;padding:0;margin:0"></ul>' +
          '</div>' +
        '</div>' +
        '<hr style="border:0;border-top:1px solid var(--rule);margin:20px 0">' +
        '<label for="sk-prompt">Would it trigger? Type a user prompt</label>' +
        '<input type="text" id="sk-prompt" spellcheck="false" placeholder="e.g. Fill in this PDF form with my address">' +
        '<div class="btn-row sk-samples"></div>' +
        '<div class="sk-results"></div>' +
        '<p style="font-size:13px;color:var(--ink-3);margin:10px 0 0">Heuristic illustration only: this counts keyword overlap. Real Claude reads every skill\'s name + description with the model and judges relevance semantically — but descriptions that share vocabulary with real requests win in both worlds.</p>' +
      '</div>';

    var $ = function (s) { return host.querySelector(s); };
    var fName = $("#sk-name"), fDesc = $("#sk-desc"), fWhen = $("#sk-when"), fBody = $("#sk-body"), fPrompt = $("#sk-prompt");

    function form() { return { name: fName.value.trim(), description: fDesc.value, when: fWhen.value, body: fBody.value }; }

    function renderSkill() {
      var f = form();
      var md = "---\nname: " + (f.name || "your-skill") + "\ndescription: " + yamlValue(f.description.replace(/\s*\n\s*/g, " ")) + "\n";
      if (f.when.trim()) md += "when_to_use: " + yamlValue(f.when.replace(/\s*\n\s*/g, " ")) + "\n";
      md += "---\n\n" + f.body;
      $(".sk-out").textContent = md;
      $(".sk-dir").textContent = f.name || "your-skill";
      var icon = { ok: "✓", warn: "!", bad: "✗" };
      $(".sk-lint").innerHTML = lint(f).map(function (l) {
        return '<li style="display:grid;grid-template-columns:28px 1fr;gap:6px;font-size:13.5px;margin-bottom:6px;line-height:1.45">' +
          '<span class="chip ' + l[0] + '" style="justify-content:center;padding:1px 0;align-self:start;height:22px">' + icon[l[0]] + "</span><span>" + E(l[1]) + "</span></li>";
      }).join("");
      renderTrigger();
    }

    function renderTrigger() {
      var p = fPrompt.value.trim();
      var res = $(".sk-results");
      if (!p) { res.innerHTML = '<div style="color:var(--ink-3);font-size:14px;padding:8px 0">Type a prompt or click a sample above.</div>'; return; }
      var f = form();
      var all = INSTALLED.slice();
      if (f.name || f.description) all.unshift({ name: f.name || "your-skill", description: f.description, when: f.when, mine: true });
      var scored = all.map(function (s) { var r = score(p, s); return { skill: s, s: s.userOnly ? 0 : r.s, raw: r.s, hits: r.hits }; })
        .sort(function (a, b) { return b.s - a.s; });
      var top = scored[0];
      var html = "";
      if (!top || top.s < 0.22) html += '<div class="callout info" style="margin:12px 0"><div class="callout-icon">○</div><div><p><strong>No skill loads.</strong> Nothing matches strongly enough, so Claude answers with its general knowledge plus CLAUDE.md.</p></div></div>';
      else html += '<div class="callout tip" style="margin:12px 0"><div class="callout-icon">⚡</div><div><p><strong>Most likely loaded: <code>' + E(top.skill.name) + "</code></strong>" + (top.skill.mine ? " — that's yours." : "") + " Its full body now enters context.</p></div></div>";
      scored.forEach(function (r) {
        var pct = Math.round(r.s * 100);
        html += '<div style="display:grid;grid-template-columns:150px 1fr 46px;gap:10px;align-items:center;margin:6px 0;font-size:13.5px">' +
          '<span style="font-family:var(--mono);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + E(r.skill.name) + (r.skill.mine ? ' <span class="chip vio" style="padding:0 6px">you</span>' : "") + "</span>" +
          '<div class="progress-bar" style="height:8px"><span style="width:' + pct + "%;" + (r === top && r.s >= 0.22 ? "" : "background:var(--ink-3)") + '"></span></div>' +
          '<span style="text-align:right;color:var(--ink-3)">' + pct + "%</span>" +
          '<span></span><span style="grid-column:2/4;color:var(--ink-3);font-size:12.5px;margin-top:-4px">' +
          (r.skill.userOnly ? "disable-model-invocation: true — only runs when you type /" + E(r.skill.name) :
            r.hits.length ? "matched: " + E(r.hits.join(", ")) : "no shared keywords") + "</span></div>";
      });
      res.innerHTML = html;
    }

    var samples = ["Fill in this PDF form with my address", "Write the changelog for v2.4.0", "Add a pagination param to the orders endpoint",
      "Rename the email column on users", "Fix issue 1234", "Why is my CSS grid overflowing?"];
    samples.forEach(function (s) {
      var b = document.createElement("button"); b.className = "btn ghost"; b.type = "button"; b.style.fontSize = "12.5px"; b.textContent = s;
      b.addEventListener("click", function () { fPrompt.value = s; renderTrigger(); });
      $(".sk-samples").appendChild(b);
    });

    function load(ex) {
      var e = EXAMPLES[ex] || { name: "", description: "", when: "", body: "" };
      fName.value = e.name; fDesc.value = e.description; fWhen.value = e.when; fBody.value = e.body;
      renderSkill();
    }
    host.querySelectorAll("[data-ex]").forEach(function (b) { b.addEventListener("click", function () { load(b.getAttribute("data-ex")); }); });
    [fName, fDesc, fWhen, fBody].forEach(function (i) { i.addEventListener("input", renderSkill); });
    fPrompt.addEventListener("input", renderTrigger);
    load("good");
    fPrompt.value = samples[0];
    renderTrigger();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=skill-lab]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
