/* Emberline. Vanilla JS, no dependencies. Each block below is independent. */
(function () {
  "use strict";

  var doc = document, root = doc.documentElement;
  var $ = function (s, el) { return (el || doc).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  /* ---------- Headline: split into words that rise into place ---------- */
  var headline = $("#headline");
  if (headline) {
    var i = 0, html = "";
    var wrap = function (text, em) {
      return text.split(/\s+/).filter(Boolean).map(function (word) {
        var inner = em ? "<em>" + word + "</em>" : word;
        return '<span class="w"><span style="--i:' + i++ + '">' + inner + "</span></span>";
      }).join(" ");
    };
    headline.childNodes.forEach(function (node) {
      if (node.nodeType === 3) html += wrap(node.textContent, false) + " ";
      else if (node.nodeType === 1) html += wrap(node.textContent, node.tagName === "EM") + " ";
    });
    headline.innerHTML = html.trim();
    requestAnimationFrame(function () { requestAnimationFrame(function () { headline.classList.add("in"); }); });
  }

  /* ---------- Reveal on scroll ---------- */
  $$("[data-stagger]").forEach(function (group) {
    $$("[data-reveal]", group).forEach(function (el, n) { el.style.setProperty("--d", n); });
  });
  $$("[data-reveal][data-delay]").forEach(function (el) { el.style.setProperty("--d", el.getAttribute("data-delay")); });
  var reveals = $$("[data-reveal]");
  if ("IntersectionObserver" in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Header, scroll progress, process rail ---------- */
  var nav = $(".nav"), steps = $("#steps"), stepEls = $$(".step");
  var narrow = window.matchMedia("(max-width: 900px)");
  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY || 0;
    var max = Math.max(1, doc.documentElement.scrollHeight - window.innerHeight);
    root.style.setProperty("--scroll", clamp(y / max, 0, 1).toFixed(4));
    if (nav) nav.classList.toggle("scrolled", y > 16);
    if (steps) {
      var r = steps.getBoundingClientRect();
      var p = clamp((window.innerHeight * 0.72 - r.top) / Math.max(1, r.height + window.innerHeight * 0.1), 0, 1);
      steps.style.setProperty("--p", p.toFixed(4));
      stepEls.forEach(function (s) {
        var at = narrow.matches ? s.offsetTop / Math.max(1, steps.offsetHeight) : s.offsetLeft / Math.max(1, steps.offsetWidth);
        s.classList.toggle("lit", p > at + 0.01);
      });
    }
  }
  function requestScroll() { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }
  window.addEventListener("scroll", requestScroll, { passive: true });
  window.addEventListener("resize", requestScroll);
  onScroll();

  /* ---------- Active link in the header ---------- */
  var links = $$(".nav-links a");
  if ("IntersectionObserver" in window && links.length) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove("on"); });
        if (byId[e.target.id]) byId[e.target.id].classList.add("on");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    // Top-level sections only: the hero and contact have no header link, so they clear the highlight.
    $$("main > section").forEach(function (s) { spy.observe(s); });
  }

  /* ---------- Mobile menu ---------- */
  var burger = $("#burger"), menu = $("#menu");
  function setMenu(open) {
    if (!burger || !menu) return;
    menu.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }
  if (burger) {
    burger.addEventListener("click", function () { setMenu(burger.getAttribute("aria-expanded") !== "true"); });
    links.forEach(function (a) { a.addEventListener("click", function () { setMenu(false); }); });
    doc.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });
  }

  /* ---------- Theme switch ---------- */
  var themeBtn = $("#themeBtn"), themeMeta = $('meta[name="theme-color"]');
  function applyThemeMeta() { if (themeMeta) themeMeta.setAttribute("content", root.getAttribute("data-theme") === "light" ? "#f6f0e7" : "#0d0b09"); }
  applyThemeMeta();
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      applyThemeMeta();
      try { localStorage.setItem("emberline-theme", next); } catch (e) {}
    });
  }

  /* ---------- Hero: drifting embers ---------- */
  var canvas = $("#embers");
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext("2d"), W = 0, H = 0, dpr = 1, sparks = [], running = false, visible = true;
    var mouse = { x: -9999, y: -9999 };
    var make = function (anywhere) {
      return {
        x: Math.random() * W,
        y: anywhere ? Math.random() * H : H + 10 + Math.random() * 40,
        r: 0.6 + Math.random() * 2,
        vy: 0.18 + Math.random() * 0.6,
        sway: Math.random() * Math.PI * 2,
        swaySpeed: 0.006 + Math.random() * 0.014,
        drift: 0.15 + Math.random() * 0.5,
        heat: Math.random()
      };
    };
    var resize = function () {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var want = Math.round(clamp(W / 16, 26, 90));
      sparks = [];
      for (var n = 0; n < want; n++) sparks.push(make(true));
    };
    var draw = function () {
      var light = root.getAttribute("data-theme") === "light";
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      for (var n = 0; n < sparks.length; n++) {
        var s = sparks[n];
        s.sway += s.swaySpeed;
        s.y -= s.vy;
        s.x += Math.sin(s.sway) * s.drift;
        var dx = s.x - mouse.x, dy = s.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 16000) { var f = (1 - d2 / 16000) * 1.6, d = Math.sqrt(d2) || 1; s.x += (dx / d) * f; s.y += (dy / d) * f; }
        if (s.y < -20 || s.x < -30 || s.x > W + 30) { sparks[n] = make(false); continue; }
        var life = clamp(s.y / H, 0, 1);                       // fades as it rises
        var flicker = 0.75 + 0.25 * Math.sin(s.sway * 3.1);
        var alpha = (light ? 0.5 : 0.85) * life * flicker;
        var g = Math.round(90 + s.heat * 110);                 // orange to amber
        var glow = s.r * 5;
        var grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glow);
        grad.addColorStop(0, "rgba(255," + g + ",40," + alpha.toFixed(3) + ")");
        grad.addColorStop(0.25, "rgba(255," + g + ",31," + (alpha * 0.45).toFixed(3) + ")");
        grad.addColorStop(1, "rgba(255,90,31,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(s.x, s.y, glow, 0, 6.2832); ctx.fill();
      }
    };
    var loop = function () {
      if (!running) return;
      draw();
      requestAnimationFrame(loop);
    };
    var sync = function () {
      var should = visible && !doc.hidden && !reduced;
      if (should && !running) { running = true; requestAnimationFrame(loop); }
      else if (!should) running = false;
    };
    resize();
    if (reduced) draw();
    window.addEventListener("resize", function () { resize(); if (reduced) draw(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) { visible = e[0].isIntersecting; sync(); }).observe(canvas);
    }
    doc.addEventListener("visibilitychange", sync);
    var hero = canvas.parentElement;
    hero.addEventListener("pointermove", function (e) { var r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
    hero.addEventListener("pointerleave", function () { mouse.x = mouse.y = -9999; });
    sync();
  }

  /* ---------- Hero mock: design, develop, host ---------- */
  var mock = $("#mock"), stageWrap = $(".stages"), stageBtns = $$(".stages button");
  if (mock && stageBtns.length) {
    var order = stageBtns.map(function (b) { return b.getAttribute("data-s"); });
    var STAGE_MS = 3200, timer = null, resume = null, idx = 0, inView = true;
    stageWrap.style.setProperty("--stage-ms", STAGE_MS + "ms");
    var show = function (n) {
      idx = (n + order.length) % order.length;
      mock.setAttribute("data-stage", order[idx]);
      stageBtns.forEach(function (b, k) { b.classList.toggle("on", k === idx); b.setAttribute("aria-pressed", String(k === idx)); });
    };
    var stop = function () { clearInterval(timer); timer = null; };
    var start = function () {
      stop();
      if (reduced || !inView) return;
      stageWrap.classList.remove("paused");
      show(idx);
      timer = setInterval(function () { show(idx + 1); }, STAGE_MS);
    };
    stageBtns.forEach(function (b, k) {
      b.addEventListener("click", function () {
        stop(); clearTimeout(resume);
        stageWrap.classList.add("paused");
        show(k);
        resume = setTimeout(start, 9000);
      });
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) { inView = e[0].isIntersecting; if (inView) start(); else stop(); }, { threshold: 0.2 }).observe(mock);
    }
    show(0);
    if (reduced) stageWrap.classList.add("paused"); else start();
  }

  /* ---------- Pointer effects: spotlight, tilt, magnetic buttons ---------- */
  if (finePointer && !reduced) {
    $$(".spot").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty("--sx", e.clientX - r.left + "px");
        el.style.setProperty("--sy", e.clientY - r.top + "px");
      });
    });
    $$(".tilt").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--ry", ((px - 0.5) * 7).toFixed(2) + "deg");
        el.style.setProperty("--rx", ((0.5 - py) * 7).toFixed(2) + "deg");
      });
      el.addEventListener("pointerleave", function () { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); });
    });
    $$(".magnetic").forEach(function (el) {
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty("--mx", ((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1) + "px");
        el.style.setProperty("--my", ((e.clientY - r.top - r.height / 2) * 0.28).toFixed(1) + "px");
      });
      el.addEventListener("pointerleave", function () { el.style.setProperty("--mx", "0px"); el.style.setProperty("--my", "0px"); });
    });
  }

  /* ---------- Prices count up when they scroll into view ---------- */
  var counters = $$("[data-count]");
  if (counters.length && "IntersectionObserver" in window && !reduced) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        cio.unobserve(e.target);
        var el = e.target, end = parseInt(el.getAttribute("data-count"), 10), t0 = performance.now(), dur = 1100;
        var tick = function (now) {
          var k = clamp((now - t0) / dur, 0, 1), eased = 1 - Math.pow(1 - k, 3);
          el.textContent = String(Math.round(end * eased));
          if (k < 1) requestAnimationFrame(tick); else el.textContent = String(end);
        };
        el.textContent = "0";
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ---------- Folding panels: compare table and FAQ ---------- */
  $$("button[aria-controls]").forEach(function (btn) {
    var panel = doc.getElementById(btn.getAttribute("aria-controls"));
    if (!panel || !panel.classList.contains("fold")) return;
    btn.addEventListener("click", function () {
      var open = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", String(open));
      panel.classList.toggle("open", open);
    });
  });

  /* ---------- Plan finder ---------- */
  var PRICES = { Spark: "$199 AUD per month", Flame: "$299 AUD per month", Blaze: "$399 AUD per month", Forge: "Custom pricing" };
  var range = $("#fPages"), out = $("#fPagesOut"), fPlan = $("#fPlan"), fPrice = $("#fPrice"), fWhy = $("#fWhy"), fChoose = $("#fChoose");
  var finder = $("#finder"), touched = false, lastPlan = "Spark";
  function recommend() {
    var pages = parseInt(range.value, 10);
    var needs = $$('input[name="need"]:checked', finder).map(function (c) { return c.value; });
    var freq = ($('input[name="freq"]:checked', finder) || {}).value || "rare";
    var has = function (v) { return needs.indexOf(v) !== -1; };
    if (has("custom")) return ["Forge", "Logins, apps and integrations are custom work, so we price them individually for you."];
    if (pages > 20) return ["Forge", "Sites with more than 20 pages are quoted individually, so you only pay for what you need."];
    if (has("store") || has("booking")) return ["Blaze", "Selling or taking bookings online is built into Blaze, along with the most update time."];
    if (pages > 10) return ["Blaze", "More than 10 pages needs the room Blaze gives you, with space for up to 20."];
    if (freq === "weekly") return ["Blaze", "Weekly changes are best covered by the 6 hours of updates each month in Blaze."];
    if (has("blog")) return ["Flame", "A blog or news section starts on Flame, with 3 hours of updates each month to keep it fresh."];
    if (pages > 5) return ["Flame", "More than 5 pages moves you up to Flame, with room for up to 10."];
    if (freq === "monthly") return ["Flame", "Monthly changes are covered by the 3 hours of updates each month in Flame."];
    return ["Spark", "A small, polished site that rarely changes sits comfortably on Spark."];
  }
  function updateFinder() {
    var v = parseInt(range.value, 10), max = parseInt(range.max, 10), min = parseInt(range.min, 10);
    out.textContent = v >= max ? max + "+" : String(v);
    range.style.setProperty("--v", ((v - min) / (max - min)) * 100 + "%");
    var rec = recommend(), plan = rec[0];
    fPrice.textContent = PRICES[plan];
    fWhy.textContent = rec[1];
    fChoose.textContent = plan === "Forge" ? "Get a quote" : "Choose " + plan;
    fChoose.setAttribute("data-choose", plan);
    if (plan !== lastPlan) {
      fPlan.textContent = plan;
      fPlan.classList.remove("swap"); void fPlan.offsetWidth; fPlan.classList.add("swap");
      lastPlan = plan;
    }
    if (touched) $$("[data-plan]").forEach(function (el) { el.classList.toggle("pick", el.getAttribute("data-plan") === plan); });
  }
  if (finder && range) {
    finder.addEventListener("input", function () { touched = true; updateFinder(); });
    finder.addEventListener("change", function () { touched = true; updateFinder(); });
    updateFinder();
  }

  /* ---------- "Choose plan" buttons fill in the enquiry form ---------- */
  var form = $("#enquiry"), planSelect = $("#plan");
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-choose]") : null;
    if (!btn || !planSelect) return;
    var plan = btn.getAttribute("data-choose");
    $$("option", planSelect).forEach(function (o) { if (o.value.indexOf(plan) === 0) planSelect.value = o.value; });
    var box = planSelect.parentElement;
    box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash");
    setTimeout(function () { var n = $("#name"); if (n) n.focus({ preventScroll: true }); }, reduced ? 0 : 700);
  });

  /* ---------- Enquiry form: validation and sending (Netlify Forms) ---------- */
  if (form) {
    var note = $("#formNote"), sent = $("#sent");
    var rules = {
      name: function (v) { return v.trim() ? "" : "Please tell us your name."; },
      email: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? "" : "Please enter a valid email address."; },
      message: function (v) { return v.trim().length >= 10 ? "" : "Please tell us a little about what you need."; }
    };
    var check = function (field) {
      var rule = rules[field.name];
      if (!rule) return true;
      var msg = rule(field.value), box = field.closest(".field"), err = box && $(".err", box);
      if (box) box.classList.toggle("bad", !!msg);
      if (err) err.textContent = msg;
      field.setAttribute("aria-invalid", msg ? "true" : "false");
      return !msg;
    };
    Object.keys(rules).forEach(function (name) {
      var f = form.elements[name];
      if (!f) return;
      f.addEventListener("blur", function () { check(f); });
      f.addEventListener("input", function () { if (f.closest(".field").classList.contains("bad")) check(f); });
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var firstBad = null;
      Object.keys(rules).forEach(function (name) {
        var f = form.elements[name];
        if (f && !check(f) && !firstBad) firstBad = f;
      });
      note.classList.remove("bad");
      if (firstBad) { note.textContent = ""; firstBad.focus(); return; }

      var done = function () { sent.hidden = false; form.reset(); note.textContent = ""; sent.setAttribute("tabindex", "-1"); sent.focus({ preventScroll: true }); };
      if (form.elements["bot-field"].value) { done(); return; }          // spam trap filled in: drop it quietly

      form.classList.add("sending");
      note.textContent = "Sending...";
      var body = new URLSearchParams(new FormData(form)).toString();
      fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body })
        .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); done(); })
        .catch(function () {
          var local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
          note.classList.add("bad");
          note.textContent = local
            ? "Preview mode: this form starts sending once the site is live on Netlify."
            : "Sorry, that did not send. Please try again in a moment.";
        })
        .then(function () { form.classList.remove("sending"); });
    });
  }

  /* ---------- Footer year ---------- */
  var year = $("#year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
