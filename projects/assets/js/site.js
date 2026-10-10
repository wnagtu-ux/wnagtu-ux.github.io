/* ==========================================================================
   Jasmine.王南会 · 三项目作品页 · 交互
   1. 滚动揭示（IntersectionObserver，尊重 prefers-reduced-motion）
   2. 视频：同一时间只播一个 / 播放时隐藏角标 / 失败时给出可下载兜底
   ========================================================================== */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. 滚动揭示 ---------- */
  var rvs = document.querySelectorAll('.rv');
  if (reduce || !('IntersectionObserver' in window)) {
    rvs.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    rvs.forEach(function (el) { io.observe(el); });
  }

  /* ---------- 2. 视频 ---------- */
  var videos = Array.prototype.slice.call(document.querySelectorAll('.film__frame video'));

  videos.forEach(function (v) {
    var frame = v.closest('.film__frame');

    // 播放时淡出角标
    v.addEventListener('play', function () {
      if (frame) frame.classList.add('is-playing');
    });
    v.addEventListener('pause', function () {
      if (frame && !v.seeking && v.currentTime === 0) frame.classList.remove('is-playing');
    });
    v.addEventListener('ended', function () {
      if (frame) frame.classList.remove('is-playing');
    });

    // 同一时间只播一个（页面可扩展；当前每页 1 个，保留以防以后加片）
    v.addEventListener('play', function () {
      videos.forEach(function (o) { if (o !== v && !o.paused) o.pause(); });
    });

    // 加载失败：不静默，给出明确提示
    v.addEventListener('error', function () {
      var box = frame && frame.parentNode;
      if (!box || box.querySelector('.film__note[data-error]')) return;
      var p = document.createElement('p');
      p.className = 'film__note';
      p.setAttribute('data-error', '1');
      p.textContent = '视频未能加载。可检查网络后刷新，或直接下载 assets/video/ 下的同名文件查看。';
      box.appendChild(p);
    }, true);
  });

  /* ---------- 3. 年份 ---------- */
  var y = document.querySelectorAll('[data-year]');
  var now = new Date().getFullYear();
  y.forEach(function (el) { el.textContent = now; });
})();
