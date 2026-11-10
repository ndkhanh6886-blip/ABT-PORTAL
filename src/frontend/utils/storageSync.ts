/**
 * Client-side safety layer for `/api/storage` (installed once, before any module fetches data).
 *
 * 1. Item-level saves: every POST to /api/storage is turned into a patch computed against the copy
 *    this browser loaded (or last saved) for that key, and the server merges it into the latest
 *    stored version. Concurrent users no longer overwrite each other, an empty/stale state cannot
 *    wipe the server copy (without a known base nothing is deleted), and no-op saves are skipped.
 * 2. Session expiry: a 401 from any /api route raises `tbr:unauthorized` so the app returns to login.
 * 3. Server-backed localStorage keys: business data that some modules only kept in localStorage
 *    (Application tasks/equipment/samples..., Sales -> Application requests, weekly approvals...)
 *    is hydrated from the server after login and every write to those keys is mirrored to the server.
 * 4. localStorage quota errors are caught instead of aborting the caller (which used to skip the server save).
 */

import { buildStoragePatch, isEmptyPatch } from "@/backend/services/storagePatch";

type Base = { data: any; version: number | null };

const bases = new Map<string, Base>();
const queues = new Map<string, Promise<unknown>>();
let originalFetch: typeof fetch | null = null;

/** localStorage keys whose content is shared business data and must live on the server. */
export const SERVER_BACKED_LOCAL_KEYS = [
  "lab_app_tasks",
  "lab_app_bookings",
  "lab_app_customer_issues",
  "lab_app_daily_logs",
  "lab_app_equipment",
  "lab_app_materials",
  "lab_app_samples",
  "shared_app_requests",
  "sales_contracts",
  "sales_weekly_approvals",
  "sales_product_customizations",
  "sales_13b_nvkd_stock",
  "sales_13b_nvkd_customers",
  "sales_13b_inbound_logs",
  "sales_13b_retail_logs",
  "sales_13b_processed_orders",
  "tbr_rfid_tags_list",
  "workspace_proposals",
];
const SERVER_BACKED_SET = new Set(SERVER_BACKED_LOCAL_KEYS);

/** Demo rows that older versions seeded into localStorage: never upload them as shared data. */
const LEGACY_DEMO_ROWS: Partial<Record<string, (item: any) => boolean>> = {
  sales_13b_inbound_logs: (item) => /^NK13B-2026\.09\.00[1-3]$/.test(String(item?.id || "")),
};

function withoutDemoRows(key: string, value: any): any {
  const isDemo = LEGACY_DEMO_ROWS[key];
  return isDemo && Array.isArray(value) ? value.filter(item => !isDemo(item)) : value;
}

/** Keys kept when the cache is cleared at logout (UI preferences, and the data-reset epoch this browser applied). */
const PRESERVED_LOCAL_PREFIXES = ["tbr_theme", "theme", "tbr_clean_slate_", "tbr_data_epoch"];

/**
 * Every write to /api/storage carries the data-reset epoch this browser applied. After a server reset a tab
 * opened earlier still holds the old rows in memory and its next save would push them back (seen with the
 * activity notifications); the server rejects such writes with 409 { stale_epoch } and the page reloads.
 */
const EPOCH_HEADER = "X-Tbr-Data-Epoch";
let memoryEpoch = "";

function knownEpoch(): string {
  if (memoryEpoch) return memoryEpoch;
  try {
    const stored = window.localStorage.getItem("tbr_data_epoch") || "";
    if (stored) memoryEpoch = stored;
    return stored;
  } catch {
    return "";
  }
}

function setKnownEpoch(epoch: string): void {
  const clean = String(epoch || "").trim();
  if (!clean) return;
  memoryEpoch = clean;
  try {
    window.localStorage.setItem("tbr_data_epoch", clean);
    if (window.localStorage.getItem("tbr_data_epoch") !== clean) {
      for (const heavyKey of ["sales_cached_biolab_products", "sales_commercial_products", "inventoryItems", "tbr_activity_notifications"]) {
        window.localStorage.removeItem(heavyKey);
      }
      window.localStorage.setItem("tbr_data_epoch", clean);
    }
  } catch {}
}

function storageWriteHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", [EPOCH_HEADER]: knownEpoch() };
}

async function handleStaleEpoch(res: Response): Promise<void> {
  if (res.status !== 409) return;
  const json = await res.clone().json().catch(() => ({}));
  if (!json?.stale_epoch) return;
  const hadEpoch = Boolean(knownEpoch());
  if (json.epoch) setKnownEpoch(String(json.epoch));
  // tải lại tối đa 1 lần / phút để không lặp vô hạn nếu có sự cố
  try {
    const last = Number(window.sessionStorage.getItem("tbr_epoch_reload_at") || 0);
    if (Date.now() - last < 60_000) {
      await applyDataResetEpoch();
      window.dispatchEvent(new CustomEvent("tbr:storage-conflict", { detail: { stale_epoch: true } }));
      return;
    }
    window.sessionStorage.setItem("tbr_epoch_reload_at", String(Date.now()));
  } catch {}
  // báo cho tab đã mở trước lần reset; lần mở đầu tiên sau reset (chưa biết mốc) thì tải lại âm thầm
  if (hadEpoch) alert(json.error || "Dữ liệu trên máy chủ vừa được làm mới. Trang sẽ tải lại.");
  await applyDataResetEpoch();
  window.location.reload();
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function toUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.catch(() => undefined).then(task);
  queues.set(key, run.catch(() => undefined));
  return run;
}

function recordBase(key: string, data: any, version: any) {
  bases.set(key, { data: clone(data), version: typeof version === "number" ? version : null });
}

async function recordFromGet(url: URL, res: Response) {
  if (!res.ok) return;
  try {
    const json = await res.json();
    if (json && typeof json.epoch === "string" && json.epoch && !knownEpoch()) {
      setKnownEpoch(json.epoch);
    }
    const key = url.searchParams.get("key");
    if (key) {
      if (key === "data_reset_epoch" && json?.data?.epoch && !knownEpoch()) {
        setKnownEpoch(String(json.data.epoch));
      }
      if (json && "data" in json) recordBase(key, json.data, json.version);
      return;
    }
    if (json && json.data && typeof json.data === "object") {
      const versions = json.versions || {};
      const explicitKeys = url.searchParams.get("keys");
      const requested = explicitKeys ? explicitKeys.split(",").map(k => k.trim()).filter(Boolean) : Object.keys(json.data);
      for (const k of requested) {
        // `?all=true` only seeds keys this page has not loaded itself; an explicit `key`/`keys` load
        // is done by the module that owns the state, so it becomes the new reference copy.
        if (!explicitKeys && bases.has(k)) continue;
        recordBase(k, k in json.data ? json.data[k] : null, versions[k] ?? (k in json.data ? null : 0));
      }
    }
  } catch {
    // ignore unreadable bodies
  }
}

function notifyConflict(key: string) {
  window.dispatchEvent(new CustomEvent("tbr:storage-conflict", { detail: { key } }));
}

async function saveKey(key: string, nextData: any): Promise<Response> {
  const f = originalFetch!;
  const base = bases.get(key);
  const patch = buildStoragePatch(base ? base.data : undefined, nextData);

  if (patch) {
    if (isEmptyPatch(patch)) {
      if (!base) recordBase(key, nextData, null);
      return jsonResponse({ success: true, version: base?.version ?? null, skipped: true });
    }
    const res = await f("/api/storage", {
      method: "POST",
      headers: storageWriteHeaders(),
      body: JSON.stringify({ key, patch }),
    });
    if (res.ok) {
      const json = await res.clone().json().catch(() => ({}));
      recordBase(key, nextData, json.version);
    } else if (res.status === 409) {
      await handleStaleEpoch(res);
    } else if (res.status === 401) {
      window.dispatchEvent(new Event("tbr:unauthorized"));
    }
    return res;
  }

  // Not patchable (e.g. array of primitives): full replace guarded by the known version
  const body: any = { key, data: nextData };
  if (base && base.version !== null) body.expectedVersion = base.version;
  const res = await f("/api/storage", {
    method: "POST",
    headers: storageWriteHeaders(),
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const json = await res.clone().json().catch(() => ({}));
    recordBase(key, nextData, json.version);
  } else if (res.status === 409) {
    await handleStaleEpoch(res);
    console.error(`[storageSync] Xung đột khi lưu "${key}": dữ liệu đã được người khác cập nhật.`);
    notifyConflict(key);
  } else if (res.status === 401) {
    window.dispatchEvent(new Event("tbr:unauthorized"));
  }
  return res;
}

function parseStorageBody(url: URL, rawBody: string): { key: string; data: any } | null {
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return null; }
  const isEnvelope = body && typeof body === "object" && !Array.isArray(body) && ("key" in body || "data" in body);
  const key = (isEnvelope && body.key) ? body.key : url.searchParams.get("key");
  if (!key) return null;
  if (isEnvelope && "patch" in body) return null; // already a patch
  const data = isEnvelope ? body.data : body;
  if (data === undefined) return null;
  return { key, data };
}

export function saveStorageKey(key: string, data: any): Promise<Response> {
  markCacheMutated("/api/storage");
  return enqueue(key, () => saveKey(key, clone(data)));
}

/* ---------------- Instant Stale-While-Revalidate (SWR) Cache (RAM + IndexedDB) ---------------- */

interface CachedApiEntry {
  key: string;
  epoch: string;
  userKey: string;
  url: string;
  bodyText: string;
  updatedAt: number;
}

const IDB_NAME = "tbr_instant_api_cache_v2";
const IDB_STORE = "responses";
const apiMemoryCache = new Map<string, CachedApiEntry>();
const inFlightGets = new Map<string, Promise<{ status: number; bodyText: string; ok: boolean }>>();
let bypassCacheUntil = 0;
let idbPromise: Promise<IDBDatabase | null> | null = null;
let idbWarmPromise: Promise<void> | null = null;

function currentUserKey(): string {
  if (typeof window === "undefined") return "anon";
  try {
    const raw = window.localStorage.getItem("tbr_current_user") || window.localStorage.getItem("current_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      return String(parsed?.username || parsed?.id || parsed?.email || "anon").toLowerCase();
    }
  } catch {}
  return "anon";
}

function openCacheIdb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  if (idbPromise) return idbPromise;
  idbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbPromise;
}

function warmMemoryCacheFromIdb(): Promise<void> {
  if (idbWarmPromise) return idbWarmPromise;
  idbWarmPromise = (async () => {
    const db = await openCacheIdb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, "readonly");
        const store = tx.objectStore(IDB_STORE);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows: CachedApiEntry[] = Array.isArray(req.result) ? req.result : [];
          for (const row of rows) {
            if (row && row.key && typeof row.bodyText === "string" && !apiMemoryCache.has(row.key)) {
              apiMemoryCache.set(row.key, row);
            }
          }
          resolve();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  })();
  return idbWarmPromise;
}

function putIdbEntry(entry: CachedApiEntry): void {
  openCacheIdb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(entry);
    } catch {}
  });
}

function clearInstantApiCache(): void {
  apiMemoryCache.clear();
  openCacheIdb().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).clear();
    } catch {}
  });
}

function markCacheMutated(pathname?: string): void {
  bypassCacheUntil = Date.now() + 8000;
  if (pathname === "/api/inventory") {
    bases.delete("sales_commercial_products");
  }
  if (pathname === "/api/inventory" || pathname === "/api/storage" || pathname === "/api/sales" || pathname === "/api/procurement") {
    clearInstantApiCache();
    return;
  }
  if (pathname) {
    for (const [k, v] of apiMemoryCache.entries()) {
      if (v.url.startsWith(pathname)) {
        apiMemoryCache.delete(k);
      }
    }
  }
}

function isCacheableApiGet(url: URL): boolean {
  const p = url.pathname;
  const action = url.searchParams.get("action") || "overview";
  if (p === "/api/inventory") {
    return action === "overview" || action === "lot_stock" || action === "lot_stock_page" || action === "product_components";
  }
  if (p === "/api/sales") {
    return action === "overview" || action === "reservations" || action === "customers";
  }
  if (p === "/api/workflows") {
    return action === "overview" || action === "templates" || action === "workflows" || action === "tasks";
  }
  if (p === "/api/procurement") {
    return action === "overview" || action === "po_payments" || !url.searchParams.has("action");
  }
  if (p === "/api/storage") {
    return url.searchParams.get("key") !== "data_reset_epoch";
  }
  if (p === "/api/portal/customer") {
    return action === "list_incidents";
  }
  return false;
}

export function installStorageSync() {
  if (typeof window === "undefined" || originalFetch) return;
  originalFetch = window.fetch.bind(window);
  const f = originalFetch;
  warmMemoryCacheFromIdb();

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = toUrl(input);
    if (!url || url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return f(input as any, init);
    }
    const method = (init?.method || (typeof input === "object" && "method" in (input as any) ? (input as Request).method : "GET")).toUpperCase();

    if (method !== "GET") {
      const isHeartbeat = url.pathname === "/api/auth" && typeof init?.body === "string" && init.body.includes('"heartbeat"');
      if (!isHeartbeat) {
        markCacheMutated(url.pathname);
      }
    }

    if (url.pathname === "/api/storage" && method === "POST" && typeof init?.body === "string") {
      const parsed = parseStorageBody(url, init.body);
      if (parsed) return saveStorageKey(parsed.key, parsed.data);
    }

    if (method === "GET" && isCacheableApiGet(url)) {
      if (idbWarmPromise) {
        await Promise.race([idbWarmPromise, new Promise((r) => setTimeout(r, 45))]);
      }
      const uKey = currentUserKey();
      const ep = knownEpoch() || "init";
      const relUrl = url.pathname + url.search;
      const cacheKey = `${uKey}|${ep}|${relUrl}`;
      const reqHeaders = new Headers(init?.headers || (typeof input === "object" && "headers" in (input as any) ? (input as Request).headers : undefined));
      const forceNetwork = Date.now() <= bypassCacheUntil || reqHeaders.get("x-no-cache") === "1";

      const cached = !forceNetwork ? apiMemoryCache.get(cacheKey) : undefined;

      const fetchAndStore = (isBackgroundRevalidate = false): Promise<{ status: number; bodyText: string; ok: boolean }> => {
        const existingInFlight = inFlightGets.get(cacheKey);
        if (existingInFlight) return existingInFlight;

        const run = (async () => {
          const netRes = await f(input as any, init);
          const bodyText = await netRes.text();
          if (netRes.status === 401 && url.pathname !== "/api/auth") {
            window.dispatchEvent(new Event("tbr:unauthorized"));
          } else if (netRes.status === 403) {
            try {
              const j = JSON.parse(bodyText);
              if (j && j.must_change_password) window.dispatchEvent(new Event("tbr:must-change-password"));
            } catch {}
          }
          if (netRes.ok) {
            if (url.pathname === "/api/storage") {
              await recordFromGet(url, new Response(bodyText, { status: 200, headers: { "Content-Type": "application/json" } }));
            }
            const prevEntry = apiMemoryCache.get(cacheKey);
            const changed = !prevEntry || prevEntry.bodyText !== bodyText;
            const entry: CachedApiEntry = {
              key: cacheKey,
              epoch: knownEpoch() || ep,
              userKey: uKey,
              url: relUrl,
              bodyText,
              updatedAt: Date.now(),
            };
            apiMemoryCache.set(cacheKey, entry);
            putIdbEntry(entry);
            if (prevEntry && changed) {
              window.dispatchEvent(
                new CustomEvent("tbr:api-revalidated", {
                  detail: { url: relUrl, pathname: url.pathname, search: url.search },
                })
              );
            }
          }
          return { status: netRes.status, bodyText, ok: netRes.ok };
        })().finally(() => {
          inFlightGets.delete(cacheKey);
        });

        inFlightGets.set(cacheKey, run);
        return run;
      };

      if (cached) {
        if (url.pathname === "/api/storage") {
          await recordFromGet(url, new Response(cached.bodyText, { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        if (Date.now() - cached.updatedAt > 2500) {
          fetchAndStore(true).catch(() => {});
        }
        return new Response(cached.bodyText, {
          status: 200,
          headers: { "Content-Type": "application/json", "X-Tbr-Cache": "HIT" },
        });
      }

      const net = await fetchAndStore();
      return new Response(net.bodyText, {
        status: net.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/storage" && method === "GET") {
      const res = await f(input as any, init);
      await recordFromGet(url, res.clone());
      if (res.status === 401) window.dispatchEvent(new Event("tbr:unauthorized"));
      return res;
    }

    if (url.pathname === "/api/storage" && method !== "GET") {
      const headers = new Headers(init?.headers || (typeof input === "object" && "headers" in (input as any) ? (input as Request).headers : undefined));
      headers.set(EPOCH_HEADER, knownEpoch());
      init = { ...(init || {}), headers };
    }
    const res = await f(input as any, init);
    if (url.pathname === "/api/storage" && res.status === 409) await handleStaleEpoch(res);
    if (res.status === 401 && url.pathname !== "/api/auth") {
      window.dispatchEvent(new Event("tbr:unauthorized"));
    } else if (res.status === 403) {
      try {
        const j = await res.clone().json();
        if (j && j.must_change_password) window.dispatchEvent(new Event("tbr:must-change-password"));
      } catch {}
    }
    return res;
  };

  installLocalStorageGuards();
}

/* ---------------- localStorage: quota guard + server mirror ---------------- */

let suppressMirror = false;
const mirrorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastValues = new Map<string, string>();
let mirrorEnabled = false;

function scheduleMirror(key: string, value: string) {
  lastValues.set(key, value);
  if (!mirrorEnabled) return;
  const prev = mirrorTimers.get(key);
  if (prev) clearTimeout(prev);
  mirrorTimers.set(key, setTimeout(() => {
    mirrorTimers.delete(key);
    const latest = lastValues.get(key);
    if (latest === undefined) return;
    try {
      saveStorageKey(key, withoutDemoRows(key, JSON.parse(latest))).catch(err => console.error(`[storageSync] Không đồng bộ được ${key}:`, err));
    } catch {
      // value is not JSON: not a collection, nothing to mirror
    }
  }, 400));
}

function installLocalStorageGuards() {
  const proto = Object.getPrototypeOf(window.localStorage) as Storage;
  const originalSetItem = proto.setItem;
  proto.setItem = function (this: Storage, key: string, value: string) {
    try {
      originalSetItem.call(this, key, value);
    } catch (err) {
      console.warn(`[storageSync] localStorage đầy, không lưu được bộ nhớ đệm "${key}" (dữ liệu máy chủ không bị ảnh hưởng).`, err);
    }
    if (this === window.localStorage && SERVER_BACKED_SET.has(key) && !suppressMirror) {
      scheduleMirror(key, String(value));
    }
  };
}

function writeLocal(key: string, value: any) {
  suppressMirror = true;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } finally {
    suppressMirror = false;
  }
}

function mergeLocalIntoServer(server: any, local: any): any {
  if (Array.isArray(server) && Array.isArray(local)) {
    const patch = buildStoragePatch(undefined, local);
    if (!patch || patch.kind !== "array") return server;
    // Local-only items (never synced from this browser before) are added; server wins on conflicts
    const serverPatch = buildStoragePatch(undefined, server);
    if (!serverPatch || serverPatch.kind !== "array") return server;
    const serverIds = new Set(serverPatch.order);
    const localOnly = local.filter((_: any, i: number) => !serverIds.has(patch.order[i]));
    return [...server, ...localOnly];
  }
  if (server && typeof server === "object" && !Array.isArray(server) && local && typeof local === "object" && !Array.isArray(local)) {
    return { ...local, ...server };
  }
  return server;
}

/**
 * Loads the server copy of SERVER_BACKED_LOCAL_KEYS into localStorage (call after login, before
 * rendering the modules). The first time on each browser, data that only existed locally is merged
 * into the server copy so nothing kept on this machine is lost.
 */
export async function hydrateServerBackedKeys(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  try {
    const res = await fetch(`/api/storage?keys=${encodeURIComponent(SERVER_BACKED_LOCAL_KEYS.join(","))}`);
    if (!res.ok) return false;
    const json = await res.json();
    const serverData = json?.data || {};
    for (const key of SERVER_BACKED_LOCAL_KEYS) {
      const migratedFlag = `tbr_srv_migrated_v1_${key}`;
      let local: any = undefined;
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        try { local = withoutDemoRows(key, JSON.parse(raw)); } catch { local = undefined; }
      }
      const server = key in serverData ? serverData[key] : null;
      const alreadyMigrated = window.localStorage.getItem(migratedFlag) === "1";

      if (server !== null && server !== undefined) {
        const merged = !alreadyMigrated && local !== undefined ? mergeLocalIntoServer(server, local) : server;
        writeLocal(key, merged);
        if (merged !== server) saveStorageKey(key, merged).catch(() => undefined);
      } else if (local !== undefined && local !== null && !(Array.isArray(local) && local.length === 0)) {
        writeLocal(key, local);
        saveStorageKey(key, local).catch(() => undefined);
      }
      try { window.localStorage.setItem(migratedFlag, "1"); } catch {}
    }
    mirrorEnabled = true;
    // Writes made before hydration finished are pushed now
    for (const [key, value] of lastValues) scheduleMirror(key, value);
    return true;
  } catch (err) {
    console.error("[storageSync] Không tải được dữ liệu dùng chung từ máy chủ:", err);
    return false;
  }
}

/**
 * After the server data was reset (scripts/reset_for_production.js writes app_storage "data_reset_epoch"),
 * drops every cached business row in this browser once, without uploading anything, so old test data
 * cannot be pushed back to the server. Call before hydrateServerBackedKeys.
 */
export async function applyDataResetEpoch(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch("/api/storage?key=data_reset_epoch", { signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!res.ok) return;
    const json = await res.json();
    const epoch = String(json?.data?.epoch || json?.epoch || "").trim();
    if (!epoch) return;
    if (window.localStorage.getItem("tbr_data_epoch") === epoch) {
      memoryEpoch = epoch;
      return;
    }
    for (const timer of mirrorTimers.values()) clearTimeout(timer);
    mirrorTimers.clear();
    // Cấu hình được giữ lại (một số máy chỉ có bản cấu hình trong trình duyệt)
    const keepPrefixes = [
      ...PRESERVED_LOCAL_PREFIXES, "tbr_org_", "org_", "sales_company_", "system_notification_matrix", "finance_payment_methods",
      "customer_industry_groups", "sales_customer_industry_groups", "settings_", "user_permissions_", "ws_templates_expanded",
    ];
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && !keepPrefixes.some(p => k.startsWith(p)) && !k.endsWith("_config")) keys.push(k);
    }
    keys.forEach(k => window.localStorage.removeItem(k));
    bases.clear();
    lastValues.clear();
    clearInstantApiCache();
    setKnownEpoch(epoch);
  } catch {
    // máy chủ không trả lời: giữ nguyên bộ nhớ đệm, lần mở sau sẽ kiểm tra lại
  }
}

/** Clears cached business data from this browser (called at logout so the next user never sees or re-uploads it). */
export function clearLocalDataCache() {
  if (typeof window === "undefined") return;
  // Push pending mirrored writes before the cache goes away
  for (const [key, timer] of mirrorTimers) {
    clearTimeout(timer);
    const latest = lastValues.get(key);
    if (latest !== undefined) {
      try { saveStorageKey(key, JSON.parse(latest)).catch(() => undefined); } catch {}
    }
  }
  mirrorTimers.clear();
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k || PRESERVED_LOCAL_PREFIXES.some(p => k.startsWith(p)) || k.startsWith("tbr_srv_migrated_")) continue;
    // Never drop local-only data that has not been merged into the server copy yet
    if (SERVER_BACKED_SET.has(k) && window.localStorage.getItem(`tbr_srv_migrated_v1_${k}`) !== "1") continue;
    keys.push(k);
  }
  keys.forEach(k => window.localStorage.removeItem(k));
  bases.clear();
  lastValues.clear();
  clearInstantApiCache();
  mirrorEnabled = false;
}

if (typeof window !== "undefined") {
  installStorageSync();
}
