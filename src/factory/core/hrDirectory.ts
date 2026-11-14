export interface PortalPersonnelEntry {
  user_id: number | null;
  employee_code: string;
  full_name: string;
  department: string;
  canonical_dept: string | null;
  position: string;
  email: string;
}

type HrPersonnelProvider = () => Promise<PortalPersonnelEntry[]>;

let provider: HrPersonnelProvider | null = null;
let cache: { at: number; data: PortalPersonnelEntry[] } | null = null;

/** Registers the ABT Portal HR directory reader from `portalBridge`. */
export function setHrPersonnelProvider(fn: HrPersonnelProvider): void {
  provider = fn;
  cache = null;
}

/** Clears the short-lived HR personnel cache after HR mutations in Settings. */
export function invalidateHrPersonnelCache(): void {
  cache = null;
}

/**
 * Returns active personnel records from ABT Portal's `public.personnel` table when
 * `portalBridge` is registered, or `null` in isolated unit tests on `abt_factory_test`.
 */
export async function listPortalActivePersonnel(): Promise<PortalPersonnelEntry[] | null> {
  if (!provider) return null;
  if (cache && Date.now() - cache.at <= 5_000) return cache.data;
  try {
    const data = await provider();
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}
