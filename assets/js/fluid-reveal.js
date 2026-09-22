/* ==========================================================================
   fluid-reveal.js  ·  Hero「Shader Reveal」等效实现
   原生 WebGL2 稳定流体求解（advect / vorticity / divergence / pressure /
   gradient subtract），用 dye 场做遮罩，把「墨绿近黑」层液态推开、
   露出底下明亮的影像。参数对齐 Shader Reveal 的 props 语义。

   性能策略（重要）：
   - 四档画质自适应，按实测帧成本自动升降；最低档仍不达标则整体降级为
     静态影像（回调 onFallback，由站点加强暗场兜底）。
   - 英雄区离屏时停算（IntersectionObserver）。
   - 无指针输入且关闭自动巡游时，只保留合成 pass、停掉流体迭代。
   ========================================================================== */
(function (global) {
  'use strict';

  var CONFIG = {
    mouseForce: 50,        // 指针推力
    cursorSize: 250,       // 指针作用半径
    simRes: 0.5,           // 模拟分辨率系数
    pressureIters: 22,
    curl: 26,              // 涡度加强（让液体有墨感）
    dt: 0.016,
    velDissipation: 0.988,
    dyeDissipation: 0.9895,
    autoDemo: true,
    autoSpeed: 0.42,
    autoIntensity: 1.15,
    autoResumeDelay: 1400,
    revealStrength: 0.80,
    revealSoftness: 0.9,
    tint: [0.34, 0.58, 0.46],   // 未揭示层的墨绿染色
    darken: 0.30,
    maxPixels: 2400000,         // 画布像素上限（超过则等比缩）
    onQualityChange: null,
    onFallback: null
  };

  /* 四档画质：budget 为允许的滚动平均帧成本（ms）
     dpr 越低、迭代越少、越省；最低档关掉自动巡游让画面能静下来 */
  var TIERS = [
    { name: 'high', dpr: 1.60, simRes: 0.50, iters: 22, auto: true,  budget: 20 },
    { name: 'mid',  dpr: 1.25, simRes: 0.40, iters: 16, auto: true,  budget: 29 },
    { name: 'low',  dpr: 1.00, simRes: 0.30, iters: 11, auto: true,  budget: 42 },
    { name: 'min',  dpr: 0.80, simRes: 0.22, iters: 8,  auto: false, budget: 62 }
  ];
  var WARMUP = 36;      // 预热帧数（期间不判档）
  var SETTLE = 30;      // 降档后的观察期

  var VERT = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 aPos;',
    'out vec2 vUv;',
    'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var HEAD = [
    '#version 300 es',
    'precision highp float;',
    'precision highp sampler2D;',
    'in vec2 vUv;',
    'out vec4 outColor;',
    'uniform vec2 uTexel;'
  ].join('\n');

  var FRAG = {
    copy: HEAD + [
      'uniform sampler2D uTex;',
      'void main(){ outColor = texture(uTex, vUv); }'
    ].join('\n'),

    splat: HEAD + [
      'uniform sampler2D uTex;',
      'uniform vec2 uPoint;',
      'uniform float uAspect;',
      'uniform vec3 uValue;',
      'uniform float uRadius;',
      'void main(){',
      '  vec2 p = vUv - uPoint;',
      '  p.x *= uAspect;',
      '  vec3 s = exp(-dot(p, p) / uRadius) * uValue;',
      '  vec3 base = texture(uTex, vUv).xyz;',
      '  outColor = vec4(base + s, 1.0);',
      '}'
    ].join('\n'),

    advect: HEAD + [
      'uniform sampler2D uVel;',
      'uniform sampler2D uSrc;',
      'uniform float uDt;',
      'uniform float uDissipation;',
      'void main(){',
      '  vec2 vel = texture(uVel, vUv).xy;',
      '  vec2 coord = vUv - uDt * vel;',
      '  float fade = uDissipation;',
      // 边界：出界即衰减（避免把外面的空白拖进来）
      '  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) fade = 0.0;',
      '  outColor = fade * texture(uSrc, clamp(coord, 0.0, 1.0));',
      '}'
    ].join('\n'),

    curl: HEAD + [
      'uniform sampler2D uVel;',
      'void main(){',
      '  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).y;',
      '  float R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).y;',
      '  float B = texture(uVel, vUv - vec2(0.0, uTexel.y)).x;',
      '  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).x;',
      '  outColor = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);',
      '}'
    ].join('\n'),

    vorticity: HEAD + [
      'uniform sampler2D uVel;',
      'uniform sampler2D uCurlTex;',
      'uniform float uCurl;',
      'uniform float uDt;',
      'void main(){',
      '  float L = abs(texture(uCurlTex, vUv - vec2(uTexel.x, 0.0)).x);',
      '  float R = abs(texture(uCurlTex, vUv + vec2(uTexel.x, 0.0)).x);',
      '  float B = abs(texture(uCurlTex, vUv - vec2(0.0, uTexel.y)).x);',
      '  float T = abs(texture(uCurlTex, vUv + vec2(0.0, uTexel.y)).x);',
      '  float C = texture(uCurlTex, vUv).x;',
      '  vec2 f = 0.5 * vec2(T - B, R - L);',
      '  f /= length(f) + 1e-4;',
      '  f *= uCurl * C;',
      '  f.y *= -1.0;',
      '  vec2 vel = texture(uVel, vUv).xy + f * uDt;',
      '  outColor = vec4(clamp(vel, -4.0, 4.0), 0.0, 1.0);',
      '}'
    ].join('\n'),

    divergence: HEAD + [
      'uniform sampler2D uVel;',
      'void main(){',
      '  vec2 C = texture(uVel, vUv).xy;',
      '  float L = texture(uVel, vUv - vec2(uTexel.x, 0.0)).x;',
      '  float R = texture(uVel, vUv + vec2(uTexel.x, 0.0)).x;',
      '  float B = texture(uVel, vUv - vec2(0.0, uTexel.y)).y;',
      '  float T = texture(uVel, vUv + vec2(0.0, uTexel.y)).y;',
      '  if (vUv.x - uTexel.x < 0.0) L = -C.x;',
      '  if (vUv.x + uTexel.x > 1.0) R = -C.x;',
      '  if (vUv.y - uTexel.y < 0.0) B = -C.y;',
      '  if (vUv.y + uTexel.y > 1.0) T = -C.y;',
      '  outColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);',
      '}'
    ].join('\n'),

    jacobi: HEAD + [
      'uniform sampler2D uPres;',
      'uniform sampler2D uDiv;',
      'void main(){',
      '  float L = texture(uPres, vUv - vec2(uTexel.x, 0.0)).x;',
      '  float R = texture(uPres, vUv + vec2(uTexel.x, 0.0)).x;',
      '  float B = texture(uPres, vUv - vec2(0.0, uTexel.y)).x;',
      '  float T = texture(uPres, vUv + vec2(0.0, uTexel.y)).x;',
      '  float d = texture(uDiv, vUv).x;',
      '  outColor = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);',
      '}'
    ].join('\n'),

    gradSub: HEAD + [
      'uniform sampler2D uPres;',
      'uniform sampler2D uVel;',
      'void main(){',
      '  float L = texture(uPres, vUv - vec2(uTexel.x, 0.0)).x;',
      '  float R = texture(uPres, vUv + vec2(uTexel.x, 0.0)).x;',
      '  float B = texture(uPres, vUv - vec2(0.0, uTexel.y)).x;',
      '  float T = texture(uPres, vUv + vec2(0.0, uTexel.y)).x;',
      '  vec2 vel = texture(uVel, vUv).xy - 0.5 * vec2(R - L, T - B);',
      '  outColor = vec4(vel, 0.0, 1.0);',
      '}'
    ].join('\n'),

    // 合成：把「墨绿近黑」层按 dye 液态推开，露出明亮影像
    display: HEAD + [
      'uniform sampler2D uFront;',
      'uniform sampler2D uBack;',
      'uniform sampler2D uDye;',
      'uniform sampler2D uVel;',
      'uniform float uReveal;',
      'uniform float uSoftness;',
      'uniform float uDarken;',
      'uniform vec3 uTint;',
      'uniform float uTime;',
      'void main(){',
      '  vec2 uv = vUv;',
      '  vec2 vel = texture(uVel, uv).xy;',
      // 液态折射：速度场轻微拉扯 uv
      '  vec2 warp = vel * 0.045;',
      '  float speed = length(vel);',
      // 颗粒感，避免大面积死平
      '  float grain = fract(sin(dot(uv * 1024.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);',
      '  vec3 front = texture(uFront, uv + warp * 1.6).rgb;',
      '  vec3 back  = texture(uBack,  uv + warp * 3.2).rgb;',
      // 未揭示层：同一张图去色压暗 + 墨绿染色（读起来就是「黑色」）
      '  float lum = dot(front, vec3(0.299, 0.587, 0.114));',
      '  vec3 dark = vec3(lum) * uTint * uDarken;',
      '  dark += (grain - 0.5) * 0.012;',
      '  float d = texture(uDye, uv).x;',
      '  float m = smoothstep(0.02, uSoftness, d * uReveal);',
      // 液体边缘：一圈很淡的辉光，强化「墨水」质感
      '  float edge = smoothstep(0.02, 0.30, d) * (1.0 - smoothstep(0.30, 0.95, d));',
      '  vec3 col = mix(dark, back, m);',
      '  col += edge * 0.05 * (0.4 + speed * 3.0);',
      // 整体收进品牌基调：去饱和 + 压暗 + 墨绿染色。
      // 液态揭示是「局部擦亮」，不能让它把整张图亮成白天。
      '  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), 0.20);',
      '  col *= 0.78;',
      '  col = mix(col, col * uTint * 1.72, 0.24);',
      '  outColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  };

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[reveal] shader', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function program(gl, fragSrc) {
    var v = compile(gl, gl.VERTEX_SHADER, VERT);
    var f = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[reveal] link', gl.getProgramInfoLog(p));
      return null;
    }
    var u = {};
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function FBO(gl, w, h, internal, format, type, filter) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    var fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: tex, fb: fb, w: w, h: h };
  }

  function freeFBO(gl, f) {
    if (!f) return;
    gl.deleteFramebuffer(f.fb);
    gl.deleteTexture(f.tex);
  }

  function DoubleFBO(gl, w, h, internal, format, type, filter) {
    var a = FBO(gl, w, h, internal, format, type, filter);
    var b = FBO(gl, w, h, internal, format, type, filter);
    return {
      w: w, h: h,
      get read() { return a; },
      get write() { return b; },
      swap: function () { var t = a; a = b; b = t; },
      free: function () { freeFBO(gl, a); freeFBO(gl, b); }
    };
  }

  function loadImage(src) {
    return new Promise(function (res) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }

  function init(canvas, opts) {
    var cfg = Object.assign({}, CONFIG, opts || {});
    var gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });
    if (!gl) return null;
    if (!gl.getExtension('EXT_color_buffer_float')) return null;

    var RGBA16F = gl.RGBA16F, RGBA = gl.RGBA, HF = gl.HALF_FLOAT, LINEAR = gl.LINEAR, NEAREST = gl.NEAREST;

    var R = {
      copy: program(gl, FRAG.copy),
      splat: program(gl, FRAG.splat),
      advect: program(gl, FRAG.advect),
      curl: program(gl, FRAG.curl),
      vorticity: program(gl, FRAG.vorticity),
      divergence: program(gl, FRAG.divergence),
      jacobi: program(gl, FRAG.jacobi),
      gradSub: program(gl, FRAG.gradSub),
      display: program(gl, FRAG.display)
    };
    for (var k in R) if (!R[k]) return null;

    // 全屏四边形
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var simW, simH, dyeW, dyeH;
    var vel, dye, div, curlT, pres, frontTex = null, backTex = null;

    function blit(target) {
      if (target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
        gl.viewport(0, 0, target.w, target.h);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function makeTexFromImage(img) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, RGBA, RGBA, gl.UNSIGNED_BYTE, img);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      return t;
    }

    var tier = 0;
    var resScale = 1;   // 额外降采样系数（像素上限触发时 <1）

    function alloc() {
      if (vel) { vel.free(); vel = null; }
      if (dye) { dye.free(); dye = null; }
      freeFBO(gl, div); div = null;
      freeFBO(gl, curlT); curlT = null;
      if (pres) { pres.free(); pres = null; }

      var sr = TIERS[tier].simRes * resScale;
      simW = Math.max(48, Math.round(canvas.width * sr / 4));
      simH = Math.max(32, Math.round(canvas.height * sr / 4));
      dyeW = simW * 2; dyeH = simH * 2;
      vel = DoubleFBO(gl, simW, simH, RGBA16F, RGBA, HF, LINEAR);
      dye = DoubleFBO(gl, dyeW, dyeH, RGBA16F, RGBA, HF, LINEAR);
      div = FBO(gl, simW, simH, RGBA16F, RGBA, HF, NEAREST);
      curlT = FBO(gl, simW, simH, RGBA16F, RGBA, HF, NEAREST);
      pres = DoubleFBO(gl, simW, simH, RGBA16F, RGBA, HF, NEAREST);
    }

    var pointer = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, moved: false };
    var lastUser = -1e9;
    var auto = { x: 0.35, y: 0.55, px: 0.35, py: 0.55 };
    var t0 = performance.now();
    var running = true;
    var visible = true;      // 英雄区是否在视口内
    var ready = false;
    var dirty = true;        // 是否需要推进流体迭代
    var didSplat = false;

    function splat(x, y, dx, dy, mult) {
      if (!vel || !dye) return;
      var aspect = canvas.width / canvas.height;
      var radius = 0.010 / Math.max(0.35, cfg.cursorSize / 420);
      var force = cfg.mouseForce / 50;
      // 速度
      gl.useProgram(R.splat.p);
      gl.uniform1i(R.splat.u.uTex, 0);
      gl.uniform2f(R.splat.u.uTexel, 1 / simW, 1 / simH);
      gl.uniform2f(R.splat.u.uPoint, x, y);
      gl.uniform1f(R.splat.u.uAspect, aspect);
      gl.uniform1f(R.splat.u.uRadius, radius);
      gl.uniform3f(R.splat.u.uValue, dx * 22 * force, dy * 22 * force, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      blit(vel.write); vel.swap();

      // 染料（就是「被推开的黑」）
      gl.useProgram(R.splat.p);
      gl.uniform1i(R.splat.u.uTex, 0);
      gl.uniform2f(R.splat.u.uTexel, 1 / dyeW, 1 / dyeH);
      gl.uniform2f(R.splat.u.uPoint, x, y);
      gl.uniform1f(R.splat.u.uAspect, aspect);
      gl.uniform1f(R.splat.u.uRadius, radius * 1.7);
      gl.uniform3f(R.splat.u.uValue, mult, mult * 0.15, mult * 0.05);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dye.read.tex);
      blit(dye.write); dye.swap();

      didSplat = true;
    }

    function step(dt) {
      var iters = TIERS[tier].iters;
      gl.disable(gl.BLEND);

      // 1. 涡度
      gl.useProgram(R.curl.p);
      gl.uniform2f(R.curl.u.uTexel, 1 / simW, 1 / simH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      gl.uniform1i(R.curl.u.uVel, 0);
      blit(curlT);

      // 2. 涡度加强
      gl.useProgram(R.vorticity.p);
      gl.uniform2f(R.vorticity.u.uTexel, 1 / simW, 1 / simH);
      gl.uniform1f(R.vorticity.u.uCurl, cfg.curl);
      gl.uniform1f(R.vorticity.u.uDt, dt);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      gl.uniform1i(R.vorticity.u.uVel, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, curlT.tex);
      gl.uniform1i(R.vorticity.u.uCurlTex, 1);
      blit(vel.write); vel.swap();

      // 3. 散度
      gl.useProgram(R.divergence.p);
      gl.uniform2f(R.divergence.u.uTexel, 1 / simW, 1 / simH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      gl.uniform1i(R.divergence.u.uVel, 0);
      blit(div);

      // 4. 压力（Jacobi 迭代）
      gl.useProgram(R.jacobi.p);
      gl.uniform2f(R.jacobi.u.uTexel, 1 / simW, 1 / simH);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, div.tex);
      gl.uniform1i(R.jacobi.u.uDiv, 1);
      for (var i = 0; i < iters; i++) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pres.read.tex);
        gl.uniform1i(R.jacobi.u.uPres, 0);
        blit(pres.write); pres.swap();
      }

      // 5. 减梯度 → 无散度速度场
      gl.useProgram(R.gradSub.p);
      gl.uniform2f(R.gradSub.u.uTexel, 1 / simW, 1 / simH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pres.read.tex);
      gl.uniform1i(R.gradSub.u.uPres, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      gl.uniform1i(R.gradSub.u.uVel, 1);
      blit(vel.write); vel.swap();

      // 6. 速度自平流
      gl.useProgram(R.advect.p);
      gl.uniform2f(R.advect.u.uTexel, 1 / simW, 1 / simH);
      gl.uniform1f(R.advect.u.uDt, dt * 60 * 0.35);
      gl.uniform1f(R.advect.u.uDissipation, cfg.velDissipation);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      gl.uniform1i(R.advect.u.uVel, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      gl.uniform1i(R.advect.u.uSrc, 1);
      blit(vel.write); vel.swap();

      // 7. 染料平流
      gl.useProgram(R.advect.p);
      gl.uniform2f(R.advect.u.uTexel, 1 / dyeW, 1 / dyeH);
      gl.uniform1f(R.advect.u.uDt, dt * 60 * 0.35);
      gl.uniform1f(R.advect.u.uDissipation, cfg.dyeDissipation);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, vel.read.tex);
      gl.uniform1i(R.advect.u.uVel, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dye.read.tex);
      gl.uniform1i(R.advect.u.uSrc, 1);
      blit(dye.write); dye.swap();
    }

    function render(time) {
      gl.useProgram(R.display.p);
      gl.uniform2f(R.display.u.uTexel, 1 / dyeW, 1 / dyeH);
      gl.uniform1f(R.display.u.uReveal, cfg.revealStrength);
      gl.uniform1f(R.display.u.uSoftness, cfg.revealSoftness);
      gl.uniform1f(R.display.u.uDarken, cfg.darken);
      gl.uniform3f(R.display.u.uTint, cfg.tint[0], cfg.tint[1], cfg.tint[2]);
      gl.uniform1f(R.display.u.uTime, time * 0.001);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frontTex); gl.uniform1i(R.display.u.uFront, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, backTex); gl.uniform1i(R.display.u.uBack, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, dye.read.tex); gl.uniform1i(R.display.u.uDye, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, vel.read.tex); gl.uniform1i(R.display.u.uVel, 3);
      blit(null);
    }

    function resize() {
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return false;
      var dpr = Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr);
      var w = Math.max(2, Math.round(cw * dpr));
      var h = Math.max(2, Math.round(ch * dpr));
      // 像素上限：超大屏时再等比缩一档
      var px = w * h;
      var scale = px > cfg.maxPixels ? Math.sqrt(cfg.maxPixels / px) : 1;
      if (scale < 1) {
        w = Math.max(2, Math.round(w * scale));
        h = Math.max(2, Math.round(h * scale));
      }
      if (canvas.width === w && canvas.height === h) return false;
      canvas.width = w; canvas.height = h;
      var newScale = (scale < 1) ? scale : 1;
      resScale = newScale;
      alloc();
      return true;
    }

    function reseed() {
      if (!ready || !vel || !dye) return;
      gl.useProgram(R.splat.p);
      splat(0.42, 0.52, 0, 0, 2.4);
      splat(0.30, 0.60, 0, 0, 1.6);
      dirty = true;
    }

    function applyTier(next, reason) {
      if (next === tier) return;
      tier = next;
      resize();
      reseed();
      if (cfg.onQualityChange) cfg.onQualityChange(TIERS[tier].name, reason);
    }

    function giveUp() {
      running = false;
      ready = false;
      canvas.classList.remove('live');
      if (window.__revealFallbackTimer) clearTimeout(window.__revealFallbackTimer);
      window.__revealFallbackTimer = setTimeout(function () {
        if (!canvas.classList.contains('live')) {
          canvas.style.display = 'none';
          if (cfg.onFallback) cfg.onFallback();
        }
      }, 1200);
    }

    var api = {
      ready: false,
      tier: function () { return TIERS[tier].name; },
      onPointer: function (nx, ny) {
        pointer.x = nx; pointer.y = ny;
        pointer.moved = true;
        lastUser = performance.now();
      },
      destroy: function () { running = false; }
    };

    Promise.all([loadImage(cfg.front), loadImage(cfg.back)]).then(function (imgs) {
      if (!running || canvas.__revealAlive === false) return;
      if (!imgs[0]) { giveUp(); return; }
      frontTex = makeTexFromImage(imgs[0]);
      backTex = imgs[1] ? makeTexFromImage(imgs[1]) : frontTex;
      resize();
      reseed();
      ready = true;
      api.ready = true;
      canvas.classList.add('live');
      canvas.dispatchEvent(new CustomEvent('reveal:ready'));
    });

    // 离屏停算
    if ('IntersectionObserver' in window) {
      canvas.__revealAlive = true;
      var io = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) {
          var was = visible;
          visible = es[i].isIntersecting;
          if (!was && visible && ready) { render(performance.now()); dirty = true; }
        }
      }, { rootMargin: '120px' });
      io.observe(canvas);
    }

    var last = performance.now();
    var ema = 16.7, warm = 0, settle = 0, fellBack = false;

    function loop() {
      if (!running) return;
      requestAnimationFrame(loop);
      var now = performance.now();
      var delta = now - last;
      last = now;
      if (document.hidden || !ready) return;

      if (!visible) return;   // 英雄区不在视口 → 完全停算

      var budget = TIERS[tier].budget;
      if (warm > 0) { warm--; }
      else if (settle > 0) {
        settle--;
        ema = ema * 0.85 + delta * 0.15;
      } else {
        ema = ema * 0.9 + delta * 0.1;
        if (ema > budget * 1.35) {
          if (tier < TIERS.length - 1) {
            applyTier(tier + 1, 'slow');
            warm = WARMUP; settle = SETTLE;
          } else if (!fellBack) {
            fellBack = true;
            giveUp();
            return;
          }
        }
      }

      if (resize()) { warm = Math.max(warm, 12); }

      didSplat = false;
      var idle = (now - lastUser) > cfg.autoResumeDelay;
      var autoOn = cfg.autoDemo && TIERS[tier].auto && idle;
      if (autoOn) {
        var tt = (now - t0) * 0.001 * cfg.autoSpeed;
        auto.px = auto.x; auto.py = auto.y;
        auto.x = 0.5 + 0.34 * Math.sin(tt * 0.7) * Math.cos(tt * 0.23);
        auto.y = 0.5 + 0.26 * Math.sin(tt * 0.51 + 1.2);
        splat(auto.x, auto.y, (auto.x - auto.px) * cfg.autoIntensity,
              (auto.y - auto.py) * cfg.autoIntensity, 0.6 * cfg.autoIntensity);
      } else if (pointer.moved) {
        pointer.moved = false;
        var dx = pointer.x - pointer.px, dy = pointer.y - pointer.py;
        pointer.px = pointer.x; pointer.py = pointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.0002) {
          splat(pointer.x, pointer.y, dx, dy, 0.75);
        }
      }
      dirty = dirty || didSplat;

      var dt = Math.min(0.033, delta / 1000);
      if (dirty) {
        step(dt);
        if (!didSplat) dirty = false;   // 无新输入 → 下一帧起只做合成
      }
      render(now);
    }

    // 首帧等图片就绪后再起循环（ready 后由 loop 自驱）
    (function waitReady() {
      if (!running) return;
      if (ready) { last = performance.now(); loop(); return; }
      requestAnimationFrame(waitReady);
    })();

    return api;
  }

  global.FluidReveal = { init: init, TIERS: TIERS };
})(window);
