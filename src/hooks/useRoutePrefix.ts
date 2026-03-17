import { useCallback } from 'react';
import { useLocation, useNavigate, type NavigateOptions } from 'react-router-dom';

/**
 * Returns '/dashboard' when the user is inside the dashboard layout,
 * empty string otherwise.
 */
export const useRoutePrefix = (): string => {
  const { pathname } = useLocation();
  return pathname.startsWith('/dashboard') ? '/dashboard' : '';
};

/**
 * A navigate function that auto-prefixes paths with '/dashboard'
 * when the user is already inside the dashboard layout.
 * Only prefixes absolute paths starting with '/'.
 */
export const usePrefixedNavigate = () => {
  const navigate = useNavigate();
  const prefix = useRoutePrefix();

  return useCallback(
    (to: string, options?: NavigateOptions) => {
      // Only prefix absolute paths that aren't already under /dashboard
      if (prefix && to.startsWith('/') && !to.startsWith('/dashboard')) {
        // Special case: navigate('/') should go to /dashboard
        if (to === '/') return navigate('/dashboard', options);
        return navigate(`${prefix}${to}`, options);
      }
      return navigate(to, options);
    },
    [navigate, prefix]
  );
};
