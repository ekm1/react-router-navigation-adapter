import { createTypedRouterHooks, defineRoutes } from '../src/index';

export const routes = defineRoutes({
  Home: {
    path: '/',
    options: { title: 'Home' },
  },
  UserProfile: {
    path: '/users/:id',
    parse: { id: Number },
    stringify: { id: (id: number) => String(id) },
    options: { title: 'Profile' },
  },
  Settings: {
    path: '/settings/:section?',
    options: { title: 'Settings' },
  },
});

export const {
  useRouter,
  useRoute,
  useParams,
  useQuery,
  useIsFocused,
  useFocusEffect,
  useNavigationGuard,
} = createTypedRouterHooks(routes);
