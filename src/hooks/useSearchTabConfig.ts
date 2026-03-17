import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SearchTabConfig {
  flight: boolean;
  hotel: boolean;
  holiday: boolean;
  visa: boolean;
  medical: boolean;
  cars: boolean;
  esim: boolean;
  recharge: boolean;
  paybill: boolean;
}

const DEFAULT_CONFIG: SearchTabConfig = {
  flight: true,
  hotel: true,
  holiday: true,
  visa: true,
  medical: true,
  cars: true,
  esim: true,
  recharge: true,
  paybill: true,
};

const STORAGE_KEY = 'seventrip_search_tabs';

export function useSearchTabConfig(): SearchTabConfig {
  const { data } = useQuery<SearchTabConfig>({
    queryKey: ['settings', 'search-tabs'],
    queryFn: async () => {
      try {
        const settings = await api.get<any>('/admin/settings');
        if (settings?.searchTabs) {
          const merged = { ...DEFAULT_CONFIG, ...settings.searchTabs };
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
          return merged;
        }
      } catch {}
      return getFromCache();
    },
    staleTime: 5 * 60 * 1000,
    initialData: getFromCache,
  });
  return data ?? DEFAULT_CONFIG;
}

function getFromCache(): SearchTabConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_CONFIG;
}

export const SEARCH_TAB_LABELS: Record<keyof SearchTabConfig, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  holiday: 'Holiday',
  visa: 'Visa',
  medical: 'Medical',
  cars: 'Cars',
  esim: 'eSIM',
  recharge: 'Recharge',
  paybill: 'Pay Bill',
};

export { DEFAULT_CONFIG as DEFAULT_SEARCH_TABS };
