import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const DEFAULT_LOGO = "/images/seven-trip-logo.png";

interface LogoResponse {
  url: string;
}

export function useSiteLogo() {
  const { data } = useQuery<LogoResponse>({
    queryKey: ["site-logo"],
    queryFn: () => api.get<LogoResponse>("/cms/logo"),
    staleTime: 5 * 60 * 1000, // 5 min cache
    gcTime: 30 * 60 * 1000,
    retry: 1,
    meta: { suppressError: true },
  });

  return data?.url || DEFAULT_LOGO;
}

export const DEFAULT_LOGO_URL = DEFAULT_LOGO;
