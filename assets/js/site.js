/* ==========================================================================
   site.js  ·  交互装配
   视差轮播 / 滚动隧道 / 设计链路轨道 / 音乐坞 / 灯箱 / 导航与滚动揭示
   ========================================================================== */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 导航 ---------------- */
  function nav() {
    var el = $('.nav') || $('.dnav');
    if (!el) return;
    var on = function () { el.classList.toggle('solid', window.scrollY > 24); };
    on();
    window.addEventListener('scroll', on, { passive: true });

    var burger = $('.nav__burger');
    var links = $('.nav__links');
    if (burger && links) {
      burger.addEventListener('click', function () {
        var open = links.style.display === 'flex';
        links.style.display = open ? '' : 'flex';
        links.style.cssText += open ? '' : 'position:absolute;top:78px;left:0;right:0;flex-direction:column;'
          + 'gap:20px;padding:24px var(--pad) 30px;background:rgba(6,16,12,.97);backdrop-filter:blur(18px);'
          + 'border-bottom:1px solid rgba(255,255,255,.08);';
      });
    }
  }

  /* ---------------- 滚动揭示 ---------------- */
  function reveal() {
    var list = $$('.rv');
    if (!list.length) return;
    if (reduce || !('IntersectionObserver' in window)) {
      list.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.06 });
    list.forEach(function (el, i) {
      el.style.transitionDelay = (Math.min(i, 6) * 40) + 'ms';
      io.observe(el);
    });
  }

  /* ---------------- 平滑锚点 ---------------- */
  function anchors() {
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (id.length < 2) return;
        var t = document.querySelector(id);
        if (!t) return;
        e.preventDefault();
        var y = t.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
      });
    });
  }

  /* ---------------- 音乐坞 · Shader Card ---------------- */
  var TRACKS = [
    { n: 'Head In The Clouds', a: '汉堡宝不许哭', d: '3:04', src: 'assets/audio/head-in-the-clouds.mp3' }
  ];

  function dock() {
    var dock = $('#dock');
    if (!dock) return;

    // shader 背景
    var cv = dock.querySelector('.dock__shader canvas');
    if (cv && window.ShaderCard && !reduce) {
      window.ShaderCard.init(cv, {
        speed: 0.55, positionY: 0.12, scale: 3.4, opacity: 0.95
      });
    }

    var eq = $$('.dock__eq i', dock);
    var wave = $$('.wave i', dock);
    var fill = $('.dock__bar-fill', dock);
    var title = $('.dock__title', dock);
    var artist = $('.dock__artist', dock);
    var playBtn = $('.dock__play', dock);
    var tracks = $$('.dock__track', dock);
    var audio = $('#dockAudio');

    // 波形初始高度
    wave.forEach(function (b, i) {
      b.style.height = (14 + Math.abs(Math.sin(i * 0.9)) * 78) + '%';
    });

    var playing = false, t = 0, cur = 0, raf = 0, dur = 184;

    function fmt(sec) {
      sec = Math.max(0, Math.round(sec));
      return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }

    // 有音源就以播放位置为准，没有就退回内部计时（保证动画仍然成立）
    function elapsed() {
      if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.currentTime;
      return t % dur;
    }

    function paint() {
      var pct = (elapsed() / dur) * 100;
      if (fill) fill.style.width = Math.min(pct, 100).toFixed(2) + '%';
      if (playing) {
        eq.forEach(function (b, i) {
          var h = 18 + Math.abs(Math.sin(t * 2.2 + i * 1.1)) * 78;
          b.style.height = h.toFixed(0) + '%';
        });
        wave.forEach(function (b, i) {
          var h = 14 + Math.abs(Math.sin(t * 1.6 + i * 0.55)) * 80;
          b.style.height = h.toFixed(0) + '%';
          b.classList.toggle('on', i < Math.round(wave.length * (t % 12) / 12));
        });
      }
    }

    function loop() {
      raf = requestAnimationFrame(loop);
      if (!playing) return;
      t += 0.05;
      paint();
    }

    function setPlaying(v) {
      playing = v;
      dock.classList.toggle('playing', v);
      var path = playBtn.querySelector('svg');
      if (path) {
        path.innerHTML = v
          ? '<rect x="1" y="1" width="4.6" height="12"/><rect x="8.4" y="1" width="4.6" height="12"/>'
          : '<path d="M2 1.4 12.6 7 2 12.6z"/>';
      }
      if (audio) {
        if (v) { audio.play().catch(function () { /* 无音源时仅动画 */ }); }
        else { audio.pause(); }
      }
    }

    function select(i) {
      cur = i;
      var tr = TRACKS[i];
      if (title) title.textContent = tr.n;
      if (artist) artist.textContent = tr.a;
      tracks.forEach(function (el, j) { el.classList.toggle('cur', j === i); });
      if (audio && tr.src && audio.getAttribute('src') !== tr.src) {
        audio.src = tr.src;
        audio.load();
      }
      t = 0; paint();
    }

    // 真实时长回填到曲目表
    if (audio) {
      var syncDur = function () {
        if (isFinite(audio.duration) && audio.duration > 0) {
          dur = audio.duration;
          var te = tracks[cur] ? tracks[cur].querySelector('time') : null;
          if (te) te.textContent = fmt(dur);
        }
      };
      audio.addEventListener('loadedmetadata', syncDur);
      audio.addEventListener('durationchange', syncDur);
      audio.addEventListener('ended', function () { setPlaying(false); });
    }

    playBtn && playBtn.addEventListener('click', function () { setPlaying(!playing); });

    var toggle = $('.dock__toggle', dock);
    toggle && toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      dock.classList.toggle('open');
    });
    // 收起态时点整条也能展开
    dock.querySelector('.dock__bar').addEventListener('click', function (e) {
      if (e.target.closest('.dock__play') || e.target.closest('.dock__toggle')) return;
      dock.classList.add('open');
    });

    tracks.forEach(function (el, i) {
      el.addEventListener('click', function () { select(parseInt(el.dataset.i, 10)); if (!playing) setPlaying(true); });
    });

    // 音量
    var vt = $('.dock__vol-track', dock), vf = $('.dock__vol-fill', dock), vn = $('.dock__vol-num', dock);
    if (vt && vf) {
      var setVol = function (clientX) {
        var r = vt.getBoundingClientRect();
        var v = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        vf.style.width = (v * 100) + '%';
        if (vn) vn.textContent = Math.round(v * 100);
        if (audio) audio.volume = v;
      };
      var drag = false;
      vt.addEventListener('pointerdown', function (e) { drag = true; setVol(e.clientX); vt.setPointerCapture(e.pointerId); });
      vt.addEventListener('pointermove', function (e) { if (drag) setVol(e.clientX); });
      vt.addEventListener('pointerup', function () { drag = false; });
    }

    select(0);
    if (!reduce) loop();
  }

  /* ---------------- 视差轮播 ---------------- */
  function carousel() {
    var box = $('#carousel');
    if (!box) return;
    var track = $('.carousel__track', box);
    var planes = $$('.plane', track);
    if (!planes.length) return;
    var fill = $('.carousel__fill', box);
    var N = planes.length;
    var STEP = 392;             // 360 + 32
    var pos = Math.min(2, N - 1), target = pos;
    var maxPos = N - 1;

    function layout() {
      target = Math.max(0, Math.min(maxPos, target));
    }
    layout();

    function frame() {
      requestAnimationFrame(frame);
      if (document.hidden) return;
      pos += (target - pos) * 0.09;
      track.style.transform = 'translate3d(' + (-pos * STEP).toFixed(2) + 'px,0,0)';
      var vw = box.clientWidth, vc = vw / 2;
      planes.forEach(function (p, i) {
        var cx = vc + (i - pos) * STEP;
        var dx = cx - vc;
        var img = p.querySelector('.plane__img');
        if (img) img.style.transform = 'translate3d(' + (-dx * 0.055).toFixed(2) + 'px,0,0)';
        var near = Math.max(0, 1 - Math.abs(dx) / (vw * 0.62));
        p.style.opacity = (0.45 + near * 0.55).toFixed(3);
      });
      if (fill) fill.style.width = (12 + (pos / Math.max(1, maxPos)) * 76) + '%';
    }

    // 拖动
    var down = false, sx = 0, sp = 0, moved = 0;
    box.addEventListener('pointerdown', function (e) {
      down = true; sx = e.clientX; sp = target; moved = 0;
      box.classList.add('dragging');
      if (box.setPointerCapture) box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', function (e) {
      if (!down) return;
      var d = e.clientX - sx;
      moved = Math.max(moved, Math.abs(d));
      target = Math.max(0, Math.min(maxPos, sp - d / STEP));
    });
    box.addEventListener('pointerup', function () {
      down = false; box.classList.remove('dragging');
      target = Math.round(target);
    });
    box.addEventListener('pointercancel', function () { down = false; box.classList.remove('dragging'); });

    // 横向滚轮
    box.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        target = Math.max(0, Math.min(maxPos, target + e.deltaX / 260));
        clearTimeout(box._wt);
        box._wt = setTimeout(function () { target = Math.round(target); }, 140);
      }
    }, { passive: false });

    // 键盘
    window.addEventListener('keydown', function (e) {
      var r = box.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      if (e.key === 'ArrowRight') target = Math.min(maxPos, Math.round(target) + 1);
      if (e.key === 'ArrowLeft')  target = Math.max(0, Math.round(target) - 1);
    });

    // 灯箱
    var lb = $('#lightbox'), lbImg = $('#lightboxImg'), lbCap = $('#lightboxCap');
    planes.forEach(function (p) {
      p.addEventListener('click', function () {
        if (moved > 6) return;
        var img = p.querySelector('.plane__img');
        var cap = p.querySelector('.plane__cap');
        if (!lb || !lbImg) return;
        lbImg.src = img.getAttribute('src');
        if (lbCap) lbCap.textContent = cap ? cap.textContent.trim() : '';
        lb.classList.add('on');
      });
    });
    if (lb) {
      lb.addEventListener('click', function () { lb.classList.remove('on'); });
      window.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('on'); });
    }

    frame();
  }

  /* ---------------- Hero 液态揭示 ---------------- */
  function hero() {
    var heroEl = $('#hero');
    var cv = $('#revealCanvas');
    if (!heroEl || !cv) return;
    // 减少动态偏好：直接走静态影像 + 加强暗场，不启用着色器
    if (reduce) { heroEl.classList.add('hero--static'); return; }

    var base = $('.hero__base');
    var front = base ? base.getAttribute('src') : '';
    var api = window.FluidReveal ? window.FluidReveal.init(cv, {
      front: front,
      back: front,
      mouseForce: 50, cursorSize: 250, simRes: 0.5,
      revealStrength: 0.95, revealSoftness: 0.95,
      onQualityChange: function (tier) { heroEl.setAttribute('data-reveal-tier', tier); },
      onFallback: function () { heroEl.classList.add('hero--static'); }
    }) : null;
    if (!api) { heroEl.classList.add('hero--static'); return; }

    var lastMove = 0;
    heroEl.addEventListener('pointermove', function (e) {
      var r = heroEl.getBoundingClientRect();
      api.onPointer((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
      // 指针一动就带一点光，不必等按下
      var now = performance.now();
      if (now - lastMove > 26) lastMove = now;
    }, { passive: true });
    heroEl.addEventListener('pointerdown', function () { heroEl.style.cursor = 'crosshair'; });
    heroEl.addEventListener('pointerleave', function () { heroEl.style.cursor = ''; });
  }

  /* ---------------- 联系表单（本地占位） + 微信号复制 ---------------- */
  function contact() {
    var f = $('#contactForm');
    if (f) {
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var ok = $('#contactOk');
        if (ok) {
          ok.classList.add('on');
          ok.textContent = '已收到。静态演示站点不会真的发送 —— 正式上线时接一个表单服务即可。';
        }
        f.reset();
      });
    }

    // 带 data-copy 的元素：点击复制到剪贴板（无 clipboard API 时降级 execCommand）
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        if (el.getAttribute('data-copied') === '1') return;
        var text = el.getAttribute('data-copy');
        var original = el.textContent;
        var flash = function () {
          el.setAttribute('data-copied', '1');
          el.textContent = '已复制 · ' + text;
          setTimeout(function () {
            el.textContent = original;
            el.removeAttribute('data-copied');
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(flash, flash);
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.top = '-100px';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (err) { /* 静默 */ }
          document.body.removeChild(ta);
          flash();
        }
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    nav(); reveal(); anchors(); dock(); carousel(); hero(); contact();
    if (window.ScrollMask) window.ScrollMask.mountAll(document);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
