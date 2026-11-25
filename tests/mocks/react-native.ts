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

export const BackHandler = {
  addEventListener: (_eventName: string, _handler: () => boolean) => ({
    remove: () => {},
  }),
  removeEventListener: () => {},
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
  style,
}: {
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
      'data-testid': testID,
      disabled: Boolean(disabled),
      style: typeof style === 'object' ? style : undefined,
      onClick: (e: any) => {
        if (!disabled) {
          onPress?.(e);
        }
      },
    },
    renderedChildren,
  );
}
