# react-router-navigation-adapter

A lightweight, strongly-typed compatibility layer providing a **single common routing interface** backed by:

- **Web:** React Router v5 (`react-router-dom@^5.2`)
- **Native:** React Navigation (`@react-navigation/native@^6 || ^7`)

## Architecture

React Router v5 is URL-centric (`/users/42?tab=posts#bio`), while React Navigation is screen-name + params-centric (`navigation.navigate('UserProfile', { id: 42 })`).

`react-router-navigation-adapter` bridges the two via a single shared **Route Registry** (`defineRoutes(...)`) that bidirectionally translates between route names, typed params, query strings, hashes, and URLs—and generates React Navigation `linking` config automatically so native deep links match your web URLs.

### Platform Resolution
- Metro / React Native automatically picks `src/index.native.ts` (via `package.json` `"react-native"` and `"exports"."."."react-native"`).
- Webpack / Vite / Browser bundlers pick `dist/index.web.js` (via `"browser"` / `.web` extensions).
- Explicit subpath imports are also available: `react-router-navigation-adapter/web` and `react-router-navigation-adapter/native`.

## Quick Start

### 1. Define routes once
```ts
import { defineRoutes, createTypedRouterHooks } from 'react-router-navigation-adapter';

export const routes = defineRoutes({
  Home: { path: '/', component: HomeScreen },
  UserProfile: {
    path: '/users/:id',
    parse: { id: Number },
    stringify: { id: (id: number) => String(id) },
    component: UserProfileScreen,
    options: { title: 'Profile' },
  },
  Settings: { path: '/settings/:section?', component: SettingsScreen },
});

export const { useRouter, useRoute, useParams, useQuery } =
  createTypedRouterHooks(routes);
```

### 2. Mount `<RouterProvider>` + `<RouterView>`
- **Web (`App.web.tsx`):** wraps React Router v5 `<BrowserRouter>` (or reuses your existing `<Router>` automatically) and renders `<Switch>` + `<Route>`.
- **Native (`App.native.tsx`):** wraps React Navigation `<NavigationContainer>` (with auto-generated `linking` config) and binds routes into any navigator (`createNativeStackNavigator`, `createStackNavigator`, `createBottomTabNavigator`, etc.).

### 3. Use the same API in all shared screens
- **Navigation actions (`useRouter()`):** `navigate`, `push`, `replace`, `goBack`, `canGoBack`, `reset`, `setParams`, `setQuery`, `buildUrl`
  - Accepts route name (`navigate('UserProfile', { id: 42 }, { query: { tab: 'posts' } })`), target object (`{ name, params, query, hash, state }`), or raw URL (`navigate('/users/42?tab=posts')`).
- **Route state hooks:** `useRoute()`, `useParams()`, `useQuery()`, `useIsFocused()`, `useFocusEffect()`
- **Navigation guard:** `useNavigationGuard(when, messageOrCallback)` (maps to React Router v5 `history.block` on web and React Navigation `beforeRemove` on native)
- **Components:** `<Link>` (`<a href>` on web, `<Pressable accessibilityRole="link">` on native), `<Redirect>`, `<RouterView>`

## Scripts
```bash
npm run typecheck
npm run build
npm test
```
