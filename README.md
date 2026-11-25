# react-router-navigation-adapter

One routing interface for shared screens, backed by:

- **Web:** React Router v5 (`react-router-dom@^5.2`)
- **Native:** React Navigation 7 (`@react-navigation/native@^7`, e.g. with `native-stack`)

There are two layers. Pick one per app:

- **Full layer** (`react-router-navigation-adapter`): routes are defined once as URL patterns.
  On web they are React Router routes; on native the `native: true` ones are React Navigation
  screens and everything else opens in your WebView. Covers nested navigators, the React Router
  v5 compat API and guards everywhere. Most of this README.
- **Compact layer** (`react-router-navigation-adapter/lite`): apps keep defining routes the normal
  way, and shared modules/libraries use one small URL-based API. See [Compact layer](#compact-layer).

## Define routes once

```ts
import { defineRoutes } from 'react-router-navigation-adapter';

export const routes = defineRoutes({
  MyBets: { path: '/myBets', component: MyBetsScreen, native: true },
  Settled: { path: '/myBets/settled', component: SettledScreen, native: true },
  Ticket: { path: '/myBets/:id', component: TicketScreen, native: true, parent: 'MyBets' },
  Promotions: { path: '/promotions', component: PromotionsPage }, // web only
});
```

| Option | Meaning |
| --- | --- |
| `path` | `/static`, `/:param`, `/:param?` and a trailing `/*`. Other syntax (`:id(\d+)`, `:a-:b`) throws, because React Router and React Navigation would match it differently. |
| `native` | Native only: the route has a screen. Without it, navigation goes to `openWeb(url)`. |
| `nestedIn` | Native only: route names of the navigators the screen is nested in, outermost first (e.g. `['Tabs', 'BetsTab']`). See [Nested navigators](#nested-navigators). |
| `parent` | Where `goBack()` goes when there is no history (deep link), unless `onBackAtRoot` handles it. A target or `(route) => target`. |
| `parse` / `stringify` | Convert path params (e.g. `parse: { id: Number }`). |
| `exact`, `strict`, `sensitive`, `options` | As in React Router / React Navigation screen options. With `exact: false`, `/bets` matching `/bets/123` keeps the full URL. |

Matching is first-match in declaration order, like React Router's `<Switch>`: declare
`/myBets/settled` before `/myBets/:id`. `defineRoutes` warns when a static route is unreachable.

## Mount it

**Web.** Inside an existing React Router v5 `<Router>` (e.g. the MFE's history), it attaches to it.
Otherwise it mounts a `<BrowserRouter>` (or `routerType="hash" | "memory"`, or `history={...}`).

```tsx
<RouterProvider routes={routes}>
  <RouterView fallback={NotFound} />
</RouterProvider>
```

**Native.**

```tsx
const Stack = createNativeStackNavigator();

<RouterProvider
  routes={routes}
  initialUrl="/myBets/42?type=million" // the path the host opens at
  openWeb={(url) => host.openWebView(url)} // WebView boundary
  onBackAtRoot={() => host.close()} // goBack() / Android back with no history
>
  <RouterView navigator={Stack} />
</RouterProvider>
```

| Native prop | |
| --- | --- |
| `initialUrl` | Opens at a path (also `myapp://myBets/42` style URLs). Query and hash are parsed the same way as on web. A non-native URL calls `openWeb`. In a reused host container, the provider navigates to it once the screen's navigator is mounted. |
| `openWeb(url)` | Receives every target that is not a `native: true` route with a mounted screen, including unregistered URLs. Without it, such navigation throws. |
| `onBackAtRoot({ route, router })` | `goBack()` and Android hardware back when nothing can go back. Defaults to the route's `parent`. Web has the same prop. |
| `getUserConfirmation(message, cb)` | Confirmation for string guards. Default: `Alert.alert` (Cancel/Leave). Web default: `window.confirm`. |
| `linkingPrefixes` | Enables a generated `linking` config (`createLinking(routes, prefixes, openWeb)` is exported for custom containers). |
| `independent` | Wraps its container in `NavigationIndependentTree`. |
| `useExistingContainer` | Attaches to an ancestor `NavigationContainer`. This is the default when one exists. |

Opening from a path also works with your own linking config: React Navigation puts query params
flat into `route.params`, and the adapter reads every non-path param as query.

### Nested navigators

Mounted navigators (tabs, drawers, nested stacks) are found automatically, including inactive
tabs. To deep-link into a nested screen, or to navigate into a tab that has not been opened yet,
declare where each screen lives with `nestedIn`. Each nested navigator renders its own routes
with `scope`, and `children` adds the screens that hold the nested navigators:

```tsx
const routes = defineRoutes({
  Feed: { path: '/', component: Feed, native: true, nestedIn: ['Tabs', 'HomeTab'] },
  Ticket: { path: '/myBets/:id', component: Ticket, native: true, nestedIn: ['Tabs', 'BetsTab'] },
  Settings: { path: '/settings', component: Settings, native: true }, // root stack
});

const BetsTab = () => <RouterView navigator={BetsStack} scope={['Tabs', 'BetsTab']} />;
const HomeTab = () => <RouterView navigator={HomeStack} scope={['Tabs', 'HomeTab']} />;
const Tabs = () => (
  <Tab.Navigator>
    <Tab.Screen name="HomeTab" component={HomeTab} />
    <Tab.Screen name="BetsTab" component={BetsTab} />
  </Tab.Navigator>
);

<RouterView navigator={RootStack} initialRouteName="Tabs">
  <RootStack.Screen name="Tabs" component={Tabs} />
</RouterView>;
```

Navigating to a screen in another branch dispatches React Navigation's nested
`navigate('Tabs', { screen: 'BetsTab', params: { screen: 'Ticket', params } })` from the deepest
focused navigator. Within the focused stack it pushes, as before. `initialUrl` and
`createLinking` build the nested state and nested `screens` config. Back across tabs follows the
tab navigator's `backBehavior`. Web `<RouterView>` accepts `scope` and `children` and ignores them, so the same
layout code compiles on both platforms.

## Use it in shared screens

```ts
const router = useRouter();
router.navigate('Ticket', { id: 2 }, { query: { type: 'million' } });
router.navigate('/myBets/2?type=million'); // or a URL, or { name, params, query, hash, state }
```

| API | Both platforms |
| --- | --- |
| `navigate(target)` | Adds a history entry (web `history.push`, native stack `push`). The current location is updated in place instead. Ticket 1 → ticket 2 → back returns to ticket 1 on both. |
| `push(target)` | Always adds an entry. |
| `replace(target)` | Replaces the entry. The same route is updated in place (the screen stays mounted). |
| `goBack()` / `canGoBack()` | With no history: `onBackAtRoot` (guarded), else `parent`. |
| `go(-n)` / `getLength()` | Back n entries in one guarded action (native `StackActions.pop(n)`). Going further back than the history allows calls `onBackAtRoot` (else `parent`) on both platforms. |
| `setQuery(query, { merge = true, replace = true })` | `null` deletes a key. |
| `reset(targets, index?)` | Replaces the history with `targets` up to `index` (default: the last). `index` counts positions in `targets` on both platforms. On native, entries without a native screen are left out of the stack; when the indexed entry is one, the stack is reset to the native entries before it and the entry opens through `openWeb`. |
| `setParams`, `buildUrl(target)` | |
| `useRoute()`, `useParams()`, `useQuery()` | `{ name, path, pathname, params, query, hash, state, key, matchedPattern }`. Params that are not path params are query params. |
| `useNavigationGuard(when, message \| handler)` | Blocks leaving the current location by any route: navigate/push/replace, back (also at the root before `onBackAtRoot`), `reset`, `go(-n)`, `setParams`/same-route `replace` that change the pathname, and native `openWeb`. Query-only changes pass. Works in screens and in layouts outside screens. Async `context.proceed()` is supported. `context.action` is the same on both platforms: `'navigate'`, `'push'`, `'replace'` (also `setParams`), `'reset'`, or `'goBack'` for every kind of going back (back button, swipe, `goBack()`, `go(-n)`, native pops; `'pop'` is deprecated and no longer reported). `context.nextPath` is the target URL when known: undefined for going back, and for targets outside the route registry (e.g. a host-only screen), never a made-up URL; React Navigation's nested `{ screen, params }` targets resolve to the nested screen's URL. A guard applies while its screen is focused (on web a covered screen is unmounted). Native also uses `usePreventRemove`, so native-stack blocks the iOS swipe-back, and Android hardware back. Web uses one `history.block` plus `beforeunload`. |
| `useNavigationListener((route, action) => ...)` | Like `history.listen` (analytics). Works outside screens. |
| `useIsActive(target, params?, { exact })` | `NavLink`-style active state. |
| `useIsFocused()`, `useFocusEffect()` | |
| `<Link>` | Web `<a href>` (basename-aware, modifier clicks). Native `<Pressable accessibilityRole="link">`. Accepts `activeClassName` (web), `activeStyle` and `exact`. Forwards its ref and other `<a>` / `Pressable` props. |
| `<Prompt when message>` | React Router v5's `<Prompt>` API on the guard above (message string, or `(location, action) => string \| boolean`). |
| `<Redirect>` | On web it is React Router's own `<Redirect>`, so it works with `StaticRouter` (SSR) and redirects in the first commit. |
| `<RouterView>` | |

### React Router v5 call sites

`useHistory`, `useLocation`, `useRouteMatch`, `withRouter`, `matchPath`, `generatePath` and
`<Prompt>` are exported from the package. On web the first six are React Router's own; on native
they are implemented on the common interface, so code like this runs unchanged on both platforms:

```tsx
export default withRouter(({ history, location, match }) => (
  <Filters onChange={(type) => history.replace({ search: `?type=${type}` })} />
));
```

On native, `history` supports `push`/`replace` (absolute, `?search`, `#hash` and relative paths
like `'42'` or `'../promotions'`), `go(-n)`, `goBack`, `block(prompt)`, `listen`, `action`,
`length`, `location` and `createHref`; `goForward` does nothing. `match.params` holds raw strings.
`withRouter` supports `wrappedComponentRef`, `WrappedComponent` and hoists statics. `useRouteMatch()`
reports `url` and `isExact` like React Router (for `exact: false` routes: the matched prefix). `matchPath`,
`generatePath` and `useRouteMatch(path)` use the adapter's path syntax.

`<Prompt>` is the adapter's own on both platforms. history v4 allows only one prompt at a time, so
on web the adapter also routes `history.block` (including React Router's own `<Prompt>`) on its
history instance into its guard list while mounted, instead of letting one replace the other.

## Compact layer

For apps that define routes the normal way and only want a common API in shared modules and
libraries. There is no `defineRoutes` and no provider:

- **Web:** the app's React Router v5 `<Router>` and `<Route>`s.
- **Native:** the app's `NavigationContainer`, navigators and its `linking.config` (the same
  config used for deep links). URLs are turned into navigation actions with React Navigation's
  `getStateFromPath` / `getActionFromState`, and the current screen's URL comes from
  `getPathFromState`, respecting custom `getStateFromPath`/`getPathFromState` in `linking`.

```tsx
import { Link, useLocation, useNavigationGuard, useParams, useRouter } from 'react-router-navigation-adapter/lite';

export function TicketActions({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const { query } = useLocation(); // { pathname, search, hash, query, path }
  const { id } = useParams<{ id?: string }>();
  useNavigationGuard(dirty, 'Discard your bet slip changes?');
  return (
    <>
      <Pressable onPress={() => router.setQuery({ type: 'million' })} />
      <Pressable onPress={() => router.navigate(`/myBets/${Number(id) + 1}`)} />
      <Pressable onPress={() => router.goBack('/myBets')} />
      <Link to="/myBets/settled">Settled</Link>
    </>
  );
}
```

Optionally, the app wraps its tree in `<LiteConfig>` (from the same entry):

```tsx
<LiteConfig openWeb={(url) => host.openWebView(url)} onBackAtRoot={() => host.close()} getUserConfirmation={confirm}>
```

| API | Both platforms |
| --- | --- |
| `useRouter()` | `navigate(to)` adds an entry (web `history.push`, native stack `push`), and navigating to the current URL updates it in place. `push(to)` always adds one. `replace(to)` replaces it; the same screen is updated in place. Also `goBack(fallback?)`, `canGoBack()`, `setQuery(query, { merge = true, replace = true })` and `location`. `to` is a URL (`'/myBets/42?type=million'`, `'?type=acca'`, `'#legs'`) or `{ pathname?, query?, hash? }`. |
| `goBack(fallback?)` with no history | `<LiteConfig onBackAtRoot>` (guarded), else `replace(fallback)` when given. |
| `useLocation()`, `useQuery()` | `{ pathname, search, hash, query, path }`. |
| `useParams()` | Path params: React Router's `useParams()` on web; on native, the route params that are not query params. Strings, unless the native linking config `parse`s them. |
| `useNavigationGuard(when, message \| handler)` | Blocks leaving the current pathname (query-only changes pass): back, pushes, replaces, `goBack()` at the root and native `openWeb`. Native uses `usePreventRemove`, so native-stack also blocks the iOS swipe-back; use it inside a screen. Web shares one `history.block` among all guards on a history. |
| `useNavigationListener((location) => ...)` | Every URL change, not the initial one, like `history.listen`. |
| `<Link to>` | React Router's `<Link>` on web (real `<a href>`); `<Pressable accessibilityRole="link">` on native. |
| `useIsFocused()`, `useFocusEffect()` | |

On native, a URL the linking config does not match goes to `<LiteConfig openWeb>` (without it,
it throws). A screen in the current stack is pushed (or replaced) there; anything else, such as a
screen in another tab, is navigated to with the linking config's own action, like `useLinkTo`.

What the compact layer leaves out, compared with the full layer:
- No route names, `state`, `reset` or `go(-n)`: it is URL based only.
- Web `canGoBack()` cannot tell the app's own history from earlier sites: on browser history it
  is `window.history.length > 1`. Back at the root after a deep link in a new tab is detected.
- A blocked browser back/forward is replayed as back.
- On native, navigation outside the layer (a host's `navigation.navigate`, tab presses) and guards
  outside screens are not intercepted.
- Use one layer per app: the full layer's provider also routes `history.block` on web.

## Known differences (full layer)

- **Navigation outside the adapter on native.** Guards see navigation through the adapter (`useRouter`, `<Link>`, `history`, back buttons) and screen removal (swipe, hardware back). A host's direct `navigation.navigate(...)` or a tab bar press that only switches tabs is not intercepted. Layout guards (outside screens) cannot block the iOS swipe-back gesture; put the guard in the screen for that.
- **`history.block` on native** is global like React Router's, but as it is not tied to a screen it cannot block the iOS swipe-back; prefer `<Prompt>` / `useNavigationGuard` in the screen.
- **`history.go(-n)` past the start** calls `onBackAtRoot` through the adapter's `router.go` on both platforms and through native `history.go`; React Router's own web `history.go` (compat on web) clamps instead.
- **`reset()` with web-only entries** keeps them out of the native stack: back from a native entry after such a reset skips them, while web history keeps them.
- **Web history before a reload** is unknown to the adapter: replaying a blocked back/forward to such an entry assumes back.
- **`reset()` on web** cannot delete browser history, so the browser back button can still reach entries from before the reset. `canGoBack()` does account for the reset.
- **Nested deep links** need `nestedIn` and assume the outermost `<RouterView>` navigator is the root of the container (`initialUrl` in a reused host container navigates instead).
- **`state`** is stored in route params on native, so keep it serializable.
- **Hashes** from a custom linking config stay attached to the last query value (React Navigation does not split them). `initialUrl` and `createLinking` handle hashes.

## Development

```bash
npm ci        # .npmrc sets legacy-peer-deps (react-native is mocked in tests)
npm run typecheck
npm test
npm run build
```

Tests run every shared scenario against both adapters: React Router v5 (memory and real browser
history in jsdom) and React Navigation 7.5.2 with stack and tab navigators built on the real
`StackRouter` / `TabRouter`. The stack reads `preventedRoutes` the same way native-stack does.
The compat tests run React Router's own APIs on web against the native compat layer.
