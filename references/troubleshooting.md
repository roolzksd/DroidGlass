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
| Thumb ignores the finger | the container lacks `touch-action: none`, or an overlapping element sits on top |
| Dirty rainbow smears above and below the drop, stretched letters at its edges | the lens samples inward; it needs `overscan` (already set in `tabs`) |
| Drop at the screen edge is black or shows a foreign piece of backdrop | an element with `backdrop-filter` enlarged by transform crossed the screen edge; use `overscan`, the engine clips the layer itself |
| Mirrored pieces of the bar inside the drop above the bar | the bar is in a `position: fixed` container and the lens left its bounds; transparent `padding-top` on the container |
| Muddy grey mix inside the drop instead of the item | the drop lies directly on the panel; it needs a row copy and a window in the panel, as in `tabs` |
| On a phone the button does not stretch and releases at once | the browser took the scroll gesture: check `touch-action`, call `LiquidUI.refreshTouch()` after screen changes |
| Glass shapes stick together on a simple press | the resting gap is below 2.2 · `merge` once press growth is counted: widen the gap, lower `merge` or `pressGrow` |
| A light seam or a double rim where merged shapes meet | a member is not ghosted and its own glass draws over the group; wire it with `LiquidUI.blob` |
| Group is empty or has no shape | the mask was passed as `feImage href="#id"`; only `data:` URLs work inside `backdrop-filter` |
| Glass buttons darken or flicker while a screen enters | an ancestor of the glass has `opacity` below 1 during the animation (or `filter`, `mask`, `clip-path`): such an ancestor cuts the glass off its backdrop. Move the screen with `transform` and reveal it with a veil on top |
| After a transition the group glass drifted away from its buttons | the group container is not positioned and an ancestor had a `transform` during the animation; the engine sets `position: relative` itself, in an old copy set it by hand |
| On a white page the glass looks like a flat white pill | the white highlight has nothing to shine on: `depth: 1` on single glass, `shade` on a group |
| Bar labels get lost over bright spots | a page-coloured `veil`, 0.2 to 0.25; the glass stays transparent |
| Glass looks tinted or dirty on a light page | an extra `surface` or tint; the glass is colourless and the backdrop gives the colour, only the primary action is tinted |
| A button pulled far away and released still fires | the click was not swallowed: pointer capture delivers it to the element even far from it |
| Long press opens a menu or text selection in a WebView | `setOnLongClickListener(v -> true)`, `setHapticFeedbackEnabled(false)`, `contextmenu` prevented on the element |
| UI appears piece by piece at startup | `LiquidGlass.hold()` / `release()` and a splash (`web.md`, Startup) |
