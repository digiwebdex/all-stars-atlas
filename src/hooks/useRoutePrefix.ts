import { useLocation } from 'react-router-dom';

/**
 * Returns '/dashboard' when the user is inside the dashboard layout,
 * empty string otherwise. Use this to prefix navigate() paths so
 * authenticated users stay inside the dashboard shell.
 */
export const useRoutePrefix = (): string => {
  const { pathname } = useLocation();
  return pathname.startsWith('/dashboard') ? '/dashboard' : '';
};
