/**
 * CMCA Offline Session Player — vanilla JS port of SessionRunner.tsx
 * No dependencies. Works from file:// protocol.
 *
 * Keyboard: ArrowRight/Space → next | ArrowLeft → prev
 *           R → reveal next | T → start/pause timer
 *           F → fullscreen   | N → toggle nav rail
 */
(function () {
  "use strict";

  // ── helpers ──────────────────────────────────────────────────────────────
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function assetPath(p) { return (p || "").replace(/^\//, ""); }
  function fmtTime(sec) {
    if (!isFinite(sec) || isNaN(sec) || sec < 0) return "0:00";
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  var PROJECTOR_KINDS = {
    static: 1, mc_narration: 1, group_activity_timer: 1, click_reveal: 1,
    mcq: 1, reflect_share: 1, video: 1, video_question_series: 1
  };
  var VIDEO_KINDS = { mc_narration: 1, video: 1, video_question_series: 1 };

  // ── state ────────────────────────────────────────────────────────────────
  var S = {
    idx: 0,
    navOpen: false,
    tipOpen: false,
    isFullscreen: false,
    lang: "kn",
    sessionId: "",
    // timer
    timerRunning: false,
    timerRemaining: 0,
    timerTotal: 0,
    timerInterval: null,
    timerDone: false,
    timerReminderFired: false,
    timerReminderAt: 0,
    timerReminderChime: "",
    // reveal
    revealCount: 0,
    // mcq
    mcqSelected: -1,
    // video-with-pauses
    vwpConsumed: null,
    vwpPaused: false,
    vwpLastTime: 0,
    // vqs
    vqsCurrentQ: 0,
    // transcript
    transcriptOpen: false,
    // preamble zoom
    preambleZoomSrc: null,
    // post-video
    videoEnded: false,
    postVideoRevealed: false
  };

  var sessions = {};
  var session = null;
  var slides = [];
  var sections = [];
  var rootEl = null;
  var tipAutoTimer = null;

  // ── init ─────────────────────────────────────────────────────────────────
  function init(sessionId) {
    S.sessionId = sessionId;
    var data = window.__SESSION_DATA__ || {};

    var langPref = "kn";
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("lang")) langPref = params.get("lang");
      else if (localStorage.getItem("cmca_lang")) langPref = localStorage.getItem("cmca_lang");
    } catch (e) { /* file:// may restrict localStorage */ }

    sessions.en = data[sessionId + ".en"] || null;
    sessions.kn = data[sessionId + ".kn"] || null;
    S.lang = (langPref === "kn" && sessions.kn) ? "kn" : "en";
    session = sessions[S.lang] || sessions.en;
    if (!session) {
      document.body.innerHTML = '<div style="padding:40px;font-size:20px;color:#BA1A1A">Session data not found: ' + esc(sessionId) + '</div>';
      return;
    }
    slides = session.slides || [];
    sections = session.sections || [];

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);

    render();

    // auto-show tip for 5 seconds on first slide
    var firstSlide = slides[0];
    if (firstSlide && firstSlide.tip) {
      S.tipOpen = true;
      updateTip();
      tipAutoTimer = setTimeout(function () { S.tipOpen = false; updateTip(); }, 5000);
    }
  }

  // ── full page render ─────────────────────────────────────────────────────
  function render() {
    if (!rootEl) {
      rootEl = document.createElement("div");
      rootEl.className = "sr-root";
      document.body.appendChild(rootEl);
      rootEl.addEventListener("click", onRootClick);
    }
    var slide = slides[S.idx] || {};
    var pct = slides.length > 1 ? ((S.idx / (slides.length - 1)) * 100).toFixed(1) : "0";
    var isProj = !!PROJECTOR_KINDS[slide.kind];
    var isVid = !!VIDEO_KINDS[slide.kind];
    var hasKn = !!sessions.kn;
    var curSection = findCurrentSection();

    var html = '';
    // topbar
    html += '<div class="sr-topbar" style="--sr-progress:' + pct + '%">';
    html += '  <button class="sr-icon-btn" data-action="nav-toggle" title="Sections (N)">☰</button>';
    html += '  <div class="sr-topbar-title">' + esc(session.title) + '</div>';
    html += '  <div class="sr-lang-toggle">';
    html += '    <button class="sr-lang-btn' + (S.lang === "en" ? " is-active" : "") + '" data-action="lang-en">EN</button>';
    html += '    <button class="sr-lang-btn' + (S.lang === "kn" ? " is-active" : (!hasKn ? " is-disabled" : "")) + '" data-action="lang-kn"' + (!hasKn ? ' disabled' : '') + '>ಕನ್ನಡ</button>';
    html += '  </div>';
    html += '  <span class="sr-sep">|</span>';
    html += '  <button class="sr-fs-btn" data-action="fs" title="Fullscreen (F)">⛶</button>';
    html += '</div>';

    // body
    html += '<div class="sr-body">';

    // nav rail
    if (S.navOpen) {
      html += '<div class="sr-nav-backdrop" data-action="nav-toggle"></div>';
      html += '<nav class="sr-nav">';
      html += '  <div class="sr-nav-header"><div class="sr-nav-brand">CMCA</div><div class="sr-nav-sub">' + esc(session.title) + '</div></div>';
      html += '  <ul class="sr-nav-list">';
      for (var si = 0; si < sections.length; si++) {
        html += '<li><button class="sr-nav-item' + (si === curSection ? ' is-current' : '') + '" data-action="nav-section" data-section="' + si + '">' + esc(sections[si].label) + '</button></li>';
      }
      html += '  </ul>';
      html += '  <div class="sr-nav-footer">Session ' + (session.number || '') + '</div>';
      html += '</nav>';
    }

    // canvas
    html += '<div id="sr-canvas" class="sr-canvas' + (isProj ? ' is-projector' : '') + (isVid ? ' is-video-slide' : '') + '">';
    html += renderCanvasContent(slide, curSection);
    html += '</div>';

    html += '</div>'; // close body

    // teacher tip toggle + panel
    if (slide.tip) {
      html += '<button class="sr-tip-toggle' + (S.tipOpen ? ' is-open' : '') + '" data-action="tip-toggle">🧑‍🏫 Tip</button>';
      if (S.tipOpen) {
        html += '<div class="sr-tip-panel">';
        html += '  <div class="sr-tip-panel-label">TEACHER TIP</div>';
        html += '  <p>' + esc(slide.tip) + '</p>';
        html += '</div>';
      }
    }

    // side nav
    html += '<div class="sr-side-nav">';
    html += '  <button class="sr-side-btn" data-action="prev"' + (S.idx === 0 ? ' disabled' : '') + '><span class="sr-side-icon">←</span><span class="sr-side-label">Prev</span></button>';
    html += '  <div class="sr-side-count">' + (S.idx + 1) + ' / ' + slides.length + '</div>';
    html += '  <button class="sr-side-btn sr-side-btn-primary" data-action="next"' + (S.idx >= slides.length - 1 ? ' disabled' : '') + '><span class="sr-side-icon">→</span><span class="sr-side-label">Next</span></button>';
    html += '</div>';

    // brand corner
    html += '<img class="sr-brand-corner" src="sessions/assets/cmca_logo.png" alt="CMCA" />';

    // preamble zoom overlay
    if (S.preambleZoomSrc) {
      html += '<div class="sr-preamble-zoom" data-action="preamble-close">';
      html += '  <img src="' + esc(assetPath(S.preambleZoomSrc)) + '" alt="Preamble" />';
      html += '  <button class="sr-preamble-close" data-action="preamble-close">✕</button>';
      html += '</div>';
    }

    // timer modal
    if (S.timerDone) {
      html += '<div class="sr-timer-modal">';
      html += '  <div class="sr-timer-modal-inner">';
      html += '    <div class="sr-timer-modal-icon">⏰</div>';
      html += '    <div class="sr-timer-modal-title">Time\'s Up!</div>';
      html += '    <div class="sr-timer-modal-sub">Activity time is over.</div>';
      html += '    <button class="sr-btn sr-btn-primary" data-action="timer-dismiss">OK</button>';
      html += '  </div>';
      html += '</div>';
    }

    rootEl.innerHTML = html;

    // after DOM is ready, attach media handlers
    initSlideHandlers(slide);
  }

  // ── canvas content ───────────────────────────────────────────────────────
  function renderCanvasContent(slide, curSection) {
    var html = '';
    if (curSection >= 0) {
      html += '<div class="sr-section-crumb">' + esc(sections[curSection].label) + '</div>';
    }
    if (slide.kind !== "title" && slide.title) {
      html += '<h1 class="sr-title">' + esc(slide.title) + '</h1>';
      html += '<div class="sr-accent"></div>';
    }
    html += '<div class="sr-slide-body">';
    html += renderSlideContent(slide);
    html += '</div>';
    return html;
  }

  // ── slide dispatcher ─────────────────────────────────────────────────────
  function renderSlideContent(slide) {
    switch (slide.kind) {
      case "title": return renderTitleSlide(slide);
      case "static": return renderStaticSlide(slide);
      case "mc_narration": return renderMcNarrationSlide(slide);
      case "group_activity_timer": return renderTimerSlide(slide);
      case "click_reveal": return renderRevealSlide(slide);
      case "mcq": return renderMcqSlide(slide);
      case "reflect_share": return renderReflectSlide(slide);
      case "video": return renderVideoSlide(slide);
      case "video_question_series": return renderVqsSlide(slide);
      case "preamble": return renderPreambleSlide(slide);
      case "preamble_pair": return renderPreamblePairSlide(slide);
      default: return '<p>Unknown slide kind: ' + esc(slide.kind) + '</p>';
    }
  }

  // ── title slide ──────────────────────────────────────────────────────────
  function renderTitleSlide(slide) {
    var showSeal = S.sessionId.indexOf("kreis") === 0;
    var html = '<div class="sr-branded-title">';
    html += '<div class="sr-branded-bg"></div>';

    // logos
    html += '<div class="sr-branded-logos">';
    if (showSeal) {
      html += '<img class="sr-kreis-seal" src="sessions/assets/kreis_logo.png" alt="KREIS" />';
    }
    html += '<img class="sr-cmca-mark" src="sessions/assets/cmca_logo.png" alt="CMCA" />';
    html += '</div>';

    html += '<div class="sr-branded-titles">';
    if (slide.thank_you) {
      html += '<div class="sr-branded-thanks">Thank You! 🙏</div>';
    } else {
      html += '<h1 class="sr-branded-en">' + esc(slide.title) + '</h1>';
      if (slide.title_kn) {
        html += '<p class="sr-branded-kn">' + esc(slide.title_kn) + '</p>';
      }
    }
    if (slide.subtitle) {
      html += '<p class="sr-subtitle">' + esc(slide.subtitle) + '</p>';
    }
    html += '</div>';

    if (slide.closing_line) {
      html += '<p class="sr-branded-closing">' + esc(slide.closing_line) + '</p>';
    }

    if (slide.image) {
      html += '<div class="sr-branded-hero"><img src="' + esc(assetPath(slide.image)) + '" alt="" /></div>';
    }

    if (slide.audio) {
      html += '<div class="sr-branded-audio">' + renderAudioCard(slide.audio) + '</div>';
    }

    html += '</div>';
    return html;
  }

  // ── static slide ─────────────────────────────────────────────────────────
  function renderStaticSlide(slide) {
    var hasImage = slide.image || (slide.images && slide.images.length);
    var layout = slide.image_layout || "stack";
    var hasBody = slide.body && slide.body.length;
    var bodyHtml = '';

    if (hasBody) {
      if (slide.bullets_large) {
        bodyHtml += '<ul class="sr-bullets-lg">';
        for (var i = 0; i < slide.body.length; i++) {
          bodyHtml += '<li>' + esc(slide.body[i]) + '</li>';
        }
        bodyHtml += '</ul>';
      } else {
        var cls = !hasImage ? ' sr-text-only' : '';
        bodyHtml += '<div class="' + cls + '">';
        for (var i = 0; i < slide.body.length; i++) {
          bodyHtml += '<p class="sr-line">' + esc(slide.body[i]) + '</p>';
        }
        bodyHtml += '</div>';
      }
      if (slide.callout) {
        bodyHtml += '<div class="sr-callout">' + esc(slide.callout) + '</div>';
      }
      if (slide.audio) {
        bodyHtml += renderAudioCard(slide.audio);
      }
    }

    if (!hasImage) return bodyHtml;

    var imgHtml = '';
    if (slide.images && slide.images.length) {
      imgHtml += '<div class="sr-static-image-grid">';
      for (var i = 0; i < slide.images.length; i++) {
        var img = slide.images[i];
        imgHtml += '<figure class="sr-image-card">';
        imgHtml += '<img src="' + esc(assetPath(img.src)) + '" alt="' + esc(img.alt || '') + '" />';
        if (img.caption) imgHtml += '<figcaption>' + esc(img.caption) + '</figcaption>';
        imgHtml += '</figure>';
      }
      imgHtml += '</div>';
    } else if (slide.image) {
      imgHtml += '<div class="sr-static-image"><img src="' + esc(assetPath(slide.image)) + '" alt="" /></div>';
    }

    var wrapCls = (layout === "side" && hasBody) ? "is-side" : "is-stack";
    return '<div class="sr-static-with-image ' + wrapCls + '">' +
      '<div class="sr-static-text">' + bodyHtml + '</div>' +
      imgHtml +
      '</div>';
  }

  // ── mc narration slide ───────────────────────────────────────────────────
  function renderMcNarrationSlide(slide) {
    var html = '<div class="sr-mc-grid is-video-wide">';

    if (slide.video) {
      html += '<div class="sr-video-frame"><video id="sr-mc-video" src="' + esc(assetPath(slide.video)) + '" controls preload="auto"></video></div>';
    } else {
      html += '<div class="sr-video-placeholder">Video not yet available</div>';
    }

    // transcript toggle
    if (slide.transcript || (slide.kn_script && slide.kn_script.length)) {
      html += '<button class="sr-transcript-toggle" data-action="transcript-toggle">📜 ' + (S.transcriptOpen ? 'Hide' : 'Show') + ' Transcript</button>';
      if (S.transcriptOpen) {
        var text = '';
        if (S.lang === "kn" && slide.kn_script && slide.kn_script.length) {
          text = slide.kn_script.join('\n\n');
        } else if (slide.transcript) {
          text = slide.transcript;
        }
        html += '<div class="sr-transcript-below"><p>' + esc(text).replace(/\n/g, '<br>') + '</p></div>';
      }
    }

    html += '</div>';

    // partner logos
    if (slide.images && slide.images.length) {
      html += '<div class="sr-mc-partners">';
      html += '<div class="sr-mc-partners-label">In partnership with</div>';
      html += '<div style="display:flex;gap:16px;flex-wrap:wrap">';
      for (var i = 0; i < slide.images.length; i++) {
        html += '<img src="' + esc(assetPath(slide.images[i].src)) + '" alt="' + esc(slide.images[i].alt || '') + '" style="height:48px;width:auto" />';
      }
      html += '</div></div>';
    }

    return html;
  }

  // ── timer slide ──────────────────────────────────────────────────────────
  function renderTimerSlide(slide) {
    var total = slide.timer_seconds || 180;
    var rem = S.timerRunning || S.timerRemaining > 0 ? S.timerRemaining : total;
    var frac = rem / total;
    var circ = 2 * Math.PI * 148;
    var offset = circ * (1 - frac);
    var isWarn = rem <= 30 && rem > 0;
    var isFlash = rem <= 10 && rem > 0 && S.timerRunning;

    var hasRefImage = slide.image || (slide.images && slide.images.length);
    var gridCls = "sr-timer-grid" + (hasRefImage ? " has-ref-image" : "");

    var html = '<div class="' + gridCls + '">';

    // brief + optional logos/images
    html += '<div class="sr-brief">';
    if (slide.brief) {
      html += '<p>' + esc(slide.brief) + '</p>';
    }
    if (slide.body && slide.body.length) {
      if (slide.bullets_large) {
        html += '<ul class="sr-bullets-lg">';
        for (var i = 0; i < slide.body.length; i++) html += '<li>' + esc(slide.body[i]) + '</li>';
        html += '</ul>';
      } else {
        for (var i = 0; i < slide.body.length; i++) html += '<p>' + esc(slide.body[i]) + '</p>';
      }
    }
    // companion logos below brief
    if (slide.images && slide.images.length) {
      html += '<div class="sr-brief-logos">';
      for (var i = 0; i < slide.images.length; i++) {
        var img = slide.images[i];
        html += '<figure class="sr-brief-logo"><img src="' + esc(assetPath(img.src)) + '" alt="' + esc(img.alt || '') + '" />';
        if (img.caption) html += '<figcaption>' + esc(img.caption) + '</figcaption>';
        html += '</figure>';
      }
      html += '</div>';
    }
    if (slide.image) {
      html += '<div class="sr-timer-ref-image"><img src="' + esc(assetPath(slide.image)) + '" alt="" /></div>';
    }
    html += '</div>';

    // timer ring
    html += '<div class="sr-timer-ring' + (isWarn ? ' is-warn' : '') + (isFlash ? ' is-flash' : '') + '">';
    html += '<svg viewBox="0 0 320 320">';
    html += '<circle cx="160" cy="160" r="148" fill="none" stroke-width="12" stroke="rgba(0,0,0,0.06)" />';
    html += '<circle id="sr-timer-arc" cx="160" cy="160" r="148" fill="none" stroke-width="12" stroke="currentColor" stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '" transform="rotate(-90 160 160)" />';
    html += '</svg>';
    html += '<div class="sr-timer-readout">';
    html += '<div id="sr-timer-digits" class="sr-timer-digits">' + fmtTime(rem) + '</div>';
    html += '<div class="sr-timer-label">REMAINING</div>';
    html += '</div>';
    html += '<div class="sr-timer-controls">';
    if (!S.timerRunning) {
      html += '<button class="sr-btn sr-btn-primary" data-action="timer-start">' + (S.timerRemaining > 0 && S.timerRemaining < total ? 'Resume' : 'Start') + '</button>';
    } else {
      html += '<button class="sr-btn" data-action="timer-pause">Pause</button>';
    }
    html += '<button class="sr-btn" data-action="timer-reset">Reset</button>';
    html += '</div>';
    html += '</div>';

    // hidden audio elements for chimes
    html += '<audio id="sr-timer-reminder" src="' + esc(assetPath(slide.reminder_chime || "sessions/assets/timer_2min_warning.mp3")) + '" preload="auto" style="display:none"></audio>';
    html += '<audio id="sr-timer-end" src="sessions/assets/timer_end.mp3" preload="auto" style="display:none"></audio>';

    if (slide.audio) html += renderAudioCard(slide.audio);

    html += '</div>';
    return html;
  }

  // ── click reveal slide ───────────────────────────────────────────────────
  function renderRevealSlide(slide) {
    var prompts = slide.prompts || [];
    var hasVideo = !!slide.video;
    var html = '<div class="sr-reveal' + (hasVideo ? ' has-video' : '') + '">';

    if (hasVideo) {
      html += '<div class="sr-reveal-video"><div class="sr-video-frame"><video src="' + esc(assetPath(slide.video)) + '" controls preload="auto"></video></div></div>';
    }

    html += '<div>';
    if (slide.intro) {
      html += '<p class="sr-intro">' + esc(slide.intro) + '</p>';
    }
    html += '<ol class="sr-reveal-list">';
    for (var i = 0; i < prompts.length; i++) {
      var visible = i < S.revealCount;
      html += '<li class="sr-reveal-item' + (visible ? '' : ' is-hidden') + '">';
      html += '<span class="sr-reveal-num">' + (i + 1) + '</span>';
      html += '<span class="sr-reveal-body">' + (visible ? esc(prompts[i]) : '<span class="sr-reveal-mask">Press R or click Reveal</span>') + '</span>';
      html += '</li>';
    }
    html += '</ol>';

    html += '<div class="sr-reveal-controls">';
    if (S.revealCount < prompts.length) {
      html += '<button class="sr-btn sr-btn-primary" data-action="reveal">Reveal Next (R)</button>';
    }
    html += '<span class="sr-hint">' + S.revealCount + ' / ' + prompts.length + '</span>';
    html += '</div>';

    if (S.revealCount >= prompts.length && slide.footer) {
      html += '<div class="sr-footer-cheer">' + esc(slide.footer) + '</div>';
    }
    html += '</div></div>';

    if (slide.audio) html += renderAudioCard(slide.audio);
    return html;
  }

  // ── MCQ slide ────────────────────────────────────────────────────────────
  function renderMcqSlide(slide) {
    var options = slide.options || [];
    var correct = slide.correct_index;
    var selected = S.mcqSelected;
    var letters = "ABCDEFGH";

    var html = '<div class="sr-mcq">';
    if (slide.scenario) {
      html += '<p class="sr-scenario">' + esc(slide.scenario) + '</p>';
    }
    html += '<ul class="sr-options">';
    for (var i = 0; i < options.length; i++) {
      var cls = "sr-option";
      var mark = "";
      if (selected >= 0) {
        if (i === correct) { cls += " is-correct"; mark = "✓"; }
        else if (i === selected) { cls += " is-wrong"; mark = "✗"; }
        else { cls += " is-dim"; }
      }
      html += '<li><button class="' + cls + '" data-action="mcq-option" data-index="' + i + '"' + (selected >= 0 ? ' disabled' : '') + '>';
      html += '<span class="sr-option-letter">' + letters[i] + '</span>';
      html += '<span class="sr-option-body">' + esc(options[i]) + '</span>';
      if (mark) html += '<span class="sr-option-mark">' + mark + '</span>';
      html += '</button></li>';
    }
    html += '</ul>';

    if (selected >= 0) {
      var isRight = selected === correct;
      html += '<div class="sr-feedback ' + (isRight ? 'is-right' : 'is-close') + '">';
      html += isRight ? '🎉 Correct!' : '🤔 Not quite — the correct answer is highlighted above.';
      html += '</div>';
    }

    html += '</div>';
    if (slide.audio) html += renderAudioCard(slide.audio);
    return html;
  }

  // ── reflect slide ────────────────────────────────────────────────────────
  function renderReflectSlide(slide) {
    var prompt = (slide.body && slide.body[0]) || slide.prompt || "";
    var html = '<div class="sr-reflect">';
    html += '<blockquote>' + esc(prompt) + '</blockquote>';
    html += '<p class="sr-reflect-hint">Take a moment to think, then share with the class.</p>';
    html += '</div>';
    if (slide.audio) html += renderAudioCard(slide.audio);
    return html;
  }

  // ── video slide ──────────────────────────────────────────────────────────
  function renderVideoSlide(slide) {
    var hasPauses = slide.pause_at && slide.pause_at.length;

    var html = '<div class="sr-video-large-wrap">';

    // intro text
    if (slide.intro || slide.intro_text) {
      var intro = slide.intro || slide.intro_text;
      html += '<div class="sr-video-instructions"><p class="sr-video-instruction-line">' + esc(intro) + '</p></div>';
    }

    // video frame
    html += '<div class="sr-video-row">';
    html += '<div class="sr-video-large">';
    if (slide.video) {
      if (hasPauses) {
        html += '<div class="sr-vwp" id="sr-vwp-container">';
        html += '<video id="sr-vwp-video" src="' + esc(assetPath(slide.video)) + '" controls preload="auto"' + (slide.loop ? ' loop' : '') + '></video>';
        html += '</div>';
      } else {
        html += '<video id="sr-video-main" src="' + esc(assetPath(slide.video)) + '" controls preload="auto"' + (slide.loop ? ' loop' : '') + '></video>';
      }
    } else {
      html += '<div class="sr-video-placeholder">Video not yet available</div>';
    }
    html += '</div></div>';

    // transcript toggle
    if (slide.transcript || (slide.kn_script && slide.kn_script.length)) {
      html += '<button class="sr-transcript-toggle" data-action="transcript-toggle">📜 ' + (S.transcriptOpen ? 'Hide' : 'Show') + ' Transcript</button>';
      if (S.transcriptOpen) {
        var text = '';
        if (S.lang === "kn" && slide.kn_script && slide.kn_script.length) {
          text = slide.kn_script.join('\n\n');
        } else {
          text = slide.transcript || '';
        }
        html += '<div class="sr-transcript-below"><p>' + esc(text).replace(/\n/g, '<br>') + '</p></div>';
      }
    }

    // post-video text
    if (slide.post_video_text && (S.videoEnded || S.postVideoRevealed)) {
      var pvt = slide.post_video_text;
      if (typeof pvt === "string") pvt = [pvt];
      html += '<div class="sr-post-video">';
      for (var i = 0; i < pvt.length; i++) {
        html += '<div class="sr-post-video-text">' + esc(pvt[i]) + '</div>';
      }
      html += '</div>';
    } else if (slide.post_video_text && slide.reveal_on_click && !S.postVideoRevealed && S.videoEnded) {
      html += '<div class="sr-post-video"><button class="sr-btn sr-btn-primary" data-action="reveal-post-video">Reveal</button></div>';
    }

    html += '</div>';
    if (slide.audio) html += renderAudioCard(slide.audio);
    return html;
  }

  // ── video question series slide ──────────────────────────────────────────
  function renderVqsSlide(slide) {
    var items = slide.items || [];
    var questions = slide.kn_questions || [];
    var curQ = S.vqsCurrentQ;

    var html = '<div class="sr-vqs">';

    // video frame
    if (items.length > 0 && items[curQ]) {
      html += '<div class="sr-video-large">';
      html += '<div class="sr-vwp" id="sr-vwp-container">';
      html += '<video id="sr-vwp-video" src="' + esc(assetPath(items[curQ].video || slide.video)) + '" controls preload="auto"></video>';
      html += '</div></div>';
    } else if (slide.video) {
      html += '<div class="sr-video-large">';
      html += '<div class="sr-vwp" id="sr-vwp-container">';
      html += '<video id="sr-vwp-video" src="' + esc(assetPath(slide.video)) + '" controls preload="auto"></video>';
      html += '</div></div>';
    }

    // question list
    if (questions.length) {
      for (var i = 0; i < questions.length; i++) {
        html += '<div class="sr-vqs-question' + (i === curQ ? ' is-active' : '') + '">';
        html += '<span class="sr-vqs-num">Q' + (i + 1) + '</span>';
        html += '<span>' + esc(questions[i]) + '</span>';
        html += '</div>';
      }
    } else if (items.length) {
      for (var i = 0; i < items.length; i++) {
        html += '<div class="sr-vqs-question' + (i === curQ ? ' is-active' : '') + '">';
        html += '<span class="sr-vqs-num">Q' + (i + 1) + '</span>';
        html += '<span>' + esc(items[i].question) + '</span>';
        html += '</div>';
      }
    }

    // controls
    var total = questions.length || items.length;
    html += '<div class="sr-vqs-controls">';
    if (curQ < total - 1) {
      html += '<button class="sr-btn sr-btn-primary" data-action="vqs-next">Next Question →</button>';
      html += '<span class="sr-vqs-counter">' + (curQ + 1) + ' / ' + total + '</span>';
    } else {
      html += '<span class="sr-vqs-done">✓ All questions done</span>';
    }
    html += '</div>';

    html += '</div>';

    // transcript
    if (slide.transcript || (slide.kn_script && slide.kn_script.length)) {
      html += '<button class="sr-transcript-toggle" data-action="transcript-toggle">📜 ' + (S.transcriptOpen ? 'Hide' : 'Show') + ' Transcript</button>';
      if (S.transcriptOpen) {
        var text = (S.lang === "kn" && slide.kn_script) ? slide.kn_script.join('\n\n') : (slide.transcript || '');
        html += '<div class="sr-transcript-below"><p>' + esc(text).replace(/\n/g, '<br>') + '</p></div>';
      }
    }

    return html;
  }

  // ── preamble slide ───────────────────────────────────────────────────────
  function renderPreambleSlide(slide) {
    var html = '<div class="sr-preamble">';
    if (slide.body) {
      for (var i = 0; i < slide.body.length; i++) {
        html += '<p' + (i === 0 ? ' class="is-hero"' : '') + '>' + esc(slide.body[i]) + '</p>';
      }
    }
    if (slide.image) {
      html += '<div style="margin-top:20px;text-align:center"><img src="' + esc(assetPath(slide.image)) + '" alt="Preamble" style="max-width:100%;max-height:60vh;border-radius:8px" /></div>';
    }
    html += '</div>';
    if (slide.audio) html += renderAudioCard(slide.audio);
    return html;
  }

  // ── preamble pair slide ──────────────────────────────────────────────────
  function renderPreamblePairSlide(slide) {
    var html = '<div class="sr-preamble-pair">';
    if (slide.preamble_en) {
      html += '<figure class="sr-preamble-card" data-action="preamble-zoom" data-src="' + esc(slide.preamble_en) + '">';
      html += '<img src="' + esc(assetPath(slide.preamble_en)) + '" alt="Preamble (English)" />';
      html += '<figcaption>English</figcaption>';
      html += '</figure>';
    }
    if (slide.preamble_kn) {
      html += '<figure class="sr-preamble-card" data-action="preamble-zoom" data-src="' + esc(slide.preamble_kn) + '">';
      html += '<img src="' + esc(assetPath(slide.preamble_kn)) + '" alt="Preamble (Kannada)" />';
      html += '<figcaption>ಕನ್ನಡ</figcaption>';
      html += '</figure>';
    }
    html += '</div>';
    if (slide.audio) html += renderAudioCard(slide.audio);
    return html;
  }

  // ── audio card ───────────────────────────────────────────────────────────
  function renderAudioCard(src) {
    return '<div class="sr-audio-card" id="sr-audio-card">' +
      '<button class="sr-audio-play" data-action="audio-toggle">▶</button>' +
      '<div class="sr-audio-meta">' +
      '  <div class="sr-audio-label">🔊 Audio</div>' +
      '  <div class="sr-audio-bar" data-action="audio-seek"><div class="sr-audio-bar-fill" id="sr-audio-fill" style="width:0%"></div></div>' +
      '  <div class="sr-audio-time"><span id="sr-audio-cur">0:00</span><span id="sr-audio-dur">0:00</span></div>' +
      '</div>' +
      '<audio id="sr-audio-el" src="' + esc(assetPath(src)) + '" preload="auto" style="display:none"></audio>' +
      '</div>';
  }

  // ── slide handler init ───────────────────────────────────────────────────
  function initSlideHandlers(slide) {
    // audio player
    var audioEl = $("#sr-audio-el");
    if (audioEl) {
      audioEl.addEventListener("timeupdate", function () {
        var fill = $("#sr-audio-fill");
        var cur = $("#sr-audio-cur");
        if (fill && audioEl.duration) fill.style.width = ((audioEl.currentTime / audioEl.duration) * 100) + "%";
        if (cur) cur.textContent = fmtTime(audioEl.currentTime);
      });
      audioEl.addEventListener("loadedmetadata", function () {
        var dur = $("#sr-audio-dur");
        if (dur) dur.textContent = fmtTime(audioEl.duration);
      });
      audioEl.addEventListener("ended", function () {
        var btn = $('[data-action="audio-toggle"]');
        if (btn) btn.textContent = "▶";
      });
    }

    // video-with-pauses
    if (slide.pause_at && slide.pause_at.length) {
      initVideoWithPauses(slide);
    }

    // plain video (no pauses) — track ended state for post-video text
    var mainVideo = $("#sr-video-main");
    if (mainVideo) {
      mainVideo.addEventListener("ended", function () {
        S.videoEnded = true;
        if (slides[S.idx].post_video_text && !slides[S.idx].reveal_on_click) {
          S.postVideoRevealed = true;
        }
        render();
      });
    }

    // MC video — no special handlers needed beyond default controls
  }

  // ── video with pauses ────────────────────────────────────────────────────
  function initVideoWithPauses(slide) {
    var video = $("#sr-vwp-video");
    var container = $("#sr-vwp-container");
    if (!video || !container) return;

    var pausePoints = (slide.pause_at || []).slice().sort(function (a, b) { return a - b; });
    var consumed = S.vwpConsumed || new Set();
    S.vwpConsumed = consumed;
    var lastTime = 0;

    video.addEventListener("timeupdate", function () {
      var ct = video.currentTime;

      // rewind detection: clear consumed boundaries ahead
      if (ct + 0.5 < lastTime) {
        var newConsumed = new Set();
        consumed.forEach(function (t) { if (t <= ct) newConsumed.add(t); });
        consumed = newConsumed;
        S.vwpConsumed = consumed;
      }
      lastTime = ct;

      // check pause points
      for (var i = 0; i < pausePoints.length; i++) {
        var pp = pausePoints[i];
        if (!consumed.has(pp) && ct >= pp && ct < pp + 1) {
          consumed.add(pp);
          S.vwpConsumed = consumed;
          video.pause();
          S.vwpPaused = true;
          showVwpOverlay(container);
          return;
        }
      }
    });

    video.addEventListener("ended", function () {
      S.videoEnded = true;
      var sl = slides[S.idx];
      if (sl && sl.post_video_text && !sl.reveal_on_click) {
        S.postVideoRevealed = true;
        render();
      }
    });
  }

  function showVwpOverlay(container) {
    // remove existing overlay
    var existing = $("#sr-vwp-dim");
    if (existing) existing.remove();
    var existBtn = $("#sr-vwp-next");
    if (existBtn) existBtn.remove();

    var dim = document.createElement("div");
    dim.className = "sr-vwp-dim";
    dim.id = "sr-vwp-dim";
    container.appendChild(dim);

    var btn = document.createElement("button");
    btn.className = "sr-vwp-next-btn";
    btn.id = "sr-vwp-next";
    btn.textContent = "▶";
    btn.setAttribute("data-action", "vwp-continue");
    container.appendChild(btn);
  }

  function resumeVideo() {
    var video = $("#sr-vwp-video");
    var dim = $("#sr-vwp-dim");
    var btn = $("#sr-vwp-next");
    if (dim) dim.remove();
    if (btn) btn.remove();
    S.vwpPaused = false;
    if (video) video.play();
  }

  // ── timer ────────────────────────────────────────────────────────────────
  function startTimer() {
    var slide = slides[S.idx];
    if (!slide) return;
    var total = slide.timer_seconds || 180;

    if (S.timerRemaining <= 0) {
      S.timerRemaining = total;
      S.timerReminderFired = false;
    }
    S.timerTotal = total;
    S.timerRunning = true;
    S.timerDone = false;
    S.timerReminderAt = slide.reminder_at || 0;
    S.timerReminderChime = slide.reminder_chime || "";

    clearInterval(S.timerInterval);
    S.timerInterval = setInterval(tickTimer, 1000);
    render();
  }

  function pauseTimer() {
    S.timerRunning = false;
    clearInterval(S.timerInterval);
    render();
  }

  function resetTimer() {
    S.timerRunning = false;
    S.timerDone = false;
    S.timerReminderFired = false;
    clearInterval(S.timerInterval);
    S.timerRemaining = 0;
    render();
  }

  function tickTimer() {
    if (S.timerRemaining <= 0) {
      S.timerRunning = false;
      S.timerDone = true;
      clearInterval(S.timerInterval);
      // play end chime
      var endAudio = $("#sr-timer-end");
      if (endAudio) try { endAudio.play(); } catch (e) {}
      render();
      return;
    }

    S.timerRemaining--;

    // reminder chime
    if (S.timerReminderAt > 0 && !S.timerReminderFired && S.timerRemaining <= S.timerReminderAt) {
      S.timerReminderFired = true;
      var remAudio = $("#sr-timer-reminder");
      if (remAudio) try { remAudio.play(); } catch (e) {}
    }

    // targeted DOM update (no full re-render)
    var digits = $("#sr-timer-digits");
    var arc = $("#sr-timer-arc");
    var ring = $(".sr-timer-ring");

    if (digits) digits.textContent = fmtTime(S.timerRemaining);
    if (arc) {
      var circ = 2 * Math.PI * 148;
      arc.setAttribute("stroke-dashoffset", (circ * (1 - S.timerRemaining / S.timerTotal)).toFixed(1));
    }
    if (ring) {
      ring.classList.toggle("is-warn", S.timerRemaining <= 30);
      ring.classList.toggle("is-flash", S.timerRemaining <= 10);
    }
  }

  function dismissTimerModal() {
    S.timerDone = false;
    render();
  }

  // ── navigation ───────────────────────────────────────────────────────────
  function goTo(i) {
    if (i < 0 || i >= slides.length || i === S.idx) return;
    // clean up timer
    clearInterval(S.timerInterval);
    S.timerRunning = false;
    S.timerRemaining = 0;
    S.timerDone = false;
    S.timerReminderFired = false;
    // reset per-slide state
    S.revealCount = 0;
    S.mcqSelected = -1;
    S.vwpConsumed = new Set();
    S.vwpPaused = false;
    S.vwpLastTime = 0;
    S.vqsCurrentQ = 0;
    S.transcriptOpen = false;
    S.videoEnded = false;
    S.postVideoRevealed = false;
    S.preambleZoomSrc = null;
    S.tipOpen = false;

    S.idx = i;
    render();

    // auto-show tip for 5 seconds on slide change
    var slide = slides[i];
    if (slide && slide.tip) {
      S.tipOpen = true;
      clearTimeout(tipAutoTimer);
      updateTip();
      tipAutoTimer = setTimeout(function () { S.tipOpen = false; updateTip(); }, 5000);
    }

    // scroll canvas to top
    var canvas = $("#sr-canvas");
    if (canvas) canvas.scrollTop = 0;
  }

  function next() { goTo(S.idx + 1); }
  function prev() { goTo(S.idx - 1); }

  function goToSection(si) {
    var sec = sections[si];
    if (!sec || !sec.slides || !sec.slides.length) return;
    var targetN = sec.slides[0];
    var targetIdx = slides.findIndex(function (s) { return s.n === targetN; });
    if (targetIdx >= 0) goTo(targetIdx);
  }

  function findCurrentSection() {
    var slideN = slides[S.idx] ? slides[S.idx].n : -1;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].slides && sections[i].slides.indexOf(slideN) >= 0) return i;
    }
    return -1;
  }

  // ── language ─────────────────────────────────────────────────────────────
  function setLang(lang) {
    if (lang === S.lang) return;
    if (lang === "kn" && !sessions.kn) return;
    S.lang = lang;
    try { localStorage.setItem("cmca_lang", lang); } catch (e) {}
    session = sessions[lang] || sessions.en;
    slides = session.slides || [];
    sections = session.sections || [];
    if (S.idx >= slides.length) S.idx = slides.length - 1;
    render();
  }

  // ── fullscreen ───────────────────────────────────────────────────────────
  function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      var el = rootEl || document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  function onFsChange() {
    S.isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  // ── tip ──────────────────────────────────────────────────────────────────
  function updateTip() {
    var slide = slides[S.idx];
    if (!slide || !slide.tip) return;
    var btn = rootEl && rootEl.querySelector('.sr-tip-toggle');
    if (!btn) return;
    var panel = rootEl.querySelector('.sr-tip-panel');
    if (S.tipOpen) {
      btn.classList.add('is-open');
      if (!panel) {
        var div = document.createElement('div');
        div.className = 'sr-tip-panel';
        div.innerHTML = '<div class="sr-tip-panel-label">TEACHER TIP</div><p>' + esc(slide.tip) + '</p>';
        btn.parentNode.insertBefore(div, btn.nextSibling);
      }
    } else {
      btn.classList.remove('is-open');
      if (panel) panel.remove();
    }
  }

  function toggleTip() {
    clearTimeout(tipAutoTimer);
    S.tipOpen = !S.tipOpen;
    updateTip();
  }

  // ── event handlers ───────────────────────────────────────────────────────
  function onRootClick(e) {
    var target = e.target.closest("[data-action]");
    if (!target) return;
    var action = target.dataset.action;

    switch (action) {
      case "prev": prev(); break;
      case "next": next(); break;
      case "nav-toggle": S.navOpen = !S.navOpen; render(); break;
      case "lang-en": setLang("en"); break;
      case "lang-kn": setLang("kn"); break;
      case "fs": toggleFullscreen(); break;
      case "tip-toggle": toggleTip(); break;
      case "timer-start": startTimer(); break;
      case "timer-pause": pauseTimer(); break;
      case "timer-reset": resetTimer(); break;
      case "timer-dismiss": dismissTimerModal(); break;
      case "reveal": revealNext(); break;
      case "mcq-option": selectMcqOption(parseInt(target.dataset.index)); break;
      case "vwp-continue": resumeVideo(); break;
      case "transcript-toggle": S.transcriptOpen = !S.transcriptOpen; render(); break;
      case "preamble-zoom": S.preambleZoomSrc = target.dataset.src; render(); break;
      case "preamble-close": S.preambleZoomSrc = null; render(); break;
      case "nav-section": goToSection(parseInt(target.dataset.section)); break;
      case "vqs-next": vqsNext(); break;
      case "audio-toggle": audioToggle(); break;
      case "audio-seek": audioSeek(e); break;
      case "reveal-post-video": S.postVideoRevealed = true; render(); break;
    }
  }

  function onKeyDown(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    switch (e.key) {
      case "ArrowRight":
      case " ":
        e.preventDefault();
        next();
        break;
      case "ArrowLeft":
        e.preventDefault();
        prev();
        break;
      case "r":
      case "R":
        revealNext();
        break;
      case "t":
      case "T":
        if (S.timerRunning) pauseTimer();
        else startTimer();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "n":
      case "N":
        S.navOpen = !S.navOpen;
        render();
        break;
      case "Escape":
        if (S.preambleZoomSrc) { S.preambleZoomSrc = null; render(); }
        break;
    }
  }

  // ── MCQ ──────────────────────────────────────────────────────────────────
  function selectMcqOption(i) {
    if (S.mcqSelected >= 0) return;
    S.mcqSelected = i;
    render();
  }

  // ── reveal ───────────────────────────────────────────────────────────────
  function revealNext() {
    var slide = slides[S.idx];
    if (!slide || slide.kind !== "click_reveal") return;
    var prompts = slide.prompts || [];
    if (S.revealCount < prompts.length) {
      S.revealCount++;
      render();
    }
  }

  // ── VQS ──────────────────────────────────────────────────────────────────
  function vqsNext() {
    var slide = slides[S.idx];
    if (!slide) return;
    var total = (slide.kn_questions || slide.items || []).length;
    if (S.vqsCurrentQ < total - 1) {
      S.vqsCurrentQ++;
      S.vwpConsumed = new Set();
      render();
    }
  }

  // ── audio ────────────────────────────────────────────────────────────────
  function audioToggle() {
    var el = $("#sr-audio-el");
    if (!el) return;
    if (el.paused) {
      el.play();
      var btn = $('[data-action="audio-toggle"]');
      if (btn) btn.textContent = "⏸";
    } else {
      el.pause();
      var btn = $('[data-action="audio-toggle"]');
      if (btn) btn.textContent = "▶";
    }
  }

  function audioSeek(e) {
    var el = $("#sr-audio-el");
    var bar = $(".sr-audio-bar");
    if (!el || !bar || !el.duration) return;
    var rect = bar.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var pct = Math.max(0, Math.min(1, x / rect.width));
    el.currentTime = pct * el.duration;
  }

  // ── public API ───────────────────────────────────────────────────────────
  window.SessionPlayer = { init: init };
})();
