import { createTypedRouterHooks } from '../src/index';
import type { RouteName } from './routes';

// Type-only import: no cycle between routes.ts and the screens.
export const { useRouter, useRoute, useParams, useQuery, useNavigationGuard } =
  createTypedRouterHooks<RouteName>();
