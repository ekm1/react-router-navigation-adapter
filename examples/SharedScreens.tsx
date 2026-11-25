import { Pressable, Text, View } from 'react-native';
import { Link, withRouter, type RouteComponentProps } from '../src/index';
import { useNavigationGuard, useParams, useQuery, useRoute, useRouter } from './hooks';

/**
 * Screens written once with React Native primitives (react-native-web on web)
 * against the common routing interface.
 */
export function MyBetsScreen() {
  const router = useRouter();
  return (
    <View>
      <Text>My Bets ({router.platform})</Text>
      <Pressable onPress={() => router.navigate('Ticket', { id: 42 }, { query: { type: 'million' } })}>
        <Text>Open ticket 42</Text>
      </Pressable>
      <Link to="Settled" activeStyle={{ fontWeight: 'bold' }}>
        <Text>Settled</Text>
      </Link>
      {/* Not a native route: opens the WebView on native via `openWeb`. */}
      <Link to="Promotions">
        <Text>Promotions</Text>
      </Link>
    </View>
  );
}

export function SettledScreen() {
  return (
    <View>
      <Text>Settled bets</Text>
    </View>
  );
}

export function TicketScreen() {
  const router = useRouter();
  const route = useRoute();
  const { id } = useParams<{ id: string }>();
  const { type = 'single' } = useQuery<{ type?: string }>();
  useNavigationGuard(false, 'Discard your changes?');

  return (
    <View>
      <Text>Ticket #{id} ({type})</Text>
      <Text>URL: {route.path}</Text>
      {/* Adds a history entry on both platforms; back returns here. */}
      <Pressable onPress={() => router.navigate('Ticket', { id: String(Number(id) + 1) })}>
        <Text>Next ticket</Text>
      </Pressable>
      {/* At the root (opened from a deep link) this calls onBackAtRoot, or goes to `parent`. */}
      <Pressable onPress={() => router.goBack()}>
        <Text>Back</Text>
      </Pressable>
      <TicketFilters />
    </View>
  );
}

/** Existing React Router v5 style code keeps working on both platforms. */
const TicketFilters = withRouter(({ history, location }: RouteComponentProps) => (
  <Pressable onPress={() => history.replace({ search: '?type=million' })}>
    <Text>Filter: {location.search || 'none'}</Text>
  </Pressable>
));

export function PromotionsPage() {
  return (
    <View>
      <Text>Promotions (web only)</Text>
    </View>
  );
}
