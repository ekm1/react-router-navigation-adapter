import {
  RouterProvider,
  RouterView,
  defineRoutes,
  type NativeNavigatorLike,
} from '../src/index.native';
import {
  HomeScreen,
  SettingsScreen,
  UserProfileScreen,
} from './SharedScreens';

const nativeRoutes = defineRoutes({
  Home: { path: '/', component: HomeScreen, options: { title: 'Home' } },
  UserProfile: {
    path: '/users/:id',
    parse: { id: Number },
    stringify: { id: (id: number) => String(id) },
    component: UserProfileScreen,
    options: { title: 'Profile' },
  },
  Settings: {
    path: '/settings/:section?',
    component: SettingsScreen,
    options: { title: 'Settings' },
  },
});

/**
 * Native entrypoint: uses React Navigation (<NavigationContainer> + your Stack/Tab navigator).
 * Pass e.g. `const Stack = createNativeStackNavigator();` from `@react-navigation/native-stack`.
 */
export function NativeApp({ navigator }: { navigator: NativeNavigatorLike }) {
  return (
    <RouterProvider
      routes={nativeRoutes}
      linkingPrefixes={['myapp://', 'https://example.com']}
    >
      <RouterView navigator={navigator} initialRouteName="Home" />
    </RouterProvider>
  );
}
