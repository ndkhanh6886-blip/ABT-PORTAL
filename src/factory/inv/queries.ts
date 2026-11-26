import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { type AuthzActor } from "../core/authz";
import { forbidden } from "../core/errors";
import { parseInput } from "../core/records";
import { ITEM_TYPES } from "../master/schemas";

let lastBomTypeSyncAt = 0;

/**
 * Ensures items that are the output product of a Finished Kit BOM, Semi-Finished BOM, or Prep Formula
 * carry the canonical `FINISHED_KIT` or `SEMI_FINISHED` item_type so warehouse classification and filters
 * ("Nguyên liệu / Bán thành phẩm / Thành phẩm") stay accurate regardless of Excel import order.
 */
export async function syncItemTypesFromBomAndFormula(tx: Tx, force = false): Promise<void> {
  // Luôn tự động khôi phục các lô đang ở trạng thái EXPIRED nhưng đã được gia hạn/cập nhật hạn dùng (expiry_date >= CURRENT_DATE) sang RELEASED
  // Chạy độc lập ngoài savepoint đồng bộ BOM để không bao giờ bị rollback hoặc bị throttle
  await tx.query(`
    UPDATE inv.lot
       SET status = 'RELEASED',
           version = version + 1,
           updated_at = now()
     WHERE status = 'EXPIRED'
       AND (expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
  `);
  const now = Date.now();
  if (!force && now - lastBomTypeSyncAt < 30_000) return;
  await tx.query("SAVEPOINT sp_sync_bom_item_types");
  try {
    // Unify any legacy <FORMULA_CODE>-OUT product items back into <FORMULA_CODE> (1 formula code = 1 product item)
    const outRows = (
      await tx.query(
        `SELECT f.id AS formula_id, f.code AS formula_code, f.name AS formula_name, f.output_item_id
           FROM prep.formula f
           JOIN master.item i ON i.id = f.output_item_id
          WHERE upper(i.code) = upper(f.code || '-OUT')`
      )
    ).rows;
    for (const r of outRows) {
      const fCodeU = String(r.formula_code).trim().toUpperCase();
      const outItemId = r.output_item_id as string;
      const selfIngredient = (
        await tx.query(
          `SELECT 1 FROM prep.formula_line fl
             JOIN master.item ing ON ing.id = fl.item_id
            WHERE fl.formula_id = $1 AND upper(ing.code) = $2 LIMIT 1`,
          [r.formula_id, fCodeU]
        )
      ).rowCount;
      if (selfIngredient) continue;
      const baseItem = (
        await tx.query("SELECT id FROM master.item WHERE upper(code) = $1 AND id <> $2 LIMIT 1", [fCodeU, outItemId])
      ).rows[0];
      if (!baseItem) {
        await tx.query(
          `UPDATE master.item
              SET code = $2,
                  name = COALESCE(NULLIF($3, ''), name),
                  updated_at = now()
            WHERE id = $1`,
          [outItemId, fCodeU, r.formula_name]
        );
      } else {
        const targetId = baseItem.id as string;
        await tx.query(
          `UPDATE master.item
              SET name = COALESCE(NULLIF($2, ''), name),
                  item_type = CASE WHEN item_type = 'RAW_MATERIAL' THEN 'SEMI_FINISHED' ELSE item_type END,
                  is_manufacturable = true,
                  status = 'ACTIVE',
                  updated_at = now()
            WHERE id = $1`,
          [targetId, r.formula_name]
        );
        await tx.query("UPDATE prep.formula SET output_item_id = $2 WHERE output_item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.reagent_rule SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.synth_port SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.batch_port_use SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.synthesis_reagent_use SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.modification SET amidite_item_id = $2 WHERE amidite_item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE asset.reagent_slot SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE asset.reagent_usage SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        const outLots = (await tx.query("SELECT id, code FROM inv.lot WHERE item_id = $1", [outItemId])).rows;
        for (const lt of outLots) {
          const clash = (
            await tx.query("SELECT id FROM inv.lot WHERE item_id = $1 AND code = $2 LIMIT 1", [targetId, lt.code])
          ).rows[0];
          if (clash) {
            await tx.query("UPDATE inv.lot SET item_id = $2, code = $3 WHERE id = $1", [lt.id, targetId, `${lt.code}-P`]);
          } else {
            await tx.query("UPDATE inv.lot SET item_id = $2 WHERE id = $1", [lt.id, targetId]);
          }
        }
        await tx.query("UPDATE inv.stock_balance SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE inv.reservation SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE inv.stock_document_line SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE inv.stock_ledger SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query(
          `UPDATE oligo.ps_method
              SET fields = (
                SELECT coalesce(
                  jsonb_agg(
                    CASE
                      WHEN elem->>'item_id' = $1 THEN jsonb_set(elem, '{item_id}', to_jsonb($2::text))
                      ELSE elem
                    END
                  ),
                  '[]'::jsonb
                )
                FROM jsonb_array_elements(fields) AS elem
              )
            WHERE fields::text LIKE '%' || $1 || '%'`,
          [outItemId, targetId]
        );
        await tx.query("SAVEPOINT sp_del_out_item_sync");
        const deleted = await tx
          .query("DELETE FROM master.item WHERE id = $1", [outItemId])
          .then(async () => {
            await tx.query("RELEASE SAVEPOINT sp_del_out_item_sync");
            return true;
          })
          .catch(async () => {
            await tx.query("ROLLBACK TO SAVEPOINT sp_del_out_item_sync").catch(() => {});
            return false;
          });
        if (!deleted) {
          await tx.query("UPDATE master.item SET status = 'INACTIVE', code = $2 WHERE id = $1", [
            outItemId,
            `OLD-${fCodeU}-OUT`,
          ]);
        }
      }
    }

    await tx.query(`
      UPDATE master.item i
         SET item_type = 'FINISHED_KIT',
             is_manufacturable = true
       WHERE i.item_type NOT IN ('FINISHED_KIT', 'DEVICE')
         AND EXISTS (
           SELECT 1 FROM kit.bom b
            WHERE (b.product_item_id = i.id OR upper(trim(b.parent_item_code)) = upper(trim(i.code)))
              AND coalesce(b.bom_type, 'finished_good') = 'finished_good'
              AND b.status <> 'OBSOLETE'
         )
    `);
    await tx.query(`
      UPDATE master.item i
         SET item_type = 'SEMI_FINISHED',
             is_manufacturable = true
       WHERE i.item_type NOT IN ('SEMI_FINISHED', 'FINISHED_KIT', 'DEVICE')
         AND (
           EXISTS (
             SELECT 1 FROM kit.bom b
              WHERE b.product_item_id = i.id
                AND b.bom_type = 'semi_finished'
                AND b.status <> 'OBSOLETE'
           )
           OR EXISTS (
             SELECT 1 FROM prep.formula pf
              WHERE pf.output_item_id = i.id
                AND pf.status <> 'OBSOLETE'
           )
         )
    `);
    // Tự động khôi phục các lô đang ở trạng thái EXPIRED nhưng đã được gia hạn/cập nhật hạn dùng (expiry_date >= CURRENT_DATE) sang RELEASED
    await tx.query(`
      UPDATE inv.lot
         SET status = 'RELEASED',
             version = version + 1,
             updated_at = now()
       WHERE status = 'EXPIRED'
         AND (expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
    `);
    await tx.query("RELEASE SAVEPOINT sp_sync_bom_item_types");
    lastBomTypeSyncAt = now;
  } catch {
    await tx.query("ROLLBACK TO SAVEPOINT sp_sync_bom_item_types").catch(() => {});
  }
}

/** Warehouses whose stock the actor may see: own department's (by role scope), company-wide roles see all, SHARED_READ visible to any stock viewer. */
export async function viewableWarehouses(tx: Tx, actor: AuthzActor) {
  const all = (
    await tx.query(
      `SELECT w.id, w.code, w.name, w.purpose, w.access_mode, w.owner_org_unit_id, o.name AS owner_name, o.module_key AS owner_module_key
         FROM master.warehouse w JOIN core.org_unit o ON o.id = w.owner_org_unit_id
        WHERE w.status = 'ACTIVE' ORDER BY w.code`
    )
  ).rows;
  if (actor.isRootAdmin || actor.isPortalAdmin) return all;

  // Single-query permission lookup across all org units (using ur.scope_org_unit_id and active delegations)
  const grants = (
    await tx.query(
      `SELECT ur.scope_org_unit_id, o.unit_type, o.module_key, r.code AS role_code
         FROM core.user_role ur
         JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
         JOIN core.role_permission rp ON rp.role_id = r.id
         LEFT JOIN core.org_unit o ON o.id = ur.scope_org_unit_id
        WHERE ur.user_id = $1
          AND (rp.permission_code LIKE 'inv.%' OR rp.permission_code IN ('master.warehouse.manage', 'master.item.manage'))
          AND NOT EXISTS (
            SELECT 1 FROM core.user_permission_exclusion upe
             WHERE upe.user_id = $1 AND upe.permission_code IN (rp.permission_code, 'inv.stock.view')
          )
          AND ur.revoked_at IS NULL
          AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())
       UNION ALL
       SELECT ur.scope_org_unit_id, o.unit_type, o.module_key, r.code AS role_code
         FROM core.delegation d
         JOIN core.user_role ur ON ur.user_id = d.from_user_id AND ur.role_id = d.role_id AND ur.revoked_at IS NULL
         JOIN core.role r ON r.id = ur.role_id AND r.status = 'ACTIVE'
         JOIN core.role_permission rp ON rp.role_id = r.id
         LEFT JOIN core.org_unit o ON o.id = ur.scope_org_unit_id
        WHERE d.to_user_id = $1
          AND (rp.permission_code LIKE 'inv.%' OR rp.permission_code IN ('master.warehouse.manage', 'master.item.manage'))
          AND NOT EXISTS (
            SELECT 1 FROM core.user_permission_exclusion upe
             WHERE upe.user_id = $1 AND upe.permission_code IN (rp.permission_code, 'inv.stock.view')
          )
          AND d.revoked_at IS NULL
          AND d.valid_from <= now() AND d.valid_to > now()`,
      [actor.userId]
    )
  ).rows;

  if (grants.length === 0) return [];
  const hasCompanyScope = grants.some(
    (g) =>
      g.scope_org_unit_id === null ||
      g.unit_type === "COMPANY" ||
      ["QA", "WH", "PURCHASE"].includes(g.module_key) ||
      ["WH_HEAD", "WH_STAFF", "QA_HEAD", "QA_STAFF"].includes(g.role_code)
  );
  if (hasCompanyScope) return all;

  const grantedOrgIds = new Set(grants.map((g) => g.scope_org_unit_id).filter(Boolean));
  return all.filter((w) => w.access_mode === "SHARED_READ" || grantedOrgIds.has(w.owner_org_unit_id));
}

const stockQuerySchema = z.object({
  warehouse_id: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["QUARANTINE", "PENDING_QC", "RELEASED", "ON_HOLD", "REJECTED", "EXPIRED"]).optional(),
  item_group: z.enum(["RAW", "SEMI_FINISHED", "FINISHED"]).optional(),
  item_type: z.string().trim().max(150).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

/** Stock by lot and location, server-side filtered and paged, restricted to viewable warehouses. */
export async function listStock(tx: Tx, actor: AuthzActor, query: unknown) {
  await syncItemTypesFromBomAndFormula(tx);
  const q = parseInput(stockQuerySchema, query);
  const allowed = (await viewableWarehouses(tx, actor)).map((w) => w.id);
  if (q.warehouse_id && !allowed.includes(q.warehouse_id)) throw forbidden("Bạn không có quyền xem tồn của kho này.");
  const ids = q.warehouse_id ? [q.warehouse_id] : allowed;
  const baseParams: unknown[] = [ids];
  const baseWhere = ["loc.warehouse_id = ANY($1::uuid[])", "b.qty_on_hand > 0"];
  if (q.q) {
    baseParams.push(`%${q.q}%`);
    baseWhere.push(
      `(i.code ILIKE $${baseParams.length} OR i.name ILIKE $${baseParams.length} OR l.code ILIKE $${baseParams.length} OR l.mfr_lot_no ILIKE $${baseParams.length})`
    );
  }
  if (q.status) {
    baseParams.push(q.status);
    baseWhere.push(`l.status = $${baseParams.length}`);
  }

  const baseFrom = `FROM inv.stock_balance b
      JOIN master.item i ON i.id = b.item_id
      JOIN master.location loc ON loc.id = b.location_id
      JOIN master.warehouse w ON w.id = loc.warehouse_id
      LEFT JOIN inv.lot l ON l.id = b.lot_id
     WHERE ${baseWhere.join(" AND ")}`;

  const countsRow = (
    await tx.query(
      `SELECT
         count(*)::int AS total_lots,
         count(DISTINCT i.id)::int AS total_items,
         count(*) FILTER (WHERE i.item_type NOT IN ('SEMI_FINISHED', 'FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE'))::int AS raw_lots,
         count(DISTINCT i.id) FILTER (WHERE i.item_type NOT IN ('SEMI_FINISHED', 'FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE'))::int AS raw_items,
         count(*) FILTER (WHERE i.item_type = 'SEMI_FINISHED')::int AS semi_lots,
         count(DISTINCT i.id) FILTER (WHERE i.item_type = 'SEMI_FINISHED')::int AS semi_items,
         count(*) FILTER (WHERE i.item_type IN ('FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE'))::int AS finished_lots,
         count(DISTINCT i.id) FILTER (WHERE i.item_type IN ('FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE'))::int AS finished_items,
         count(*) FILTER (WHERE i.item_type IN ('RAW_MATERIAL', 'REAGENT'))::int AS chemical_lots,
         count(*) FILTER (WHERE i.item_type IN ('CONSUMABLE', 'COMPONENT', 'SPARE_PART'))::int AS consumable_lots
       ${baseFrom}`,
      baseParams
    )
  ).rows[0] ?? {
    total_lots: 0,
    total_items: 0,
    raw_lots: 0,
    raw_items: 0,
    semi_lots: 0,
    semi_items: 0,
    finished_lots: 0,
    finished_items: 0,
    chemical_lots: 0,
    consumable_lots: 0,
  };

  const params = [...baseParams];
  const where = [...baseWhere];
  if (q.item_group === "RAW") {
    where.push(`i.item_type NOT IN ('SEMI_FINISHED', 'FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE')`);
  } else if (q.item_group === "SEMI_FINISHED") {
    where.push(`i.item_type = 'SEMI_FINISHED'`);
  } else if (q.item_group === "FINISHED") {
    where.push(`i.item_type IN ('FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE')`);
  }
  if (q.item_type) {
    const allowedTypes = new Set<string>(ITEM_TYPES);
    const types = q.item_type
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => allowedTypes.has(s));
    if (types.length > 0) {
      params.push(types);
      where.push(`i.item_type = ANY($${params.length}::text[])`);
    }
  }

  const from = `FROM inv.stock_balance b
      JOIN master.item i ON i.id = b.item_id
      JOIN master.location loc ON loc.id = b.location_id
      JOIN master.warehouse w ON w.id = loc.warehouse_id
      LEFT JOIN inv.lot l ON l.id = b.lot_id
     WHERE ${where.join(" AND ")}`;
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = (
    await tx.query(
      `SELECT b.id, b.item_id, b.location_id, l.id AS lot_id,
              i.code AS item_code, i.name AS item_name, i.item_type, i.version AS item_version,
              CASE
                WHEN i.item_type IN ('FINISHED_KIT', 'DEVICE', 'OLIGO_SERVICE') THEN 'FINISHED'
                WHEN i.item_type = 'SEMI_FINISHED' THEN 'SEMI_FINISHED'
                ELSE 'RAW'
              END AS item_group,
              i.base_uom, l.code AS lot_code, l.mfr_lot_no, l.status AS lot_status,
              l.expiry_date, w.code AS warehouse_code, loc.code AS location_code, loc.is_quarantine,
              (SELECT pr.incubation_until FROM prep.preparation pr WHERE pr.lot_id = l.id AND pr.status = 'DONE' AND pr.incubated_at IS NULL) AS incubation_until,
              b.qty_on_hand::text AS qty_on_hand, b.qty_reserved::text AS qty_reserved,
              (b.qty_on_hand - b.qty_reserved)::text AS qty_available,
              COUNT(*) OVER()::int AS total_count
       ${from}
       ORDER BY i.code, l.expiry_date NULLS LAST, l.code, loc.code
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
  ).rows;
  const total = rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0;
  return { rows, total, page: q.page, page_size: q.page_size, group_counts: countsRow };
}

export async function listLocations(tx: Tx, warehouseId: string) {
  return (
    await tx.query(
      "SELECT id, code, name, parent_id, temperature_condition, is_quarantine, status FROM master.location WHERE warehouse_id = $1 ORDER BY code",
      [warehouseId]
    )
  ).rows;
}
