import { NextRequest, NextResponse } from "next/server";
import { query, logAudit, withTransaction, httpErrorStatus, HttpError } from "@/backend/db/db";
import { getAuthorizedUser, isAdminUser, unauthorizedResponse, forbiddenResponse, setAuditActor } from "@/backend/services/authz";
import { applyStoragePatch, StoragePatch } from "@/backend/services/storagePatch";
import { enforceApprovalGuards } from "@/backend/services/approvalGuard";
import { hasPermission } from "@/backend/services/permissions";
import { stripCostFields } from "@/backend/services/costVisibility";
import { CATALOG_KEY, readCatalog, catalogVersion, applyCatalogPatch, replaceCatalog } from "@/backend/services/catalogStore";
import { itemIdentity } from "@/backend/services/storagePatch";
import { PROTECTED_PROPOSAL_KEY, limitProposalDeletes, keepMissingProposals, dedupeProposalCodes } from "@/backend/services/proposalStoreGuard";
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
  // Bảng việc / lịch / thông báo dùng chung toàn công ty: mọi nhân viên đã đăng nhập
  if (key.startsWith("unified_") || key === "tbr_activity_notifications") return { read: null, write: null };
  if (key === "tbr_rfid_tags_list") return { read: null, write: ["warehouse.view"] };
  // Đề xuất & phê duyệt (tờ trình, đơn nghỉ phép DXNP...): mọi nhân viên tạo đề xuất và duyệt bước của mình.
  // Trước đây rơi vào mặc định "chỉ Quản trị viên ghi": đơn của nhân viên bị từ chối lưu, chỉ còn thông báo.
  if (key === "workspace_proposals") return { read: null, write: null };
  // Danh mục phân loại công việc: mọi người đọc, Quản trị viên sửa
  if (key === "workspace_task_categories") return { read: null, write: ["settings.view"] };
  // Khối dữ liệu chưa khai báo quyền: ai cũng đọc được nhưng chỉ Quản trị viên được ghi
  // (trước đây mọi nhân viên đều ghi đè được toàn bộ khối)
  return { read: null, write: [] };
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


async function syncSalesContractsTable(rawList: any) {
  if (!Array.isArray(rawList) || rawList.length === 0) return;
  try {
    const delRes = await query("SELECT data FROM app_storage WHERE key = 'deleted_sales_contracts'");
    const deletedSet = new Set<string>(
      (Array.isArray(delRes.rows[0]?.data) ? delRes.rows[0].data : [])
        .map((x: any) => String(x || '').trim().toUpperCase())
        .filter(Boolean)
    );
    for (const c of rawList) {
      const code = String(c?.contract_code || c?.id || '').trim();
      if (!code || deletedSet.has(code.toUpperCase())) continue;
      const custName = String(c?.customerName || c?.customer_name || 'Khách hàng').trim();
      const repName = String(c?.salesRepName || c?.sales_rep_name || '').trim();
      const title = String(c?.contractTitle || c?.title || 'Hợp đồng kinh tế').trim();
      const totalVal = Number(c?.totalAmount ?? c?.total_value ?? 0) || 0;
      const statusRaw = String(c?.status || 'DRAFT').toUpperCase();
      const dbStatus = (statusRaw === 'SIGNED' || statusRaw === 'ACTIVE' || statusRaw === 'APPROVED') ? 'ACTIVE' : statusRaw;
      const itemsJson = typeof c?.items === 'string' ? c.items : JSON.stringify(c?.items || []);
      const filesJson = typeof c?.contract_files === 'string' ? c.contract_files : JSON.stringify(c?.contract_files || []);
      await query(
        `INSERT INTO sales_contracts (contract_code, customer_name, sales_rep_name, title, total_value, status, items, contract_files, extra_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
         ON CONFLICT (contract_code) DO UPDATE SET
           customer_name = EXCLUDED.customer_name,
           sales_rep_name = CASE WHEN EXCLUDED.sales_rep_name <> '' THEN EXCLUDED.sales_rep_name ELSE sales_contracts.sales_rep_name END,
           title = EXCLUDED.title,
           total_value = EXCLUDED.total_value,
           status = EXCLUDED.status,
           items = CASE WHEN jsonb_array_length(EXCLUDED.items) > 0 THEN EXCLUDED.items ELSE sales_contracts.items END,
           contract_files = CASE WHEN jsonb_array_length(EXCLUDED.contract_files) > 0 THEN EXCLUDED.contract_files ELSE sales_contracts.contract_files END,
           extra_data = COALESCE(sales_contracts.extra_data, '{}'::jsonb) || EXCLUDED.extra_data`,
        [code, custName, repName, title, totalVal, dbStatus, itemsJson, filesJson, JSON.stringify(c)]
      );
    }
  } catch (err) {
    console.warn('[Storage API] Failed to sync sales_contracts to relational table:', err);
  }
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
        if (row.key === CATALOG_KEY) continue; // danh mục đọc từ bảng catalog_items bên dưới
        if (!allowedBy(me, keyPolicy(row.key).read)) continue;
        result[row.key] = readableData(me, row.key, row.data);
        versions[row.key] = row.version || 1;
      }
      if ((!keys || keys.includes(CATALOG_KEY)) && allowedBy(me, keyPolicy(CATALOG_KEY).read)) {
        result[CATALOG_KEY] = readableData(me, CATALOG_KEY, await readCatalog());
        versions[CATALOG_KEY] = await catalogVersion();
      }
      return NextResponse.json({ data: result, versions });
    }

    if (!key) {
      return NextResponse.json({ error: "Key is required" }, { status: 400 });
    }

    if (!allowedBy(me, keyPolicy(key).read)) return forbiddenResponse();
    if (key === CATALOG_KEY) {
      return NextResponse.json({ data: readableData(me, key, await readCatalog()), version: await catalogVersion() });
    }
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
    if (!allowedBy(me, keyPolicy(key).write)) {
      console.warn(`[storage] Từ chối ghi khối "${key}" của ${me.username}: không có quyền.`);
      return forbiddenResponse(`Bạn không có quyền sửa dữ liệu này (${key}).`);
    }
    const hideCost = COST_BEARING_KEYS.has(key) && !canSeeCost(me);

    // Danh mục sản phẩm: ghi từng dòng vào catalog_items (không ghi lại cả khối)
    if (key === CATALOG_KEY) {
      const version = await withTransaction(async (c) => {
        if (isEnvelope && body.patch && typeof body.patch === "object") {
          await applyCatalogPatch(c, body.patch as StoragePatch, hideCost);
        } else {
          const data = isEnvelope ? body.data : body;
          if (!Array.isArray(data)) throw new HttpError(400, "Danh mục sản phẩm phải là danh sách");
          // người không xem được giá vốn: chỉ thêm / sửa, không xóa hàng loạt
          await replaceCatalog(c, data, !hideCost, hideCost);
        }
        return catalogVersion(c);
      });
      await syncCatalogSuppliersAndProducts();
      return NextResponse.json({ success: true, version });
    }

    if (isEnvelope && body.patch && typeof body.patch === "object") {
      const result = await withTransaction(async (c) => {
        const cur = await c.query("SELECT data, version FROM app_storage WHERE key = $1 FOR UPDATE", [key]);
        const current = cur.rows[0]?.data ?? null;
        const patch = body.patch as StoragePatch;
        let droppedDeletes = 0;
        if (patch.kind === "array") {
          patch.upserts = await enforceApprovalGuards(key, current, patch.upserts || [], me);
          if (hideCost) patch.upserts = keepStoredCosts(current, patch.upserts);
          // Danh sách đơn từ: không cho một lần lưu xóa hàng loạt đơn (trình duyệt có danh sách sai đã xóa sạch đơn thật)
          if (key === PROTECTED_PROPOSAL_KEY) droppedDeletes = limitProposalDeletes(patch);
        }
        const next = applyStoragePatch(current, patch);
        let recoded: Array<[string, string, string]> = [];
        if (key === PROTECTED_PROPOSAL_KEY && Array.isArray(next)) {
          const existingIds = new Set((Array.isArray(current) ? current : []).map((p: any) => String(itemIdentity(p))));
          recoded = dedupeProposalCodes(next, existingIds, current);
        }
        if (droppedDeletes > 0 || recoded.length > 0) {
          await logAudit(
            "GUARD", "STORAGE",
            `${key}: ${droppedDeletes > 0 ? `chặn lệnh xóa ${droppedDeletes} đơn trong một lần lưu. ` : ""}${recoded.map(([a, b]) => `cấp lại mã ${a} -> ${b}`).join(", ")}`,
            me.username, me.full_name
          ).catch(() => {});
        }
        const up = await c.query(
          `INSERT INTO app_storage (key, data, version, updated_at)
           VALUES ($1, $2, 1, now())
           ON CONFLICT (key) DO UPDATE
           SET data = EXCLUDED.data, version = COALESCE(app_storage.version, 1) + 1, updated_at = now()
           RETURNING version`,
          [key, JSON.stringify(next)]
        );
        return { version: up.rows[0]?.version || 1, next };
      });
      if (key === "sales_commercial_products") {
        await syncCatalogSuppliersAndProducts();
      } else if (key === "sales_contracts") {
        await syncSalesContractsTable(result.next);
      }
      return NextResponse.json({ success: true, version: result.version });
    }

    let data = isEnvelope ? body.data : body;
    if (hideCost) return forbiddenResponse("Không thể ghi đè toàn bộ danh mục có giá vốn.");
    if (Array.isArray(data)) {
      const cur = await query("SELECT data FROM app_storage WHERE key = $1", [key]);
      if (key === PROTECTED_PROPOSAL_KEY) {
        // Ghi đè cả danh sách đơn từ không được làm mất đơn đang có, và không để trùng mã
        const curList = cur.rows[0]?.data ?? null;
        const { list, kept } = keepMissingProposals(curList, data);
        const existingIds = new Set((Array.isArray(curList) ? curList : []).map((p: any) => String(itemIdentity(p))));
        const recoded = dedupeProposalCodes(list, existingIds, curList);
        data = list;
        if (kept > 0 || recoded.length > 0) {
          await logAudit(
            "GUARD", "STORAGE",
            `${key}: ${kept > 0 ? `giữ lại ${kept} đơn bị thiếu trong lần ghi đè. ` : ""}${recoded.map(([a, b]) => `cấp lại mã ${a} -> ${b}`).join(", ")}`,
            me.username, me.full_name
          ).catch(() => {});
        }
      }
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

    const cur = await query("SELECT data, version FROM app_storage WHERE key = $1", [key]);
    const stored = cur.rows[0]?.data ?? null;
    const storedHasData = Array.isArray(stored) ? stored.length > 0 : (stored !== null && typeof stored === "object" && Object.keys(stored).length > 0);
    // Ghi đè NGUYÊN khối đang có dữ liệu mà không nêu phiên bản đã đọc: có thể xóa mất dữ liệu người khác vừa lưu
    if (ev === null && storedHasData && !isAdminUser(me)) {
      return NextResponse.json({
        error: "Dữ liệu này đã có trên máy chủ. Vui lòng tải lại trang trước khi lưu để không ghi đè thay đổi của người khác.",
        conflict: true,
        currentVersion: cur.rows[0]?.version || 1
      }, { status: 409 });
    }
    if (Array.isArray(data)) {
      data = await enforceApprovalGuards(key, stored, data, me);
    }

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
    } else if (key === "sales_contracts") {
      await syncSalesContractsTable(data);
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
