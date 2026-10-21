import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, httpErrorStatus } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { applyStoragePatch, StoragePatch } from "@/backend/services/storagePatch";
import { enforceApprovalGuards } from "@/backend/services/approvalGuard";
import { hasPermission } from "@/backend/services/permissions";
import { stripCostFields } from "@/backend/services/costVisibility";
import { itemIdentity } from "@/backend/services/storagePatch";
import type { AuthorizedUser } from "@/backend/services/authz";
import { syncCatalogSuppliersAndProducts } from "@/backend/services/supplierCatalogSync";

/** Keys holding secrets or per-user permissions: readable / writable by administrators only. */
function isSensitiveKey(key: string) {
  return key === "zalo_gateway_config" || key.startsWith("user_permissions_") || key === "session_secret";
}

/**
 * Who may read / write each app_storage collection: the permission of the module that owns it.
 * null = any signed-in user, [] = administrators only.
 */
type KeyPolicy = { read: string[] | null; write: string[] | null };
function keyPolicy(key: string): KeyPolicy {
  if (isSensitiveKey(key)) return { read: [], write: [] };
  if (
    key.startsWith("personnel_") ||
    key.startsWith("integrity_") ||
    key.startsWith("migration_") ||
    key.startsWith("report_") ||
    key.startsWith("deleted_")
  ) {
    return { read: null, write: [] };
  }
  if (key.startsWith("legal_")) return { read: ["legal.view"], write: ["legal.view"] };
  if (key === "lab_app_tasks") return { read: ["application.view", "sales.view"], write: ["application.view", "sales.view"] };
  if (key === "shared_app_requests") return { read: ["sales.view", "application.view"], write: ["sales.view", "application.view"] };
  if (key.startsWith("lab_app_") || key.startsWith("app_")) return { read: ["application.view"], write: ["application.view"] };
  if (key === "org_department_positions" || key === "org_position_assignments" || key === "system_notification_matrix") {
    return { read: null, write: ["settings.view"] };
  }
  if (key === "sales_company_config") return { read: null, write: ["settings.view", "sales.approve_discount"] };
  // Danh sách phương thức thanh toán (chi tiền NCC / thu tiền): ai cũng đọc, chỉ Quản trị viên sửa
  if (key === "finance_payment_methods") return { read: null, write: ["settings.view"] };
  if (key === "customer_industry_groups" || key.startsWith("sales_")) return { read: ["sales.view"], write: ["sales.view"] };
  return { read: null, write: null };
}

function allowedBy(me: AuthorizedUser, perms: string[] | null) {
  if (perms === null) return true;
  if (isAdminUser(me)) return true;
  return perms.some(k => hasPermission(me, k));
}

/** Collections that carry purchase / cost prices (hidden from users without "warehouse.view_cost_price"). */
const COST_BEARING_KEYS = new Set(["sales_commercial_products"]);
function canSeeCost(me: AuthorizedUser) {
  return isAdminUser(me) || hasPermission(me, "warehouse.view_cost_price");
}
function readableData(me: AuthorizedUser, key: string, data: any) {
  return COST_BEARING_KEYS.has(key) && !canSeeCost(me) ? stripCostFields(data) : data;
}
/** A user who cannot see costs saves items without them: keep the stored cost fields. */
function keepStoredCosts(current: any, upserts: any[]): any[] {
  if (!Array.isArray(current)) return upserts;
  const byId = new Map<string, any>();
  for (const item of current) {
    const id = itemIdentity(item);
    if (id !== null) byId.set(id, item);
  }
  return upserts.map(item => {
    const prev = byId.get(itemIdentity(item) || "");
    if (!prev || !item || typeof item !== "object") return item;
    const merged = { ...item };
    for (const k of ["cost_price", "costPrice", "unit_cost", "unitCost", "purchase_price", "purchasePrice"]) {
      if (prev[k] !== undefined && merged[k] === undefined) merged[k] = prev[k];
    }
    return merged;
  });
}

export async function GET(request: NextRequest) {
  try {
    const me = await getAuthorizedUser(request);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const keysParam = searchParams.get("keys");
    const all = searchParams.get("all") === "true";

    if (all || keysParam) {
      const keys = keysParam ? keysParam.split(",").map(k => k.trim()).filter(Boolean) : null;
      const res = keys
        ? await query("SELECT key, data, version FROM app_storage WHERE key = ANY($1::text[])", [keys])
        : await query("SELECT key, data, version FROM app_storage");
      const result: Record<string, any> = {};
      const versions: Record<string, number> = {};
      for (const row of res.rows) {
        if (!allowedBy(me, keyPolicy(row.key).read)) continue;
        result[row.key] = readableData(me, row.key, row.data);
        versions[row.key] = row.version || 1;
      }
      return NextResponse.json({ data: result, versions });
    }

    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    if (!allowedBy(me, keyPolicy(key).read)) return forbiddenResponse();
    const res = await query("SELECT data, version FROM app_storage WHERE key = $1", [key]);
    if (res.rows.length === 0) {
      return NextResponse.json({ data: null, version: 0 });
    }

    return NextResponse.json({ data: readableData(me, key, res.rows[0].data), version: res.rows[0].version || 1 });
  } catch (error: any) {
    console.error("[Storage API GET Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Two write modes:
 *  - `{ key, patch }`: item-level merge applied atomically on the latest server copy (no lost updates
 *    between users). This is what the client sync layer (frontend/utils/storageSync.ts) sends.
 *  - `{ key, data, expectedVersion? }`: full replace. With `expectedVersion` it is rejected with 409
 *    when someone else saved in between (optimistic concurrency).
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const urlKey = searchParams.get("key");
    const body = await request.json();

    const isEnvelope = body && typeof body === "object" && !Array.isArray(body) && ("key" in body || "patch" in body || "data" in body);
    const key = (isEnvelope && body.key) ? body.key : urlKey;
    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    const me = await getAuthorizedUser(request);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    if (!allowedBy(me, keyPolicy(key).write)) return forbiddenResponse("Bạn không có quyền sửa dữ liệu này.");
    const hideCost = COST_BEARING_KEYS.has(key) && !canSeeCost(me);

    if (isEnvelope && body.patch && typeof body.patch === "object") {
      const result = await withTransaction(async (c) => {
        const cur = await c.query("SELECT data, version FROM app_storage WHERE key = $1 FOR UPDATE", [key]);
        const current = cur.rows[0]?.data ?? null;
        const patch = body.patch as StoragePatch;
        if (patch.kind === "array") {
          patch.upserts = await enforceApprovalGuards(key, current, patch.upserts || [], me);
          if (hideCost) patch.upserts = keepStoredCosts(current, patch.upserts);
        }
        const next = applyStoragePatch(current, patch);
        const up = await c.query(
          `INSERT INTO app_storage (key, data, version, updated_at)
           VALUES ($1, $2, 1, now())
           ON CONFLICT (key) DO UPDATE
           SET data = EXCLUDED.data, version = COALESCE(app_storage.version, 1) + 1, updated_at = now()
           RETURNING version`,
          [key, JSON.stringify(next)]
        );
        return { version: up.rows[0]?.version || 1 };
      });
      if (key === "sales_commercial_products") {
        await syncCatalogSuppliersAndProducts();
      }
      return NextResponse.json({ success: true, version: result.version });
    }

    let data = isEnvelope ? body.data : body;
    if (hideCost) return forbiddenResponse("Không thể ghi đè toàn bộ danh mục có giá vốn.");
    if (Array.isArray(data)) {
      const cur = await query("SELECT data FROM app_storage WHERE key = $1", [key]);
      data = await enforceApprovalGuards(key, cur.rows[0]?.data ?? null, data, me);
    }
    if (data === undefined) {
      return NextResponse.json({ error: "Data is required" }, { status: 400 });
    }

    // Optimistic Concurrency Control (OCC): Check version if provided
    const expectedVersion = (isEnvelope ? (body.expectedVersion ?? body.version) : undefined)
      ?? (searchParams.get("version") ? parseInt(searchParams.get("version")!) : undefined);
    const ev = (expectedVersion !== undefined && expectedVersion !== null && !isNaN(Number(expectedVersion)))
      ? Number(expectedVersion)
      : null;

    const updateRes = await query(
      `INSERT INTO app_storage (key, data, version, updated_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (key) DO UPDATE
       SET data = EXCLUDED.data,
           version = COALESCE(app_storage.version, 1) + 1,
           updated_at = now()
       WHERE $3::int IS NULL OR COALESCE(app_storage.version, 1) = $3::int
       RETURNING version`,
      [key, JSON.stringify(data), ev]
    );

    if (updateRes.rowCount === 0) {
      const cur = await query("SELECT version FROM app_storage WHERE key = $1", [key]);
      const currentVersion = cur.rows[0]?.version || 1;
      return NextResponse.json({
        error: "Dữ liệu vừa được người khác cập nhật! Vui lòng tải lại trang để thấy dữ liệu mới nhất trước khi chỉnh sửa.",
        conflict: true,
        currentVersion
      }, { status: 409 });
    }

    if (key === "sales_commercial_products") {
      await syncCatalogSuppliersAndProducts();
    }

    const newVersion = updateRes.rows[0]?.version || 1;
    return NextResponse.json({ success: true, version: newVersion });
  } catch (error: any) {
    console.error("[Storage API POST Error]:", error);
    return NextResponse.json({ error: error.message }, { status: httpErrorStatus(error) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const me = await getAuthorizedUser(request);
    setAuditActor(me);
    if (!me) return unauthorizedResponse();
    if (!isAdminUser(me)) return forbiddenResponse("Chỉ Quản trị viên mới được xóa toàn bộ một khối dữ liệu.");

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    await query("DELETE FROM app_storage WHERE key = $1", [key]);
    await logAudit("DELETE", "STORAGE", `Xóa khối dữ liệu ${key}`, me.username, me.full_name);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Storage API DELETE Error]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
