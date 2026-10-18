/* Lab: a hook playground. Configure an event, matcher and a small rule set,
   fire simulated tool calls, and see the stdin JSON, the hook's exit code and
   output, and what Claude ends up seeing. Generates settings.json + script. */
(function () {
  "use strict";

  var CALLS = [
    { id: "rmrf", tool: "Bash", input: { command: "rm -rf /", description: "Clean up" } },
    { id: "force", tool: "Bash", input: { command: "git push --force origin main", description: "Push" } },
    { id: "test", tool: "Bash", input: { command: "npm test", description: "Run tests" } },
    { id: "env", tool: "Edit", input: { file_path: "/repo/.env", old_string: "DEBUG=false", new_string: "DEBUG=true" } },
    { id: "lock", tool: "Write", input: { file_path: "/repo/package-lock.json", content: "{…}" } },
    { id: "app", tool: "Write", input: { file_path: "/repo/src/app.ts", content: "export const app = …" } },
    { id: "readme", tool: "Read", input: { file_path: "/repo/README.md" } }
  ];

  var DEFAULT_PATTERNS = "rm +-(rf|fr)\ngit +push.*(--force|-f\\b)\ncurl[^|]*\\| *(ba)?sh";
  var DEFAULT_PATHS = ".env\npackage-lock.json\n.git/";

  function lines(s) { return s.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); }

  // Claude Code matcher semantics: "", "*" or omitted = all; only [A-Za-z0-9_|-] = exact name or list; otherwise regex.
  function matcherHits(matcher, tool) {
    var m = (matcher || "").trim();
    if (m === "" || m === "*") return true;
    if (/^[A-Za-z0-9_|-]+$/.test(m)) return m.split("|").indexOf(tool) !== -1;
    try { return new RegExp(m).test(tool); } catch (e) { return false; }
  }

  function evaluate(cfg, call) {
    var reason = null;
    if (call.tool === "Bash") {
      lines(cfg.patterns).some(function (p) {
        var re; try { re = new RegExp(p); } catch (e) { return false; }
        if (re.test(call.input.command)) { reason = "command matches deny pattern /" + p + "/"; return true; }
        return false;
      });
    }
    if (call.input.file_path && (call.tool === "Edit" || call.tool === "Write")) {
      lines(cfg.paths).some(function (p) {
        if (call.input.file_path.indexOf(p) !== -1) { reason = "file path contains protected \"" + p + "\""; return true; }
        return false;
      });
    }
    return reason;
  }

  function stdinFor(cfg, call) {
    var o = {
      session_id: "abc123",
      transcript_path: "~/.claude/projects/repo/abc123.jsonl",
      cwd: "/repo",
      permission_mode: "default",
      hook_event_name: cfg.event,
      tool_name: call.tool,
      tool_input: call.input
    };
    if (cfg.event === "PreToolUse") o.tool_use_id = "toolu_01ABC";
    if (cfg.event === "PostToolUse") o.tool_response = call.tool === "Bash" ? { stdout: "…", exitCode: 0 } : { success: true };
    return JSON.stringify(o, null, 2);
  }

  function run(cfg, call) {
    var res = { matched: matcherHits(cfg.matcher, call.tool), exit: 0, stdout: "", stderr: "", claude: "", verdict: "", chip: "" };
    if (!res.matched) {
      res.verdict = "Hook not run"; res.chip = "info";
      res.claude = "Matcher \"" + cfg.matcher + "\" doesn't match tool " + call.tool + ", so the hook never runs. The call proceeds under normal permission rules.";
      return res;
    }
    var reason = evaluate(cfg, call);
    var pre = cfg.event === "PreToolUse";
    if (!reason) {
      res.verdict = "Allowed (exit 0)"; res.chip = "ok";
      res.claude = pre ? "Nothing printed, exit 0: the tool call proceeds through the usual permission flow." : "The tool ran; the hook exited 0 silently, so Claude sees nothing extra.";
      return res;
    }
    var msg = "Blocked by guard.sh: " + reason;
    if (cfg.action === "block") {
      res.exit = 2; res.stderr = msg;
      if (pre) { res.verdict = "Blocked (exit 2)"; res.chip = "bad"; res.claude = "The tool call is blocked before it runs. stderr is fed back to Claude as the reason: \"" + msg + "\". Claude typically adapts and tries another approach."; }
      else { res.verdict = "Feedback (exit 2)"; res.chip = "warn"; res.claude = "Too late to block: the tool already ran. stderr is shown to Claude as feedback so it can fix things up. Use PreToolUse to prevent actions."; }
    } else if (cfg.action === "deny" || cfg.action === "ask") {
      if (pre) {
        res.stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: cfg.action, permissionDecisionReason: reason } }, null, 2);
        if (cfg.action === "deny") { res.verdict = "Denied (JSON)"; res.chip = "bad"; res.claude = "Exit 0 with a JSON permissionDecision of \"deny\": the call is refused and the reason is given to Claude. Same effect as exit 2, but structured."; }
        else { res.verdict = "Ask the user"; res.chip = "warn"; res.claude = "permissionDecision \"ask\": you get a permission prompt showing the reason, even if a rule would normally allow it. Good for \"probably fine, but let a human look\"."; }
      } else {
        res.stdout = JSON.stringify({ decision: "block", reason: reason }, null, 2);
        res.verdict = "Feedback (decision: block)"; res.chip = "warn";
        res.claude = "permissionDecision only applies to PreToolUse. For PostToolUse the script emits {decision:\"block\"} instead: the tool already ran, and the reason is shown to Claude.";
      }
    } else {
      res.stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: cfg.event, additionalContext: "Heads up: " + reason + ". Prefer a safer alternative." } }, null, 2);
      res.verdict = "Allowed + context"; res.chip = "vio";
      res.claude = "The call is not blocked. The additionalContext string is added to Claude's context. That's a nudge, not a guardrail.";
    }
    return res;
  }

  function settingsJson(cfg) {
    return JSON.stringify({
      hooks: (function () { var h = {}; h[cfg.event] = [{ matcher: cfg.matcher, hooks: [{ type: "command", command: "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard.sh", timeout: 10 }] }]; return h; })()
    }, null, 2);
  }

  function shq(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

  function script(cfg) {
    var pre = cfg.event === "PreToolUse";
    var onHit;
    if (cfg.action === "block") onHit = '  echo "Blocked by guard.sh: $1" >&2\n  exit 2';
    else if ((cfg.action === "deny" || cfg.action === "ask") && pre)
      onHit = "  jq -n --arg r \"$1\" '{hookSpecificOutput:{hookEventName:\"PreToolUse\",permissionDecision:\"" + cfg.action + "\",permissionDecisionReason:$r}}'\n  exit 0";
    else if (cfg.action === "deny" || cfg.action === "ask")
      onHit = "  jq -n --arg r \"$1\" '{decision:\"block\",reason:$r}'\n  exit 0";
    else
      onHit = "  jq -n --arg r \"Heads up: $1. Prefer a safer alternative.\" '{hookSpecificOutput:{hookEventName:\"" + cfg.event + "\",additionalContext:$r}}'\n  exit 0";
    return "#!/usr/bin/env bash\n" +
      "# .claude/hooks/guard.sh — " + cfg.event + " guard (generated by the Conducting Claude hook lab)\n" +
      "# Requires jq. Make executable: chmod +x .claude/hooks/guard.sh\n" +
      "set -euo pipefail\n" +
      "input=\"$(cat)\"\n" +
      "tool=\"$(jq -r '.tool_name' <<<\"$input\")\"\n" +
      "cmd=\"$(jq -r '.tool_input.command // empty' <<<\"$input\")\"\n" +
      "path=\"$(jq -r '.tool_input.file_path // empty' <<<\"$input\")\"\n\n" +
      "hit() {\n" + onHit + "\n}\n\n" +
      "deny_patterns=(\n" + lines(cfg.patterns).map(function (p) { return "  " + shq(p); }).join("\n") + "\n)\n" +
      "protected_paths=(\n" + lines(cfg.paths).map(function (p) { return "  " + shq(p); }).join("\n") + "\n)\n\n" +
      "if [[ \"$tool\" == \"Bash\" ]]; then\n" +
      "  for re in \"${deny_patterns[@]}\"; do\n" +
      "    if grep -Eq -- \"$re\" <<<\"$cmd\"; then hit \"command matches deny pattern /$re/\"; fi\n" +
      "  done\nfi\n\n" +
      "if [[ \"$tool\" == \"Edit\" || \"$tool\" == \"Write\" ]]; then\n" +
      "  for p in \"${protected_paths[@]}\"; do\n" +
      "    if [[ \"$path\" == *\"$p\"* ]]; then hit \"file path contains protected \\\"$p\\\"\"; fi\n" +
      "  done\nfi\n\n" +
      "exit 0\n";
  }

  function mount(host) {
    var E = window.TUTOR.esc;
    host.innerHTML =
      '<div class="lab-head"><span class="lab-badge">Lab</span><span class="lab-title">Hook playground</span></div>' +
      '<div class="lab-body">' +
        '<p>Configure a guard hook, then fire tool calls at it. You\'ll see exactly what the hook receives on stdin, what it returns, and what Claude experiences. The generated files at the bottom are real and copy-pasteable.</p>' +
        '<div class="lab-row">' +
          '<div><label for="hl-event">Event</label><select id="hl-event" class="hl-event"><option>PreToolUse</option><option>PostToolUse</option></select></div>' +
          '<div><label for="hl-matcher">Matcher</label><input id="hl-matcher" class="hl-matcher" type="text" value="Bash|Edit|Write"></div>' +
        '</div>' +
        '<div class="lab-row" style="margin-top:12px">' +
          '<div><label for="hl-pat">Deny command patterns (regex, one per line)</label><textarea id="hl-pat" class="hl-pat" style="min-height:90px"></textarea></div>' +
          '<div><label for="hl-paths">Protected paths (substring, one per line)</label><textarea id="hl-paths" class="hl-paths" style="min-height:90px"></textarea></div>' +
        '</div>' +
        '<div style="margin-top:12px"><label for="hl-action">On a match</label><select id="hl-action" class="hl-action">' +
          '<option value="block">Block: exit 2 + reason on stderr</option>' +
          '<option value="deny">Deny: JSON permissionDecision "deny"</option>' +
          '<option value="ask">Ask: JSON permissionDecision "ask"</option>' +
          '<option value="context">Warn only: JSON additionalContext</option>' +
        '</select></div>' +
        '<div style="margin:16px 0 6px;font-size:12.5px;font-weight:600;color:var(--ink-2)">Fire a tool call</div>' +
        '<div class="btn-row hl-calls" style="margin-top:0">' + CALLS.map(function (c) {
          var label = c.tool + "(" + (c.input.command || c.input.file_path.replace("/repo/", "")) + ")";
          return '<button class="btn" data-c="' + c.id + '" style="font-family:var(--mono);font-size:12.5px">' + E(label) + "</button>";
        }).join("") + "</div>" +
        '<div class="hl-result" style="margin-top:10px"></div>' +
        '<details style="margin-top:16px"><summary style="cursor:pointer;font-weight:600;font-size:14px">Generated files: .claude/settings.json + .claude/hooks/guard.sh</summary>' +
          '<div class="code-file"><span>.claude/settings.json</span><span>json</span></div><pre class="hl-settings"><code class="lang-json"></code></pre>' +
          '<div class="code-file"><span>.claude/hooks/guard.sh</span><span>bash</span></div><pre class="hl-script"><code class="lang-bash"></code></pre>' +
        "</details>" +
      "</div>";

    var $ = function (s) { return host.querySelector(s); };
    $(".hl-pat").value = DEFAULT_PATTERNS;
    $(".hl-paths").value = DEFAULT_PATHS;
    var last = null;

    function cfg() {
      return { event: $(".hl-event").value, matcher: $(".hl-matcher").value, patterns: $(".hl-pat").value, paths: $(".hl-paths").value, action: $(".hl-action").value };
    }

    function paintFiles() {
      var c = cfg();
      ["hl-settings", "hl-script"].forEach(function (cls) {
        var pre = $("." + cls), code = pre.querySelector("code");
        code.removeAttribute("data-hl");
        code.textContent = cls === "hl-settings" ? settingsJson(c) : script(c);
        var b = pre.querySelector(".copy-btn"); if (b) b.remove();
      });
      window.TUTOR.enhanceCode(host);
    }

    function fire(id) {
      last = id;
      var c = cfg(), call = CALLS.filter(function (x) { return x.id === id; })[0];
      var r = run(c, call);
      host.querySelectorAll(".hl-calls .btn").forEach(function (b) { b.classList.toggle("primary", b.getAttribute("data-c") === id); });
      var box = function (title, body, extra) {
        return '<div style="min-width:0"><div style="font-size:12px;font-weight:600;color:var(--ink-3);margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em">' + title + "</div>" +
          '<pre class="out" style="margin:0' + (extra || "") + '">' + E(body) + "</pre></div>";
      };
      $(".hl-result").innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="chip ' + r.chip + '">' + E(r.verdict) + "</span>" +
          (r.matched ? '<span style="font-size:13px;color:var(--ink-3)">exit code <strong style="color:var(--ink)">' + r.exit + "</strong></span>" : "") + "</div>" +
        '<div class="lab-row">' +
          box("stdin → hook", stdinFor(c, call)) +
          '<div style="display:grid;gap:10px;align-content:start;min-width:0">' +
            box("stdout", r.stdout || "(empty)") +
            box("stderr", r.stderr || "(empty)") +
          "</div>" +
        "</div>" +
        '<div class="callout ' + (r.chip === "bad" ? "danger" : r.chip === "ok" ? "tip" : r.chip === "vio" ? "pro" : r.chip === "info" ? "info" : "warn") + '" style="margin:14px 0 0"><div class="callout-icon">⏺</div><div><div class="callout-title">What Claude sees</div><p>' + E(r.claude) + "</p></div></div>";
    }

    host.querySelectorAll(".hl-calls .btn").forEach(function (b) { b.addEventListener("click", function () { fire(b.getAttribute("data-c")); }); });
    ["hl-event", "hl-matcher", "hl-pat", "hl-paths", "hl-action"].forEach(function (cls) {
      $("." + cls).addEventListener("input", function () { paintFiles(); if (last) fire(last); });
      $("." + cls).addEventListener("change", function () { paintFiles(); if (last) fire(last); });
    });
    paintFiles();
  }

  window.TUTOR.ready(function () {
    document.querySelectorAll("[data-widget=hook-lab]").forEach(function (h) { h.classList.add("lab"); mount(h); });
  });
})();
