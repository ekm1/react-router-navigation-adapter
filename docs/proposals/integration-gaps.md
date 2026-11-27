# API Proposal: Integration Gaps for Existing React Router v5 Codebases

This proposal specifies the public API additions, TypeScript types, web/native semantics, guard interactions, and backward-compatibility impact for all 15 items needed to run shared React Router v5 feature modules across:

- **(a)** a web app owning a React Router v5 `BrowserRouter`,
- **(b)** an embedded web micro-frontend whose URL is owned by a non-React-Router host, and
- **(c)** React Native "islands" embedded in a native iOS/Android host app.

All items add **zero new runtime dependencies**.

---

## Baseline (Recorded Before Changes)

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass (0 errors) |
| `npm test` | 9 test files passed, **176 tests passed** (0 failed) |
| `npm run build` | Pass (0 errors) |

---

## Compatibility Summary

| # | Item | Layer | Compatibility |
| --- | --- | --- | --- |
| 1 | Multiple paths per route | Full | Backward compatible (additive) |
| 2 | Overlay routes | Full | Backward compatible (additive) |
| 3 | Runtime-conditional routes | Full | Backward compatible (additive) |
| 4 | Entry guards | Full | Backward compatible (additive) |
| 5 | Controlled web mode | Full (web) | Backward compatible (additive) |
| 6 | External targets on web | Full + Lite | Backward compatible (additive) |
| 7 | Back-at-root precedence | Full + Lite | **Breaking behavior change** (migration path below) |
| 8 | Lite navigation listener action | Lite | Backward compatible (additive 2nd arg) |
| 9 | Link parity with `NavLink` | Full + Lite | Backward compatible (additive) |
| 10 | Imperative access & external nav | Full + Lite | Backward compatible (additive) |
| 11 | Remove `__RouterContext` internal import | Full (web) | Backward compatible (internal refactor) |
| 12 | Preact compatibility | Full (web) | Backward compatible (dev-only test suite + fixes) |
| 13 | Hash round-trip on native | Full + Lite (native) | Backward compatible (bugfix/enhancement) |
| 14 | Migration codemod | Tooling | Backward compatible (additive CLI script) |
| 15 | MIT `LICENSE` file | Repo | Backward compatible (additive) |

---

## Blockers (Must Have)

### 1. Multiple paths per route

#### Proposed Types & API

```ts
export interface RouteConfigInput {
  /** One or more URL path patterns, matched first-match in declaration order. */
  path: string | readonly string[];
  // ...existing options unchanged
}

export interface RouteDefinition<TName extends string = string>
  extends Omit<RouteConfigInput, 'path'> {
  name: TName;
  /** Primary (first) path pattern — preserved as `string` for backward compatibility. */
  path: string;
  /** All declared path patterns for this route (always non-empty). */
  paths: readonly string[];
  exact: boolean;
}
```

- `defineRoutes` throws if `path` is an empty array (`[]`) or if any pattern fails `validatePattern`.
- Unreachable-route shadowing warnings check every static pattern in `paths` against all previously compiled patterns (including earlier patterns on the same route).
- `registry.getParamNames(name)` returns the deduplicated union of param names across all patterns of `name`.
- `RouteMatchResult.pattern` and `UnifiedRoute.matchedPattern` remain `string` — the **specific** pattern that matched the URL.

#### Pattern Selection for `buildUrl` / `buildPath` / Navigate-by-Name

When a route has multiple patterns (e.g. `['/items', '/items/:id']` or `['/projects/:id', '/projects/:id/details']`):

1. Filter `paths` to patterns whose **required** params (`:param`, not `:param?` or `*`) are all provided (non-null/undefined) in `params`.
2. If none are satisfied, throw the missing-parameter error against `paths[0]`.
3. Among satisfied patterns, select the first pattern in declaration order that consumes the **most** provided route params (keys in `params` that appear in that pattern's `paramNames`). Ties break by declaration order.

Examples:
- `['/items', '/items/:id']` with `{}` → `/items` (0 consumed; 2nd pattern unsatisfied).
- `['/items', '/items/:id']` with `{ id: '42' }` → `/items/42` (consumes `id`, avoiding leaking `id` into `?id=42`).
- `['/items', '/items/:id']` with `{ page: 2 }` → `/items?page=2` (`page` is not a path param of either pattern; declaration order picks `/items`).
- `['/projects/:id', '/projects/:id/details']` with `{ id: '7' }` → `/projects/7` (both consume `id`; declaration order wins).
- `['/projects/:id', '/projects/:id/details']` navigated by URL `'/projects/7/activity'` → preserves `/projects/7/activity` and `matchedPattern: '/projects/:id/details'` (never truncates to `/projects/7`).
- `setParams({ id: '8' })` while on `/projects/7/activity` regenerates using `route.matchedPattern` (`'/projects/:id/details'`) when its required params remain satisfied → `/projects/8/activity`.

> **Decision:** Prefer the satisfied pattern that consumes the most provided route params (tie-broken by declaration order), so `['/items', '/items/:id']` with `{ id: '42' }` builds `/items/42` cleanly.

#### Web Semantics

- `<RouterView>` passes `path={route.paths.length === 1 ? route.paths[0] : [...route.paths]}` to React Router v5's `<Route>` inside `<Switch>` (React Router v5 supports `path: string[]` natively).
- `toUnifiedRoute` matches via `registry.matchUrl`, recording the exact matched pattern in `matchedPattern`.

#### Native Semantics

- `registry.toLinkingConfig(prefixes)` emits React Navigation 7's native `alias` format:
  ```ts
  {
    path: toReactNavigationPath(definition.paths[0]),
    ...(definition.paths.length > 1
      ? {
          alias: definition.paths.slice(1).map((p) => ({
            path: toReactNavigationPath(p),
            exact: definition.exact,
            ...(definition.parse ? { parse: definition.parse } : {}),
          })),
        }
      : {}),
    exact: definition.exact,
    parse: definition.parse,
    stringify: definition.stringify,
  }
  ```
- `getStateFromUrl` / `initialUrl` / `createLinking` match through `registry.resolveTarget` → `registry.matchUrl`, so all aliases work identically.
- `packParams` stores `meta.pattern` (and `meta.pathname` for non-exact routes) whenever a non-primary alias matched, so `unpackNativeRoute` reconstructs the exact alias URL and `matchedPattern`.

#### Behavior with Guards

- Leave guards (`useNavigationGuard`) compare `pathname`: navigating between two different aliases of the same route (e.g. `/projects/7` → `/projects/7/activity`) changes `pathname`, so leave guards run identically on both platforms.
- Entry guards (Item 4) receive the resolved `UnifiedRoute` including the matched alias's `matchedPattern` and `params`.

---

### 2. Overlay routes that match under any prefix

#### Proposed Types & API

```ts
export type NativeOverlayPresentation =
  | 'modal'
  | 'transparentModal'
  | 'fullScreenModal'
  | 'containedModal'
  | 'containedTransparentModal';

export interface RouteConfigInput {
  /**
   * When true, `path` matches as a segment-aligned suffix of any URL pathname
   * (replacing React Router's leading-wildcard pattern like `*/preview/:previewId`).
   * On web, the underlying base route keeps rendering with the overlay on top.
   * On native, the screen is pushed over the current stack with modal presentation.
   */
  overlay?: boolean;
  /**
   * Native only: React Navigation screen presentation for `overlay: true` routes.
   * Defaults to `'transparentModal'`. Explicit `options.presentation` overrides this.
   */
  overlayPresentation?: NativeOverlayPresentation;
}

export interface UnifiedRoute<
  TName extends string = string,
  TParams extends RouteParams = RouteParams,
> {
  // ...existing fields unchanged
  /** True when this route snapshot represents an active `overlay: true` route. */
  isOverlay?: boolean;
  /** When `isOverlay` is true, the underlying base pathname with the overlay suffix stripped (e.g. `"/projects/42"` or `"/"`). */
  basePathname?: string;
}
```

- `validatePattern` continues rejecting leading wildcards like `*/preview/:previewId`, with an updated error message directing authors to `{ path: '/preview/:previewId', overlay: true }`.
- Overlay `path` supports both `string` and `string[]` (composes with Item 1).

#### Suffix Matching Rules

Given pathname `P` (e.g. `/projects/42/preview/123` or `/preview/123`):
1. Enabled `overlay: true` routes are checked in declaration order for a segment-aligned suffix match at the end of `P`:
   - `/projects/42/preview/123` matching overlay `/preview/:previewId` yields:
     - overlay match: `{ name: 'PreviewOverlay', pattern: '/preview/:previewId', params: { previewId: '123' }, isOverlay: true, basePathname: '/projects/42' }`
     - base match: `registry.matchUrl('/projects/42')` → `Project` with `{ id: '42' }`.
   - `/preview/123` matching overlay `/preview/:previewId` yields `basePathname: '/'` and base match `registry.matchUrl('/')`.
2. If no overlay matches, normal (non-overlay) routes match in declaration order as today.
3. New registry helper: `registry.matchOverlayUrl(url, context?)` returning `{ overlay: RouteMatchResult; base: RouteMatchResult | null; basePathname: string } | null`.

#### Navigation & URL Construction

- **By name (`router.navigate('PreviewOverlay', { previewId: '123' })`, `<Link to="PreviewOverlay" ...>`)**:
  - Computes target pathname by appending the overlay suffix to the current **base** pathname (`currentRoute.basePathname ?? currentRoute.pathname`, with `/` normalized to `''` before joining so `/` + `/preview/123` = `/preview/123`, and `/projects/42` + `/preview/123` = `/projects/42/preview/123`).
  - `router.buildUrl('PreviewOverlay', { previewId: '123' })` and `<Link>` `href` include the current base prefix so Cmd-click / copy-link work.
  - `registry.buildPath('PreviewOverlay', { previewId: '123' })` (outside a route context) returns the standalone suffix `/preview/123`.
- **By URL (`router.navigate('/projects/42/preview/123')`)**:
  - Uses the URL's explicit base pathname `/projects/42` + overlay `/preview/123`.
- **Closing the overlay (`goBack()`)**:
  - When opened via `navigate` / `push`, `goBack()` pops back to the underlying route on both platforms.
  - When deep-linked directly to `/projects/42/preview/123` (no prior browser history):
    - **Native:** `getStateFromUrl` builds a 2-entry stack `[BaseRoute, OverlayRoute]`, so `canGoBack()` is `true` and `goBack()` pops the overlay revealing the base screen.
    - **Web:** `canGoBack()` is `false`; the overlay's implicit `parent` defaults to `basePathname` (`/projects/42`) unless an explicit `parent` is configured, so `goBack()` replaces with `/projects/42` (closing the overlay cleanly without leaving the app).

#### `useRoute` / `useParams` / `useIsFocused` Semantics (Base Route vs. Overlay)

| Hook | Inside Base Route (underneath overlay) | Inside Overlay Route | Outside Screens (Layout / Header / Listener) |
| --- | --- | --- | --- |
| `useRoute()` | Base route (`name: 'Project'`, `pathname: '/projects/42'`, `params: { id: '42' }`, `matchedPattern: '/projects/:id'`) | Overlay route (`name: 'PreviewOverlay'`, `pathname: '/projects/42/preview/123'`, `params: { previewId: '123' }`, `matchedPattern: '/preview/:previewId'`, `isOverlay: true`, `basePathname: '/projects/42'`) | Active top-most route (the overlay while open; the base route once closed) |
| `useParams()` | Base params (`{ id: '42' }`) | Overlay params (`{ previewId: '123' }`) | Top-most route params |
| `useQuery()` | Current URL query params | Current URL query params | Current URL query params |
| `useIsFocused()` | `false` while overlay is open; `true` when closed | `true` while on top | `true` |
| `useFocusEffect()` | Runs cleanup on overlay open; re-runs on overlay close | Runs on open; cleans up on close | Runs on mount |

#### Web Semantics

- `<RouterView>` splits the current location into `(basePathname, overlayMatch)`:
  - Renders the base route (matched against `basePathname`, or `fallback` if unmatched) wrapped in an internal `RouteOverrideContext` providing the base `UnifiedRoute` and `isFocused = false` whenever an overlay is active.
  - Renders the overlay component as a sibling after the base route (wrapped in its own focus context `isFocused = true`), keeping the base route mounted (preserving scroll position, form state, and component state).
  - Switching overlays over the same base route keeps the base route mounted.

#### Native Semantics

- `<RouterView>` registers `overlay: true` routes with `options={{ presentation: route.overlayPresentation ?? 'transparentModal', ...route.options }}` on the stack navigator.
- Pushing an overlay pushes it onto the active/root stack over the current screen; `packParams` stores `meta.basePathname` so `route.pathname` and `route.path` match web (`/projects/42/preview/123`).
- Navigating by URL with a different base (e.g. from `/home` to `/projects/42/preview/123`) navigates to the base screen and pushes the overlay on top.
- `initialUrl` and `createLinking` build `[BaseScreen, OverlayScreen]` (nesting the base screen in its `nestedIn` navigator if applicable and pushing the overlay on the root stack).

#### Behavior with Guards

- **Opening an overlay over the same base pathname** (e.g. `/projects/42` → `/projects/42/preview/123`): the base screen stays mounted underneath and is not being discarded, so **base-screen leave guards are NOT triggered** on either platform. (Layout guards outside screens still run if desired — or we can skip screen-scoped guards while running layout guards; proposed: skip base-screen leave guards when `nextBasePathname === currentBasePathname`, since the base screen remains mounted.)
- **Closing or leaving an overlay** (`goBack()`, swipe-down, Android back, or navigating away): the **overlay's** `useNavigationGuard` runs normally on both platforms (including native `usePreventRemove` / swipe-dismiss prevention).
- **Navigating from an overlay to a different base route** (`/projects/42/preview/123` → `/settings`): runs the overlay's leave guard (if any) and layout guards.
- **Entry guard (Item 4) on an overlay**: runs before entering the overlay; returning a `ReactElement` renders that element inside the overlay slot over the base screen; returning a `NavigationTarget` redirects instead of opening the overlay.

---

### 3. Routes that depend on runtime state

#### Proposed Types & API

Support **both** per-route predicates (with reactive `routeContext`) and safe registry replacement:

```ts
export interface RouteConfigInput {
  /**
   * Runtime availability predicate evaluated at match time.
   * When `false` (or returning `false`), the route is skipped during URL matching
   * as if it were not registered.
   */
  enabled?: boolean | ((context: any) => boolean);
}

// On both WebRouterProviderProps and NativeRouterProviderProps:
export interface CommonRouterProviderProps {
  /**
   * Optional reactive state passed into route `enabled(context)` predicates and
   * entry `guard(route, context)` functions. Updating this prop re-evaluates
   * active routes without remounting the router or losing history.
   */
  routeContext?: unknown;
}

// On RouteRegistry:
export interface RouteRegistry<TName extends string = string> {
  isRouteEnabled: (name: string, context?: unknown) => boolean;
  matchUrl: (url: string, context?: unknown) => RouteMatchResult<TName> | null;
  resolveTarget: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
    context?: unknown,
  ) => ResolvedNavigationIntent<TName>;
  // ...existing methods unchanged
}
```

- `enabled` defaults to `true`. Both zero-argument closures (`enabled: () => featureFlags.hasProjects`) and context-driven functions (`enabled: (ctx) => ctx.features.projects`) work.
- Passing a newly created `RouteRegistry` instance to `<RouterProvider routes={nextRoutes}>` (e.g. from `useMemo(() => defineRoutes(...), [flags])`) is explicitly supported and safe: neither `<WebRouterProvider>` nor `<NativeRouterProvider>` remounts its underlying history / `NavigationContainer`, preserving stack depth, listeners, and active guards.
- Unreachable-route shadowing warnings in `defineRoutes` skip treating a route with a dynamic `enabled` predicate as permanently shadowing later routes.

#### Web Semantics

- `<RouterView>` filters out routes where `!registry.isRouteEnabled(route.name, routeContext)`.
- Navigating by URL to a disabled route skips that route during matching (matching a later fallback pattern if one exists, or falling through to `fallback` / `onExternal` from Item 6).
- Navigating by route name to a disabled route resolves to `name: null` with its generated pathname (so it falls through to `fallback` or `onExternal` instead of rendering the disabled screen).
- If the currently active route becomes disabled (via `routeContext` update or new `routes` prop), `<RouterView>` immediately re-renders and falls through to the next matching enabled route or `fallback`.

#### Native Semantics (Screen Registration When Disabled)

- **All `native: true` screens stay registered in React Navigation `<Navigator>` regardless of `enabled`.**
  - *Why:* Dynamically removing a `<Screen>` from a React Navigation `<Navigator>` while that screen exists in the navigation stack causes React Navigation to drop or crash the stack state. Keeping all `native: true` screens registered guarantees stack stability across runtime flag toggles.
- **Enforcement:**
  - `matchUrl`, `resolveTarget`, `getStateFromUrl`, `createLinking`, and `navigate`/`push`/`replace` all evaluate `isRouteEnabled(name, routeContext)`. A disabled route is treated as **unmatched** (`name: null`), so navigation to it goes through `openWeb` / `onExternal` (or throws if none is configured), never pushing the disabled screen.
  - `<RouterView.native>` wraps each screen in a lightweight gate wrapper (stable per route name, defined outside render to avoid remounts): if a screen is **already mounted** and its route later flips to disabled while focused, the wrapper renders `fallback` (if passed to `<RouterView fallback={...}>`) or `null` instead of the disabled screen component.
  - When a completely new `routes` object is passed to `<NativeRouterProvider>` with newly added/removed routes, React Navigation updates `routeNames` safely for screens not currently in the stack.

#### Behavior with Guards

- Disabled routes never run their entry guards (Item 4) because they do not match.
- Leave guards on the current screen still run before leaving toward a URL whose route is disabled (e.g. before handing off to `openWeb` / `onExternal` / `fallback`).

---

### 4. Entry guards

#### Proposed Types & API

```ts
export type EntryGuardResult<TName extends string = string> =
  | true
  | void
  | NavigationTarget<TName>
  | React.ReactElement;

export type EntryGuard<TName extends string = string> = (
  route: UnifiedRoute<TName>,
  context?: unknown,
) => EntryGuardResult<TName>;

export interface RouteConfigInput {
  /**
   * Route-level entry guard evaluated before entering / rendering the route.
   * - `true` / `undefined`: allow entry and render `component`.
   * - `ReactElement`: stay at the URL and render the returned element in place of `component`
   *   (e.g. `<LoginPrompt />` or `<LoadingSpinner />` for async auth).
   * - `NavigationTarget`: redirect (replace) to the target route or URL.
   */
  guard?: EntryGuard<any>;
}
```

- Distinction between `ReactElement` and `NavigationTargetObject` at runtime uses `React.isValidElement(result)` (completely unambiguous).
- Redirect chains (route A → route B → route C) are followed up to a safety limit of **10 hops**; exceeding it throws a descriptive cycle-detection error.
- **Async pattern:** Guards are synchronous by design (ensuring zero flash, SSR compatibility, and no race conditions on back/forward). For async checks (e.g. fetching session state), return a `<Loading />` `ReactElement` while pending and update `routeContext` when resolved; the guard automatically re-evaluates.

#### Uniform Behavior Across All Entry Vectors (Web & Native)

| Entry Vector | `guard` returns `true`/`void` | `guard` returns `ReactElement` | `guard` returns `NavigationTarget` (Redirect) |
| --- | --- | --- | --- |
| `navigate` / `push` / `replace` / `<Link>` | Navigates normally | Navigates to target URL; `<RouterView>` renders the returned element instead of `component` (`component` never mounts) | Redirects directly to resolved target without flashing or mounting the guarded screen (chained redirects resolved up to 10 hops) |
| `initialUrl` / deep link / SSR (`StaticRouter`) | Renders screen | Renders alternative element at `initialUrl` | Redirects immediately: Web `<Redirect>` (sets `StaticRouter` `context.url` in SSR, replaces in first commit on client); Native `getStateFromUrl` resolves straight to the redirect target so the guarded screen never mounts |
| Back / Forward (browser back/forward, `goBack()`, `go(-n)`, swipe-back, Android back) | Renders screen | `<RouterView>` wrapper unmounts `component` (if mounted) and renders the returned element | `<RouterView>` wrapper (on native, when the screen becomes **focused**) replaces the entry with the redirect target |
| `reset(targets, index)` | Resets normally | Resets stack; active entry renders alternative element | Active entry (`targets[index]`) is replaced by the resolved redirect target in the reset stack |
| Reactive `routeContext` change while on route | Renders screen | Swaps `component` ↔ returned element in place at the same URL | Replaces current entry with redirect target |

#### Web Semantics

- Outgoing `navigate`/`push`/`replace`/`reset`: resolves redirect guards on the target route before mutating history (after leave guards pass), so the guarded URL does not pollute history.
- `<RouterView.web>` wraps each route component in a stable `GuardedRouteWrapper` that evaluates `route.guard(currentRoute, routeContext)` on every render:
  - Handles back/forward, direct initial loads, `<StaticRouter>` SSR (via React Router's `<Redirect>`), and reactive `routeContext` updates.

#### Native Semantics

- `getStateFromUrl` (used by `initialUrl` and `createLinking`) evaluates redirect guards before constructing initial state.
- Outgoing `navigate`/`push`/`replace`/`reset` resolve redirect guards before dispatching (after leave guards pass). If the redirect target is a non-native route, it routes cleanly to `openWeb` / `onExternal`.
- `<RouterView.native>` wraps each screen in a stable `GuardedScreenWrapper` that evaluates `route.guard(screenRoute, routeContext)`:
  - When returning a `ReactElement`: renders the element immediately in place of `component` (preventing protected content from peeking through during transitions).
  - When returning a `NavigationTarget`: triggers a `replace` only when the screen **is focused** (`useIsFocused()`), so an unfocused screen deeper in the stack does not hijack navigation until/unless the user pops back to it.

#### Behavior with Guards (Entry Guard ↔ Leave Guard Interaction)

1. **Order:** When navigating from screen A to screen B, **A's leave guards (`useNavigationGuard`) run first**. If A's leave guard blocks, navigation is aborted and B's entry guard does not take effect.
2. **Redirect bypass:** Once A's leave guard allows (or when an entry guard fires on back/forward / reactive logout to redirect away from a screen that was never allowed to mount), the entry-guard redirect itself bypasses leave guards so a user cannot be trapped on an unauthorized screen.
3. **Alternative element guards:** When B's entry guard returns a `ReactElement`, B's `component` is not mounted (so B's own `useNavigationGuard` is not registered). If the returned `ReactElement` itself calls `useNavigationGuard`, that guard works normally.

---

### 5. Controlled (host-owned URL) mode for embedded web use

#### Proposed Types & API

```ts
export type ControlledLocation =
  | string
  | {
      /** Full relative URL (alternative to `pathname` + `search` + `hash`). */
      path?: string;
      pathname?: string;
      search?: string;
      hash?: string;
      state?: unknown;
      key?: string;
    };

export type ControlledNavigateAction = 'push' | 'replace' | 'back';

export interface ControlledNavigateIntent {
  /** Target relative URL (`pathname + search + hash`). `undefined` when `action === 'back'`. */
  path?: string;
  action: ControlledNavigateAction;
  /** Location state to round-trip through the host. */
  state?: unknown;
  /** Positive step count when triggered by `go(-n)` (defaults to `1` for `'back'`). */
  delta?: number;
}

export interface WebRouterProviderProps<TName extends string = string> {
  // ...existing props unchanged
  /**
   * Controlled mode: the host owns the URL and passes the current location here.
   * When defined, the adapter never reads or writes `window.history` and never attaches
   * to an ancestor `<Router>`.
   */
  location?: ControlledLocation;
  /** Convenience state prop when `location` is passed as a string (overridden by `location.state` if object). */
  locationState?: unknown;
  /**
   * Controlled mode: called when the MFE wants to navigate instead of mutating history.
   * Never echoed in response to a host-driven `location` prop change.
   */
  onNavigate?: (intent: ControlledNavigateIntent) => void;
  /**
   * Controlled mode: optional host-supplied answer for `router.canGoBack()`.
   * When omitted, tracked from observed MFE pushes (and `goBack()` at root still falls back
   * to `parent`, then `onBackAtRoot`, then `{ action: 'back' }`).
   */
  canGoBack?: boolean;
}
```

#### Web Semantics

- **Activation:** Controlled mode activates whenever `location !== undefined`. It ignores `routerType`, `history`, and `useExistingRouter` and **never reads or mutates `window.history`**.
- **Virtual History Bridge:** Internally instantiates a lightweight controlled `History` v4 object backed by the `location` prop and passes it to React Router v5's `<Router history={controlledHistory}>`. This guarantees full compatibility with `<Switch>`, `<Route>`, `<Link>`, `<Redirect>`, `<Prompt>`, `useHistory`, `useLocation`, `useRouteMatch`, and `withRouter`.
- **No-echo guarantee:**
  - Updating the `location` prop updates `controlledHistory.location` and notifies internal React Router / `useNavigationListener` subscribers (inferring `'PUSH' | 'REPLACE' | 'POP'` from the last emitted intent or `'POP'` for unsolicited host changes).
  - It **never** invokes `onNavigate` in response to an incoming `location` prop change.
- **Outgoing intents:**
  - `navigate(target)` → emits `{ path, action: samePath ? 'replace' : 'push', state }`.
  - `push(target)` → emits `{ path, action: 'push', state }`.
  - `replace(target)` / `setParams` / `setQuery({ replace: true })` → emits `{ path, action: 'replace', state }`.
  - `reset(targets, index)` → resets observed depth to `0` and emits `{ path: activeTarget.path, action: 'replace', state: activeTarget.state }`.
  - `goBack()` / `go(-n)`:
    - If `canGoBack` prop is `true`, or `canGoBack` prop is omitted and observed depth > 0: emits `{ action: 'back', delta }`.
    - If `canGoBack` prop is `false`: runs back-at-root logic (Item 7: `parent` emits `{ path: parent.path, action: 'replace', state: parent.state }`, else calls `onBackAtRoot`).
    - If `canGoBack` prop is omitted and observed depth === 0: checks `parent`, then `onBackAtRoot`, and if neither is present emits `{ action: 'back' }` so the host can still handle back.
- **State round-trip:** `state` passed via `navigate`/`push`/`replace`/`<Link>` is included in `onNavigate({ path, action, state })`. When the host passes it back via `location={{ pathname, search, hash, state }}` or `location={url} locationState={state}`, `useRoute().state` and `useLocation().state` expose it unchanged.
- **`basename`:** Applied in `controlledHistory.createHref` so `<Link>` renders accurate `<a href>` attributes for Cmd-click / copy-link.

#### Native Semantics

- Web-only props (`location`, `locationState`, `onNavigate`, `canGoBack` are specific to `WebRouterProviderProps`). Native islands are already controlled by the native host via `initialUrl` / `onBackAtRoot` / `openWeb` / `navigationRef`.

#### Behavior with Guards

- **Outgoing MFE navigations** (`navigate`, `push`, `replace`, `goBack`, `go`, `reset`, `<Link>`, compat `history.*`): leave guards (`useNavigationGuard` / `<Prompt>`) run **before** `onNavigate` is called. If blocked, `onNavigate` is suppressed until `context.proceed()` is called. Query/hash-only changes bypass leave guards as usual.
- **Incoming host `location` changes:** Because the host has already committed the URL change before passing the new `location` prop, synchronous prevention of host-driven URL changes is outside the MFE's control (noted in README). Entry guards (Item 4) **do** run on incoming `location` changes: returning a `ReactElement` renders it without emitting `onNavigate`; returning a redirect target emits `onNavigate({ path, action: 'replace', state })`.

---

### 6. Targets outside the registry on web

#### Proposed Types & API

Unify external-target handling across both platforms with `onExternal`, keeping `openWeb` as a backward-compatible alias on native:

```ts
// On WebRouterProviderProps:
export interface WebRouterProviderProps<TName extends string = string> {
  /**
   * Called when navigating to a URL that does not match any enabled route in the registry
   * (e.g. a host-owned page in an embedded micro-frontend) or an external origin URL,
   * or when `router.openExternal(url)` is called.
   * When omitted, unmatched relative URLs navigate normally and render `<RouterView fallback>`.
   */
  onExternal?: (url: string) => void;
}

// On NativeRouterProviderProps:
export interface NativeRouterProviderProps<TName extends string = string> {
  /** Cross-platform alias for `openWeb` (also used by `router.openExternal(url)`). */
  onExternal?: (url: string) => void;
  /** Existing WebView boundary callback (kept for backward compatibility; equivalent to `onExternal`). */
  openWeb?: (url: string) => void;
}

// On LiteConfigValue (both platforms):
export interface LiteConfigValue {
  onExternal?: (url: string) => void;
  openWeb?: (url: string) => void;
  // ...
}
```

#### Web Semantics

- When `onExternal` is **omitted**: behavior is 100% unchanged — unmatched URLs navigate in history and render `<RouterView fallback>`.
- When `onExternal` is **provided** (in controlled OR uncontrolled web mode):
  - Any outgoing `navigate`, `push`, `replace`, `<Link>` click, or compat `history.push`/`replace` targeting a URL where `resolved.name === null` (not matched by any enabled route) OR an external absolute URL (`http(s)://` with a different origin, `mailto:`, etc.) invokes `onExternal(url)` instead of mutating history, emitting `onNavigate`, or rendering `fallback`.
  - Incoming `location` prop / initial browser URL that doesn't match a route does **not** call `onExternal` (avoids host loops); it renders `<RouterView fallback>`.
  - `reset(targets, index)` where `targets[index]` is outside the registry resets to any preceding registered targets and invokes `onExternal(url)` — exact parity with native `reset`.
  - `<Link to="/host-page">` still renders `<a href="/host-page">` so Cmd/Ctrl-click and right-click work natively, while normal clicks route through `onExternal('/host-page')`.

#### Native Semantics

- Resolves `const externalHandler = openWeb ?? onExternal` (if both are provided, `openWeb` handles non-native routes and `onExternal` handles `router.openExternal(url)` — or if only one is provided it handles both).
- Existing `openWeb` behavior and error message when neither is provided remain unchanged.

#### Behavior with Guards

- Leave guards (`useNavigationGuard` / `<Prompt>`) run **before** `onExternal(url)` is invoked, with `action: 'navigate' | 'push' | 'replace' | 'reset'` and `nextPath: url`, matching native's `openWeb` guard behavior identically.

---

## Important (Behavior Parity)

### 7. Back-at-root precedence

#### Decision & Justification

**Chosen design: `parent` (full layer) and `fallback` (lite layer) apply first; `onBackAtRoot` runs only when there is no `parent` / `fallback`.**

Why this option is chosen over passing `parent` into `onBackAtRoot` and making it opt-in:

1. **Real embedded topology:** Every embedded host (iOS/Android island or web MFE) passes `onBackAtRoot={() => host.close()}` unconditionally at the root provider. Deep-linked child routes declare `parent: 'Orders'` (or lite screens call `goBack('/orders')`) specifically so pressing Back navigates up to their parent inside the module, while only root screens (no `parent` / no `fallback`) hand back to the host. Under the previous precedence, providing `onBackAtRoot` made every `parent` and `fallback` dead code.
2. **Zero host boilerplate:** Passing `parent` into `onBackAtRoot` would force every web host, iOS host, Android host, and `<LiteConfig>` caller to re-implement `if (parent) router.replace(parent.path); else host.close();` — and in `/lite`, `onBackAtRoot` takes no arguments at all.
3. **Clean guard semantics:** With `parent` first, `router.replace(parent)` runs leave guards exactly once. With `onBackAtRoot` first, calling `router.replace(parent)` inside `onBackAtRoot` would double-invoke leave guards unless special-cased.

#### Breaking Change Callout & Migration Path

> **Breaking Change:** Previously, when both `onBackAtRoot` and a route `parent` (full layer) or `goBack(fallback)` (`/lite`) were present, `onBackAtRoot` won and `parent`/`fallback` was ignored. With this change, `parent` / `fallback` takes precedence and `onBackAtRoot` is called only when no `parent` / `fallback` resolves.

**Behavior change:**
1. `parent` (full layer) and `goBack(fallback)` (`/lite`) always apply first at root.
2. `onBackAtRoot` runs only when no `parent` / `fallback` applies.
3. Existing tests (`tests/host.test.tsx`, `tests/gaps.test.tsx`, `tests/lite.test.tsx`) are updated to cover both deep-linked child routes (`parent` / `fallback` wins) and root routes without `parent` / `fallback` (`onBackAtRoot` runs).

#### Web & Native Semantics

- Identical on both platforms (shared `backAtRoot()` in `src/shared.ts`, plus `src/lite/web.tsx` and `src/lite/native.tsx`).
- Native Android hardware back (`BackHandler`) calls `controller.goBack()`, so deep-linked child → parent → second hardware back → `onBackAtRoot` works identically.
- `go(-n)` going past stack depth uses the same `backAtRoot()` helper.

#### Behavior with Guards

- When `parent` / `fallback` applies: delegates to `router.replace(parent/fallback)`, which runs leave guards once (and entry guards on the parent route).
- When no `parent` / `fallback` exists and `onBackAtRoot` applies: runs leave guards once with `action: 'goBack'` before invoking `onBackAtRoot`.

---

### 8. Lite navigation listener action

#### Proposed Types & API

```ts
export type LiteNavigationAction = 'push' | 'replace' | 'goBack';

export type LiteNavigationListener = (
  location: LiteLocation,
  action: LiteNavigationAction,
) => void;

export function useNavigationListener(listener: LiteNavigationListener): void;
```

- 100% backward compatible: existing 1-arg listeners `(location) => ...` continue to compile and run unchanged.

#### Web Semantics

- `history.listen((location, action) => ...)` maps history v4 `Action`:
  - `'PUSH'` → `'push'`
  - `'REPLACE'` → `'replace'`
  - `'POP'` → `'goBack'`

#### Native Semantics

- Tracks the previous focused leaf route (`route.key`, `siblings`, `path`), matching the full layer's action detection in `src/adapters/native.tsx`:
  - If previous `siblings` contains new `route.key` (and keys differ) → `'goBack'`.
  - Else if new `siblings` contains previous `route.key` (and keys differ) → `'push'`.
  - Else → `'replace'` (covers `StackActions.replace`, `replaceParams` / `setQuery`, and cross-tab switches).
- Initial mount / ready state seeds `last` without firing the listener (same as `history.listen`).
- Fires whenever `leaf.route.key !== last.route.key || path !== last.path` (so `push` to the same URL also reports `'push'`).

#### Behavior with Guards

- Listener only fires after a navigation commits; blocked navigations never invoke the listener.

---

### 9. Link parity with React Router v5 `NavLink`

#### Proposed Types & API

```ts
export interface LinkMatch {
  params: Record<string, string | undefined>;
  path: string;
  url: string;
  isExact: boolean;
}

export interface LinkLocation {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key?: string;
}

export type LinkIsActive = (
  match: LinkMatch | null,
  location: LinkLocation,
) => boolean;

export interface WebLinkComponentProps {
  href?: string;
  navigate: () => void;
  onClick?: (preview: React.MouseEvent<any>) => void;
  className?: string;
  style?: any;
  children?: React.ReactNode;
  [key: string]: any;
}

export interface CommonLinkProps<TName extends string = string> {
  // ...existing props unchanged
  /**
   * Custom active-state predicate matching React Router v5 `<NavLink isActive>`.
   * Evaluated on both web and native.
   */
  isActive?: LinkIsActive;
  /** Strict trailing-slash matching for active state (defaults to false). */
  strict?: boolean;
  /** Case-sensitive matching for active state (defaults to false). */
  sensitive?: boolean;
  /**
   * Web: custom anchor/link renderer matching React Router v5 `<Link component={...}>`.
   * Receives `{ href, navigate, onClick, className, style, children, ... }`.
   * Accepted and ignored on native so shared design-system wrappers compile unchanged.
   */
  component?: React.ComponentType<any>;
}
```

Also added to `LiteLinkProps` (`activeClassName`, `activeStyle`, `exact`, `isActive`, `component`) so `/lite` link wrappers gain the same parity.

#### Web Semantics

- `match` is computed via `matchPathPattern` / `matchPath` against the resolved target pathname with `{ exact: Boolean(exact), strict, sensitive }`.
- `location` is `{ pathname, search, hash, state, key }` from the current route.
- Active state: `isActiveProp ? Boolean(isActiveProp(match, location)) : defaultIsActive`.
- When `component` is omitted: renders `<a>` with `handleClick` (unchanged).
- When `component` is provided: renders `<Component {...props} ref={ref} href={disabled ? undefined : href} navigate={navigate} onClick={onClick}>{children}</Component>` matching React Router v5's `<Link component={...}>` contract (where `navigate` is a no-op if `disabled`).

#### Native Semantics

- Computes the exact same `(match, location)` from `useRoute()` + target pathname, and evaluates `isActiveProp(match, location)`.
- Applies `activeStyle` and `accessibilityState.selected = true` when active.
- Accepts and ignores `component`, `className`, `activeClassName`, `target`, `rel` so design-system wrappers around `<Link>` compile identically against both `src/index.web.ts` and `src/index.native.ts` (verified by a compile-time type-parity test).

#### Behavior with Guards

- Clicking `<Link>` (or invoking `navigate()` from a custom `component`) delegates to `router.navigate` / `router.push` / `router.replace`, so all leave guards and entry guards run identically.

---

### 10. Imperative access outside React & external navigation

#### Proposed Types & API

```ts
export interface ExternalNavigationOptions {
  /** On web default implementation, uses `window.location.replace` instead of `assign`. */
  replace?: boolean;
}

export interface RouterController<TName extends string = string> {
  // ...existing methods unchanged
  /**
   * Open an external URL outside the router.
   * - Web: calls `onExternal(url)` if configured, else `window.location.assign(url)` (or `replace`).
   * - Native: calls `onExternal ?? openWeb`; throws if neither is provided.
   */
  openExternal: (url: string, options?: ExternalNavigationOptions) => void;
  /**
   * Reload the current application/page.
   * - Web: calls `onReload()` if configured, else `window.location.reload()`.
   * - Native: calls `onReload()` if configured; warns and no-ops otherwise.
   */
  reload: () => void;
}

export interface ImperativeLocation {
  pathname: string;
  search: string;
  hash: string;
  query: QueryParams;
  path: string;
  state: unknown;
}

export interface ImperativeRouter<TName extends string = string>
  extends RouterController<TName> {
  getRoute: () => UnifiedRoute<TName>;
  getLocation: () => ImperativeLocation;
  subscribe: (listener: NavigationListener) => () => void;
  isReady: () => boolean;
}

export interface RouterHandle<TName extends string = string> {
  readonly current: ImperativeRouter<TName> | null;
}

/** Explicit handle passed via `<RouterProvider routerRef={ref}>` (SSR & multi-instance safe). */
export function createRouterRef<TName extends string = string>(): RouterHandle<TName>;

/**
 * Returns a stable imperative proxy for the currently mounted `<RouterProvider>`,
 * or `null` if no provider is mounted.
 */
export function getRouter<TName extends string = string>(): ImperativeRouter<TName> | null;
```

Provider props added to **both** `WebRouterProviderProps` and `NativeRouterProviderProps`:
- `routerRef?: RouterHandle<TName>`
- `onReload?: () => void`
- `onExternal?: (url: string) => void` (from Item 6)

Lite layer (`LiteRouter` & `LiteConfigValue`):
- Adds `openExternal(url, options?)` and `reload()` to `LiteRouter`, backed by `LiteConfig.onExternal` / `openWeb` and `LiteConfig.onReload`.

#### Semantics & Lifecycle (Web & Native)

- `ImperativeRouter` is a **stable proxy** backed by live refs inside the mounted `<RouterProvider>`. Capturing `const router = getRouter()` once (e.g. in Redux middleware) never goes stale across navigations or re-renders.
- Attached on mount (synchronously on client before child effects run) and detached cleanly on unmount; supports a stack of mounted providers so nested providers restore the outer provider on unmount.
- On pure server environments (SSR `renderToString`), global singleton registration is skipped to avoid cross-request leakage; use `routerRef` per request if needed.
- `getLocation()` returns `{ pathname, search, hash, query, path, state }` identically on web and native (direct replacement for `window.location.pathname` / `window.location.search` / `window.location.hash`).
- `reload()` on native: invokes `onReload?.()`. When `onReload` is not provided, logs a clear `console.warn` explaining how to wire host reload (e.g. `DevSettings.reload()`, `Updates.reloadAsync()`, or a native bridge method) and no-ops.

#### Behavior with Guards

- All imperative navigation methods (`navigate`, `push`, `replace`, `goBack`, `go`, `reset`, `openExternal`) delegate to the active controller, so all leave guards (`useNavigationGuard` / `<Prompt>`) and entry guards (Item 4) run identically to calls made inside React components.
- `reload()` runs leave guards (`action: 'unknown'` or `'goBack'`? Proposed: runs leave guards before calling `onReload` / `window.location.reload()`, so dirty forms aren't silently lost on programmatic reload).

---

## Nice to Have

### 11. Remove dependency on React Router internals (`__RouterContext`)

#### Design

- React Router v5's public `useHistory()` hook from `'react-router-dom'` calls `useContext(historyContext)` and returns `undefined` (without throwing) when called outside any `<Router>`, and returns the `history` object inside `<BrowserRouter>`, `<HashRouter>`, `<MemoryRouter>`, `<Router>`, and `<StaticRouter>`.
- Replace `import { __RouterContext } from 'react-router'` in `src/adapters/web.tsx` with `const existingHistory = useHistory()` from `'react-router-dom'`.
- `reuseExisting` becomes `useExistingRouter === true || (useExistingRouter === undefined && !history && !routerType && existingHistory != null)`.
- Eliminates all imports from React Router internals.
- Add a dedicated test verifying: (a) `useHistory()` outside `<Router>` does not throw and mounts a new router, (b) inside `MemoryRouter`, `BrowserRouter`, and `StaticRouter` it reuses the existing router, and (c) no source file in `src/` imports `__RouterContext`.

#### Behavior with Guards

- Unchanged.

---

### 12. Preact compatibility

#### Design

- Add `preact` as a **devDependency** only (zero runtime dependencies).
- Add `vitest.preact.config.ts` aliasing `react`, `react-dom`, `react-dom/test-utils`, `react/jsx-runtime`, and `react/jsx-dev-runtime` to `preact/compat` (and inlining `react-router` / `react-router-dom` so they resolve against `preact/compat`).
- Add `npm run test:preact` script and `tests/preact.test.tsx` covering:
  - `<WebRouterProvider>` (memory & controlled mode) and `<RouterView>`
  - `<Link>` (standard, `activeClassName`, `isActive`, `component`, ref forwarding)
  - `<Prompt>` & `useNavigationGuard` (blocking, string confirmation, async `proceed()`)
  - Entry guards (Item 4) & overlays (Item 2)
  - Compat hooks (`useHistory`, `useLocation`, `useParams`, `useRouteMatch`, `withRouter`, `<Redirect>`)
- Fix any `preact/compat` incompatibility discovered during testing (or document unavoidable React Router v5 / Preact quirks in README).

#### Behavior with Guards

- Tested explicitly under `preact/compat` (blocking, confirmation, async `proceed()`, and entry guards).

---

### 13. Hash round-trip on native

#### Proposed API & Behavior

- Export a helper `withHashLinking(linking)` (and apply it automatically inside `<NativeRouterProvider linking={...}>` when a custom `linking` prop is provided):
  - Wraps `getStateFromPath`: splits `#hash` off the incoming URL **before** delegating to `(linking.getStateFromPath ?? getStateFromPath)(cleanPath, config)`, then injects `__urMeta.hash` onto the focused leaf route of the returned state (so React Navigation's param parsers never receive `#hash` glued to the last param).
  - Wraps `getPathFromState`: extracts `__urMeta.hash`, strips `__urMeta` from a shallow-cloned state before delegating to `(linking.getPathFromState ?? getPathFromState)`, and appends `#${hash}` if not already present.
- In `unpackNativeRoute`: defense-in-depth fallback for states constructed directly via stock `getStateFromPath(url, config)` passed to `initialState` — if `meta.hash` is absent and the last flat query param (or last string path param when no query params exist) contains `#`, splits it into clean param value + `hash`.
- In `/lite/native.tsx`: applies the same hash split/reattach in `useLinkingHelpers()` and excludes internal hash metadata from `useParams()`.

#### Web & Native Semantics

- Hashes round-trip identically on web and native across `navigate`, `replace`, `initialUrl`, `createLinking`, custom `linking` configs, direct `initialState`, and `/lite`.

#### Behavior with Guards

- Hash-only changes (`pathname` unchanged) continue to pass leave guards without prompting on both platforms.

---

### 14. Migration aid (codemod)

#### Design & CLI

- Implemented in `codemod/migrate.ts` using the already-installed `typescript` compiler API (**zero new dependencies**), runnable via `npm run codemod -- <paths...> [options]`.
- Options:
  - `--write`: apply changes in place (default is dry-run diff/summary).
  - `--report-only`: only print unsupported-usage audit report without modifying files.
  - `--json`: emit machine-readable JSON report.
  - `--package <name>`: target adapter package (default `'react-router-navigation-adapter'`).
- **Import rewrites (from BOTH `'react-router'` and `'react-router-dom'`):**
  - Rewrites named imports of: `useHistory`, `useLocation`, `useParams`, `useRouteMatch`, `withRouter`, `matchPath`, `generatePath`, `Link`, `Redirect` (plus `Prompt` and type `RouteComponentProps`).
  - Preserves aliases (`Link as RRLink`), type-only modifiers, and any remaining non-migrated imports (`Route`, `Switch`, `BrowserRouter`, etc.) on the original module.
  - Merges into an existing adapter import if the file already imports from it, and deduplicates when a file imports from both `'react-router'` and `'react-router-dom'`.
- **Audit report categories (file:line:col + code snippet + migration hint):**
  1. `path-array`: `<Route path={[...]}>` (maps to `defineRoutes` `path: [...]`, Item 1).
  2. `non-trailing-wildcard`: path patterns with `*` not in the last segment, e.g. `*/preview/:id` (maps to `overlay: true`, Item 2).
  3. `route-render`: `<Route render={...}>` or function `children` (refactor to `component` or route entry `guard`).
  4. `navlink-is-active`: `<NavLink>` / `isActive` prop usage (migrate to adapter `<Link isActive={...} activeClassName={...} exact>`).
  5. `window-location`: `window.location.*` / `globalThis.location.*` reads & method calls (migrate to `getRouter().getLocation()` / `openExternal()` / `reload()`, Item 10).
  6. `window-history`: `window.history.*` calls (migrate to `useRouter()` / `getRouter()`).

#### Behavior with Guards

- N/A (static source-transformation and reporting tool).

---

### 15. `LICENSE` file

- Add a root `LICENSE` file with the standard MIT License text matching `"license": "MIT"` in `package.json`.

---

## Verification Plan (Per Item After Approval)

For each item (1 → 15, implemented one at a time):
1. Implement code changes with full TypeScript types across web and native (and `/lite` where applicable).
2. Add scenarios to the shared parity test suite running against:
   - Web React Router v5 (`MemoryRouter` and `BrowserRouter` history)
   - Native React Navigation 7 (`StackRouter` and `TabRouter` navigators)
3. Update `README.md` with documentation for the item and add a changelog entry.
4. Run gate: `npm run typecheck`, `npm test`, `npm run build` (plus `npm run test:preact` once Item 12 is added) and report pass/fail counts against the 176-test baseline.
