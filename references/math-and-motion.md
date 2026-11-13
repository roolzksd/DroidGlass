# Anatomy, math, springs and gestures

Shared by every platform. These are the formulas from the Backdrop shader; the web engine uses them too. Useful for Flutter, Metal, WebGL or any custom renderer.

## Anatomy of the effect

| Layer | What it gives | Android (Backdrop) | Web (this skill) |
|---|---|---|---|
| Lens | backdrop pulled toward the centre at the rim | `lens(refractionHeight, refractionAmount)` | `feDisplacementMap` over a map |
| Depth | glass looks thicker, pulls toward the centre too | `lens(..., depthEffect = true)` | `depthEffect: true` |
| Dispersion | soft rainbow, stronger in corners | `lens(..., chromaticAberration = true)` | `dispersion: 0..1` |
| Colour | backdrop under glass is richer | `vibrancy()`, `colorControls()` | `saturation`, `brightness`, `contrast` |
| Blur | softness for text | `blur(r)` | `blur: r` (same radius) |
| Surface and tint | density, primary action | `onDrawSurface`, tint via `BlendMode.Hue` + 75% | `surface`, `tint` |
| Highlight | hairline rim, brighter along the light axis | `Highlight.Default / Ambient / Plain` | canvas over the element |
| Shadows | lift and volume | `Shadow`, `InnerShadow` | `box-shadow`, `inset` |
| Touch | glow under the finger | `InteractiveHighlight` | `::before` with `plus-lighter` |

## Math

- **Distance to the edge** of a rounded rectangle: `sd = length(max(q, 0)) + min(max(q.x, q.y), 0) - r`, where `q = abs(p) - (half - r)`. Depth inside: `depth = -sd`.
- **Normal** is taken at radius `min(r × 1.5, half)`, not the real one: it turns more smoothly in corners, so the highlight and refraction do not break.
- **Lens profile:** if `depth < h`, offset `d = (1 - sqrt(1 - x²)) × amount`, where `x = 1 - depth / h`. Maximum right at the rim, zero at depth `h`. Kyant samples at `p + d × normal`, that is **outside** the rim: the lens edge shows the backdrop beyond its border squeezed toward the rim (`coord + d * grad` in `Shaders.kt`). The web engine samples `p − d × normal` (inward) by default, because `backdrop-filter` cannot see beyond its own rectangle; with the `overscan` option it samples outside, like Kyant.
- **depthEffect:** `normalize(p)` is added to the normal and the result is normalized again.
- **Dispersion:** strength `I = (p.x × p.y) / (half.x × half.y)`, offset `d × normal × I`. Seven samples with offsets +1, +2/3, +1/3, 0, −1/3, −2/3, −1 and weights: R 2/7 for the first three and 1/7 for the last, G 1/7 for the second and 2/7 for the third, fourth and fifth, B 1/3 for the last three. The web engine collapses this into one sample per channel with multiplier `1 + k·I`, k = 3/7, 2/21, −2/3 (the average contribution of the seven samples to each channel).
- **Highlight:** intensity `pow(abs(dot(normal, (cos a, sin a))), falloff)` along a 0.5 dp stroke with 0.25 dp blur. Default: white 50%, additive (Plus), angle 45°. Ambient: white where the dot product is positive, black on the opposite side, 38%, normal blend. Plain: even stroke 38%, additive.
- **Shadows:** outer radius 24 dp, offset down by radius/6, black 10%. Inner radius 24 dp, offset down by the radius, black 15%.
- **Touch glow:** +8% white over the whole area and a spot `smoothstep(R, R/2, dist)` of white 15%, where `R = 1.5 × short side`; both layers additive, multiplied by press progress.
- **Merging (Liquid Glass Studio scheme, used by `LiquidGlass.group`):** each shape contributes a field `α = 1 / (1 + e^(sd / merge))`; fields are summed and cut at 0.5, which is a smooth union. Two shapes join when the gap is below `2 · merge · ln 3 ≈ 2.2 · merge`. The closer they are, the thicker the bridge; there is no separate "merge strength".

## Springs

All springs in Compose format `spring(dampingRatio, stiffness)`, mass 1. An exact solution of the spring equation per frame is stable at any frame rate.

| What | Spring | Notes |
|---|---|---|
| Thumb, slider, tab value | 1, 1000 | the thumb follows the finger through a spring, not the exact value |
| Value velocity | 0.5, 300 | the thumb stretches by it |
| Thumb press progress | 1, 1000 | |
| Thumb scale X / Y | 0.6, 250 / 0.7, 250 | different stiffness per axis gives the jelly |
| Button press and glow position | 0.5, 300 | overshoots, so the button springs |
| Tab bar panel return | 1, 300 | |
| Drop at speed | `scaleX /= 1 − clamp(v × 0.75, ±0.2)`, `scaleY *= 1 − clamp(v × 0.25, ±0.2)` | `v` = velocity / 50 for the toggle, / 10 for slider and tabs |
| Release | press is released only when the value is within 2.5% of the range from the target | the drop arrives inflated and only then deflates |
| Overscroll pull | `(1 − e^(−abs p)) × sign p` | for sheets and control tiles |
| Press | fires on touch down, no movement threshold | |
| Button following the finger (web) | UIScrollView rubber band `f(x) = (1 − 1/(x·0.55/d + 1))·d`, `d` = 1.6 × short side, 56 to 110 px | the button moves 0.8·r·f and elongates 0.6·r·f along the pull (softly capped at 0.22 of its size so text does not blur), getting 0.3 of that thinner across. `r` = `reach` = 0.36: the share of the pull that reaches the button. Shorten the pull with `reach`, not `d`: the rubber band is nonlinear and a smaller `d` barely changes a short pull |
| Button and bar bounce after release (web) | 0.5, 170 | with the finger's velocity, about 15% overshoot, settles in about 0.6 s; a stiff spring (300) on a large stretch looks like a snap with no animation |
| Bar pulled past the edge tab (web) | same rubber band, `d` = 24 px | the panel moves 0.7 of the pull, elongates 0.6, the drop follows past the edge |

### Menus (web, `LiquidUI.menu`)

Measured from UIKit on the iOS 26.2 simulator by the astryx project (MIT). UIKit gives springs as damping ratio and response; in Compose terms stiffness = (2π / response)².

| What | Spring or value | Compose |
|---|---|---|
| Menu opens out of its button | 0.8, response 0.32 s | 0.8, 386 |
| Menu closes | 0.85, response 0.35 s | 0.85, 322 |
| Sub-menu opens in place | 0.85, response 0.4 s | 0.85, 247 |
| Back out of a sub-menu | 1, response 0.4 s | 1, 247 |
| Highlight pill slides to the row under the finger | SwiftUI `interactiveSpring()`: 0.86, response 0.15 s | 0.86, 1755 |
| The menu behind a sub-menu | recedes to 0.971, its rows dim 1 → 0.5 on the sub-menu spring | |
| Hold before the menu opens under a finger | 150 ms; about 300 ms inside a scrolling view | |
| Drift allowed during the hold | 13 px (UIKit opened at 12 pt, not at 14) | |
| Travel before a held finger starts picking | 10 px | |

The 0.971 recede is from native iOS captures (416 → 404 px) published by liquid_glass_widgets (MIT); the 0.5 dim is astryx's measurement. Not measured anywhere and chosen by eye: the round drop the menu pops out of (it rests at the panel's smaller side minus 16 px and melts into the panel between 0.8 and 1 of the growth), the 20 px rubber band toward a finger held outside, and the highlight fade (1, 1500).

In the original the velocity in the drop formula keeps its sign, so moving left squeezes the thumb. The web code uses the absolute velocity, so the drop stretches the same both ways. On Android keep Kyant's behaviour or change it the same way if the user notices.

## Stretchy glass like `.interactive()` in iOS 26

Apple's interactive glass (`.glassEffect(.regular.interactive())`) stretches toward the finger when it moves away from the button and springs back. Kyant only does a slight offset (5% of the travel), so on the web this is DroidGlass's own behaviour in `LiquidUI.button` (`stretch: true` by default):

- The finger offset goes through the rubber band above: the further, the stiffer; the button never goes beyond `d`. The button follows the finger and elongates toward it while the far edge almost stays.
- Release: spring 0.5, 170 with the finger's velocity; the overshoot is visible.
- The button stays stretched until the finger lifts; it never tears away or flies off by itself, like iOS 26 glass. Released more than 12 px outside the button: no click. This needs explicit handling: with pointer capture the browser delivers the click to the element even when the finger is far away.
- The button never leaves the screen (Chrome paints enlarged glass at the screen edge black).
- Tab bar: the gesture covers the whole bar, as in iOS 26. Pressing another tab moves the drop under the finger, then it can be dragged; past the edge tab the panel stretches on the rubber band and bounces.
