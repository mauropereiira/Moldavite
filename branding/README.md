# Moldavite brand kit

Use the PNG files for social uploads and SVG files for layouts, print, or resizing.
The SVG artwork is outlined: no font installation is needed. These are the same
monogram and wordmark used in the app, without a new logo or altered lettering.

| Folder | What to use |
| --- | --- |
| `logos/` | Transparent monogram (1024px) and wordmark (2400px wide), in ink or cream. Use ink on light backgrounds and cream on dark backgrounds. |
| `social/` | Light and dark profile pictures (1080×1080), banners (1500×500), and landscape posts/link cards (1200×630). |
| `app-icons/` | Opaque 1024×1024 iPhone/iPad/App Store master. iOS applies the rounded corners. |
| `app-store/` | Actual iPhone and iPad app screenshots with fictional sample notes, ready for the App Store listing. |

The profile pictures leave room for circular cropping. Social platforms crop
headers differently on phones and computers; check the platform's preview before
publishing. The included dimensions are reusable canvases, not a promise that
one file matches every platform's current requirements.

Colors: cream `#F9F6ED`, ink `#0E0D0A`, dark ground `#14120C`.
Keep the artwork proportional, leave clear space around it, and avoid shadows,
extra outlines or recoloring. The app icon intentionally uses the dark ground.

The iPhone and iPad icon sizes are already installed in the Xcode asset catalog
at `src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/`, including the App Store
slot. Matching iOS source PNGs are in `src-tauri/icons/ios/`. Desktop icons are
unchanged. The earlier generated Xcode icons were Tauri placeholders.

## Regenerate on macOS

From the repository root, with Node 22 and Xcode available:

```sh
npm install --prefix /tmp/moldavite-brand-render --no-audit --no-fund @resvg/resvg-js@2.6.2
node branding/generate.mjs /tmp/moldavite-brand-render
```

This uses `public/monogram.svg`, `public/wordmark.svg` and
`src-tauri/icons/icon-master.svg`. It updates only the brand kit and iOS icon
PNGs. The renderer is installed outside the app's dependencies. The Swift helper
removes the app icons' alpha channel; it does not add pre-rounded corners.
Do not run `tauri ios init` to install icons: that would replace project setup.
