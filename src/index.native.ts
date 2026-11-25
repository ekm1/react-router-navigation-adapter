export { defineRoutes } from './routeRegistry';
export {
  useRouter,
  useRoute,
  useParams,
  useQuery,
  useIsFocused,
  useFocusEffect,
  useNavigationGuard,
  useRouteRegistry,
  createTypedRouterHooks,
} from './hooks';
export { Redirect } from './components/Redirect';
export { Link } from './components/Link.native';
export { RouterView } from './components/RouterView.native';
export type {
  NativeNavigatorLike,
  NativeRouterViewProps as RouterViewProps,
} from './components/RouterView.native';
export {
  NativeRouterProvider as RouterProvider,
  NativeRouterProvider,
} from './adapters/native';
export type {
  NativeRouterProviderProps as RouterProviderProps,
  NativeRouterProviderProps,
} from './adapters/native';
export {
  compilePathPattern,
  extractParamNames,
  formatRelativeUrl,
  generatePathFromPattern,
  matchPathPattern,
  normalizeHash,
  normalizePathname,
  normalizeQueryInput,
  parseQueryString,
  parseRelativeUrl,
  stringifyQueryParams,
} from './pathUtils';
export type * from './types';
