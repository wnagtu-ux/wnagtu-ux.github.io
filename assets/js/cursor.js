/* ==========================================================================
   指针引力 · Custom Cursor
   行为取自 ohmiler/opus-5.5 "Cursor Black Hole"，配色改写为本站绿金系统。
   外环滞后、内点精确、按住蓄力、松手冲击波。无粒子系统。
   前缀 cfx：避开音乐坞播放列表已有的 .cur
   ========================================================================== */
(function () {
  'use strict';

  var fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  var calm = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!fine || calm) return;

  var root = document.documentElement;

  /* ---------- 建立节点（不侵入 HTML 结构） ---------- */
  var cur = document.createElement('div');
  cur.className = 'cfx';
  cur.setAttribute('aria-hidden', 'true');
  cur.innerHTML =
    '<div class="cfx__shock"></div>' +
    '<div class="cfx__ring">' +
      '<svg viewBox="0 0 100 100">' +
        '<circle class="cfx__halo" cx="50" cy="50" r="47"/>' +
        '<circle class="cfx__track" cx="50" cy="50" r="47"/>' +
        '<circle class="cfx__charge" cx="50" cy="50" r="47" pathLength="1"/>' +
      '</svg>' +
    '</div>' +
    '<div class="cfx__dot"></div>';
  document.body.appendChild(cur);

  var ring   = cur.querySelector('.cfx__ring');
  var dot    = cur.querySelector('.cfx__dot');
  var shock  = cur.querySelector('.cfx__shock');
  var charge = cur.querySelector('.cfx__charge');

  root.classList.add('has-cursor');

  /* ---------- 状态 ---------- */
  var tx = -100, ty = -100;      // 指针真实位置
  var rx = -100, ry = -100;      // 外环位置（滞后）
  var seen = false;
  var down = false;
  var downAt = 0;
  var raf = 0;

  var LERP = 0.16;               // 越小越"重"
  var CHARGE_MS = 680;

  /* ---------- 主循环 ---------- */
  function frame() {
    raf = requestAnimationFrame(frame);

    rx += (tx - rx) * LERP;
    ry += (ty - ry) * LERP;

    var vx = tx - rx;
    var vy = ty - ry;
    var d  = Math.sqrt(vx * vx + vy * vy);

    // 速度 → 沿位移方向轻微拉伸，面积守恒（横拉长就纵压扁）
    var st  = 1 + Math.min(d * 0.0022, 0.26);
    var sq  = 1 / Math.sqrt(st);
    var ang = d > 0.6 ? Math.atan2(vy, vx) * 180 / Math.PI : 0;

    ring.style.transform =
      'translate3d(' + rx.toFixed(2) + 'px,' + ry.toFixed(2) + 'px,0) ' +
      'rotate(' + ang.toFixed(1) + 'deg) scale(' + st.toFixed(3) + ',' + sq.toFixed(3) + ')';

    dot.style.transform =
      'translate3d(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px,0)';

    if (down) {
      var c = Math.min((performance.now() - downAt) / CHARGE_MS, 1);
      charge.style.strokeDashoffset = (1 - c).toFixed(3);
    }
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /* ---------- 指针 ---------- */
  function onMove(e) {
    tx = e.clientX;
    ty = e.clientY;
    if (!seen) {
      seen = true;
      rx = tx; ry = ty;          // 首次出现不要从左上角飞过来
      cur.classList.add('is-on');
      start();
    }
  }

  function onOver(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    // 只对真正可点的元素转金；整块卡片本身是 <a>，所以自然命中
    var link = t.closest('a,button,[role="button"],summary,.dock__bar,.dock__track,.bento__go');
    // 摄影轮播是可拖拽的画廊，用中性态而不是链接态
    var drag = !link && t.closest('.carousel');
    cur.classList.toggle('is-link', !!link);
    cur.classList.toggle('is-drag', !!drag);
  }

  function onDown() {
    down = true;
    downAt = performance.now();
    charge.style.strokeDashoffset = '1';
    cur.classList.add('is-down');
  }

  function onUp() {
    if (!down) return;
    down = false;
    cur.classList.remove('is-down');
    charge.style.strokeDashoffset = '1';
    shock.classList.remove('is-on');
    void shock.offsetWidth;      // 重排一次，重置动画
    shock.classList.add('is-on');
  }

  shock.addEventListener('animationend', function () {
    shock.classList.remove('is-on');
  });

  function hide() { cur.classList.remove('is-on'); }
  function show() { if (seen) cur.classList.add('is-on'); }

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerover', onOver, { passive: true });
  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointercancel', onUp, { passive: true });

  /* 离开窗口才隐藏：mouseout 且 relatedTarget 为空，比 pointerleave 稳 */
  document.addEventListener('mouseout', function (e) {
    if (!e.relatedTarget && !e.toElement) hide();
  });
  document.addEventListener('mouseover', show);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    else if (seen) start();
  });
})();
