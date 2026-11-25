export { defineRoutes } from './routeRegistry';
export {
  useRouter,
  useRoute,
  useParams,
  useQuery,
  useIsFocused,
  useFocusEffect,
  useNavigationGuard,
  useNavigationListener,
  useIsActive,
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
// React Router v5 compatible API (useHistory/useLocation/withRouter) built on the common interface.
export {
  generatePath,
  matchPath,
  useHistory,
  useLocation,
  useRouteMatch,
  withRouter,
} from './compat.native';
export type {
  CompatHistory,
  CompatLocation,
  CompatMatch,
  MatchPathOptions,
  RouteComponentProps,
  WithRouterProps,
} from './compat.native';
export { Prompt } from './components/Prompt';
export type { PromptProps } from './components/Prompt';
export { createLinking, getStateFromUrl, unpackNativeRoute } from './adapters/native';
export type * from './types';
