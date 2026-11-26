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
export { createRouterRef, getRouter } from './imperative';
export { Redirect } from './components/Redirect.web';
export { Link } from './components/Link.web';
export { RouterView } from './components/RouterView.web';
export type { WebRouterViewProps as RouterViewProps } from './components/RouterView.web';
export {
  WebRouterProvider as RouterProvider,
  WebRouterProvider,
} from './adapters/web';
export type {
  ControlledLocation,
  ControlledNavigateAction,
  ControlledNavigateIntent,
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
export {
  generatePath,
  matchPath,
  useHistory,
  useLocation,
  useRouteMatch,
  withRouter,
} from 'react-router-dom';
export type { RouteComponentProps } from 'react-router-dom';
// Our own <Prompt> (not React Router's): it shares the adapter's single history.block.
export { Prompt } from './components/Prompt';
export type { PromptProps } from './components/Prompt';
export type * from './types';
