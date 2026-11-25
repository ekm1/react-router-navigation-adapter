/**
 * Compact layer (web): one URL-based routing API for shared modules, on top of routes the app
 * defines the normal way. No route registry, no provider (`<LiteConfig>` is optional).
 */
export {
  Link,
  useFocusEffect,
  useIsFocused,
  useLocation,
  useNavigationGuard,
  useNavigationListener,
  useParams,
  useQuery,
  useRouter,
} from './web';
export { LiteConfig } from './shared';
export type { LiteConfigValue, LiteGuard, LiteLinkProps, LiteLocation, LiteRouter, LiteTo } from './shared';
export type { GetUserConfirmation, NavigationGuardCallback, NavigationGuardContext, QueryInput, QueryParams, SetQueryOptions } from '../types';
