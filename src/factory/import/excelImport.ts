import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { nextNumber } from "../core/numbering";
import { ensureKitBomRoutingAndIfuSchema } from "../kit/bomRouting";
import { ensureQaOpsSchema } from "../qms/qaOps";
import { ensureRdProjectOpsSchema } from "../rd/projectOps";
import "../master/permissions";
import "../inv/permissions";
import "../asset/service";
import "../kit/permissions";
import "../prep/service";
import "../device/permissions";
import "../qms/permissions";
import "../rd/permissions";

registerPermissions([
  { code: "inv.receipt.manage", description: "Nhập kho / khởi tạo số dư lô tồn kho từ biểu mẫu Excel" },
]);

let importSchemaEnsured = false;

export async function ensureExcelImportSchema(tx: Tx): Promise<void> {
  if (importSchemaEnsured) return;
  await tx.query(`
    CREATE TABLE IF NOT EXISTS core.excel_import_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      template_key varchar(60) NOT NULL,
      template_name varchar(200) NOT NULL,
      target_dept_code varchar(40),
      target_warehouse_code varchar(40),
      file_name varchar(255) NOT NULL,
      total_rows int NOT NULL DEFAULT 0,
      created_count int NOT NULL DEFAULT 0,
      updated_count int NOT NULL DEFAULT 0,
      error_count int NOT NULL DEFAULT 0,
      errors_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      actor_id int,
      actor_name varchar(150),
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  importSchemaEnsured = true;
}

function normStr(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function normCode(v: unknown, fallback = ""): string {
  const raw = normStr(v, fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
  return raw.slice(0, 40);
}

function normNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const cleaned = String(v).replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function normDate(v: unknown): string | null {
  const s = normStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

async function ensureUomExists(tx: Tx, rawUom: string): Promise<string> {
  const code = normStr(rawUom, "pcs").slice(0, 16) || "pcs";
  const found = (
    await tx.query("SELECT code FROM master.uom WHERE lower(code) = lower($1) LIMIT 1", [code])
  ).rows[0];
  if (found) return found.code as string;
  await tx.query(
    `INSERT INTO master.uom (code, name, status)
     VALUES ($1, $2, 'ACTIVE')
     ON CONFLICT (code) DO NOTHING`,
    [code, code]
  );
  return code;
}

function mapStorageCondition(raw: string): "RT" | "2-8" | "-20" | "-80" {
  const s = raw.toUpperCase();
  if (s.includes("-80")) return "-80";
  if (s.includes("-20")) return "-20";
  if (s.includes("2-8") || s.includes("2–8") || s.includes("4C") || s.includes("LANH")) return "2-8";
  return "RT";
}

function mapItemType(raw: string): string {
  const s = raw.toUpperCase().trim();
  const valid = [
    "RAW_MATERIAL",
    "REAGENT",
    "CONSUMABLE",
    "COMPONENT",
    "SEMI_FINISHED",
    "FINISHED_KIT",
    "DEVICE",
    "OLIGO_SERVICE",
    "SPARE_PART",
  ];
  if (valid.includes(s)) return s;
  if (s.includes("KIT") || s.includes("THANH PHAM")) return "FINISHED_KIT";
  if (s.includes("BAN THANH PHAM") || s.includes("BTP") || s.includes("SEMI")) return "SEMI_FINISHED";
  if (s.includes("HOA CHAT") || s.includes("REAGENT") || s.includes("ENZYME")) return "REAGENT";
  if (s.includes("TIEU HAO") || s.includes("ONG") || s.includes("HOP") || s.includes("BAO BI")) return "CONSUMABLE";
  if (s.includes("LINH KIEN") || s.includes("COMPONENT")) return "COMPONENT";
  if (s.includes("THIET BI") || s.includes("MAY")) return "DEVICE";
  return "RAW_MATERIAL";
}

async function ensureItemByCode(
  tx: Tx,
  actor: AuthzActor,
  params: {
    code: string;
    name: string;
    item_type?: string;
    base_uom?: string;
    storage_condition?: string;
    shelf_life_days?: number | null;
    min_stock?: number;
    notes?: string | null;
  }
): Promise<{ id: string; code: string; base_uom: string; tracking: string; created: boolean }> {
  const code = normCode(params.code);
  const uom = await ensureUomExists(tx, params.base_uom || "pcs");
  const itemType = mapItemType(params.item_type || "RAW_MATERIAL");
  const storage = mapStorageCondition(params.storage_condition || "RT");
  const existing = (
    await tx.query("SELECT id, code, base_uom, tracking FROM master.item WHERE upper(code) = upper($1) LIMIT 1", [code])
  ).rows[0];

  if (existing) {
    await tx.query(
      `UPDATE master.item
          SET name = COALESCE(NULLIF($2, ''), name),
              storage_condition = $3,
              shelf_life_days = COALESCE($4, shelf_life_days),
              min_stock = COALESCE($5, min_stock),
              notes = COALESCE(NULLIF($6, ''), notes),
              updated_at = now(),
              updated_by = $7
        WHERE id = $1`,
      [existing.id, params.name, storage, params.shelf_life_days ?? null, params.min_stock ?? 0, params.notes ?? null, actor.userId]
    );
    return { id: existing.id, code: existing.code, base_uom: existing.base_uom, tracking: existing.tracking, created: false };
  }

  const inserted = (
    await tx.query(
      `INSERT INTO master.item (
         code, name, item_type, base_uom, tracking, storage_condition,
         shelf_life_days, min_stock, receipt_qc_required, is_purchasable,
         is_manufacturable, notes, status, created_by, updated_by
       ) VALUES ($1, $2, $3, $4, 'LOT', $5, $6, $7, false, true, $8, $9, 'ACTIVE', $10, $10)
       RETURNING id, code, base_uom, tracking`,
      [
        code,
        params.name || code,
        itemType,
        uom,
        storage,
        params.shelf_life_days || 365,
        params.min_stock || 0,
        ["FINISHED_KIT", "SEMI_FINISHED", "DEVICE"].includes(itemType),
        params.notes ?? null,
        actor.userId,
      ]
    )
  ).rows[0];

  return { id: inserted.id, code: inserted.code, base_uom: inserted.base_uom, tracking: inserted.tracking, created: true };
}

async function resolveOrgUnitId(tx: Tx, deptCodeOrNull?: string | null): Promise<string> {
  const code = normStr(deptCodeOrNull).toUpperCase();
  if (code) {
    const found = (await tx.query("SELECT id FROM core.org_unit WHERE upper(code) = $1 LIMIT 1", [code])).rows[0];
    if (found) return found.id as string;
  }
  const fallback = (await tx.query("SELECT id FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0];
  return fallback?.id as string;
}

async function resolveWarehouseAndLocation(
  tx: Tx,
  actor: AuthzActor,
  warehouseCode?: string | null,
  deptCode?: string | null,
  preferQuarantine = true
): Promise<{ warehouse_id: string; location_id: string }> {
  const whCode = normStr(warehouseCode).toUpperCase();
  let wh = whCode
    ? (await tx.query("SELECT id, code FROM master.warehouse WHERE upper(code) = $1 LIMIT 1", [whCode])).rows[0]
    : null;
  if (!wh && deptCode) {
    const orgId = await resolveOrgUnitId(tx, deptCode);
    wh = (await tx.query("SELECT id, code FROM master.warehouse WHERE owner_org_unit_id = $1 LIMIT 1", [orgId])).rows[0];
  }
  if (!wh) {
    wh = (await tx.query("SELECT id, code FROM master.warehouse WHERE status = 'ACTIVE' ORDER BY code LIMIT 1")).rows[0];
  }
  if (!wh) {
    const orgId = await resolveOrgUnitId(tx, deptCode);
    wh = (
      await tx.query(
        `INSERT INTO master.warehouse (code, name, owner_org_unit_id, purpose, access_mode, status, created_by, updated_by)
         VALUES ('KHO-TONG', 'Kho Tổng Nhà Máy ABT', $1, 'RAW', 'SHARED_READ', 'ACTIVE', $2, $2)
         RETURNING id, code`,
        [orgId, actor.userId]
      )
    ).rows[0];
  }

  let loc = (
    await tx.query(
      "SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine = $2 AND status = 'ACTIVE' ORDER BY code LIMIT 1",
      [wh.id, preferQuarantine]
    )
  ).rows[0];

  if (!loc) {
    loc = (
      await tx.query(
        `INSERT INTO master.location (warehouse_id, code, name, temperature_condition, is_quarantine, status, created_by, updated_by)
         VALUES ($1, $2, $3, 'RT', $4, 'ACTIVE', $5, $5)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          wh.id,
          preferQuarantine ? `${wh.code}-BT` : `${wh.code}-MAIN`,
          preferQuarantine ? `Khu biệt trữ chờ QC ${wh.code}` : `Vị trí chính ${wh.code}`,
          preferQuarantine,
          actor.userId,
        ]
      )
    ).rows[0];
    if (!loc) {
      loc = (await tx.query("SELECT id FROM master.location WHERE warehouse_id = $1 LIMIT 1", [wh.id])).rows[0];
    }
  }

  return { warehouse_id: wh.id, location_id: loc.id };
}

export async function getExcelImportOverview(tx: Tx, _actor: AuthzActor) {
  await ensureExcelImportSchema(tx);
  await ensureKitBomRoutingAndIfuSchema(tx);
  await ensureQaOpsSchema(tx);
  await ensureRdProjectOpsSchema(tx);

  const departments = (
    await tx.query("SELECT id, code, name, unit_type FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code")
  ).rows;
  const warehouses = (
    await tx.query(
      `SELECT w.id, w.code, w.name, w.purpose, o.code AS dept_code, o.name AS dept_name
         FROM master.warehouse w
         LEFT JOIN core.org_unit o ON o.id = w.owner_org_unit_id
        WHERE w.status = 'ACTIVE'
        ORDER BY w.code`
    )
  ).rows;

  const countsRow = (
    await tx.query(`
      SELECT
        (SELECT count(*)::int FROM master.item WHERE status = 'ACTIVE') AS items_count,
        (SELECT count(*)::int FROM inv.lot) AS lots_count,
        (SELECT count(*)::int FROM asset.asset) AS assets_count,
        (SELECT count(*)::int FROM kit.bom) AS kit_boms_count,
        (SELECT count(*)::int FROM prep.formula) AS prep_formulas_count,
        (SELECT count(*)::int FROM device.device_model) AS device_models_count,
        (SELECT count(*)::int FROM kit.routing) AS routings_count,
        (SELECT count(*)::int FROM qms.qc_spec) AS qc_specs_count,
        (SELECT count(*)::int FROM qms.qc_method) AS qc_methods_count,
        (SELECT count(*)::int FROM rd.project) AS rd_projects_count,
        (SELECT count(*)::int FROM rd.project_task) AS rd_tasks_count
    `)
  ).rows[0];

  const recentLogs = (
    await tx.query(
      `SELECT id, template_key, template_name, target_dept_code, target_warehouse_code,
              file_name, total_rows, created_count, updated_count, error_count,
              errors_json, actor_name, created_at
         FROM core.excel_import_log
        ORDER BY created_at DESC
        LIMIT 25`
    )
  ).rows;

  return {
    departments,
    warehouses,
    stats: countsRow,
    recent_logs: recentLogs,
  };
}

export async function executeExcelBatchImport(tx: Tx, actor: AuthzActor, input: Record<string, unknown>) {
  await ensureExcelImportSchema(tx);
  await ensureKitBomRoutingAndIfuSchema(tx);
  await ensureQaOpsSchema(tx);
  await ensureRdProjectOpsSchema(tx);

  const actorUserRow = (
    await tx.query("SELECT COALESCE(NULLIF(full_name, ''), username, 'Admin') AS display_name FROM users WHERE id = $1", [
      actor.userId,
    ])
  ).rows[0];
  const actorDisplayName = (actorUserRow?.display_name as string) || "Quản trị viên";

  const templateKey = normStr(input.template_key, "INVENTORY_STOCK").toUpperCase();
  const templateName = normStr(input.template_name, templateKey);
  const targetDeptCode = normStr(input.target_dept_code) || null;
  const targetWarehouseCode = normStr(input.target_warehouse_code) || null;
  const fileName = normStr(input.file_name, "import.xlsx");
  const rawRows = Array.isArray(input.rows) ? (input.rows as Record<string, unknown>[]) : [];

  let createdCount = 0;
  let updatedCount = 0;
  const errors: { row_no: number; code?: string; message: string }[] = [];

  if (templateKey === "INVENTORY_STOCK") {
    await authorize(tx, actor, "master.item.manage");
    const hasStockRows = rawRows.some((r) => normNum(r.qty_on_hand ?? r.qty ?? r["Số lượng tồn"], 0) > 0);
    if (hasStockRows) {
      await authorize(tx, actor, "inv.receipt.manage").catch(async (err) => {
        if (err?.code === "FORBIDDEN") {
          await authorize(tx, actor, "inv.document.post");
          return;
        }
        throw err;
      });
    }
    const canReleaseOpeningLot =
      Boolean(input.is_audited_opening_balance) && (await hasFactoryPermission(tx, actor, "inv.lot.release"));

    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const sp = `sp_inv_${i}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const itemCode = normCode(r.item_code || r["Mã vật tư"] || r["Mã vật tư (SKU)"]);
        const itemName = normStr(r.item_name || r["Tên vật tư"] || r["Tên vật tư / Sản phẩm"]);
        if (!itemCode || !itemName) {
          throw new Error("Thiếu Mã vật tư (item_code) hoặc Tên vật tư (item_name)");
        }
        const itemRes = await ensureItemByCode(tx, actor, {
          code: itemCode,
          name: itemName,
          item_type: normStr(r.item_type || r["Phân loại"] || r["Loại hàng"], "RAW_MATERIAL"),
          base_uom: normStr(r.base_uom || r["Đơn vị"], "pcs"),
          storage_condition: normStr(r.storage_condition || r["Bảo quản"], "RT"),
          shelf_life_days: normNum(r.shelf_life_days || r["Hạn dùng (ngày)"], 365),
          min_stock: normNum(r.min_stock || r["Tồn tối thiểu"] || r["Định mức (Min)"], 0),
          notes: normStr(r.notes || r["Ghi chú"]) || null,
        });
        if (itemRes.created) createdCount++;
        else updatedCount++;

        const qty = normNum(r.qty_on_hand ?? r.qty ?? r["Số lượng tồn"] ?? r["Số lượng tồn kho"], 0);
        const rawLotCode = normStr(r.lot_code || r["Số lô"] || r["Số Lô"]);
        let lotCode = normCode(rawLotCode && rawLotCode !== "-" ? rawLotCode : `${itemCode}-L01`, `${itemCode}-L01`);
        if (qty > 0 && itemRes.tracking !== "NONE") {
          const lotStatus = canReleaseOpeningLot ? "RELEASED" : "QUARANTINE";
          const whLoc = await resolveWarehouseAndLocation(
            tx,
            actor,
            normStr(r.warehouse_code || r["Mã kho"]) || targetWarehouseCode,
            normStr(r.dept_code || r["Mã phòng"]) || targetDeptCode,
            lotStatus === "QUARANTINE"
          );
          const mfgDate = normDate(r.mfg_date || r["Ngày SX"] || r["Ngày sản xuất"]);
          const expiryDate = normDate(r.expiry_date || r["Hạn dùng"] || r["Hạn sử dụng"]) || "2027-12-31";
          const rawMfrLot = normStr(r.mfr_lot_no || r["Lô NSX"] || r["Số lô NSX (Mfg Lot)"]);
          const mfrLot = rawMfrLot && rawMfrLot !== "-" ? rawMfrLot : lotCode;

          // Kiểm tra nếu mã lô bị trùng với vật tư khác (do nhiều vật tư chung số lô NSX), tự động gắn tiền tố mã vật tư
          const conflictLot = (
            await tx.query("SELECT item_id FROM inv.lot WHERE upper(code) = upper($1) AND item_id <> $2 LIMIT 1", [
              lotCode,
              itemRes.id,
            ])
          ).rows[0];
          if (conflictLot) {
            lotCode = `${itemCode}-${lotCode}`;
          }

          let lot = (
            await tx.query("SELECT id, status FROM inv.lot WHERE item_id = $1 AND upper(code) = upper($2) LIMIT 1", [
              itemRes.id,
              lotCode,
            ])
          ).rows[0];

          if (!lot) {
            lot = (
              await tx.query(
                `INSERT INTO inv.lot (code, item_id, mfr_lot_no, mfg_date, expiry_date, status, origin, created_by, updated_by)
                 VALUES ($1, $2, $3, $4, $5, $6, 'OPENING', $7, $7)
                 ON CONFLICT (code) DO UPDATE SET expiry_date = EXCLUDED.expiry_date
                 RETURNING id, status`,
                [lotCode, itemRes.id, mfrLot, mfgDate, expiryDate, lotStatus, actor.userId]
              )
            ).rows[0];
          }

          const prevBalRow = (
            await tx.query(
              `SELECT id, qty_on_hand::float AS qty_on_hand
                 FROM inv.stock_balance
                WHERE item_id = $1 AND lot_id = $2 AND container_id IS NULL AND location_id = $3
                LIMIT 1`,
              [itemRes.id, lot.id, whLoc.location_id]
            )
          ).rows[0];
          const prevQty = Number(prevBalRow?.qty_on_hand ?? 0);
          const deltaQty = Math.round((qty - prevQty) * 1e6) / 1e6;

          await tx.query(
            `INSERT INTO inv.stock_balance (item_id, lot_id, container_id, location_id, qty_on_hand, qty_reserved)
             VALUES ($1, $2, NULL, $3, $4, 0)
             ON CONFLICT (item_id, lot_id, container_id, location_id)
             DO UPDATE SET qty_on_hand = EXCLUDED.qty_on_hand, updated_at = now()`,
            [itemRes.id, lot.id, whLoc.location_id, qty]
          );

          if (Math.abs(deltaQty) > 1e-9) {
            const docCode = await nextNumber(tx, "STOCK_RECEIPT");
            const docRow = (
              await tx.query(
                `INSERT INTO inv.stock_document
                   (code, doc_type, reason_code, warehouse_id, status, posted_at, posted_by, notes, created_by, updated_by)
                 VALUES ($1, 'RECEIPT', 'INITIAL_BALANCE', $2, 'POSTED', now(), $3, $4, $3, $3)
                 RETURNING id`,
                [
                  docCode,
                  whLoc.warehouse_id,
                  actor.userId,
                  `Nhập tồn kho đầu kỳ từ file Excel (${fileName}) — Lô ${lotCode} (${lot.status})`,
                ]
              )
            ).rows[0];
            const lineRow = (
              await tx.query(
                `INSERT INTO inv.stock_document_line
                   (document_id, line_no, item_id, lot_id, container_id, to_location_id, qty, uom, qty_base)
                 VALUES ($1, 1, $2, $3, NULL, $4, $5, $6, $5)
                 RETURNING id`,
                [docRow.id, itemRes.id, lot.id, whLoc.location_id, Math.abs(deltaQty), itemRes.base_uom]
              )
            ).rows[0];
            await tx.query(
              `INSERT INTO inv.stock_ledger
                 (document_line_id, item_id, lot_id, container_id, location_id, qty_delta_base)
               VALUES ($1, $2, $3, NULL, $4, $5)`,
              [lineRow.id, itemRes.id, lot.id, whLoc.location_id, deltaQty]
            );
          }

          await writeAudit(tx, actor, {
            entityType: "stock_balance",
            entityId: lot.id,
            action: "initial_balance_receipt",
            changes: {
              item_code: [null, itemRes.code],
              lot_code: [null, lotCode],
              lot_status: [null, lot.status],
              qty_on_hand: [prevQty, qty],
              doc_type: [null, "RECEIPT"],
              reason_code: [null, "INITIAL_BALANCE"],
            },
            reason: `Nhập tồn đầu kỳ từ Excel (${fileName})`,
          });
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: i + 1, code: normStr(r.item_code), message: e?.message || String(e) });
      }
    }
  } else if (templateKey === "LAB_EQUIPMENT") {
    await authorize(tx, actor, "asset.manage");
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const sp = `sp_eq_${i}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const code = normCode(r.asset_code || r.code || r["Mã thiết bị"]);
        const name = normStr(r.asset_name || r.name || r["Tên thiết bị"]);
        if (!code || !name) throw new Error("Thiếu Mã thiết bị (asset_code) hoặc Tên thiết bị (asset_name)");

        const rawType = normStr(r.asset_type || r["Loại thiết bị"], "OTHER").toUpperCase();
        const validTypes = [
          "SYNTHESIZER",
          "HPLC",
          "PCR",
          "CENTRIFUGE",
          "FREEZER",
          "BALANCE",
          "SPECTROPHOTOMETER",
          "MASS_SPEC",
          "OTHER",
        ];
        const assetType = validTypes.includes(rawType) ? rawType : "OTHER";
        const orgUnitId = await resolveOrgUnitId(tx, normStr(r.dept_code || r["Mã phòng"]) || targetDeptCode || "P-RD");
        const manufacturer = normStr(r.manufacturer || r["Hãng sản xuất"]) || null;
        const model = normStr(r.model || r["Model"]) || null;
        const serialNo = normStr(r.serial_no || r["Số Serial"]) || null;
        const calDays = normNum(r.calibration_interval_days || r["Chu kỳ hiệu chuẩn (ngày)"], 365);
        const nextCal = normDate(r.next_calibration_due || r["Hạn hiệu chuẩn"]) || "2027-06-30";
        const rawStatus = normStr(r.status || r["Trạng thái"], "IN_SERVICE").toUpperCase();
        const status = ["IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_CALIBRATION", "RETIRED"].includes(rawStatus)
          ? rawStatus
          : "IN_SERVICE";

        const existing = (await tx.query("SELECT id FROM asset.asset WHERE upper(code) = upper($1) LIMIT 1", [code])).rows[0];
        if (existing) {
          await tx.query(
            `UPDATE asset.asset
                SET name = $2, asset_type = $3, owner_org_unit_id = $4, manufacturer = $5,
                    model = $6, serial_no = $7, calibration_interval_days = $8,
                    next_calibration_due = $9, status = $10, updated_at = now(), updated_by = $11
              WHERE id = $1`,
            [existing.id, name, assetType, orgUnitId, manufacturer, model, serialNo, calDays, nextCal, status, actor.userId]
          );
          updatedCount++;
        } else {
          const ins = (
            await tx.query(
              `INSERT INTO asset.asset (
                 code, name, asset_type, owner_org_unit_id, manufacturer, model,
                 serial_no, calibration_interval_days, next_calibration_due, status, created_by, updated_by
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
               RETURNING id`,
              [code, name, assetType, orgUnitId, manufacturer, model, serialNo, calDays, nextCal, status, actor.userId]
            )
          ).rows[0];
          if (assetType === "SYNTHESIZER") {
            const cols = normNum(r.column_positions, 48);
            await tx.query(
              `INSERT INTO oligo.synthesizer (asset_id, column_positions, supported_scales)
               VALUES ($1, $2, ARRAY['25nmol','50nmol','200nmol','1umol'])
               ON CONFLICT (asset_id) DO NOTHING`,
              [ins.id, cols]
            );
          }
          createdCount++;
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: i + 1, code: normStr(r.asset_code), message: e?.message || String(e) });
      }
    }
  } else if (templateKey === "KIT_BOM_FORMULA") {
    await authorize(tx, actor, "kit.bom.manage");
    const STAFF_CODE_MAP: Record<string, string> = {
      SX01: "Nguyễn Thị Thùy Trâm (NV-ABT-037)",
      SX02: "Võ Thanh Ngân (NV-ABT-038)",
      SX03: "Mai Hoàng Khánh Chi (NV-ABT-051)",
      SX04: "Nguyễn Cao Mỹ Anh (NV-ABT-039)",
      SX05: "Võ Thị Lệ Quyên (NV-ABT-040)",
      SX06: "Nguyễn Lê Thảo Phương (NV-ABT-041)",
      SX07: "Đoàn Hồng Sơn (NV-ABT-036)",
      SX10: "Nguyễn Thị Tuyết Nhi (NV-ABT-042)",
      SX11: "Trương Thị Ngọc Thùy (NV-ABT-043)",
      SX12: "Đặng Thị Thanh Mai (NV-ABT-044)",
      SX14: "Sơn Minh Nghĩa (NV-ABT-081)",
      SX15: "Sơn Minh Tình (NV-ABT-014)",
    };

    const grouped = new Map<string, Record<string, unknown>[]>();
    let currentBomCode = "";
    for (const r of rawRows) {
      const explicitCode = normCode(
        r.bom_code || r["Mã BOM"] || r.product_code || r["Mã sản phẩm"] || r["Mã sản phẩm (*)"]
      );
      if (explicitCode) {
        currentBomCode = explicitCode.toUpperCase().startsWith("BOM-") ? explicitCode : `BOM-${explicitCode}`;
      }
      if (!currentBomCode) continue;
      const arr = grouped.get(currentBomCode) ?? [];
      arr.push(r);
      grouped.set(currentBomCode, arr);
    }

    let groupIdx = 0;
    for (const [bomCode, lines] of grouped.entries()) {
      groupIdx++;
      const sp = `sp_kbom_${groupIdx}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const first = lines[0];
        const rawType = normStr(
          first.bom_type || first["Loại BOM"] || (fileName.toLowerCase().includes("ban_thanh_pham") || fileName.toLowerCase().includes("semi") ? "SEMI_FINISHED" : "FINISHED_KIT"),
          "FINISHED_KIT"
        ).toUpperCase();
        const isSemiFinished = rawType.includes("SEMI") || rawType.includes("BTP") || rawType.includes("BAN_THANH_PHAM");
        const dbBomType = isSemiFinished ? "semi_finished" : "finished_good";

        const productCode = normCode(
          first.product_code || first["Mã sản phẩm"] || first["Mã sản phẩm (*)"],
          bomCode.replace(/^BOM-/i, "")
        );
        const productName = normStr(
          first.product_name || first["Tên sản phẩm"] || first["Tên sản phẩm (*)"],
          `Sản phẩm ${productCode}`
        );
        const parentItemCode =
          normStr(first.parent_item_code || first["Mã sản phẩm chính"]) || productCode;

        const rawCat = normStr(
          first.bom_category || first.product_category || first["Phân loại Kit"] || first["Nhóm sản phẩm"] || first["Danh mục (PCR Kit/..)"]
        );
        const bomCategory =
          rawCat === "PCR Kit" || rawCat === "Tách chiết / Khác"
            ? rawCat
            : /pcr|mix/i.test(`${rawCat} ${productName}`) && !/tách chiết|extraction/i.test(`${rawCat} ${productName}`)
              ? "PCR Kit"
              : "Tách chiết / Khác";

        const specStr = normStr(first.specification || first["Quy cách"]);
        const specMatch = specStr.match(/(\d+(?:\.\d+)?)/);
        const parsedSpecNum = specMatch ? Number(specMatch[1]) : 0;

        const baseUomRaw = normStr(
          first.base_uom || first["Đơn vị tính SP"] || first["Đơn vị tính SP (*)"],
          isSemiFinished ? "mL" : "bộ"
        );
        const baseQty = isSemiFinished
          ? Math.max(1, normNum(first.base_qty, parsedSpecNum > 0 ? parsedSpecNum : 1))
          : Math.max(1, normNum(first.base_qty, 1));
        const testsPerKit = Math.max(
          1,
          Math.round(normNum(first.tests_per_kit || first["Số test/bộ"], parsedSpecNum > 0 ? parsedSpecNum : 50))
        );

        const shelfLifeMonths = Math.max(
          1,
          Math.round(normNum(first.shelf_life_months || first["Hạn sử dụng (tháng)"], 12))
        );
        const shelfLifeDays = Math.max(
          1,
          Math.round(normNum(first.shelf_life_days || first["Hạn dùng (ngày)"], shelfLifeMonths * 30))
        );
        const storageStr = normStr(
          first.storage_condition || first["Điều kiện bảo quản"],
          bomCategory === "PCR Kit" ? "-20°C" : "15-25°C"
        );
        const qcRetQty = Math.max(0, normNum(first.qc_retention_qty || first["Lượng QC/lưu kho"], isSemiFinished ? 0 : 1));
        const phRaw = normStr(first.ph_range || first["Phạm vi pH (Min-Max)"]);
        const phParts = phRaw.match(/(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)/);
        const phMin = phParts ? Number(phParts[1]) : null;
        const phMax = phParts ? Number(phParts[2]) : null;

        const rawStaff = normStr(
          first.responsible_person || first["Người phụ trách"] || first["Người phụ trách (Mã NV)"] || first["Người phụ trách \n(Mã NV)"] || first["Người phụ trách \r\n(Mã NV)"]
        );
        const responsible = STAFF_CODE_MAP[rawStaff.toUpperCase()] || rawStaff || actorDisplayName;
        const tccsCode = normStr(first.tccs_code || first["Mã TCCS"], `TCCS ${parentItemCode}:2026/ABT`);
        const bomName = normStr(
          first.bom_name || first["Tên công thức BOM"],
          `Định mức ${productName}${specStr ? ` (${specStr})` : ""}`
        );
        const orgUnitId = await resolveOrgUnitId(tx, normStr(first.dept_code) || targetDeptCode || "P-KIT");

        const prodItem = await ensureItemByCode(tx, actor, {
          code: productCode,
          name: productName,
          item_type: isSemiFinished ? "SEMI_FINISHED" : "FINISHED_KIT",
          base_uom: baseUomRaw,
          storage_condition: storageStr,
          shelf_life_days: shelfLifeDays,
        });

        let bom = (await tx.query("SELECT id FROM kit.bom WHERE upper(code) = upper($1) LIMIT 1", [bomCode])).rows[0];
        if (bom) {
          await tx.query(
            `UPDATE kit.bom
                SET name = $2, product_item_id = $3, base_qty = $4, base_uom = $5,
                    tests_per_kit = $6, shelf_life_days = $7, shelf_life_months = $8,
                    bom_type = $9, bom_category = $10, parent_item_code = $11,
                    tccs_code = $12, responsible_person_name = $13, specification = $14,
                    storage_condition = $15, qc_retention_qty = $16, ph_min = $17, ph_max = $18,
                    status = 'EFFECTIVE', updated_at = now(), updated_by = $19
              WHERE id = $1`,
            [
              bom.id,
              bomName,
              prodItem.id,
              baseQty,
              prodItem.base_uom,
              testsPerKit,
              shelfLifeDays,
              shelfLifeMonths,
              dbBomType,
              bomCategory,
              parentItemCode,
              tccsCode,
              responsible,
              specStr || `${testsPerKit} tests`,
              storageStr,
              qcRetQty,
              phMin,
              phMax,
              actor.userId,
            ]
          );
          await tx.query("DELETE FROM kit.bom_line WHERE bom_id = $1", [bom.id]);
          updatedCount++;
        } else {
          bom = (
            await tx.query(
              `INSERT INTO kit.bom (
                 code, org_unit_id, product_item_id, bom_version, name, base_qty, base_uom,
                 tests_per_kit, shelf_life_days, shelf_life_months, bom_type, bom_category,
                 parent_item_code, tccs_code, responsible_person_name, specification,
                 storage_condition, qc_retention_qty, ph_min, ph_max, variant_code, supply_form,
                 status, created_by, updated_by
               ) VALUES (
                 $1, $2, $3, 1, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, $13, $14, $15,
                 $16, $17, $18, $19, 'BASE', 'NO_SPLIT_NO_IC',
                 'EFFECTIVE', $20, $20
               )
               RETURNING id`,
              [
                bomCode,
                orgUnitId,
                prodItem.id,
                bomName,
                baseQty,
                prodItem.base_uom,
                testsPerKit,
                shelfLifeDays,
                shelfLifeMonths,
                dbBomType,
                bomCategory,
                parentItemCode,
                tccsCode,
                responsible,
                specStr || `${testsPerKit} tests`,
                storageStr,
                qcRetQty,
                phMin,
                phMax,
                actor.userId,
              ]
            )
          ).rows[0];
          createdCount++;
        }

        const VALID_ROLES = new Set([
          "MASTER_MIX",
          "PRIMER_PROBE",
          "ENZYME",
          "INTERNAL_CONTROL",
          "POSITIVE_CONTROL",
          "NEGATIVE_CONTROL",
          "EXTRACTION_BUFFER",
          "PCR_TUBE_STRIP",
          "PACKAGING",
          "SEMI_FINISHED",
          "REAGENT",
        ]);

        let lineNo = 0;
        for (let idx = 0; idx < lines.length; idx++) {
          const l = lines[idx];
          const compCode = normCode(l.component_code || l["Mã NVL thành phần"] || l["Mã nguyên liệu (*)"]);
          if (!compCode || compCode.toUpperCase() === productCode.toUpperCase()) continue;
          const compName = normStr(l.component_name || l["Tên NVL thành phần"], compCode);
          const compUom = normStr(l.uom || l["Đơn vị"] || l["Đơn vị ND (*)"], "mL");
          const compUomVerified = await ensureUomExists(tx, compUom);

          const codeU = compCode.toUpperCase();
          const rawRole = normStr(l.component_role || l["Vai trò thành phần"]).toUpperCase();
          const inferredRole = VALID_ROLES.has(rawRole)
            ? rawRole
            : codeU.startsWith("VT-TUBE-")
              ? "PCR_TUBE_STRIP"
              : /^A00[123]$/i.test(codeU)
                ? "INTERNAL_CONTROL"
                : codeU === "NC"
                  ? "NEGATIVE_CONTROL"
                  : /^(PS|PM|SD)/i.test(codeU)
                    ? "POSITIVE_CONTROL"
                    : /^M[A-Z0-9]/i.test(codeU) && compUom.toLowerCase().includes("test")
                      ? "MASTER_MIX"
                      : /^(CTT|DGM|HGM|HGPK|DGU|HGU|CNM|CNN|CNV|FAL|TIP)/i.test(codeU)
                        ? "PACKAGING"
                        : /^(F|R|P)\d/i.test(codeU)
                          ? "PRIMER_PROBE"
                          : /^ST\d/i.test(codeU)
                            ? "EXTRACTION_BUFFER"
                            : "REAGENT";

          const compItem = await ensureItemByCode(tx, actor, {
            code: compCode,
            name: compName,
            item_type:
              inferredRole === "MASTER_MIX" || inferredRole === "EXTRACTION_BUFFER"
                ? "SEMI_FINISHED"
                : inferredRole === "PACKAGING" || inferredRole === "PCR_TUBE_STRIP"
                  ? "CONSUMABLE"
                  : "REAGENT",
            base_uom: compUomVerified,
            storage_condition: storageStr,
          });
          const qtyPerBase = Math.max(0.000001, normNum(l.qty_per_base || l["Định mức/bộ"] || l["Số lượng ND (*)"], 1));
          const scrapPct = normNum(l.scrap_pct || l["Hao hụt (%)"], 0);
          const lineNotes = normStr(l.notes || l["Ghi chú"]) || null;
          const isPackaging = inferredRole === "PACKAGING" || inferredRole === "PCR_TUBE_STRIP";

          lineNo++;
          await tx.query(
            `INSERT INTO kit.bom_line (
               bom_id, line_no, component_item_id, qty_per_base, uom, scrap_pct,
               box_no, component_role, is_critical, is_mix_component,
               is_demo_fixed_component, include_in_qc_retention, notes, created_by, updated_by
             ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, true, $8, $9, $10, $11, $12, $12)`,
            [
              bom.id,
              lineNo,
              compItem.id,
              qtyPerBase,
              compUomVerified,
              scrapPct,
              inferredRole,
              !isPackaging,
              isPackaging,
              !isPackaging,
              lineNotes,
              actor.userId,
            ]
          );
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: groupIdx, code: bomCode, message: e?.message || String(e) });
      }
    }
  } else if (templateKey === "PREP_OLIGO_FORMULA") {
    await authorize(tx, actor, "prep.formula.manage");
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const r of rawRows) {
      const fCode = normCode(r.formula_code || r["Mã công thức"]);
      if (!fCode) continue;
      const arr = grouped.get(fCode) ?? [];
      arr.push(r);
      grouped.set(fCode, arr);
    }
    let groupIdx = 0;
    for (const [formulaCode, lines] of grouped.entries()) {
      groupIdx++;
      const sp = `sp_prep_${groupIdx}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const first = lines[0];
        const formulaName = normStr(first.formula_name || first["Tên công thức pha chế"], `Công thức ${formulaCode}`);
        const category = normStr(first.category || first["Nhóm pha chế"], "Đệm & Hóa chất Tổng hợp");
        const outputCode = normCode(first.output_item_code || first["Mã hóa chất đích"], `${formulaCode}-OUT`);
        const outputName = normStr(first.output_item_name || first["Tên hóa chất đích"], formulaName);
        const basisQty = Math.max(0.001, normNum(first.basis_qty || first["Mẻ chuẩn"], 1000));
        const basisUom = normStr(first.basis_uom || first["Đơn vị mẻ"], "mL");
        const shelfLifeDays = Math.max(1, Math.round(normNum(first.shelf_life_days || first["Hạn dùng (ngày)"], 180)));
        const instructions = normStr(first.instructions || first["Hướng dẫn pha chế SOP"]) || null;

        const outItem = await ensureItemByCode(tx, actor, {
          code: outputCode,
          name: outputName,
          item_type: "SEMI_FINISHED",
          base_uom: basisUom,
          shelf_life_days: shelfLifeDays,
        });

        let formula = (
          await tx.query("SELECT id FROM prep.formula WHERE upper(code) = upper($1) LIMIT 1", [formulaCode])
        ).rows[0];
        if (formula) {
          await tx.query(
            `UPDATE prep.formula
                SET name = $2, category = $3, output_item_id = $4, basis_qty = $5,
                    basis_uom = $6, shelf_life_days = $7, instructions = $8,
                    status = 'ACTIVE', updated_at = now(), updated_by = $9
              WHERE id = $1`,
            [formula.id, formulaName, category, outItem.id, basisQty, outItem.base_uom, shelfLifeDays, instructions, actor.userId]
          );
          await tx.query("DELETE FROM prep.formula_line WHERE formula_id = $1", [formula.id]);
          updatedCount++;
        } else {
          formula = (
            await tx.query(
              `INSERT INTO prep.formula (
                 code, name, category, output_item_id, basis_qty, basis_uom,
                 shelf_life_days, requires_qc, instructions, status, created_by, updated_by, incubation_days
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, 'ACTIVE', $9, $9, 0)
               RETURNING id`,
              [formulaCode, formulaName, category, outItem.id, basisQty, outItem.base_uom, shelfLifeDays, instructions, actor.userId]
            )
          ).rows[0];
          createdCount++;
        }

        for (let idx = 0; idx < lines.length; idx++) {
          const l = lines[idx];
          const ingCode = normCode(l.ingredient_code || l["Mã nguyên liệu"]);
          const ingName = normStr(l.ingredient_name || l["Tên nguyên liệu"], ingCode);
          if (!ingCode) continue;
          const ingUom = normStr(l.ingredient_uom || l["Đơn vị NL"], "mL");
          const ingItem = await ensureItemByCode(tx, actor, {
            code: ingCode,
            name: ingName,
            item_type: "REAGENT",
            base_uom: ingUom,
          });
          const ingQty = Math.max(0.0001, normNum(l.ingredient_qty || l["Lượng dùng"], 1));
          await tx.query(
            `INSERT INTO prep.formula_line (formula_id, line_no, item_id, qty, uom)
             VALUES ($1, $2, $3, $4, $5)`,
            [formula.id, idx + 1, ingItem.id, ingQty, ingItem.base_uom]
          );
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: groupIdx, code: formulaCode, message: e?.message || String(e) });
      }
    }
  } else if (templateKey === "DEVICE_MODEL_BOM") {
    await authorize(tx, actor, "device.model.manage");
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const r of rawRows) {
      const mCode = normCode(r.model_code || r["Mã Model Thiết bị"]);
      if (!mCode) continue;
      const arr = grouped.get(mCode) ?? [];
      arr.push(r);
      grouped.set(mCode, arr);
    }
    let groupIdx = 0;
    for (const [modelCode, lines] of grouped.entries()) {
      groupIdx++;
      const sp = `sp_dev_${groupIdx}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const first = lines[0];
        const modelName = normStr(first.model_name || first["Tên thiết bị thương mại"], modelCode);
        const category = normStr(first.category || first["Nhóm thiết bị"], "OTHER").toUpperCase();
        const validCats = [
          "THERMAL_CYCLER",
          "EXTRACTOR",
          "CENTRIFUGE",
          "SPIN_COLUMN_SYSTEM",
          "INCUBATOR",
          "SPECTROPHOTOMETER",
          "OTHER",
        ];
        const catEnum = validCats.includes(category) ? category : "OTHER";
        const warrantyMonths = Math.max(0, Math.round(normNum(first.warranty_months || first["Bảo hành (tháng)"], 24)));
        const price = normNum(first.price || first["Giá niêm yết (VNĐ)"], 35000000);
        const orgUnitId = await resolveOrgUnitId(tx, normStr(first.dept_code) || targetDeptCode || "P-DEVICE");

        const modelItem = await ensureItemByCode(tx, actor, {
          code: modelCode,
          name: modelName,
          item_type: "DEVICE",
          base_uom: "pcs",
        });

        let model = (
          await tx.query("SELECT id, current_revision_id FROM device.device_model WHERE upper(code) = upper($1) LIMIT 1", [modelCode])
        ).rows[0];
        if (model) {
          await tx.query(
            `UPDATE device.device_model
                SET name = $2, category = $3, warranty_months = $4, price = $5,
                    updated_at = now(), updated_by = $6
              WHERE id = $1`,
            [model.id, modelName, catEnum, warrantyMonths, price, actor.userId]
          );
          updatedCount++;
        } else {
          model = (
            await tx.query(
              `INSERT INTO device.device_model (
                 code, name, org_unit_id, item_id, category, warranty_months,
                 required_burn_in_hours, price, status, created_by, updated_by
               ) VALUES ($1, $2, $3, $4, $5, $6, 24, $7, 'COMMERCIAL', $8, $8)
               RETURNING id, current_revision_id`,
              [modelCode, modelName, orgUnitId, modelItem.id, catEnum, warrantyMonths, price, actor.userId]
            )
          ).rows[0];
          createdCount++;
        }

        let revId = model.current_revision_id as string | null;
        if (!revId) {
          const revRow = (
            await tx.query("SELECT id FROM device.model_revision WHERE model_id = $1 ORDER BY created_at DESC LIMIT 1", [model.id])
          ).rows[0];
          if (revRow) {
            revId = revRow.id;
          } else {
            const newRev = (
              await tx.query(
                `INSERT INTO device.model_revision (
                   model_id, revision, firmware_version, dmr_summary,
                   effectivity_type, status, released_by, released_at, created_by, updated_by
                 ) VALUES ($1, '1.0', 'v1.0', $2, 'IMMEDIATE', 'DRAFT', NULL, NULL, $3, $3)
                 RETURNING id`,
                [model.id, `Hồ sơ thiết kế chuẩn DMR cho ${modelName}`, actor.userId]
              )
            ).rows[0];
            revId = newRev.id;
            await tx.query("UPDATE device.device_model SET current_revision_id = $2 WHERE id = $1", [model.id, revId]);
          }
        }

        await tx.query("DELETE FROM device.model_bom_line WHERE revision_id = $1", [revId]);
        for (let idx = 0; idx < lines.length; idx++) {
          const l = lines[idx];
          const partCode = normCode(l.part_code || l["Mã linh kiện"]);
          const partName = normStr(l.part_name || l["Tên linh kiện"], partCode);
          if (!partCode) continue;
          const partItem = await ensureItemByCode(tx, actor, {
            code: partCode,
            name: partName,
            item_type: "COMPONENT",
            base_uom: normStr(l.uom || l["Đơn vị"], "pcs"),
          });
          const qtyPerDevice = Math.max(0.001, normNum(l.qty_per_device || l["Định mức/máy"], 1));
          const stationRaw = normStr(l.station_code || l["Trạm lắp ráp"], "STATION_1_MECH").toUpperCase();
          const station = ["STATION_1_MECH", "STATION_2_PCB", "STATION_3_FW", "STATION_4_FQC"].includes(stationRaw)
            ? stationRaw
            : "STATION_1_MECH";
          await tx.query(
            `INSERT INTO device.model_bom_line (
               revision_id, line_no, component_item_id, qty_per_device, uom,
               station_code, trace_mode, is_critical, notes
             ) VALUES ($1, $2, $3, $4, $5, $6, 'LOT', true, $7)`,
            [revId, idx + 1, partItem.id, qtyPerDevice, partItem.base_uom, station, normStr(l.notes || l["Ghi chú"]) || null]
          );
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: groupIdx, code: modelCode, message: e?.message || String(e) });
      }
    }
  } else if (templateKey === "ROUTING_SOP") {
    await authorize(tx, actor, "kit.bom.manage");
    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const r of rawRows) {
      const rtCode = normCode(r.routing_code || r["Mã quy trình"]);
      if (!rtCode) continue;
      const arr = grouped.get(rtCode) ?? [];
      arr.push(r);
      grouped.set(rtCode, arr);
    }
    let groupIdx = 0;
    for (const [routingCode, steps] of grouped.entries()) {
      groupIdx++;
      const sp = `sp_rt_${groupIdx}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const first = steps[0];
        const routingName = normStr(first.routing_name || first["Tên quy trình / SOP"], `Quy trình ${routingCode}`);
        const productCode = normCode(first.product_code || first["Mã sản phẩm"], `${routingCode}-PRD`);
        const productName = normStr(first.product_name || first["Tên sản phẩm"], routingName);
        const orgUnitId = await resolveOrgUnitId(tx, normStr(first.dept_code) || targetDeptCode || "P-KIT");

        const prodItem = await ensureItemByCode(tx, actor, {
          code: productCode,
          name: productName,
          item_type: "FINISHED_KIT",
          base_uom: "kit",
        });

        let routing = (await tx.query("SELECT id FROM kit.routing WHERE upper(code) = upper($1) LIMIT 1", [routingCode])).rows[0];
        if (routing) {
          await tx.query(
            `UPDATE kit.routing
                SET name = $2, product_item_id = $3, status = 'DRAFT',
                    updated_at = now(), updated_by = $4
              WHERE id = $1`,
            [routing.id, routingName, prodItem.id, actor.userId]
          );
          await tx.query("DELETE FROM kit.routing_step WHERE routing_id = $1", [routing.id]);
          updatedCount++;
        } else {
          routing = (
            await tx.query(
              `INSERT INTO kit.routing (
                 code, org_unit_id, product_item_id, routing_version, name,
                 status, approved_by, approved_at, created_by, updated_by
               ) VALUES ($1, $2, $3, 1, $4, 'DRAFT', NULL, NULL, $5, $5)
               RETURNING id`,
              [routingCode, orgUnitId, prodItem.id, routingName, actor.userId]
            )
          ).rows[0];
          createdCount++;
        }

        for (let idx = 0; idx < steps.length; idx++) {
          const s = steps[idx];
          const stepNo = Math.max(1, Math.round(normNum(s.step_no || s["Thứ tự bước"], idx + 1)));
          const stepCode = normCode(s.step_code || s["Mã công đoạn"], `STEP-${stepNo}`);
          const stepName = normStr(s.step_name || s["Tên công đoạn"], `Công đoạn ${stepNo}`);
          const instructions = normStr(s.instructions || s["Hướng dẫn thao tác SOP"], stepName);
          const stdMinutes = Math.max(1, Math.round(normNum(s.std_minutes || s["Thời gian chuẩn (phút)"], 30)));
          const qcGate = ["Y", "YES", "TRUE", "1", "CÓ"].includes(normStr(s.ipqc_required || s["Yêu cầu IPQC"], "Y").toUpperCase());

          await tx.query(
            `INSERT INTO kit.routing_step (
               routing_id, step_no, code, name, work_center, instructions,
               expected_duration_min, requires_line_clearance, requires_env_check,
               ipqc_required, dual_sign_required
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, true)`,
            [
              routing.id,
              stepNo,
              stepCode,
              stepName,
              normStr(s.work_center || s["Phòng / Khu vực"], "Phòng Sạch Sản Xuất"),
              instructions,
              stdMinutes,
              idx === 0,
              qcGate,
            ]
          );
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: groupIdx, code: routingCode, message: e?.message || String(e) });
      }
    }
  } else if (templateKey === "QC_METHOD_SPEC") {
    await authorize(tx, actor, "qms.spec.manage");
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const sp = `sp_qc_${i}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const methodCode = normCode(r.method_code || r["Mã phương pháp QC"]);
        const methodName = normStr(r.method_name || r["Tên phương pháp / Tiêu chuẩn QC"]);
        if (!methodCode || !methodName) {
          throw new Error("Thiếu Mã phương pháp QC (method_code) hoặc Tên phương pháp (method_name)");
        }
        const rawCat = normStr(r.category || r["Nhóm phương pháp"], "QPCR_ASSAY").toUpperCase();
        const validCats = [
          "QPCR_ASSAY",
          "HPLC_CHROMATOGRAPHY",
          "PAGE_ELECTROPHORESIS",
          "UV_VIS_OD",
          "ELECTRICAL_SAFETY",
          "MECHANICAL_DIMENSIONAL",
          "PHYSICOCHEMICAL",
        ];
        const category = validCats.includes(rawCat) ? rawCat : "QPCR_ASSAY";
        const instrument = normStr(r.instrument_type || r["Thiết bị đo"], "Hệ thống Real-time PCR / Đo quang");
        const principle = normStr(r.principle || r["Nguyên lý & Quy trình"], methodName);
        const suitability = normStr(r.suitability_criteria || r["Tiêu chuẩn chấp nhận (SST)"], "Đạt yêu cầu TCCS / ISO 13485");

        const existingMethod = (
          await tx.query("SELECT id FROM qms.qc_method WHERE upper(code) = upper($1) LIMIT 1", [methodCode])
        ).rows[0];
        if (existingMethod) {
          await tx.query(
            `UPDATE qms.qc_method
                SET name = $2, category = $3, instrument_type = $4,
                    principle = $5, suitability_criteria = $6, updated_at = now(), updated_by = $7
              WHERE id = $1`,
            [existingMethod.id, methodName, category, instrument, principle, suitability, actor.userId]
          );
          updatedCount++;
        } else {
          await tx.query(
            `INSERT INTO qms.qc_method (
               code, version_no, name, category, instrument_type,
               principle, suitability_criteria, status, created_by, updated_by
             ) VALUES ($1, 1, $2, $3, $4, $5, $6, 'EFFECTIVE', $7, $7)`,
            [methodCode, methodName, category, instrument, principle, suitability, actor.userId]
          );
          createdCount++;
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: i + 1, code: normStr(r.method_code), message: e?.message || String(e) });
      }
    }
  } else if (templateKey === "RD_PROJECT_WBS") {
    await authorize(tx, actor, "rd.project.manage");
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      const sp = `sp_rd_${i}`;
      await tx.query(`SAVEPOINT ${sp}`);
      try {
        const projCode = normCode(r.project_code || r["Mã dự án R&D"]);
        const projName = normStr(r.project_name || r["Tên dự án R&D"]);
        const taskTitle = normStr(r.task_title || r["Nội dung công việc WBS"]);
        if (!projCode || !projName || !taskTitle) {
          throw new Error("Thiếu Mã dự án, Tên dự án hoặc Nội dung công việc WBS");
        }
        const orgUnitId = await resolveOrgUnitId(tx, "P-RD");
        const leaderName = normStr(r.leader_name || r["Chủ nhiệm đề tài"], actorDisplayName);

        let proj = (await tx.query("SELECT id FROM rd.project WHERE upper(code) = upper($1) LIMIT 1", [projCode])).rows[0];
        if (!proj) {
          let tpl = (await tx.query("SELECT id FROM rd.gate_template ORDER BY created_at LIMIT 1")).rows[0];
          if (!tpl) {
            tpl = (
              await tx.query(
                `INSERT INTO rd.gate_template (code, name, target_domain, gates, status)
                 VALUES ('TPL-IVD-STD', 'Khung 5 Cổng Stage-Gate Chuẩn IVD', 'KIT', '[]'::jsonb, 'ACTIVE')
                 RETURNING id`
              )
            ).rows[0];
          }
          proj = (
            await tx.query(
              `INSERT INTO rd.project (
                 code, name, owner_org_unit_id, target_domain, ivd_class,
                 leader_id, leader_name_override, template_id, current_stage,
                 status, project_type, budget_amount, created_by, updated_by
               ) VALUES ($1, $2, $3, $4, 'CLASS_B', $5, $6, $7, 'G1_FEASIBILITY', 'ACTIVE', 'NEW_PRODUCT', $8, $5, $5)
               RETURNING id`,
              [
                projCode,
                projName,
                orgUnitId,
                normStr(r.target_domain, "KIT").toUpperCase(),
                actor.userId,
                leaderName,
                tpl.id,
                normNum(r.budget_amount, 60000000),
              ]
            )
          ).rows[0];
        }

        const taskCode = normCode(r.task_code || r["Mã việc WBS"], `${projCode}-WBS-${String(i + 1).padStart(2, "0")}`);
        const gateNo = Math.min(4, Math.max(0, Math.round(normNum(r.gate_no ?? r["Cổng Gate"], 1))));
        const assigneeName = normStr(r.assignee_name || r["Nghiên cứu viên phụ trách"], leaderName);
        const dueDate = normDate(r.due_date || r["Hạn hoàn thành"]);
        const statusRaw = normStr(r.status || r["Trạng thái"], "IN_PROGRESS").toUpperCase();
        const status = ["TODO", "IN_PROGRESS", "DONE", "BLOCKED"].includes(statusRaw) ? statusRaw : "IN_PROGRESS";
        const progressPct = Math.min(100, Math.max(0, Math.round(normNum(r.progress_pct, status === "DONE" ? 100 : 50))));
        const resultSummary = normStr(r.result_summary || r["Tóm tắt kết quả"]) || null;
        const protocolSummary = normStr(r.protocol_summary || r["Phương pháp thực nghiệm"]) || null;
        const verdictRaw = normStr(r.outcome_verdict || r["Đánh giá kết luận"], resultSummary ? "PASS" : "PENDING").toUpperCase();
        const verdict = ["PENDING", "PASS", "OPTIMIZE", "FAIL"].includes(verdictRaw) ? verdictRaw : "PASS";

        const existingTask = (
          await tx.query("SELECT id FROM rd.project_task WHERE project_id = $1 AND upper(code) = upper($2) LIMIT 1", [
            proj.id,
            taskCode,
          ])
        ).rows[0];

        if (existingTask) {
          await tx.query(
            `UPDATE rd.project_task
                SET gate_no = $2, title = $3, assignee_name = $4, due_date = $5,
                    status = $6, progress_pct = $7, protocol_summary = COALESCE($8, protocol_summary),
                    result_summary = COALESCE($9, result_summary), outcome_verdict = $10, updated_at = now()
              WHERE id = $1`,
            [existingTask.id, gateNo, taskTitle, assigneeName, dueDate, status, progressPct, protocolSummary, resultSummary, verdict]
          );
          updatedCount++;
        } else {
          await tx.query(
            `INSERT INTO rd.project_task (
               project_id, code, gate_no, title, assignee_name, due_date,
               status, progress_pct, protocol_summary, result_summary, outcome_verdict, created_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              proj.id,
              taskCode,
              gateNo,
              taskTitle,
              assigneeName,
              dueDate,
              status,
              progressPct,
              protocolSummary,
              resultSummary,
              verdict,
              actor.userId,
            ]
          );
          createdCount++;
        }
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (e: any) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        errors.push({ row_no: i + 1, code: normStr(r.task_code || r.project_code), message: e?.message || String(e) });
      }
    }
  } else {
    throw new Error(`Biểu mẫu không hợp lệ: ${templateKey}`);
  }

  const logRow = (
    await tx.query(
      `INSERT INTO core.excel_import_log (
         template_key, template_name, target_dept_code, target_warehouse_code,
         file_name, total_rows, created_count, updated_count, error_count,
         errors_json, actor_id, actor_name
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       RETURNING *`,
      [
        templateKey,
        templateName,
        targetDeptCode,
        targetWarehouseCode,
        fileName,
        rawRows.length,
        createdCount,
        updatedCount,
        errors.length,
        JSON.stringify(errors),
        actor.userId,
        actorDisplayName,
      ]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "excel_import",
    entityId: logRow.id,
    action: "import",
    changes: {
      template: [null, templateKey],
      file_name: [null, fileName],
      created: [0, createdCount],
      updated: [0, updatedCount],
      errors: [0, errors.length],
    },
  });

  return {
    log: logRow,
    total_rows: rawRows.length,
    created_count: createdCount,
    updated_count: updatedCount,
    error_count: errors.length,
    errors,
  };
}
