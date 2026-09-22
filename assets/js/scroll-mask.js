/* ==========================================================================
   scroll-mask.js  ·  「Scroll Mask」等效实现
   滚动驱动遮罩打开，露出图像。六种几何：iris / wipe / curtain / slats /
   grid / type。画面用 canvas 2D 合成（destination-in + 羽化模糊）。
   ========================================================================== */
(function (global) {
  'use strict';

  var FONT = '"Inter","Source Han Sans CN","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- 六种遮罩几何：把「已打开的比例」画成白色 ---------- */

function mIris(ctx, w, h, p, o) {
  var cx = w * o.ox, cy = h * o.oy;
  // 只补一点点余量：余量太大会让揭示提前饱和，后 1/3 滚动就不动了
  var maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + o.feather;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0, p) * maxR, 0, Math.PI * 2);
  ctx.fill();
}

/* 斜向推入：白色形状 = 最终可见区域，p=0 必须完全在画布外，
   否则滚动起步会先闪出半个画面再消失。矩形的半宽按旋转后的
   投影尺寸算，保证 p=1 时刚好覆盖整块画布。 */
function mWipe(ctx, w, h, p, o) {
  var a = o.angle * Math.PI / 180;
  var cc = Math.abs(Math.cos(a)), ss = Math.abs(Math.sin(a));
  var ov = o.feather * 2;
  var Rx = (w / 2) * cc + (h / 2) * ss + ov;
  var Ry = (h / 2) * cc + (w / 2) * ss + ov;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(a);
  ctx.fillRect(-Rx, -Ry, 2 * Rx * p, 2 * Ry);
  ctx.restore();
}

/* 幕布：从水平中线向上下张开。
   注意：这里的白色形状 = 「最终可见的区域」（合成时用 destination-in），
   所以要画「张开后露出来的那块」，而不是画幕布本身。 */
function mCurtain(ctx, w, h, p, o) {
  var ov = o.feather * 4;
  var hh = (h / 2) * p;
  ctx.fillRect(-ov, h / 2 - hh, w + ov * 2, hh * 2);
}

  function mSlats(ctx, w, h, p, o) {
    var n = o.columns;
    var sw = (w + o.feather * 4) / n;
    var ov = o.feather * 4;
    for (var i = 0; i < n; i++) {
      var cx = (i + 0.5) * sw - ov;
      var d = Math.abs(cx - w * o.ox) / w;               // 距锚点越远，越晚
      var delay = o.stagger * d * 1.6;
      var li = clamp((p - delay) / Math.max(1 - delay, 0.05), 0, 1);
      li = 1 - Math.pow(1 - li, 3);
      if (li <= 0) continue;
      var hh = h * li;
      ctx.fillRect(cx - sw / 2 - o.feather, (h - hh) / 2 - o.feather, sw + o.feather * 2, hh + o.feather * 2);
    }
  }

  function mGrid(ctx, w, h, p, o) {
    var n = o.columns;
    var cw = (w + o.feather * 4) / n, ch = (h + o.feather * 4) / n;
    var ov = o.feather * 4;
    var cx0 = w * o.ox, cy0 = h * o.oy;
    var diag = Math.hypot(w, h);
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = (i + 0.5) * cw - ov, y = (j + 0.5) * ch - ov;
        var d = Math.hypot(x - cx0, y - cy0) / diag;
        var delay = o.stagger * d * 1.7;
        var li = clamp((p - delay) / Math.max(1 - delay, 0.05), 0, 1);
        li = 1 - Math.pow(1 - li, 3);
        if (li <= 0) continue;
        var sw2 = cw * li, sh2 = ch * li;
        ctx.fillRect(x - sw2 / 2 - o.feather, y - sh2 / 2 - o.feather, sw2 + o.feather * 2, sh2 + o.feather * 2);
      }
    }
  }

  function mType(ctx, w, h, p, o) {
    var word = o.word || 'SCROLL';
    var base = 200;
    ctx.font = '800 ' + base + 'px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = (o.letterSpacing || 0.04) * base + 'px';
    var mw = Math.max(ctx.measureText(word).width, 1);
    var need = (w * 1.55) / mw;                       // 需要的放大倍数才铺满
    var e = p * p;
    var grow = 0.10 + (need - 0.10) * e;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(grow, grow);
    ctx.fillText(word, 0, 0);
    ctx.restore();
    ctx.letterSpacing = '0px';
  }

  var GEOM = { iris: mIris, wipe: mWipe, curtain: mCurtain, slats: mSlats, grid: mGrid, type: mType };

  /* ---------- 底部遮罩层：把「已打开」反过来用 ---------- */

  function init(section) {
    var canvas = section.querySelector('.smask__canvas');
    if (!canvas) return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var d = section.dataset;
    var o = {
      variant: d.variant || 'iris',
      word: d.word || 'SCROLL',
      ox: parseFloat(d.originX || 50) / 100,
      oy: parseFloat(d.originY || 50) / 100,
      angle: parseFloat(d.angle || 108),
      columns: parseInt(d.columns || 9, 10),
      zoom: parseFloat(d.zoom || 1.14),
      featherPct: parseFloat(d.feather || 14) / 100,
      stagger: parseFloat(d.stagger || 0.55),
      settle: parseFloat(d.settle || 0.84),
      smooth: parseFloat(d.smooth || 0.14),
      radius: parseFloat(d.radius || 18),
      overlay: parseFloat(d.overlay || 0),
      scrollLength: parseFloat(d.scrollLength || 1.7),
      fit: d.fit || 'cover',
      src: d.src || ''
    };
    o.feather = 0;   // 运行时按画布尺寸换算

    var img = new Image();
    img.crossOrigin = 'anonymous';
    var loaded = false;
    img.onload = function () { loaded = true; dirty = true; bdDirty = true; };
    img.src = o.src;

    var bd = null, bdDirty = true;

    var W = 0, H = 0, DPR = 1, feather = 0;
    var cur = 0, target = 0, drawn = -1, dirty = true;
    var inView = true;
    var head = section.querySelector('.smask__head');

    // 离屏即完全停算（软件渲染下 canvas blur 很贵，多个揭示段叠加会拖垮滚动）
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        inView = es[0].isIntersecting;
        if (inView) dirty = true;
      }, { rootMargin: '150px' }).observe(section);
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      var w = Math.max(1, Math.round(r.width * DPR));
      var h = Math.max(1, Math.round(r.height * DPR));
      if (w !== W || h !== H) {
        W = canvas.width = w; H = canvas.height = h;
        feather = Math.max(6, Math.round(Math.min(W, H) * o.featherPct * 0.5));
        dirty = true;
      }
      bdDirty = true;
    }

    /* contain 模式的底：同一张图 cover 放大 + 模糊 + 压暗，做成「舞台」，
       主体则按 contain 清晰居中。用于分辨率不足、不适合拉满全屏的截图。 */
    function buildBackdrop() {
      var iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var g = c.getContext('2d');
      var s = Math.max(W / iw, H / ih) * 1.18;
      g.filter = 'blur(' + Math.max(14, Math.round(Math.min(W, H) * 0.05)) + 'px)';
      g.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
      g.filter = 'none';
      g.fillStyle = 'rgba(4,10,7,0.50)';
      g.fillRect(0, 0, W, H);
      bd = c; bdDirty = false;
    }

    function progress() {
      var r = section.getBoundingClientRect();
      var vh = window.innerHeight;
      var total = r.height - vh;
      if (total <= 0) return 0;
      return clamp(-r.top / total, 0, 1);
    }

    function draw(p) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);

      if (!loaded || !W) return;

      var iw = img.naturalWidth, ih = img.naturalHeight;

      if (o.fit === 'contain') {
        if (bdDirty || !bd) buildBackdrop();
        ctx.drawImage(bd, 0, 0, W, H);
        var s2 = Math.min((W * 0.84) / iw, (H * 0.76) / ih);
        var dw2 = iw * s2, dh2 = ih * s2;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.62)';
        ctx.shadowBlur = Math.round(Math.min(W, H) * 0.05);
        ctx.shadowOffsetY = Math.round(Math.min(W, H) * 0.02);
        ctx.drawImage(img, (W - dw2) / 2, (H - dh2) / 2, dw2, dh2);
        ctx.restore();
      } else {
        // 图像按 cover 铺满，并从 zoom 回到 1
        var s = Math.max(W / iw, H / ih) * (o.zoom - (o.zoom - 1) * p);
        var dw = iw * s, dh = ih * s;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }

      if (o.overlay > 0) {
        ctx.globalAlpha = o.overlay * (1 - p * 0.6);
        ctx.fillStyle = '#040A07';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }

      if (p >= 0.999) return;   // 完全打开，不再遮

      // 遮罩：destination-in 保留遮罩内的像素
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = '#fff';
      if (ctx.filter !== undefined) ctx.filter = 'blur(' + feather + 'px)';
      ctx.beginPath();
      ctx.rect(-feather * 3, -feather * 3, W + feather * 6, H + feather * 6);
      ctx.closePath();
      var geom = GEOM[o.variant] || mIris;
      geom(ctx, W, H, p, o);
      if (ctx.filter !== undefined) ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
    }

    function frame() {
      if (o.destroyed) return;
      requestAnimationFrame(frame);
      if (document.hidden || !inView) return;
      resize();
      target = progress();
      var pe = clamp(target / o.settle, 0, 1);
      var k = o.smooth <= 0 ? 1 : (1 - Math.pow(o.smooth, 0.06));
      k = Math.max(0.06, Math.min(1, k));
      var delta = pe - cur;
      if (Math.abs(delta) > 0.0005) { cur += delta * k; dirty = true; }
      else if (delta !== 0) { cur = pe; dirty = true; }
      if (dirty) { draw(cur); dirty = false; }
      tickHead(cur);
    }

    var headOn = false;
    function tickHead(p) {
      if (!head) return;
      var on = p > 0.30;
      if (on !== headOn) { headOn = on; head.classList.toggle('in', on); }
    }

    var api = { destroy: function () { o.destroyed = true; } };
    frame();
    return api;
  }

  function mountAll(root) {
    var list = (root || document).querySelectorAll('.smask');
    var out = [];
    for (var i = 0; i < list.length; i++) { var a = init(list[i]); if (a) out.push(a); }
    return out;
  }

  global.ScrollMask = { init: init, mountAll: mountAll };
})(window);
