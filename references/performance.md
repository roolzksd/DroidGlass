# Performance (web engine)

- **A filter expands into a tree.** Chrome hands an SVG filter to the compositor as a tree, not a graph: a result read by N steps is computed and sent N times together with everything under it. Two nested forks give four copies, ten give a thousand. Measured: a chain of 10 `feComposite`s, each reading the previous one twice, drops the frame rate to zero. An early version of the tab bar drop had 46 steps in markup, 758 nodes and 141 heavy operations (full-resolution blurs and displacements) in the expanded tree. The shipped version has 131 nodes and 6 heavy ones.
- Rule: a shared result is read only by cheap steps (`feOffset`, `feComposite`, `feColorMatrix`, `feComponentTransfer`, `feMerge`, `feImage`). Blur, `feDisplacementMap`, `feMorphology` and `feConvolveMatrix` never sit under a fork. If two branches need the same effect, recompute it from a small picture, not from the shared result.
- How to count: for every step, size = 1 + the sum of the sizes of its inputs (`SourceGraphic` = 1). Walk `filter.children`, link `in`/`in2`/`feMergeNode` to `result`, and compute the size of the last step and the number of heavy nodes. More than 10 heavy nodes for one element: redesign.

```js
function filterTree(filter) {
  const heavy = /^fe(GaussianBlur|DisplacementMap|Morphology|ConvolveMatrix)$/;
  const by = {}; let last = null, prev = 'SourceGraphic';
  const cost = (name) => (name === 'SourceGraphic' || name === 'BackgroundImage' || !name) ? { n: 1, h: 0 } : by[name] || { n: 1, h: 0 };
  for (const el of filter.children) {
    const ins = el.tagName === 'feMerge' ? [...el.children].map((m) => m.getAttribute('in') || prev)
      : [el.getAttribute('in') || prev, el.getAttribute('in2')].filter((x, i) => i === 0 || x);
    if (el.tagName === 'feImage' || el.tagName === 'feFlood') ins.length = 0;
    const c = ins.map(cost).reduce((a, b) => ({ n: a.n + b.n, h: a.h + b.h }), { n: 1, h: heavy.test(el.tagName) ? 1 : 0 });
    const r = el.getAttribute('result') || `__${Math.random()}`;
    by[r] = c; prev = r; last = c;
  }
  return last; // { n: nodes in the expanded tree, h: heavy nodes }
}
```

- Dispersion = one displacement per channel (3), not 7 samples. Rim haze (`edgeBlur`) blurs the backdrop before displacement, where the rim samples it: the mask is mapped onto the backdrop through `sd = −δ + d(δ)`. Edge extension of a clipped layer (`feTile`) only on clipped sides: every side doubles the tree. A zero blur is never written into the markup.
- `feImage` pictures inside `backdrop-filter` are sent to the compositor every frame while anything repaints (and in every copy of the tree). 160 KB per frame costs about 0.3 ms, 600 KB over 1 ms. Keep them small: fields at resolution 0.25, maps no larger than 4096 pixels.
- Within a frame never read layout after writing styles (`offsetWidth`, `getBoundingClientRect`, `clientHeight`): every such read recalculates styles and layout. The engine caches sizes and resets them with `ResizeObserver`; the lens layer position is reread on scroll and window resize; `matchMedia` objects are created once.
- Maps are built on the CPU when the size changes. For a tab bar that is milliseconds, for a full-screen panel it is noticeable. Animate scale, never `width`/`height`.
- Startup: see `web.md`, "Startup without a half-built screen". In a test app with a tab bar and a couple of buttons, in Chrome with the CPU throttled 4x, `hold()`/`release()` brought first text from 0.88 s to 0.5 s.
- No more than 3 large glass elements on a phone. Check on a real Android device: a headless browser does not show jank. Profile with long tasks and frame pacing, not only FPS counters.
