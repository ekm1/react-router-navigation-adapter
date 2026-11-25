import { useState } from 'react';
import { Link } from '../src/index';
import {
  useNavigationGuard,
  useParams,
  useQuery,
  useRoute,
  useRouter,
} from './routes';

/**
 * Shared screens written once against the common routing interface.
 * On Web this runs on React Router v5; on Native this runs on React Navigation.
 */
export function HomeScreen() {
  const router = useRouter();

  return (
    <div>
      <h1>Home ({router.platform})</h1>
      <button
        onClick={() =>
          router.navigate('UserProfile', { id: 42 }, { query: { tab: 'posts' } })
        }
      >
        Open User #42
      </button>
      <Link to="Settings" params={{ section: 'billing' }}>
        Billing Settings
      </Link>
    </div>
  );
}

export function UserProfileScreen() {
  const router = useRouter();
  const route = useRoute();
  const { id } = useParams<{ id: number }>();
  const { tab = 'overview' } = useQuery<{ tab?: string }>();

  return (
    <div>
      <h1>User #{id}</h1>
      <p>Active URL: {route.path}</p>
      <p>Tab: {tab}</p>
      <button onClick={() => router.setQuery({ tab: 'activity' })}>
        Switch Tab
      </button>
      {router.canGoBack() && (
        <button onClick={() => router.goBack()}>Back</button>
      )}
    </div>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const { section = 'general' } = useParams<{ section?: string }>();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useNavigationGuard(hasUnsavedChanges, 'Discard unsaved settings?');

  return (
    <div>
      <h1>Settings: {section}</h1>
      <button onClick={() => setHasUnsavedChanges((v) => !v)}>
        Toggle Dirty ({String(hasUnsavedChanges)})
      </button>
      <button onClick={() => router.goBack()}>Back</button>
    </div>
  );
}
