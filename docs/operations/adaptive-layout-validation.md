# Adaptive layout implementation and release checks

## Layout contract

- `AdaptiveViewportProvider` reads CSS viewport dimensions, visual viewport height and optional `window.viewport.segments`. Window/visual viewport resize and viewport segment media query changes refresh the geometry. No device-name or aspect-ratio detection is used.
- Navigation: bottom tabs below 600 CSS px, 72 px rail at 600–1199, 224 px sidebar from 1200. `MainLayout` mounts its body once.
- `useAdaptiveLayout` measures each workspace with `ResizeObserver`. `AdaptivePaneLayout` enables two panes at 688 px of content width, with 320 px minimum columns, 16 px gap and 32 px outer padding.
- Inventory, cabinet list/3D, search, waste wizard and waste logs share the pane container. Hidden panes stay mounted. Selection and drafts live outside the layout calculation; automatic first-row selection does not open a narrow detail pane.
- Editable control focus determines the active pane where both panes contain inputs. Narrow detail back buttons and Android's `buril:adaptive-back` dispatcher share pane navigation. Dialogs consume back before the underlying pane.
- The cabinet Canvas measures its parent. Resizing preserves a user-adjusted camera; **Fit view / 화면 맞춤** explicitly resets its framing. Selecting another shelf or changing camera mode still changes framing intentionally.
- With usable side-by-side segments, each pane fits within its own segment after navigation/padding, with a separate hinge grid column. Stacked/too-small segments use one active region. Dialogs use the active region and available keyboard height. Without segment geometry the app uses ordinary responsive layout; physical hinge avoidance is not guaranteed.
- Server APIs, schemas and disposal decision rules are unchanged. Android keeps its existing `configChanges`; native Jetpack WindowManager integration remains out of scope.

## Automated validation

Run from the repository root:

```powershell
npm run lint
npm test -- --reporter=dot --maxWorkers=2 --testTimeout=30000
npm run build
npm run test:e2e:adaptive
# Android, with JDK 21 selected for this shell:
cd android
.\gradlew.bat :app:compileDebugJavaWithJavac
```

The longer Vitest timeout accommodates Windows PowerShell startup in the existing environment-probe tests; test assertions are unchanged. The unit runner excludes other agent worktrees, and ESLint excludes generated Playwright output. Browser test source remains linted under `e2e/adaptive`.

The adaptive Playwright configuration builds an isolated fixture using the actual screen components and dummy loopback service configuration. Network access is intercepted, so it cannot modify a real inventory or waste log. Browser failures retain traces/screenshots under `output/playwright/adaptive/results`.

Coverage includes:

- 320, 360, 430, 599, 600, 759, 760, 768, 840, 1024, 1199, 1200 and 1280 px; navigation boundaries and content width 687/688.
- Single inventory load/body mount during repeated resizes; no persistent horizontal overflow.
- Inventory modal draft, search query/result, cabinet editor draft and Canvas identity, explicit versus automatic waste-log selection, waste wizard/review navigation and reachable footer.
- Synthetic visual viewport height changes and injected side-by-side/stacked segment changes, including active-region overlay placement.
- Uncaught browser exceptions and unexpected direct inventory/cabinet/waste table mutations during the scenarios.

Validation environment on 2026-10-21: Windows, Playwright Chromium 151.0.7922.34 (revision 1234), WebKit 26.5 (revision 2336), Android compilation with Android Studio JBR 21. Browser engine versions come from the installed Playwright browser manifest. Desktop WebKit is not a physical iOS Safari/WebView test.

Recorded results: ESLint passed; Vitest 168 files passed / 2 skipped, 1,921 tests passed / 12 skipped (excluding an ignored local `tmp/` test that also fails on `main`); adaptive Playwright 16/16 passed across both engines (32/32 with `--repeat-each=2`); production build (including TypeScript and client secret scan) passed; Android Java compilation passed on 2026-10-19 and was not re-run. Existing large-bundle and stale Browserslist warnings remain. No staging or physical-device pass is implied by these results.

## Release gates requiring a device or seeded staging environment

Do not treat injected segment geometry or ordinary viewport resizing as proof of real hinge support.

| Environment | Required evidence | Status |
| --- | --- | --- |
| Android foldable Chrome and installed app | Device model, Android/Chrome/WebView versions, `window.viewport?.segments` availability; fold/unfold, rotation, split window, keyboard, camera, camera viewpoint and draft retention | Pending device verification |
| iOS Safari and installed app | Device/iOS versions; rotation, keyboard, cutout/home-indicator safe areas, modal dismissal and retained inputs | Pending device verification |
| Existing Gate0 staging flow | Login → lab → inventory → disposal/log flow with seeded test data, confirm a single backend mutation per explicit submit | Pending staging regression |
| Deployment | Existing web release workflow after staging checks; app sync/build and release using the existing platform procedure | Not deployed by this change |

For every manual run, record the app commit, device/browser versions, window size in CSS px, exposed segment rectangles (or absence), reproduction steps and screenshots. Resize while a draft is dirty and a dialog/scanner is open; verify selection, focus, list scroll position and final action visibility. Confirm no extra navigation-history entries or save requests were produced by resizing. Review ordinary unsupported-API fallback separately from supported hinge behavior.

If a platform regresses, revert the adaptive frontend change using the normal web/app rollback process. This change does not require a database rollback.
