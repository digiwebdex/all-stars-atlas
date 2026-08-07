const LOCAL_API_BASE_URL = 'http://localhost:3001/api';

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const resolveApiBaseUrl = (): string => {
  const envBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();

  if (typeof window === 'undefined') {
    return envBaseUrl ? normalizeBaseUrl(envBaseUrl) : LOCAL_API_BASE_URL;
  }

  if (envBaseUrl) {
    if (/^https?:\/\//i.test(envBaseUrl)) {
      try {
        const envUrl = new URL(envBaseUrl);
        if (envUrl.origin === window.location.origin) return '/api';
      } catch {
        // Ignore invalid URL and use raw env value
      }
    }
    return normalizeBaseUrl(envBaseUrl);
  }

  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  return isLocal ? LOCAL_API_BASE_URL : '/api';
};

export const config = {
  apiBaseUrl: resolveApiBaseUrl(),
  appName: 'Seven Trip',
  parentCompany: 'Seven Trip',
  legalName: 'Seven Trip',
  currency: 'BDT',
  currencySymbol: '৳',
  defaultLanguage: 'en',
  supportPhone: '+880 1749-373748',
  supportEmail: 'support@seventrip.net',
  address: 'Beena Kanon, Flat-4A, House-03, Road-17, Block-E, Banani, Dhaka-1213',
  addressShort: 'Banani, Dhaka-1213',
  website: 'www.seventrip.net',
} as const;

/**
 * Resolve an uploaded-file path (e.g. "/uploads/payment-slips/x.jpg") to a URL
 * that is reachable through the API host/proxy.
 */
export const fileUrl = (filePath?: string | null): string => {
  if (!filePath) return '';
  if (/^https?:\/\//i.test(filePath)) return filePath;
  const path = filePath.startsWith('/') ? filePath : `/${filePath}`;
  if (path.startsWith('/api/')) return path;
  const base = normalizeBaseUrl(config.apiBaseUrl);
  // Uploaded files are served by nginx via the dedicated `^~ /uploads/` location,
  // which is not shadowed by the static image regex location (unlike /api/uploads).
  if (path.startsWith('/uploads/') && base === '/api') return path;
  return `${base}${path}`;
};

