import { defineRoutes } from '../src/index.web';
import { RouterProvider, RouterView } from '../src/index.web';
import {
  HomeScreen,
  SettingsScreen,
  UserProfileScreen,
} from './SharedScreens';

const webRoutes = defineRoutes({
  Home: { path: '/', component: HomeScreen },
  UserProfile: {
    path: '/users/:id',
    parse: { id: Number },
    stringify: { id: (id: number) => String(id) },
    component: UserProfileScreen,
  },
  Settings: { path: '/settings/:section?', component: SettingsScreen },
});

/**
 * Web entrypoint: uses React Router v5 (<BrowserRouter>, <Switch>, <Route>, <a href>).
 */
export function WebApp() {
  return (
    <RouterProvider routes={webRoutes}>
      <RouterView fallback={() => <div>404 Not Found</div>} />
    </RouterProvider>
  );
}
