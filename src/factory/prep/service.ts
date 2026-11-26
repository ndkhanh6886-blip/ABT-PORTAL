import { z } from "zod/v3";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { conflict, forbidden, invalid, notFound } from "../core/errors";
import { nextNumber } from "../core/numbering";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { createLot, lotMachine } from "../inv/lots";
import { getItem, toBaseQty } from "../master/service";
import { ensureLegacyOligoDataSeeded } from "../oligo/legacySync";

registerPermissions([
  { code: "prep.formula.manage", description: "Soạn / sửa công thức pha chế hóa chất" },
  { code: "prep.formula.delete", description: "Xóa công thức pha chế hóa chất (dành cho Admin)", gxpCritical: true },
  { code: "prep.execute", description: "Thực hiện pha chế: trừ nguyên liệu, tạo lô hóa chất pha (trong kho của phòng)" },
]);

export type PrepDeptScope = "OLIGO" | "RD" | "KIT";

export function normalizePrepDeptScope(raw?: unknown): PrepDeptScope | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "RD" || s === "P-RD" || s === "R&D") return "RD";
  if (s === "KIT" || s === "P-KIT") return "KIT";
  if (s === "OLIGO" || s === "P-OLIGO") return "OLIGO";
  return null;
}

async function resolveDefaultFormulaScope(tx: Tx, actor: AuthzActor): Promise<PrepDeptScope> {
  const row = (
    await tx.query(
      `SELECT coalesce(u.module_key, ur_ou.module_key) AS module_key
         FROM core.user_profile up
         LEFT JOIN core.org_unit u ON u.id = up.org_unit_id AND u.status = 'ACTIVE'
         LEFT JOIN core.user_role ur ON ur.user_id = up.user_id AND ur.revoked_at IS NULL
         LEFT JOIN core.org_unit ur_ou ON ur_ou.id = ur.scope_org_unit_id AND ur_ou.status = 'ACTIVE'
        WHERE up.user_id = $1
        ORDER BY (u.module_key IN ('RD', 'OLIGO', 'KIT')) DESC NULLS LAST,
                 (ur_ou.module_key IN ('RD', 'OLIGO', 'KIT')) DESC NULLS LAST
        LIMIT 1`,
      [actor.userId]
    )
  ).rows[0] as { module_key?: string | null } | undefined;
  return normalizePrepDeptScope(row?.module_key) ?? "OLIGO";
}

async function authorizeFormulaScope(tx: Tx, actor: AuthzActor, targetScope: PrepDeptScope, isExplicitScope: boolean): Promise<void> {
  await authorizeAnywhere(tx, actor, "prep.formula.manage");
  if (!isExplicitScope || actor.isRootAdmin || actor.isSystem) return;
  const scopedRows = (
    await tx.query(
      `SELECT ur.scope_org_unit_id, ou.module_key
         FROM core.user_role ur
         JOIN core.role_permission rp ON rp.role_id = ur.role_id AND rp.permission_code = 'prep.formula.manage'
         LEFT JOIN core.org_unit ou ON ou.id = ur.scope_org_unit_id
        WHERE ur.user_id = $1 AND ur.revoked_at IS NULL
          AND ur.valid_from <= now() AND (ur.valid_to IS NULL OR ur.valid_to > now())`,
      [actor.userId]
    )
  ).rows as { scope_org_unit_id: string | null; module_key: string | null }[];
  const hasCompanyWideOrGeneric = scopedRows.some((r) => r.scope_org_unit_id === null || r.module_key === null);
  const hasMatchingScope = scopedRows.some((r) => r.module_key === targetScope);
  if (!hasCompanyWideOrGeneric && scopedRows.length > 0 && !hasMatchingScope) {
    throw invalid(`Bạn không có quyền quản lý công thức pha chế thuộc bộ phận ${targetScope}.`);
  }
}

const lineSchema = z.object({ item_id: z.string().uuid("chọn nguyên liệu"), qty: z.coerce.number().positive("lượng phải lớn hơn 0"), uom: z.string().min(1) });
const formulaSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9_-]{2,30}$/, "mã công thức: chữ hoa, số, _ -"),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).optional().nullable(),
  dept_scope: z.enum(["OLIGO", "RD", "KIT"]).optional(),
  output_item_id: z.string().uuid("chọn mã hàng thành phẩm pha").optional().nullable(),
  basis_qty: z.coerce.number().positive(),
  basis_uom: z.string().min(1),
  shelf_life_days: z.coerce.number().int().positive().optional().nullable(),
  requires_qc: z.boolean().default(false),
  incubation_days: z.coerce.number().int().min(0).max(365).default(0),
  instructions: z.string().trim().max(4000).optional().nullable(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  lines: z.array(lineSchema).min(1, "công thức cần ít nhất một nguyên liệu").max(50),
});

/** A formula: ingredients per `basis_qty` of the prepared item. Edits are audited old → new; preparations keep what they used. */
export async function saveFormula(tx: Tx, actor: AuthzActor, id: string | null, input: unknown) {
  const raw = (input ?? {}) as Record<string, unknown>;
  const normalizedInput = {
    ...raw,
    ...(raw.dept_scope !== undefined && raw.dept_scope !== null && raw.dept_scope !== ""
      ? { dept_scope: normalizePrepDeptScope(raw.dept_scope) ?? raw.dept_scope }
      : {}),
    ...(raw.output_item_id === "" ? { output_item_id: null } : {}),
  };
  const d = parseInput(formulaSchema, normalizedInput);
  let resolvedOutputItemId = d.output_item_id ?? null;
  if (!resolvedOutputItemId) {
    // Một mã công thức cho ra đúng một sản phẩm tương ứng (tự động gắn hoặc tạo mã vật tư trùng mã công thức)
    const ingItemIds = new Set(d.lines.map((l) => l.item_id));
    let targetCode = d.code.trim().toUpperCase();
    let existingItem = (await tx.query("SELECT id FROM master.item WHERE upper(code) = $1 LIMIT 1", [targetCode])).rows[0];
    if (existingItem && ingItemIds.has(existingItem.id)) {
      targetCode = `PREP-${targetCode}`;
      existingItem = (await tx.query("SELECT id FROM master.item WHERE upper(code) = $1 LIMIT 1", [targetCode])).rows[0];
    }
    if (existingItem) {
      resolvedOutputItemId = existingItem.id as string;
      await tx.query(
        `UPDATE master.item
            SET name = COALESCE(NULLIF($2, ''), name),
                item_type = CASE WHEN item_type = 'RAW_MATERIAL' THEN 'SEMI_FINISHED' ELSE item_type END,
                is_manufacturable = true,
                updated_at = now()
          WHERE id = $1`,
        [resolvedOutputItemId, d.name]
      );
    } else {
      await tx.query(
        `INSERT INTO master.uom (code, name, dimension)
         VALUES ($1, $1, 'OTHER')
         ON CONFLICT (code) DO NOTHING`,
        [d.basis_uom]
      );
      const createdItem = (
        await tx.query(
          `INSERT INTO master.item (
             code, name, item_type, base_uom, tracking, shelf_life_days,
             receipt_qc_required, is_purchasable, is_manufacturable, status, created_by, updated_by
           ) VALUES ($1, $2, 'SEMI_FINISHED', $3, 'LOT', $4, false, false, true, 'ACTIVE', $5, $5)
           RETURNING id`,
          [targetCode, d.name, d.basis_uom, d.shelf_life_days ?? 180, actor.userId]
        )
      ).rows[0];
      resolvedOutputItemId = createdItem.id as string;
    }
  }
  const out = await getItem(tx, resolvedOutputItemId);
  await toBaseQty(tx, out, d.basis_qty, d.basis_uom); // the unit must convert to the item's base unit
  for (const l of d.lines) {
    if (l.item_id === resolvedOutputItemId) throw invalid("Nguyên liệu không được trùng hóa chất thành phẩm.");
    await toBaseQty(tx, await getItem(tx, l.item_id), l.qty, l.uom);
  }
  let formulaId = id;
  if (!id) {
    const targetScope = d.dept_scope ?? (await resolveDefaultFormulaScope(tx, actor));
    await authorizeFormulaScope(tx, actor, targetScope, Boolean(d.dept_scope));
    if ((await tx.query("SELECT 1 FROM prep.formula WHERE dept_scope = $1 AND upper(code) = upper($2)", [targetScope, d.code])).rowCount) {
      throw conflict(`Đã có công thức ${d.code} trong bộ phận ${targetScope}.`, "DUPLICATE");
    }
    formulaId = (
      await tx.query(
        `INSERT INTO prep.formula (code, name, category, dept_scope, output_item_id, basis_qty, basis_uom, shelf_life_days, requires_qc, instructions, status, created_by, updated_by, incubation_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13) RETURNING id`,
        [d.code, d.name, d.category ?? null, targetScope, resolvedOutputItemId, d.basis_qty, d.basis_uom, d.shelf_life_days ?? null, d.requires_qc, d.instructions ?? null, d.status, actor.userId, d.incubation_days]
      )
    ).rows[0].id;
    await writeAudit(tx, actor, { entityType: "prep_formula", entityId: formulaId!, action: "create", changes: { code: [null, d.code], dept_scope: [null, targetScope], lines: [null, d.lines.length] } });
  } else {
    const cur = (await tx.query("SELECT * FROM prep.formula WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!cur) throw notFound("công thức");
    await authorizeFormulaScope(tx, actor, (cur.dept_scope as PrepDeptScope) ?? "OLIGO", true);
    if (cur.version !== Number(raw.version)) throw conflict("Công thức vừa được người khác sửa. Tải lại.", "STALE_VERSION");
    if (typeof raw.reason !== "string" || raw.reason.trim().length < 3) throw invalid("Nhập lý do sửa công thức.");
    const before = (await tx.query("SELECT item_id, qty::float AS qty, uom FROM prep.formula_line WHERE formula_id = $1 ORDER BY line_no", [id])).rows;
    await tx.query(
      `UPDATE prep.formula SET name = $2, category = $3, output_item_id = $4, basis_qty = $5, basis_uom = $6, shelf_life_days = $7, requires_qc = $8, instructions = $9, status = $10,
              incubation_days = $12, version = version + 1, updated_at = now(), updated_by = $11 WHERE id = $1`,
      [id, d.name, d.category ?? null, resolvedOutputItemId, d.basis_qty, d.basis_uom, d.shelf_life_days ?? null, d.requires_qc, d.instructions ?? null, d.status, actor.userId, d.incubation_days]
    );
    await tx.query(
      `UPDATE master.item
          SET name = COALESCE(NULLIF($2, ''), name),
              updated_at = now()
        WHERE id = $1
          AND (upper(code) = upper($3) OR upper(code) = upper('PREP-' || $3))`,
      [resolvedOutputItemId, d.name, d.code]
    );
    await tx.query("DELETE FROM prep.formula_line WHERE formula_id = $1", [id]);
    await writeAudit(tx, actor, {
      entityType: "prep_formula",
      entityId: id,
      action: "update",
      changes: { lines: [JSON.stringify(before), JSON.stringify(d.lines)], basis: [`${Number(cur.basis_qty)} ${cur.basis_uom}`, `${d.basis_qty} ${d.basis_uom}`], requires_qc: [cur.requires_qc, d.requires_qc] },
      reason: raw.reason,
    });
  }
  for (const [i, l] of d.lines.entries()) {
    await tx.query("INSERT INTO prep.formula_line (formula_id, line_no, item_id, qty, uom) VALUES ($1, $2, $3, $4, $5)", [formulaId, i + 1, l.item_id, l.qty, l.uom]);
  }
  return getFormula(tx, formulaId!);
}

export async function getFormula(tx: Tx, id: string) {
  const f = (
    await tx.query(
      `SELECT f.*, f.basis_qty::float AS basis_qty, i.code AS output_code, i.name AS output_name, i.base_uom AS output_base_uom
         FROM prep.formula f JOIN master.item i ON i.id = f.output_item_id WHERE f.id = $1`,
      [id]
    )
  ).rows[0];
  if (!f) throw notFound("công thức");
  f.lines = (
    await tx.query(
      `SELECT l.line_no, l.item_id, l.qty::float AS qty, l.uom,
              i.code AS item_code,
              COALESCE(
                (SELECT pf.name
                   FROM prep.formula pf
                  WHERE (pf.output_item_id = i.id OR upper(pf.code) = upper(i.code))
                    AND pf.id <> l.formula_id
                  ORDER BY (pf.status = 'ACTIVE') DESC, (pf.dept_scope = $2) DESC, pf.updated_at DESC NULLS LAST
                  LIMIT 1),
                i.name
              ) AS item_name
         FROM prep.formula_line l
         JOIN master.item i ON i.id = l.item_id
        WHERE l.formula_id = $1
        ORDER BY l.line_no`,
      [id, f.dept_scope ?? "OLIGO"]
    )
  ).rows;
  return f;
}

let unifiedOutItemsNormalized = false;

/**
 * Unifies any legacy `<FORMULA_CODE>-OUT` items back into a single product item `<FORMULA_CODE>`
 * matching the preparation formula's code & name, migrating any existing lots, stock balances,
 * stock documents, reagent rules, and synthesizer/equipment ports cleanly.
 */
export async function normalizeFormulaOutputItems(tx: Tx): Promise<void> {
  // Luôn tự động khôi phục các lô đang ở trạng thái EXPIRED nhưng hạn dùng còn hạn (>= hôm nay) sang RELEASED trước khi tải công thức/pha chế
  await tx.query(`
    UPDATE inv.lot
       SET status = 'RELEASED',
           version = version + 1,
           updated_at = now()
     WHERE status = 'EXPIRED'
       AND (expiry_date IS NULL OR expiry_date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
  `);
  // Luôn đồng bộ tên master.item (VD: STO015, STO022...) khớp với tên chuẩn của công thức prep.formula có cùng mã
  // để tránh trường hợp dòng nguyên liệu trong file Excel ghi nhầm tên của mã khác đè lên master.item.name.
  await tx.query("SAVEPOINT sp_sync_formula_item_names");
  try {
    await tx.query(
      `UPDATE master.item i
          SET name = f.name,
              item_type = CASE WHEN i.item_type = 'RAW_MATERIAL' THEN 'SEMI_FINISHED' ELSE i.item_type END,
              is_manufacturable = true,
              updated_at = now()
         FROM prep.formula f
        WHERE (i.id = f.output_item_id OR upper(i.code) = upper(f.code))
          AND NULLIF(trim(f.name), '') IS NOT NULL
          AND i.name IS DISTINCT FROM f.name`
    );
    await tx.query("RELEASE SAVEPOINT sp_sync_formula_item_names");
  } catch {
    await tx.query("ROLLBACK TO SAVEPOINT sp_sync_formula_item_names").catch(() => {});
  }

  // Always synchronize any prep.formula_line whose ingredient code matches another formula's code (or PREP-<code>, <code>-OUT, <code>-TP)
  // so that preparing a parent formula (e.g. STO022) makes its stock immediately allocatable to child formulas (e.g. STO021).
  await tx.query("SAVEPOINT sp_sync_formula_line_items");
  try {
    await tx.query(
      `UPDATE prep.formula_line fl
          SET item_id = f.output_item_id
         FROM master.item li,
              prep.formula f
        WHERE fl.item_id = li.id
          AND fl.formula_id <> f.id
          AND fl.item_id <> f.output_item_id
          AND f.status = 'ACTIVE'
          AND (
            upper(li.code) = upper(f.code)
            OR upper(li.code) = upper('PREP-' || f.code)
            OR upper(li.code) = upper(f.code || '-OUT')
            OR upper(li.code) = upper(f.code || '-TP')
          )`
    );
    await tx.query("RELEASE SAVEPOINT sp_sync_formula_line_items");
  } catch {
    await tx.query("ROLLBACK TO SAVEPOINT sp_sync_formula_line_items").catch(() => {});
  }

  if (unifiedOutItemsNormalized) return;
  const rows = (
    await tx.query(
      `SELECT f.id AS formula_id, f.code AS formula_code, f.name AS formula_name, f.basis_uom, f.shelf_life_days,
              f.output_item_id, i.code AS out_code, i.name AS out_name, i.base_uom AS out_uom
         FROM prep.formula f
         JOIN master.item i ON i.id = f.output_item_id
        WHERE upper(i.code) IN (
                upper(f.code || '-OUT'),
                upper('PREP-' || f.code),
                upper(f.code || '-TP')
              )
           OR (
                upper(i.code) <> upper(f.code)
                AND EXISTS (
                  SELECT 1
                    FROM prep.formula_line fl
                    JOIN master.item li ON li.id = fl.item_id
                   WHERE upper(li.code) = upper(f.code)
                )
              )`
    )
  ).rows;

  if (rows.length === 0) {
    unifiedOutItemsNormalized = true;
    return;
  }

  for (const r of rows) {
    const sp = `sp_unify_out_${String(r.formula_id).replace(/[^a-zA-Z0-9]/g, "")}`;
    await tx.query(`SAVEPOINT ${sp}`);
    try {
      const fCodeU = String(r.formula_code).trim().toUpperCase();
      const outItemId = r.output_item_id as string;

      // Skip only if an ingredient of this formula itself has code === formula_code
      const selfIngredient = (
        await tx.query(
          `SELECT 1 FROM prep.formula_line fl
             JOIN master.item ing ON ing.id = fl.item_id
            WHERE fl.formula_id = $1 AND upper(ing.code) = $2 LIMIT 1`,
          [r.formula_id, fCodeU]
        )
      ).rowCount;
      if (selfIngredient) {
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
        continue;
      }

      const baseItem = (
        await tx.query("SELECT id, code, name, base_uom FROM master.item WHERE upper(code) = $1 AND id <> $2 LIMIT 1", [
          fCodeU,
          outItemId,
        ])
      ).rows[0];

      if (!baseItem) {
        // Simple rename in place: <CODE>-OUT -> <CODE>
        await tx.query(
          `UPDATE master.item
              SET code = $2,
                  name = COALESCE(NULLIF($3, ''), name),
                  updated_at = now()
            WHERE id = $1`,
          [outItemId, fCodeU, r.formula_name]
        );
      } else {
        // Both <CODE> (baseItem) and <CODE>-OUT (outItemId) exist: merge <CODE>-OUT into <CODE> and update <CODE>'s name to match the formula
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
        await tx.query("UPDATE prep.formula_line SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.reagent_rule SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.synth_port SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.batch_port_use SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.synthesis_reagent_use SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE oligo.modification SET amidite_item_id = $2 WHERE amidite_item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE asset.reagent_slot SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE asset.reagent_usage SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);

        // Migrate lots (if a lot code collides on targetId, suffix it cleanly)
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

        // Migrate stock balances, reservations, documents, and ledger
        await tx.query("UPDATE inv.stock_balance SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE inv.reservation SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE inv.stock_document_line SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);
        await tx.query("UPDATE inv.stock_ledger SET item_id = $2 WHERE item_id = $1", [outItemId, targetId]);

        // Also update any JSONB REAGENT fields in oligo.ps_method and frozen oligo.post_process.workflow_steps pointing to outItemId
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
        await tx.query(
          `UPDATE oligo.post_process
              SET workflow_steps = replace(workflow_steps::text, $1, $2)::jsonb
            WHERE workflow_steps IS NOT NULL AND workflow_steps::text LIKE '%' || $1 || '%'`,
          [outItemId, targetId]
        );

        // Delete or retire the duplicate -OUT item
        await tx.query("SAVEPOINT sp_del_out_item_prep");
        const deleted = await tx
          .query("DELETE FROM master.item WHERE id = $1", [outItemId])
          .then(async () => {
            await tx.query("RELEASE SAVEPOINT sp_del_out_item_prep");
            return true;
          })
          .catch(async () => {
            await tx.query("ROLLBACK TO SAVEPOINT sp_del_out_item_prep").catch(() => {});
            return false;
          });
        if (!deleted) {
          await tx.query("UPDATE master.item SET status = 'INACTIVE', code = $2 WHERE id = $1", [
            outItemId,
            `OLD-${fCodeU}-OUT`,
          ]);
        }
      }
      await tx.query(`RELEASE SAVEPOINT ${sp}`);
    } catch {
      await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
    }
  }

  unifiedOutItemsNormalized = true;
}

export async function listFormulas(tx: Tx, actor: AuthzActor, deptScopeRaw?: string | null) {
  const scope = normalizePrepDeptScope(deptScopeRaw);
  if (!scope || scope === "OLIGO") {
    await ensureLegacyOligoDataSeeded(tx);
  }
  await normalizeFormulaOutputItems(tx);
  // anyone who prepares or writes formulas, in any department
  await authorizeAnywhere(tx, actor, "prep.execute").catch((err) => {
    if (err?.code === "FORBIDDEN") return authorizeAnywhere(tx, actor, "prep.formula.manage");
    throw err;
  });
  const ids = (
    await tx.query(
      "SELECT id FROM prep.formula WHERE ($1::text IS NULL OR dept_scope = $1) ORDER BY status, code",
      [scope]
    )
  ).rows;
  return Promise.all(ids.map((r) => getFormula(tx, r.id)));
}

/** Deletes an unused preparation formula (Admin only, audited, blocks when preparations or planned orders exist). */
export async function deleteFormula(tx: Tx, actor: AuthzActor, id: string, input: unknown) {
  await authorizeAnywhere(tx, actor, "prep.formula.delete");
  const formulaId = parseInput(z.string().uuid("ID công thức không hợp lệ."), id);
  const raw = (input ?? {}) as Record<string, unknown>;
  const reason = parseInput(
    z.string().trim().min(3, "Nhập lý do xóa công thức (tối thiểu 3 ký tự).").max(500),
    raw.reason
  );

  const cur = (await tx.query("SELECT * FROM prep.formula WHERE id = $1 FOR UPDATE", [formulaId])).rows[0];
  if (!cur) throw notFound("công thức");

  const prepCount = Number(
    (await tx.query("SELECT count(*)::int AS c FROM prep.preparation WHERE formula_id = $1", [formulaId])).rows[0]?.c ?? 0
  );
  if (prepCount > 0) {
    throw conflict(
      `Công thức ${cur.code} đã phát sinh ${prepCount} lô pha chế trong nhật ký nên không thể xóa vĩnh viễn (hãy bấm Sửa → chuyển trạng thái sang Ngừng).`,
      "FORMULA_IN_USE"
    );
  }

  const openOrderCount = Number(
    (await tx.query("SELECT count(*)::int AS c FROM prep.prep_order WHERE formula_id = $1 AND status = 'PLANNED'", [formulaId])).rows[0]?.c ?? 0
  );
  if (openOrderCount > 0) {
    throw conflict(
      `Công thức ${cur.code} đang có ${openOrderCount} lệnh pha chế chờ thực hiện (đang giữ chỗ nguyên liệu). Hãy hủy lệnh chờ trước khi xóa.`,
      "FORMULA_HAS_OPEN_ORDER"
    );
  }

  await tx.query(
    "DELETE FROM prep.prep_order WHERE formula_id = $1 AND status = 'CANCELLED' AND preparation_id IS NULL",
    [formulaId]
  );

  const before = (
    await tx.query("SELECT item_id, qty::float AS qty, uom FROM prep.formula_line WHERE formula_id = $1 ORDER BY line_no", [formulaId])
  ).rows;

  await tx.query("DELETE FROM prep.formula_line WHERE formula_id = $1", [formulaId]);
  await tx.query("DELETE FROM prep.formula WHERE id = $1", [formulaId]);

  await writeAudit(tx, actor, {
    entityType: "prep_formula",
    entityId: formulaId,
    action: "delete",
    changes: { code: [cur.code, null], name: [cur.name, null], dept_scope: [cur.dept_scope ?? "OLIGO", null], lines: [JSON.stringify(before), null] },
    reason,
  });

  return { deleted: true, id: formulaId, code: cur.code };
}

const prepareSchema = z.object({
  formula_id: z.string().uuid(),
  qty: z.coerce.number().positive("lượng pha phải lớn hơn 0"),
  uom: z.string().min(1),
  warehouse_id: z.string().uuid("chọn kho"),
  to_location_id: z.string().uuid("chọn vị trí cất").optional().nullable(),
  // chosen ingredient lots (else FEFO): one entry per formula line at most
  lots: z.array(z.object({ line_no: z.coerce.number().int(), lot_id: z.string().uuid() })).max(50).default([]),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Prepares `qty` of the formula's item: ingredients scaled from the basis and issued (chosen lots or FEFO; released,
 * unexpired), a new lot P… received with expiry = min(today + shelf life, earliest ingredient expiry). With QC the lot
 * stays in quarantine for QA/QC; without, it is released on a normal location at once.
 */
export async function prepare(tx: Tx, actor: AuthzActor, input: unknown) {
  await normalizeFormulaOutputItems(tx);
  const d = parseInput(prepareSchema, input);
  const wh = (
    await tx.query(
      `SELECT w.id, w.owner_org_unit_id, w.purpose, ou.module_key AS org_module_key
         FROM master.warehouse w
         LEFT JOIN core.org_unit ou ON ou.id = w.owner_org_unit_id
        WHERE w.id = $1 AND w.status = 'ACTIVE'`,
      [d.warehouse_id]
    )
  ).rows[0];
  if (!wh) throw notFound("kho");
  await authorize(tx, actor, "prep.execute", wh.owner_org_unit_id);
  const f = await getFormula(tx, d.formula_id);
  if (f.status !== "ACTIVE") throw invalid(`Công thức ${f.code} đang ngừng dùng.`);
  const whDept = ["OLIGO", "RD", "KIT"].includes(wh.org_module_key)
    ? wh.org_module_key
    : ["OLIGO", "RD"].includes(wh.purpose)
      ? wh.purpose
      : null;
  if (whDept && f.dept_scope && whDept !== f.dept_scope) {
    throw invalid(`Công thức pha chế bộ phận ${f.dept_scope} (${f.code}) không được pha trên kho của bộ phận ${whDept}.`);
  }
  const outItem = await getItem(tx, f.output_item_id);
  const outBase = await toBaseQty(tx, outItem, d.qty, d.uom);
  const basisBase = await toBaseQty(tx, outItem, Number(f.basis_qty), f.basis_uom);
  const factor = outBase / basisBase;

  // Include all active warehouses sharing the same department owner or purpose (preferring the selected warehouse first)
  const candidateWhIds = (
    await tx.query(
      `SELECT id FROM master.warehouse
        WHERE status = 'ACTIVE'
          AND (id = $1 OR owner_org_unit_id = $2 OR ($3::text IS NOT NULL AND purpose = $3))
        ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END, code`,
      [wh.id, wh.owner_org_unit_id, whDept]
    )
  ).rows.map((r) => r.id as string);
  const searchWhIds = candidateWhIds.length > 0 ? candidateWhIds : [wh.id];

  const used: { line_no: number; item_id: string; item_code: string; lot_id: string | null; lot_code: string | null; qty_base: number; uom: string; expiry_date: string | null }[] = [];
  const issueLines: { item_id: string; lot_id: string | null; from_location_id: string; qty: number; uom: string }[] = [];
  for (const l of f.lines) {
    let item = await getItem(tx, l.item_id);
    let need = round6((await toBaseQty(tx, item, Number(l.qty), l.uom)) * factor);
    let cands = await findCandidates(tx, item.id, searchWhIds, { lock: true });
    const chosen = d.lots.find((x) => x.line_no === l.line_no);
    if (chosen) cands = cands.filter((c) => c.lot_id === chosen.lot_id);
    let plan = allocate(cands, need);

    // Fallback: if this ingredient corresponds to a formula (e.g. STO022) whose output_item_id or alternate master.item has the stock
    if (plan.shortfall > 1e-9 && !chosen) {
      const altItems = (
        await tx.query(
          `SELECT DISTINCT i.id
             FROM master.item i
            WHERE i.id <> $1
              AND (
                upper(i.code) IN (
                  upper($2),
                  upper('PREP-' || $2),
                  upper($2 || '-OUT'),
                  upper($2 || '-TP')
                )
                OR i.id IN (
                  SELECT pf.output_item_id
                    FROM prep.formula pf
                   WHERE upper(pf.code) = upper($2)
                )
              )`,
          [item.id, item.code]
        )
      ).rows;
      for (const alt of altItems) {
        const altItem = await getItem(tx, alt.id);
        const altNeed = round6((await toBaseQty(tx, altItem, Number(l.qty), l.uom)) * factor);
        const altCands = await findCandidates(tx, altItem.id, searchWhIds, { lock: true });
        const altPlan = allocate(altCands, altNeed);
        if (altPlan.shortfall < plan.shortfall) {
          item = altItem;
          need = altNeed;
          cands = altCands;
          plan = altPlan;
          if (plan.shortfall <= 1e-9) break;
        }
      }
    }

    if (plan.shortfall > 1e-9) {
      const quarantinedRow = (
        await tx.query(
          `SELECT coalesce(sum(b.qty_on_hand - b.qty_reserved), 0)::float AS q_qty, count(DISTINCT b.lot_id)::int AS q_lots
             FROM inv.stock_balance b
             JOIN inv.lot lot ON lot.id = b.lot_id
             JOIN master.location loc ON loc.id = b.location_id
            WHERE b.item_id = $1
              AND loc.warehouse_id = ANY($2::uuid[])
              AND b.qty_on_hand - b.qty_reserved > 0
              AND (loc.is_quarantine OR lot.status IN ('QUARANTINE', 'PENDING_QC', 'ON_HOLD'))`,
          [item.id, searchWhIds]
        )
      ).rows[0];
      const qQty = Number(quarantinedRow?.q_qty ?? 0);
      const qLots = Number(quarantinedRow?.q_lots ?? 0);
      const qHint =
        qQty > 0
          ? ` (Phát hiện đang có ${round6(qQty)} ${item.base_uom} thuộc ${qLots} lô đang ở trạng thái Biệt trữ / Chờ QC — vui lòng bấm "✅ Xác nhận QC" hoặc "✅ Duyệt Đạt QC tất cả" ở bảng Nhật ký pha chế bên dưới để giải phóng lô).`
          : "";
      throw invalid(`Không đủ ${item.code} ${chosen ? "trong lô đã chọn" : "đã giải phóng, còn hạn"} (cần ${need} ${item.base_uom}, thiếu ${plan.shortfall}).${qHint}`, { line_no: l.line_no }, "INSUFFICIENT_STOCK");
    }
    for (const p of plan.picks) {
      issueLines.push({ item_id: item.id, lot_id: p.candidate.lot_id, from_location_id: p.candidate.location_id, qty: p.qty, uom: item.base_uom });
      used.push({ line_no: l.line_no, item_id: item.id, item_code: item.code, lot_id: p.candidate.lot_id, lot_code: p.candidate.lot_code, qty_base: p.qty, uom: item.base_uom, expiry_date: p.candidate.expiry_date });
    }
  }

  const today = vnToday();
  const expiries = used.map((u) => u.expiry_date).filter((x): x is string => Boolean(x));
  const shelf = f.shelf_life_days ? addDays(today, f.shelf_life_days) : null;
  const expiry = [shelf, ...expiries].filter((x): x is string => Boolean(x)).sort()[0] ?? null;
  const qcNeeded = Boolean(f.requires_qc);
  // an incubated reagent waits in quarantine until "incubated" is confirmed (then QC, or released and put away)
  const incubate = Number(f.incubation_days) > 0;
  const hold = qcNeeded || incubate;
  if (incubate && !qcNeeded) {
    const loc = d.to_location_id ? (await tx.query("SELECT warehouse_id, is_quarantine FROM master.location WHERE id = $1", [d.to_location_id])).rows[0] : null;
    if (!loc || loc.warehouse_id !== wh.id || loc.is_quarantine) throw invalid("Chọn vị trí cất lô pha sau khi ủ (vị trí thường của kho).");
  }
  const location = hold
    ? (await tx.query("SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine AND status = 'ACTIVE' ORDER BY code LIMIT 1", [wh.id])).rows[0]?.id
    : d.to_location_id;
  if (!location) throw invalid(hold ? "Kho chưa có vị trí biệt trữ để chờ ủ / QC lô pha." : "Chọn vị trí cất lô pha.");
  if (!hold) {
    const loc = (await tx.query("SELECT warehouse_id, is_quarantine FROM master.location WHERE id = $1", [location])).rows[0];
    if (!loc || loc.warehouse_id !== wh.id || loc.is_quarantine) throw invalid("Vị trí cất phải là vị trí thường của kho đã chọn.");
  }

  const code = await nextNumber(tx, "PREPARATION");
  const lot = await createLot(tx, actor, { item_id: outItem.id, origin: "PREPARATION", sequence_key: "LOT_PREPARATION", mfg_date: today, expiry_date: expiry, origin_entity_type: "PREPARATION" });
  const post = async (doc: Parameters<typeof createStockDocument>[2]) => {
    const created = await createStockDocument(tx, actor, doc, { trusted: true });
    await runTransition(tx, stockDocumentMachine, actor, { id: created.id, action: "post", expectedVersion: created.version }, { trusted: true });
    return created.id;
  };
  const prep = (
    await tx.query(
      `INSERT INTO prep.preparation (code, formula_id, formula_version, lines, qty_out, uom_out, warehouse_id, lot_id, notes, prepared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [code, f.id, f.version, JSON.stringify(used.map(({ expiry_date: _e, ...u }) => u)), round6(outBase), outItem.base_uom, wh.id, lot.id, d.notes ?? null, actor.userId]
    )
  ).rows[0];
  await tx.query("UPDATE inv.lot SET origin_entity_id = $2 WHERE id = $1", [lot.id, prep.id]);
  const issueLinesByWh = new Map<string, typeof issueLines>();
  for (const il of issueLines) {
    const locWh = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [il.from_location_id])).rows[0]?.warehouse_id ?? wh.id;
    const list = issueLinesByWh.get(locWh) ?? [];
    list.push(il);
    issueLinesByWh.set(locWh, list);
  }
  let issueId: string | null = null;
  for (const [issueWhId, linesForWh] of issueLinesByWh.entries()) {
    const postedId = await post({ doc_type: "ISSUE", reason_code: "PREPARATION", warehouse_id: issueWhId, source_entity_type: "PREPARATION", source_entity_id: prep.id, lines: linesForWh });
    if (!issueId || issueWhId === wh.id) issueId = postedId;
  }
  // no QC: released before it is booked onto a normal location (a quarantined lot may only sit in quarantine)
  if (!hold) {
    const cur = (await tx.query("SELECT version FROM inv.lot WHERE id = $1", [lot.id])).rows[0];
    await runTransition(tx, lotMachine, actor, { id: lot.id, action: "skip_qc", expectedVersion: cur.version }, { trusted: true });
  }
  const receiptId = await post({
    doc_type: "RECEIPT", reason_code: "PREPARATION", warehouse_id: wh.id, source_entity_type: "PREPARATION", source_entity_id: prep.id,
    lines: [{ item_id: outItem.id, lot_id: lot.id, to_location_id: location, qty: round6(outBase), uom: outItem.base_uom }],
  });
  await tx.query("UPDATE prep.preparation SET issue_document_id = $2, receipt_document_id = $3, to_location_id = $4, incubation_until = $5 WHERE id = $1", [
    prep.id, issueId, receiptId, d.to_location_id ?? null, incubate ? addDays(today, Number(f.incubation_days)) : null,
  ]);
  await writeAudit(tx, actor, { entityType: "preparation", entityId: prep.id, action: "prepare", changes: { code: [null, code], lot: [null, lot.code], qty: [null, `${round6(outBase)} ${outItem.base_uom}`] } });
  return { ...prep, lot_code: lot.code, qc_needed: qcNeeded, expiry_date: expiry, incubation_until: incubate ? addDays(today, Number(f.incubation_days)) : null };
}

/** Cancels a preparation whose lot is still untouched: both documents are reversed (ingredients back to their lots). */
export async function cancelPreparation(tx: Tx, actor: AuthzActor, id: string, reasonInput: unknown) {
  const reason = parseInput(z.string().trim().min(3, "nhập lý do hủy"), reasonInput);
  const p = (await tx.query("SELECT * FROM prep.preparation WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!p) throw notFound("lệnh pha chế");
  const wh = (await tx.query("SELECT owner_org_unit_id FROM master.warehouse WHERE id = $1", [p.warehouse_id])).rows[0];
  await authorize(tx, actor, "prep.execute", wh.owner_org_unit_id);
  if (p.status !== "DONE") throw invalid("Lệnh pha đã hủy.");
  const bal = (await tx.query("SELECT coalesce(sum(qty_on_hand), 0) AS h, coalesce(sum(qty_reserved), 0) AS r FROM inv.stock_balance WHERE lot_id = $1", [p.lot_id])).rows[0];
  const onHand = Number(bal.h);
  const reserved = Number(bal.r);
  if (Math.abs(onHand - Number(p.qty_out)) > 1e-9 || reserved > 0) throw conflict("Lô pha đã được dùng / giữ chỗ: không hủy được, xử lý qua NCR.", "LOT_IN_USE");
  for (const docId of [p.receipt_document_id, p.issue_document_id]) {
    const doc = (await tx.query("SELECT version FROM inv.stock_document WHERE id = $1", [docId])).rows[0];
    await runTransition(tx, stockDocumentMachine, actor, { id: docId, action: "reverse", expectedVersion: doc.version, reason: `Hủy lệnh pha ${p.code}: ${reason}` }, { trusted: true });
  }
  await tx.query("UPDATE prep.preparation SET status = 'CANCELLED', cancel_reason = $2, version = version + 1 WHERE id = $1", [id, reason]);
  await writeAudit(tx, actor, { entityType: "preparation", entityId: id, action: "cancel", changes: { status: ["DONE", "CANCELLED"] }, reason });
}

export async function autoReleaseNonQcPreparations(tx: Tx, actor: AuthzActor, deptScopeRaw?: string | null) {
  await normalizeFormulaOutputItems(tx);
  const scope = normalizePrepDeptScope(deptScopeRaw);
  const today = vnToday();
  const stuck = (
    await tx.query(
      `SELECT p.id, p.code, p.warehouse_id, p.lot_id, p.to_location_id, f.output_item_id, l.code AS lot_code, l.status AS lot_status
         FROM prep.preparation p
         JOIN prep.formula f ON f.id = p.formula_id
         JOIN inv.lot l ON l.id = p.lot_id
        WHERE p.status = 'DONE'
          AND NOT coalesce(f.requires_qc, false)
          AND (p.incubation_until IS NULL OR p.incubated_at IS NOT NULL OR p.incubation_until <= $2)
          AND l.status IN ('QUARANTINE', 'PENDING_QC')
          AND ($1::text IS NULL OR f.dept_scope = $1)
        ORDER BY p.prepared_at ASC
        LIMIT 50`,
      [scope, today]
    )
  ).rows;

  for (const s of stuck) {
    const sp = `sp_auto_rel_${String(s.id).replace(/[^a-zA-Z0-9]/g, "")}`;
    await tx.query(`SAVEPOINT ${sp}`);
    try {
      let targetLocId = s.to_location_id ?? null;
      if (targetLocId) {
        const checkLoc = (
          await tx.query(
            "SELECT id FROM master.location WHERE id = $1 AND warehouse_id = $2 AND status = 'ACTIVE' AND NOT is_quarantine",
            [targetLocId, s.warehouse_id]
          )
        ).rows[0];
        if (!checkLoc) targetLocId = null;
      }
      if (!targetLocId) {
        targetLocId =
          (
            await tx.query(
              "SELECT id FROM master.location WHERE warehouse_id = $1 AND status = 'ACTIVE' AND NOT is_quarantine ORDER BY CASE WHEN code = 'A1' THEN 0 ELSE 1 END, code LIMIT 1",
              [s.warehouse_id]
            )
          ).rows[0]?.id ?? null;
      }
      if (!targetLocId) {
        await tx.query(`RELEASE SAVEPOINT ${sp}`);
        continue;
      }

      const outItem = await getItem(tx, s.output_item_id);
      await tx.query(
        "UPDATE inv.lot SET status = 'RELEASED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
        [s.lot_id, actor.userId]
      );

      const qBalances = (
        await tx.query(
          `SELECT b.location_id, b.qty_on_hand::float AS q
             FROM inv.stock_balance b
             JOIN master.location loc ON loc.id = b.location_id
            WHERE b.lot_id = $1 AND b.qty_on_hand > 0 AND loc.is_quarantine = true`,
          [s.lot_id]
        )
      ).rows;

      if (qBalances.length > 0) {
        const doc = await createStockDocument(
          tx,
          actor,
          {
            doc_type: "TRANSFER",
            reason_code: "PUTAWAY",
            warehouse_id: s.warehouse_id,
            source_entity_type: "PREPARATION",
            source_entity_id: s.id,
            notes: `Tự động giải phóng & cất kệ lô pha chế nội bộ ${s.lot_code} (${s.code} — công thức không yêu cầu chờ QC)`,
            lines: qBalances.map((b) => ({
              item_id: outItem.id,
              lot_id: s.lot_id,
              from_location_id: b.location_id,
              to_location_id: targetLocId,
              qty: b.q,
              uom: outItem.base_uom,
            })),
          },
          { trusted: true }
        );
        await runTransition(
          tx,
          stockDocumentMachine,
          actor,
          { id: doc.id, action: "post", expectedVersion: doc.version },
          { trusted: true }
        );
      }

      await tx.query(
        "UPDATE prep.preparation SET to_location_id = COALESCE(to_location_id, $2), incubated_at = COALESCE(incubated_at, CASE WHEN incubation_until IS NOT NULL THEN now() ELSE NULL END) WHERE id = $1",
        [s.id, targetLocId]
      );
      await tx.query(`RELEASE SAVEPOINT ${sp}`);
    } catch {
      await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
    }
  }
}

export async function listPreparations(tx: Tx, actor: AuthzActor, deptScopeRaw?: string | null) {
  await autoReleaseNonQcPreparations(tx, actor, deptScopeRaw);
  const scope = normalizePrepDeptScope(deptScopeRaw);
  const rows = (
    await tx.query(
      `SELECT p.id, p.code, p.status, p.qty_out::float AS qty_out, p.uom_out, p.prepared_at, p.lines, p.notes, p.cancel_reason, p.warehouse_id, p.lot_id, p.incubation_until, p.incubated_at, p.to_location_id,
              f.code AS formula_code, f.name AS formula_name, f.dept_scope, l.code AS lot_code, l.status AS lot_status, l.expiry_date, u.display_name AS prepared_by_name, w.owner_org_unit_id
         FROM prep.preparation p JOIN prep.formula f ON f.id = p.formula_id JOIN inv.lot l ON l.id = p.lot_id JOIN master.warehouse w ON w.id = p.warehouse_id
         LEFT JOIN core.user_profile u ON u.user_id = p.prepared_by
        WHERE ($1::text IS NULL OR f.dept_scope = $1)
        ORDER BY p.prepared_at DESC LIMIT 200`,
      [scope]
    )
  ).rows;
  const out = [];
  for (const r of rows) if ((await hasFactoryPermission(tx, actor, "prep.execute", r.owner_org_unit_id)) || (await hasFactoryPermission(tx, actor, "inv.stock.view", r.owner_org_unit_id))) out.push(r);
  return out;
}

const confirmPrepQcSchema = z.object({
  result: z.enum(["PASS", "FAIL"]).default("PASS"),
  to_location_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Confirms QC result for an in-house prepared reagent lot (`prep.preparation` / `inv.lot` in QUARANTINE or PENDING_QC).
 * - PASS: marks the lot as `RELEASED` and automatically transfers its quarantine balance (`BT`) onto the active shelf (`A1` / `to_location_id`).
 * - FAIL: marks the lot as `REJECTED` with the failure reason audited.
 * Accepts either `prep.preparation.id` or `inv.lot.id`.
 */
export async function confirmPreparationQc(tx: Tx, actor: AuthzActor, idOrLotId: string, input: unknown) {
  const targetId = parseInput(z.string().uuid("ID lệnh pha hoặc lô pha không hợp lệ."), idOrLotId);
  const d = parseInput(confirmPrepQcSchema, input ?? {});

  const p = (
    await tx.query(
      `SELECT p.*, w.owner_org_unit_id, w.code AS warehouse_code,
              f.code AS formula_code, f.name AS formula_name, f.output_item_id,
              l.code AS lot_code, l.status AS lot_status, l.version AS lot_version
         FROM prep.preparation p
         JOIN master.warehouse w ON w.id = p.warehouse_id
         JOIN prep.formula f ON f.id = p.formula_id
         JOIN inv.lot l ON l.id = p.lot_id
        WHERE p.id = $1 OR p.lot_id = $1
        FOR UPDATE OF p, l`,
      [targetId]
    )
  ).rows[0];
  if (!p) throw notFound("lô hóa chất pha chế");

  const canConfirm =
    Boolean(actor.isRootAdmin || actor.isPortalAdmin) ||
    (await hasFactoryPermission(tx, actor, "prep.execute", p.owner_org_unit_id)) ||
    (await hasFactoryPermission(tx, actor, "prep.formula.manage", p.owner_org_unit_id)) ||
    (await hasFactoryPermission(tx, actor, "inv.lot.release", p.owner_org_unit_id)) ||
    (await hasFactoryPermission(tx, actor, "qms.qc.review", p.owner_org_unit_id));
  if (!canConfirm) {
    throw forbidden("Bạn không có quyền xác nhận kết quả QC cho lô hóa chất pha chế này.");
  }

  if (p.status !== "DONE") {
    throw invalid("Lệnh pha chế này đã hủy, không thể xác nhận QC.");
  }
  if (!["QUARANTINE", "PENDING_QC", "ON_HOLD"].includes(p.lot_status)) {
    throw conflict(`Lô ${p.lot_code} đang ở trạng thái ${p.lot_status}, không còn ở trạng thái chờ QC.`, "LOT_ALREADY_DECIDED");
  }

  const outItem = await getItem(tx, p.output_item_id);
  const noteText = d.notes?.trim() || (d.result === "PASS" ? "Đạt kiểm tra QC nội bộ sau pha chế" : "Không đạt QC nội bộ");

  if (d.result === "FAIL") {
    if (!d.notes || d.notes.trim().length < 3) {
      throw invalid("Vui lòng nhập lý do / kết quả không đạt QC (tối thiểu 3 ký tự).");
    }
    await tx.query(
      "UPDATE inv.lot SET status = 'REJECTED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
      [p.lot_id, actor.userId]
    );
    const mergedNotes = [p.notes, `[QC KHÔNG ĐẠT - ${actor.name}]: ${noteText}`].filter(Boolean).join(" · ");
    await tx.query(
      "UPDATE prep.preparation SET notes = $2, version = version + 1 WHERE id = $1",
      [p.id, mergedNotes]
    );
    await writeAudit(tx, actor, {
      entityType: "preparation",
      entityId: p.id,
      action: "qc_reject",
      reason: noteText,
      changes: { lot_status: [p.lot_status, "REJECTED"], lot_code: [p.lot_code, p.lot_code] },
    });
    await writeAudit(tx, actor, {
      entityType: "lot",
      entityId: p.lot_id,
      action: "reject",
      reason: noteText,
      changes: { status: [p.lot_status, "REJECTED"] },
    });
    return { ok: true, id: p.id, lot_id: p.lot_id, lot_code: p.lot_code, lot_status: "REJECTED" };
  }

  // PASS -> Resolve target non-quarantine shelf location (A1)
  let targetLocId = d.to_location_id ?? p.to_location_id ?? null;
  if (targetLocId) {
    const checkLoc = (
      await tx.query(
        "SELECT id FROM master.location WHERE id = $1 AND warehouse_id = $2 AND status = 'ACTIVE' AND NOT is_quarantine",
        [targetLocId, p.warehouse_id]
      )
    ).rows[0];
    if (!checkLoc) targetLocId = null;
  }
  if (!targetLocId) {
    targetLocId = (
      await tx.query(
        "SELECT id FROM master.location WHERE warehouse_id = $1 AND status = 'ACTIVE' AND NOT is_quarantine ORDER BY CASE WHEN code = 'A1' THEN 0 ELSE 1 END, code LIMIT 1",
        [p.warehouse_id]
      )
    ).rows[0]?.id ?? null;
  }
  if (!targetLocId) {
    throw invalid(`Kho ${p.warehouse_code} chưa có vị trí kệ thường (A1) để cất lô sau khi duyệt QC.`);
  }

  await tx.query(
    "UPDATE inv.lot SET status = 'RELEASED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
    [p.lot_id, actor.userId]
  );

  // Move any balance currently sitting on a quarantine location (BT) onto targetLocId (A1)
  const qBalances = (
    await tx.query(
      `SELECT b.location_id, b.qty_on_hand::float AS q
         FROM inv.stock_balance b
         JOIN master.location loc ON loc.id = b.location_id
        WHERE b.lot_id = $1 AND b.qty_on_hand > 0 AND loc.is_quarantine = true`,
      [p.lot_id]
    )
  ).rows;

  if (qBalances.length > 0) {
    const doc = await createStockDocument(
      tx,
      actor,
      {
        doc_type: "TRANSFER",
        reason_code: "PUTAWAY",
        warehouse_id: p.warehouse_id,
        source_entity_type: "PREPARATION",
        source_entity_id: p.id,
        notes: `Giải phóng QC & cất kệ lô pha chế ${p.lot_code} (${p.code}): ${noteText}`,
        lines: qBalances.map((b) => ({
          item_id: outItem.id,
          lot_id: p.lot_id,
          from_location_id: b.location_id,
          to_location_id: targetLocId,
          qty: b.q,
          uom: outItem.base_uom,
        })),
      },
      { trusted: true }
    );
    await runTransition(
      tx,
      stockDocumentMachine,
      actor,
      { id: doc.id, action: "post", expectedVersion: doc.version },
      { trusted: true }
    );
  }

  const mergedNotes = [p.notes, `[QC ĐẠT - ${actor.name}]: ${noteText}`].filter(Boolean).join(" · ");
  await tx.query(
    "UPDATE prep.preparation SET notes = $2, to_location_id = $3, version = version + 1 WHERE id = $1",
    [p.id, mergedNotes, targetLocId]
  );

  await writeAudit(tx, actor, {
    entityType: "preparation",
    entityId: p.id,
    action: "qc_release",
    reason: noteText,
    changes: { lot_status: [p.lot_status, "RELEASED"], lot_code: [p.lot_code, p.lot_code] },
  });
  await writeAudit(tx, actor, {
    entityType: "lot",
    entityId: p.lot_id,
    action: "release",
    reason: noteText,
    changes: { status: [p.lot_status, "RELEASED"] },
  });

  return { ok: true, id: p.id, lot_id: p.lot_id, lot_code: p.lot_code, lot_status: "RELEASED", to_location_id: targetLocId };
}

/** Warehouses where the user may prepare, with their normal (non-quarantine) locations. */
export async function prepOptions(tx: Tx, actor: AuthzActor, deptScopeRaw?: string | null) {
  const scope = normalizePrepDeptScope(deptScopeRaw);
  const whs = (
    await tx.query(
      `SELECT w.id, w.code, w.name, w.owner_org_unit_id, w.purpose, ou.module_key AS org_module_key
         FROM master.warehouse w
         LEFT JOIN core.org_unit ou ON ou.id = w.owner_org_unit_id
        WHERE w.status = 'ACTIVE'
        ORDER BY w.code`
    )
  ).rows;
  const permitted = [];
  for (const w of whs) {
    if (!(await hasFactoryPermission(tx, actor, "prep.execute", w.owner_org_unit_id))) continue;
    const locations = (await tx.query("SELECT id, code, name FROM master.location WHERE warehouse_id = $1 AND status = 'ACTIVE' AND NOT is_quarantine ORDER BY code", [w.id])).rows;
    permitted.push({ ...w, locations });
  }
  if (!scope) return permitted;

  const matching = permitted.filter((w) => {
    const whDept = ["OLIGO", "RD", "KIT", "DEVICE"].includes(w.org_module_key)
      ? w.org_module_key
      : ["OLIGO", "RD"].includes(w.purpose)
        ? w.purpose
        : null;
    return !whDept || whDept === scope;
  });
  const list = matching.length > 0 ? matching : permitted;
  return list.sort((a, b) => {
    const aOwn = a.org_module_key === scope || a.purpose === scope ? 0 : 1;
    const bOwn = b.org_module_key === scope || b.purpose === scope ? 0 : 1;
    return aOwn - bOwn || String(a.code).localeCompare(String(b.code));
  });
}
