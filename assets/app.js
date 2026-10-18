/* ==========================================================================
   Conducting Claude — course runtime (no build step, works from file://)
   - Injects top bar, sidebar, pager and "mark complete" into lesson pages
   - Tracks progress in localStorage (wrapped; the site works without it)
   - Provides TUTOR.terminal(), TUTOR.quiz(), copy buttons, light highlighting
   ========================================================================== */
(function () {
  "use strict";

  var LESSONS = [
    { id: "01", slug: "01-agent-loop.html",     title: "The Agent Loop",                 meta: "Mental model · 15 min" },
    { id: "02", slug: "02-context-claude-md.html", title: "Context Is the Program",      meta: "CLAUDE.md & memory · 20 min" },
    { id: "03", slug: "03-plan-mode.html",      title: "Plan Before You Code",           meta: "Plan mode · 20 min" },
    { id: "04", slug: "04-goals-loops.html",    title: "Goals & Loops",                  meta: "/goal, /loop, verification · 25 min" },
    { id: "05", slug: "05-hooks.html",          title: "Hooks: Deterministic Guardrails", meta: "Lifecycle automation · 25 min" },
    { id: "06", slug: "06-skills.html",         title: "Skills: Teach It Once",          meta: "SKILL.md & commands · 20 min" },
    { id: "07", slug: "07-subagents.html",      title: "Sub-agents & the Orchestra",     meta: "Delegation & parallelism · 30 min" },
    { id: "08", slug: "08-capstone.html",       title: "Capstone: Ship a Real Project",  meta: "Everything together · 60 min" },
    { id: "09", slug: "09-cheatsheet.html",     title: "Cheat Sheet & Final Exam",       meta: "Reference · 10 min" }
  ];

  var STORE_KEY = "cc-academy-progress-v1";

  // Record runtime errors on <html data-js-errors> so headless smoke tests can detect them.
  function recordError(msg) {
    var d = document.documentElement;
    d.setAttribute("data-js-errors", (d.getAttribute("data-js-errors") || "") + msg + " | ");
  }
  window.addEventListener("error", function (e) { recordError(e.message + " @" + (e.filename || "").split("/").pop() + ":" + e.lineno); });

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* storage blocked: progress is per-visit */ }
  }
  var progress = load();

  function isDone(id) { return !!(progress.done && progress.done[id]); }
  function setDone(id, value) {
    progress.done = progress.done || {};
    if (value) progress.done[id] = Date.now(); else delete progress.done[id];
    save(progress);
    refreshProgress();
  }
  function doneCount() { return LESSONS.filter(function (l) { return isDone(l.id); }).length; }

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  /* ---------- Theme ---------- */
  function initTheme() {
    var t = null;
    try { t = localStorage.getItem("cc-academy-theme"); } catch (e) {}
    if (t) document.documentElement.setAttribute("data-theme", t);
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme");
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = cur ? cur === "dark" : prefersDark;
    var next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("cc-academy-theme", next); } catch (e) {}
  }
  initTheme();

  /* ---------- Shell ---------- */
  function root() { return document.body.getAttribute("data-root") || "."; }
  function lessonHref(l) { return root() + "/lessons/" + l.slug; }

  function buildTopbar(active) {
    var r = root();
    var bar = el("header", { class: "topbar" });
    bar.innerHTML =
      '<button class="icon-btn menu-btn" aria-label="Open course menu">☰</button>' +
      '<a class="brand" href="' + r + '/index.html"><span class="brand-mark">C</span><span class="brand-text">Conducting Claude</span></a>' +
      '<nav>' +
        '<a class="hide-sm' + (active === "course" ? " active" : "") + '" href="' + r + '/index.html#curriculum">Curriculum</a>' +
        '<a class="' + (active === "playground" ? "active" : "") + '" href="' + r + '/playground.html">Playground</a>' +
        '<a class="hide-sm' + (active === "cheatsheet" ? " active" : "") + '" href="' + r + '/lessons/09-cheatsheet.html">Cheat sheet</a>' +
        '<button class="icon-btn theme-btn" aria-label="Toggle dark mode" title="Toggle theme">◐</button>' +
      '</nav>';
    bar.querySelector(".theme-btn").addEventListener("click", toggleTheme);
    bar.querySelector(".menu-btn").addEventListener("click", function () { document.body.classList.toggle("nav-open"); });
    return bar;
  }

  function buildSidebar(activeId) {
    var side = el("aside", { class: "sidebar", "aria-label": "Course lessons" });
    var html = '<div class="progress-wrap"><div class="progress-label"><span>Your progress</span><span class="progress-text"></span></div>' +
      '<div class="progress-bar"><span></span></div></div><h4>Course</h4><ul class="lesson-list">';
    LESSONS.forEach(function (l) {
      html += '<li><a data-id="' + l.id + '" href="' + lessonHref(l) + '" class="' + (l.id === activeId ? "active" : "") + '">' +
        '<span class="lesson-num">' + parseInt(l.id, 10) + '</span><span>' + esc(l.title) + '<span class="lesson-meta">' + esc(l.meta) + '</span></span></a></li>';
    });
    html += '</ul><h4 style="margin-top:22px">Extras</h4><ul class="lesson-list">' +
      '<li><a href="' + root() + '/playground.html"><span class="lesson-num">▶</span><span>Interactive Playground<span class="lesson-meta">Try Claude Code in the browser</span></span></a></li></ul>';
    side.innerHTML = html;
    return side;
  }

  function refreshProgress() {
    var n = doneCount(), total = LESSONS.length;
    document.querySelectorAll(".progress-text").forEach(function (e) { e.textContent = n + " / " + total; });
    document.querySelectorAll(".progress-bar span").forEach(function (e) { e.style.width = (n / total * 100) + "%"; });
    document.querySelectorAll(".lesson-list a[data-id]").forEach(function (a) { a.classList.toggle("done", isDone(a.getAttribute("data-id"))); });
    document.querySelectorAll(".card[data-id]").forEach(function (c) {
      var d = isDone(c.getAttribute("data-id"));
      c.classList.toggle("done", d);
      var s = c.querySelector(".card-status");
      if (s) { s.textContent = d ? "✓ Done" : ""; s.className = "card-status chip" + (d ? " ok" : ""); s.style.display = d ? "" : "none"; }
    });
    var cb = document.querySelector(".complete-btn");
    if (cb) {
      var id = document.body.getAttribute("data-lesson");
      cb.textContent = isDone(id) ? "✓ Completed — click to undo" : "Mark lesson complete";
      cb.classList.toggle("primary", !isDone(id));
    }
  }

  function buildFooter(activeId) {
    var idx = LESSONS.findIndex(function (l) { return l.id === activeId; });
    var prev = LESSONS[idx - 1], next = LESSONS[idx + 1];
    var f = el("footer", { class: "lesson-footer" });
    f.innerHTML =
      '<div class="complete-row"><div><strong>Finished reading?</strong><div style="color:var(--ink-3);font-size:14px">Progress is saved in this browser only.</div></div>' +
      '<button class="btn complete-btn"></button></div>' +
      '<div class="pager">' +
        (prev ? '<a class="prev" href="' + lessonHref(prev) + '"><small>← Previous</small>' + esc(prev.title) + '</a>' : '<a class="prev" href="' + root() + '/index.html"><small>← Back</small>Course home</a>') +
        (next ? '<a class="next" href="' + lessonHref(next) + '"><small>Next →</small>' + esc(next.title) + '</a>' : '<a class="next" href="' + root() + '/playground.html"><small>Next →</small>Playground</a>') +
      '</div>';
    f.querySelector(".complete-btn").addEventListener("click", function () {
      setDone(activeId, !isDone(activeId));
      if (isDone(activeId) && next) { /* gentle nudge only; no auto-navigation */ }
    });
    return f;
  }

  function buildToc(article) {
    var holder = article.querySelector("[data-toc]");
    if (!holder) return;
    var hs = article.querySelectorAll("h2");
    if (!hs.length) return;
    var html = "<strong>In this lesson</strong><ol>";
    hs.forEach(function (h, i) {
      if (!h.id) h.id = "s" + (i + 1) + "-" + h.textContent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      html += '<li><a href="#' + h.id + '">' + esc(h.textContent) + "</a></li>";
    });
    holder.className = "toc";
    holder.innerHTML = html + "</ol>";
  }

  /* ---------- Code blocks: copy + light highlighting ---------- */
  function highlight(code) {
    var lang = (code.className.match(/lang-(\w+)/) || [])[1];
    if (!lang || code.dataset.hl) return;
    code.dataset.hl = "1";
    var src = code.textContent;
    var out = esc(src);
    if (lang === "json") {
      out = out.replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="tok-p">$1</span>$2')
               .replace(/(:\s*)(&quot;.*?&quot;)/g, '$1<span class="tok-s">$2</span>')
               .replace(/\b(true|false|null)\b/g, '<span class="tok-k">$1</span>')
               .replace(/(:\s*)(\d+)/g, '$1<span class="tok-n">$2</span>');
    } else if (lang === "bash" || lang === "sh") {
      out = out.split("\n").map(function (line) {
        if (/^\s*#/.test(line)) return '<span class="tok-c">' + line + "</span>";
        return line.replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="tok-s">$1</span>')
                   .replace(/^(\s*\$?\s*)(claude|git|npm|npx|node|jq|cat|echo|mkdir|cd|exit|if|then|fi|grep|python3?)\b/, '$1<span class="tok-k">$2</span>');
      }).join("\n");
    } else if (lang === "md" || lang === "markdown") {
      out = out.split("\n").map(function (line) {
        if (/^---\s*$/.test(line)) return '<span class="tok-c">' + line + "</span>";
        if (/^#+\s/.test(line)) return '<span class="tok-n">' + line + "</span>";
        if (/^[a-z_-]+:\s/.test(line)) return line.replace(/^([a-z_-]+:)/, '<span class="tok-p">$1</span>');
        if (/^\s*[-*]\s/.test(line)) return line.replace(/^(\s*[-*])/, '<span class="tok-k">$1</span>');
        return line;
      }).join("\n");
    } else if (lang === "js" || lang === "ts" || lang === "py") {
      // Single pass so inserted markup is never re-matched by a later rule.
      var comment = lang === "py" ? "#.*$" : "\\/\\/.*$";
      var re = new RegExp("(" + comment + ")|(&quot;.*?&quot;|'[^'\\n]*?'|`[^`]*?`)|\\b(const|let|var|function|return|if|else|import|from|export|async|await|def|for|in|while|new|class|try|catch|throw|True|False|None)\\b", "gm");
      out = out.replace(re, function (m, c, s, k) {
        return '<span class="' + (c ? "tok-c" : s ? "tok-s" : "tok-k") + '">' + m + "</span>";
      });
    }
    code.innerHTML = out;
  }

  function enhanceCode(scope) {
    (scope || document).querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".copy-btn")) return;
      var code = pre.querySelector("code");
      if (code) highlight(code);
      var b = el("button", { class: "copy-btn", type: "button" }, "Copy");
      b.addEventListener("click", function () {
        var text = (code || pre).innerText;
        var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1400); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
        else { fallbackCopy(text); done(); }
      });
      pre.appendChild(b);
    });
  }
  function fallbackCopy(text) {
    var t = el("textarea"); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); } catch (e) {}
    t.remove();
  }

  /* ---------- Simulated terminal ----------
     TUTOR.terminal(target, {
       title, autoplay: [steps] | null, hints: ["/plan", ...], placeholder,
       commands: [{ match: RegExp|string, steps: [...] | function(input, ctx) -> steps }],
       fallback: function(input, ctx) -> steps
     })
     step = [kind, text, delayMs?]  kinds: user sys tool toolout claude ok err hook plan agent mode
            ["clear"] clears the screen; ["fn", function(ctx)] runs code (e.g. update a widget)
  */
  function terminal(target, opts) {
    var host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) return null;
    opts = opts || {};
    host.classList.add("term");
    host.innerHTML =
      '<div class="term-bar"><div class="term-dots"><i></i><i></i><i></i></div>' +
      '<div class="term-title">' + esc(opts.title || "claude — ~/project") + '</div>' +
      '<div class="term-actions">' + (opts.autoplay ? '<button data-act="replay">↻ Replay</button>' : "") + '<button data-act="clear">Clear</button></div></div>' +
      '<div class="term-screen" role="log" aria-live="polite"></div>' +
      (opts.interactive === false ? "" :
        '<div class="term-input"><span>&gt;</span><input type="text" spellcheck="false" autocomplete="off" aria-label="Type a prompt or slash command" placeholder="' + esc(opts.placeholder || "Type a prompt or /command and press Enter…") + '"></div>' +
        (opts.hints && opts.hints.length ? '<div class="term-hints">' + opts.hints.map(function (h) { return '<button type="button">' + esc(h) + "</button>"; }).join("") + "</div>" : ""));

    var screen = host.querySelector(".term-screen");
    var input = host.querySelector(".term-input input");
    var queue = [], running = false, token = 0;
    var ctx = { state: {}, host: host, print: function (kind, text) { addLine(kind, text); } };

    function addLine(kind, text) {
      var line = el("div", { class: "term-line " + (kind || "") });
      line.textContent = text == null ? "" : text;
      screen.appendChild(line);
      screen.scrollTop = screen.scrollHeight;
      return line;
    }

    function play(steps) {
      queue = queue.concat(steps || []);
      if (!running) pump(token);
    }

    function pump(myToken) {
      if (myToken !== token) return;
      if (!queue.length) { running = false; if (input) input.disabled = false; return; }
      running = true;
      if (input) input.disabled = true;
      var step = queue.shift();
      var kind = step[0], text = step[1], delay = step[2];
      if (kind === "clear") { screen.innerHTML = ""; return setTimeout(function () { pump(myToken); }, 50); }
      if (kind === "fn") { try { text(ctx); } catch (e) { console.error(e); } return setTimeout(function () { pump(myToken); }, delay || 50); }
      if (kind === "user") {
        var line = addLine("user", "");
        var i = 0;
        (function type() {
          if (myToken !== token) return;
          line.textContent = text.slice(0, ++i);
          screen.scrollTop = screen.scrollHeight;
          if (i < text.length) setTimeout(type, 14 + Math.random() * 18);
          else setTimeout(function () { pump(myToken); }, 350);
        })();
        return;
      }
      addLine(kind, text);
      setTimeout(function () { pump(myToken); }, delay != null ? delay : (kind === "sys" || kind === "toolout" ? 140 : 420));
    }

    function reset() { token++; queue = []; running = false; screen.innerHTML = ""; if (input) input.disabled = false; }

    function run(raw) {
      var inputText = raw.trim();
      if (!inputText) return;
      var steps = null;
      (opts.commands || []).some(function (c) {
        var hit = typeof c.match === "string" ? inputText.toLowerCase() === c.match.toLowerCase() || inputText.toLowerCase().indexOf(c.match.toLowerCase() + " ") === 0 : c.match.test(inputText);
        if (hit) { steps = typeof c.steps === "function" ? c.steps(inputText, ctx) : c.steps; return true; }
        return false;
      });
      if (!steps && opts.fallback) steps = opts.fallback(inputText, ctx);
      if (!steps) steps = [["claude", "This simulator only knows a scripted set of commands. Try one of the suggestions below."]];
      play([["user", inputText]].concat(steps));
    }

    host.querySelectorAll(".term-actions button").forEach(function (b) {
      b.addEventListener("click", function () {
        reset();
        if (b.getAttribute("data-act") === "replay" && opts.autoplay) play(opts.autoplay);
        else if (opts.banner) play(opts.banner);
      });
    });
    if (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !input.disabled) { run(input.value); input.value = ""; }
      });
    }
    host.querySelectorAll(".term-hints button").forEach(function (b) {
      b.addEventListener("click", function () { if (!running) run(b.textContent); });
    });

    if (opts.banner) play(opts.banner);
    if (opts.autoplay) {
      // Start playback when the terminal scrolls into view, so readers see it from the top.
      var started = false;
      var go = function () { if (!started) { started = true; play(opts.autoplay); } };
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { go(); io.disconnect(); } }); }, { threshold: 0.35 });
        io.observe(host);
      } else go();
    }
    return { play: play, reset: reset, run: run, ctx: ctx, print: addLine };
  }

  /* ---------- Quiz ----------
     TUTOR.quiz(target, { title, questions: [{ q, options: [..], answer: index, why }] }) */
  function quiz(target, cfg) {
    var host = typeof target === "string" ? document.querySelector(target) : target;
    if (!host) return;
    host.classList.add("quiz");
    var answered = 0, correct = 0;
    var html = "<h3>" + esc(cfg.title || "Check your understanding") + '</h3><div style="color:var(--ink-3);font-size:14px">' + cfg.questions.length + " questions · instant feedback</div>";
    cfg.questions.forEach(function (q, qi) {
      html += '<div class="q" data-q="' + qi + '"><div class="q-text">' + (qi + 1) + ". " + esc(q.q) + "</div>";
      q.options.forEach(function (o, oi) { html += '<button type="button" class="opt" data-o="' + oi + '">' + esc(o) + "</button>"; });
      html += '<div class="explain"></div></div>';
    });
    html += '<div class="quiz-score"></div>';
    host.innerHTML = html;
    host.querySelectorAll(".q").forEach(function (qe) {
      var q = cfg.questions[+qe.getAttribute("data-q")];
      qe.querySelectorAll(".opt").forEach(function (b) {
        b.addEventListener("click", function () {
          var oi = +b.getAttribute("data-o");
          qe.querySelectorAll(".opt").forEach(function (x) { x.disabled = true; });
          qe.querySelectorAll(".opt")[q.answer].classList.add("correct");
          if (oi !== q.answer) b.classList.add("wrong"); else correct++;
          answered++;
          var ex = qe.querySelector(".explain");
          ex.innerHTML = (oi === q.answer ? "<strong>Correct.</strong> " : "<strong>Not quite.</strong> ") + esc(q.why || "");
          ex.classList.add("show");
          if (answered === cfg.questions.length) {
            host.querySelector(".quiz-score").innerHTML = "Score: " + correct + " / " + cfg.questions.length +
              (correct === cfg.questions.length ? " — perfect. 🎼" : correct >= cfg.questions.length * 0.6 ? " — solid. Review the misses above." : " — worth a re-read of the sections above.");
          }
        });
      });
    });
  }

  /* ---------- Boot ---------- */
  function boot() {
    var body = document.body;
    var lessonId = body.getAttribute("data-lesson");
    var page = body.getAttribute("data-page");
    body.insertBefore(buildTopbar(page || (lessonId ? "course" : "")), body.firstChild);

    if (lessonId) {
      var main = document.querySelector("main");
      var wrap = el("div", { class: "course" });
      main.parentNode.insertBefore(wrap, main);
      wrap.appendChild(buildSidebar(lessonId));
      wrap.appendChild(main);
      main.classList.add("main");
      main.appendChild(buildFooter(lessonId));
      var art = main.querySelector(".article");
      if (art) buildToc(art);
      document.addEventListener("click", function (e) {
        if (body.classList.contains("nav-open") && !e.target.closest(".sidebar") && !e.target.closest(".menu-btn")) body.classList.remove("nav-open");
      });
      var l = LESSONS.find(function (x) { return x.id === lessonId; });
      if (l && !document.title) document.title = l.title + " · Conducting Claude";
    }
    enhanceCode();
    refreshProgress();
    // Lesson scripts register init functions; run them after the shell exists.
    (window.TUTOR._ready || []).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); recordError(String(e && e.stack || e)); } });
  }

  window.TUTOR = window.TUTOR || {};
  window.TUTOR.LESSONS = LESSONS;
  window.TUTOR.terminal = terminal;
  window.TUTOR.quiz = quiz;
  window.TUTOR.esc = esc;
  window.TUTOR.el = el;
  window.TUTOR.enhanceCode = enhanceCode;
  window.TUTOR.isDone = isDone;
  window.TUTOR.ready = function (fn) { (window.TUTOR._ready = window.TUTOR._ready || []).push(fn); };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
