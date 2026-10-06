import { fetchWithLoadBalancer } from "@/utils/backendProxy";

const CACHE_KEY = "ratio_announcements_cache";
const CACHE_TTL = 10 * 60 * 1000;
let inflight: Promise<any> | null = null;

export const loadAnnouncements = (): Promise<any> => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (cached && Date.now() - cached.at < CACHE_TTL) return Promise.resolve(cached.data);
  } catch {}
  if (inflight) return inflight;
  inflight = fetchWithLoadBalancer("/api/announcements")
    .then(async (res) => {
      if (!res.ok) return null;
      const data = await res.json();
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
      } catch {}
      return data;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
};
