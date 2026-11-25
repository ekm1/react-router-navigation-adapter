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
export { Link } from './components/Link.web';
export { RouterView } from './components/RouterView.web';
export type { WebRouterViewProps as RouterViewProps } from './components/RouterView.web';
export {
  WebRouterProvider as RouterProvider,
  WebRouterProvider,
} from './adapters/web';
export type {
  WebRouterProviderProps as RouterProviderProps,
  WebRouterProviderProps,
} from './adapters/web';
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
