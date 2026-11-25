import React from 'react';

export const Platform = {
  OS: 'ios' as const,
  select: <T,>(specifics: Record<string, T>): T =>
    specifics.ios ?? specifics.native ?? specifics.default,
};

export const Linking = {
  getInitialURL: async (): Promise<string | null> => null,
  addEventListener: (_type: string, _handler: (event: { url: string }) => void) => ({
    remove: () => {},
  }),
};

const backHandlers: Array<() => boolean | null | undefined> = [];

export const BackHandler = {
  addEventListener: (_eventName: string, handler: () => boolean | null | undefined) => {
    backHandlers.push(handler);
    return {
      remove: () => {
        const idx = backHandlers.indexOf(handler);
        if (idx !== -1) backHandlers.splice(idx, 1);
      },
    };
  },
  removeEventListener: () => {},
  /** Test helper: simulate the Android back button (last registered handler first). */
  pressBack: (): boolean => {
    for (const handler of [...backHandlers].reverse()) {
      if (handler()) return true;
    }
    return false;
  },
};

/** Tests set `Alert.respond` to pick the button pressed ('Leave' or 'Cancel'). */
export const Alert = {
  respond: 'Cancel' as string,
  alert: (_title: string, _message?: string, buttons: Array<{ text?: string; onPress?: () => void }> = []) => {
    buttons.find((b) => b.text === Alert.respond)?.onPress?.();
  },
};

export const I18nManager = {
  isRTL: false,
  getConstants: () => ({ isRTL: false }),
};

export function Text(props: any) {
  return React.createElement('span', props, props.children);
}

export function View(props: any) {
  return React.createElement('div', props, props.children);
}

export function Pressable({
  children,
  onPress,
  disabled,
  testID,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
  style,
}: {
  accessibilityState?: { selected?: boolean };
  children?: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
  onPress?: (event?: any) => void;
  disabled?: boolean;
  testID?: string;
  accessibilityRole?: string;
  accessibilityLabel?: string;
  style?: any;
}) {
  const renderedChildren =
    typeof children === 'function' ? children({ pressed: false }) : children;

  return React.createElement(
    'button',
    {
      type: 'button',
      role: accessibilityRole ?? 'button',
      'aria-label': accessibilityLabel,
      'aria-disabled': disabled || undefined,
      'aria-selected': accessibilityState?.selected || undefined,
      'data-testid': testID,
      disabled: Boolean(disabled),
      style: Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : typeof style === 'object'
          ? style
          : undefined,
      onClick: (e: any) => {
        if (!disabled) {
          onPress?.(e);
        }
      },
    },
    renderedChildren,
  );
}
