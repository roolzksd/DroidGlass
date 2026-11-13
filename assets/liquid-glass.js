/* DroidGlass web engine (liquid-glass.js). SPDX-License-Identifier: Apache-2.0
   Scheme and constants ported from the Backdrop library (github.com/Kyant0/AndroidLiquidGlass, Apache-2.0):
   circleMap lens with the normal taken at 1.5x radius, depthEffect, spectral dispersion, Default/Ambient/Plain highlights,
   outer and inner shadows, Compose springs. Full effect in Chromium (Chrome, Edge, Samsung Internet,
   Android WebView, Electron). Safari and Firefox get a light blur with the same highlights, shadows and motion.

   const g = LiquidGlass.attach(el, { radius: 'capsule', refractionHeight: 12, refractionAmount: 24 });
   g.set({ lens: 0..1, blur, surface, highlightAlpha, angle, press: { p, x, y }, tx, ty, sx, sy, ... });
   g.rebuild({ ...new shape options }); g.destroy(); */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  let defs = null, uid = 0;
  const all = new Set();

  // ---------- environment ----------
  // @supports does not help: Safari says yes to backdrop-filter:url() but draws nothing. Check the engine instead.
  function canRefract() {
    const b = navigator.userAgentData && navigator.userAgentData.brands;
    if (b && b.some((x) => /Chromium/i.test(x.brand))) return true;
    return /Chrome\/\d+/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
  }
  const mq = (q) => !!(root.matchMedia && root.matchMedia(q).matches);
  const dpr = () => Math.min(3, root.devicePixelRatio || 1);
  // Compose (Skia) blur radius -> standard deviation
  const sigma = (r) => (r > 0 ? 0.57735 * r + 0.5 : 0);

  function ensureDefs() {
    if (defs) return defs;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    defs = document.createElementNS(NS, 'defs');
    svg.appendChild(defs);
    document.body.appendChild(svg);
    return defs;
  }

  // write the attribute only when the value changes: any write to a filter primitive makes Chrome
  // rebuild the filter and repaint the layer, even if the value is the same
  const sa = (e, k, v) => { v = String(v); if (e.getAttribute(k) !== v) e.setAttribute(k, v); };

  // ---------- geometry (as in Shaders.kt) ----------
  function sdRR(x, y, hw, hh, r) {
    const qx = Math.abs(x) - (hw - r), qy = Math.abs(y) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  }
  // outward normal; in corners it uses 1.5x the radius, so it turns more smoothly than the corner itself
  function gradRR(x, y, hw, hh, r, out) {
    const qx = Math.abs(x) - (hw - r), qy = Math.abs(y) - (hh - r);
    const sx = x < 0 ? -1 : 1, sy = y < 0 ? -1 : 1;
    if (qx >= 0 || qy >= 0) {
      const mx = Math.max(qx, 0), my = Math.max(qy, 0), l = Math.hypot(mx, my) || 1;
      out[0] = sx * mx / l; out[1] = sy * my / l;
    } else {
      const s = qx >= qy ? 1 : 0;
      out[0] = sx * s; out[1] = sy * (1 - s);
    }
  }
  const radiusOf = (o, w, h) => Math.min(o.radius === 'capsule' ? Infinity : o.radius, w / 2, h / 2);

  // ---------- refraction map ----------
  // 7 spectral samples, as in Kyant's shader: offset along the refraction and weights for R, G, B.
  // Weights per channel sum to 1, so the rainbow stays soft, without hard colour bands.
  const SPECTRUM = [
    { k: 1, w: [2 / 7, 0, 0] },        // red
    { k: 2 / 3, w: [2 / 7, 1 / 7, 0] },  // orange
    { k: 1 / 3, w: [2 / 7, 2 / 7, 0] },  // yellow
    { k: 0, w: [0, 2 / 7, 0] },        // green
    { k: -1 / 3, w: [0, 2 / 7, 1 / 3] }, // cyan
    { k: -2 / 3, w: [0, 0, 1 / 3] },     // blue
    { k: -1, w: [1 / 7, 0, 1 / 3] },     // violet
  ];

  // ov > 0: the map covers a rect ov px larger on every side, and the lens samples OUTSIDE the rim,
  // like Kyant's shader (coord + d*grad). Without overscan we sample inside (coord - d*grad): backdrop-filter
  // sees nothing beyond the element.
  //
  // Speed. Chrome sends feImage pictures inside backdrop-filter to the compositor EVERY frame in full
  // (pixels, not a reference) while the element is on screen and anything repaints. So maps are small:
  //  - a capsule or rounded rect without zoom, depthEffect or dispersion is cut into three pieces:
  //    two rounded ends and a 1 px column in the middle stretched over the length (the map is constant there);
  //  - a dispersion map: 3 images (one per colour channel) instead of 7 spectral ones;
  //  - large maps are capped at MAP_PX pixels (resolution drops, but not below 0.5).
  const MAP_PX = 4096;
  const DISP_K = [3 / 7, 2 / 21, -2 / 3]; // red, green, blue
  function buildMaps(w, h, o, ov = 0) {
    const FW = w + 2 * ov, FH = h + 2 * ov;
    const hw = w / 2, hh = h / 2, r = radiusOf(o, w, h), gr = Math.min(r * 1.5, hw, hh);
    const dir = ov > 0 ? 1 : -1, lx = hw + ov - 1, ly = hh + ov - 1;
    const hgt = Math.max(0.01, o.refractionHeight), amt = o.refractionAmount;
    const zk = 1 - 1 / (o.zoom || 1), disp = o.dispersion > 0;
    const g = [0, 0], q = [0, 0, 0, 0]; // q: offset from zoom (x, y) and from the lens (x, y)
    // lens at (x, y) from the shape centre; returns dispersion strength I (stronger in corners, sign by quadrant)
    function lensAt(x, y) {
      q[0] = q[1] = q[2] = q[3] = 0;
      const depth = -sdRR(x, y, hw, hh, r);
      if (depth <= 0) return 0;
      q[0] = -x * zk; q[1] = -y * zk;
      if (depth >= hgt) return 0;
      const t = 1 - depth / hgt, d = (1 - Math.sqrt(1 - t * t)) * amt; // circleMap: maximum right at the rim
      gradRR(x, y, hw, hh, gr, g);
      let gx = g[0], gy = g[1];
      if (o.depthEffect) {
        const l = Math.hypot(x, y) || 1;
        gx += x / l; gy += y / l;
        const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
      }
      q[2] = dir * d * gx; q[3] = dir * d * gy;
      return disp ? o.dispersion * (x * y) / (hw * hh) : 0;
    }
    // sample offset with multiplier m. Keep the sample point inside the filter region: backdrop-filter
    // sees nothing beyond it, and edges (especially with zoom < 1) would show coloured holes.
    function off(x, y, m, a, k) {
      a[k] = Math.min(lx, Math.max(-lx, x + q[0] + q[2] * m)) - x;
      a[k + 1] = Math.min(ly, Math.max(-ly, y + q[1] + q[3] * m)) - y;
    }
    // map piece: rect in filter coordinates (x, y, w, h), raster W x H; fn(x, y, a, k) writes n numbers
    function piece(x, y, pw, ph, W, H, n, fn) {
      const a = new Float32Array(W * H * n);
      for (let j = 0; j < H; j++) {
        const cy = y - ov - hh + ((j + 0.5) * ph) / H;
        for (let i = 0; i < W; i++) fn(x - ov - hw + ((i + 0.5) * pw) / W, cy, a, (j * W + i) * n);
      }
      return { x, y, w: pw, h: ph, W, H, n, a };
    }
    const plain = (x, y, a, k) => { lensAt(x, y); off(x, y, 1, a, k); };
    let kind, pieces;
    const along = w >= h, len = along ? w : h, cap = Math.ceil(Math.max(gr, hgt) + 2);
    if (!ov && !disp && !zk && !o.depthEffect && !(o.edgeBlur > 0) && len > 2 * cap + 4) {
      // three pieces: the middle column is stretched over the shape and sits below, the rounded ends on top
      kind = 'slice';
      const s = o.resolution, rw = (v) => Math.max(1, Math.round(v * s));
      pieces = along
        ? [piece(0, 0, w, h, 1, rw(h), 2, plain), piece(0, 0, cap, h, rw(cap), rw(h), 2, plain), piece(w - cap, 0, cap, h, rw(cap), rw(h), 2, plain)]
        : [piece(0, 0, w, h, rw(w), 1, 2, plain), piece(0, 0, w, cap, rw(w), rw(cap), 2, plain), piece(0, h - cap, w, cap, rw(w), rw(cap), 2, plain)];
    } else {
      const s = Math.min(o.resolution, Math.max(0.5, Math.sqrt(MAP_PX / (FW * FH))));
      const W = Math.max(2, Math.round(FW * s)), H = Math.max(2, Math.round(FH * s));
      if (disp) {
        // one map per channel: offset multiplier 1 + k*I, k = average contribution of Kyant's 7 samples to the channel
        kind = 'disp';
        pieces = [piece(0, 0, FW, FH, W, H, 6, (x, y, a, k) => { const I = lensAt(x, y); for (let c = 0; c < 3; c++) off(x, y, 1 + DISP_K[c] * I, a, k + 2 * c); })];
      } else { kind = 'full'; pieces = [piece(0, 0, FW, FH, W, H, 2, plain)]; }
    }
    let M = 1e-6;
    for (const p of pieces) for (let k = 0; k < p.a.length; k++) { const v = Math.abs(p.a[k]); if (v > M) M = v; }
    const enc = (v) => 128 + Math.round((v / M) * 127);
    const png = (W, H, fill) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'), im = ctx.createImageData(W, H), dt = im.data;
      for (let k = 0; k < W * H; k++) fill(k, dt, k * 4);
      ctx.putImageData(im, 0, 0);
      return c.toDataURL();
    };
    for (const p of pieces) {
      const a = p.a;
      if (kind === 'disp') {
        p.urls = [0, 1, 2].map((c) => png(p.W, p.H, (k, d, q4) => { d[q4] = enc(a[k * 6 + 2 * c]); d[q4 + 1] = enc(a[k * 6 + 2 * c + 1]); d[q4 + 2] = 128; d[q4 + 3] = 255; }));
      } else p.url = png(p.W, p.H, (k, d, q4) => { d[q4] = enc(a[k * 2]); d[q4 + 1] = enc(a[k * 2 + 1]); d[q4 + 2] = 128; d[q4 + 3] = 255; });
      p.a = null;
    }
    // Rim haze (edgeBlur): we blur not the final picture but the backdrop BEFORE displacement, where the rim samples it.
    // That needs one displacement per channel instead of two (sharp and blurred): three times cheaper in the filter tree.
    // The rim at depth δ samples the backdrop at sd = −δ + d(δ) from the shape edge (outside, overscan only).
    // This relation maps the 'near the rim' mask (1 at the edge, 0 from 2/3 of rim width) onto the backdrop.
    let mask = null;
    if (o.edgeBlur > 0 && ov > 0) {
      const s = Math.min(o.resolution, Math.max(0.35, Math.sqrt(MAP_PX / 4 / (FW * FH))));
      const W = Math.max(2, Math.round(FW * s)), H = Math.max(2, Math.round(FH * s));
      const N = 400, sdAt = new Float32Array(N + 1), mAt = new Float32Array(N + 1), dMax = hgt * 1.2;
      for (let i = 0; i <= N; i++) {
        const de = (i / N) * dMax, t = Math.max(0, 1 - de / hgt), u = Math.min(1, Math.max(0, 1 - de / (hgt * 0.65)));
        sdAt[i] = -de + (1 - Math.sqrt(1 - t * t)) * amt; mAt[i] = u * u * (3 - 2 * u);
      }
      const hazeAt = (sd) => { // sdAt decreases: find δ with sdAt(δ) = sd
        if (sd >= sdAt[0]) return 1; if (sd <= sdAt[N]) return 0;
        let lo = 0, hi = N; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sdAt[mid] > sd) lo = mid; else hi = mid; }
        const f = (sdAt[lo] - sd) / (sdAt[lo] - sdAt[hi]); return mAt[lo] + (mAt[hi] - mAt[lo]) * f;
      };
      const m = piece(0, 0, FW, FH, W, H, 1, (x, y, a, k) => { a[k] = hazeAt(sdRR(x, y, hw, hh, r)); });
      mask = { x: 0, y: 0, w: FW, h: FH, url: png(W, H, (k, d, q4) => { d[q4] = d[q4 + 1] = d[q4 + 2] = 255; d[q4 + 3] = Math.round(255 * m.a[k]); }) };
    }
    return { kind, pieces, mask, scale: 2 * M };
  }

  // brightness, contrast, saturation in one matrix (colorControls from Backdrop)
  function colorMatrix(br, ct, sat) {
    if (!br && ct === 1 && sat === 1) return null;
    const inv = 1 - sat, r = 0.213 * inv, g = 0.715 * inv, b = 0.072 * inv, t = 0.5 - ct * 0.5 + br;
    return [ct * r + ct * sat, ct * g, ct * b, 0, t, ct * r, ct * g + ct * sat, ct * b, 0, t,
      ct * r, ct * g, ct * b + ct * sat, 0, t, 0, 0, 0, 1, 0].map((v) => +v.toFixed(4)).join(' ');
  }

  // A tree, not a graph. Chrome expands the filter: a result read by N steps is computed N times together
  // with everything under it. So shared results are read only by cheap steps, and heavy ones (blur, displacement)
  // are not repeated: one displacement per channel, edge extension only on the side where the layer is clipped.
  function filterMarkup(G) {
    const o = G.o, maps = G.maps;
    let m = '', src = 'SourceGraphic';
    const cm = colorMatrix(o.brightness, o.contrast, o.saturation);
    if (cm) { m += `<feColorMatrix in="${src}" type="matrix" values="${cm}" result="cc"/>`; src = 'cc'; }
    // blur only if there is any (at 0 the step would still cost a pass in every copy of the tree);
    // set({ blur }) from zero rebuilds the markup. Alpha = 1 removes the darkening at edges where emptiness bleeds in
    if (G.state.blur > 0) { m += `<feGaussianBlur in="${src}" stdDeviation="${sigma(G.state.blur)}" data-e="bl" result="bl"/>`; src = 'bl'; }
    m += `<feComponentTransfer in="${src}"${G.ov ? ' data-e="b0"' : ''} result="bf"><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer>`;
    if (G.ov && G.sides) {
      // A layer clipped by the screen edge: there is no backdrop beyond the clip, but the lens samples there too. Extend
      // the edge row (feTile from a 1 px strip) only on the clipped side. placeLens sets the strip sizes.
      let v = 'bf';
      for (const sd of G.sides) {
        m += `<feOffset in="${v}" data-e="c${sd}" result="c${sd}"/><feTile in="c${sd}" data-e="t${sd}" result="t${sd}"/>`;
        m += `<feMerge result="x${sd}"><feMergeNode in="t${sd}"/><feMergeNode in="${v}"/></feMerge>`;
        v = 'x' + sd;
      }
      src = v;
    } else src = 'bf';
    const img = (u, p, res) => `<feImage href="${u}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" preserveAspectRatio="none" result="${res}"/>`;
    if (maps.mask) {
      // haze: backdrop blurred where the rim samples it (mask in backdrop coordinates), sharp in the middle
      m += `<feGaussianBlur in="${src}" stdDeviation="${(sigma(o.edgeBlur) * 2.5).toFixed(3)}" result="hb"/>`;
      m += img(maps.mask.url, maps.mask, 'mk');
      m += `<feComposite in="hb" in2="mk" operator="in" result="he"/><feComposite in="${src}" in2="mk" operator="out" result="hc"/>`;
      m += '<feComposite in="he" in2="hc" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="hs"/>';
      src = 'hs';
    }
    const S = maps.scale * G.state.lens * (G.k || 1);
    const dm = (map, res) => `<feDisplacementMap in="${src}" in2="${map}" scale="${S}" xChannelSelector="R" yChannelSelector="G" result="${res}"/>`;
    if (maps.kind !== 'disp') {
      // one map or three pieces (middle below, rounded ends on top)
      const P = maps.pieces;
      if (P.length === 1) m += img(P[0].url, P[0], 'm0');
      else {
        P.forEach((p, i) => { m += img(p.url, p, 'p' + i); });
        m += '<feMerge result="m0">' + P.map((p, i) => `<feMergeNode in="p${i}"/>`).join('') + '</feMerge>';
      }
      m += dm('m0', 'bent');
    } else {
      // dispersion: a displacement per channel, then channels are added (alpha sum is clamped to 1)
      const p = maps.pieces[0];
      ['1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'].forEach((cv, c) => {
        m += img(p.urls[c], p, 'i' + c) + dm('i' + c, 'd' + c);
        m += `<feColorMatrix in="d${c}" type="matrix" values="${cv}" result="w${c}"/>`;
      });
      m += '<feComposite in="w0" in2="w1" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="w01"/>';
      m += '<feComposite in="w01" in2="w2" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="bent"/>';
    }
    // tint as in LiquidButton: backdrop hue replaced by the colour (Hue), the colour itself at 75% as the element background
    if (o.tint) m += `<feFlood flood-color="${o.tint}" result="tc"/><feBlend in="tc" in2="bent" mode="hue"/>`;
    return m;
  }

  // ---------- highlight (HighlightStyle Default / Ambient / Plain) ----------
  const HL = {
    default: { width: 0.5, alpha: 1, angle: 45, falloff: 1, opacity: 0.5, blend: 'plus-lighter' },
    ambient: { width: 0.5, alpha: 1, angle: 45, falloff: 1, opacity: 0.38, blend: 'normal' },
    plain: { width: 0.5, alpha: 1, opacity: 0.38, blend: 'plus-lighter' },
  };
  function normHL(h) {
    if (!h) return null;
    if (typeof h === 'string') h = { style: h };
    const base = HL[h.style || 'default'];
    const o = Object.assign({ style: h.style || 'default' }, base, h);
    if (o.blur == null) o.blur = o.width / 2;
    return o;
  }
  function erf(x) { // Abramowitz and Stegun 7.1.26
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  }
  const Phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

  function buildHighlight(G) {
    const hl = G.hl;
    if (!hl) { if (G.canvas) { G.canvas.remove(); G.canvas = null; } return; }
    if (!G.canvas) {
      G.canvas = document.createElement('canvas');
      G.canvas.className = 'lg-hl';
      G.canvas.setAttribute('aria-hidden', 'true');
      G.el.appendChild(G.canvas);
    }
    const k = dpr(), w = G.w, h = G.h, W = Math.max(1, Math.round(w * k)), H = Math.max(1, Math.round(h * k));
    G.canvas.width = W; G.canvas.height = H;
    G.canvas.style.mixBlendMode = hl.blend;
    const hw = w / 2, hh = h / 2, r = radiusOf(G.o, w, h), gr = Math.min(r * 1.5, hw, hh);
    const band = Math.ceil(hl.width * k), sg = Math.max(0.3, sigma(hl.blur * k)), reach = band + 3 * sg;
    const idx = [], a = [], gx = [], gy = [], g = [0, 0];
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / k - hw, y = (j + 0.5) / k - hh;
        const d = -sdRR(x, y, hw, hh, r) * k; // depth in device pixels
        if (d <= -0.5 || d > reach) continue;
        const clip = Math.min(1, Math.max(0, d + 0.5));
        const cov = (Phi((band - d) / sg) - Phi((-band - d) / sg)) * clip;
        if (cov < 0.004) continue;
        gradRR(x, y, hw, hh, gr, g);
        idx.push(j * W + i); a.push(cov); gx.push(g[0]); gy.push(g[1]);
      }
    }
    G.hlField = { W, H, idx, a: Float32Array.from(a), gx: Float32Array.from(gx), gy: Float32Array.from(gy) };
    G.hlCtx = G.canvas.getContext('2d');
    G.hlImage = G.hlCtx.createImageData(W, H);
    drawHighlight(G);
  }

  function drawHighlight(G) {
    const hl = G.hl, f = G.hlField;
    if (!hl || !f) return;
    const dt = G.hlImage.data, ang = (G.state.angle ?? hl.angle ?? 45) * Math.PI / 180;
    const nx = Math.cos(ang), ny = Math.sin(ang), fo = hl.falloff ?? 1, op = hl.opacity;
    const [cr, cg, cb] = hl.color || [255, 255, 255];
    for (let n = 0; n < f.idx.length; n++) {
      const q = f.idx[n] * 4;
      let I = 1, R = cr, Gc = cg, B = cb;
      if (hl.style !== 'plain') {
        const d = f.gx[n] * nx + f.gy[n] * ny;
        I = Math.pow(Math.abs(d), fo);
        if (hl.style === 'ambient') { const t = d >= 0 ? 255 : 0; R = Gc = B = t; }
      }
      dt[q] = R; dt[q + 1] = Gc; dt[q + 2] = B; dt[q + 3] = Math.round(255 * f.a[n] * I * op);
    }
    G.hlCtx.putImageData(G.hlImage, 0, 0);
  }

  // ---------- shadows (Shadow / InnerShadow) ----------
  const SHADOW = { radius: 24, opacity: 0.1, color: '0 0 0' };
  const INNER = { radius: 24, opacity: 0.15, color: '0 0 0' };
  function shadowCSS(G) {
    const s = G.state, out = [];
    if (s.ghost) return 'none';
    if (s.shadow) {
      const r = s.shadow.radius, y = s.shadow.y ?? r / 6, a = s.shadow.opacity * (s.shadow.alpha ?? 1);
      if (a > 0.001) out.push(`0 ${y.toFixed(2)}px ${r.toFixed(2)}px rgb(${s.shadow.color} / ${a.toFixed(3)})`);
    }
    if (s.innerShadow) {
      const r = s.innerShadow.radius, y = s.innerShadow.y ?? r, a = s.innerShadow.opacity * (s.innerShadow.alpha ?? 1);
      if (a > 0.001 && r > 0.01) out.push(`inset 0 ${y.toFixed(2)}px ${r.toFixed(2)}px rgb(${s.innerShadow.color} / ${a.toFixed(3)})`);
    }
    // blurred inner shadow without offset: half the opacity right at the rim, fading out by 8 px
    if (s.depth > 0) out.push(`inset 0 0 8px rgb(0 0 0 / ${(0.2 * s.depth).toFixed(3)})`);
    return out.join(', ') || 'none';
  }

  // ---------- options ----------
  const DEFAULTS = {
    radius: 'capsule',     // number (px) or 'capsule'
    refractionHeight: 12,  // width of the curved rim, px (Kyant refractionHeight)
    refractionAmount: 24,  // backdrop offset right at the rim, px (refractionAmount)
    depthEffect: false,    // adds radial bending, the glass looks thicker
    dispersion: 0,         // 0..1, rainbow at the rim, stronger in corners (chromaticAberration)
    zoom: 1,               // >1 magnifies the centre (magnifier), <1 shrinks it
    blur: 0,               // blur radius as in Compose (dp ~ CSS px)
    saturation: 1.5,       // vibrancy() = 1.5; 1 = unchanged
    brightness: 0, contrast: 1,
    tint: null,            // CSS colour: tinted glass (primary action)
    surface: null,         // CSS colour of a surface over the glass, e.g. 'rgb(255 255 255 / .3)'
    highlight: 'default',  // 'default' | 'ambient' | 'plain' | null | { style, width, blur, alpha, angle, falloff }
    tilt: false,           // highlight angle follows device tilt
    shadow: true,          // true | false | { radius, y, opacity, color: '0 0 0' }
    innerShadow: null,     // null | { radius, y, opacity, color }
    lens: 1,               // 0..1 refraction strength, animatable without rebuilding the map
    resolution: 1,         // 2 for a crisp rim on retina, 4x more expensive
    fallbackBlur: 4,       // blur in Safari/Firefox; 0 for lenses that must stay sharp underneath (thumbs, magnifier)
    edgeBlur: 0,           // blur only inside the curved rim, fading to the middle: thick-glass haze
    overscan: 0,           // px of margin around the shape: the lens samples outside the rim, like Kyant (needs >= refractionAmount)
    depth: 0,              // 0..1: rim slightly darker inside (glass thickness); visible on light backgrounds where the white highlight is lost
    ghost: false,          // own glass not drawn (LiquidGlass.group draws it); transform and press glow remain
  };

  function attach(el, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const refract = canRefract() && !mq('(prefers-reduced-transparency: reduce)');
    const G = {
      el, o, w: 0, h: 0, maps: null, filter: null, id: null, canvas: null, hl: normHL(o.highlight),
      refract, ov: refract ? Math.max(0, Math.ceil(o.overscan || 0)) : 0, fx: el, tf: { tx: 0, ty: 0, sx: 1, sy: 1 }, k: 1,
      state: {
        lens: o.lens, blur: o.blur, angle: null, surface: o.surface, ghost: !!o.ghost, depth: o.depth || 0,
        shadow: o.shadow ? Object.assign({}, SHADOW, o.shadow === true ? {} : o.shadow) : null,
        innerShadow: o.innerShadow ? Object.assign({}, INNER, o.innerShadow) : null,
      },
    };
    el.classList.add('lg');
    if (G.ov && el.parentNode) {
      // Lens layer: larger than the element by ov on every side and clipped to its shape, so the backdrop outside
      // the rim gets into the backdrop. It is a SIBLING before the element, not a child: the element has children with
      // mix-blend-mode, Chrome makes it a separate surface, and a child's backdrop would be empty.
      // The layer is NOT scaled with transform: Chrome paints backdrop-filter black on an enlarged element
      // that crosses the screen edge. Instead its size and the map size change every frame.
      // Limitation: the element needs position:absolute and no --lg-base.
      G.fx = document.createElement('div');
      G.fx.className = 'lg-lens';
      G.fx.setAttribute('aria-hidden', 'true');
      el.parentNode.insertBefore(G.fx, el);
    } else G.ov = 0;
    if (mq('(prefers-contrast: more)')) el.classList.add('lg--contrast');
    if (!G.refract) el.classList.add('lg--fallback');
    applyRadius(G);
    paintSurface(G);
    el.style.boxShadow = shadowCSS(G);

    if (G.refract) {
      G.id = 'lg-' + (++uid);
      G.filter = document.createElementNS(NS, 'filter');
      G.filter.setAttribute('id', G.id);
      G.filter.setAttribute('filterUnits', 'userSpaceOnUse');
      G.filter.setAttribute('color-interpolation-filters', 'sRGB');
      ensureDefs().appendChild(G.filter);
    } else {
      fallbackFilter(G);
    }

    all.add(G);
    G.ro = new ResizeObserver(() => layout(G));
    G.ro.observe(el);
    layout(G);
    if (o.tilt) Tilt.start();

    const handle = {
      el,
      get options() { return G.o; },
      // material for sibling layers (merge group): surface, tint, blur, saturation
      material: () => ({ surface: G.state.surface, tint: G.o.tint, blur: G.state.blur, saturation: G.o.saturation, radius: G.o.radius }),
      get ghost() { return G.state.ghost; },
      // current offset and scale (the group reads them here instead of reading layout)
      get transform() { return G.tf; },
      set: (p) => set(G, p),
      rebuild: (p) => { Object.assign(G.o, p || {}); if (p && 'highlight' in p) G.hl = normHL(p.highlight); applyRadius(G); G.w = 0; layout(G); },
      destroy() {
        G.ro.disconnect(); all.delete(G);
        if (G.filter) G.filter.remove();
        if (G.canvas) G.canvas.remove();
        if (G.ov) G.fx.remove();
        el.style.backdropFilter = el.style.webkitBackdropFilter = el.style.boxShadow = el.style.background = '';
        el.classList.remove('lg', 'lg--fallback', 'lg--contrast');
        if (el.__lg === handle) delete el.__lg;
      },
    };
    el.__lg = handle;
    return handle;
  }

  function applyRadius(G) {
    G.el.style.borderRadius = G.o.radius === 'capsule' ? '9999px' : G.o.radius + 'px';
  }

  // Lens layer geometry: same centre and scale as the element, but without transform.
  // The layer is clipped at the screen edge: Chrome shifts the map of a backdrop-filter that goes off screen,
  // and a foreign piece of backdrop would show inside the drop. The map stays whole and shifts by the clipped part.
  // The element position is read once, not every frame: reading layout after writing styles forces
  // Chrome to recalc styles and layout mid-frame. geoStamp grows on scroll and window resize.
  let geoStamp = 0;
  if (root.addEventListener) { const bump = () => { geoStamp++; }; root.addEventListener('resize', bump, { passive: true }); root.addEventListener('scroll', bump, { passive: true }); }

  // filter markup and references to its steps; after replacement Chrome keeps the old filter version: reassign
  function remark(G) {
    G.filter.innerHTML = filterMarkup(G);
    G.dms = Array.from(G.filter.querySelectorAll('feDisplacementMap'));
    G.blurEl = G.filter.querySelector('[data-e="bl"]');
    G.imgs = Array.from(G.filter.querySelectorAll('feImage'));
    G.E = {};
    for (const e of G.filter.querySelectorAll('[data-e]')) G.E[e.dataset.e] = e;
    G.fkey = null;
    G.fx.style.backdropFilter = 'none';
    void G.fx.offsetWidth;
    if (!G.state.sleep && !G.state.ghost) G.fx.style.backdropFilter = `url(#${G.id})`;
  }

  function placeLens(G, rebuilt) {
    if (!G.ov || !G.w || (G.state.sleep && !rebuilt)) return; // a sleeping layer is left alone, its position is set on wake
    const { tx, ty, sx, sy } = G.tf, f = G.fx.style, ov = G.ov, r = radiusOf(G.o, G.w, G.h), n = (v) => v.toFixed(2);
    let pc = G.pc;
    if (!pc || pc.stamp !== geoStamp) {
      const op = G.el.offsetParent, pr = op ? op.getBoundingClientRect() : { left: 0, top: 0 };
      pc = G.pc = { stamp: geoStamp, ol: G.el.offsetLeft, ot: G.el.offsetTop, pl: pr.left, pt: pr.top, vw: document.documentElement.clientWidth || root.innerWidth, vh: root.innerHeight };
    }
    const fw = (G.w + 2 * ov) * sx, fh = (G.h + 2 * ov) * sy;
    const L = pc.ol + G.w / 2 + tx - fw / 2, T = pc.ot + G.h / 2 + ty - fh / 2;
    const cl = Math.max(0, -(pc.pl + L)), ct = Math.max(0, -(pc.pt + T));
    const cr = Math.max(0, pc.pl + L + fw - pc.vw), cb = Math.max(0, pc.pt + T + fh - pc.vh);
    const bw = Math.max(1, fw - cl - cr), bh = Math.max(1, fh - ct - cb);
    f.left = n(L + cl) + 'px'; f.top = n(T + ct) + 'px'; f.width = n(bw) + 'px'; f.height = n(bh) + 'px';
    f.clipPath = `inset(${n(ov * sy - ct)}px ${n(ov * sx - cr)}px ${n(ov * sy - cb)}px ${n(ov * sx - cl)}px round ${n(r * sx)}px / ${n(r * sy)}px)`;
    // edge extension is needed only on clipped sides; if the set of sides changed, new markup is needed (rare)
    const sides = (ct > 0.01 ? 'T' : '') + (cb > 0.01 ? 'B' : '') + (cl > 0.01 ? 'L' : '') + (cr > 0.01 ? 'R' : '');
    if (G.filter && sides !== G.sides) { G.sides = sides; remark(G); rebuilt = true; }
    const key = [bw, bh, cl, ct, fw, fh].map(n).join();
    if (G.filter && (rebuilt || key !== G.fkey)) {
      G.fkey = key;
      const box = (e, x, y, w, h) => { sa(e, 'x', n(x)); sa(e, 'y', n(y)); sa(e, 'width', n(Math.max(0, w))); sa(e, 'height', n(Math.max(0, h))); };
      // filter region = the whole map including the clipped part: extended edges go there
      box(G.filter, -cl, -ct, fw, fh);
      for (const im of G.imgs) box(im, -cl, -ct, fw, fh);
      const E = G.E;
      if (E.b0) box(E.b0, 0, 0, bw, bh);
      if (E.cT) { box(E.cT, 0, 0, bw, 1); box(E.tT, 0, -ct, bw, ct); }
      if (E.cB) { box(E.cB, 0, bh - 1, bw, 1); box(E.tB, 0, bh, bw, cb); }
      if (E.cL) { box(E.cL, 0, -ct, 1, fh); box(E.tL, -cl, -ct, cl, fh); }
      if (E.cR) { box(E.cR, bw - 1, -ct, 1, fh); box(E.tR, bw, -ct, cr, fh); }
    }
    // map offsets are in shape pixels; a stretched map needs them in screen pixels
    const k = (sx + sy) / 2;
    if (G.dms && (rebuilt || k !== G.k)) for (const d of G.dms) sa(d, 'scale', (G.maps.scale * G.state.lens * k).toFixed(3));
    G.k = k;
  }

  // Deferred build. Glass maps are computed per pixel; at startup that is hundreds of milliseconds, and the
  // screen stays empty all that time. hold() defers building glass and groups, release() runs the deferred work. The app
  // paints the first screen without glass and calls release() after the first frame: text shows at once, glass
  // appears a frame later.
  let held = 0;
  const heldLay = new Set(), heldBuild = new Set();
  let heldOnce = false;
  function hold() { held++; heldOnce = true; }
  function release() {
    if (!held || --held) return;
    for (const G of heldLay) if (all.has(G)) layout(G);
    for (const b of heldBuild) b();
    heldLay.clear(); heldBuild.clear();
    heldOnce = false;
  }

  function layout(G) {
    if (held) { heldLay.add(G); return; }
    const w = Math.round(G.el.offsetWidth), h = Math.round(G.el.offsetHeight);
    if (!w || !h || (w === G.w && h === G.h)) return;
    G.w = w; G.h = h; G.pc = null;
    if (G.refract) {
      G.maps = buildMaps(w, h, G.o, G.ov);
      G.fw = w + 2 * G.ov; G.fh = h + 2 * G.ov; G.k = 1;
      G.filter.setAttribute('x', '0'); G.filter.setAttribute('y', '0');
      G.filter.setAttribute('width', G.ov ? G.fw : w); G.filter.setAttribute('height', G.ov ? G.fh : h);
      G.sides = '';
      remark(G);
      placeLens(G, true);
    }
    G.el.style.setProperty('--lg-glow', Math.min(w, h) * 1.5 + 'px');
    buildHighlight(G);
    if (G.canvas) G.canvas.style.display = G.state.ghost ? 'none' : '';
  }

  function fallbackFilter(G) {
    const s = G.state, o = G.o;
    const b = Math.max(o.fallbackBlur, sigma(s.blur)); // without refraction, fully transparent glass gets lost
    const f = s.sleep || s.ghost ? 'none' : `blur(${b.toFixed(2)}px) saturate(${o.saturation * 100}%) brightness(${1 + o.brightness * 0.5})`;
    G.el.style.webkitBackdropFilter = f; G.el.style.backdropFilter = f;
  }

  // surface over the glass (onDrawSurface): tint colour at 75% first, surface on top
  function paintSurface(G) {
    const t = G.o.tint, s = G.state.surface;
    if (G.state.ghost) { G.el.style.background = 'transparent'; return; }
    const tc = t ? `color-mix(in srgb, ${t} 75%, transparent)` : 'transparent';
    G.el.style.background = s ? `linear-gradient(${s}, ${s}), ${tc}` : tc;
  }

  // Cheap changes without rebuilding the map: safe to call every frame.
  function set(G, p) {
    const s = G.state, st = G.el.style;
    // sleep: the filter is not needed while invisible (a resting thumb under a white surface, a lens at strength 0).
    // Saves frames while scrolling, especially with many thumbs on screen.
    if ('sleep' in p && !!p.sleep !== !!s.sleep) {
      s.sleep = !!p.sleep;
      if (G.refract) G.fx.style.backdropFilter = s.sleep || s.ghost ? 'none' : `url(#${G.id})`; else fallbackFilter(G);
      if (!s.sleep) { G.pc = null; placeLens(G, false); }
    }
    // ghost: the group draws the glass (merged shapes); the element keeps content, transform and glow
    if ('ghost' in p && !!p.ghost !== s.ghost) {
      s.ghost = !!p.ghost;
      if (G.refract) G.fx.style.backdropFilter = s.sleep || s.ghost ? 'none' : `url(#${G.id})`; else fallbackFilter(G);
      paintSurface(G); st.boxShadow = shadowCSS(G);
      if (G.canvas) G.canvas.style.display = s.ghost ? 'none' : '';
    }
    if ('lens' in p && p.lens !== s.lens) {
      s.lens = p.lens;
      if (G.dms) { const v = (G.maps.scale * s.lens * (G.k || 1)).toFixed(3); for (const d of G.dms) sa(d, 'scale', v); }
    }
    if ('blur' in p && p.blur !== s.blur) {
      s.blur = p.blur;
      if (G.blurEl) sa(G.blurEl, 'stdDeviation', sigma(s.blur).toFixed(3));
      else if (G.refract && G.filter && G.maps) { if (s.blur > 0) { remark(G); placeLens(G, true); } }
      else fallbackFilter(G);
    }
    if ('surface' in p && p.surface !== s.surface) { s.surface = p.surface; paintSurface(G); }
    if ('highlightAlpha' in p && G.canvas) G.canvas.style.opacity = p.highlightAlpha;
    if ('angle' in p && p.angle !== s.angle) { s.angle = p.angle; drawHighlight(G); }
    let sh = false;
    if ('shadowAlpha' in p && s.shadow) { s.shadow.alpha = p.shadowAlpha; sh = true; }
    if ('depth' in p && p.depth !== s.depth) { s.depth = p.depth; sh = true; }
    if ('innerShadow' in p) {
      s.innerShadow = p.innerShadow ? Object.assign(s.innerShadow || Object.assign({}, INNER), p.innerShadow) : null;
      sh = true;
    }
    if (sh) st.boxShadow = shadowCSS(G);
    if (p.press) {
      st.setProperty('--lg-press', p.press.p.toFixed(4));
      if (p.press.x != null) { st.setProperty('--lg-px', p.press.x.toFixed(1) + 'px'); st.setProperty('--lg-py', p.press.y.toFixed(1) + 'px'); }
    }
    if ('tx' in p) st.setProperty('--lg-tx', p.tx.toFixed(2) + 'px');
    if ('ty' in p) st.setProperty('--lg-ty', p.ty.toFixed(2) + 'px');
    if ('sx' in p) st.setProperty('--lg-sx', p.sx.toFixed(4));
    if ('sy' in p) st.setProperty('--lg-sy', p.sy.toFixed(4));
    if ('tx' in p || 'ty' in p || 'sx' in p || 'sy' in p) {
      for (const k of ['tx', 'ty', 'sx', 'sy']) if (k in p) G.tf[k] = p[k];
      if (G.ov) placeLens(G, false);
    }
  }

  // ---------- device tilt -> highlight angle (UISensor from Kyant's catalog) ----------
  const Tilt = {
    on: false, angle: 45,
    start() {
      if (this.on || !('DeviceMotionEvent' in root)) return;
      this.on = true;
      const go = () => root.addEventListener('devicemotion', (e) => {
        const a = e.accelerationIncludingGravity;
        if (!a || a.x == null) return;
        const target = Math.atan2(a.y, a.x) * 180 / Math.PI;
        let d = target - this.angle; d -= 360 * Math.round(d / 360); // shortest way around the circle
        this.angle += d * 0.5;
        if (!this.raf) this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          for (const G of all) if (G.o.tilt && G.hl) set(G, { angle: this.angle });
        });
      });
      // iOS asks for permission on a user gesture
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const ask = () => { DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') go(); }).catch(() => {}); root.removeEventListener('pointerup', ask); };
        root.addEventListener('pointerup', ask);
      } else go();
    },
  };

  // ---------- group of merging glass ----------
  // Like the blob effect in Liquid Glass Studio (iyinchao/liquid-glass-studio) and Apple's GlassEffectContainer.
  // ONE layer with backdrop-filter draws all shapes of the group, first in the shared parent (under the members' content).
  //
  // Speed. Chrome expands an SVG filter into a tree: a result read by N steps is computed N times
  // with everything under it (and sent to the compositor as many times). So there is not a single
  // blur, convolution or morphology over shared results: everything is built from two small pictures per
  // member and cheap steps (offset, add, table). Two heavy steps: the backdrop blur and the displacement.
  //
  //  S: shape field, sum of sigmoids 1 / (1 + e^(sd/merge)). Cutting at 0.5 gives a smooth union (drops),
  //     a table over S gives a thin rim, a shifted S gives the shadow, a difference of shifted S copies gives glare.
  //  W: the same field but wider (thickness). The difference of shifted W copies in x and y is the refraction map:
  //     strong at the rim, fading inward, turning by itself on the bridge. Samples inward, like Apple and Studio.
  // The glass is colourless: no surface, rim and glare are brightened from the backdrop colour (screen).
  // Moving members is cheap: only x, y, width, height of their feImage change, no layout reads.
  const f2 = (v) => (+v).toFixed(2);

  // shape field as a picture: white, alpha = 1 / (1 + e^(sd/s)), exactly 0.5 at the rim
  function fieldImage(w, h, r, s, pad, res) {
    const W = Math.max(2, Math.round((w + 2 * pad) * res)), H = Math.max(2, Math.round((h + 2 * pad) * res));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), im = ctx.createImageData(W, H), d = im.data;
    const hw = w / 2, hh = h / 2, rr = Math.min(r, hw, hh), kx = (w + 2 * pad) / W, ky = (h + 2 * pad) / H;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) * kx - pad - hw, y = (j + 0.5) * ky - pad - hh;
        const k = (j * W + i) * 4;
        d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.round(255 / (1 + Math.exp(sdRR(x, y, hw, hh, rr) / s)));
      }
    }
    ctx.putImageData(im, 0, 0);
    return c.toDataURL();
  }
  // table for feFuncA: values of f on a uniform grid over [0, 1]
  const table = (f, n = 41) => Array.from({ length: n }, (_, k) => Math.max(0, Math.min(1, f(k / (n - 1)))).toFixed(3)).join(' ');
  const sig = (u) => 1 / (1 + Math.exp(u));
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  const GROUP_DEFAULTS = {
    merge: 3,          // merge softness s, px: shapes join from a gap of about 2.2*s (~6.6 px at 3)
    thickness: 5,      // width of the refracting rim (scale of the wide field), px
    refraction: 22,    // how deep the backdrop is sampled right at the rim, px
    blur: 0.6,         // backdrop blur under the glass, px (Studio defaults to almost none)
    saturation: 1.15,  // a little colour liveliness under the glass
    rim: 0.12,         // thin rim brightening (fresnel), 0-1
    rimWidth: 2.5,     // width of the bright rim, px
    glare: 0.85,       // glare toward the light, 0-1
    glareAngle: -45,   // light direction, degrees (-45: from top left, as in Studio)
    glareOpposite: 0.8,// glare on the opposite side
    specular: 0.9,     // thin bright line right on the rim where the light falls (0 = off)
    shade: 0.1,        // darkening inside the rim: glass thickness, visible even on white (0 = off)
    shadeWidth: 8,     // how deep the darkening goes, px
    veil: null,        // CSS colour of a light veil under the content (usually the page colour): labels stay readable over busy backgrounds
    veilOpacity: 0.2,  // veil density; the glass stays transparent
    shadow: 0.16,      // shadow under the group
    margin: 22,        // layer margin around shapes (shadow, stretch), px
    resolution: 0.25,  // density of field pictures: they are smooth and sent to the compositor every frame
    observe: true,     // rebuild when the container or a member changes size (off for short-lived layers such as a menu)
    fadeIn: true,      // the first build after a deferred start fades in
  };

  // Safari, Firefox and reduced transparency: no SVG filter in backdrop-filter, so no merging. Each member gets
  // plain frosted glass of its own (a hairline rim and a soft shadow) instead of an invisible filter layer.
  function fallbackGroup(o) {
    const saved = new Map(), reduced = mq('(prefers-reduced-transparency: reduce)');
    const paint = (el, r) => {
      if (!saved.has(el)) saved.set(el, el.getAttribute('style'));
      const blur = `blur(${Math.max(6, o.blur * 6).toFixed(1)}px) saturate(${Math.round(o.saturation * 140)}%)`;
      Object.assign(el.style, {
        borderRadius: r === 'capsule' || r == null ? '9999px' : r + 'px',
        background: reduced ? (mq('(prefers-color-scheme: dark)') ? 'rgb(44 44 46 / .94)' : 'rgb(242 242 247 / .94)') : 'rgb(255 255 255 / .1)',
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / .38), inset 0 1px 1px rgb(255 255 255 / .35), 0 6px 22px rgb(0 0 0 / .16)',
        backdropFilter: reduced ? 'none' : blur, webkitBackdropFilter: reduced ? 'none' : blur,
      });
    };
    const restore = (el) => { const v = saved.get(el); if (v == null) el.removeAttribute('style'); else el.setAttribute('style', v); saved.delete(el); };
    const radii = new Map();
    const api = {
      fallback: true,
      add(el, mo = {}) { radii.set(el, mo.radius ?? 'capsule'); paint(el, radii.get(el)); return api; },
      remove(el) { if (saved.has(el)) restore(el); radii.delete(el); return api; },
      update() {}, rebuild() {},
      set(p) { Object.assign(o, p); for (const [el, r] of radii) paint(el, r); },
      destroy() { for (const el of [...saved.keys()]) restore(el); radii.clear(); },
    };
    return api;
  }

  function group(container, opts) {
    const o = Object.assign({}, GROUP_DEFAULTS, opts);
    if (!canRefract() || mq('(prefers-reduced-transparency: reduce)')) return fallbackGroup(o);
    const id = 'lgg-' + ++uid;
    const layer = document.createElement('div');
    layer.className = 'lg-group';
    layer.setAttribute('aria-hidden', 'true');
    // The layer is positioned from its container. Otherwise its reference would be a distant ancestor, which would change
    // when the ancestor gains or loses a transform (screen enter animation): the layer would drift away from the buttons.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.insertBefore(layer, container.firstChild); // under all members
    const filter = document.createElementNS(NS, 'filter');
    filter.id = id;
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    ensureDefs().appendChild(filter);
    const members = []; // { el, r, tint, live, w, h, sUrl, wUrl, bx, by, sImg, wImg }
    let box = null, knobs = {};
    const padS = () => Math.ceil(o.merge * 5), padW = () => Math.ceil(o.thickness * 5);

    function radiusOf(m, w, h) {
      const r = typeof m.r === 'function' ? m.r(w, h) : m.r;
      return r === 'capsule' || r == null ? Math.min(w, h) / 2 : Math.min(r, w / 2, h / 2);
    }
    // a live member is moved and scaled by its own CSS transform every frame (a menu growing out of its button):
    // its resting box comes from layout (offsets), not from getBoundingClientRect, which includes the transform
    function restRect(el) {
      const op = el.offsetParent, q = op ? op.getBoundingClientRect() : { left: 0, top: 0 };
      const l = q.left + (op ? op.clientLeft : 0) + el.offsetLeft, t = q.top + (op ? op.clientTop : 0) + el.offsetTop;
      return { left: l, top: t, right: l + el.offsetWidth, bottom: t + el.offsetHeight };
    }
    // member offset and scale without reading layout: the glass remembers what it was given
    const tfOf = (m) => { const h = m.el.__lg; return h && h.transform ? h.transform : null; };

    // layer position and size: bounds of resting members plus margin, clipped by the screen and a fixed ancestor
    function measure() {
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const m of members) {
        const q = m.live ? restRect(m.el) : m.el.getBoundingClientRect(), tf = (!m.live && tfOf(m)) || { tx: 0, ty: 0 };
        // centre without the member's own offset, layout size
        const w = m.el.offsetWidth, h = m.el.offsetHeight;
        m.cx = (q.left + q.right) / 2 - tf.tx; m.cy = (q.top + q.bottom) / 2 - tf.ty;
        l = Math.min(l, m.cx - w / 2); r = Math.max(r, m.cx + w / 2); t = Math.min(t, m.cy - h / 2); b = Math.max(b, m.cy + h / 2);
      }
      l -= o.margin; t -= o.margin; r += o.margin; b += o.margin;
      let lim = { left: 0, top: 0, right: document.documentElement.clientWidth || root.innerWidth, bottom: root.innerHeight };
      for (let p = container; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).position === 'fixed') {
          const q = p.getBoundingClientRect();
          lim = { left: Math.max(lim.left, q.left), top: Math.max(lim.top, q.top), right: Math.min(lim.right, q.right), bottom: Math.min(lim.bottom, q.bottom) };
          break;
        }
      }
      l = Math.max(l, lim.left); t = Math.max(t, lim.top); r = Math.min(r, lim.right); b = Math.min(b, lim.bottom);
      // whole pixels, inward: Chrome samples an empty (black) backdrop under a backdrop-filter layer whose SVG
      // filter region is fractional
      l = Math.ceil(l); t = Math.ceil(t); r = Math.floor(r); b = Math.floor(b);
      return { l, t, w: Math.max(1, r - l), h: Math.max(1, b - t) };
    }

    let built = false;
    function build() {
      if (held) { heldBuild.add(build); return; }
      if (!members.length) { layer.style.display = 'none'; return; }
      // first build after a deferred start: the layer fades in instead of popping
      if (!built) { built = true; if (heldOnce && o.fadeIn) layer.classList.add('lg-in'); }
      layer.style.display = '';
      const g = measure();
      layer.style.left = '0px'; layer.style.top = '0px';
      const op = layer.offsetParent || document.body, oq = op.getBoundingClientRect();
      const L = g.l - oq.left - (op.clientLeft || 0), T = g.t - oq.top - (op.clientTop || 0);
      Object.assign(layer.style, { left: f2(L) + 'px', top: f2(T) + 'px', width: f2(g.w) + 'px', height: f2(g.h) + 'px' });
      box = { w: g.w, h: g.h };
      for (const m of members) {
        const w = m.el.offsetWidth, h = m.el.offsetHeight;
        m.bx = m.cx - g.l; m.by = m.cy - g.t; // centre in layer coordinates, without offset
        if (!m.sUrl || m.w !== w || m.h !== h) {
          m.w = w; m.h = h;
          m.sUrl = fieldImage(w, h, radiusOf(m, w, h), o.merge, padS(), o.resolution);
          m.wUrl = fieldImage(w, h, radiusOf(m, w, h), o.thickness, padW(), o.resolution);
        }
      }
      filter.setAttribute('x', '0'); filter.setAttribute('y', '0');
      filter.setAttribute('width', f2(g.w)); filter.setAttribute('height', f2(g.h));
      filter.innerHTML = markup();
      members.forEach((m, i) => { m.sImg = filter.querySelector(`feImage[data-s="${i}"]`); m.wImg = filter.querySelector(`feImage[data-w="${i}"]`); });
      knobs = { veil: filter.querySelector('feFlood[result="vl"]'), blur: filter.querySelector('feGaussianBlur[result="b0"]'), disp: filter.querySelector('feDisplacementMap') };
      layer.style.backdropFilter = layer.style.webkitBackdropFilter = 'none';
      void layer.offsetWidth;
      layer.style.backdropFilter = layer.style.webkitBackdropFilter = `url(#${id})`;
      update();
    }

    function markup() {
      let m = '';
      const add = (a, b, res) => `<feComposite in="${a}" in2="${b}" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${res}"/>`;
      // 1. S and W fields: sum of member pictures (update places them)
      members.forEach((mb, i) => {
        m += `<feImage data-s="${i}" href="${mb.sUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="s${i}"/>`;
        m += `<feImage data-w="${i}" href="${mb.wUrl}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="w${i}"/>`;
        if (i > 0) m += add(i === 1 ? 's0' : 'S' + (i - 1), 's' + i, 'S' + i) + add(i === 1 ? 'w0' : 'W' + (i - 1), 'w' + i, 'W' + i);
      });
      const n = members.length, S = n > 1 ? 'S' + (n - 1) : 's0', W = n > 1 ? 'W' + (n - 1) : 'w0';
      const T = 2.6 * o.merge; // cut steepness: rim about 1.5 px
      const cut = (inp, res) => `<feComponentTransfer in="${inp}" result="${res}"><feFuncR type="linear" slope="0" intercept="1"/><feFuncG type="linear" slope="0" intercept="1"/><feFuncB type="linear" slope="0" intercept="1"/>` +
        `<feFuncA type="linear" slope="${T.toFixed(3)}" intercept="${(0.5 - 0.5 * T).toFixed(3)}"/></feComponentTransfer>`;
      m += cut(S, 'M');
      // 2. map: difference of W copies shifted by ±d. The result's alpha is the value, moved into R and G
      const d = Math.max(2, 1 / o.resolution), a = 0.46 / Math.tanh(d / (2 * o.thickness));
      const diff = (inp, dx, dy, k, res) => `<feOffset in="${inp}" dx="${f2(-dx)}" dy="${f2(-dy)}" result="${res}p"/><feOffset in="${inp}" dx="${f2(dx)}" dy="${f2(dy)}" result="${res}m"/>` +
        `<feComposite in="${res}p" in2="${res}m" operator="arithmetic" k1="0" k2="${k[0].toFixed(4)}" k3="${k[1].toFixed(4)}" k4="${k[2]}" result="${res}"/>`;
      m += diff(W, d, 0, [a, -a, 0.5], 'gx') + diff(W, 0, d, [a, -a, 0.5], 'gy');
      m += '<feColorMatrix in="gx" type="matrix" values="0 0 0 1 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="mx"/>';
      m += '<feColorMatrix in="gy" type="matrix" values="0 0 0 0 0  0 0 0 1 0  0 0 0 0 0  0 0 0 0 1" result="my"/>';
      m += add('mx', 'my', 'map');
      // 3. backdrop: slightly blurred and livelier, opaque (saturation and alpha = 1 in one matrix)
      let src = 'SourceGraphic';
      if (o.blur > 0) { m += `<feGaussianBlur in="${src}" stdDeviation="${o.blur}" result="b0"/>`; src = 'b0'; }
      const s = o.saturation, q = (v) => v.toFixed(4);
      m += `<feColorMatrix in="${src}" type="matrix" values="${q(0.213 + 0.787 * s)} ${q(0.715 - 0.715 * s)} ${q(0.072 - 0.072 * s)} 0 0  ` +
        `${q(0.213 - 0.213 * s)} ${q(0.715 + 0.285 * s)} ${q(0.072 - 0.072 * s)} 0 0  ${q(0.213 - 0.213 * s)} ${q(0.715 - 0.715 * s)} ${q(0.072 + 0.928 * s)} 0 0  0 0 0 0 1" result="bf"/>`;
      // 4. refraction: one displacement by the map
      m += `<feDisplacementMap in="bf" in2="map" scale="${(o.refraction / 0.46).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="ref0"/>`;
      // member tint (primary action): its own shape filled with the colour at 70%
      const tinted = members.map((mb, i) => (mb.tint ? i : -1)).filter((i) => i >= 0);
      tinted.forEach((i) => {
        m += cut('s' + i, 'ta' + i);
        m += `<feFlood style="flood-color:${members[i].tint}" flood-opacity="0.7" result="tc${i}"/>`;
        m += `<feComposite in="tc${i}" in2="ta${i}" operator="in" result="t${i}"/>`;
      });
      if (o.veil) m += `<feFlood style="flood-color:${o.veil}" flood-opacity="${o.veilOpacity}" result="vl"/>`;
      m += '<feMerge result="ref"><feMergeNode in="ref0"/>' + (o.veil ? '<feMergeNode in="vl"/>' : '') + tinted.map((i) => `<feMergeNode in="t${i}"/>`).join('') + '</feMerge>';
      m += '<feComposite in="ref" in2="M" operator="in" result="glass0"/>';
      // thickness: the glass is slightly darker at the rim and lightens toward the middle (table over S, black with alpha)
      const inside = (v) => smooth(0.47, 0.52, v);
      if (o.shade > 0) {
        const sE = sig(-o.shadeWidth / o.merge);
        const shadeT = table((v) => o.shade * inside(v) * Math.pow(1 - smooth(0.5, sE, v), 1.6));
        m += `<feComponentTransfer in="${S}" result="shd"><feFuncR type="linear" slope="0" intercept="0"/><feFuncG type="linear" slope="0" intercept="0"/><feFuncB type="linear" slope="0" intercept="0"/><feFuncA type="table" tableValues="${shadeT}"/></feComponentTransfer>`;
        m += '<feMerge result="glass"><feMergeNode in="glass0"/><feMergeNode in="shd"/></feMerge>';
      } else m += '<feMerge result="glass"><feMergeNode in="glass0"/></feMerge>';
      // 5. light: glare = difference of S copies along the light direction (bright on the rim facing the light,
      // weaker on the opposite one), plus a thin rim as a table over S. The backdrop gives the colour (screen).
      const ang = (o.glareAngle * Math.PI) / 180, lx = -Math.cos(ang), ly = Math.sin(ang), dg = 2;
      const c = 0.4 / Math.tanh(dg / (2 * o.merge)), op = o.glareOpposite; // 0.4: glare no brighter than it was at DPR 3
      // gap = S(P + dg*L), gam = S(P − dg*L), L points to the light: on the lit rim S grows from the light inward
      m += diff(S, lx * dg, ly * dg, [-c, c, 0], 'ga') + `<feComposite in="gap" in2="gam" operator="arithmetic" k1="0" k2="${(c * op).toFixed(4)}" k3="${(-c * op).toFixed(4)}" k4="0" result="gb"/>`;
      m += `<feComposite in="ga" in2="gb" operator="arithmetic" k1="0" k2="${o.glare}" k3="${o.glare}" k4="0" result="gl"/>`;
      const s1 = sig(-o.rimWidth / o.merge), s2 = sig(-(o.rimWidth + 1.5) / o.merge);
      const rimT = table((v) => inside(v) * (1 - smooth(s1, s2, v)));
      m += `<feComponentTransfer in="${S}" result="band"><feFuncR type="linear" slope="0" intercept="1"/><feFuncG type="linear" slope="0" intercept="1"/><feFuncB type="linear" slope="0" intercept="1"/><feFuncA type="table" tableValues="${rimT}"/></feComponentTransfer>`;
      m += `<feComposite in="gl" in2="band" operator="arithmetic" k1="0" k2="1" k3="${o.rim}" k4="0" result="light0"/>`;
      if (o.specular > 0) {
        // specular line: glare multiplied by a narrow (about 1.3 px) strip right at the rim
        const e1 = sig(-0.5 / o.merge), e2 = sig(-1.9 / o.merge);
        const edgeT = table((v) => inside(v) * (1 - smooth(e1, e2, v)), 81);
        m += `<feComponentTransfer in="${S}" result="edge"><feFuncR type="linear" slope="0" intercept="1"/><feFuncG type="linear" slope="0" intercept="1"/><feFuncB type="linear" slope="0" intercept="1"/><feFuncA type="table" tableValues="${edgeT}"/></feComponentTransfer>`;
        m += `<feComposite in="gl" in2="edge" operator="arithmetic" k1="${(2.6 * o.specular).toFixed(3)}" k2="0" k3="0" k4="0" result="sp"/>`;
        m += add('light0', 'sp', 'light1');
      }
      m += `<feComposite in="${o.specular > 0 ? 'light1' : 'light0'}" in2="M" operator="in" result="light"/>`;
      m += '<feBlend in="light" in2="glass" mode="screen" result="lit"/>';
      // 6. outside, a soft shadow (shifted S); the rest is transparent
      const shT = table((v) => o.shadow * Math.pow(Math.min(1, v / 0.5), 0.8));
      m += `<feOffset in="${S}" dy="3" result="so"/><feComponentTransfer in="so" result="sh"><feFuncR type="linear" slope="0" intercept="0"/><feFuncG type="linear" slope="0" intercept="0"/><feFuncB type="linear" slope="0" intercept="0"/><feFuncA type="table" tableValues="${shT}"/></feComponentTransfer>`;
      m += '<feMerge><feMergeNode in="sh"/><feMergeNode in="lit"/></feMerge>';
      return m;
    }

    // frame: members may have moved and stretched, reposition their pictures (no layout reads)
    function update() {
      if (!box || !members.length) return;
      let lq = null;
      for (const mb of members) {
        if (!mb.sImg) continue;
        let tf = tfOf(mb);
        if (!tf) { // not glass: measure
          lq = lq || layer.getBoundingClientRect();
          const r = mb.el.getBoundingClientRect();
          tf = { tx: (r.left + r.right) / 2 - lq.left - mb.bx, ty: (r.top + r.bottom) / 2 - lq.top - mb.by, sx: r.width / mb.w, sy: r.height / mb.h };
        }
        const cx = mb.bx + tf.tx, cy = mb.by + tf.ty;
        for (const [im, pad] of [[mb.sImg, padS()], [mb.wImg, padW()]]) {
          const w = (mb.w + 2 * pad) * tf.sx, h = (mb.h + 2 * pad) * tf.sy;
          sa(im, 'x', f2(cx - w / 2)); sa(im, 'y', f2(cy - h / 2)); sa(im, 'width', f2(w)); sa(im, 'height', f2(h));
        }
      }
    }

    // a data: picture decodes asynchronously; swapping in one that is already decoded avoids a frame without glass
    const decoded = (url) => { const im = new Image(); im.src = url; return im.decode ? im.decode().catch(() => {}) : Promise.resolve(); };

    let ro = null;
    if (o.observe && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => build()); ro.observe(container); }
    const api = {
      layer, options: o,
      // mo.radius: px, 'capsule' or a function (w, h) => px; mo.live: the member moves by its own transform (see restRect)
      add(el, mo = {}) { members.push({ el, r: mo.radius ?? 'capsule', tint: mo.tint || null, live: !!mo.live }); if (ro && !mo.live) ro.observe(el); build(); return api; },
      remove(el) { const i = members.findIndex((m) => m.el === el); if (i >= 0) { members.splice(i, 1); if (ro) ro.unobserve(el); build(); } return api; },
      has: (el) => members.some((m) => m.el === el),
      get members() { return members.map((m) => m.el); },
      update, rebuild: build,
      // re-attach the filter: the compositor drops and rebuilds the backdrop effect (a mobile WebView can keep
      // drawing an old frame of a live group after its pictures moved); cheap once, not for every frame
      refresh() { if (!box) return; layer.style.backdropFilter = layer.style.webkitBackdropFilter = 'none'; void layer.offsetWidth; layer.style.backdropFilter = layer.style.webkitBackdropFilter = `url(#${id})`; update(); },
      set(p) { Object.assign(o, p); for (const mb of members) mb.sUrl = null; build(); },
      // cheap per-frame changes of the material, no rebuild: veil density, backdrop blur, refraction depth
      tune(p) {
        if (p.veilOpacity != null) { o.veilOpacity = p.veilOpacity; if (knobs.veil) sa(knobs.veil, 'flood-opacity', p.veilOpacity.toFixed(3)); }
        if (p.blur != null && knobs.blur) { o.blur = Math.max(0.01, p.blur); sa(knobs.blur, 'stdDeviation', o.blur.toFixed(2)); }
        if (p.refraction != null) { o.refraction = p.refraction; if (knobs.disp) sa(knobs.disp, 'scale', (p.refraction / 0.46).toFixed(2)); }
      },
      // new pictures for a member whose layout size or radius changed (a menu growing for its sub-menu),
      // swapped in once decoded, without rebuilding the filter; resolves when they are in
      reshape(el) {
        const m = members.find((x) => x.el === el);
        if (!m || !m.sImg) return Promise.resolve();
        const w = el.offsetWidth, h = el.offsetHeight, r = radiusOf(m, w, h);
        const sUrl = fieldImage(w, h, r, o.merge, padS(), o.resolution), wUrl = fieldImage(w, h, r, o.thickness, padW(), o.resolution);
        const tok = (m.tok = (m.tok || 0) + 1);
        return Promise.all([decoded(sUrl), decoded(wUrl)]).then(() => {
          if (tok !== m.tok || !m.sImg) return;
          Object.assign(m, { w, h, sUrl, wUrl });
          m.sImg.setAttribute('href', sUrl); m.wImg.setAttribute('href', wUrl);
          update();
        });
      },
      // resolves once every member picture is decoded (the glass is really on screen a frame later)
      ready: () => Promise.all(members.flatMap((m) => [decoded(m.sUrl), decoded(m.wUrl)])),
      destroy() { if (ro) ro.disconnect(); layer.remove(); filter.remove(); members.length = 0; },
    };
    return api;
  }

  // of(el): the glass already attached to the element, or undefined
  root.LiquidGlass = { attach, group, of: (el) => el && el.__lg, canRefract, DEFAULTS, GROUP_DEFAULTS, sigma, Tilt, hold, release };
})(window);
