import { useMemo } from 'react';
import { useNavigationGuard } from '../hooks';
import { promptToGuard, type PromptMessage } from '../shared';

export interface PromptProps {
  /** Block while true (defaults to true, like React Router v5). */
  when?: boolean;
  /** Confirmation text, or `(location, action) => string | boolean` (React Router v5 semantics). */
  message: PromptMessage;
}

/**
 * React Router v5 `<Prompt>` on the common guard: same props, both platforms.
 * On web it shares the adapter's single `history.block` (React Router's own `<Prompt>` would
 * replace it, since history v4 allows only one prompt). On native it also blocks iOS swipe-back.
 */
export function Prompt({ when = true, message }: PromptProps): null {
  const handler = useMemo(() => promptToGuard(message), [message]);
  useNavigationGuard(when, handler);
  return null;
}
