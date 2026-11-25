import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RouterProvider, RouterView } from '../src/index.native';
import { routes } from './routes';

const Stack = createNativeStackNavigator();

interface HostProps {
  /** Path the host opens the MFE at, e.g. "/myBets/42?type=million". */
  initialUrl: string;
  /** Host bridge: open a URL in the WebView. */
  openWeb: (url: string) => void;
  /** Host bridge: dismiss the MFE. */
  closeHost: () => void;
}

/**
 * Native: React Navigation 7 + native-stack.
 */
export function NativeApp({ initialUrl, openWeb, closeHost }: HostProps) {
  return (
    <RouterProvider
      routes={routes}
      initialUrl={initialUrl}
      openWeb={openWeb}
      onBackAtRoot={() => closeHost()}
      linkingPrefixes={['myapp://']}
    >
      <RouterView navigator={Stack} />
    </RouterProvider>
  );
}
