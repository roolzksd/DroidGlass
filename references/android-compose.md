# Android: Backdrop (Kyant0/AndroidLiquidGlass)

A Compose Multiplatform library (Android, iOS, desktop, Wasm), Apache-2.0. The latest version when this skill was written was 2.0.1; check Maven Central before you start.

```kotlin
dependencies {
    implementation("io.github.kyant0:backdrop:2.0.1")
    implementation("io.github.kyant0:shapes:1.2.1") // Capsule(), RoundedRectangle(); plain RoundedCornerShape works too
}
```

Support: the library installs with minSdk 21. `blur`, `vibrancy` and `colorControls` work from Android 12 (API 31), `lens` and shader highlights from Android 13 (API 33). On older versions these effects are silently skipped and only the surface, shadows and a simple highlight remain. So always set `onDrawSurface` to a colour that reads well without effects. `lens` accepts only `RoundedRectangularShape` or `CornerBasedShape`; anything else throws.

The basic scheme: the backdrop is recorded into a layer, and the glass draws that layer with effects. The glass must be a **sibling on top of** the recorded content, not its child.

```kotlin
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.backdrop.highlight.Highlight
import com.kyant.backdrop.shadow.Shadow
import com.kyant.shapes.Capsule

@Composable
fun GlassScreen() {
    val backdrop = rememberLayerBackdrop()
    Box(Modifier.fillMaxSize()) {
        // everything that should be refracted: photo, list, map
        Image(
            painterResource(R.drawable.wallpaper), null,
            Modifier.layerBackdrop(backdrop).fillMaxSize(),
            contentScale = ContentScale.Crop
        )
        Row(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(16.dp)
                .drawBackdrop(
                    backdrop = backdrop,
                    shape = { Capsule() },
                    effects = {
                        vibrancy()
                        blur(2f.dp.toPx())
                        lens(12f.dp.toPx(), 24f.dp.toPx())
                    },
                    highlight = { Highlight.Default },   // Default is the default anyway
                    shadow = { Shadow.Default },
                    onDrawSurface = { drawRect(Color.White.copy(alpha = 0.3f)) }
                )
                .height(48.dp)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) { Text("Button") }
    }
}
```

The rest of the API:

- `drawBackdrop(backdrop, shape, effects, highlight, shadow, innerShadow, layerBlock, exportedBackdrop, onDrawBehind, onDrawBackdrop, onDrawSurface, onDrawFront)`. `drawPlainBackdrop` is the same without highlight and shadows.
- Effects inside `effects { }`: `vibrancy()` (saturation 1.5), `colorControls(brightness, contrast, saturation)`, `opacity(alpha)`, `blur(radius)`, `lens(refractionHeight, refractionAmount, depthEffect, chromaticAberration)`, `runtimeShaderEffect(key, agsl, "content") { setFloatUniform(...) }` for your own shader. Call order is application order.
- `Highlight(width = 0.5.dp, blurRadius = width / 2, alpha, style)`, styles `HighlightStyle.Default(color, blendMode, angle, falloff)`, `.Ambient(intensity)`, `.Plain(color, blendMode)`. Ready-made `Highlight.Default`, `.Ambient`, `.Plain`.
- `Shadow(radius = 24.dp, offset, color, alpha)`, `InnerShadow(radius = 24.dp, offset, color, alpha)`; `InnerShadow` has `lerp`.
- `layerBlock = { scaleX = …; translationX = … }` moves the glass while the backdrop inside stays put: the library applies the inverse transform itself.
- `exportedBackdrop = sheetBackdrop` on a sheet: elements on top of it (sliders) pass `sheetBackdrop` and refract the sheet.
- `rememberCombinedBackdrop(a, b, …)` mixes several layers (backdrop plus toggle track). `rememberBackdrop(base) { draw -> scale(sx, sy) { draw() } }` transforms a layer: that is how a thumb shows a shrunk track and a magnifier shows enlarged text.
- `onDrawBackdrop = { draw -> draw(); layer.record { draw() } }` captures the picture under the glass. The catalog uses it for glass that adapts to brightness: the layer is scaled down to 5×5, the average luminance is computed, and `colorControls`, blur and text colour change smoothly.

**Components.** The library itself has none; they live in the catalog in the same repository. Do not rewrite them: copy the files with their Apache-2.0 header and adjust colours.

- `app/src/commonMain/kotlin/com/kyant/backdrop/catalog/components/`: `LiquidButton.kt`, `LiquidToggle.kt`, `LiquidSlider.kt`, `LiquidBottomTabs.kt`, `LiquidBottomTab.kt`.
- `app/src/commonMain/kotlin/com/kyant/backdrop/catalog/utils/`: `DampedDragAnimation.kt`, `InteractiveHighlight.kt`, `DragGestureInspector.kt`, `ProgressConverter.kt`; for a tilt-driven highlight `UISensor.kt` (common interface plus an accelerometer implementation in `androidMain`).
- Example screens: `catalog/destinations/` (control centre, dialog, magnifier, playground, brightness-adaptive glass, progressive blur).
- The author's demo build: `androidApp/release/androidApp-release.apk` in the repository; install it and touch it before you start.

Recipe values and springs: `SKILL.md` and `math-and-motion.md`. Merging shapes like `GlassEffectContainer` is not in the library; if the user asks for it on Compose, port the field scheme from `math-and-motion.md` ("Merging") into a `runtimeShaderEffect`, or render that part in a WebView with the web engine.

**Should a native Android app use a WebView instead?** No. Use Backdrop. The web engine is for apps that already are web (WebView, Capacitor, Cordova, Electron) or for a web layer inside React Native.
