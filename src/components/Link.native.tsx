import { useCallback } from 'react';
import { Pressable } from 'react-native';
import { useIsActive, useRouter } from '../hooks';
import type { CommonLinkProps } from '../types';

/**
 * Native `<Link>` component rendering a React Native `<Pressable>` with
 * `accessibilityRole="link"` backed by React Navigation.
 */
export function Link<TName extends string = string>({
  to,
  params,
  query,
  hash,
  state,
  replace = false,
  push = false,
  children,
  style,
  testID,
  accessibilityLabel,
  disabled,
  onPress,
  onClick,
  activeStyle,
  exact,
}: CommonLinkProps<TName>) {
  const router = useRouter<TName>();
  const isActive = useIsActive(to, params, { exact });
  const resolvedStyle =
    isActive && activeStyle
      ? typeof style === 'function'
        ? (pressable: { pressed: boolean }) => [style(pressable), activeStyle]
        : [style, activeStyle]
      : style;

  const handlePress = useCallback(
    (event: any) => {
      if (disabled) return;
      onPress?.(event);
      onClick?.(event);

      if (event?.defaultPrevented) return;

      const options = { query, hash, state };
      if (replace) {
        router.replace(to, params, options);
      } else if (push) {
        router.push(to, params, options);
      } else {
        router.navigate(to, params, options);
      }
    },
    [disabled, onPress, onClick, query, hash, state, replace, push, router, to, params],
  );

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={resolvedStyle}
      accessibilityState={isActive ? { selected: true } : undefined}
      disabled={disabled}
      onPress={handlePress}
    >
      {children}
    </Pressable>
  );
}
