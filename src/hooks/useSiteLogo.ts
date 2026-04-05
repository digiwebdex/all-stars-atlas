import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const DEFAULT_LOGO = "/images/seven-trip-logo.png";

export interface LogoSizes {
  homepage: number;  // px height
  header: number;
  footer: number;
  auth: number;
}

const DEFAULT_SIZES: LogoSizes = {
  homepage: 140,
  header: 80,
  footer: 48,
  auth: 96,
};

interface LogoResponse {
  url: string;
  sizes?: Partial<LogoSizes>;
}

export function useSiteLogo() {
  const { data } = useQuery<LogoResponse>({
    queryKey: ["site-logo"],
    queryFn: () => api.get<LogoResponse>("/cms/logo"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    meta: { suppressError: true },
  });

  return data?.url || DEFAULT_LOGO;
}

export function useLogoSizes(): LogoSizes {
  const { data } = useQuery<LogoResponse>({
    queryKey: ["site-logo"],
    queryFn: () => api.get<LogoResponse>("/cms/logo"),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    meta: { suppressError: true },
  });

  return { ...DEFAULT_SIZES, ...(data?.sizes || {}) };
}

export const DEFAULT_LOGO_URL = DEFAULT_LOGO;
export { DEFAULT_SIZES };
