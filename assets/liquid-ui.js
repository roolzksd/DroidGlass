/* DroidGlass UI (liquid-ui.js): springs, gestures and ready components on top of liquid-glass.js.
   SPDX-License-Identifier: Apache-2.0. Behaviour and constants ported from the Backdrop catalog (Kyant0/AndroidLiquidGlass, Apache-2.0):
   DampedDragAnimation, InteractiveHighlight, LiquidButton, LiquidToggle, LiquidSlider, LiquidBottomTabs.
   LiquidUI.button(el, opts) / toggle / slider / tabs / magnifier -> component object with methods. */
(function (root) {
  'use strict';
  const LG = root.LiquidGlass;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  // theme: an explicit data-theme on <html> wins over the system one
  // MediaQueryList objects are created once: matchMedia() every frame costs noticeably more than .matches
  const mqDark = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  const mqMotion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const dark = () => {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return !!(mqDark && mqDark.matches);
  };
  const reduceMotion = () => !!(mqMotion && mqMotion.matches);
  // element size without reading layout every frame: a read after style writes forces Chrome
  // to recalc styles and layout mid-frame. Reset when the element changes size.
  const sizes = new WeakMap();
  const sizeRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => { for (const e of es) sizes.delete(e.target); }) : null;
  function sizeOf(el) {
    let z = sizes.get(el);
    if (!z) { z = { w: el.offsetWidth, h: el.offsetHeight, cw: el.clientWidth, ch: el.clientHeight }; if (sizeRO) { sizes.set(el, z); sizeRO.observe(el); } }
    return z;
  }

  // ---------- springs as in Compose: spring(dampingRatio, stiffness, visibilityThreshold), mass 1 ----------
  const spring = (damping = 1, stiffness = 1500, threshold = 0.01) => ({ damping, stiffness, threshold });

  // exact solution of the spring equation over dt: stable at any frame rate
  function stepSpring(x, v, target, dt, z, k) {
    const w = Math.sqrt(k), x0 = x - target;
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z), e = Math.exp(-z * w * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      const B = (v + z * w * x0) / wd;
      return [target + e * (x0 * c + B * s), e * ((B * wd - z * w * x0) * c - (x0 * wd + z * w * B) * s)];
    }
    if (z === 1) {
      const e = Math.exp(-w * dt), B = v + w * x0;
      return [target + e * (x0 + B * dt), e * (B - w * (x0 + B * dt))];
    }
    const q = w * Math.sqrt(z * z - 1), r1 = -z * w + q, r2 = -z * w - q;
    const c2 = (v - r1 * x0) / (r2 - r1), c1 = x0 - c2, e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
    return [target + c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2];
  }

  const active = new Set(), dirty = new Set(), watchers = new Set();
  let raf = 0, last = 0;
  function loop(t) {
    const dt = last ? Math.min(0.064, (t - last) / 1000) : 1 / 60;
    last = t;
    for (const a of Array.from(active)) a._step(dt);
    for (const w of Array.from(watchers)) if (w.test()) { watchers.delete(w); w.done(); }
    // up to three passes: whatever was marked during the frame (a merge group after its glass) is drawn in the same frame
    for (let k = 0; k < 3 && dirty.size; k++) {
      const fns = Array.from(dirty); dirty.clear();
      for (const f of fns) f();
    }
    // raf is reset only here: kick() calls inside the frame must not start a second loop
    raf = 0;
    if (active.size || dirty.size || watchers.size) raf = requestAnimationFrame(loop); else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const invalidate = (fn) => { dirty.add(fn); kick(); };
  const until = (test) => new Promise((done) => { watchers.add({ test, done }); kick(); });
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  class Anim {
    constructor(value, onChange) { this.value = value; this.target = value; this.velocity = 0; this.spec = null; this.onChange = onChange; this.onStep = null; this.onDone = null; this.wait = []; }
    animateTo(target, spec, velocity) {
      this.target = target; this.spec = spec;
      if (velocity != null) this.velocity = velocity;
      if (reduceMotion()) { this.snapTo(target); return Promise.resolve(); }
      active.add(this); kick();
      return new Promise((r) => this.wait.push(r));
    }
    snapTo(v) { this.value = this.target = v; this.velocity = 0; active.delete(this); this._finish(); if (this.onChange) this.onChange(); }
    _step(dt) {
      const s = this.spec;
      [this.value, this.velocity] = stepSpring(this.value, this.velocity, this.target, dt, s.damping, s.stiffness);
      if (Math.abs(this.value - this.target) < s.threshold && Math.abs(this.velocity) < s.threshold * 10) {
        this.value = this.target; this.velocity = 0; active.delete(this); this._finish();
        if (this.onDone) this.onDone();
      }
      if (this.onStep) this.onStep();
      if (this.onChange) this.onChange();
    }
    _finish() { const w = this.wait; this.wait = []; for (const r of w) r(); }
  }

  // velocity over the last 100 ms, least squares
  class VelocityTracker {
    constructor() { this.s = []; }
    reset() { this.s = []; }
    add(t, x) { const s = this.s; s.push([t, x]); while (s.length > 20 || (s.length && t - s[0][0] > 100)) s.shift(); }
    velocity() {
      const s = this.s, n = s.length;
      if (n < 2) return 0;
      let mt = 0, mx = 0;
      for (const [t, x] of s) { mt += t; mx += x; }
      mt /= n; mx /= n;
      let num = 0, den = 0;
      for (const [t, x] of s) { num += (t - mt) * (x - mx); den += (t - mt) * (t - mt); }
      return den ? (num / den) * 1000 : 0;
    }
  }

  // ---------- rubber band and bounce, as in iOS ----------
  // UIScrollView rubber band: f(x) = (1 − 1 / (x*c/d + 1))*d, c = 0.55. The further you pull, the stiffer; limit d.
  const RUBBER_C = 0.55;
  const rubber = (x, d) => (d < 0.5 ? 0 : Math.sign(x) * (1 - 1 / ((Math.abs(x) * RUBBER_C) / d + 1)) * d);
  const rubberInv = (f, d) => { if (d < 0.5) return 0; const a = Math.min(Math.abs(f), d * 0.999); return Math.sign(f) * (d / RUBBER_C) * (a / (d - a)); };
  // bounce after release: a soft underdamped spring, about 15% overshoot, settles in about 0.6 s.
  // A stiff spring (300 and up) on a large stretch looks like a snap with no animation.
  const BOUNCE = spring(0.5, 170, 0.05);
  const PRESS_GLOW = spring(0.5, 300, 0.001);

  // who follows glass movement (merge groups); called in the same frame
  const motionWatch = new WeakMap();
  function onMotion(el, fn) { let s = motionWatch.get(el); if (!s) motionWatch.set(el, (s = new Set())); s.add(fn); return () => s.delete(fn); }
  function notify(el) { const s = motionWatch.get(el); if (s) for (const fn of s) invalidate(fn); }

  // touch-action of stretchy buttons: none, the gesture is ours in any direction. With pan-y on a scrolling page
  // the browser takes any drag with a vertical component and sends pointercancel, even when there is nothing
  // to scroll: the button twitches a couple of pixels and snaps back. Cost: the page cannot be scrolled starting
  // on the button. If scrolling matters more, use button(el, { yieldScroll: true }): vertical drags then go
  // to the page where it scrolls (list below and refreshTouch).
  const stretchy = new Set();
  function scrollsY(el) {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed') return false;
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
    }
    const se = document.scrollingElement || document.documentElement;
    return se.scrollHeight > root.innerHeight + 1;
  }
  let touchRaf = 0, touchRO = null;
  function refreshTouch() {
    if (!touchRO && typeof ResizeObserver !== 'undefined' && document.body) {
      touchRO = new ResizeObserver(() => refreshTouch());
      touchRO.observe(document.documentElement); touchRO.observe(document.body);
    }
    if (touchRaf) return;
    touchRaf = requestAnimationFrame(() => {
      touchRaf = 0;
      for (const el of stretchy) {
        if (!el.isConnected) { stretchy.delete(el); continue; }
        el.style.touchAction = scrollsY(el) ? 'pan-y' : 'none';
      }
    });
  }
  root.addEventListener('resize', refreshTouch);

  // DampedDragAnimation: value, velocity, press and a jelly scale with different stiffness per axis
  class DampedDrag {
    constructor(o) {
      this.min = o.min; this.max = o.max; this.scale0 = o.scale ?? 1; this.pressedScale = o.pressedScale;
      this.pressedScaleX = o.pressedScaleX ?? o.pressedScale; // the drop may be wider than tall
      const ch = o.onChange, th = o.threshold ?? 0.001;
      this.valueSpec = spring(1, 1000, th);
      this.velSpec = spring(0.5, 300, th * 10);
      this.pressSpec = spring(1, 1000, 0.001);
      this.sxSpec = spring(0.6, 250, 0.001);
      this.sySpec = spring(0.7, 250, 0.001);
      this.v = new Anim(o.value, ch); this.vel = new Anim(0, ch); this.p = new Anim(0, ch);
      this.sx = new Anim(this.scale0, ch); this.sy = new Anim(this.scale0, ch);
      this.vt = new VelocityTracker(); this.token = 0;
      this.v.onStep = () => this.updateVelocity();
      this.v.onDone = () => this.vel.animateTo(0, this.velSpec);
    }
    get range() { return this.max - this.min; }
    get value() { return this.v.value; }
    get targetValue() { return this.v.target; }
    get progress() { return (this.v.value - this.min) / this.range; }
    get pressProgress() { return this.p.value; }
    get velocity() { return this.vel.value; }
    press() {
      this.token++; this.vt.reset();
      this.p.animateTo(1, this.pressSpec);
      this.sx.animateTo(this.pressedScaleX, this.sxSpec);
      this.sy.animateTo(this.pressedScale, this.sySpec);
    }
    async release() {
      const tk = ++this.token;
      await nextFrame();
      if (this.v.value !== this.v.target) {
        const th = this.range * 0.025;
        await until(() => Math.abs(this.v.value - this.v.target) < th);
      }
      if (tk !== this.token) return; // pressed again while waiting
      this.p.animateTo(0, this.pressSpec);
      this.sx.animateTo(this.scale0, this.sxSpec);
      this.sy.animateTo(this.scale0, this.sySpec);
    }
    updateValue(x) { this.v.animateTo(clamp(x, this.min, this.max), this.valueSpec); }
    animateToValue(x) {
      this.press();
      this.v.animateTo(clamp(x, this.min, this.max), this.valueSpec);
      if (this.vel.value) this.vel.animateTo(0, this.velSpec);
      this.release();
    }
    updateVelocity() {
      this.vt.add(performance.now(), this.v.value);
      this.vel.animateTo(this.vt.velocity() / this.range, this.velSpec);
    }
    // stretch by velocity: the original keeps the velocity sign, so moving left squeezes the drop;
    // here it is symmetric, like iOS
    squash(div) {
      const v = Math.abs(this.velocity / div);
      return [this.sx.value / (1 - clamp(v * 0.75, 0, 0.2)), this.sy.value * (1 - clamp(v * 0.25, 0, 0.2))];
    }
  }

  // InteractiveHighlight: springy press and a glow that follows the finger
  class PressGlow {
    constructor(onChange) {
      this.p = new Anim(0, onChange); this.x = new Anim(0, onChange); this.y = new Anim(0, onChange);
      this.sx = 0; this.sy = 0;
      this.pSpec = spring(0.5, 300, 0.001); this.posSpec = spring(0.5, 300, 0.5);
    }
    down(x, y) { this.sx = x; this.sy = y; this.p.animateTo(1, this.pSpec); this.x.snapTo(x); this.y.snapTo(y); }
    move(x, y) { this.x.snapTo(x); this.y.snapTo(y); }
    up() { this.p.animateTo(0, this.pSpec); this.x.animateTo(this.sx, this.posSpec); this.y.animateTo(this.sy, this.posSpec); }
    get ox() { return this.x.value - this.sx; }
    get oy() { return this.y.value - this.sy; }
  }

  // gesture with pointer capture; coordinates in the element's space without its transform.
  // Move/up are also tracked on window while the gesture is active: if pointer capture is unavailable
  // (some embedded webviews) or lost, a mouse that leaves the element would otherwise freeze the drag.
  function gesture(el, h) {
    let id = null, lx = 0, ly = 0;
    const local = (e) => {
      const r = el.getBoundingClientRect(), kx = r.width / (el.offsetWidth || 1), ky = r.height / (el.offsetHeight || 1);
      return [(e.clientX - r.left) / kx, (e.clientY - r.top) / ky];
    };
    const onMove = (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (dx === 0 && dy === 0) return;
      h.move && h.move(e, dx, dy, local(e));
    };
    const end = (e, cancel) => {
      if (id === null || (e && e.pointerId !== id)) return;
      id = null;
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', onUp, true);
      root.removeEventListener('pointercancel', onCancel, true);
      h.up && h.up(e, cancel);
    };
    const onUp = (e) => end(e, false);
    const onCancel = (e) => end(e, true);
    // capture lost without pointerup (element removed, capture refused): finish on the next up anywhere
    const onLost = (e) => { if (e.pointerId === id && e.buttons === 0) end(e, false); };
    const onDown = (e) => {
      if (id !== null || e.button > 0) return;
      id = e.pointerId; lx = e.clientX; ly = e.clientY;
      if (e.pointerType === 'mouse') e.preventDefault(); // no text selection or native drag from a mouse press
      try { el.setPointerCapture(id); } catch (_) {}
      root.addEventListener('pointermove', onMove, true);
      root.addEventListener('pointerup', onUp, true);
      root.addEventListener('pointercancel', onCancel, true);
      h.down && h.down(e, local(e));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('lostpointercapture', onLost);
    return () => { end(null, true); el.removeEventListener('pointerdown', onDown); el.removeEventListener('lostpointercapture', onLost); };
  }

  // EaseOut Compose = CubicBezier(0, 0, 0.58, 1)
  function easeOut(x) {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const bx = 3 * (1 - t) * t * t * 0.58 + t * t * t - x;
      const d = 3 * (1 - t) * (1 - t) * 0 + 6 * (1 - t) * t * 0.58 + 3 * t * t * (1 - 0.58);
      if (Math.abs(d) < 1e-6) break;
      t = clamp(t - bx / d, 0, 1);
    }
    return 3 * (1 - t) * t * t + t * t * t;
  }

  function parseColor(c) {
    const m = c.match(/[\d.]+/g).map(Number);
    return c.startsWith('#') ? null : [m[0], m[1], m[2], m[3] ?? 1];
  }
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 1];
  const col = (c) => (c.startsWith('#') ? hex(c) : parseColor(c));
  const mix = (a, b, t) => `rgb(${lerp(a[0], b[0], t).toFixed(0)} ${lerp(a[1], b[1], t).toFixed(0)} ${lerp(a[2], b[2], t).toFixed(0)} / ${lerp(a[3], b[3], t).toFixed(3)})`;

  const THEME = {
    blue: () => (dark() ? '#0091FF' : '#0088FF'),
    green: () => (dark() ? '#30D158' : '#34C759'),
    track: () => (dark() ? 'rgb(120 120 128 / .36)' : 'rgb(120 120 120 / .2)'),
    container: (a = 0.4) => (dark() ? `rgb(18 18 18 / ${a.toFixed(3)})` : `rgb(250 250 250 / ${a.toFixed(3)})`),
  };

  // ---------- LiquidButton ----------
  // capsule; vibrancy, blur 2, lens(12, 24); press: grows 4 px in height and glows under the finger (Kyant).
  // stretch (default): like iOS 26 .interactive() glass. The button follows the finger on a rubber band: it moves
  // by 0.8 of the offset and elongates along the direction, slightly thinner across. It stretches far (rubber limit
  // about 1.6x the short side, scaled by reach) and stays stretched until release: it never tears away by itself.
  // After release it springs back with overshoot. Released outside the button: no click.
  function button(el, opts) {
    const o = Object.assign({ tint: null, surface: null, interactive: true, onClick: null, glass: {}, stretch: true, yieldScroll: false, reach: 0.36 }, opts);
    el.classList.add('lgu-button');
    if (!el.hasAttribute('role') && el.tagName !== 'BUTTON') { el.setAttribute('role', 'button'); el.tabIndex = 0; }
    const glass = LG.attach(el, Object.assign({ radius: 'capsule', blur: 2, saturation: 1.5, refractionHeight: 12, refractionAmount: 24, tint: o.tint, surface: o.surface, highlight: 'default', depth: 1 }, o.glass));
    if (o.stretch && o.interactive) {
      el.classList.add('lg-stretch');
      if (o.yieldScroll) { stretchy.add(el); refreshTouch(); } else el.style.touchAction = 'none';
    }
    // a long press must not open a menu or selection and break the gesture
    const noMenu = (e) => e.preventDefault();
    el.addEventListener('contextmenu', noMenu);
    el.__lgGhost = (on) => glass.set({ ghost: on }); // a merge group takes over drawing the glass
    const glow = new PressGlow(() => invalidate(render));
    const ox = new Anim(0, () => invalidate(render)), oy = new Anim(0, () => invalidate(render));
    const vx = new VelocityTracker(), vy = new VelocityTracker();
    let start = null, x0 = 0, y0 = 0, base = null, suppress = false;
    const cur = { tx: 0, ty: 0, sx: 1, sy: 1 };
    const limit = () => { const z = sizeOf(el); return clamp(1.6 * Math.min(z.w, z.h), 56, 110); }; // rubber limit d, px
    // elongation along the pull: 0.6 of the offset, smoothly capped at 0.22 of the size so text and icon stay crisp
    const elong = (v, size) => { const cap = 0.22 * size; return cap * (1 - Math.exp((-0.6 * Math.abs(v)) / cap)); };
    function render() {
      const z = sizeOf(el), w = z.w, h = z.h, p = glow.p.value;
      const scale = 1 + (4 / h) * p;
      const px = o.reach * ox.value, py = o.reach * oy.value; // reach: share of the pull that reaches the button
      const ex = elong(px, w), ey = elong(py, h); // elongation along the pull, px
      const sx = scale * (1 + ex / w) * (1 - (0.3 * ey) / h), sy = scale * (1 + ey / h) * (1 - (0.3 * ex) / w);
      let tx = 0.8 * px, ty = 0.8 * py;
      if (base) {
        // never past the screen edge: Chrome paints enlarged glass at the edge black
        const vw = document.documentElement.clientWidth || root.innerWidth, vh = root.innerHeight;
        const gx = ((sx - 1) * w) / 2, gy = ((sy - 1) * h) / 2;
        tx = clamp(tx, Math.min(0, 2 - base.left + gx), Math.max(0, vw - 2 - base.right - gx));
        ty = clamp(ty, Math.min(0, 2 - base.top + gy), Math.max(0, vh - 2 - base.bottom - gy));
      }
      Object.assign(cur, { tx, ty, sx, sy });
      glass.set({ tx, ty, sx, sy, press: { p: clamp(p, 0, 1.2), x: clamp(glow.x.value, 0, w), y: clamp(glow.y.value, 0, h) } });
      // how far the edges moved due to the pull (press growth excluded): written to el.__lgPull
      el.__lgPull = { left: ex / 2 - tx, right: tx + ex / 2, top: ey / 2 - ty, bottom: ty + ey / 2 };
      notify(el);
    }
    const release = () => { ox.animateTo(0, BOUNCE, vx.velocity()); oy.animateTo(0, BOUNCE, vy.velocity()); };
    let off = () => {};
    if (o.interactive) {
      off = gesture(el, {
        down: (e, [x, y]) => {
          glow.down(x, y); suppress = false;
          if (!o.stretch) return;
          // button position without its own transform (it may still be bouncing)
          const r = el.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
          const cx = (r.left + r.right) / 2 - cur.tx, cy = (r.top + r.bottom) / 2 - cur.ty;
          base = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, width: w, height: h };
          start = [e.clientX, e.clientY];
          const d = limit(); x0 = rubberInv(ox.value, d); y0 = rubberInv(oy.value, d);
          ox.snapTo(ox.value); oy.snapTo(oy.value); vx.reset(); vy.reset();
        },
        move: (e, dx, dy, [x, y]) => {
          glow.move(x, y);
          if (!o.stretch || !start || reduceMotion()) return;
          const d = limit();
          ox.snapTo(rubber(e.clientX - start[0] + x0, d)); oy.snapTo(rubber(e.clientY - start[1] + y0, d));
          const t = performance.now(); vx.add(t, ox.value); vy.add(t, oy.value);
        },
        up: (e) => {
          // released outside the button (more than 12 px from its place): no press, like iOS when the finger leaves
          if (o.stretch && base) {
            const out = Math.hypot(Math.max(base.left - e.clientX, 0, e.clientX - base.right), Math.max(base.top - e.clientY, 0, e.clientY - base.bottom));
            if (out > 12) suppress = true;
          }
          glow.up(); if (o.stretch) release();
          start = null;
        },
      });
    }
    // a torn-off press must not fire: swallow the next click before page handlers
    const onClickCapture = (e) => { if (suppress) { suppress = false; e.stopImmediatePropagation(); e.preventDefault(); } };
    el.addEventListener('click', onClickCapture, true);
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      glow.down(el.offsetWidth / 2, el.offsetHeight / 2); setTimeout(() => glow.up(), 120);
      if (el.tagName !== 'BUTTON' && o.onClick) o.onClick(e);
    };
    el.addEventListener('keydown', onKey);
    if (o.onClick) el.addEventListener('click', o.onClick);
    return {
      glass,
      destroy() { off(); stretchy.delete(el); el.removeEventListener('contextmenu', noMenu); el.removeEventListener('keydown', onKey); el.removeEventListener('click', onClickCapture, true); el.classList.remove('lg-stretch'); delete el.__lgPull; delete el.__lgGhost; glass.destroy(); },
    };
  }

  // shared thumb for toggle and slider: a white pill at rest, becomes a lens when pressed
  function knobGlass(knob, lensH, lensA) {
    return LG.attach(knob, {
      radius: 'capsule', refractionHeight: lensH, refractionAmount: lensA, dispersion: 1, zoom: 0.75,
      blur: 8, saturation: 1, lens: 0, surface: 'rgb(255 255 255)', fallbackBlur: 0,
      highlight: { style: 'ambient', width: 0.5 / 1.5, blur: 0.25 / 1.5 },
      shadow: { radius: 4, opacity: 0.05 }, innerShadow: { radius: 0, opacity: 0.15 },
    });
  }
  function knobState(g, dd, div) {
    const p = clamp(dd.pressProgress, 0, 1), [sx, sy] = dd.squash(div);
    return { sleep: p < 0.002, lens: p, blur: 8 * (1 - p), surface: `rgb(255 255 255 / ${(1 - p).toFixed(3)})`, highlightAlpha: p, innerShadow: { radius: 4 * p, alpha: p }, sx, sy };
  }

  // ---------- LiquidToggle ----------
  function toggle(el, opts) {
    const o = Object.assign({ checked: false, onChange: null, accent: null }, opts);
    el.classList.add('lgu-toggle');
    el.setAttribute('role', 'switch'); el.tabIndex = 0;
    el.innerHTML = '<div class="lgu-track"></div><div class="lgu-knob"></div>';
    const track = el.firstChild, knob = el.lastChild;
    const g = knobGlass(knob, 5, 10);
    let checked = !!o.checked, fraction = checked ? 1 : 0, didDrag = false, f0 = 0, x0 = 0;
    const dd = new DampedDrag({ value: fraction, min: 0, max: 1, threshold: 0.001, pressedScale: 1.5, onChange: () => invalidate(render) });
    function render() {
      const v = dd.value;
      track.style.background = mix(col(THEME.track()), col(o.accent || THEME.green()), clamp(v, 0, 1));
      g.set(Object.assign(knobState(g, dd, 50), { tx: lerp(2, 22, v) }));
      el.setAttribute('aria-checked', String(checked));
    }
    const commit = (c) => { if (c !== checked) { checked = c; if (o.onChange) o.onChange(c); } invalidate(render); };
    const off = gesture(el, {
      down: (e, [x]) => { didDrag = false; f0 = fraction; x0 = x; dd.press(); },
      move: (e, dx, dy, [x]) => {
        if (dx !== 0) didDrag = true;
        // absolute from the press point: the thumb stays under the pointer even after overshooting an end
        fraction = clamp(f0 + (x - x0) / 20, 0, 1);
        dd.updateValue(fraction);
      },
      up: () => {
        fraction = didDrag ? (dd.targetValue >= 0.5 ? 1 : 0) : (checked ? 0 : 1);
        dd.updateValue(fraction); commit(fraction === 1); dd.release();
      },
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); fraction = checked ? 0 : 1; commit(!checked); dd.animateToValue(fraction);
    });
    invalidate(render);
    return {
      get checked() { return checked; },
      set checked(c) { c = !!c; if (c === checked) return; checked = c; fraction = c ? 1 : 0; dd.animateToValue(fraction); invalidate(render); },
      destroy() { off(); g.destroy(); },
    };
  }

  // ---------- LiquidSlider ----------
  function slider(el, opts) {
    const o = Object.assign({ value: 0.5, min: 0, max: 1, onInput: null, onChange: null, accent: null, label: null }, opts);
    el.classList.add('lgu-slider');
    el.setAttribute('role', 'slider'); el.tabIndex = 0;
    el.setAttribute('aria-valuemin', o.min); el.setAttribute('aria-valuemax', o.max);
    if (o.label) el.setAttribute('aria-label', o.label);
    el.innerHTML = '<div class="lgu-rail"><div class="lgu-fill"></div></div><div class="lgu-knob"></div>';
    const rail = el.firstChild, fill = rail.firstChild, knob = el.lastChild;
    const g = knobGlass(knob, 10, 14);
    const range = o.max - o.min;
    const dd = new DampedDrag({ value: o.value, min: o.min, max: o.max, threshold: range / 1000, pressedScale: 1.5, onChange: () => invalidate(render) });
    let mode = null, didDrag = false, sx0 = 0, v0 = 0, dx0 = 0;
    function render() {
      const W = sizeOf(el).cw, kw = sizeOf(knob).w, pr = clamp(dd.progress, 0, 1);
      rail.style.background = THEME.track();
      fill.style.background = o.accent || THEME.blue();
      fill.style.width = (W * pr).toFixed(1) + 'px';
      g.set(Object.assign(knobState(g, dd, 10), { tx: clamp(-kw / 2 + W * pr, -kw / 4, W - (kw * 3) / 4) }));
      el.setAttribute('aria-valuenow', dd.targetValue.toFixed(3));
    }
    const emit = (v, done) => { if (o.onInput) o.onInput(v); if (done && o.onChange) o.onChange(v); };
    const off = gesture(el, {
      down: (e, [x]) => {
        const W = el.clientWidth, kw = knob.offsetWidth, kx = clamp(-kw / 2 + W * dd.progress, -kw / 4, W - (kw * 3) / 4) + kw / 2;
        didDrag = false; sx0 = x;
        mode = Math.abs(x - kx) < knob.offsetWidth * 0.75 ? 'drag' : 'tap';
        v0 = dd.targetValue; dx0 = x;
        if (mode === 'drag') dd.press();
      },
      move: (e, dx, dy, [x]) => {
        if (mode === 'tap' && Math.abs(x - sx0) > 6) { mode = 'drag'; dd.press(); }
        if (mode !== 'drag') return;
        if (dx !== 0) didDrag = true;
        // absolute from the press point: the thumb stays under the pointer, also after overshooting an end
        const v = clamp(v0 + (range * (x - dx0)) / el.clientWidth, o.min, o.max);
        dd.updateValue(v); emit(v, false);
      },
      up: (e, cancel) => {
        if (mode === 'tap' && !cancel) {
          const v = clamp(o.min + (range * sx0) / el.clientWidth, o.min, o.max);
          dd.animateToValue(v); emit(v, true);
        } else if (mode === 'drag') { dd.release(); if (didDrag) emit(dd.targetValue, true); }
        mode = null;
      },
    });
    el.addEventListener('keydown', (e) => {
      const step = range / 20;
      const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
      if (d == null) return;
      e.preventDefault(); const v = clamp(dd.targetValue + d, o.min, o.max); dd.animateToValue(v); emit(v, true);
    });
    new ResizeObserver(() => invalidate(render)).observe(el);
    invalidate(render);
    return {
      get value() { return dd.targetValue; },
      set value(v) { dd.updateValue(v); },
      destroy() { off(); g.destroy(); },
    };
  }

  // ---------- LiquidBottomTabs ----------
  // panel 64 px (vibrancy, blur 8, lens 24/24), thumb 56 px: a grey pill at rest, a lens with dispersion
  // when pressed; the panel follows the finger by 4 px and grows as a whole when pressed, labels included.
  // Under the thumb lies a copy of the tab row in the accent colour with ITS OWN glass (like Kyant's hidden
  // tabsBackdrop row): the pressed thumb refracts it, and the drop shows a 'bar under the bar' with its rims.
  // contentScale: growth of the panel's own icons and labels when pressed. Kyant uses 1.2, but long labels
  // overlap, so the default is 1: the panel grows as a whole.
  // bubbleScale: growth of the icon and label INSIDE the drop (the copy under the thumb), 1.2 as in Kyant: the drop
  // looks like a lens magnifying its item, neighbouring labels untouched.
  // bubbleDispersion: drop rainbow, 1 as in Kyant. The drop rim samples outside (overscan), so it stays
  // clean; without overscan use 0.5, or the bright rim of the copy smears colour above and below.
  // bubbleAspect: the pressed drop is wider than tall: width fits the longest label, but at least
  // bubbleAspect x height (capped at 1.8x tab width).
  // bubbleHeight: pressed drop height, px. Kyant uses 78 (scale 78/56); 75 is a bit more compact (72 already looks small).
  // bubbleLens: your own drop glass options over the defaults (refractionHeight, refractionAmount, edgeBlur...).
  function tabs(el, opts) {
    const o = Object.assign({ items: [], index: 0, onChange: null, accent: null, contentScale: 1, bubbleScale: 1.2, bubbleDispersion: 1, bubbleAspect: 1.35, bubbleHeight: 75, bubbleLens: null, pressGrow: 16 }, opts);
    const BH = o.bubbleHeight;
    const n = o.items.length;
    el.classList.add('lgu-tabs');
    el.setAttribute('role', 'tablist');
    const tabHTML = (it, i, hidden) =>
      `<button class="lgu-tab" ${hidden ? 'tabindex="-1" aria-hidden="true"' : `role="tab" data-i="${i}"`}>${it.icon || ''}<span>${it.label}</span></button>`;
    el.innerHTML =
      `<div class="lgu-tabs-panel"><div class="lgu-tabs-row">${o.items.map((it, i) => tabHTML(it, i)).join('')}</div></div>` +
      `<div class="lgu-tabs-accent">${o.items.map((it, i) => tabHTML(it, i, true)).join('')}</div>` +
      '<div class="lgu-tabs-sel" aria-hidden="true"></div>';
    const panel = el.children[0], accent = el.children[1], sel = el.children[2];
    const tabsEls = panel.querySelectorAll('.lgu-tab');
    const pg = LG.attach(panel, { radius: 'capsule', saturation: 1.5, blur: 8, refractionHeight: 24, refractionAmount: 24, surface: THEME.container(), highlight: 'default' });
    // copy glass: asleep and transparent at rest; when pressed a 24p lens, panel surface and highlight appear
    const ag = LG.attach(accent, {
      radius: 'capsule', saturation: 1.5, blur: 8, refractionHeight: 24, refractionAmount: 24, lens: 0,
      surface: THEME.container(0), highlight: 'default', shadow: false, fallbackBlur: 0,
    });
    ag.set({ sleep: true, highlightAlpha: 0 });
    const sg = LG.attach(sel, {
      // Kyant uses lens(10, 14). Here the rim is thicker and stronger (12, 26) and slightly hazy (edgeBlur): the glass shows,
      // neighbouring items and the backdrop above the bar bend at the drop edge and blend softly into the middle.
      radius: 'capsule', saturation: 1, blur: 0, refractionHeight: 12, refractionAmount: 26, dispersion: o.bubbleDispersion, lens: 0, fallbackBlur: 0,
      edgeBlur: 1.5,
      overscan: 28, // the drop rim samples what is OUTSIDE it (neighbouring items, backdrop above the bar), like Kyant
      highlight: 'default', shadow: { radius: 24, opacity: 0.1, alpha: 0 }, innerShadow: { radius: 0, opacity: 0.15 },
      ...(o.bubbleLens || {}),
    });
    let current = clamp(o.index | 0, 0, n - 1);
    const dd = new DampedDrag({ value: current, min: 0, max: Math.max(1, n - 1), threshold: 0.001, pressedScale: BH / 56, onChange: () => invalidate(render) });
    const offset = new Anim(0, () => invalidate(render));
    // pull past the edge tab (px, sign = side): the panel stretches on a rubber band and bounces
    const pull = new Anim(0, () => invalidate(render)), pullVT = new VelocityTracker();
    let raw = 0, roomL = 24, roomR = 24;
    const glow = new PressGlow(() => invalidate(render));
    const geo = () => { const W = sizeOf(el).cw; return { W, tw: (W - 8) / n }; };
    // how much the item inside the drop may grow: the label must fit the flat part of the lens
    const accentTabs = accent.querySelectorAll('.lgu-tab');
    let fit = [];
    const measure = () => {
      const { W, tw } = geo(), ps = 1 + o.pressGrow / W, flat = Math.max(8, tw - 20); // flat part of the lens, without the 10 px rim
      const widths = Array.from(accentTabs, (a) => Math.max(...Array.from(a.children, (c) => c.offsetWidth)) || 1);
      const kx = clamp(Math.max((Math.max(...widths) * ps + 8) / flat, (o.bubbleAspect * BH) / tw), BH / 56, 1.8);
      dd.pressedScaleX = kx;
      fit = widths.map((w) => clamp(((flat * kx - 8) / ps) / w, 1, o.bubbleScale));
    };
    function render() {
      const { W, tw } = geo(), p = clamp(dd.pressProgress, 0, 1), gp = glow.p.value;
      const f = clamp(offset.value / W, -1, 1), panelOffset = 4 * Math.sign(f) * easeOut(Math.abs(f));
      const ps = 1 + (o.pressGrow / W) * p;
      // pull past the edge: the panel moves 0.7 of the pull and elongates 0.6, the far edge barely moves
      const e = pull.value, ext = Math.abs(e) * 0.6, PX = ps + ext / W, ptx = panelOffset + 0.7 * e;
      const press = { p: clamp(gp, 0, 1.2), x: (dd.value + 0.5) * tw + 4, y: 32 };
      pg.set({ tx: ptx, sx: PX, sy: ps, surface: THEME.container(), press });
      accent.style.color = o.accent || THEME.blue();
      // While the thumb is pressed, the bar copy under it replaces the panel: a window shaped like the drop is cut in the panel,
      // and the drop refracts only the backdrop and the copy (Kyant's combined backdrop: backdrop + hidden row).
      const awake = p > 0.002;
      ag.set({
        sleep: !awake, lens: p, tx: ptx, sx: PX, sy: ps, surface: THEME.container(awake ? 0.4 : 0),
        highlightAlpha: 0.6 * p, press: { p: press.p, x: press.x - 4, y: 28 },
      });
      el.style.setProperty('--lgu-tab-scale', lerp(1, o.contentScale, p).toFixed(4));
      accentTabs.forEach((a, i) => a.style.setProperty('--lgu-tab-scale', lerp(1, fit[i] || 1, p).toFixed(4)));
      const [sx, sy] = dd.squash(10);
      const selX = dd.value * tw + panelOffset + 0.9 * e;
      const surf = dark() ? `rgb(255 255 255 / ${(0.1 * (1 - p)).toFixed(3)})` : `rgb(0 0 0 / ${(0.1 * (1 - p) + 0.03 * p).toFixed(3)})`;
      sg.set({ sleep: p < 0.002, tx: selX, sx, sy, lens: p, surface: surf, highlightAlpha: p, shadowAlpha: p, innerShadow: { radius: 8 * p, alpha: p } });
      // accent icons are visible only under the thumb: clip-path in accent-row coordinates
      const aw = W - 8, cx = (selX + tw / 2 - ptx - aw / 2) / PX + aw / 2, hw = (tw / 2) * sx / PX, hh = 28 * sy / ps;
      const l = cx - hw, r = aw - (cx + hw), t = 28 - hh, b = 28 - hh;
      accent.style.clipPath = `inset(${t.toFixed(2)}px ${r.toFixed(2)}px ${b.toFixed(2)}px ${l.toFixed(2)}px round ${hh.toFixed(2)}px)`;
      if (awake) {
        // window in the panel in its own coordinates (the panel is shifted and scaled around its centre)
        const H = sizeOf(el).ch, pcx = (selX + 4 + tw / 2 - ptx - W / 2) / PX + W / 2, pcy = H / 2;
        const hx = (tw / 2) * sx / PX - 0.5, hy = 28 * sy / ps - 0.5, rr = Math.min(hx, hy);
        const L = pcx - hx, R = pcx + hx, T = pcy - hy, B = pcy + hy, f = (v) => v.toFixed(2);
        const hole = `M${f(L + rr)} ${f(T)}H${f(R - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(R)} ${f(T + rr)}V${f(B - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(R - rr)} ${f(B)}H${f(L + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(L)} ${f(B - rr)}V${f(T + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(L + rr)} ${f(T)}Z`;
        panel.style.clipPath = `path(evenodd, "M-80 -80H${W + 80}V${H + 80}H-80Z ${hole}")`;
      } else panel.style.clipPath = '';
      tabsEls.forEach((t, i) => t.setAttribute('aria-selected', String(i === current)));
      // only the pull past the edge counts for merging; dragging the drop inside the bar does not merge
      panel.__lgPull = { left: ext / 2 - 0.7 * e, right: 0.7 * e + ext / 2, top: 0, bottom: 0 };
      notify(panel);
    }
    function select(i, fromUser) {
      i = clamp(i, 0, n - 1);
      const changed = i !== current;
      current = i; dd.animateToValue(i);
      if (changed && fromUser && o.onChange) o.onChange(i);
    }
    tabsEls.forEach((t, i) => t.addEventListener('click', () => select(i, true)));
    // Gesture on the whole bar, like iOS 26: pressing another tab moves the drop under the finger, then it can be
    // dragged; past the edge tab the bar stretches on a rubber band (toward a neighbouring button it may merge with).
    const off = gesture(el, {
      down: (e, [x]) => {
        const { tw } = geo();
        const onSel = x >= 4 + dd.value * tw - 6 && x <= 4 + (dd.value + 1) * tw + 6;
        dd.press(); glow.down(0, 0);
        if (!onSel) dd.updateValue(clamp((x - 4) / tw - 0.5, 0, n - 1));
        // Room to pull past each end: the stretched panel and the drop (wider than a tab) must stay on screen,
        // otherwise the screen edge cuts them with a straight line. A bar flush with the screen does not stretch.
        const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
        const over = (tw * ((dd.pressedScaleX || 1) - 1)) / 2 - 4; // how far the pressed drop sticks out past the panel end
        const room = (gap) => clamp(Math.min(gap - 2, (gap - 2 - over) / 0.9), 0, 24);
        roomL = room(r.left); roomR = room(vw - r.right);
        raw = dd.targetValue + rubberInv(pull.value, pull.value < 0 ? roomL : roomR) / tw;
        pull.snapTo(pull.value); pullVT.reset();
      },
      move: (e, dx) => {
        const { tw } = geo();
        raw += dx / tw;
        dd.updateValue(clamp(raw, 0, n - 1));
        offset.snapTo(offset.value + dx);
        const past = (raw - clamp(raw, 0, n - 1)) * tw;
        if (!reduceMotion()) pull.snapTo(rubber(past, past < 0 ? roomL : roomR));
        pullVT.add(performance.now(), pull.value);
      },
      up: () => {
        const i = clamp(Math.round(dd.targetValue), 0, n - 1);
        const changed = i !== current; current = i;
        dd.animateToValue(i);
        offset.animateTo(0, spring(1, 300, 0.5));
        pull.animateTo(0, BOUNCE, pullVT.velocity());
        glow.up();
        if (changed && o.onChange) o.onChange(i);
      },
    });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); select(current + d, true); tabsEls[current].focus(); }
    });
    new ResizeObserver(() => { sel.style.width = geo().tw + 'px'; measure(); invalidate(render); }).observe(el);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); invalidate(render); });
    sel.style.width = geo().tw + 'px';
    invalidate(render);
    // in a merge group the group draws the bar body: panel and row-copy glass switch off, the panel window stays
    panel.__lgGhost = (on) => { pg.set({ ghost: on }); ag.set({ ghost: on }); };
    return { panel, glass: pg, get index() { return current; }, set index(i) { select(i, false); }, destroy() { off(); pg.destroy(); ag.destroy(); sg.destroy(); } };
  }

  // ---------- Magnifier (MagnifierContent): lens 128x96, zoom 1.5, depth, dispersion, inner shadow ----------
  function magnifier(el, opts) {
    const o = Object.assign({ x: 0, y: 0, zoom: 1.5, bounds: null }, opts);
    el.classList.add('lgu-magnifier');
    const g = LG.attach(el, {
      radius: 'capsule', refractionHeight: 8, refractionAmount: 24, depthEffect: true, dispersion: 1, zoom: o.zoom,
      saturation: 1, highlight: 'default', innerShadow: { radius: 16, opacity: 0.15 }, fallbackBlur: 0,
    });
    const pos = { x: new Anim(o.x, () => invalidate(render)), y: new Anim(o.y, () => invalidate(render)) };
    const sx = new Anim(1, () => invalidate(render)), sy = new Anim(1, () => invalidate(render));
    let tx = o.x, ty = o.y;
    function render() { g.set({ tx: pos.x.value, ty: pos.y.value, sx: sx.value, sy: sy.value }); }
    const follow = spring(0.8, 900, 0.1);
    const off = gesture(el, {
      down: () => { sx.animateTo(1.06, spring(0.6, 250, 0.001)); sy.animateTo(1.06, spring(0.7, 250, 0.001)); },
      move: (e, dx, dy) => {
        tx += dx; ty += dy;
        const b = o.bounds && o.bounds();
        if (b) { tx = clamp(tx, b.minX, b.maxX); ty = clamp(ty, b.minY, b.maxY); }
        pos.x.animateTo(tx, follow); pos.y.animateTo(ty, follow);
      },
      up: () => { sx.animateTo(1, spring(0.6, 250, 0.001)); sy.animateTo(1, spring(0.7, 250, 0.001)); },
    });
    invalidate(render);
    return {
      glass: g,
      get x() { return tx; }, get y() { return ty; },
      // move the lens (clamped to bounds), e.g. to keep it on screen after a resize
      moveTo(x, y, animate = true) {
        const b = o.bounds && o.bounds();
        tx = b ? clamp(x, b.minX, Math.max(b.minX, b.maxX)) : x; ty = b ? clamp(y, b.minY, Math.max(b.minY, b.maxY)) : y;
        if (animate) { pos.x.animateTo(tx, follow); pos.y.animateTo(ty, follow); } else { pos.x.snapTo(tx); pos.y.snapTo(ty); }
      },
      destroy() { off(); g.destroy(); },
    };
  }

  // ---------- Merging glass: group (blob) ----------
  // Like the blob effect in Liquid Glass Studio and Apple's GlassEffectContainer: members stop drawing their own
  // glass, one LiquidGlass.group layer draws it with a smooth union of shapes. Merging is by distance:
  // shapes closer than ~2.2 x merge connect with a bridge, touching shapes become one drop.
  // The layer updates in the same frame a member moves (notify from button and tabs).
  const blobs = new Set();
  function blob(els, opts) {
    els = els.filter(Boolean);
    if (els.length < 1) return null;
    // without refraction there is no merging: members keep their own fallback glass instead of being ghosted
    if (!LG.canRefract() || (root.matchMedia && root.matchMedia('(prefers-reduced-transparency: reduce)').matches)) return null;
    let anc = els[0].parentElement;
    while (anc && !els.every((e) => anc.contains(e))) anc = anc.parentElement;
    if (!anc) return null;
    const g = LG.group(anc, opts);
    const offs = [];
    const api = { group: g, members: els, update: null, destroy: null };
    const update = () => {
      if (!els.every((e) => e.isConnected)) { destroy(); return; }
      g.update();
    };
    for (const el of els) {
      const h = LG.of(el), m = h ? h.material() : {};
      g.add(el, { radius: m.radius ?? 'capsule', tint: m.tint || null });
      if (el.__lgGhost) el.__lgGhost(true);
      el.__lgBlob = api;
      offs.push(onMotion(el, update));
    }
    function destroy() {
      offs.forEach((f) => f()); g.destroy(); blobs.delete(api);
      for (const el of els) { if (el.__lgBlob === api) delete el.__lgBlob; if (el.isConnected && el.__lgGhost) el.__lgGhost(false); }
    }
    api.update = update; api.destroy = destroy;
    blobs.add(api);
    return api;
  }
  // remove groups whose member has left the document
  function sweep() { for (const b of Array.from(blobs)) if (!b.members.every((e) => e.isConnected)) b.destroy(); }
  // Collect neighbouring stretchy buttons (adjacent in markup, in a row or column, gap up to maxGap) into groups.
  function autoMerge(scope, opts) {
    const o = Object.assign({ maxGap: 24, glass: null }, opts);
    o.glass = Object.assign({ margin: 64 }, o.glass); // layer margin for far button stretch
    sweep();
    const adjacent = (a, b) => {
      const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
      if (!p.width || !q.width) return false;
      const ovY = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top), ovX = Math.min(p.right, q.right) - Math.max(p.left, q.left);
      const row = ovY > 0.6 * Math.min(p.height, q.height), col = ovX > 0.6 * Math.min(p.width, q.width);
      const gap = row ? Math.max(q.left - p.right, p.left - q.right) : col ? Math.max(q.top - p.bottom, p.top - q.bottom) : -1;
      return (row || col) && gap >= 0.5 && gap <= o.maxGap;
    };
    const next = (el) => { let nx = el.nextElementSibling; while (nx && nx.classList.contains('lg-group')) nx = nx.nextElementSibling; return nx; };
    for (const el of (scope || document).querySelectorAll('.lg-stretch')) {
      if (el.__lgBlob) continue;
      const prev = el.previousElementSibling;
      if (prev && prev.classList.contains('lg-stretch') && !prev.__lgBlob && adjacent(prev, el)) continue; // the row starts earlier
      const run = [el];
      for (let nx = next(el); nx && nx.classList.contains('lg-stretch') && !nx.__lgBlob && adjacent(run[run.length - 1], nx); nx = next(nx)) run.push(nx);
      if (run.length > 1) blob(run, o.glass);
    }
  }

  // ---------- Menu (pull-down / pop-up), like UIMenu in iOS 26 ----------
  // The button pops open into the menu ("the bubble simply pops open", WWDC25 "Meet Liquid Glass"). One merge group
  // holds three shapes: a capsule in the button's place, a round drop and the menu panel. The drop and the panel
  // grow from the button's centre on one spring and stay concentric; while the panel is small it hides inside the
  // drop, so the first frames are a round bubble leaving the button, not a small box. As the panel grows its corners
  // come out of the drop and the bubble becomes the menu; at rest the drop lies inside the panel. Every shape only
  // moves and scales, so the glass pictures are drawn once. The material materializes as it grows: lensing, blur and
  // veil rise with the size (larger glass is thicker, with deeper shadows and softer light).
  // Springs and thresholds measured from UIKit on iOS 26.2 (facebook/astryx, MIT): open 0.8 / 0.32 s, close
  // 0.85 / 0.35 s, sub-menu 0.85 / 0.4 s and back 1 / 0.4 s, the parent's rows 1 -> 0.5 on that spring; a held finger
  // opens the menu after 150 ms (about 300 ms when the page scrolls), may drift 13 px before that, and starts picking
  // only after 10 px of travel. The menu behind a sub-menu recedes to 0.971 (native captures, 416 -> 404 px, measured
  // by liquid_glass_widgets, MIT). The highlight is a pill that slides between rows on SwiftUI's interactive spring.
  // Not measured anywhere: the 20 px rubber band toward a finger held outside, the drop's size.
  const byResponse = (z, response, th = 0.001) => spring(z, Math.pow((2 * Math.PI) / response, 2), th);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const MENU = {
    holdMs: 150, holdMsScroll: 300, slop: 13, handoff: 10, margin: 12, stretch: 20, recede: 0.971, dim: 0.5, inset: 10,
    open: byResponse(0.8, 0.32), close: byResponse(0.85, 0.35), sub: byResponse(0.85, 0.4), back: byResponse(1, 0.4),
    track: byResponse(0.86, 0.15, 0.1), fade: spring(1, 1500, 0.01),
  };
  const MENU_ICONS = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7"/></svg>',
  };
  const menuGlass = (dk) => ({
    merge: 6, thickness: 16, refraction: 34, blur: 10, saturation: 1.7, rim: 0.16, rimWidth: 2.5, glare: 0.6, glareOpposite: 0.45,
    specular: 0.7, shade: dk ? 0.04 : 0.06, shadeWidth: 10, veil: dk ? '#1C1C20' : '#F7F7F9', veilOpacity: dk ? 0.64 : 0.74,
    shadow: 0.05, margin: 48, resolution: 0.25, observe: false, fadeIn: false,
  });
  const normItems = (items) => (items || []).map((it) => (it === '-' || it == null || it.separator) ? { separator: true } : Object.assign({}, typeof it === 'string' ? { label: it } : it));
  let menuUid = 0;

  // rows of one level: a sub-menu's header (its row repeated, with a down chevron), the top row
  // (layout 'medium': 3 items with labels, 'small': 4 icons), then groups
  function menuRows(host, items, layout, head) {
    const rows = [], hl = document.createElement('div');
    hl.className = 'lgu-menu-hl'; host.appendChild(hl);
    const mkRow = (it, cls, cell) => {
      const el = document.createElement('div');
      el.className = 'lgu-menu-item' + (cls ? ' ' + cls : '') + (it.role === 'destructive' ? ' lgu-destructive' : '');
      el.setAttribute('role', it.checked != null ? 'menuitemcheckbox' : 'menuitem');
      if (it.checked != null) el.setAttribute('aria-checked', String(!!it.checked));
      if (it.disabled) el.setAttribute('aria-disabled', 'true');
      if (it.submenu) el.setAttribute('aria-haspopup', 'menu');
      el.tabIndex = -1;
      rows.push({ el, item: it, enabled: !it.disabled, cell: !!cell });
      return el;
    };
    const add = (el, cls, html) => { const s = document.createElement('span'); s.className = cls; if (html != null) s.innerHTML = html; el.appendChild(s); return s; };
    const sep = () => { const sp = document.createElement('div'); sp.className = 'lgu-menu-sep'; sp.setAttribute('role', 'separator'); host.appendChild(sp); };
    if (head) {
      // laid exactly over the row that opened the sub-menu: the row lifts into the card
      const el = mkRow({ label: head.label, back: true }, 'lgu-menu-head');
      if (head.check) add(el, 'lgu-mi-check', '');
      if (head.icon) add(el, 'lgu-mi-icon', head.icon);
      add(el, 'lgu-mi-label').textContent = head.label;
      add(el, 'lgu-mi-chev', MENU_ICONS.down);
      host.appendChild(el); sep();
    }
    let list = normItems(items);
    const n = layout === 'small' ? 4 : layout === 'medium' ? 3 : 0;
    if (n) {
      const top = [];
      while (list.length && top.length < n && !list[0].separator) top.push(list.shift());
      if (list.length && list[0].separator) list.shift();
      const row = document.createElement('div');
      row.className = 'lgu-menu-row lgu-' + layout; row.style.setProperty('--n', top.length); row.setAttribute('role', 'group');
      for (const it of top) {
        const el = mkRow(it, 'lgu-menu-cell', true);
        add(el, 'lgu-mi-icon', it.icon || '');
        if (layout === 'medium') add(el, 'lgu-mi-label').textContent = it.label; else el.setAttribute('aria-label', it.label);
        row.appendChild(el);
      }
      host.appendChild(row);
      if (list.length) sep();
    }
    // groups: icons for all items of a group or none (HIG), a check column when any item has a state
    const groups = [[]];
    for (const it of list) { if (it.separator) { if (groups[groups.length - 1].length) groups.push([]); } else groups[groups.length - 1].push(it); }
    groups.filter((g) => g.length).forEach((g, gi) => {
      if (gi) sep();
      const icons = g.some((it) => it.icon), checks = g.some((it) => it.checked != null);
      for (const it of g) {
        const el = mkRow(it);
        it.__checks = checks;
        if (checks) add(el, 'lgu-mi-check', it.checked ? MENU_ICONS.check : '');
        if (icons) add(el, 'lgu-mi-icon', it.icon || '');
        const lab = add(el, 'lgu-mi-label'); lab.textContent = it.label;
        // a second line in small type, like the current choice under a sub-menu in iOS 26
        if (it.sub) { const sm = document.createElement('small'); sm.className = 'lgu-mi-sub'; sm.textContent = it.sub; lab.appendChild(sm); }
        if (it.submenu) add(el, 'lgu-mi-chev', MENU_ICONS.next);
        host.appendChild(el);
      }
    });
    return { rows, hl };
  }

  function menu(trigger, opts) {
    const fine = !!(root.matchMedia && root.matchMedia('(pointer: fine)').matches);
    const o = Object.assign({ items: [], layout: 'large', onSelect: null, onOpen: null, onClose: null, onHighlight: null, minWidth: 250, maxWidth: 320, radius: fine ? 22 : 32, glass: null }, opts);
    const id = 'lgu-menu-' + ++menuUid;
    if (!LG.of(trigger) && !trigger.__lgBlob) button(trigger, { stretch: false });
    trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
    trigger.style.touchAction = 'none'; // a held finger slides from the button into the menu: the browser must not take it for a scroll
    trigger.style.webkitTouchCallout = 'none';
    const noCtx = (e) => e.preventDefault();
    trigger.addEventListener('contextmenu', noCtx);

    let state = 'closed', ui = null, press = null, lit = null, kbd = false, openedAt = 0;
    const inv = () => invalidate(render);
    const sA = new Anim(0, inv), stx = new Anim(0, inv), sty = new Anim(0, inv), glowA = new Anim(0, inv);
    const hlA = { x: new Anim(0, inv), y: new Anim(0, inv), w: new Anim(0, inv), h: new Anim(0, inv), op: new Anim(0, inv) };

    const vw = () => document.documentElement.clientWidth || root.innerWidth, vh = () => root.innerHeight;
    function triggerRadius(r) {
      const v = parseFloat(getComputedStyle(trigger).borderTopLeftRadius) || 0;
      return v >= Math.min(r.width, r.height) / 2 - 0.5 ? 'capsule' : v;
    }
    const refracts = () => LG.canRefract() && !(root.matchMedia && root.matchMedia('(prefers-reduced-transparency: reduce)').matches);
    function mkSurface(cls) {
      const el = document.createElement('div'); el.className = 'lgu-menu' + (cls ? ' ' + cls : '');
      el.setAttribute('role', 'menu'); el.tabIndex = -1;
      const glow = document.createElement('div'); glow.className = 'lgu-menu-glow';
      const body = document.createElement('div'); body.className = 'lgu-menu-body';
      el.append(glow, body);
      el.addEventListener('pointerdown', onPanelDown);
      // a mouse highlights the row under it without a press, like any desktop menu
      el.addEventListener('pointermove', (e) => { if (!press && e.pointerType === 'mouse' && state === 'open' && !entering() && level().surface === el) { kbd = false; light(rowAt(e.clientX, e.clientY)); } });
      el.addEventListener('pointerleave', (e) => { if (!press && e.pointerType === 'mouse' && !kbd && level().surface === el) light(null); });
      el.addEventListener('keydown', onKey);
      el.addEventListener('contextmenu', noCtx);
      return { el, glow, body };
    }

    // ---------- build ----------
    function build() {
      const dk = dark(), T = trigger.getBoundingClientRect();
      const layer = document.createElement('div'); layer.className = 'lgu-menu-layer' + (dk ? ' lgu-dark' : '');
      const catcher = document.createElement('div'); catcher.className = 'lgu-menu-catch';
      const proxy = document.createElement('div'); proxy.className = 'lgu-menu-proxy';
      const drop = document.createElement('div'); drop.className = 'lgu-menu-proxy';
      const sf = mkSurface(''), panel = sf.el, body = sf.body;
      panel.id = id;
      if (trigger.id) panel.setAttribute('aria-labelledby', trigger.id); else if (trigger.getAttribute('aria-label')) panel.setAttribute('aria-label', trigger.getAttribute('aria-label'));
      layer.append(catcher, proxy, drop, panel); document.body.appendChild(layer);
      const lvl = menuRows(body, typeof o.items === 'function' ? o.items() : o.items, o.layout, null); // a function: items with fresh state on every open
      // size: natural width within limits, height up to the screen; long menus scroll
      panel.style.width = 'max-content';
      const m = MENU.margin, W = Math.round(clamp(panel.offsetWidth, o.minWidth, Math.min(o.maxWidth, vw() - 2 * m)));
      panel.style.width = W + 'px';
      const maxH = vh() - 2 * m;
      const H = Math.min(panel.offsetHeight, maxH);
      body.style.maxHeight = maxH + 'px';
      // place: the menu covers its button and opens toward the room (iOS 26)
      let L = T.left + W <= vw() - m ? T.left : T.right - W >= m ? T.right - W : clamp(T.left, m, vw() - m - W);
      let Tp = T.top + H <= vh() - m ? T.top : T.bottom - H >= m ? T.bottom - H : clamp(T.top, m, vh() - m - H);
      L = Math.max(4, L); Tp = Math.max(4, Tp);
      const R = Math.min(o.radius, W / 2, H / 2);
      Object.assign(panel.style, { left: L + 'px', top: Tp + 'px', height: H + 'px', borderRadius: R + 'px' });
      const tr = triggerRadius(T);
      Object.assign(proxy.style, { left: T.left + 'px', top: T.top + 'px', width: T.width + 'px', height: T.height + 'px', borderRadius: tr === 'capsule' ? '9999px' : tr + 'px' });
      // the drop rests inside the panel, centred
      const D = Math.max(8, Math.min(W, H) - 16);
      Object.assign(drop.style, { left: L + W / 2 - D / 2 + 'px', top: Tp + H / 2 - D / 2 + 'px', width: D + 'px', height: D + 'px', borderRadius: '9999px' });
      const refract = refracts();
      let grp = null;
      const g = Object.assign(menuGlass(dk), o.glass || {}), target = { veil: g.veilOpacity, blur: g.blur, refr: g.refraction };
      if (refract) {
        grp = LG.group(layer, g);
        grp.add(proxy, { radius: tr, live: true });
        grp.add(drop, { radius: 'capsule', live: true });
        grp.add(panel, { radius: R, live: true });
        grp.tune({ veilOpacity: 0, blur: 1, refraction: 18 });
      } else panel.classList.add('lgu-menu--frost');
      const ax = T.left + T.width / 2 - L, ay = T.top + T.height / 2 - Tp; // anchor: the button's centre in panel space
      ui = {
        layer, catcher, proxy, drop, panel, glow: sf.glow, body, grp, refract, dk, R, W, H, L, T: Tp, maxH, g, D,
        d0: Math.min(T.width, T.height), ax, ay, down: ay <= H / 2,
        veil: target.veil, blur: target.blur, refr: target.refr, cards: [],
        levels: [{ host: body, surface: panel, glow: sf.glow, rows: lvl.rows, hl: lvl.hl, R }],
      };
      catcher.addEventListener('pointerdown', onCatchDown);
      catcher.addEventListener('wheel', () => close(), { passive: true });
    }

    // ---------- frame ----------
    function render() {
      if (!ui) return;
      const u = ui, s = sA.value, W = u.W, H = u.H;
      // the menu recedes and dims while a sub-menu card lies over it
      const c0 = u.cards[0], r0 = c0 ? clamp(c0.p.value, 0, 1.2) : 0, k = lerp(1, MENU.recede, r0);
      // growth about the anchor, the recede about the anchored edge, then the stretch toward a finger held outside
      // never a zero-size shape in the glass: a picture of size 0 can leave the whole effect blank in a mobile WebView
      const sv = Math.max(s, 0.04);
      let l = u.ax * (1 - sv) + (W * sv * (1 - k)) / 2, t = u.ay * (1 - sv) + (u.down ? 0 : H * sv * (1 - k)), w = W * sv * k, h = H * sv * k;
      const fx = stx.value, fy = sty.value;
      const dl = fx > 0 ? 0.25 * fx : fx, dr = fx > 0 ? fx : 0.25 * fx, dt = fy > 0 ? 0.25 * fy : fy, db = fy > 0 ? fy : 0.25 * fy;
      l += dl; w += dr - dl; t += dt; h += db - dt;
      u.panel.style.transform = `translate(${l.toFixed(2)}px, ${t.toFixed(2)}px) scale(${Math.max(0, w / W).toFixed(4)}, ${Math.max(0, h / H).toFixed(4)})`;
      const e = smoothstep(0.2, 1, s);
      u.panel.style.boxShadow = `0 ${(16 * e).toFixed(1)}px ${(44 * e).toFixed(1)}px rgb(0 0 0 / ${(0.16 * e).toFixed(3)}), 0 ${(2 * e).toFixed(1)}px ${(8 * e).toFixed(1)}px rgb(0 0 0 / ${(0.05 * e).toFixed(3)})`;
      const op = smoothstep(0.35, 0.85, s);
      u.body.style.opacity = (op * lerp(1, MENU.dim, clamp(r0, 0, 1))).toFixed(3);
      u.body.style.filter = op < 0.999 ? `blur(${((1 - op) * 4).toFixed(2)}px)` : '';
      if (c0) for (const row of c0.covered) row.style.opacity = (1 - smoothstep(0, 0.3, r0)).toFixed(3);
      // the drop: concentric with the panel, from the button's size to its resting size inside the panel
      // it melts into the panel over the last part of the growth, so a menu at rest is the panel alone
      const pc = Math.max(0, s), dd = Math.max(lerp(u.d0, u.D, Math.min(pc, 1)) * (1 - smoothstep(0.8, 1, pc)), 2);
      const cx = u.L + u.ax + pc * (W / 2 - u.ax), cy = u.T + u.ay + pc * (H / 2 - u.ay);
      u.drop.style.transform = `translate(${(cx - (u.L + W / 2)).toFixed(2)}px, ${(cy - (u.T + H / 2)).toFixed(2)}px) scale(${(dd / u.D).toFixed(4)})`;
      // the capsule in the button's place gives way to the drop
      u.proxy.style.transform = `scale(${lerp(1, 0.04, smoothstep(0.1, 0.6, s)).toFixed(4)})`;
      if (u.grp) {
        u.grp.tune({ veilOpacity: u.veil * smoothstep(0.15, 0.75, s), blur: lerp(1, u.blur, smoothstep(0, 0.7, s)), refraction: lerp(18, u.refr, smoothstep(0, 1, s)) });
        u.grp.update();
      } else u.panel.style.opacity = smoothstep(0, 0.45, s).toFixed(3);
      // sub-menu cards, each its own glass in front of the level below
      u.cards.forEach((cd, i) => {
        const p = cd.p.value, pc2 = clamp(p, 0, 1.2), next = u.cards[i + 1], rn = next ? clamp(next.p.value, 0, 1.2) : 0; // a card under a deeper card only dims
        // The card's glass is drawn once at its full size and never moves: the card is revealed by a clip that grows
        // from its row down to its place. A phone WebView redraws a clip every frame, while moved glass pictures
        // can lag behind there (the card then looked clear at first). Its rows are revealed, never squashed.
        const top = lerp(cd.srcT, cd.T, pc2), hh = Math.max(1, lerp(cd.srcH, cd.H, pc2));
        const it = Math.max(0, top - cd.T), ib = Math.max(0, cd.T + cd.H - (top + hh)), open = it < 0.5 && ib < 0.5;
        cd.el.style.clipPath = open ? '' : `inset(${it.toFixed(2)}px 0px ${ib.toFixed(2)}px 0px round ${cd.R}px)`;
        // the rows arrive with the material and lead it: no frame shows an empty frosted card
        const glass = cd.popping ? 1 - smoothstep(0, 0.32, 1 - p) : smoothstep(0, 0.2, p);
        const text = cd.popping ? 1 - smoothstep(0, 0.3, 1 - p) : smoothstep(0, 0.3, p);
        cd.body.style.opacity = (text * lerp(1, MENU.dim, clamp(rn, 0, 1))).toFixed(3);
        if (next) for (const row of next.covered) row.style.opacity = (1 - smoothstep(0, 0.3, rn)).toFixed(3);
        const ce = glass;
        cd.el.style.boxShadow = open ? `0 ${(18 * ce).toFixed(1)}px ${(48 * ce).toFixed(1)}px rgb(0 0 0 / ${(0.2 * ce).toFixed(3)}), 0 ${(2 * ce).toFixed(1)}px ${(8 * ce).toFixed(1)}px rgb(0 0 0 / ${(0.06 * ce).toFixed(3)})` : '';
        if (cd.grp && cd.grp.layer) {
          const ly = cd.grp.layer, q = cd.lq;
          ly.style.clipPath = open ? '' : `inset(${(cd.T - q.top + it).toFixed(2)}px ${(q.right - cd.L - cd.W).toFixed(2)}px ${(q.bottom - cd.T - cd.H + ib).toFixed(2)}px ${(cd.L - q.left).toFixed(2)}px round ${cd.R}px)`;
          ly.style.opacity = glass.toFixed(3);
        } else cd.el.style.opacity = glass.toFixed(3);
      });
      // highlight pill and finger glow on the level in front
      const lv = u.levels[u.levels.length - 1], hs = lv.hl.style;
      hs.transform = `translate(${hlA.x.value.toFixed(2)}px, ${hlA.y.value.toFixed(2)}px)`;
      hs.width = hlA.w.value.toFixed(2) + 'px'; hs.height = hlA.h.value.toFixed(2) + 'px'; hs.opacity = hlA.op.value.toFixed(3);
      for (const l2 of u.levels) l2.glow.style.opacity = l2 === lv ? glowA.value.toFixed(3) : '0';
    }

    // ---------- open / close ----------
    const entering = () => state === 'open' && sA.value < 0.98 && performance.now() - openedAt < 400;
    function setTriggerGlass(on) { const h = LG.of(trigger); if (h && !trigger.__lgBlob) h.set({ ghost: !on }); }
    function open(how = {}) {
      if (state !== 'closed') return;
      state = 'open'; openedAt = performance.now(); kbd = !!how.keyboard; lit = null;
      build();
      const u = ui;
      trigger.setAttribute('aria-expanded', 'true'); trigger.setAttribute('aria-controls', id);
      for (const a of Object.values(hlA)) a.snapTo(0);
      stx.snapTo(0); sty.snapTo(0); glowA.snapTo(0);
      sA.snapTo(0);
      if (reduceMotion()) {
        sA.snapTo(1);
        for (const el of [u.panel, u.grp && u.grp.layer].filter(Boolean)) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      } else sA.animateTo(1, MENU.open).then(() => { if (ui === u && state === 'open' && u.grp) u.grp.refresh(); });
      render();
      if (u.grp) nextFrame().then(nextFrame).then(() => { if (ui === u && u.grp) u.grp.refresh(); });
      // the button's own glass gives way once the group's pictures are decoded: no frame without glass
      if (u.grp) u.grp.ready().then(nextFrame).then(() => { if (ui === u && state === 'open') setTriggerGlass(false); });
      else setTriggerGlass(false);
      root.addEventListener('keydown', onDocKey, true);
      root.addEventListener('resize', onWinChange); root.addEventListener('scroll', onScroll, true);
      if (kbd) focusRow(how.last ? -1 : 0); else u.panel.focus({ preventScroll: true });
      if (o.onOpen) o.onOpen();
    }
    function close(how = {}) {
      if (state !== 'open' || !ui) return;
      state = 'closing';
      const u = ui;
      light(null); glowA.animateTo(0, MENU.fade); stx.animateTo(0, BOUNCE); sty.animateTo(0, BOUNCE);
      for (const cd of u.cards) { cd.popping = true; cd.p.animateTo(0, MENU.close); }
      trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-controls');
      root.removeEventListener('keydown', onDocKey, true);
      root.removeEventListener('resize', onWinChange); root.removeEventListener('scroll', onScroll, true);
      const hadFocus = u.layer.contains(document.activeElement);
      const finish = () => {
        if (ui !== u) return;
        setTriggerGlass(true);
        if (u.grp) u.grp.destroy();
        for (const cd of u.cards) if (cd.grp) cd.grp.destroy();
        u.layer.remove(); ui = null; state = 'closed';
        if (hadFocus || how.focus) trigger.focus({ preventScroll: true });
        if (o.onClose) o.onClose();
      };
      if (how.instant) { finish(); return; }
      if (reduceMotion()) {
        const els = [u.layer];
        Promise.all(els.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished)).then(finish, finish);
        return;
      }
      sA.animateTo(0, MENU.close);
      // hand back to the button once the bubble is the button's size again
      until(() => sA.value < 0.03 || ui !== u).then(finish);
    }
    const onWinChange = () => close({ instant: true });
    const onScroll = (e) => { if (ui && !ui.layer.contains(e.target)) close({ instant: true }); };

    // ---------- rows: hit testing, highlight, actions ----------
    const level = () => ui.levels[ui.levels.length - 1];
    const inRect = (el, x, y) => { const q = el.getBoundingClientRect(); return x >= q.left && x < q.right && y >= q.top && y < q.bottom; };
    // rows span the menu's width: the inset beside a row counts as the row; top-row cells split it by x
    function rowAt(x, y) {
      const lv = level();
      if (!inRect(lv.surface, x, y)) return null;
      for (const r of lv.rows) {
        const q = r.el.getBoundingClientRect();
        if (y >= q.top && y < q.bottom && (!r.cell || (x >= q.left && x < q.right))) return r;
      }
      return null;
    }
    function inPanel(x, y) { return inRect(ui.panel, x, y) || ui.cards.some((cd) => !cd.popping && inRect(cd.el, x, y)); }
    function light(r) {
      if (r && !r.enabled) r = null;
      if (r === lit) return;
      const was = lit; lit = r;
      if (!r) { hlA.op.animateTo(0, MENU.fade); return; }
      const el = r.el, x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
      const jump = !was || hlA.op.value < 0.05;
      for (const [a, v] of [[hlA.x, x], [hlA.y, y], [hlA.w, w], [hlA.h, h]]) { if (jump) a.snapTo(v); else a.animateTo(v, MENU.track); }
      // concentric with the menu's corners (a capsule for one-line rows); cells keep their own radius
      level().hl.style.borderRadius = (r.cell ? getComputedStyle(el).borderRadius : Math.min(Math.max(level().R - MENU.inset, 8), h / 2) + 'px');
      hlA.op.animateTo(1, MENU.fade);
      if (press && o.onHighlight) o.onHighlight(r.item); // a tick per row under the finger, as UIKit plays
    }
    function focusRow(i) {
      const rows = level().rows.filter((r) => r.enabled);
      if (!rows.length) return;
      const r = rows[(i + rows.length) % rows.length];
      r.el.focus({ preventScroll: true }); r.el.scrollIntoView({ block: 'nearest' }); light(r);
    }
    function activate(r) {
      if (!r || !r.enabled) return;
      const it = r.item;
      if (it.back) { closeSub(); return; }
      if (it.submenu) { openSub(r); return; }
      close({ focus: kbd });
      if (it.onSelect) it.onSelect(it);
      if (o.onSelect) o.onSelect(it);
    }

    // ---------- sub-menu: a glass card laid over the menu from the row that opened it ----------
    // The menu behind keeps its size, recedes to 0.971 and dims to 0.5; the rows the card covers fade out fast so the
    // two sets of labels never compete. The card is the menu's own width, so it stands a little past the receded
    // menu; its header is the opened row repeated (a down chevron), laid on that row, and it grows down to fit,
    // past the menu's bottom when it needs to, down to the screen's margin. The header, a tap on the menu behind,
    // Left or Escape go back.
    function openSub(r) {
      const u = ui, parent = level(), m = MENU.margin, pad = MENU.inset;
      const wrap = document.createElement('div'); wrap.className = 'lgu-menu-subwrap';
      const sf = mkSurface('lgu-menu-card'), el = sf.el, body = sf.body;
      el.setAttribute('aria-label', r.item.label);
      wrap.appendChild(el); u.layer.appendChild(wrap);
      const lvl = menuRows(body, r.item.submenu, 'large', { label: r.item.label, icon: r.item.icon, check: r.item.__checks });
      const ps = parent.surface.getBoundingClientRect(), rq = r.el.getBoundingClientRect();
      // the level below at rest and receded (it recedes about its anchored edge)
      const restW = parent === u.levels[0] ? u.W : parent.card.W, restL = parent === u.levels[0] ? u.L : parent.card.L;
      const W = restW;
      el.style.width = W + 'px';
      const natural = el.offsetHeight, head = lvl.rows[0].el.offsetHeight;
      const rowC = rq.top + rq.height / 2, srcT = rq.top - pad, srcH = rq.height + 2 * pad;
      const recededTop = u.down || parent !== u.levels[0] ? ps.top : ps.bottom - ps.height * MENU.recede;
      const recededC = recededTop + (rowC - ps.top) * MENU.recede;
      let T = recededC - pad - head / 2;
      T = Math.max(T, Math.min(ps.top, recededTop));
      // keep the header and a few rows reachable: shift up when the screen ends, scroll when it is still too tall
      const minSee = Math.min(natural, head + 3 * 44 + 2 * pad);
      T = Math.min(T, vh() - m - minSee); T = Math.max(T, m);
      const H = Math.min(natural, vh() - m - T);
      body.style.maxHeight = H + 'px';
      const R = Math.min(o.radius, W / 2, H / 2);
      Object.assign(el.style, { left: restL + 'px', top: T + 'px', height: H + 'px', borderRadius: R + 'px' });
      const cd = { wrap, el, body, glow: sf.glow, L: restL, T, W, H, R, srcT, srcH, grp: null, popping: false, covered: [], veil: Math.min(0.9, u.veil + 0.06) };
      // rows of the level below that end up under the card
      for (const row of parent.rows) { const q = row.el.getBoundingClientRect(), c = recededTop + ((q.top + q.height / 2) - ps.top) * MENU.recede; if (c > T && c < T + H) cd.covered.push(row.el); }
      if (u.refract) {
        const g = Object.assign({}, u.g, { observe: false, fadeIn: false });
        cd.grp = LG.group(wrap, g);
        cd.grp.add(el, { radius: R, live: true });
        // full material from the start; the clip and the opacity do the entrance (see render)
        cd.grp.tune({ veilOpacity: cd.veil, blur: u.blur, refraction: u.refr });
        cd.lq = cd.grp.layer ? cd.grp.layer.getBoundingClientRect() : null;
        if (cd.grp.layer) cd.grp.layer.style.opacity = '0';
      } else el.classList.add('lgu-menu--frost');
      cd.p = new Anim(0, inv);
      u.cards.push(cd);
      const lv = { host: body, surface: el, glow: sf.glow, rows: lvl.rows, hl: lvl.hl, R, card: cd, parent };
      parent.hl.style.opacity = '0'; lit = null; hlA.op.snapTo(0);
      parent.host.style.pointerEvents = 'none';
      u.levels.push(lv);
      glowA.animateTo(0, MENU.fade); stx.animateTo(0, BOUNCE); sty.animateTo(0, BOUNCE);
      const settle = () => { if (ui === u && !cd.popping) { if (cd.grp) cd.grp.refresh(); if (u.grp) u.grp.refresh(); } };
      if (reduceMotion()) cd.p.snapTo(1); else cd.p.animateTo(1, MENU.sub).then(settle);
      render();
      if (cd.grp) nextFrame().then(nextFrame).then(() => { if (ui === u && cd.grp && !cd.popping) cd.grp.refresh(); });
      el.focus({ preventScroll: true });
      if (kbd) setTimeout(() => focusRow(1), 0);
    }
    function closeSub() {
      const u = ui, lv = u.levels.length > 1 ? u.levels.pop() : null;
      if (!lv) return;
      const cd = lv.card;
      light(null);
      cd.popping = true; cd.el.style.pointerEvents = 'none'; // the leaving card never takes a tap meant for the menu
      lv.parent.host.style.pointerEvents = '';
      const done = () => {
        if (cd.grp) cd.grp.destroy();
        cd.wrap.remove(); u.cards = u.cards.filter((x) => x !== cd);
        for (const row of cd.covered) row.style.opacity = '';
        inv();
        if (ui === u && u.grp && state === 'open') nextFrame().then(() => { if (ui === u && u.grp) u.grp.refresh(); });
      };
      if (reduceMotion()) { cd.p.snapTo(0); done(); }
      else { cd.p.animateTo(0, MENU.back); until(() => cd.p.value < 0.01 || ui !== u).then(done); }
      level().surface.focus({ preventScroll: true });
      if (kbd) setTimeout(() => focusRow(0), 0);
    }

    // ---------- gestures ----------
    // one press at a time: from the button (open, then slide onto an item) or inside the open menu
    function track(e, from) {
      press = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, from, opened: from === 'panel', handed: from === 'panel', hand: null, dead: false, timer: 0, x: e.clientX, y: e.clientY };
      root.addEventListener('pointermove', onMove, true);
      root.addEventListener('pointerup', onUp, true);
      root.addEventListener('pointercancel', onCancel, true);
    }
    function untrack() {
      if (!press) return;
      clearTimeout(press.timer);
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', onUp, true);
      root.removeEventListener('pointercancel', onCancel, true);
      press = null;
      if (ui && state === 'open') {
        glowA.animateTo(0, MENU.fade);
        if (stx.value || sty.value) { stx.animateTo(0, BOUNCE); sty.animateTo(0, BOUNCE); }
      }
    }
    function scrub(x, y) {
      if (!ui || state !== 'open') return;
      const lv = level(), r = rowAt(x, y);
      // the pill stays on its row over a separator or an inset and leaves only when the finger leaves the menu
      if (r) light(r); else if (!inRect(lv.surface, x, y)) light(null);
      const q = lv.surface.getBoundingClientRect(), kx = q.width / lv.surface.offsetWidth || 1, ky = q.height / lv.surface.offsetHeight || 1;
      lv.surface.style.setProperty('--mx', ((x - q.left) / kx).toFixed(1) + 'px');
      lv.surface.style.setProperty('--my', ((y - q.top) / ky).toFixed(1) + 'px');
      if (glowA.target !== 1) glowA.animateTo(1, PRESS_GLOW);
      if (ui.levels.length === 1 && !reduceMotion()) {
        // stretch toward a finger held outside the menu (rest box, not the stretched one)
        const L = ui.L, T = ui.T, R = L + ui.W, B = T + ui.H;
        const ex = x < L ? x - L : x > R ? x - R : 0, ey = y < T ? y - T : y > B ? y - B : 0;
        stx.snapTo(rubber(ex, MENU.stretch)); sty.snapTo(rubber(ey, MENU.stretch));
      }
      autoScroll();
    }
    // a finger resting near the top or bottom of a menu that scrolls scrolls it, and the lit row follows
    function autoScroll() {
      if (!press || !press.handed || !ui) return;
      const b = level().host;
      if (!b || b.scrollHeight <= b.clientHeight + 1) return;
      const q = level().surface.getBoundingClientRect(), zone = 32;
      const v = press.y < q.top + zone ? -(q.top + zone - press.y) : press.y > q.bottom - zone ? press.y - (q.bottom - zone) : 0;
      if (!v || press.y < q.top - 8 || press.y > q.bottom + 8) return;
      b.scrollTop += clamp(v, -zone, zone) * 0.5;
      const r = rowAt(press.x, press.y); if (r) light(r);
      invalidate(autoScroll);
    }
    function onTriggerDown(e) {
      if (e.button > 0 || press || state === 'closing') return;
      if (state === 'open') return;
      track(e, 'trigger');
      try { trigger.setPointerCapture(e.pointerId); } catch (_) {}
      kbd = false;
      if (e.pointerType === 'mouse') { e.preventDefault(); press.opened = true; open(); return; }
      const p = press;
      p.timer = setTimeout(() => { if (press === p && !p.dead) { p.opened = true; open(); } }, scrollsY(trigger) ? MENU.holdMsScroll : MENU.holdMs);
    }
    function onPanelDown(e) {
      if (e.button > 0 || press || !ui) return;
      e.preventDefault();
      if (entering()) return; // a tap while the menu grows does nothing (iOS)
      const top = level();
      if (e.currentTarget !== top.surface) { closeSub(); return; } // the level behind a card: back
      if (top.card && !top.card.popping && top.card.p.value < 0.5) return; // a card still on its way in
      kbd = false;
      track(e, 'panel');
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      scrub(e.clientX, e.clientY); // the row under the finger lights on touch-down
    }
    function onMove(e) {
      const p = press;
      if (!p || e.pointerId !== p.id) return;
      p.x = e.clientX; p.y = e.clientY;
      if (!p.opened) {
        if (Math.hypot(p.x - p.x0, p.y - p.y0) > MENU.slop) { p.dead = true; untrack(); }
        return;
      }
      if (!p.handed) {
        if (!p.hand) p.hand = [p.x, p.y]; // the first position the open menu sees
        if (Math.hypot(p.x - p.hand[0], p.y - p.hand[1]) < MENU.handoff) return;
        p.handed = true;
      }
      if (e.cancelable) e.preventDefault();
      scrub(p.x, p.y);
    }
    function onUp(e) {
      const p = press;
      if (!p || e.pointerId !== p.id) return;
      if (p.dead) { untrack(); return; }
      if (!p.opened) { untrack(); open(); return; } // a tap opens on release
      if (p.handed && ui && state === 'open') {
        const r = rowAt(e.clientX, e.clientY);
        if (r && r.enabled) { untrack(); activate(r); return; }
        // a finger lifted outside keeps the menu open; a mouse released outside after a drag closes it
        if (!r && p.type === 'mouse' && !inPanel(e.clientX, e.clientY)) { untrack(); close(); return; }
      }
      untrack();
      if (lit && !kbd) light(null);
    }
    function onCancel(e) { if (press && e.pointerId === press.id) { untrack(); if (ui && !kbd) light(null); } }
    // outside: a mouse press closes at once; a finger closes as it starts to pan or when it lifts
    function onCatchDown(e) {
      e.preventDefault();
      if (state !== 'open' || entering()) return;
      if (e.pointerType === 'mouse') { close(); return; }
      const x0 = e.clientX, y0 = e.clientY, pid = e.pointerId;
      const mv = (ev) => { if (ev.pointerId === pid && Math.hypot(ev.clientX - x0, ev.clientY - y0) > MENU.handoff) done(); };
      const done = () => { root.removeEventListener('pointermove', mv, true); root.removeEventListener('pointerup', done, true); root.removeEventListener('pointercancel', done, true); close(); };
      root.addEventListener('pointermove', mv, true); root.addEventListener('pointerup', done, true); root.addEventListener('pointercancel', done, true);
    }

    // ---------- keyboard ----------
    function onTriggerKey(e) {
      if (state !== 'closed') return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopImmediatePropagation();
        open({ keyboard: true, last: e.key === 'ArrowUp' });
      }
    }
    function onDocKey(e) {
      if (!ui || state !== 'open') return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (ui.levels.length > 1) closeSub(); else close({ focus: true }); }
      else if (e.key === 'Tab') { e.preventDefault(); close({ focus: true }); }
    }
    function onKey(e) {
      if (!ui || state !== 'open') return;
      e.stopPropagation(); // the menu is modal: its keys (type-ahead letters too) never reach page shortcuts
      const rows = level().rows.filter((r) => r.enabled), i = rows.indexOf(lit);
      kbd = true;
      if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(i < 0 ? 0 : i + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(i < 0 ? -1 : i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusRow(0); }
      else if (e.key === 'End') { e.preventDefault(); focusRow(-1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(lit); }
      else if (e.key === 'ArrowRight' && lit && lit.item.submenu) { e.preventDefault(); openSub(lit); }
      else if (e.key === 'ArrowLeft' && ui.levels.length > 1) { e.preventDefault(); closeSub(); }
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        // type-ahead: the next item whose label starts with the letter
        const k = e.key.toLowerCase(), n = rows.length;
        for (let j = 1; j <= n; j++) { const r = rows[(i + j + n) % n]; if ((r.item.label || '').toLowerCase().startsWith(k)) { focusRow(rows.indexOf(r)); break; } }
      }
    }
    // a click with detail 0 is a keyboard or assistive-technology activation of a <button>
    const onTriggerClick = (e) => { if (e.detail === 0 && state === 'closed') open({ keyboard: true }); };

    trigger.addEventListener('pointerdown', onTriggerDown);
    trigger.addEventListener('keydown', onTriggerKey, true);
    trigger.addEventListener('click', onTriggerClick);
    return {
      open: (how) => open(how), close: (how) => close(how),
      get isOpen() { return state === 'open'; },
      get depth() { return ui ? ui.levels.length - 1 : 0; },
      back() { if (ui && ui.levels.length > 1) { closeSub(); return true; } return false; },
      setItems(items) { o.items = items; if (state === 'open') close({ instant: true }); },
      destroy() {
        close({ instant: true }); untrack();
        trigger.removeEventListener('pointerdown', onTriggerDown); trigger.removeEventListener('keydown', onTriggerKey, true);
        trigger.removeEventListener('click', onTriggerClick); trigger.removeEventListener('contextmenu', noCtx);
        trigger.removeAttribute('aria-haspopup'); trigger.removeAttribute('aria-expanded');
      },
    };
  }

  root.LiquidUI = {
    button, toggle, slider, tabs, magnifier, menu, blob, autoMerge, sweep, refreshTouch,
    spring, Anim, DampedDrag, PressGlow, VelocityTracker, gesture, invalidate, rubber, onMotion, notify,
  };
})(window);
