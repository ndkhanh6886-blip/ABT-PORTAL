/**
 * Item-level patches for the JSON documents kept in `app_storage`.
 *
 * Many modules keep a whole collection (orders, tasks, contracts...) in a single app_storage key.
 * Writing the full array back made every save overwrite what other users had saved in between,
 * and let a stale or empty browser state wipe the server copy. Clients now send only what changed
 * (built by `buildStoragePatch` against the copy they loaded) and the server applies it to the
 * latest stored document inside a row lock (`applyStoragePatch`).
 *
 * Shared by the browser (frontend/utils/storageSync.ts) and the API route, so it must stay pure.
 */

export type ArrayPatch = {
  kind: "array";
  upserts: any[];
  deletes: string[];
  /** Identities of the client's array in its order, used to keep the client's ordering. */
  order: string[];
};

export type ObjectPatch = {
  kind: "object";
  set: Record<string, any>;
  unset: string[];
};

export type StoragePatch = ArrayPatch | ObjectPatch;

const IDENTITY_FIELDS = ["id", "code", "order_code", "quote_code", "slip_code", "contract_code", "uid", "key"];

/** Stable identity of a collection item, or null when the item has none. */
export function itemIdentity(item: any): string | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  for (const field of IDENTITY_FIELDS) {
    const v = item[field];
    if (v !== undefined && v !== null && v !== "") return `${field}:${String(v)}`;
  }
  return null;
}

function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** JSON serialisation with sorted object keys, so equal values compare equal regardless of key order. */
export function stableStringify(value: any): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** Identities of an array, or null when an item has no identity or identities repeat. */
function identitiesOf(arr: any[]): string[] | null {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    const id = itemIdentity(item);
    if (id === null || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Builds the patch that turns `base` (the copy the client loaded/last saved; undefined when unknown)
 * into `next`. Without a known base nothing is ever deleted: unknown base means only additions and
 * modifications are sent, so a stale or empty client can no longer erase server data.
 * Returns null when the document cannot be patched item-by-item (caller falls back to full replace).
 */
export function buildStoragePatch(base: any, next: any): StoragePatch | null {
  if (Array.isArray(next)) {
    // Hai phần tử cùng mã (vd. nhập Excel có dòng trùng SKU): giữ phần tử sau cùng. Trước đây cả danh sách bị
    // coi là "không vá được" -> ghi đè toàn bộ, và bị từ chối với người không được ghi đè (mất thay đổi).
    const lastIndex = new Map<string, number>();
    next.forEach((item, i) => { const id = itemIdentity(item); if (id !== null) lastIndex.set(id, i); });
    if (lastIndex.size < next.length) {
      const deduped = next.filter((item: any, i: number) => { const id = itemIdentity(item); return id === null || lastIndex.get(id) === i; });
      if (deduped.length < next.length) next = deduped;
    }
    const nextIds = identitiesOf(next);
    if (!nextIds) return null;
    const baseMap = new Map<string, string>();
    if (Array.isArray(base)) {
      for (const item of base) {
        const id = itemIdentity(item);
        if (id !== null) baseMap.set(id, stableStringify(item));
      }
    }
    const upserts: any[] = [];
    next.forEach((item: any, i: number) => {
      const prev = baseMap.get(nextIds[i]);
      if (prev === undefined || prev !== stableStringify(item)) upserts.push(item);
    });
    const nextIdSet = new Set(nextIds);
    const deletes = Array.isArray(base) ? Array.from(baseMap.keys()).filter(id => !nextIdSet.has(id)) : [];
    return { kind: "array", upserts, deletes, order: nextIds };
  }
  if (isPlainObject(next) && (base === undefined || base === null || isPlainObject(base))) {
    const set: Record<string, any> = {};
    for (const k of Object.keys(next)) {
      if (next[k] === undefined) continue;
      if (!isPlainObject(base) || !(k in base) || stableStringify(base[k]) !== stableStringify(next[k])) set[k] = next[k];
    }
    const unset = isPlainObject(base) ? Object.keys(base).filter(k => !(k in next) || next[k] === undefined) : [];
    return { kind: "object", set, unset };
  }
  return null;
}

export function isEmptyPatch(patch: StoragePatch): boolean {
  if (patch.kind === "array") return patch.upserts.length === 0 && patch.deletes.length === 0;
  return Object.keys(patch.set).length === 0 && patch.unset.length === 0;
}

/** Applies a patch to the latest stored document. Items the client never knew about are kept. */
export function applyStoragePatch(current: any, patch: StoragePatch): any {
  if (patch.kind === "object") {
    const result: Record<string, any> = isPlainObject(current) ? { ...current } : {};
    for (const k of patch.unset || []) delete result[k];
    Object.assign(result, patch.set || {});
    return result;
  }

  const currentArr: any[] = Array.isArray(current) ? current : [];
  const deleted = new Set(patch.deletes || []);
  const upsertMap = new Map<string, any>();
  for (const item of patch.upserts || []) {
    const id = itemIdentity(item);
    if (id !== null) upsertMap.set(id, item);
  }

  const currentMap = new Map<string, any>();
  const unidentified: any[] = [];
  for (const item of currentArr) {
    const id = itemIdentity(item);
    if (id === null) unidentified.push(item);
    else if (!currentMap.has(id)) currentMap.set(id, item);
  }

  // 1. Client's order: its upserts, or the server's copy for items it did not change
  const result: any[] = [];
  const placed = new Set<string>();
  for (const id of patch.order || []) {
    if (deleted.has(id) || placed.has(id)) continue;
    const item = upsertMap.has(id) ? upsertMap.get(id) : currentMap.get(id);
    if (item === undefined) continue; // removed on the server meanwhile and not re-sent by this client
    result.push(item);
    placed.add(id);
  }
  for (const [id, item] of upsertMap) {
    if (!placed.has(id) && !deleted.has(id)) {
      result.push(item);
      placed.add(id);
    }
  }

  // 2. Items saved by other users that this client never saw: keep them next to their previous neighbour
  let anchorIndex = -1;
  for (const item of currentArr) {
    const id = itemIdentity(item);
    if (id === null) continue;
    if (placed.has(id)) {
      anchorIndex = result.findIndex(r => itemIdentity(r) === id);
      continue;
    }
    if (deleted.has(id)) continue;
    result.splice(anchorIndex + 1, 0, item);
    anchorIndex += 1;
    placed.add(id);
  }

  return [...result, ...unidentified];
}
