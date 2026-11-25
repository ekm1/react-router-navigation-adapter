import { Pressable, Text, View } from 'react-native';
import { Link, useLocation, useNavigationGuard, useParams, useRouter } from '../../src/lite';

/**
 * A component from a shared library. It uses only the compact layer, so it runs in a web app
 * with React Router v5 <Route>s and in a native app with React Navigation 7 navigators
 * (+ `linking.config`), without either app defining routes for the adapter.
 */
export function TicketActions({ dirty }: { dirty: boolean }) {
  const router = useRouter();
  const { query } = useLocation();
  const { id } = useParams<{ id?: string }>();
  useNavigationGuard(dirty, 'Discard your bet slip changes?');

  return (
    <View>
      <Text>
        Ticket {id} ({String(query.type ?? 'single')})
      </Text>
      <Pressable onPress={() => router.setQuery({ type: 'million' })}>
        <Text>Show million</Text>
      </Pressable>
      <Pressable onPress={() => router.navigate(`/myBets/${Number(id) + 1}`)}>
        <Text>Next ticket</Text>
      </Pressable>
      {/* With no history (opened from a deep link): <LiteConfig onBackAtRoot>, else this fallback. */}
      <Pressable onPress={() => router.goBack('/myBets')}>
        <Text>Back</Text>
      </Pressable>
      <Link to="/myBets/settled">
        <Text>Settled bets</Text>
      </Link>
    </View>
  );
}
