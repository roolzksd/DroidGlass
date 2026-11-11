# Apple: SwiftUI, UIKit, AppKit, widgets

Imitate nothing here: the system renders the real material and handles the backdrop and accessibility settings itself. Remove your own backgrounds from toolbars, tab bars, navigation and `presentationBackground` on sheets, or they cover the glass. These APIs are new: build the project before handing it over.

```swift
// put the modifier last, after frame, padding and font; no .background of your own
Text("Hello").padding().glassEffect()

// shape; tint only the primary action; react to touch only when interactive
Image(systemName: "plus")
    .frame(width: 56, height: 56)
    .glassEffect(.regular.tint(.blue.opacity(0.8)).interactive(), in: .circle)

// the clear variant over a photo, with a dim layer
Label("Play", systemImage: "play.fill")
    .padding()
    .background(Capsule().fill(.black.opacity(0.28)))
    .glassEffect(.clear)

// ready-made button styles
Button("Done") { }.buttonStyle(.glass)
Button("Confirm") { }.buttonStyle(.glassProminent)

// several glass elements side by side always go into a container: it saves rendering and merges nearby shapes
@Namespace private var ns
GlassEffectContainer(spacing: 20) {          // spacing: how close shapes must be to merge
    HStack(spacing: 20) {
        Image(systemName: "pencil").frame(width: 56, height: 56)
            .glassEffect().glassEffectID("pencil", in: ns)
        if isExpanded {
            Image(systemName: "eraser").frame(width: 56, height: 56)
                .glassEffect().glassEffectID("eraser", in: ns)
                .glassEffectTransition(.matchedGeometry)
        }
    }
}
// toggle with withAnimation { isExpanded.toggle() } so the shapes flow into each other

// elements with the same id merge into one glass shape
.glassEffectUnion(id: "group", namespace: ns)

// older systems
if #available(iOS 26, *) {
    content.glassEffect()
} else {
    content.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
}
```

More useful SwiftUI: `.tabBarMinimizeBehavior(.onScrollDown)` on `TabView`, `.scrollEdgeEffectStyle(.soft, for: .top)` for your own bars over scrolling content, `.backgroundExtensionEffect()` so an image extends under the sidebar, `ConcentricRectangle` for concentric corners, `ToolbarSpacer` for toolbar groups. System `Toggle` and `Slider` on iOS 26 already behave like the thumbs in the recipe table; do not build your own.

**UIKit:** `UIGlassEffect` (properties `tintColor`, `isInteractive`) inside a `UIVisualEffectView`; content goes into `contentView`; round it with `cornerRadius` and `clipsToBounds = true`. `UIGlassContainerEffect` with `spacing` combines several elements. Buttons: `UIButton.Configuration.glass()`, `.prominentGlass()`, `.clearGlass()`. **AppKit:** `NSGlassEffectView` and `NSGlassEffectContainerView`. UIKit and AppKit property names come from Apple's documentation and community skills; verify them when building.

**Widgets:** support the tinted mode. Read `@Environment(\.widgetRenderingMode)` and handle `.accented`, mark accent elements with `.widgetAccentable()`, give images `.widgetAccentedRenderingMode(.monochrome)`, set the background with `.containerBackground(for: .widget)`.

**Accessibility on iOS:** with Reduce Motion the system weakens the lens and the jelly; with Increase Contrast glass becomes black or white with a border. Check the UI in light, dark and tinted appearance.

**iOS web views (WKWebView, Safari):** no SVG `backdrop-filter`, so the web engine falls back to blur. For a native look in a hybrid iOS app put the glass controls in SwiftUI over the web view.
