# Changelog

## Unreleased

### Item 1: Multiple paths per route
- Added `path: string | readonly string[]` support in `defineRoutes` (with `RouteDefinition.paths`).
- Matching stays first-match in declaration order across routes and path aliases.
- `buildPath` / `buildUrl` / navigate-by-name select the first satisfied pattern consuming the most provided params; URL navigation and `setParams` / `setQuery` preserve the active alias pattern.
- `toLinkingConfig()` emits React Navigation 7 `alias` entries; `createLinking()` and `initialUrl` support all aliases.

### Item 2: Overlay routes
- Added `overlay: true` and `overlayPresentation` (default `'transparentModal'`) on `RouteConfigInput`, plus `isOverlay` and `basePathname` on `UnifiedRoute` / `RouteMatchResult` / `ResolvedNavigationIntent` and `registry.matchOverlayUrl()`.
- On web, `<RouterView>` keeps the base route mounted with isolated `useRoute()` / `useParams()` / `useIsFocused() === false` while rendering the overlay on top.
- On native, overlays push as modal screens; `getStateFromUrl` / `initialUrl` build `[BaseScreen, OverlayScreen]` so `goBack()` closes the overlay cleanly.
- Opening an overlay over the same base skips the base screen's leave guard; closing runs the overlay's leave guard.

### Item 3: Runtime-conditional routes
- Added `enabled?: boolean | ((context?: any) => boolean)` on `RouteConfigInput`, `registry.isRouteEnabled(name, context?)`, and reactive `routeContext` prop on both `WebRouterProvider` and `NativeRouterProvider`.
- Disabled routes are skipped during matching (`matchUrl`, `matchOverlayUrl`, `resolveTarget`, `getStateFromUrl`, `createLinking`, and `<RouterView>`).
- On native, all `native: true` screens stay registered in React Navigation for stack stability via a stable `NativeScreenGate` wrapper that renders `fallback` (or `null`) if a mounted route becomes disabled. Passing a new `RouteRegistry` prop safely preserves history/container state.

### Item 4: Entry guards
- Added route-level `guard?: (route, context?) => true | void | NavigationTarget | ReactElement` on `RouteConfigInput`.
- Enforced identically across `navigate`/`push`/`replace`, `initialUrl`/deep links, back/forward, `reset`, SSR (`StaticRouter`), and reactive `routeContext` updates on both web and native.
- Supports redirect chaining with cycle detection (max 10 hops), leave-guard-first ordering, and guard-bypassing redirects when returning to a newly unauthorized screen.

### Item 5: Controlled web mode
- Added controlled mode props to `WebRouterProvider`: `location`, `locationState`, `onNavigate({ path, action: 'push' | 'replace' | 'back', state, delta })`, and `canGoBack`.
- Backed by a virtual history v4 adapter (`src/adapters/controlledHistory.ts`) that never reads or writes `window.history`, never echoes host-driven updates, round-trips location `state`, and preserves full leave-guard and entry-guard behavior.

### Item 6: External targets on web (`onExternal`)
- Added `onExternal?: (url: string) => void` on `WebRouterProvider`, `NativeRouterProvider`, and `<LiteConfig>` (working alongside native's `openWeb`).
- On web (controlled and uncontrolled), outgoing navigation to targets outside the registry or cross-origin URLs runs leave guards and invokes `onExternal(url)` instead of emitting `onNavigate` or rendering `<RouterView fallback>`.

### Item 7: Back-at-root precedence
- Changed back-at-root precedence across full and `/lite` layers so a route's `parent` (or `/lite`'s `goBack(fallback)`) applies first when there is no history, and `onBackAtRoot` is invoked (after leave guards) only when no `parent`/`fallback` is defined.

### Item 8: Lite navigation listener action
- Updated `/lite` `useNavigationListener` on both web and native to pass `action: LiteNavigationAction` (`'push' | 'replace' | 'goBack'`) as the second argument, matching the full layer's stack-mirroring capability.
- Exported `LiteNavigationAction` and `LiteNavigationListener` from both `/lite` entry points.

### Item 9: Link parity with React Router v5 `NavLink`
- Added `isActive(match, location)`, `strict`, `sensitive`, and web `component` custom renderer props (plus `LinkMatch`, `LinkLocation`, `LinkIsActive`, and `WebLinkComponentProps` types) to `<Link>` on both full and `/lite` layers.
- Native `<Link>` evaluates `isActive(match, location)` identically for `activeStyle` / `accessibilityState.selected` and accepts (and ignores) `component` so shared design-system wrappers compile unchanged on both platforms.

### Item 10: Imperative access outside React & external navigation
- Added `src/imperative.ts` exporting `getRouter()` and `createRouterRef()` (wired via `<RouterProvider routerRef={...}>` on both web and native) providing `getLocation()`, `getRoute()`, `subscribe()`, navigation methods, `openExternal(url, options?)`, and `reload()` outside React components.
- Added guarded `openExternal(url, { replace? })` and `reload()` (with `onReload` provider / `<LiteConfig>` callback) to both full and `/lite` layers on web and native.

### Item 11: Remove React Router internal `__RouterContext` import
- Replaced `useContext(__RouterContext)` (from `'react-router'`) in `WebRouterProvider` with the public `useHistory()` hook from `'react-router-dom'` (which returns `undefined` outside a `<Router>` and the router's `history` inside `BrowserRouter`, `HashRouter`, `MemoryRouter`, `Router`, and `StaticRouter`).

### Item 12: Preact compatibility (`preact/compat`)
- Added `vitest.preact.config.ts`, `tests/preact.test.tsx`, and `npm run test:preact` verifying the web layer (`RouterProvider` memory & controlled, `RouterView`, overlays, multiple paths, `Link` with `isActive`/`component`/refs, leave & entry guards, `<Prompt>`, `<Redirect>`, `getRouter()`, and React Router v5 compat hooks) under `preact/compat` (`preact` added as a `devDependency` only).

### Item 13: Hash round-trip on native
- Added and exported `withHashLinking(linking)` on native (automatically applied to custom `linking` configs passed to `<NativeRouterProvider>`) so `#hash` fragments round-trip cleanly through `getStateFromPath` / `getPathFromState` without leaking into params or serializing `__urMeta`.
- Added fallback `#hash` splitting in `unpackNativeRoute` for `initialState` built directly with stock React Navigation `getStateFromPath`.
- Updated `/lite` native (`useLinkingHelpers` and `useParams`) to preserve and round-trip `#hash` identically to web.

### Item 14: Migration codemod
- Added `codemod/transform.ts` and `codemod/cli.mjs` (`npm run codemod`) built on the TypeScript compiler API (zero new dependencies).
- Rewrites imports of `useHistory`, `useLocation`, `useParams`, `useRouteMatch`, `withRouter`, `matchPath`, `generatePath`, `Link`, `Redirect`, `Prompt`, and `RouteComponentProps` from both `'react-router'` and `'react-router-dom'` to the adapter package while preserving aliases, `type` imports, and merging existing adapter imports.
- Reports manual migration findings with `file:line:column` and remediation hints for `path-array`, `non-trailing-wildcard`, `route-render`, `navlink-is-active`, `window-location`, and `window-history`.

### Item 15: MIT `LICENSE` file
- Added root `LICENSE` file with the standard MIT License matching `package.json`.









