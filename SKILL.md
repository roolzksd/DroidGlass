---
name: droidglass
description: Builds Apple-style Liquid Glass UI (iOS 26 / macOS 26 look) on any platform. Web, Android WebView, Electron, Capacitor and Cordova get a ready, tested engine with real refraction, specular rims, merging drops and iOS-like stretchy buttons, toggles, sliders, tab bars and pull-down menus that grow out of their button. Jetpack Compose uses Kyant's Backdrop library; SwiftUI, UIKit and AppKit use the system glassEffect. Use whenever the user asks for liquid glass, Apple or iOS 26 glass, glassmorphism, frosted glass, a glass tab bar, glass buttons, toggles, sliders, menus or dropdowns, or "make it look like Apple", even if the words Liquid Glass are not used.
license: Apache-2.0
---

# DroidGlass: Liquid Glass for any platform

Liquid Glass is Apple's material that **refracts** what is under it. Near the rim the backdrop is pulled toward the centre like a thick lens, a soft rainbow shows at the edge, a hairline highlight runs along the rim, and on touch the glass swells, stretches toward the finger and springs back. Ordinary glassmorphism only blurs the background under a white haze, which is why it looks cheap and matte.

The main rule of taste: **the glass is transparent.** If you cannot read what lies behind it, it is iOS 7 frosted glass, not Liquid Glass. Add blur and a surface only where text sits on the glass.

Tell the user honestly where the limits are. The real material exists only on iOS, iPadOS and macOS 26 and later; everything else is an imitation. On Android, Backdrop gives the full imitation (the lens needs Android 13). On the web, refraction works only in Chromium (Chrome, Edge, Samsung Internet, Android WebView, Electron). Safari, Firefox and every browser on iOS get a light blur with the same highlights, shadows and springs, but no bending.

## Workflow

1. **Identify the platform.**
   - SwiftUI, UIKit, AppKit, WidgetKit on iOS/macOS 26: system API, see `references/apple.md`. Do not imitate anything.
   - Jetpack Compose or Compose Multiplatform: `references/android-compose.md`. Do not write shaders from scratch, use the library.
   - Web, Electron, Android WebView, Capacitor, Cordova, Tauri on Windows/Android: the engine in `assets/`, see `references/web.md`. In WebView and Electron refraction always works.
   - React Native, Flutter: no system equivalent. For React Native suggest a WebView layer or a native module on Backdrop; for Flutter, `BackdropFilter` as a fallback and a `FragmentProgram` with the formulas from `references/math-and-motion.md`. Check current packages yourself, this skill does not list them.
2. **Pick 1 to 3 elements of the control layer:** tab bar, floating button, top bar, sheet, menu, toggle or slider thumb while touched. Do not make content glass.
3. **Pick a recipe** from the table below. Do not invent parameters: the values come from Kyant's catalog and were checked on screen.
4. **Check the backdrop under the glass.** Glass is only visible over rich content: photos, colour, charts, text while scrolling. Over a plain white page transparent glass almost disappears: put colour behind it, add a dim layer, or drop the glass there.
5. **Build** it from the right reference and **check it with your own eyes** using the checklist at the end. Do not hand it over without screenshots of rest, press and drag.

## Apple's rules

From the Human Interface Guidelines, WWDC25 "Meet Liquid Glass" and popular community skills. Breaking any of them gives the fake away at once.

- **Only the navigation and control layer** that floats above content. Lists, rows, cards and the page background are not glass. Exception: toggle and slider thumbs become glass while touched.
- **No glass on glass.** Elements on top of glass are set apart by fill and opacity. Exception from Backdrop: a slider thumb on a glass sheet refracts the sheet (`exportedBackdrop`): one lens over another, not two matte plates.
- **Use little of it.** Only the most important controls.
- **The glass is colourless.** Colour and brightness come from the backdrop: light over light, dark over dark, the highlight is tinted by the backdrop. No white or grey surface of its own.
- **Two modes, do not mix them.** Clear (buttons, thumbs, magnifier, a tab bar grouped with a button): blur 0 to 4, no surface. Regular (sheet, dialog with long text): blur 8 to 16; add a 40 to 60% surface only if the text is unreadable without it.
- **Tint only the primary action.**
- **Shape.** Capsule: radius equals half the height. Concentric corners: inner radius equals container radius minus padding.
- **Bigger means thicker:** large elements get a wider curved rim and deeper refraction.
- **Never leave content resting half under glass.**
- **Liquid in motion.** On press the glass grows a few pixels and leans toward the finger with damping; a thumb inflates 1.5x and stretches into a drop at speed. Everything runs on springs, no linear transitions.

## Recipes (values from Kyant's catalog)

| Element | Effects | Highlight and shadows | Touch |
|---|---|---|---|
| Button, 48 dp capsule | vibrancy, blur 2, lens(12, 24) | Default, default shadow | glow; grows 4 dp in height; offset `min × tanh(0.05 × offset / min)`; stretches up to 4 dp toward the finger |
| Tinted button | same + tint | same | same |
| Button with surface | same + white 30% | same | same |
| Toggle thumb 40×24 on a 64×28 track | at rest white 100% and blur 8; pressed p: blur 8(1−p), lens(5p, 10p, dispersion), white (1−p) | Ambient, width /1.5, alpha p; shadow radius 4, 5%; inner shadow radius 4p, alpha p | scales to 1.5; the track shows through the lens, shrunk to 0.75 |
| Slider thumb 40×24, 6 dp track | like the toggle, lens(10p, 14p) | like the toggle | scales to 1.5; tapping the track jumps to the point |
| Tab bar 64 dp | vibrancy, blur 8, lens(24, 24), surface #FAFAFA 40% (dark #121212 40%) | Default | on press the whole panel grows 16 dp in width (labels with it) and leans up to 4 dp after the finger |
| Hidden row copy 56 dp (`tabsBackdrop`) | the same panel in the accent colour, `alpha(0)`: vibrancy, blur 8, lens(24p, 24p), panel surface | Default with alpha p, InteractiveHighlight | icons and labels ×1.2 on press (`LocalLiquidBottomTabScale` is set only on this row) |
| Tab bar thumb 56 dp | at rest grey 10%; pressed lens(10p, 14p, dispersion) over the backdrop **and** the row copy (`rememberCombinedBackdrop(backdrop, tabsBackdrop)`) | Default, shadow and inner shadow 8p with alpha p | scales 78/56; inside the drop a "bar under the bar": its own item in accent, magnified, neighbours visible at the rims |
| Dialog, radius 48 | brightness 0.2 (light), saturation 1.5, blur 16 (dark 8), lens(24, 48, depth) | Plain | dims the backdrop #29293A 23% (dark #121212 56%) |
| Control centre tile | vibrancy, lens(24, 48, depth) | Default, angle from device tilt, falloff 2 | enter: 48 dp offset and alpha |
| Magnifier 128×96 | lens(8, 24, depth, dispersion), backdrop zoomed 1.5x | inner shadow 16 | drag |
| Menu (web, `LiquidUI.menu`)* | merge group: blur 9, refraction 34, rim 16, saturation 1.7, page-coloured veil 64% (dark 58%) | glare 0.7, specular line 0.8, rim shading; shadow 0 16 44 at 16% | grows out of its button on spring 0.8 / 0.32 s, closes on 0.85 / 0.35 s; hold 150 ms and slide to pick |

\* Not from Kyant: the springs and gesture thresholds are measured from UIKit on iOS 26.2 (astryx), the material is matched to iOS screenshots by eye.

Springs, gestures and the shared math behind every platform are in `references/math-and-motion.md`.

## Web and Android WebView in one minute

Copy the three files from `assets/` into the project unchanged and configure them with options. Do not rewrite the engine.

```html
<link rel="stylesheet" href="liquid-glass.css">
<button id="buy">Buy</button>
<div id="wifi" aria-label="Wi-Fi"></div>
<div id="volume" style="width: 280px"></div>
<nav id="tabs" style="position: fixed; left: 16px; right: 16px; bottom: 16px"></nav>
<script src="liquid-glass.js"></script>
<script src="liquid-ui.js"></script>
<script>
  LiquidUI.button(document.getElementById('buy'), { tint: '#0088FF', onClick: () => {} });
  LiquidUI.toggle(document.getElementById('wifi'), { checked: true, onChange: (on) => {} });
  LiquidUI.slider(document.getElementById('volume'), { value: 0.4, onInput: (v) => {}, label: 'Volume' });
  const tabs = LiquidUI.tabs(document.getElementById('tabs'), {
    items: [{ label: 'Home', icon: '<svg>…</svg>' }, { label: 'Search', icon: '<svg>…</svg>' }],
    index: 0, onChange: (i) => {},
  });
  // a menu that grows out of its button; items may be a function called on every open
  LiquidUI.menu(document.getElementById('more'), {
    layout: 'medium', // first 3 items as a row of icons with labels
    items: [{ label: 'Copy', icon: '<svg>…</svg>' }, { label: 'Share', icon: '<svg>…</svg>' }, { label: 'Pin', icon: '<svg>…</svg>' }, '-',
      { label: 'Sort By', submenu: [{ label: 'Name', checked: true }, { label: 'Date', checked: false }] },
      { label: 'Delete', role: 'destructive', onSelect: () => {} }],
  });
  // merging: a bar and a button next to it melt into one drop; neighbouring stretchy buttons do it by themselves
  // LiquidUI.blob([tabs.panel, fab], { blur: 3.5 }); LiquidUI.autoMerge(document.body); after a screen change LiquidUI.sweep()
  // bare glass for your own markup
  const g = LiquidGlass.attach(document.getElementById('panel'), { radius: 28, blur: 8, refractionHeight: 24, refractionAmount: 24, surface: 'rgb(250 250 250 / .4)' });
  // g.set({ lens: 0..1, blur, surface, highlightAlpha, angle, shadowAlpha, innerShadow, press: { p, x, y }, tx, ty, sx, sy, sleep })
</script>
```

| File | What it is |
|---|---|
| `assets/liquid-glass.js` | glass engine: refraction maps, dispersion, highlight, shadows, merging groups (`LiquidGlass`) |
| `assets/liquid-glass.css` | base styles, accessibility fallbacks, component styles |
| `assets/liquid-ui.js` | springs, gestures and components: button, toggle, slider, tabs, magnifier, menu, blob, autoMerge (`LiquidUI`) |
| `assets/demo.html` | every component on one page; open it to see what correct looks like |

Before you change anything or wire it into an app, read `references/web.md`: it lists the Chromium facts that break almost every implementation (backdrop roots, `position: fixed`, `touch-action`, body backgrounds) and every option. When something looks wrong, go to `references/troubleshooting.md`; when anything stutters, `references/performance.md`.

Five things to never get wrong on the web:

- The backdrop must be a real element. A background set on `body` that propagates to the root is not seen by `backdrop-filter`.
- Never animate `opacity`, `filter`, `mask` or `clip-path` on an ancestor of the glass (a screen fade-in, for example): it becomes a backdrop root and the glass loses its backdrop and darkens. Move screens with `transform` and reveal them with a veil layer on top.
- Do not set your own `transform` on a glass element; write the base offset into `--lg-base`.
- Stretchy buttons need `touch-action: none` (the default). With `pan-y` the browser steals the drag and sends `pointercancel`.
- In an Android WebView disable long press and haptics: `setOnLongClickListener(v -> true)` and `setHapticFeedbackEnabled(false)`.

## Accessibility and legibility

- The web engine honours `prefers-reduced-transparency: reduce` (glass off, nearly opaque surface; Chrome and Edge 119+, not yet Safari or Firefox), `prefers-contrast: more` (solid surface and border) and `prefers-reduced-motion` (springs become instant).
- Components get roles and keyboard support: button (Enter, Space), `switch` (Enter, Space), `slider` (arrows), `tablist` (left and right arrows), `menu` (Enter, Space or arrows on the button; arrows, Home, End, type-ahead, Right and Left for sub-menus, Escape inside). Label them with `aria-label` or `aria-labelledby`.
- On Android set `semantics { role = Role.Switch }` and labels, as in Kyant's catalog; on old Android check that the `onDrawSurface` colour is readable without effects.
- Check text contrast over the **lightest and busiest** content that can end up under the panel: 4.5:1 for body text. If it fails, add blur and a surface or move the content. A text shadow does not fix it.

## Do not

- A white translucent surface plus `blur(10px)` on buttons: that is frosted glass, not Liquid Glass. Density is fine only for tab bars, sheets and dialogs with text.
- Glass content cards and a glass page background.
- Dispersion on large panels: expensive and garish.
- A thick white border instead of a hairline highlight.
- The same tint on every button.
- Linear `transition`s instead of springs for press and drag.
- Animating `width` and `height` of glass on the web: the map is rebuilt every frame. Animate scale.
- Heavy filter steps (blur, displacement, convolution, morphology) under a result that several steps read: Chrome computes them once per branch and phones freeze.
- Painting the glass with your own surface "for looks". Only dense panels with text get a surface.
- Writing your own Compose shaders when Backdrop fits.
- SF Symbols and Apple logos outside Apple platforms: their licence forbids it. Use open icon sets.
- Calling the web or Android result "official Liquid Glass". It is an imitation in its style.

## Checklist before handing over

Screenshots at scale 2, look at them yourself:

1. **Rest over a grid or text:** lines are visible through the transparent glass, pulled toward the centre at the rim, the highlight is thin. On white the glass is separated from the page by rim shading and shadow; on dark by a bright line on the lit side.
2. **Press:** the button grew and leans toward the finger; a thumb is inflated and transparent, the track shows through it, the rainbow is soft, no coloured holes.
3. **Drag:** a thumb stretches at speed and deflates only after it arrives; the tab bar leans and returns. The tab bar drop on edge tabs and near the bottom edge of the screen: its own item inside, neighbours at the rims, no black areas, bands or mirrored pieces.
4. **Pull:** a button follows the finger on a rubber band and bounces back; a bar pulled toward a neighbouring button melts into it, the bridge grows as they approach, no seam or double rim; at rest and on a simple press they stay apart; a normal tap works, a button pulled far away and released does not fire.
5. **Over a photo and over white:** colour under the glass is rich, text is readable.
6. **Dark theme.**
7. **Fallback:** fake the engine (Safari user agent and empty `navigator.userAgentData`) and check that elements did not turn into holes and icons under the tab bar thumb are not blurred.
8. **Resize and rotation:** the map is rebuilt, no stair steps on the rim.
9. **Screen transitions:** capture several consecutive frames while a screen enters; glass buttons are never darker than at rest, merge layers stay exactly under their buttons after the animation.
10. **Menu:** frames of the entrance show a drop flowing out of the button, never an empty frame or a lens circle inside the open menu; hold, slide and lift on a row picks it; a sub-menu card grows from its row without being cut off; the menu stays inside the screen from a button in every corner.
11. **No console errors** and no hangs: after a burst of taps the page responds as fast. One animation loop, no stray `requestAnimationFrame`s.
12. No more than 3 large glass elements on a phone screen, no glass on glass, no glass content.

If something fails, fix it first, then show the user.

## Sources

- Kyant0/AndroidLiquidGlass, Backdrop library and catalog (Apache-2.0): lens, dispersion, highlight and shadow formulas, component recipes, spring and gesture constants. The web engine is a port of this scheme.
- Apple: Human Interface Guidelines "Materials", "Adopting Liquid Glass", WWDC25 "Meet Liquid Glass".
- kube.io, "Liquid Glass in the Browser": refraction through `feDisplacementMap` inside `backdrop-filter`.
- iyinchao/liquid-glass-studio (MIT): merging shapes via `smin`, Snell refraction, colourless glass with a highlight taken from the backdrop. `LiquidGlass.group` reproduces this scheme with SVG filters.
- facebook/astryx (MIT): UIKit springs and gesture thresholds for menus, measured on the iOS 26.2 simulator (open 0.8 / 0.32 s, close 0.85 / 0.35 s, sub-menu 0.85 / 0.4 s and 1 / 0.4 s back, hold 150 ms, hand-off 10 px). Apple HIG "Menus", "Pull-down buttons", "Pop-up buttons": layouts, groups, icons and checkmarks.
- liquid-glass-react: near-zero blur, saturation, jelly on touch.
- dev.to, "Liquid Glass on the Web: 6 ways": Safari's false yes from `@supports`.
- Community skills (affaan-m/ECC liquid-glass-design, freekmurze liquid-glass and others): container rules and `.interactive()`, modifier order, UIKit, widgets, iOS accessibility.
