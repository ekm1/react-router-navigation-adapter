declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react';

  export interface PressableProps {
    children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
    onPress?: (event?: any) => void;
    disabled?: boolean | null;
    style?: any;
    testID?: string;
    accessibilityRole?: string;
    accessibilityLabel?: string;
    accessibilityState?: { selected?: boolean; disabled?: boolean };
    hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
    onLongPress?: (event?: any) => void;
    ref?: any;
  }

  export const Pressable: ComponentType<PressableProps>;
  export const View: ComponentType<{ children?: ReactNode; style?: any; testID?: string }>;
  export const Text: ComponentType<{ children?: ReactNode; style?: any; testID?: string }>;
  export interface AlertButton {
    text?: string;
    onPress?: () => void;
    style?: 'default' | 'cancel' | 'destructive';
  }
  export const Alert: {
    alert: (
      title: string,
      message?: string,
      buttons?: AlertButton[],
      options?: { cancelable?: boolean; onDismiss?: () => void },
    ) => void;
  };
  export const Platform: {
    OS: 'ios' | 'android' | 'web' | 'windows' | 'macos';
    select: <T>(specifics: Record<string, T>) => T;
  };
  export const Linking: {
    getInitialURL: () => Promise<string | null>;
    addEventListener: (
      type: string,
      handler: (event: { url: string }) => void,
    ) => { remove: () => void };
  };
  export const BackHandler: {
    addEventListener: (
      eventName: string,
      handler: () => boolean | null | undefined,
    ) => { remove: () => void };
    removeEventListener?: (eventName: string, handler: () => void) => void;
  };
}
