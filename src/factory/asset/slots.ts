import { z } from "zod";
import type { Tx } from "../core/db";
import { writeAudit } from "../core/audit";
import { authorize, hasFactoryPermission, registerPermissions, type AuthzActor } from "../core/authz";
import { vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { parseInput } from "../core/records";
import { runTransition } from "../core/stateMachine";
import { allocate, findCandidates, type Candidate } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { getItem, toBaseQty } from "../master/service";

registerPermissions([{ code: "asset.operate", description: "Vận hành thiết bị: lắp / thay chai hóa chất, ghi tiêu hao (chạy mẫu, rửa máy, bảo trì, hao hụt)" }]);

export const USAGE_KINDS = ["RUN", "PURGE", "MAINTENANCE", "LOSS"] as const;
const USAGE_LABEL: Record<(typeof USAGE_KINDS)[number], string> = { RUN: "Chạy mẫu", PURGE: "Rửa / cân bằng máy", MAINTENANCE: "Bảo trì", LOSS: "Hao hụt" };

let hplcSlotSchemaEnsured = false;

export async function ensureHplcReagentSlotsAndColumnsSeed(tx: Tx) {
  if (hplcSlotSchemaEnsured) return;
  await tx.query("SAVEPOINT hplc_seed_sp");
  try {
    await tx.query(`
      ALTER TABLE asset.reagent_slot
        ADD COLUMN IF NOT EXISTS bottle_volume_base numeric(14,4) NOT NULL DEFAULT 2500,
        ADD COLUMN IF NOT EXISTS std_qty_per_run numeric(14,4) NOT NULL DEFAULT 15,
        ADD COLUMN IF NOT EXISTS std_qty_per_purge numeric(14,4) NOT NULL DEFAULT 30,
        ADD COLUMN IF NOT EXISTS bottle_price_vnd numeric(18,2) NOT NULL DEFAULT 1850000,
        ADD COLUMN IF NOT EXISTS design_runs integer NOT NULL DEFAULT 140
    `);

    const oligoUnit = (
      await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-OLIGO' OR module_key = 'OLIGO' ORDER BY code LIMIT 1")
    ).rows[0];
    if (!oligoUnit) {
      await tx.query("RELEASE SAVEPOINT hplc_seed_sp");
      hplcSlotSchemaEnsured = true;
      return;
    }

    const allowDemoSeed = process.env.FACTORY_ALLOW_DEMO_SEED === "1";

    // 1. Khởi tạo Hệ thống HPLC Tinh sạch Oligo & Máy đo quang phổ của phòng Oligo nếu bật demo seed
    let hplcAsset = (
      await tx.query(
        "SELECT id, code FROM asset.asset WHERE owner_org_unit_id = $1 AND asset_type = 'HPLC' ORDER BY (code = 'HPLC-01') DESC, code LIMIT 1",
        [oligoUnit.id]
      )
    ).rows[0];
    if (!hplcAsset && allowDemoSeed) {
      hplcAsset = (
        await tx.query(
          `INSERT INTO asset.asset
             (code, name, asset_type, owner_org_unit_id, manufacturer, model, serial_no, status, calibration_interval_days, next_calibration_due)
           VALUES ('HPLC-OLG-01', 'Hệ thống Sắc ký Lỏng Tinh sạch Oligo Prep-HPLC (Agilent 1260 Infinity II)', 'HPLC', $1, 'Agilent Technologies', '1260 Infinity II Prep-LC', 'AG-1260P-OLG01', 'IN_SERVICE', 180, '2027-04-30')
           RETURNING id, code`,
          [oligoUnit.id]
        )
      ).rows[0];
    }

    if (allowDemoSeed) {
      const specExists = (await tx.query("SELECT id FROM asset.asset WHERE code = 'SPEC-OLG-01' LIMIT 1")).rows[0];
      if (!specExists) {
        await tx.query(
          `INSERT INTO asset.asset
             (code, name, asset_type, owner_org_unit_id, manufacturer, model, serial_no, status, calibration_interval_days, next_calibration_due)
           VALUES ('SPEC-OLG-01', 'Máy Đo Quang Phổ OD260/280 Định lượng Oligo (Implen NanoPhotometer N60)', 'SPECTROPHOTOMETER', $1, 'Implen', 'NanoPhotometer N60', 'IMP-N60-OLG02', 'IN_SERVICE', 365, '2027-05-15')`,
          [oligoUnit.id]
        );
      }

      // 2. Khởi tạo Cột sắc ký mẫu gắn trên máy HPLC nếu bảng lc_column đang trống
      const colCount = Number((await tx.query("SELECT count(*)::int AS c FROM asset.lc_column")).rows[0]?.c || 0);
      if (colCount === 0 && hplcAsset) {
        const col1 = (
          await tx.query(
            `INSERT INTO asset.lc_column (code, name, asset_id, price_vnd, design_runs, status)
             VALUES ('COL-C18-PREP-01', 'Cột Tinh sạch Oligo Reverse-Phase C18 Prep (250×10mm, 5µm, 100Å)', $1, 18500000, 250, 'ACTIVE')
             RETURNING id`,
            [hplcAsset.id]
          )
        ).rows[0];
        await tx.query(
          `INSERT INTO asset.lc_column (code, name, asset_id, price_vnd, design_runs, status)
           VALUES ('COL-DNAPAC-PA200', 'Cột Trao đổi Ion Tinh sạch Amplicon & Probe DNAPac PA200 (250×9mm)', $1, 24000000, 200, 'ACTIVE')`,
          [hplcAsset.id]
        );
        if (col1) {
          await tx.query(
            `INSERT INTO asset.lc_column_run (column_id, sequence_code, step_name, cost_vnd)
             VALUES ($1, 'O261000003 (HBV-TaqMan-Probe)', 'Tinh sạch HPLC Reverse-Phase', 74000)`,
            [col1.id]
          );
        }
      }
    }

    // 3. Khởi tạo 5 mã Hóa chất chạy máy HPLC & gắn cấu hình 5 Kênh hóa chất chuẩn cho các máy HPLC của phòng Oligo
    const wh = (
      await tx.query(
        "SELECT w.id AS warehouse_id, l.id AS location_id FROM master.warehouse w JOIN master.location l ON l.warehouse_id = w.id WHERE (w.owner_org_unit_id = $1 OR w.code = 'KHO-OLIGO') AND NOT l.is_quarantine ORDER BY w.code, l.code LIMIT 1",
        [oligoUnit.id]
      )
    ).rows[0];

    const hplcReagentSeeds = [
      {
        slot_no: 1,
        label: "Kênh A — Pha động A: Đệm TEAA 0.1M pH 7.0",
        item_code: "HPLC-RG-TEAA-01M",
        item_name: "Hóa chất HPLC: Đệm Triethylammonium Acetate (TEAA) 0.1M pH 7.0",
        lot_code: "LOT-TEAA-2610",
        expiry_date: "2027-06-30",
        bottle_volume_base: 2500,
        std_qty_per_run: 18,
        std_qty_per_purge: 35,
        bottle_price_vnd: 1850000,
        design_runs: 125,
        initial_used_run_qty: 180, // 10 mẫu đã chạy
        initial_used_purge_qty: 70, // 2 lần purge
      },
      {
        slot_no: 2,
        label: "Kênh B — Pha động B: Acetonitrile Gradient ≥99.9%",
        item_code: "HPLC-RG-ACN-GRAD",
        item_name: "Hóa chất HPLC: Acetonitrile Gradient Grade cho Sắc ký Lỏng (Chai 2.5L)",
        lot_code: "LOT-ACN-HPLC-2610",
        expiry_date: "2027-12-31",
        bottle_volume_base: 2500,
        std_qty_per_run: 12,
        std_qty_per_purge: 25,
        bottle_price_vnd: 2650000,
        design_runs: 180,
        initial_used_run_qty: 120,
        initial_used_purge_qty: 50,
      },
      {
        slot_no: 3,
        label: "Kênh C — Đệm Ion-Pair HFIP 100mM / TEA 8.6mM",
        item_code: "HPLC-RG-HFIP-TEA",
        item_name: "Hóa chất HPLC: Hệ đệm Hexafluoroisopropanol (HFIP) / TEA tinh sạch Probe & Amplicon",
        lot_code: "LOT-HFIP-2610",
        expiry_date: "2027-05-31",
        bottle_volume_base: 1000,
        std_qty_per_run: 10,
        std_qty_per_purge: 20,
        bottle_price_vnd: 3200000,
        design_runs: 90,
        initial_used_run_qty: 60,
        initial_used_purge_qty: 20,
      },
      {
        slot_no: 4,
        label: "Kênh D — Dung môi Rửa kim & Cột (MeOH / H2O 80:20)",
        item_code: "HPLC-RG-WASH-MEOH",
        item_name: "Hóa chất HPLC: Dung môi Rửa kim tiêm & Tái sinh Cột Methanol/Water 80:20",
        lot_code: "LOT-WASH-2610",
        expiry_date: "2027-09-30",
        bottle_volume_base: 2500,
        std_qty_per_run: 8,
        std_qty_per_purge: 40,
        bottle_price_vnd: 1200000,
        design_runs: 250,
        initial_used_run_qty: 80,
        initial_used_purge_qty: 80,
      },
      {
        slot_no: 5,
        label: "Kênh E — Nước Siêu tinh khiết Sắc ký (Ultrapure 18.2 MΩ·cm)",
        item_code: "HPLC-RG-WATER-UP",
        item_name: "Hóa chất HPLC: Nước Siêu tinh khiết Chuẩn Sắc ký Lỏng lọc 0.22µm",
        lot_code: "LOT-UPW-2610",
        expiry_date: "2027-08-31",
        bottle_volume_base: 2500,
        std_qty_per_run: 15,
        std_qty_per_purge: 30,
        bottle_price_vnd: 650000,
        design_runs: 150,
        initial_used_run_qty: 150,
        initial_used_purge_qty: 60,
      },
    ];

    const hplcAssets = (
      await tx.query("SELECT id, code FROM asset.asset WHERE owner_org_unit_id = $1 AND asset_type = 'HPLC' ORDER BY code", [oligoUnit.id])
    ).rows;

    for (const r of hplcReagentSeeds) {
      let item = (await tx.query("SELECT id FROM master.item WHERE code = $1 LIMIT 1", [r.item_code])).rows[0];
      if (!item) {
        item = (
          await tx.query(
            `INSERT INTO master.item (code, name, item_type, base_uom, tracking, receipt_qc_required, status)
             VALUES ($1, $2, 'REAGENT', 'mL', 'LOT', true, 'ACTIVE')
             RETURNING id`,
            [r.item_code, r.item_name]
          )
        ).rows[0];
      }

      let lot: { id: string } | undefined;
      if (allowDemoSeed) {
        lot = (await tx.query("SELECT id FROM inv.lot WHERE item_id = $1 AND code = $2 LIMIT 1", [item.id, r.lot_code])).rows[0];
        if (!lot) {
          lot = (
            await tx.query(
              `INSERT INTO inv.lot (code, item_id, origin, status, received_date, expiry_date)
               VALUES ($1, $2, 'PURCHASE', 'RELEASED', '2026-10-01', $3)
               RETURNING id`,
              [r.lot_code, item.id, r.expiry_date]
            )
          ).rows[0];
        }

        if (wh && lot) {
          const bal = (
            await tx.query(
              "SELECT id FROM inv.stock_balance WHERE item_id = $1 AND location_id = $2 AND lot_id = $3 LIMIT 1",
              [item.id, wh.location_id, lot.id]
            )
          ).rows[0];
          if (!bal) {
            const onHand = r.bottle_volume_base * 2 - (r.initial_used_run_qty + r.initial_used_purge_qty);
            await tx.query(
              `INSERT INTO inv.stock_balance (item_id, location_id, lot_id, qty_on_hand, qty_reserved)
               VALUES ($1, $2, $3, $4, 0)`,
              [item.id, wh.location_id, lot.id, onHand]
            );
          }
        }
      }

      for (const ha of hplcAssets) {
        await tx.query(
          `INSERT INTO asset.reagent_slot
             (asset_id, slot_no, label, item_id, current_lot_id, installed_at, bottle_volume_base, std_qty_per_run, std_qty_per_purge, bottle_price_vnd, design_runs)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::uuid IS NOT NULL THEN now() - interval '5 days' ELSE NULL END, $6, $7, $8, $9, $10)
           ON CONFLICT (asset_id, slot_no) DO NOTHING`,
          [
            ha.id,
            r.slot_no,
            r.label,
            item.id,
            lot?.id ?? null,
            r.bottle_volume_base,
            r.std_qty_per_run,
            r.std_qty_per_purge,
            r.bottle_price_vnd,
            r.design_runs,
          ]
        );
        if (allowDemoSeed && lot && ha.id === hplcAsset?.id) {
          const evCount = Number((await tx.query("SELECT count(*)::int AS c FROM asset.slot_event WHERE asset_id = $1 AND slot_no = $2", [ha.id, r.slot_no])).rows[0]?.c || 0);
          if (evCount === 0) {
            await tx.query(
              `INSERT INTO asset.slot_event (asset_id, slot_no, event, lot_id, notes, created_at)
               VALUES ($1, $2, 'INSTALL', $3, 'Lắp chai hóa chất HPLC mới lên kênh', now() - interval '5 days')`,
              [ha.id, r.slot_no, lot.id]
            );
            if (r.initial_used_run_qty > 0) {
              await tx.query(
                `INSERT INTO asset.slot_event (asset_id, slot_no, event, lot_id, usage_kind, qty_base, source_ref, notes, created_at)
                 VALUES ($1, $2, 'USAGE', $3, 'RUN', $4, 'Mẻ tinh sạch Probe/Amplicon', 'Chạy 10 mẫu tinh sạch Oligo theo định mức kênh', now() - interval '2 days')`,
                [ha.id, r.slot_no, lot.id, r.initial_used_run_qty]
              );
            }
            if (r.initial_used_purge_qty > 0) {
              await tx.query(
                `INSERT INTO asset.slot_event (asset_id, slot_no, event, lot_id, usage_kind, qty_base, source_ref, notes, created_at)
                 VALUES ($1, $2, 'USAGE', $3, 'PURGE', $4, 'Cân bằng đầu ngày', 'Purge đuổi bọt khí & cân bằng đường ống HPLC', now() - interval '1 day')`,
                [ha.id, r.slot_no, lot.id, r.initial_used_purge_qty]
              );
            }
          }
        }
      }
    }

    await tx.query("RELEASE SAVEPOINT hplc_seed_sp");
    hplcSlotSchemaEnsured = true;
  } catch (err) {
    await tx.query("ROLLBACK TO SAVEPOINT hplc_seed_sp").catch(() => {});
    console.warn("[ensureHplcReagentSlotsAndColumnsSeed] warning:", err);
  }
}

async function asset(tx: Tx, id: string) {
  await ensureHplcReagentSlotsAndColumnsSeed(tx);
  const a = (await tx.query("SELECT id, code, name, asset_type, owner_org_unit_id FROM asset.asset WHERE id = $1", [id])).rows[0];
  if (!a) throw notFound("thiết bị");
  return a;
}
const warehousesOf = async (tx: Tx, unit: string) =>
  (await tx.query("SELECT id FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE'", [unit])).rows.map((r) => r.id as string);

const slotsSchema = z.object({
  slots: z
    .array(
      z.object({
        slot_no: z.coerce.number().int().min(1).max(50),
        label: z.string().trim().min(1).max(100),
        item_id: z.string().uuid("chọn mã hàng"),
        bottle_volume_base: z.coerce.number().positive().optional(),
        std_qty_per_run: z.coerce.number().min(0).optional(),
        std_qty_per_purge: z.coerce.number().min(0).optional(),
        bottle_price_vnd: z.coerce.number().min(0).optional(),
        design_runs: z.coerce.number().int().positive().optional(),
      })
    )
    .max(50),
});

/** Declares the positions of an instrument and the item each takes. A position whose item changes loses its bottle. */
export async function configureSlots(tx: Tx, actor: AuthzActor, assetId: string, input: unknown) {
  const { slots } = parseInput(slotsSchema, input);
  const a = await asset(tx, assetId);
  await authorize(tx, actor, "asset.manage", a.owner_org_unit_id);
  if (new Set(slots.map((s) => s.slot_no)).size !== slots.length) throw invalid("Trùng số vị trí.");
  for (const s of slots) await getItem(tx, s.item_id);
  const cur = (await tx.query("SELECT * FROM asset.reagent_slot WHERE asset_id = $1 FOR UPDATE", [assetId])).rows;
  for (const c of cur) {
    const next = slots.find((s) => s.slot_no === c.slot_no);
    if (next && next.item_id === c.item_id) continue;
    if (c.current_lot_id) await event(tx, actor, assetId, c.slot_no, "REMOVE", { lot_id: c.current_lot_id, notes: "Đổi cấu hình vị trí" });
    await tx.query("DELETE FROM asset.reagent_slot WHERE asset_id = $1 AND slot_no = $2", [assetId, c.slot_no]);
  }
  for (const s of slots) {
    await tx.query(
      `INSERT INTO asset.reagent_slot
         (asset_id, slot_no, label, item_id, bottle_volume_base, std_qty_per_run, std_qty_per_purge, bottle_price_vnd, design_runs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (asset_id, slot_no) DO UPDATE
         SET label = EXCLUDED.label,
             item_id = EXCLUDED.item_id,
             bottle_volume_base = EXCLUDED.bottle_volume_base,
             std_qty_per_run = EXCLUDED.std_qty_per_run,
             std_qty_per_purge = EXCLUDED.std_qty_per_purge,
             bottle_price_vnd = EXCLUDED.bottle_price_vnd,
             design_runs = EXCLUDED.design_runs,
             version = asset.reagent_slot.version + 1`,
      [
        assetId,
        s.slot_no,
        s.label,
        s.item_id,
        s.bottle_volume_base ?? 2500,
        s.std_qty_per_run ?? 15,
        s.std_qty_per_purge ?? 30,
        s.bottle_price_vnd ?? 1850000,
        s.design_runs ?? 140,
      ]
    );
  }
  await writeAudit(tx, actor, { entityType: "asset", entityId: assetId, action: "configure_slots", changes: { slots: [cur.length, slots.map((s) => `${s.slot_no}:${s.label}`).join(" ")] } });
}

async function event(tx: Tx, actor: AuthzActor, assetId: string, slotNo: number, kind: string, f: Record<string, unknown>) {
  await tx.query(
    `INSERT INTO asset.slot_event (asset_id, slot_no, event, lot_id, usage_kind, qty_base, stock_document_id, source_ref, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [assetId, slotNo, kind, f.lot_id ?? null, f.usage_kind ?? null, f.qty ?? null, f.doc ?? null, f.source_ref ?? null, f.notes ?? null, actor.userId]
  );
}

async function lockSlot(tx: Tx, assetId: string, slotNo: number) {
  const s = (await tx.query("SELECT * FROM asset.reagent_slot WHERE asset_id = $1 AND slot_no = $2 FOR UPDATE", [assetId, slotNo])).rows[0];
  if (!s) throw notFound(`vị trí ${slotNo}`);
  return s;
}

/** Puts a bottle on a position (released, unexpired lot of the position's item, in stock) or takes it off. */
export async function setSlotBottle(tx: Tx, actor: AuthzActor, assetId: string, slotNo: number, input: unknown) {
  const { lot_id } = parseInput(z.object({ lot_id: z.string().uuid().nullable() }), input);
  const a = await asset(tx, assetId);
  await authorize(tx, actor, "asset.operate", a.owner_org_unit_id);
  const slot = await lockSlot(tx, assetId, slotNo);
  if (lot_id) {
    const lot = (await tx.query("SELECT code, item_id, status, expiry_date FROM inv.lot WHERE id = $1", [lot_id])).rows[0];
    if (!lot) throw notFound("lô");
    if (lot.item_id !== slot.item_id) throw invalid(`Lô ${lot.code} không phải mã hàng của vị trí ${slot.label}.`, undefined, "WRONG_ITEM");
    if (lot.status !== "RELEASED") throw invalid(`Lô ${lot.code} chưa được giải phóng (QC).`, undefined, "LOT_NOT_RELEASED");
    if (lot.expiry_date && lot.expiry_date < vnToday()) throw invalid(`Lô ${lot.code} đã hết hạn.`, undefined, "LOT_EXPIRED");
    if (!(await lotCandidates(tx, a, slot.item_id, lot_id)).length) throw invalid(`Lô ${lot.code} không còn tồn khả dụng trong kho của phòng.`, undefined, "INSUFFICIENT_STOCK");
  }
  if (slot.current_lot_id) await event(tx, actor, assetId, slotNo, "REMOVE", { lot_id: slot.current_lot_id });
  await tx.query("UPDATE asset.reagent_slot SET current_lot_id = $3, installed_at = now(), installed_by = $4, version = version + 1 WHERE asset_id = $1 AND slot_no = $2", [
    assetId, slotNo, lot_id, actor.userId,
  ]);
  if (lot_id) await event(tx, actor, assetId, slotNo, "INSTALL", { lot_id });
}

async function lotCandidates(tx: Tx, a: { owner_org_unit_id: string }, itemId: string, lotId: string, lock = false): Promise<Candidate[]> {
  return (await findCandidates(tx, itemId, await warehousesOf(tx, a.owner_org_unit_id), { lock })).filter((c) => c.lot_id === lotId);
}

async function issueFrom(tx: Tx, actor: AuthzActor, picks: { candidate: Candidate; qty: number }[], itemId: string, uom: string, reason: string, source: { type: string; id: string }) {
  let first: string | null = null;
  const byWh = new Map<string, any[]>();
  for (const p of picks) {
    const wh = (await tx.query("SELECT warehouse_id FROM master.location WHERE id = $1", [p.candidate.location_id])).rows[0].warehouse_id;
    byWh.set(wh, [...(byWh.get(wh) ?? []), { item_id: itemId, lot_id: p.candidate.lot_id, from_location_id: p.candidate.location_id, qty: p.qty, uom }]);
  }
  for (const [wh, lines] of byWh) {
    const doc = await createStockDocument(tx, actor, { doc_type: "ISSUE", reason_code: reason, warehouse_id: wh, source_entity_type: source.type, source_entity_id: source.id, lines }, { trusted: true });
    await runTransition(tx, stockDocumentMachine, actor, { id: doc.id, action: "post", expectedVersion: doc.version }, { trusted: true });
    first ??= doc.id;
  }
  return first;
}

const usageSchema = z.object({
  kind: z.enum(USAGE_KINDS),
  qty: z.coerce.number().positive("lượng phải lớn hơn 0").optional(),
  sample_runs: z.coerce.number().int().positive().optional(),
  uom: z.string().min(1).optional(),
  source_ref: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** Usage outside a sample run (purge, maintenance, loss) — or a run logged by hand / batch — issued from the bottle on the position. */
export async function logSlotUsage(tx: Tx, actor: AuthzActor, assetId: string, slotNo: number, input: unknown) {
  const d = parseInput(usageSchema, input);
  const a = await asset(tx, assetId);
  await authorize(tx, actor, "asset.operate", a.owner_org_unit_id);

  // Nếu slotNo === 0: Ghi nhận đồng loạt cho tất cả các kênh đang lắp chai trên thiết bị (VD: Chạy 1 mẻ mẫu HPLC hoặc Purge toàn hệ thống)
  if (slotNo === 0) {
    const activeSlots = (
      await tx.query("SELECT * FROM asset.reagent_slot WHERE asset_id = $1 AND current_lot_id IS NOT NULL ORDER BY slot_no FOR UPDATE", [assetId])
    ).rows;
    if (!activeSlots.length) throw invalid("Thiết bị chưa có kênh hóa chất nào đang lắp chai.", undefined, "NO_ACTIVE_SLOTS");
    const runs = d.sample_runs ?? 1;
    let totalIssued = 0;
    for (const s of activeSlots) {
      const item = await getItem(tx, s.item_id);
      const rawQty =
        d.kind === "RUN"
          ? Number(s.std_qty_per_run || 15) * runs
          : d.kind === "PURGE"
          ? Number(s.std_qty_per_purge || 30) * runs
          : d.qty ?? Number(s.std_qty_per_run || 15);
      const qty = Math.round((await toBaseQty(tx, item, rawQty, d.uom ?? item.base_uom)) * 1e6) / 1e6;
      if (qty <= 0) continue;
      const plan = allocate(await lotCandidates(tx, a, s.item_id, s.current_lot_id, true), qty);
      if (plan.shortfall > 1e-9) {
        throw invalid(
          `Chai đang lắp ở ${s.label} không đủ tồn sổ sách (cần ${qty} ${item.base_uom}). Vui lòng thay chai hoặc kiểm kê.`,
          undefined,
          "INSUFFICIENT_STOCK"
        );
      }
      const doc = await issueFrom(tx, actor, plan.picks, s.item_id, item.base_uom, `EQUIPMENT_${d.kind}`, { type: "ASSET", id: assetId });
      await event(tx, actor, assetId, s.slot_no, "USAGE", {
        lot_id: s.current_lot_id,
        usage_kind: d.kind,
        qty,
        doc,
        source_ref: d.source_ref ?? (d.kind === "RUN" ? `Chạy ${runs} mẫu HPLC` : `Purge hệ thống (${runs} lần)`),
        notes: d.notes,
      });
      totalIssued += qty;
    }
    return { qty_base: totalIssued, channels: activeSlots.length };
  }

  const slot = await lockSlot(tx, assetId, slotNo);
  if (!slot.current_lot_id) throw invalid(`Vị trí ${slot.label} chưa lắp chai.`, undefined, "SLOT_EMPTY");
  const item = await getItem(tx, slot.item_id);
  const rawQty =
    d.qty ??
    (d.sample_runs
      ? (d.kind === "PURGE" ? Number(slot.std_qty_per_purge || 30) : Number(slot.std_qty_per_run || 15)) * d.sample_runs
      : Number(slot.std_qty_per_run || 15));
  const qty = Math.round((await toBaseQty(tx, item, rawQty, d.uom ?? item.base_uom)) * 1e6) / 1e6;
  const plan = allocate(await lotCandidates(tx, a, slot.item_id, slot.current_lot_id, true), qty);
  if (plan.shortfall > 1e-9) throw invalid(`Chai đang lắp ở ${slot.label} không đủ tồn sổ sách (${qty} ${item.base_uom}). Thay chai hoặc kiểm kê.`, undefined, "INSUFFICIENT_STOCK");
  const doc = await issueFrom(tx, actor, plan.picks, slot.item_id, item.base_uom, `EQUIPMENT_${d.kind}`, { type: "ASSET", id: assetId });
  await event(tx, actor, assetId, slotNo, "USAGE", {
    lot_id: slot.current_lot_id,
    usage_kind: d.kind,
    qty,
    doc,
    source_ref: d.source_ref ?? (d.sample_runs ? `${d.sample_runs} lượt (${USAGE_LABEL[d.kind]})` : null),
    notes: d.notes,
  });
  return { qty_base: qty };
}

/**
 * A step reagent drawn on an instrument used in the same step (e.g. HPLC buffer during the run): taken from the
 * bottle on the matching position first, recorded as a RUN usage. Returns what is still to issue (FEFO).
 */
export async function drawFromInstrument(tx: Tx, actor: AuthzActor, assetIds: string[], itemId: string, qtyBase: number, source: { type: string; id: string; ref: string }) {
  let left = qtyBase;
  const docs: string[] = [];
  for (const assetId of assetIds) {
    if (left <= 1e-9) break;
    const slot = (await tx.query("SELECT * FROM asset.reagent_slot WHERE asset_id = $1 AND item_id = $2 AND current_lot_id IS NOT NULL ORDER BY slot_no LIMIT 1 FOR UPDATE", [assetId, itemId])).rows[0];
    if (!slot) continue;
    const a = await asset(tx, assetId);
    const plan = allocate(await lotCandidates(tx, a, itemId, slot.current_lot_id, true), left);
    const taken = plan.picks.reduce((n, p) => n + p.qty, 0);
    if (taken <= 0) continue;
    const item = await getItem(tx, itemId);
    const doc = await issueFrom(tx, actor, plan.picks, itemId, item.base_uom, "POST_SYNTHESIS", source);
    if (doc) docs.push(doc);
    await event(tx, actor, assetId, slot.slot_no, "USAGE", { lot_id: slot.current_lot_id, usage_kind: "RUN", qty: taken, doc, source_ref: source.ref });
    left = Math.round((left - taken) * 1e6) / 1e6;
  }
  return { left, docs };
}

export async function listSlots(tx: Tx, actor: AuthzActor, assetId: string) {
  const a = await asset(tx, assetId);
  if (!(await hasFactoryPermission(tx, actor, "asset.view", a.owner_org_unit_id)) && !(await hasFactoryPermission(tx, actor, "oligo.view", a.owner_org_unit_id))) throw notFound("thiết bị");
  const slots = (
    await tx.query(
      `SELECT s.slot_no, s.label, s.item_id, s.current_lot_id, s.installed_at,
              s.bottle_volume_base::float AS bottle_volume_base,
              s.std_qty_per_run::float AS std_qty_per_run,
              s.std_qty_per_purge::float AS std_qty_per_purge,
              s.bottle_price_vnd::float AS bottle_price_vnd,
              s.design_runs,
              i.code AS item_code, i.name AS item_name, i.base_uom, l.code AS lot_code, l.expiry_date
         FROM asset.reagent_slot s JOIN master.item i ON i.id = s.item_id LEFT JOIN inv.lot l ON l.id = s.current_lot_id
        WHERE s.asset_id = $1 ORDER BY s.slot_no`,
      [assetId]
    )
  ).rows;
  const warehouses = await warehousesOf(tx, a.owner_org_unit_id);
  for (const s of slots) {
    const cands = await findCandidates(tx, s.item_id, warehouses);
    const byLot = new Map<string, any>();
    for (const c of cands) {
      if (!c.lot_id) continue;
      const cur = byLot.get(c.lot_id) ?? { lot_id: c.lot_id, code: c.lot_code, available: 0, expiry_date: c.expiry_date };
      cur.available += Number(c.available);
      byLot.set(c.lot_id, cur);
    }
    const codes = byLot.size ? (await tx.query("SELECT id, code FROM inv.lot WHERE id = ANY($1::uuid[])", [[...byLot.keys()]])).rows : [];
    s.lots = [...byLot.values()].map((l) => ({ ...l, code: l.code ?? codes.find((c) => c.id === l.lot_id)?.code }));
    s.available = s.current_lot_id ? byLot.get(s.current_lot_id)?.available ?? 0 : null;
    // what the bottle now on the position has been used for since it was installed
    s.usage = s.current_lot_id
      ? (
          await tx.query(
            `SELECT usage_kind, sum(qty_base)::float AS qty FROM asset.slot_event
              WHERE asset_id = $1 AND slot_no = $2 AND lot_id = $3 AND event = 'USAGE' AND ($4::timestamptz IS NULL OR created_at >= $4) GROUP BY usage_kind`,
            [assetId, s.slot_no, s.current_lot_id, s.installed_at]
          )
        ).rows.map((r) => ({ kind: r.usage_kind, label: USAGE_LABEL[r.usage_kind as keyof typeof USAGE_LABEL], qty: r.qty }))
      : [];

    // Tính toán chi tiết Sử dụng & Khấu hao cho từng loại hóa chất HPLC trên kênh này
    const allTimeStats = (
      await tx.query(
        `SELECT coalesce(sum(qty_base), 0)::float AS total_qty,
                coalesce(sum(CASE WHEN usage_kind = 'RUN' THEN qty_base ELSE 0 END), 0)::float AS run_qty,
                coalesce(sum(CASE WHEN usage_kind = 'PURGE' THEN qty_base ELSE 0 END), 0)::float AS purge_qty,
                coalesce(sum(CASE WHEN usage_kind IN ('MAINTENANCE', 'LOSS') THEN qty_base ELSE 0 END), 0)::float AS loss_qty,
                count(*) FILTER (WHERE usage_kind = 'RUN')::int AS run_events
           FROM asset.slot_event
          WHERE asset_id = $1 AND slot_no = $2 AND event = 'USAGE'`,
        [assetId, s.slot_no]
      )
    ).rows[0];

    const bottleVol = Math.max(1, Number(s.bottle_volume_base || 2500));
    const bottlePrice = Math.max(0, Number(s.bottle_price_vnd || 0));
    const stdRun = Math.max(0.1, Number(s.std_qty_per_run || 15));
    const usedCurrentBottle = (s.usage as { kind: string; qty: number }[]).reduce((sum, u) => sum + Number(u.qty || 0), 0);
    const runQtyCurrentBottle = (s.usage as { kind: string; qty: number }[])
      .filter((u) => u.kind === "RUN")
      .reduce((sum, u) => sum + Number(u.qty || 0), 0);

    const costPerMl = bottlePrice / bottleVol;
    const costPerRun = Math.round(costPerMl * stdRun);
    const runsCurrentBottle = Math.round(runQtyCurrentBottle / stdRun);
    const runsTotal = Math.max(Number(allTimeStats?.run_events || 0), Math.round(Number(allTimeStats?.run_qty || 0) / stdRun));
    const remainingInBottle = Math.max(0, Math.round((bottleVol - usedCurrentBottle) * 100) / 100);
    const depreciatedCurrentVnd = Math.min(bottlePrice, Math.round(usedCurrentBottle * costPerMl));
    const depreciatedTotalVnd = Math.round(Number(allTimeStats?.total_qty || 0) * costPerMl);

    s.used_current_bottle = usedCurrentBottle;
    s.remaining_in_bottle = remainingInBottle;
    s.runs_current_bottle = runsCurrentBottle;
    s.runs_total = runsTotal;
    s.total_used_qty = Number(allTimeStats?.total_qty || 0);
    s.cost_per_ml = Math.round(costPerMl * 100) / 100;
    s.cost_per_run = costPerRun;
    s.depreciated_current_bottle_vnd = depreciatedCurrentVnd;
    s.depreciated_total_vnd = depreciatedTotalVnd;
  }
  const events = (
    await tx.query(
      `SELECT e.slot_no, e.event, e.usage_kind, e.qty_base::float AS qty, e.source_ref, e.notes, e.created_at, l.code AS lot_code, p.display_name AS by_name
         FROM asset.slot_event e LEFT JOIN inv.lot l ON l.id = e.lot_id LEFT JOIN core.user_profile p ON p.user_id = e.created_by
        WHERE e.asset_id = $1 ORDER BY e.created_at DESC LIMIT 100`,
      [assetId]
    )
  ).rows;
  return { asset: a, slots, events };
}
