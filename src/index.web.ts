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
// React Router v5 API for drop-in call sites; on native the same names come from the compat layer.
export { useHistory, useLocation, withRouter } from 'react-router-dom';
export type { RouteComponentProps } from 'react-router-dom';
export type * from './types';
