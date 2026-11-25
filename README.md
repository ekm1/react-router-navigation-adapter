# react-router-navigation-adapter

One routing interface for shared screens, backed by:

- **Web:** React Router v5 (`react-router-dom@^5.2`)
- **Native:** React Navigation 7 (`@react-navigation/native@^7`, e.g. with `native-stack`)

Routes are defined once as URL patterns. On web they are React Router routes; on native the
`native: true` ones are React Navigation screens and everything else opens in your WebView.

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
| `parent` | Where `goBack()` goes when there is no history (deep link), unless `onBackAtRoot` handles it. A target or `(route) => target`. |
| `parse` / `stringify` | Convert path params (e.g. `parse: { id: Number }`). |
| `exact`, `strict`, `sensitive`, `options` | As in React Router / React Navigation screen options. |

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
| `initialUrl` | Opens at a path. Query and hash are parsed the same way as on web. A non-native URL calls `openWeb`. |
| `openWeb(url)` | Receives every target that is not a `native: true` route with a mounted screen, including unregistered URLs. Without it, such navigation throws. |
| `onBackAtRoot({ route, router })` | `goBack()` and Android hardware back when nothing can go back. Defaults to the route's `parent`. Web has the same prop. |
| `getUserConfirmation(message, cb)` | Confirmation for string guards. Default: `Alert.alert` (Cancel/Leave). Web default: `window.confirm`. |
| `linkingPrefixes` | Enables a generated `linking` config (`createLinking(routes, prefixes, openWeb)` is exported for custom containers). |
| `independent` | Wraps its container in `NavigationIndependentTree`. |
| `useExistingContainer` | Attaches to an ancestor `NavigationContainer`. This is the default when one exists. |

Opening from a path also works with your own linking config: React Navigation puts query params
flat into `route.params`, and the adapter reads every non-path param as query.

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
| `goBack()` / `canGoBack()` | With no history: `onBackAtRoot`, else `parent`. |
| `setQuery(query, { merge = true, replace = true })` | `null` deletes a key. |
| `setParams`, `reset(targets, index?)`, `buildUrl(target)` | |
| `useRoute()`, `useParams()`, `useQuery()` | `{ name, path, pathname, params, query, hash, state, key, matchedPattern }`. Params that are not path params are query params. |
| `useNavigationGuard(when, message \| handler)` | Async `context.proceed()` is supported. Native uses `usePreventRemove`, so native-stack also blocks the iOS swipe-back. Web uses one `history.block` plus `beforeunload`. `reset()` is guarded on both. Query-only changes are not. |
| `useNavigationListener((route, action) => ...)` | Like `history.listen` (analytics). Works outside screens. |
| `useIsActive(target, params?, { exact })` | `NavLink`-style active state. |
| `useIsFocused()`, `useFocusEffect()` | |
| `<Link>` | Web `<a href>` (basename-aware, modifier clicks). Native `<Pressable accessibilityRole="link">`. Accepts `activeClassName` (web), `activeStyle` and `exact`. |
| `<Redirect>`, `<RouterView>` | |

### React Router v5 call sites

`useHistory`, `useLocation` and `withRouter` are exported from the package. On web they are React
Router's own. On native they are implemented on the common interface, so code like this runs
unchanged on both platforms:

```tsx
export default withRouter(({ history, location, match }) => (
  <Filters onChange={(type) => history.replace({ search: `?type=${type}` })} />
));
```

On native, `history` supports `push`, `replace`, `go(-n)`, `goBack`, `listen`, `action`,
`location` and `createHref`. `match.params` holds raw strings. There is no `history.block`
(use `useNavigationGuard`), and `goForward` does nothing.

## Known differences

- **Guards and pushes on native.** Pushing a screen on top of a guarded screen is not blocked on native (the screen stays mounted), while web blocks leaving the page.
- **`reset()` on web** cannot delete browser history, so the browser back button can still reach entries from before the reset. `canGoBack()` does account for the reset.
- **Flat navigators only.** `initialUrl` and the generated linking assume the `<RouterView>` navigator is the root. Nested navigators (tabs → stack) are not described by the registry.
- **`state`** is stored in route params on native, so keep it serializable.
- **Hashes** from a custom linking config stay attached to the last query value (React Navigation does not split them). `initialUrl` and `createLinking` handle hashes.

## Development

```bash
npm ci        # .npmrc sets legacy-peer-deps (react-native is mocked in tests)
npm run typecheck
npm test
npm run build
```

Tests run every shared scenario against both adapters: React Router v5 (memory history) and
React Navigation 7.5.2 with a stack navigator built on the real `StackRouter`. That navigator
reads `preventedRoutes` the same way native-stack does.
