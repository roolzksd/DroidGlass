# When it looks wrong (web engine)

| Symptom | Fix |
|---|---|
| Matte, milky | `blur` 0 to 2, remove `surface`, make sure the element has no `background` of its own |
| Glass is invisible | the backdrop under it is flat: add colour or a photo; raise `refractionAmount` |
| Glass invisible although the page is colourful | the colour is on `body` and propagates to the root; `backdrop-filter` does not see it. Move it into its own element |
| Coloured holes or bands on the rim | an old copy of the code without sample clamping; take the files from `assets/` |
| Rainbow hurts the eyes | `dispersion: 0` on large elements; only thumbs and the magnifier need it |
| Rim "tears" in the corners | `refractionHeight` larger than the radius; for a capsule no more than half the height |
| Text on glass unreadable | `blur` 8 to 16 and `surface` 40 to 60%, or a dim layer under the glass |
| Stair steps on the rim | `resolution: 2` |
| Scrolling or pressing stutters | count the expanded filter tree (`performance.md`): a heavy step under a result read by several steps; then fewer glass elements, `sleep` for invisible ones |
| Element is a hole in Safari | someone set `backdrop-filter: url()` without checking the engine; use `attach` |
| Slider or toggle freezes when the mouse leaves it, or the thumb lags behind the cursor after hitting an end | an old `gesture()` that relied only on pointer capture and added up deltas; the current one also listens on `window` and maps from the press point |
| Thumb ignores the finger | the container lacks `touch-action: none`, or an overlapping element sits on top |
| Dirty rainbow smears above and below the drop, stretched letters at its edges | the lens samples inward; it needs `overscan` (already set in `tabs`) |
| Drop at the screen edge is black or shows a foreign piece of backdrop | an element with `backdrop-filter` enlarged by transform crossed the screen edge; use `overscan`, the engine clips the layer itself |
| A pulled button, merge group or drop shows a straight cut edge or a thin coloured line | it left the box of its `position: fixed` container; give the container transparent padding on that side and anchor it to the screen edge (`web.md`) |
| Mirrored pieces of the bar inside the drop above the bar | the bar is in a `position: fixed` container and the lens left its bounds; transparent `padding-top` on the container |
| Muddy grey mix inside the drop instead of the item | the drop lies directly on the panel; it needs a row copy and a window in the panel, as in `tabs` |
| On a phone the button does not stretch and releases at once | the browser took the scroll gesture: check `touch-action`, call `LiquidUI.refreshTouch()` after screen changes |
| Glass shapes stick together on a simple press | the resting gap is below 2.2 · `merge` once press growth is counted: widen the gap, lower `merge` or `pressGrow` |
| A light seam or a double rim where merged shapes meet | a member is not ghosted and its own glass draws over the group; wire it with `LiquidUI.blob` |
| Group is empty or has no shape | the mask was passed as `feImage href="#id"`; only `data:` URLs work inside `backdrop-filter` |
| Glass buttons darken or flicker while a screen enters | an ancestor of the glass has `opacity` below 1 during the animation (or `filter`, `mask`, `clip-path`): such an ancestor cuts the glass off its backdrop. Move the screen with `transform` and reveal it with a veil on top |
| After a transition the group glass drifted away from its buttons | the group container is not positioned and an ancestor had a `transform` during the animation; the engine sets `position: relative` itself, in an old copy set it by hand |
| On a white page the glass looks like a flat white pill | the white highlight has nothing to shine on: `depth: 1` on single glass, `shade` on a group |
| Merged buttons or drops vanish in Safari or Firefox | an old engine ghosted the members and drew them with an SVG filter those browsers ignore; the current `group` and `blob` fall back to per-member frosted glass |
| A list of sliders or toggles cannot be scrolled on a phone | their `touch-action: none` takes every gesture; in a scrolling list set `touch-action: pan-y` on them, horizontal drags still work |
| Bar labels get lost over bright spots | a page-coloured `veil`, 0.2 to 0.25; the glass stays transparent |
| Glass looks tinted or dirty on a light page | an extra `surface` or tint; the glass is colourless and the backdrop gives the colour, only the primary action is tinted |
| A button pulled far away and released still fires | the click was not swallowed: pointer capture delivers it to the element even far from it |
| Long press opens a menu or text selection in a WebView | `setOnLongClickListener(v -> true)`, `setHapticFeedbackEnabled(false)`, `contextmenu` prevented on the element |
| UI appears piece by piece at startup | `LiquidGlass.hold()` / `release()` and a splash (`web.md`, Startup) |
| A menu flashes without glass for a frame as it opens | the button's glass was hidden before the group's pictures were decoded; hide it after `group.ready()` and one frame, as `menu` does |
| A round lens shows inside the open menu | the capsule in the button's place stays in the group; shrink it to scale 0 as the panel grows |
| A sub-menu is cut off or the menu behind it grows | an old copy; a sub-menu is now its own glass card in front of the menu, sized by its own content |
| The highlight vanishes as soon as a finger slides inside an open menu, and the lift picks nothing | the browser took the touch for a scroll (`pointercancel`): the menu body is a scroll container, so `touch-action: none` must be on every part of the menu, not only the panel |
| The first frames of the menu look like a small box | grow the panel inside a round drop that is concentric with it (`menu` does), not on its own |
| A sub-menu shows as an empty frosted card for a moment | its rows must arrive with the material and lead it; never fade the content in after the glass |
| The menu opens when the user only wanted to scroll | open on a hold of 150 ms (300 ms in a scrolling view) and cancel when the finger moves more than 13 px before that |
| Typing in an open menu triggers page shortcuts | an old copy; the menu now stops its key events from reaching the page |
| The menu jumps or picks the wrong row right after it opens | taps during the entrance must be ignored and a held finger must travel 10 px before it picks |
| The menu's glass is a flat grey (light theme) or flat dark, nothing of the page shows through | an element with `mix-blend-mode` (the finger glow) inside a panel without its own stacking context isolates the whole overlay, which becomes a backdrop root, so the glass under it samples black; give the panel `isolation: isolate` |
| The menu behind a sub-menu shows through the card as a band | the card's material must be denser than the menu's (more blur and veil) so the menu behind melts into a soft tint; do not cut the menu behind |
| A scaled menu (`motion: 'grow'`) shows its glass clear or stuck at the first frame on a phone | do not scale or move the glass during the growth: draw it once at full size, clip it to the growing rect and scale only the content; move the glass layer only for the last few px (the overshoot) |
| After going back from a sub-menu its place in the menu is empty, bare tinted glass, for a moment | the rows the card covered must come back as the exact inverse of the card's text (a cross-fade), not when the card's spring settles |
| After going back from a sub-menu the menu's top row lights up for a moment | the highlight pill is drawn on the level in front; fading it out after the card closes draws it on the menu, at the card's header position. Snap the pill and the glow off when the card closes |
| A clipped growing menu has no edge until it arrives | the glass draws its rim only at its own outline; scale a thin CSS edge with the content and fade it out as the panel arrives |
