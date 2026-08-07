import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Approved Seven Trip logo, served from public/ so it works on every deployment target.
const LOGO_VERSION = "2026080722";
const withVersion = (url: string) =>
  url && !url.includes("?") ? `${url}?v=${LOGO_VERSION}` : url;
const DEFAULT_LOGO = withVersion("/images/seven-trip-logo.png");

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

  return DEFAULT_LOGO;
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
