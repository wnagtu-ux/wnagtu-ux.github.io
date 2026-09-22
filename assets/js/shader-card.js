/* ==========================================================================
   shader-card.js  ·  音乐坞「Shader Card」等效实现
   竖向分叉能量场：fbm 噪声域扭曲出的金色丝缕，在深绿底上自下而上流动。
   ========================================================================== */
(function (global) {
  'use strict';

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform float uTime;',
    'uniform float uAspect;',
    'uniform float uSpeed;',
    'uniform vec3  uColor;',       // 主色（金）
    'uniform vec3  uColor2;',      // 底色（翠绿）
    'uniform float uPositionY;',
    'uniform float uScale;',
    'uniform float uBranch;',
    'uniform float uVExtent;',
    'uniform float uHExtent;',
    'uniform float uRadius;',
    'uniform float uBoost;',
    'uniform float uNoiseScale;',
    'uniform float uWidthFactor;',
    'uniform float uWave;',
    'uniform float uEdgeMin;',
    'uniform float uEdgeMax;',
    'uniform float uFalloff;',
    'uniform float uOpacity;',

    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p), f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),',
    '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0, a = 0.5;',
    '  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }',
    '  return v;',
    '}',

    'void main(){',
    '  float t = uTime * uSpeed;',
    '  vec2 uv = vUv;',
    // 纵向拉伸 + 缓慢上浮
    '  vec2 q = vec2((uv.x - 0.5) * 2.0 * uHExtent,',
    '                (uv.y - uPositionY) * 2.0 * uVExtent - t * 0.30);',
    '  // 域扭曲：让丝缕分叉',
    '  float n1 = fbm(q * uNoiseScale);',
    '  float n2 = fbm(q * uNoiseScale * 2.1 + n1 * uBranch * 1.6);',
    '  float n3 = fbm(q * uNoiseScale * 4.4 + n2 * uBranch * 2.2 + t * 0.1);',
    '  float f = n1 * 0.52 + n2 * 0.32 + n3 * 0.16;',

    // 丝缕：把噪声压成脊线
    '  float v1 = q.x * 3.4 * uWidthFactor + (f - 0.5) * uBranch * 6.0;',
    '  float r1 = abs(sin(v1 + t * 0.5 + n2 * uWave * 3.0));',
    '  r1 = pow(1.0 - r1, 6.0);',
    '  float v2 = q.x * 8.2 * uWidthFactor + (n3 - 0.5) * uBranch * 9.0;',
    '  float r2 = abs(sin(v2 - t * 0.75));',
    '  r2 = pow(1.0 - r2, 9.0);',

    '  float e = r1 * 0.72 + r2 * 0.42;',
    '  e *= 0.55 + 0.85 * clamp(n1 * 1.6, 0.0, 1.0);',
    '  e = smoothstep(uEdgeMin, uEdgeMax, e);',

    // 横向核心衰减
    '  float dx = abs(uv.x - 0.5) * 2.0 * uScale / max(uRadius, 0.001);',
    '  float core = exp(-pow(dx, uFalloff));',
    // 纵向：上方渐隐
    '  float vy = clamp((uv.y - uPositionY + 0.55) / 1.15, 0.0, 1.0);',
    '  float vfade = smoothstep(0.0, 1.0, vy) * smoothstep(1.05, 0.12, vy);',

    '  float a = clamp(e * core * (0.55 + uBoost) * vfade, 0.0, 1.0);',
    '  a = pow(a, 1.25) * uOpacity;',

    '  vec3 col = mix(uColor2, uColor, clamp(e * 1.5 + uBoost * 0.4, 0.0, 1.0));',
    '  col += uColor * pow(a, 2.4) * 0.55;',
    // 深绿底：随动效微微透出
    '  vec3 base = mix(vec3(0.02, 0.055, 0.04), vec3(0.05, 0.13, 0.09), a * 0.9);',
    '  vec3 outc = base + col * a;',
    '  gl_FragColor = vec4(outc, 1.0);',
    '}'
  ].join('\n');

  var DEFAULTS = {
    color: [1.0, 0.784, 0.341],      // #FFC857
    color2: [0.10, 0.31, 0.21],      // #1A4F36
    speed: 0.62,
    positionY: 0.16,
    scale: 3.2,
    effectRadius: 0.95,
    effectBoost: 0.55,
    edgeMin: 0.0,
    edgeMax: 0.46,
    falloffPower: 2.0,
    noiseScale: 1.5,
    widthFactor: 0.55,
    waveAmount: 0.5,
    branchIntensity: 1.1,
    verticalExtent: 1.5,
    horizontalExtent: 1.6,
    opacity: 0.92
  };

  function init(canvas, opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false })
          || canvas.getContext('experimental-webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) return null;

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[shadercard]', gl.getShaderInfoLog(s)); return null; }
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[shadercard] link', gl.getProgramInfoLog(p)); return null; }
    gl.useProgram(p);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ['uTime', 'uAspect', 'uSpeed', 'uColor', 'uColor2', 'uPositionY', 'uScale', 'uBranch',
     'uVExtent', 'uHExtent', 'uRadius', 'uBoost', 'uNoiseScale', 'uWidthFactor', 'uWave',
     'uEdgeMin', 'uEdgeMax', 'uFalloff', 'uOpacity'].forEach(function (n) { U[n] = gl.getUniformLocation(p, n); });

    gl.uniform3fv(U.uColor, cfg.color);
    gl.uniform3fv(U.uColor2, cfg.color2);
    gl.uniform1f(U.uSpeed, cfg.speed);
    gl.uniform1f(U.uPositionY, cfg.positionY);
    gl.uniform1f(U.uScale, cfg.scale);
    gl.uniform1f(U.uBranch, cfg.branchIntensity);
    gl.uniform1f(U.uVExtent, cfg.verticalExtent);
    gl.uniform1f(U.uHExtent, cfg.horizontalExtent);
    gl.uniform1f(U.uRadius, cfg.effectRadius);
    gl.uniform1f(U.uBoost, cfg.effectBoost);
    gl.uniform1f(U.uNoiseScale, cfg.noiseScale);
    gl.uniform1f(U.uWidthFactor, cfg.widthFactor);
    gl.uniform1f(U.uWave, cfg.waveAmount);
    gl.uniform1f(U.uEdgeMin, cfg.edgeMin);
    gl.uniform1f(U.uEdgeMax, cfg.edgeMax);
    gl.uniform1f(U.uFalloff, cfg.falloffPower);
    gl.uniform1f(U.uOpacity, cfg.opacity);

    var start = performance.now(), raf = 0, live = true;
    var visible = true;          // 卡片是否在视口内（离屏即停算）
    var dprCap = 1.25, ema = 16.7, warm = 20;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        visible = es[0].isIntersecting;
        // 回到视口时把时间轴接续上，避免动画跳帧
        if (visible) start = performance.now() - lastT * 1000;
      }, { rootMargin: '120px' }).observe(canvas);
    }

    var last = performance.now(), lastT = 0;
    function frame() {
      if (!live) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden || !visible) return;
      var now = performance.now();
      var delta = now - last;
      last = now;

      // 软件渲染 / 低端设备：降一档 DPR，避免为一个小卡片吃掉整帧预算
      if (warm > 0) warm--;
      else {
        ema = ema * 0.9 + delta * 0.1;
        if (ema > 42 && dprCap > 0.85) { dprCap = 0.85; ema = 16.7; warm = 20; }
      }

      lastT = (now - start) / 1000;
      resize();
      gl.uniform1f(U.uTime, lastT);
      gl.uniform1f(U.uAspect, canvas.width / Math.max(1, canvas.height));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    resize(); frame();

    return { destroy: function () { live = false; cancelAnimationFrame(raf); } };
  }

  global.ShaderCard = { init: init };
})(window);
