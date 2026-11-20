# Web, Android WebView, Electron

The engine lives in `assets/`: `liquid-glass.css`, then `liquid-glass.js`, then `liquid-ui.js` (only if you need components). Plain scripts, no build step, no dependencies; they expose `window.LiquidGlass` and `window.LiquidUI`. Copy the files whole and configure them with options. Tested in desktop and headless Chrome and in an Android WebView app.

## How it works

For every element the engine builds a displacement map from the formulas in `math-and-motion.md` (red channel is x, green is y, 128 means "no offset"), and `feDisplacementMap` applies it to the backdrop through `backdrop-filter: url(#id)`. With dispersion it builds one map per colour channel, colours each sample into its channel and adds the results. The highlight is drawn into a canvas over the element, shadows are `box-shadow`, the glow under the finger is `::before`. Animations run on the exact solution of the spring equation with Compose parameters.

## Chromium facts that break almost every implementation

- An SVG filter in `backdrop-filter` is supported only by Chromium. Safari and Firefox **draw nothing**: the element becomes a hole. `@supports (backdrop-filter: url(#x))` says yes in Safari, so the engine checks the engine name (`LiquidGlass.canRefract()`).
- Changing attributes (`scale`, `stdDeviation`) takes effect at once, so lens strength and blur can be animated every frame. After replacing the maps themselves the filter must be reassigned, or the old version stays. The engine does both.
- `backdrop-filter` only sees the backdrop inside its own rectangle. The sample point must not leave it, or the rim shows coloured holes. The engine clamps samples inside, and by default the lens samples closer to the centre. Downside: whatever lies inside near the rim (labels, a surface highlight) gets dragged to the edge as dirty arcs and rainbow smears.
- `overscan: N` behaves like Kyant: a lens layer N px wider than the shape on every side, clipped to the shape, sits under the element, and the rim samples the backdrop **outside**. The layer is a sibling placed before the element (a child of an element with `mix-blend-mode` gets an empty backdrop), and the element itself must be `position: absolute` without `--lg-base`. Set N to at least `refractionAmount`.
- An element with `backdrop-filter` enlarged with `transform` that crosses the screen edge is painted black or with a shifted backdrop. So the `overscan` layer is never scaled with transform: every frame the engine sets its size and stretches the map, and at the screen edge clips the layer and extends the edge pixels (`feTile`).
- Inside a `position: fixed` container Chrome gives the backdrop only within its bounds and mirrors it beyond, and the engine clips glass to those bounds: anything that leaves the box gets a visible straight cut. So a fixed dock must be bigger than its content on every side the glass can reach: transparent `padding-top` of at least `overscan` × drop scale plus how far the drop sticks out above the bar (64 px for this skill's tab bar, 72 is safe), side padding of at least 40 px wherever stretchy buttons or a merge group can be pulled sideways, and the dock anchored to the screen bottom (`bottom: 0` plus `padding-bottom`) rather than floating above it. Give it `pointer-events: none` and the children `pointer-events: auto`. Example: `#dock { position: fixed; left: 0; right: 0; bottom: 0; padding: 72px max(12px, calc(50vw - 230px)) 12px; pointer-events: none }`.
- The tab bar limits its own pull past the edge tabs so the stretched panel and the drop never cross the screen edge; a bar flush with the screen edge does not stretch on that side.
- Blur at the edge mixes with emptiness and darkens. After blurring the engine sets alpha to 1, so colours at the edge stay honest.
- A background set on `body` that propagates to the root does not get into `backdrop-filter`. Put the colourful backdrop into its own element or canvas.
- Do not give the element your own `transform`: the engine drives it through CSS variables. Write the base offset into `--lg-base`, e.g. `--lg-base: translateX(-50%)`.
- **Backdrop root.** An ancestor with `opacity` below 1, `filter`, `mask` or `clip-path` cuts the backdrop: the glass shows only what lies inside that ancestor and darkens. This bites screen enter animations that fade a whole screen in. Move screens with `transform` and reveal them with a veil (a page-coloured layer on top that fades out).
- `sleep: true` turns the filter off while it is invisible (a resting thumb under its white surface, a lens at strength 0). Components do this themselves; without it a scrolling page with a dozen thumbs stutters.
- Puppeteer screenshots with `clip` re-render the page at the clip size, and glass that extends beyond it breaks the same way as at the screen edge. Capture the full viewport and crop the image afterwards.

## `LiquidGlass.attach(el, options)`

Returns a handle: `g.set({...})` for cheap per-frame changes, `g.rebuild({...})` for shape changes, `g.destroy()`.

| Option | What it changes | Values |
|---|---|---|
| `radius` | corner radius, also written to `border-radius` | px number or `'capsule'` |
| `refractionHeight` | width of the curved rim | 5 to 24 px; more looks thicker |
| `refractionAmount` | backdrop offset right at the rim | 10 to 48 px; usually twice the height |
| `depthEffect` | pulls toward the centre too, thicker glass | large tiles, dialogs, magnifier |
| `dispersion` | rainbow, stronger in corners | 0 or 1; only for small elements |
| `zoom` | magnifies the centre | 1.5 for a magnifier, 0.75 for a thumb |
| `blur` | blur, radius as in Compose | 0 to 2 clear, 8 to 16 regular |
| `saturation`, `brightness`, `contrast` | colour under the glass | 1.5 = `vibrancy()` |
| `surface` | surface over the glass | `'rgb(250 250 250 / .4)'` for a tab bar |
| `tint` | primary action tint | `'#0088FF'`; text on it is white |
| `highlight` | highlight | `'default'`, `'ambient'`, `'plain'`, `null` or an object |
| `tilt` | highlight angle follows device tilt | iOS needs a user gesture for permission |
| `shadow`, `innerShadow` | shadows | `true` / object `{ radius, y, opacity }` |
| `depth` | rim slightly darker inside: glass thickness visible even on white, where a white highlight disappears | 0; `LiquidUI.button` uses 1 |
| `lens` | lens strength 0..1 without rebuilding the map | animate through `set` |
| `fallbackBlur` | blur in Safari and Firefox | 4; 0 for thumbs and magnifier |
| `resolution` | map density | 2 for a crisp rim on retina, 4x more expensive |
| `overscan` | margin around the shape, the lens samples outside the rim | 0; 28 for the tab bar drop (≥ `refractionAmount`) |
| `edgeBlur` | thick-glass haze: the backdrop is blurred where the rim samples it, the middle stays sharp. Only with `overscan` | 0; 1 to 2 for a drop |

`g.set` accepts `{ lens, blur, surface, highlightAlpha, angle, shadowAlpha, innerShadow, press: { p, x, y }, tx, ty, sx, sy, sleep, ghost }`.

## Components (`LiquidUI`)

- `button(el, { tint, surface, interactive, onClick, glass, stretch: true, yieldScroll: false, reach: 0.36, press: 'grow' })`: capsule, vibrancy, blur 2, lens(12, 24), press growth and glow, iOS-style stretch (see `math-and-motion.md`). `glass` passes options to `attach`. `press: 'shrink'` makes the button sink to 0.92 under the finger instead of growing (in critically damped over 0.15 s, back on 0.6 / 0.3 s with about 1 % overshoot, measured on a native Android menu button); it suits the trigger of a `motion: 'grow'` menu.
- `toggle(el, { checked, onChange })`, `slider(el, { value, onInput, label })`: thumbs that are white pills at rest and become lenses when pressed.
- `tabs(el, { items: [{ label, icon }], index, onChange, accent, contentScale: 1, bubbleScale: 1.2, bubbleDispersion: 1, bubbleAspect: 1.35, bubbleHeight: 75, bubbleLens, pressGrow: 16 })`: returns `{ panel, ... }`.
- `magnifier(el, { x, y, zoom: 1.5, bounds })`: returns `{ x, y, moveTo(x, y, animate) }`; call `moveTo(m.x, m.y, false)` from a `ResizeObserver` so the lens stays inside its bounds when the screen changes size.
- `menu(trigger, { items, layout: 'large', onSelect, onOpen, onClose, onHighlight, minWidth: 250, maxWidth: 320, radius: 32 (22 with a mouse), glass })`: a pull-down or pop-up menu that pops open out of its button (below, "Menus"). Returns `{ open(), close(), back(), refresh(), retheme(), isOpen, depth, setItems(items), destroy() }`; `glass` may be a function read on every open; `retheme()` recolours an open menu after the page's theme changed (pair it with `tabs.retheme(accent)`, `LiquidUI.recolor()` for merged tinted buttons, `glass.set({ tint })` and `group.tune({ veil })`, so a theme switches in place without a reload); `back()` leaves an open sub-menu and returns false when there is none (for a system Back button).
- `blob([a, b, ...], groupOptions)`, `autoMerge(scope, { maxGap: 24, glass })`, `sweep()`, `refreshTouch()`.
- Building blocks: `spring`, `Anim`, `DampedDrag`, `PressGlow`, `VelocityTracker`, `gesture`, `rubber`, `invalidate`, `onMotion`, `notify`.

### Stretchy buttons and touch

- `touch-action` of a stretchy button is always `none`: the gesture is entirely the button's, in any direction. With `pan-y` on a scrolling page the browser takes any drag with a vertical component and sends `pointercancel`, even when there is nothing to scroll: the button twitches a couple of pixels and snaps back, which looks like "it does not stretch". Cost: the page cannot be scrolled by starting a gesture on the button. If scrolling matters more, `button(el, { yieldScroll: true })`; then call `LiquidUI.refreshTouch()` after screen changes, because the browser reads `touch-action` before `pointerdown`.
- Test the pull on a screen that scrolls, and vertically: on a non-scrolling screen this bug is invisible.
- In a WebView kill long press: `setOnLongClickListener(v -> true)` and `setHapticFeedbackEnabled(false)`; the button also prevents `contextmenu`.
- Groups made by `autoMerge` get a 64 px layer margin, otherwise a far-pulled button would be clipped at the layer edge.

### Tab bar: how the drop is built

`LiquidUI.tabs` follows Kyant's `LiquidBottomTabs`:

1. **The panel** grows as a whole on press (`sx = sy = 1 + 16/W`), icons and labels included. Do not scale the panel labels separately: with long labels (German, Russian) they overlap. Option `contentScale`, default 1.
2. **A copy of the row** in the accent colour lies over the panel with its own glass (lens 24p, panel surface, highlight 0.6p, touch glow). It is visible only under the drop (`clip-path`), and a window under the drop is cut out of the panel (`clip-path: path(evenodd, …)`). So the drop refracts the backdrop and the copy, not a muddy mix of panel and accent. The copy's surface stays the panel colour in dark mode too: the drop never turns light.
3. **Items inside the drop** are magnified to `bubbleScale` (1.2), but never beyond what fits the flat part of the lens (minus the 10 px rim).
4. **The drop** is wider than tall: height `bubbleHeight` 75 px (Kyant uses 78, which is a bit large on a phone with four tabs and a button beside them; 72 already looks small), width fits the longest label but at least `bubbleAspect` (1.35) × height, capped at 1.8x the tab width.
5. **The drop rim** samples outside (`overscan: 28`): neighbouring items and the backdrop above the bar show at the edges without dirty smears. The rim is thicker and stronger than Kyant's: `refractionHeight` 12, `refractionAmount` 26 instead of 10 and 14, plus `edgeBlur: 1.5`. The glass is visible, neighbouring items bend noticeably at the edge and blend softly into the sharp middle. Do not set `refractionHeight` above 12: the label at the bottom of the item enters the rim and bends. Pass your own values in `bubbleLens`. Rainbow `bubbleDispersion` 1, as in Kyant. Without `overscan` use 0.5: sampling inward, the bright rim of the copy splits into coloured smears above and below.

## Merging glass like `GlassEffectContainer`

Apple merges glass shapes inside one container into a single shape when they come closer than `spacing`. The web model is Liquid Glass Studio (iyinchao, MIT): one WebGL shader with a smooth union of edge distances (`smin`), the normal as the gradient of that field, Snell refraction sampling inward (n = 1.4), light dispersion, a thin bright rim and a highlight at −45° plus a second one, 0.8 as strong, on the opposite side. The glass is colourless: zero-opacity tint, the highlight colour comes from the backdrop and is brightened. Studio draws its own backdrop as a texture; it cannot see the page. On the web one `backdrop-filter` over the whole group does the same: `LiquidGlass.group`.

The filter contains no blur, convolution or morphology over shared results (why: `performance.md`). Everything is built from two small pictures per member and cheap steps:

1. **S**, the shape field: for each member a canvas is drawn once with `α = 1 / (1 + e^(sd / merge))` and handed to `feImage` as a `data:` URL (resolution 0.25: the field is smooth, and these pictures are re-sent to the compositor every frame). A reference `feImage href="#id"` does not work inside `backdrop-filter` in Chrome.
2. Fields are added and cut at 0.5: a smooth union. Two shapes stick together when the gap is below 2 · merge · ln 3 ≈ 2.2 · merge (about 6.6 px at `merge: 3`). The closer, the thicker the bridge.
3. **W**, the same field but wider (`thickness`). Displacement map = difference of copies of W shifted by `feOffset` ±d in x and y: `0.5 + a·(W(x+d) − W(x−d))`, `a = 0.46 / tanh(d / 2·thickness)`. Strong at the rim, fading inward, turning by itself on the bridge. The offset is in CSS pixels, so strength does not depend on DPR (a `feConvolveMatrix` kernel is in device pixels, and at DPR 3 the gradient is three times weaker).
4. Backdrop slightly blurred (`blur`), saturation and alpha = 1 in one matrix, one displacement by the map, inward.
5. Light: glare = difference of S copies along the light direction (bright on the rim facing the light, `glareOpposite` on the far one); thin rim = a table (`feFuncA type="table"`) over S. Specular line (`specular`) = the same glare multiplied by a narrow, about 1.3 px, strip right at the rim: a bright stroke where light falls, like iOS 26 glass. All of it is composited with `screen`, so the backdrop gives the colour. Shadow = S shifted down through a table, under the glass.
6. Thickness (`shade`): another table over S gives black with low alpha at the rim, fading out by `shadeWidth`. Invisible on dark, where the highlight works; on white, where the highlight vanishes, this is what separates glass from page. Veil (`veil`): a fill in the page colour at low density under the content, so labels stay readable over a busy backdrop.
7. Each frame only `x`, `y`, `width`, `height` of each member's two `feImage`s change; the group reads offset and scale from the glass (`LiquidGlass.of(el).transform`), never from layout.

| Group option | What it changes | Default |
|---|---|---|
| `merge` | gap at which shapes stick (≈ 2.2 × merge), bridge thickness and highlight width | 3 |
| `thickness` | width of the refracting rim | 5 |
| `refraction` | how deep the backdrop is sampled at the rim | 22 |
| `blur`, `saturation` | backdrop under the glass | 0.6, 1.15 |
| `rim`, `rimWidth` | bright rim | 0.12, 2.5 |
| `glare`, `glareAngle`, `glareOpposite` | highlight and its weaker twin on the other side | 0.85, −45, 0.8 |
| `specular` | thin bright line on the lit rim | 0.9 |
| `shade`, `shadeWidth` | darkening inside the rim and its depth | 0.1, 8 |
| `veil`, `veilOpacity` | page-coloured veil under content; 0.2 to 0.25 for a bar with labels | none, 0.2 |
| `shadow` | shadow under the group | 0.16 |
| `margin` | layer margin around members for shadow and stretch | 22 |
| `resolution` | density of the field pictures; 1 for still renders, 0.25 for live UI | 0.25 |

Wiring:

- `LiquidUI.blob([a, b, …], opts)` puts the group as the first child of the members' common parent, under them, and turns off their own glass (`ghost`: no `backdrop-filter`, surface or shadow; content and gestures stay). A primary action's tint moves into the group: its mask is filled with the colour at 70%.
- `LiquidUI.autoMerge(scope, { maxGap: 24, glass })` groups neighbouring stretchy buttons by itself (adjacent in markup, in a row or column). `LiquidUI.sweep()` removes groups whose members left the document. A bar with a button beside it: `LiquidUI.blob([tabs.panel, fab], { blur: 3.5 })`; the tab bar drop stays its own glass on top.
- For still images or custom layouts use the group directly: `const g = LiquidGlass.group(container, opts); g.add(el, { radius: 'capsule' });` (members may be plain elements; see `media/hero.html` in the repository).
- At rest the gap between glass shapes must exceed 2.2 · merge, or they stick at once. Press growth also brings edges closer: for a bar next to a button use `pressGrow: 8` (default 16) and a 12 px gap.
- The group layer is positioned from its container: the engine sets `position: relative` on a static container. Otherwise the layer's reference would be a distant ancestor that changes when the ancestor gains or loses a `transform` (a screen enter animation), and the layer would drift away from the buttons.
- Without refraction (Safari, Firefox, `prefers-reduced-transparency`) `LiquidGlass.group` gives every member plain frosted glass of its own and `LiquidUI.blob` does nothing, so members keep their own fallback glass. Shapes do not merge there.
- Cost: about 98 nodes in the expanded tree, two of them heavy (backdrop blur and displacement); glare, specular line and shading add only cheap steps.

## Menus: the button turns into the menu

`LiquidUI.menu` behaves like `UIMenu` on a button in iOS 26. Springs and gesture thresholds are measured from UIKit on the iOS 26.2 simulator by the astryx project (Meta, MIT); the material is chosen by eye to match iOS screenshots.

```js
LiquidUI.menu(document.getElementById('more'), {
  layout: 'medium',            // 'large' (rows), 'medium' (first 3 items as a row of icons with labels), 'small' (first 4, icons only)
  items: [
    { label: 'Copy', icon: '<svg>…</svg>' }, { label: 'Share', icon: '<svg>…</svg>' }, { label: 'Pin', icon: '<svg>…</svg>' },
    '-',                                                      // separator: a new group
    { label: 'Sort By', icon: '<svg>…</svg>', submenu: [{ label: 'Name', checked: true }, { label: 'Date', checked: false }] },
    { label: 'Delete', icon: '<svg>…</svg>', role: 'destructive', onSelect: () => {} },
  ],
  onSelect: (item) => {},
});
```

- **Items:** `{ label, sub, icon, checked, disabled, role: 'destructive', keepOpen, submenu, onSelect }`. `keepOpen` (UIMenu's `keepsMenuPresented`): the item applies at once and the menu stays open, its rows show the new state (switches, a theme choice) (`sub`: a second line in small type, such as the current choice under a sub-menu), or `'-'` for a separator. `items` may be a function: it is called on every open, so checks and labels show the current state. Within a group, icons are shown for all items or for none, and a check column appears when any item has `checked` (HIG).
- **Morph.** The button pops open into the menu ("the bubble simply pops open", WWDC25). The glass is drawn once at the menu's full size with its full material and never moves: a phone WebView may not redraw moved glass pictures every frame, and the menu then looked clear while it grew. The entrance is a clip on the glass layer and on the panel: a rounded rect that starts as the button (a capsule) and grows into the menu, staying round, a bubble, until late in the growth, then takes the menu's corner radius. The content scales into the same rect and fades in from a light blur. The button's own glass hides only after the group's pictures are decoded, so no frame is without glass.
- **The button.** The trigger stretches toward the finger like any glass button. When the menu opens (a tap, or a hold of 150 ms), the stretch springs back and the same finger goes on to the rows. A pull past 13 px before that is just a stretch and opens nothing.
- **Placement.** The menu covers its button and opens toward the free side, 12 px from the screen edges; a long menu scrolls inside. With `motion: 'grow'` it sits under the button instead (see below).
- **Gestures, as in iOS:** a mouse opens on press. A finger opens on lift after a tap, or after a 150 ms hold (300 ms when the page scrolls), and may drift 13 px before that. With the menu open under a held finger, picking starts after 10 px of travel; lifting on a row picks it, lifting outside keeps the menu open. A finger can also press anywhere in an open menu and slide: every part of the menu has `touch-action: none` (its body is a scroll container, so the panel's own value would not reach the rows, and the browser would cancel the pointer on the first move). Taps during the entrance are ignored. Outside: a mouse press closes; a finger closes on lift or on a pan longer than 10 px.
- **Highlight.** A pill under the row the finger is on, inset 10 px and concentric with the menu's corners (a capsule for one-line rows), lights on touch-down and slides from row to row on SwiftUI's interactive spring (0.86, 0.15 s) instead of jumping. Rows span the menu's width, so the inset beside a row counts as the row; over a separator the pill stays where it is and leaves only when the finger leaves the menu. `onHighlight(item)` is called on every row change under a finger, for a selection tick (UIKit plays one). A soft glow follows the finger inside the glass. The menu does not stretch toward a finger held outside: its glass does not move.
- **Metrics after iOS 26:** 250 px wide, corner radius 32, rows of 44 px with 17 px text, icons at 26 px from the edge and labels at about 56 px, separators as hairlines with 9 px above and below, top-row cells of 72 px with 12 px labels.
- **Sub-menus** open as a glass card laid over the menu from the row that opened it. The menu behind keeps its size, recedes to 0.971 about its anchored edge and dims to 0.5 on the sub-menu spring; the rows the card covers fade out fast so the two sets of labels never compete. The card has the menu's own width, so it stands a little past the receded menu. Its header is the opened row repeated in bold with a down chevron, laid exactly on that row, and it grows down to fit, past the menu's bottom when it needs to, down to the screen margin (then it scrolls). Its glass is drawn once at full size and never moves: a clip grows from the row down to its place (a phone WebView redraws a clip every frame, while moved glass pictures can lag there), and its rows arrive with the material and lead it, so no frame shows an empty frosted card. On the way back (1 / 0.4 s) the card shrinks toward its row while its text fades over the first 0.55 of the spring (about 100 ms) and its glass over 0.7 (about 140 ms); the rows it covered come back as the exact inverse of its text. The header, a tap on the menu behind, Left or Escape go back; a tap outside closes everything.
- **Keyboard and screen readers:** `role="menu"` with `menuitem` / `menuitemcheckbox`. Enter, Space, Down or Up on the button opens and focuses the first or last row; arrows, Home, End, letters (type-ahead), Enter and Space inside; Right opens a sub-menu, Left and Escape go back; Escape and Tab close and return focus to the button. While the menu is open its keys do not reach page shortcuts.
- **Closes** on scroll outside the menu, on resize and on the wheel.
- **Fallback:** without refraction (Safari, Firefox, reduced transparency) the panel is frosted glass, with the same gestures and springs. With reduced motion the menu fades in and out.
- **Mouse:** on `pointer: fine` rows are 36 px with 15 px text instead of 44 px and 17 px.
- **`size: 'compact'`:** a smaller menu for dense screens: 200 px wide, radius 22, rows of 36 px with 15 px text (second lines 12 px), 20 px icons, 6 px insets, separators with 4 px above and below. The iOS metrics stay the default.
- **Cost:** one group with one member while the menu is open, plus one per open sub-menu card. Per frame the script only writes two clip paths and a transform; the filter is never touched during motion.

### `motion: 'grow'`: the menu grows from under its button

`LiquidUI.menu(btn, { motion: 'grow', gap: 6 })` swaps the iOS morph for the entrance of a native Android pull-down menu, measured frame by frame from a 60 fps screen capture (6 opens and 6 closes, identical; every curve below fits the frames within 0.1 % of scale, 2 px of position on a 1000 px wide menu and 0.02 of opacity). Everything else (items, gestures, highlight, sub-menu cards, keyboard) is the same.

- **Placement.** Under the button with a 6 px gap (`gap`), above it when there is no room below. The menu's outer edge is in line with the button's outer edge: a button on the right half of the screen aligns right edges, on the left half left edges. The button stays visible; give it `press: 'shrink'`.
- **Open.** The whole panel scales up, its text, corners and edge with it, from a point at the button's bottom edge under its outer side. Scale goes from 0 on a spring of 0.8 / 0.405 s (Compose: 0.8, 241): 0.31 at 67 ms, 0.53 at 100 ms, 0.70 at 133 ms, 0.83 at 167 ms, 0.92 at 200 ms, 1.0 at 267 ms, +1.6 % at about 340 ms, at rest by 600 ms. The centre travels on its own springs, vertically faster (0.94 / 0.22 s) than sideways (0.82 / 0.34 s), so the menu drops under the button first and then spreads toward the free side; for the first 100 ms its outer edge stays about 4 % of the width inside its final place.
- **Opacity.** The glass fades in critically damped over 0.27 s starting 12 ms after the scale (0.36 at 67 ms, 0.61 at 100 ms, 0.92 at 200 ms), the text 38 ms after the scale, so the tiny first frames are never a box of text. The blur is there from the first frame: only the opacity changes, so for the first 150 ms the page shows through sharp and darkened, then only as a blur.
- **Close** is three times faster: scale toward 0 critically damped over 0.22 s, the centre to the button's centre (sideways 0.19 s, up 0.39 s), the glass's opacity follows the scale, the text goes by 0.3 of it, and the menu is removed at 0.15, about 120 ms after the tap.
- **How it is drawn.** As in the morph, the glass is drawn once at full size and is only clipped while the rect lies inside it (a phone WebView redraws a clip every frame). Only the 1.6 % overshoot and the last few px of the centre's spring move the glass layer itself, by a transform; a stale picture of frosted glass shifted by 4 px looks the same. The glass draws its own edge only at rest, so a thin CSS edge (`.lgu-menu-rim`) scales with the text and fades out as the panel arrives. The opacities are read off the clock (`performance.now()`), not timers, so the 12 ms and 38 ms delays hold at 60 and 120 Hz.

Group methods the menu relies on, also available for your own groups:

| Method or option | What it does |
|---|---|
| `g.add(el, { radius, tint, live: true })` | a member moved and scaled by your own CSS `transform`; its rest rectangle is read from `offsetLeft` / `offsetTop`, the scale from the transform. `radius` may be a function `(w, h) => r` |
| `g.tune({ veilOpacity, blur, refraction })` | change the material per frame without rebuilding |
| `g.reshape(el)` | redraw a member's field pictures after its layout size changed; returns a promise that resolves once they are decoded and in use |
| `g.ready()` | a promise that resolves when every member's pictures are decoded |
| `observe: false` | no `ResizeObserver` on members (for members you resize yourself) |
| `fadeIn: false` | no fade-in of the layer on creation |

## Adaptive glass: the appearance follows what is behind it

Small glass in iOS 26 (bars, buttons) is light with dark symbols over light content and darkens, with light symbols, over dark content. `LiquidUI.adapt(el, opts)` does this on the web.

```js
const bar = LiquidUI.blob([tabs.panel], { veil: '#FBFCFF', veilOpacity: 0.18 });
LiquidUI.adapt(document.getElementById('tabbar'), {
  base: '#FBFCFF',                                // the page colour where nothing else is (an element with pointer-events: none is not seen)
  apply: (m) => bar.group.tune({ veil: m > 0.5 ? '#111A2E' : '#FBFCFF', veilOpacity: 0.18 + 0.14 * m }),
  onMode: (mode) => tabs.retheme(mode === 'dark' ? '#8FB2FF' : '#1F3FBF'),
});
```

```css
#tabbar .lgu-tabs { color: color-mix(in srgb, #EEF2FC calc(var(--lg-dark, 0) * 100%), #20253A); }
```

- **How it sees the backdrop.** A page cannot read its own pixels, so the colour behind the element is estimated: at a grid of points (`grid: [3, 2]`, `inset: 4`) the stack of elements under the point (`document.elementsFromPoint`) is composited front to back from background colours, SVG fills and strokes and a fifth of the text colour; the element itself, glass layers, the menu and `[data-lg-ignore]` are skipped. Images, canvases and gradients are not read, so a photo behind the glass counts as its container's background colour.
- **Switching.** Relative luminance below `dark` (0.28) makes the glass dark, above `light` (0.4) light, in between it keeps its state (no flicker at the threshold). `m` runs from 0 (light) to 1 (dark) on a spring (1, 0.35 s); the element gets `--lg-dark: m` for CSS, `apply(m)` runs every frame of the change, `onMode(mode)` once per switch.
- **When.** On scroll, resize and every 700 ms, at most every 120 ms; `LiquidUI.adaptNow()` after a screen change. `LiquidUI.backdropColor(rect, self, opts)` returns the estimate itself.
- **What to change.** A plain button: a dark surface over dark content (`glass.set({ surface: rgb(10 14 30 / 0.22 m) })`) and its text colour by `--lg-dark`. A bar: the group's veil colour and density (`group.tune({ veil, veilOpacity })`) and its labels. Tinted glass (the primary action) keeps its tint, as in iOS.

## Startup without a half-built screen

At startup every glass element is built at once, and while the maps are computed the screen stays empty. Wrap the first render in `LiquidGlass.hold()` and `LiquidGlass.release()`: in between, `attach` and groups only queue the work, the screen with text paints at once, glass is built a frame later and group layers fade in over 0.22 s. Call `release()` after fonts are ready, otherwise the build takes the main thread and text appears after the shapes:

```js
LiquidGlass.hold();
buildUi();                       // attach glass, create components, render the first screen
let done = false;
const go = () => { if (done) return; done = true; document.body.classList.remove('boot'); requestAnimationFrame(() => setTimeout(() => LiquidGlass.release(), 0)); };
document.fonts.ready.then(go); setTimeout(go, 500);
```

Better than `body.boot { visibility: hidden }` is a splash: an opaque layer with a drawing right in the markup (no scripts or fonts, visible from the first frame) that goes away when everything, glass included, is ready, so the UI never appears piece by piece.

- While loading keep the splash drawing still. In those fractions of a second the phone starts the WebView, rasterizes the page and builds the glass, and even GPU animations stutter.
- Animate the drawing once the app and the glass are ready and long tasks are over, using only `transform` and `opacity`. A line can be "drawn" with a soft-edged window (`mask-image`) sliding right while the line inside slides left by the same amount and so stays in place. `stroke-dashoffset` is driven by the main thread and stutters.
- Leave like dispersing mist: the drawing blurs (`filter: blur`), grows and fades, the layer gets `backdrop-filter: blur(20px)` and over about 0.9 s goes transparent while its blur goes to 0; the screen under it grows from `scale(.965)`. Turn the backdrop blur on with a class only for the exit: during loading it is wasted work. Leave about 0.15 s between the end of the drawing and the exit.
- Font preload through `<link rel="preload" crossorigin>` from a `file://` page (WebView assets) does not work: CORS blocks it.

## Android WebView specifics

- Set the WebView background to the page colour (light and dark) so no coloured flash shows before the first paint.
- Disable scrollbars if the design hides them (`setVerticalScrollBarEnabled(false)` and CSS `scrollbar-width: none`, `::-webkit-scrollbar { display: none }`).
- Long press and haptics off, as above.
- The display refresh rate of a WebView app is set by the window's `preferredDisplayModeId` (and `setRequestedFrameRate` on Android 15), otherwise the system may hold 60 Hz.
