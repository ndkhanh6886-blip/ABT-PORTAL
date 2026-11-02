import type { Tx } from "./core/db";
import { SYSTEM_ACTOR, type AuthzActor } from "./core/authz";
import { createItem, createLocation, createPartner, createWarehouse } from "./master/service";
import { createStockDocument, postStockDocument } from "./inv/documents";
import { createLot, lotMachine, type Lot } from "./inv/lots";
import { runTransition } from "./core/stateMachine";
import { createOligoOrder, addSequences } from "./oligo/orders";
import { ensureFactoryRolesAndSyncAllUsers } from "./orgSync";
import { advanceDeviceRdGate, createDevicePoOrder, createDeviceRdProject } from "./device/workflow";
import { createQuickRdProject, ensureRdProjectOpsSchema, savePrototypeBom } from "./rd/projectOps";
import { ensureQaOpsSchema, saveQcMethod, saveReferenceStandard, saveRetentionSample } from "./qms/qaOps";
import { ensureWarehouseOpsSchema } from "./inv/warehouseOps";
import { ensureSupplyChainSchema } from "./purchase/supplyChainOps";
import { createInternalOrderManual } from "./intake/orderDispatchOps";
import { createRequest } from "./purchase/requests";

let bootstrapped = false;

/**
 * Idempotently seeds the standard ABT Factory organizational structure, warehouses,
 * column-based Oligo synthesizers, reagent & CPG column stock, Post-Synthesis SOP
 * methods/workflows, ABT Kit BOMs/Routings, and ABT Device Models/DMRs when the live
 * database has not been fully initialized yet.
 */
export async function ensureFactoryBootstrapped(tx: Tx, actor: AuthzActor): Promise<void> {
  if (bootstrapped) return;

  const orgCheck = await tx.query(
    "SELECT id, code, module_key FROM core.org_unit WHERE status = 'ACTIVE' ORDER BY code"
  );
  const hasOligoDept = orgCheck.rows.some((r) => r.module_key === "OLIGO");
  const methodsCount = Number((await tx.query("SELECT count(*)::int AS c FROM oligo.ps_method")).rows[0]?.c ?? 0);
  const synthsCount = Number((await tx.query("SELECT count(*)::int AS c FROM oligo.synthesizer")).rows[0]?.c ?? 0);
  const unmappedRules = Number(
    (await tx.query("SELECT count(*)::int AS c FROM oligo.reagent_rule WHERE item_id IS NULL")).rows[0]?.c ?? 0
  );
  const deviceModelsCount = Number(
    (await tx.query("SELECT count(*)::int AS c FROM device.device_model WHERE code = 'EZ32'")).rows[0]?.c ?? 0
  );
  const kitBomCount = Number((await tx.query("SELECT count(*)::int AS c FROM kit.bom WHERE status = 'EFFECTIVE'")).rows[0]?.c ?? 0);
  const qaWhCount = Number((await tx.query("SELECT count(*)::int AS c FROM master.warehouse WHERE code = 'KHO-QA'")).rows[0]?.c ?? 0);
  const stdRolesCount = Number((await tx.query("SELECT count(*)::int AS c FROM core.role WHERE code IN ('RD_HEAD','KIT_HEAD','OLIGO_HEAD','DEVICE_HEAD')")).rows[0]?.c ?? 0);
  const devRdCount = Number((await tx.query("SELECT count(*)::int AS c FROM rd.project WHERE target_domain = 'DEVICE'")).rows[0]?.c ?? 0);
  const devPoCount = Number(
    (
      await tx.query(
        "SELECT count(*)::int AS c FROM intake.internal_order io JOIN core.org_unit ou ON ou.id = io.org_unit_id WHERE ou.module_key = 'DEVICE'"
      )
    ).rows[0]?.c ?? 0
  );

  await ensureRdProjectOpsSchema(tx);
  await ensureQaOpsSchema(tx);
  await ensureWarehouseOpsSchema(tx);
  await ensureSupplyChainSchema(tx);
  const qaStdCount = Number((await tx.query("SELECT count(*)::int AS c FROM qms.reference_standard")).rows[0]?.c ?? 0);
  const rdKitProjCount = Number((await tx.query("SELECT count(*)::int AS c FROM rd.project WHERE target_domain = 'KIT'")).rows[0]?.c ?? 0);
  const kitOligoOrderCount = Number(
    (
      await tx.query(
        "SELECT count(*)::int AS c FROM intake.internal_order io JOIN core.org_unit ou ON ou.id = io.org_unit_id WHERE ou.module_key IN ('KIT', 'OLIGO')"
      )
    ).rows[0]?.c ?? 0
  );

  const allowDemoSeed = process.env.FACTORY_ALLOW_DEMO_SEED === "1";

  if (
    hasOligoDept &&
    qaWhCount > 0 &&
    stdRolesCount >= 4 &&
    (!allowDemoSeed ||
      (methodsCount > 0 &&
        synthsCount > 0 &&
        unmappedRules === 0 &&
        deviceModelsCount > 0 &&
        kitBomCount > 0 &&
        devRdCount >= 2 &&
        devPoCount >= 2 &&
        qaStdCount >= 3 &&
        rdKitProjCount >= 2 &&
        kitOligoOrderCount >= 2))
  ) {
    bootstrapped = true;
    return;
  }

  const rootActor: AuthzActor = {
    userId: Number(actor.userId) || 1,
    name: actor.name || "Quản Trị Viên Hệ Thống",
    isRootAdmin: true,
    isPortalAdmin: true,
  };

  // 1. Ensure Company & 6 Standard Factory Departments exist
  let companyId = (
    await tx.query("SELECT id FROM core.org_unit WHERE unit_type = 'COMPANY' AND status = 'ACTIVE' LIMIT 1")
  ).rows[0]?.id as string | undefined;

  if (!companyId) {
    const comp = (
      await tx.query(
        `INSERT INTO core.org_unit (code, name, unit_type, status, created_by, updated_by)
         VALUES ('ABT', 'Công ty TNHH Giải pháp Y sinh ABT', 'COMPANY', 'ACTIVE', $1, $1)
         ON CONFLICT (code) DO UPDATE SET status = 'ACTIVE'
         RETURNING id`,
        [rootActor.userId]
      )
    ).rows[0];
    companyId = comp.id;
  }

  const depts: { code: string; name: string; module_key: string }[] = [
    { code: "P-RD", name: "Phòng Nghiên cứu & Phát triển (R&D)", module_key: "RD" },
    { code: "P-KIT", name: "Phòng Sản xuất Kit Chẩn đoán", module_key: "KIT" },
    { code: "P-OLIGO", name: "Phòng Tổng hợp Oligo", module_key: "OLIGO" },
    { code: "P-DEVICE", name: "Phòng Kỹ thuật – Thiết bị", module_key: "DEVICE" },
    { code: "P-QA", name: "Phòng Đảm bảo & Kiểm soát Chất lượng (QA/QC)", module_key: "QA" },
    { code: "P-KHO", name: "Kho Vật tư & Thành phẩm Nhà máy", module_key: "WH" },
  ];

  const deptIdByModule: Record<string, string> = {};
  for (const d of depts) {
    const existing = (
      await tx.query("SELECT id FROM core.org_unit WHERE module_key = $1 AND status = 'ACTIVE' LIMIT 1", [d.module_key])
    ).rows[0];
    if (existing) {
      deptIdByModule[d.module_key] = existing.id;
    } else {
      const ins = (
        await tx.query(
          `INSERT INTO core.org_unit (code, name, unit_type, parent_id, module_key, status, created_by, updated_by)
           VALUES ($1, $2, 'DEPARTMENT', $3, $4, 'ACTIVE', $5, $5)
           ON CONFLICT (code) DO UPDATE SET module_key = EXCLUDED.module_key, status = 'ACTIVE'
           RETURNING id`,
          [d.code, d.name, companyId, d.module_key, rootActor.userId]
        )
      ).rows[0];
      deptIdByModule[d.module_key] = ins.id;
    }
  }

  const oligoUnitId = deptIdByModule["OLIGO"];

  // 1b. Seed Standard Factory Roles, Sample Technical/Legal Personnel & Sync Users <-> Factory Org/Roles
  await ensureFactoryRolesAndSyncAllUsers(tx);

  // 2. Ensure Standard Warehouses & Locations (Quarantine 'BT' + Active Shelf 'A1')
  const whConfigs: { code: string; name: string; module_key: string; purpose: "RAW" | "FINISHED" | "QUARANTINE" | "RD" | "OLIGO" | "DEVICE_PARTS" }[] = [
    { code: "KHO-TONG", name: "Kho Trung Tâm Nhà Máy", module_key: "WH", purpose: "RAW" },
    { code: "KHO-OLIGO", name: "Kho Nhánh Tổng Hợp Oligo", module_key: "OLIGO", purpose: "OLIGO" },
    { code: "KHO-KIT", name: "Kho Nhánh Sản Xuất Kit", module_key: "KIT", purpose: "RAW" },
    { code: "KHO-RD", name: "Kho Nhánh Nghiên Cứu R&D", module_key: "RD", purpose: "RD" },
    { code: "KHO-DEVICE", name: "Kho Nhánh Kỹ Thuật – Thiết Bị", module_key: "DEVICE", purpose: "DEVICE_PARTS" },
    { code: "KHO-QA", name: "Kho Nhánh QA/QC & Mẫu Lưu", module_key: "QA", purpose: "QUARANTINE" },
  ];

  const whMap: Record<string, { whId: string; btId: string; a1Id: string }> = {};
  let oligoWhId = "";
  let oligoQuarantineLocId = "";
  let oligoShelfLocId = "";

  for (const wc of whConfigs) {
    let wh = (await tx.query("SELECT id FROM master.warehouse WHERE code = $1", [wc.code])).rows[0];
    if (!wh) {
      wh = await createWarehouse(tx, rootActor, {
        code: wc.code,
        name: wc.name,
        owner_org_unit_id: deptIdByModule[wc.module_key],
        purpose: wc.purpose,
      });
    }
    let bt = (await tx.query("SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine = true LIMIT 1", [wh.id])).rows[0];
    if (!bt) {
      bt = await createLocation(tx, rootActor, {
        warehouse_id: wh.id,
        code: "BT",
        name: "Khu Biệt trữ Chờ QC",
        is_quarantine: true,
      });
    }
    let a1 = (await tx.query("SELECT id FROM master.location WHERE warehouse_id = $1 AND is_quarantine = false LIMIT 1", [wh.id])).rows[0];
    if (!a1) {
      a1 = await createLocation(tx, rootActor, {
        warehouse_id: wh.id,
        code: "A1",
        name: "Kệ Bảo quản Chính A1",
        is_quarantine: false,
      });
    }
    whMap[wc.code] = { whId: wh.id, btId: bt.id, a1Id: a1.id };
    if (wc.code === "KHO-OLIGO") {
      oligoWhId = wh.id;
      oligoQuarantineLocId = bt.id;
      oligoShelfLocId = a1.id;
    }
  }

  // Gate demo business data seeding behind FACTORY_ALLOW_DEMO_SEED === "1"
  if (!allowDemoSeed) {
    bootstrapped = true;
    return;
  }

  // Helper to ensure an item exists and has a released lot stocked in a target warehouse (defaults to KHO-OLIGO)
  async function ensureItemAndStock(opts: {
    code: string;
    name: string;
    item_type: "RAW_MATERIAL" | "REAGENT" | "CONSUMABLE" | "COMPONENT" | "SEMI_FINISHED" | "FINISHED_KIT" | "DEVICE" | "SPARE_PART";
    base_uom: string;
    lot_code: string;
    qty: number;
    wh_code?: string;
  }): Promise<string> {
    let item = (await tx.query("SELECT id, base_uom FROM master.item WHERE code = $1", [opts.code])).rows[0];
    if (!item) {
      item = await createItem(tx, rootActor, {
        code: opts.code,
        name: opts.name,
        item_type: opts.item_type,
        base_uom: opts.base_uom,
        tracking: "LOT",
        receipt_qc_required: false,
        shelf_life_days: 730,
      });
    }
    const targetWh = whMap[opts.wh_code ?? "KHO-OLIGO"];
    const existingBal = Number(
      (
        await tx.query(
          "SELECT COALESCE(SUM(qty_on_hand), 0)::float AS q FROM inv.stock_balance WHERE item_id = $1",
          [item.id]
        )
      ).rows[0]?.q ?? 0
    );
    if (existingBal <= 0 && opts.qty > 0 && targetWh) {
      const lot = await createLot(tx, rootActor, {
        item_id: item.id,
        origin: "OPENING",
        code: opts.lot_code,
        mfg_date: "2026-01-15",
        expiry_date: "2028-12-31",
      });
      const rec = await createStockDocument(tx, rootActor, {
        doc_type: "RECEIPT",
        reason_code: "OPENING",
        warehouse_id: targetWh.whId,
        lines: [{ item_id: item.id, lot_id: lot.id, to_location_id: targetWh.btId, qty: opts.qty, uom: item.base_uom }],
      });
      await postStockDocument(tx, rootActor, rec.id, rec.version);
      await runTransition<any, Lot>(tx, lotMachine, SYSTEM_ACTOR, {
        id: lot.id,
        action: "skip_qc",
        expectedVersion: lot.version,
      });
      const move = await createStockDocument(tx, rootActor, {
        doc_type: "TRANSFER",
        reason_code: "PUTAWAY",
        warehouse_id: targetWh.whId,
        lines: [
          {
            item_id: item.id,
            lot_id: lot.id,
            from_location_id: targetWh.btId,
            to_location_id: targetWh.a1Id,
            qty: opts.qty,
            uom: item.base_uom,
          },
        ],
      });
      await postStockDocument(tx, rootActor, move.id, move.version);
    }
    return item.id;
  }

  // 3. Ensure CPG Columns (Consumables) and Oligo Synthesis Reagents are created, stocked, and mapped to oligo.reagent_rule
  await ensureItemAndStock({
    code: "CPG-200-COL",
    name: "Cột tổng hợp Oligo CPG 200 nmol (Universal Column)",
    item_type: "CONSUMABLE",
    base_uom: "pcs",
    lot_code: "LOT-CPG200-2601",
    qty: 500,
  });
  await ensureItemAndStock({
    code: "CPG-50-COL",
    name: "Cột tổng hợp Oligo CPG 50 nmol (Universal Column)",
    item_type: "CONSUMABLE",
    base_uom: "pcs",
    lot_code: "LOT-CPG50-2601",
    qty: 500,
  });

  const rules = (await tx.query("SELECT role, name, uom, item_id FROM oligo.reagent_rule ORDER BY role")).rows;
  for (const r of rules) {
    if (!r.item_id) {
      const cleanCode = `OLG-RG-${String(r.role).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
      const itemId = await ensureItemAndStock({
        code: cleanCode,
        name: `Hóa chất tổng hợp Oligo: ${r.name}`,
        item_type: "REAGENT",
        base_uom: r.uom || "mL",
        lot_code: `LOT-${cleanCode}-2601`,
        qty: 5000,
      });
      await tx.query("UPDATE oligo.reagent_rule SET item_id = $2 WHERE role = $1", [r.role, itemId]);
    }
  }

  // 4. Ensure Column-based Oligo Synthesizers exist
  if (synthsCount === 0 && oligoUnitId) {
    const synthConfigs = [
      {
        code: "SYN-COL-08",
        name: "Máy tổng hợp Oligo 8 cột (ABI 394 / MerMade 8-Column)",
        model: "MerMade-8C",
        serial_no: "MM8C-2026-01",
        column_positions: 8,
      },
      {
        code: "SYN-COL-48",
        name: "Máy tổng hợp Oligo 48 cột (Dr. Oligo 48-Column)",
        model: "DrOligo-48C",
        serial_no: "DRO48-2026-02",
        column_positions: 48,
      },
    ];
    for (const sc of synthConfigs) {
      const a = (
        await tx.query(
          `INSERT INTO asset.asset
             (code, name, asset_type, owner_org_unit_id, manufacturer, model, serial_no, status, next_calibration_due, created_by, updated_by)
           VALUES ($1, $2, 'SYNTHESIZER', $3, 'Biolytic / ABI', $4, $5, 'IN_SERVICE', '2028-12-31', $6, $6)
           ON CONFLICT (code) DO UPDATE SET status = 'IN_SERVICE'
           RETURNING id`,
          [sc.code, sc.name, oligoUnitId, sc.model, sc.serial_no, rootActor.userId]
        )
      ).rows[0];
      await tx.query(
        `INSERT INTO oligo.synthesizer (asset_id, column_positions, supported_scales)
         VALUES ($1, $2, $3)
         ON CONFLICT (asset_id) DO NOTHING`,
        [a.id, sc.column_positions, []]
      );
    }
  }

  // 5. Ensure Standard Post-Synthesis Step Methods & SOP Workflows exist
  if (methodsCount === 0) {
    const defaultMethods: {
      category: string;
      name: string;
      kind: "STANDARD" | "QUANTIFICATION";
      target_hours: number;
      fields: any[];
    }[] = [
      {
        category: "Cắt & khử bảo vệ",
        name: "Ủ Amoniac đặc 55°C (Cleavage & Deprotection)",
        kind: "STANDARD",
        target_hours: 4,
        fields: [
          { key: "temp_c", label: "Nhiệt độ ủ", type: "NUMBER", unit: "°C", required: true },
          { key: "duration_min", label: "Thời gian ủ", type: "NUMBER", unit: "phút", required: true },
        ],
      },
      {
        category: "Khử muối",
        name: "Lọc cột khử muối Sephadex G-25 (Desalt)",
        kind: "STANDARD",
        target_hours: 1,
        fields: [
          { key: "elution_vol_ul", label: "Thể tích thu hồi", type: "NUMBER", unit: "µL", required: true },
        ],
      },
      {
        category: "Tinh sạch",
        name: "Tinh sạch cột đảo pha OPC (Cartridge)",
        kind: "STANDARD",
        target_hours: 1.5,
        fields: [
          { key: "cartridge_lot", label: "Mã lô cột OPC", type: "TEXT", required: true },
          { key: "elution_vol_ul", label: "Thể tích rửa giải", type: "NUMBER", unit: "µL", required: true },
        ],
      },
      {
        category: "Tinh sạch",
        name: "Sắc ký lỏng hiệu năng cao RP-HPLC",
        kind: "STANDARD",
        target_hours: 3,
        fields: [
          { key: "retention_time_min", label: "Thời gian lưu (Rt)", type: "NUMBER", unit: "phút", required: true },
          { key: "purity_pct", label: "Độ tinh khiết sắc ký (%Area)", type: "NUMBER", unit: "%", required: true },
        ],
      },
      {
        category: "Tinh sạch",
        name: "Điện di gel Polyacrylamide điều chế (PAGE)",
        kind: "STANDARD",
        target_hours: 5,
        fields: [
          { key: "gel_pct", label: "Nồng độ gel Acrylamide", type: "NUMBER", unit: "%", required: true },
          { key: "band_note", label: "Ghi chú cắt băng & thu hồi", type: "TEXT", required: true },
        ],
      },
      {
        category: "Đo OD",
        name: "Đo mật độ quang UV 260nm (NanoDrop / Định lượng)",
        kind: "QUANTIFICATION",
        target_hours: 0.5,
        fields: [
          { key: "od260_total", label: "Tổng OD260 thu được", type: "NUMBER", unit: "OD", required: true },
          { key: "a260_a280", label: "Tỷ lệ A260/A280", type: "NUMBER", unit: "", required: false },
        ],
      },
      {
        category: "Làm khô / đông khô",
        name: "Cô quay chân không SpeedVac / Đông khô thành phẩm",
        kind: "STANDARD",
        target_hours: 2,
        fields: [
          { key: "vacuum_time_min", label: "Thời gian sấy khô", type: "NUMBER", unit: "phút", required: true },
        ],
      },
    ];

    const insertedIds: Record<string, string> = {};
    for (const m of defaultMethods) {
      const row = (
        await tx.query(
          `INSERT INTO oligo.ps_method (category, name, kind, target_hours, fields, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $6) RETURNING id`,
          [m.category, m.name, m.kind, m.target_hours, JSON.stringify(m.fields), rootActor.userId]
        )
      ).rows[0];
      insertedIds[m.name] = row.id;
    }

    const cleaveId = insertedIds["Ủ Amoniac đặc 55°C (Cleavage & Deprotection)"];
    const desaltId = insertedIds["Lọc cột khử muối Sephadex G-25 (Desalt)"];
    const opcId = insertedIds["Tinh sạch cột đảo pha OPC (Cartridge)"];
    const hplcId = insertedIds["Sắc ký lỏng hiệu năng cao RP-HPLC"];
    const pageId = insertedIds["Điện di gel Polyacrylamide điều chế (PAGE)"];
    const odId = insertedIds["Đo mật độ quang UV 260nm (NanoDrop / Định lượng)"];
    const dryId = insertedIds["Cô quay chân không SpeedVac / Đông khô thành phẩm"];

    const defaultWorkflows = [
      {
        name: "Quy trình SOP Hậu tổng hợp — Tinh sạch Khử muối (Desalt)",
        description: "Quy trình chuẩn cho Primer thông thường: Cắt cột Amoniac → Lọc cột Desalt → Đo OD260 → Đông khô",
        purifications: ["DESALT"],
        steps: [
          { method_id: cleaveId, name: "Cắt cột CPG & Khử bảo vệ" },
          { method_id: desaltId, name: "Khử muối Sephadex G-25" },
          { method_id: odId, name: "Đo OD260 & Định lượng" },
          { method_id: dryId, name: "Đông khô ống thành phẩm" },
        ],
      },
      {
        name: "Quy trình SOP Hậu tổng hợp — Tinh sạch Cột OPC",
        description: "Quy trình tinh sạch cột đảo pha OPC cho Primer dài / độ tinh khiết cao",
        purifications: ["OPC"],
        steps: [
          { method_id: cleaveId, name: "Cắt cột CPG & Khử bảo vệ" },
          { method_id: opcId, name: "Tinh sạch cột đảo pha OPC" },
          { method_id: odId, name: "Đo OD260 & Định lượng" },
          { method_id: dryId, name: "Đông khô ống thành phẩm" },
        ],
      },
      {
        name: "Quy trình SOP Hậu tổng hợp — Tinh sạch Sắc ký RP-HPLC",
        description: "Quy trình bắt buộc cho Probe huỳnh quang (FAM/HEX/Cy5) & Oligo biến đổi",
        purifications: ["HPLC"],
        steps: [
          { method_id: cleaveId, name: "Cắt cột CPG & Khử bảo vệ nhẹ" },
          { method_id: hplcId, name: "Chạy sắc ký RP-HPLC & Thu phân đoạn" },
          { method_id: desaltId, name: "Khử muối sau HPLC" },
          { method_id: odId, name: "Đo OD260 & Định lượng" },
          { method_id: dryId, name: "Đông khô ống thành phẩm" },
        ],
      },
      {
        name: "Quy trình SOP Hậu tổng hợp — Tinh sạch Điện di PAGE",
        description: "Quy trình tinh sạch độ phân giải cao cho chuỗi Oligo dài (> 60 base)",
        purifications: ["PAGE"],
        steps: [
          { method_id: cleaveId, name: "Cắt cột CPG & Khử bảo vệ" },
          { method_id: pageId, name: "Điện di PAGE & Thu hồi băng" },
          { method_id: desaltId, name: "Khử muối dịch chiết gel" },
          { method_id: odId, name: "Đo OD260 & Định lượng" },
          { method_id: dryId, name: "Đông khô ống thành phẩm" },
        ],
      },
    ];

    for (const wf of defaultWorkflows) {
      await tx.query(
        `INSERT INTO oligo.ps_workflow (name, description, purifications, steps, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $5)`,
        [wf.name, wf.description, wf.purifications, JSON.stringify(wf.steps), rootActor.userId]
      );
    }
  }

  // 6. Ensure at least 1 Sample Oligo Order with PENDING sequences exists so "Mẻ tổng hợp" has ready-to-batch sequences
  const orderCount = Number((await tx.query("SELECT count(*)::int AS c FROM oligo.oligo_order")).rows[0]?.c ?? 0);
  if (orderCount === 0 && oligoUnitId) {
    const scales = (await tx.query("SELECT code FROM oligo.scale WHERE status = 'ACTIVE' ORDER BY sort_order LIMIT 1")).rows;
    const defaultScale = scales[0]?.code ?? "200NMOL";
    const sampleOrder = await createOligoOrder(tx, rootActor, {
      org_unit_id: oligoUnitId,
      customer_label: "Đơn sản xuất nội bộ — Bộ Primer & Probe Real-time PCR HBV",
      notes: "Đơn mẫu khởi tạo sẵn để lập mẻ tổng hợp trên cột CPG",
    });
    await addSequences(tx, rootActor, sampleOrder.id, {
      text: [
        "HBV-Primer-F; GTGTCTGCGGCGTTTTATCA",
        "HBV-Primer-R; GACAAACGGGCAACATACCTT",
        "HBV-TaqMan-Probe; /FAM/CCTCTKCATCCTGCTGCTATGCCTCATC/BHQ1/; ; HPLC",
      ].join("\n"),
      defaults: {
        scale_code: defaultScale,
        purification: "DESALT",
        format: "LYOPHILIZED",
        target_pathogen: "HBV",
      },
    });
  }

  // 7. Seed ABT Kit Production Master Data (BOMs, Routings & Released Stock in KHO-KIT)
  const kitUnitId = deptIdByModule["KIT"];
  if (kitBomCount === 0 && kitUnitId) {
    const mmixId = await ensureItemAndStock({
      code: "RM-MMIX-2X",
      name: "qPCR MasterMix 2X (Taq HotStart + dNTPs + Buffer)",
      item_type: "REAGENT",
      base_uom: "mL",
      lot_code: "LOT-MMIX-2601",
      qty: 5000,
      wh_code: "KHO-KIT",
    });
    const primerMixId = await ensureItemAndStock({
      code: "RM-PRIMER-HBV",
      name: "Hỗn hợp Primer/Probe HBV đặc hiệu (FAM/HEX)",
      item_type: "REAGENT",
      base_uom: "mL",
      lot_code: "LOT-PRHBV-2601",
      qty: 2000,
      wh_code: "KHO-KIT",
    });
    const icId = await ensureItemAndStock({
      code: "RM-IC-DNA",
      name: "Chứng nội tổng hợp (Internal Control DNA)",
      item_type: "REAGENT",
      base_uom: "mL",
      lot_code: "LOT-ICDNA-2601",
      qty: 2000,
      wh_code: "KHO-KIT",
    });
    const tube15Id = await ensureItemAndStock({
      code: "PK-TUBE-15ML",
      name: "Ống Microtube 1.5mL nắp vặn vô trùng",
      item_type: "CONSUMABLE",
      base_uom: "pcs",
      lot_code: "LOT-TUBE15-2601",
      qty: 10000,
      wh_code: "KHO-KIT",
    });
    const strip8Id = await ensureItemAndStock({
      code: "PK-STRIP-8",
      name: "Dãy ống quang học 8-strip 0.2mL chia sẵn (.D.IC)",
      item_type: "CONSUMABLE",
      base_uom: "pcs",
      lot_code: "LOT-STRIP8-2601",
      qty: 10000,
      wh_code: "KHO-KIT",
    });
    const box50Id = await ensureItemAndStock({
      code: "PK-BOX-50T",
      name: "Vỏ hộp Kit ABT 50 test + Đế xốp lạnh + Tem HDSD",
      item_type: "CONSUMABLE",
      base_uom: "pcs",
      lot_code: "LOT-BOX50-2601",
      qty: 2000,
      wh_code: "KHO-KIT",
    });
    const kitHbvId = await ensureItemAndStock({
      code: "KIT-HBV-50T.D.IC",
      name: "TopSENSI® HBV Real-time PCR Kit (50 test / Hỗ trợ chia sẵn .D.IC)",
      item_type: "FINISHED_KIT",
      base_uom: "kit",
      lot_code: "LOT-HBVKIT-INIT",
      qty: 0,
      wh_code: "KHO-KIT",
    });

    const bom = (
      await tx.query(
        `INSERT INTO kit.bom (code, org_unit_id, product_item_id, bom_version, name, base_qty, base_uom, tests_per_kit, shelf_life_days, status, approved_by, approved_at, created_by, updated_by)
         VALUES ('BOM-HBV-50T-V1', $1, $2, 1, 'BOM chuẩn TopSENSI HBV qPCR Kit (50 test / .D.IC / Demo)', 1, 'KIT', 50, 365, 'EFFECTIVE', $3, now(), $3, $3)
         ON CONFLICT (code) DO UPDATE SET status = 'EFFECTIVE'
         RETURNING id`,
        [kitUnitId, kitHbvId, rootActor.userId]
      )
    ).rows[0];

    const existingBomLines = await tx.query("SELECT 1 FROM kit.bom_line WHERE bom_id = $1 LIMIT 1", [bom.id]);
    if (!existingBomLines.rowCount) {
      const lines = [
        { no: 1, item: mmixId, role: "MASTER_MIX", qty: 1.0, aliq: 1.1, uom: "mL", scrap: 5, mix: true, demoFixed: false, qcRet: true, note: "MasterMix 2X (20 µL/test × 50 test)" },
        { no: 2, item: primerMixId, role: "PRIMER_PROBE", qty: 0.25, aliq: 0.28, uom: "mL", scrap: 5, mix: true, demoFixed: false, qcRet: true, note: "Oligo Mix HBV (5 µL/test × 50 test)" },
        { no: 3, item: icId, role: "POSITIVE_CONTROL", qty: 0.5, aliq: 0.55, uom: "mL", scrap: 2, mix: false, demoFixed: true, qcRet: true, note: "Ống Chứng nội IC đi kèm" },
        { no: 4, item: tube15Id, role: "PACKAGING", qty: 4, aliq: 2, uom: "pcs", scrap: 0, mix: false, demoFixed: true, qcRet: true, note: "Ống chứa hóa chất" },
        { no: 5, item: strip8Id, role: "PACKAGING", qty: 0.01, aliq: 7, uom: "pcs", scrap: 0, mix: false, demoFixed: false, qcRet: true, note: "Dãy ống 8-strip khi chạy chế độ Chia sẵn (.D.IC)" },
        { no: 6, item: box50Id, role: "PACKAGING", qty: 1, aliq: 1, uom: "pcs", scrap: 0, mix: false, demoFixed: true, qcRet: false, note: "Vỏ hộp ngoài (không tính vào mẫu lưu QC)" },
      ];
      for (const l of lines) {
        await tx.query(
          `INSERT INTO kit.bom_line
             (bom_id, line_no, component_item_id, component_role, qty_per_base, qty_per_base_aliquoted, uom, scrap_pct,
              is_mix_component, is_demo_fixed_component, include_in_qc_retention, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [bom.id, l.no, l.item, l.role, l.qty, l.aliq, l.uom, l.scrap, l.mix, l.demoFixed, l.qcRet, l.note]
        );
      }
      await tx.query(
        `INSERT INTO kit.kit_packaging (bom_id, box_no, box_name, component_name, container_type, fill_qty, fill_uom, units_per_kit, storage_temp)
         VALUES
           ($1, 1, 'Hộp 1 — Hóa chất qPCR', 'qPCR MasterMix 2X', 'TUBE_1_5ML', 1000, 'µL', 1, '-20°C'),
           ($1, 1, 'Hộp 1 — Hóa chất qPCR', 'HBV Primer/Probe Mix', 'TUBE_1_5ML', 250, 'µL', 1, '-20°C'),
           ($1, 1, 'Hộp 1 — Hóa chất qPCR', 'Internal Control (IC)', 'TUBE_1_5ML', 500, 'µL', 1, '-20°C')`,
        [bom.id]
      );
    }

    const routing = (
      await tx.query(
        `INSERT INTO kit.routing (code, org_unit_id, product_item_id, routing_version, name, status, approved_by, approved_at, created_by, updated_by)
         VALUES ('RT-HBV-50T-V1', $1, $2, 1, 'Quy trình SOP Pha chế, Đo pH & Đóng gói Kit qPCR', 'EFFECTIVE', $3, now(), $3, $3)
         ON CONFLICT (code) DO UPDATE SET status = 'EFFECTIVE'
         RETURNING id`,
        [kitUnitId, kitHbvId, rootActor.userId]
      )
    ).rows[0];

    const existingSteps = await tx.query("SELECT 1 FROM kit.routing_step WHERE routing_id = $1 LIMIT 1", [routing.id]);
    if (!existingSteps.rowCount) {
      await tx.query(
        `INSERT INTO kit.routing_step (routing_id, seq, step_code, step_name, category, instructions, param_schema, is_qc, requires_check_signature)
         VALUES
           ($1, 1, 'STEP-MIX-PH', 'Pha chế MasterMix trong tủ An toàn sinh học & Đo pH', 'FORMULATION',
            'Pha trộn MasterMix 2X và Oligo Mix trên đá lạnh (2–8°C), kiểm tra pH dung dịch đệm.',
            $2::jsonb, true, true),
           ($1, 2, 'STEP-ALIQUOT-PACK', 'Chia lẻ Aliquot, Dán nhãn ống & Đóng hộp thành phẩm', 'PACKAGING',
            'Chia lẻ theo chế độ lệnh (Thường / Chia sẵn .D.IC / Kit Demo), dán nhãn ống và đóng hộp ngoài.',
            $3::jsonb, false, false)`,
        [
          routing.id,
          JSON.stringify([
            { key: "actual_ph", label: "Giá trị pH thực tế đo được", type: "number", unit: "pH", min: 8.1, max: 8.5, required: true },
            { key: "temp_c", label: "Nhiệt độ block lạnh khi pha", type: "number", unit: "°C", min: 2, max: 8, required: true },
          ]),
          JSON.stringify([
            { key: "fill_vol_ul", label: "Thể tích chiết rót mỗi ống", type: "number", unit: "µL", min: 18, max: 1100, required: true },
          ]),
        ]
      );
    }
  }

  // 8. Seed ABT Device Engineering Master Data (Models EZ32, SC01, MHS01, HIDI01, HBL01 + Released DMRs + Subcontract + Stock in KHO-DEVICE)
  const devUnitId = deptIdByModule["DEVICE"];
  if (deviceModelsCount === 0 && devUnitId) {
    const pcbMainId = await ensureItemAndStock({
      code: "PRT-PCB-MAIN-EZ32",
      name: "Bo mạch điều khiển trung tâm ARM Cortex-M7 + Driver động cơ bước",
      item_type: "COMPONENT",
      base_uom: "pcs",
      lot_code: "LOT-PCB-EZ32-2601",
      qty: 50,
      wh_code: "KHO-DEVICE",
    });
    const frameCncId = await ensureItemAndStock({
      code: "PRT-CNC-FRAME-EZ32",
      name: "Khung cơ khí nhôm hợp kim 6061-T6 Anodize máy tách chiết 32 mẫu",
      item_type: "COMPONENT",
      base_uom: "pcs",
      lot_code: "LOT-CNC-EZ32-2601",
      qty: 50,
      wh_code: "KHO-DEVICE",
    });
    const magHeadId = await ensureItemAndStock({
      code: "PRT-MAG-32ROD",
      name: "Cụm 32 thanh từ tính NdFeB cường độ cao + Gia nhiệt 2 độc lập",
      item_type: "COMPONENT",
      base_uom: "pcs",
      lot_code: "LOT-MAG32-2601",
      qty: 50,
      wh_code: "KHO-DEVICE",
    });
    const lcdTouchId = await ensureItemAndStock({
      code: "PRT-LCD-7INCH",
      name: "Màn hình cảm ứng điện dung công nghiệp 7 inch IPS",
      item_type: "COMPONENT",
      base_uom: "pcs",
      lot_code: "LOT-LCD7-2601",
      qty: 50,
      wh_code: "KHO-DEVICE",
    });

    const abtModels: {
      code: string;
      name: string;
      category: string;
      burn_in: number;
      warranty: number;
      fw: string;
      accessories: string[];
      specs: Record<string, string>;
    }[] = [
      {
        code: "EZ32",
        name: "Máy tách chiết DNA/RNA tự động 32 mẫu ABT (BioExtract EZ32)",
        category: "EXTRACTOR",
        burn_in: 48,
        warranty: 24,
        fw: "v2.4.0-EZ32",
        accessories: [
          "01 Dây nguồn AC 220V chuẩn C13",
          "02 Giá đỡ đĩa Deep-well 96 giếng",
          "02 Túi thanh bọc từ (8-strip tip comb)",
          "01 Sách HDSD Tiếng Việt & Biên bản hiệu chuẩn xuất xưởng",
        ],
        specs: { throughput: "1–32 mẫu/mẻ", heating: "Lysis 90°C / Elution 90°C", uv_lamp: "Đèn UV khử nhiễm 254nm" },
      },
      {
        code: "SC01",
        name: "Hệ thống tách chiết cột lọc ly tâm ABT (Spin Column System SC01)",
        category: "SPIN_COLUMN_SYSTEM",
        burn_in: 24,
        warranty: 12,
        fw: "v1.2.0-SC01",
        accessories: ["01 Dây nguồn AC", "01 Rotor cột lọc 24 vị trí", "01 HDSD Tiếng Việt"],
        specs: { capacity: "24 cột lọc", max_rpm: "14,000 RPM" },
      },
      {
        code: "MHS01",
        name: "Máy lắc nhiệt ủ mẫu vi sinh ABT (ThermoShaker MHS01)",
        category: "INCUBATOR",
        burn_in: 24,
        warranty: 12,
        fw: "v1.5.1-MHS",
        accessories: ["01 Block nhôm 24×1.5mL", "01 Dây nguồn AC", "01 Biên bản hiệu chuẩn nhiệt độ"],
        specs: { temp_range: "RT+5°C đến 100°C", orbit: "2mm, 300–1500 RPM" },
      },
      {
        code: "HIDI01",
        name: "Máy đọc quang học & phát hiện tín hiệu huỳnh quang ABT (HIDI01)",
        category: "SPECTROPHOTOMETER",
        burn_in: 48,
        warranty: 24,
        fw: "v3.0.2-HIDI",
        accessories: ["01 Cáp kết nối USB-C chống nhiễu", "01 Bộ nguồn DC 24V", "01 Đĩa chuẩn quang học FQC"],
        specs: { channels: "4 kênh huỳnh quang (FAM/HEX/ROX/Cy5)", precision: "CV < 1.5%" },
      },
      {
        code: "HBL01",
        name: "Bể ổn nhiệt khô phòng thí nghiệm ABT (Dry Bath Incubator HBL01)",
        category: "INCUBATOR",
        burn_in: 12,
        warranty: 12,
        fw: "v1.1.0-HBL",
        accessories: ["01 Block nhôm 48×0.2mL / 24×1.5mL", "01 Dụng cụ nhấc block", "01 Dây nguồn AC"],
        specs: { temp_accuracy: "±0.2°C", max_temp: "105°C" },
      },
    ];

    for (const mCfg of abtModels) {
      let model = (await tx.query("SELECT id FROM device.device_model WHERE code = $1", [mCfg.code])).rows[0];
      if (!model) {
        model = (
          await tx.query(
            `INSERT INTO device.device_model
               (code, name, org_unit_id, category, warranty_months, required_burn_in_hours,
                specs_json, accessories_standard, status, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'COMMERCIAL', $9, $9)
             RETURNING id`,
            [
              mCfg.code,
              mCfg.name,
              devUnitId,
              mCfg.category,
              mCfg.warranty,
              mCfg.burn_in,
              JSON.stringify(mCfg.specs),
              JSON.stringify(mCfg.accessories),
              rootActor.userId,
            ]
          )
        ).rows[0];
      }

      let rev = (
        await tx.query("SELECT id FROM device.model_revision WHERE model_id = $1 AND revision = 'A'", [model.id])
      ).rows[0];
      if (!rev) {
        rev = (
          await tx.query(
            `INSERT INTO device.model_revision
               (model_id, revision, firmware_version, dmr_summary, effectivity_type, released_by, released_at, status, created_by, updated_by)
             VALUES ($1, 'A', $2, $3, 'IMMEDIATE', $4, now(), 'RELEASED', $4, $4)
             RETURNING id`,
            [
              model.id,
              mCfg.fw,
              `Hồ sơ thiết kế gốc DMR ${mCfg.code} Rev A (Bản vẽ cơ khí CNC, sơ đồ PCB, Firmware ${mCfg.fw} & Quy trình FQC)`,
              rootActor.userId,
            ]
          )
        ).rows[0];

        await tx.query("UPDATE device.device_model SET current_revision_id = $2 WHERE id = $1", [model.id, rev.id]);

        const bomRows = [
          { no: 1, st: "STATION_1_MECH", item: frameCncId, qty: 1, src: "SUBCONTRACT", trk: "LOT", reqSn: false, drw: `DRW-${mCfg.code}-MECH-01` },
          { no: 2, st: "STATION_1_MECH", item: magHeadId, qty: 1, src: "SUBCONTRACT", trk: "SERIAL", reqSn: true, drw: `DRW-${mCfg.code}-HEAD-02` },
          { no: 3, st: "STATION_2_PCB", item: pcbMainId, qty: 1, src: "BUY", trk: "SERIAL", reqSn: true, drw: `SCH-${mCfg.code}-PCB-01` },
          { no: 4, st: "STATION_3_FW", item: lcdTouchId, qty: 1, src: "BUY", trk: "LOT", reqSn: false, drw: `DRW-${mCfg.code}-HMI-01` },
        ];
        for (const b of bomRows) {
          await tx.query(
            `INSERT INTO device.model_bom_line
               (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom,
                source_type, is_critical, requires_serial, tracking_type, drawing_code, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, 'pcs', $6, true, $7, $8, $9, $10, $10)`,
            [rev.id, b.no, b.st, b.item, b.qty, b.src, b.reqSn, b.trk, b.drw, rootActor.userId]
          );
        }
      }
    }

    // Ensure at least 1 Subcontract Vendor & Subcontract Part exist
    let vendor = (await tx.query("SELECT id FROM master.partner WHERE code = 'NCC-CNC-01'")).rows[0];
    if (!vendor) {
      vendor = await createPartner(tx, rootActor, {
        code: "NCC-CNC-01",
        name: "Công ty Cơ khí Chính xác & Mạch in CNC Việt Nam",
        is_supplier: true,
        is_subcontractor: true,
      });
    }
    const subPartsCount = Number((await tx.query("SELECT count(*)::int AS c FROM device.subcontract_part")).rows[0]?.c ?? 0);
    if (subPartsCount === 0 && vendor) {
      await tx.query(
        `INSERT INTO device.subcontract_part
           (code, name, org_unit_id, item_id, vendor_id, material, process_type, tolerance_standard, drawing_ref, created_by, updated_by)
         VALUES ('SCP-EZ32-FRAME', 'Khung cơ khí nhôm Anodize máy EZ32', $1, $2, $3, 'Nhôm hợp kim 6061-T6 Anodize đen', 'CNC', 'ISO 2768-mK (±0.02mm)', 'DRW-EZ32-MECH-01', $4, $4)
         ON CONFLICT (code) DO NOTHING`,
        [devUnitId, frameCncId, vendor.id, rootActor.userId]
      );
    }
  }

  // 9. Seed Device R&D Projects (5-Gate Pipeline) & Device POs with BOM Shortage MRP if not present
  if (devUnitId && (devRdCount < 2 || devPoCount < 2)) {
    // Ensure 2 BOM items with low stock (qty = 2) on EZ32 so a 5-unit PO immediately demonstrates BUY & SUBCONTRACT shortage
    const psu24vId = await ensureItemAndStock({
      code: "PRT-PSU-24V-EZ32",
      name: "Bộ nguồn công nghiệp y tế MeanWell 24V-350W chống nhiễu",
      item_type: "COMPONENT",
      base_uom: "pcs",
      lot_code: "LOT-PSU24-2601",
      qty: 2,
      wh_code: "KHO-DEVICE",
    });
    const sheetCoverId = await ensureItemAndStock({
      code: "PRT-SHEET-COVER-EZ32",
      name: "Vỏ máy kim loại tấm chấn CNC sơn tĩnh điện & Cửa chắn UV EZ32",
      item_type: "COMPONENT",
      base_uom: "pcs",
      lot_code: "LOT-COVER-EZ32-2601",
      qty: 2,
      wh_code: "KHO-DEVICE",
    });
    await tx.query("UPDATE master.item SET is_purchasable = true WHERE id IN ($1, $2)", [psu24vId, sheetCoverId]);

    const ez32Model = (await tx.query("SELECT id, current_revision_id FROM device.device_model WHERE code = 'EZ32'")).rows[0];
    if (ez32Model?.current_revision_id) {
      const hasPsuLine = await tx.query(
        "SELECT 1 FROM device.model_bom_line WHERE revision_id = $1 AND component_item_id = $2",
        [ez32Model.current_revision_id, psu24vId]
      );
      if (!hasPsuLine.rowCount) {
        const maxLine = Number(
          (await tx.query("SELECT coalesce(max(line_no), 0) AS m FROM device.model_bom_line WHERE revision_id = $1", [ez32Model.current_revision_id])).rows[0]?.m ?? 4
        );
        await tx.query(
          `INSERT INTO device.model_bom_line
             (revision_id, line_no, station_code, component_item_id, qty_per_unit, uom, source_type, is_critical, requires_serial, tracking_type, drawing_code, created_by, updated_by)
           VALUES
             ($1, $2, 'STATION_2_PCB', $3, 1, 'pcs', 'BUY', true, false, 'LOT', 'SCH-EZ32-PSU-02', $5, $5),
             ($1, $4, 'STATION_1_MECH', $6, 1, 'pcs', 'SUBCONTRACT', true, false, 'LOT', 'DRW-EZ32-COV-03', $5, $5)`,
          [ez32Model.current_revision_id, maxLine + 1, psu24vId, maxLine + 2, rootActor.userId, sheetCoverId]
        );
      }
    }

    if (devRdCount < 2) {
      // Project 1: New Device R&D (at Gate 3: Prototype & DVP)
      const q96Exists = await tx.query("SELECT 1 FROM device.device_model WHERE code = 'Q96'");
      if (!q96Exists.rowCount) {
        const p1 = await createDeviceRdProject(tx, rootActor, {
          project_type: "NEW_PRODUCT",
          model_code: "Q96",
          model_name: "Máy Real-Time PCR 96 giếng 6 kênh màu ABT (BioCycler Q96)",
          category: "THERMAL_CYCLER",
          target_revision: "A",
          firmware_version: "v1.0.0-Q96",
          warranty_months: 24,
          required_burn_in_hours: 48,
          planned_end: "2026-12-31",
          description: "Nghiên cứu thiết kế & chế tạo máy Real-Time qPCR 96 giếng Peltier Marlow tốc độ gia nhiệt 6.0°C/s.",
          specs: [
            { parameter: "Tốc độ gia nhiệt cực đại (Ramp Rate)", unit: "°C/s", baseline_value: "N/A (Máy mới)", target_value: "≥ 6.0 °C/s", actual_value: "6.2 °C/s", method_ref: "Đo kiểm DVP Peltier" },
            { parameter: "Độ đồng đều nhiệt độ 96 giếng", unit: "°C", baseline_value: "N/A (Máy mới)", target_value: "±0.15 °C", actual_value: "±0.12 °C", method_ref: "Đầu dò chuẩn Fluke 96 kênh" },
            { parameter: "Số kênh huỳnh quang quang học", unit: "kênh", baseline_value: "N/A (Máy mới)", target_value: "6 kênh (FAM/HEX/ROX/Cy5/Cy5.5/ATTO425)", actual_value: "6 kênh (CV < 1.2%)", method_ref: "Đĩa chuẩn quang học ABT" },
          ],
        });
        await advanceDeviceRdGate(tx, rootActor, p1.project_id, { gate_no: 1 });
        await advanceDeviceRdGate(tx, rootActor, p1.project_id, { gate_no: 2 });
      }

      // Project 2: Improvement on existing EZ32 (at Gate 4: Pilot IEC 61010, ready for Gate 5 Transfer)
      if (ez32Model) {
        const revBExists = await tx.query(
          "SELECT 1 FROM device.model_revision WHERE model_id = $1 AND revision = 'B'",
          [ez32Model.id]
        );
        if (!revBExists.rowCount) {
          const p2 = await createDeviceRdProject(tx, rootActor, {
            project_type: "IMPROVEMENT",
            base_model_id: ez32Model.id,
            model_name: "Nâng cấp gia nhiệt kép PID độc lập & Đèn khử nhiễm UV-C LED 275nm",
            category: "EXTRACTOR",
            target_revision: "B",
            firmware_version: "v2.5.0-EZ32",
            warranty_months: 24,
            required_burn_in_hours: 48,
            planned_end: "2026-11-30",
            description: "Cải tiến máy tách chiết EZ32 từ Rev A lên Rev B: rút ngắn thời gian tách chiết từ 25 phút xuống 16 phút.",
            specs: [
              { parameter: "Thời gian hoàn thành mẻ tách chiết 32 mẫu", unit: "phút", baseline_value: "25 phút (Rev A)", target_value: "≤ 18 phút (Rev B)", actual_value: "16 phút", method_ref: "Thử nghiệm thực tế với Kit tách chiết ABT" },
              { parameter: "Độ chính xác nhiệt độ Lysis / Elution", unit: "°C", baseline_value: "±0.5 °C (Rev A)", target_value: "±0.2 °C (PID kép)", actual_value: "±0.15 °C", method_ref: "Đầu dò nhiệt chuẩn Fluke" },
              { parameter: "Tuổi thọ cụm đèn khử nhiễm UV", unit: "giờ", baseline_value: "2,000 giờ (Bóng thủy ngân 254nm)", target_value: "≥ 10,000 giờ (UV-C LED 275nm)", actual_value: "12,000 giờ", method_ref: "Datasheet & Đo bức xạ UV-C" },
            ],
          });
          await advanceDeviceRdGate(tx, rootActor, p2.project_id, { gate_no: 1 });
          await advanceDeviceRdGate(tx, rootActor, p2.project_id, { gate_no: 2 });
          await advanceDeviceRdGate(tx, rootActor, p2.project_id, { gate_no: 3 });
        }
      }
    }

    if (devPoCount < 2) {
      const hblModel = (await tx.query("SELECT id FROM device.device_model WHERE code = 'HBL01'")).rows[0];
      if (ez32Model) {
        const po1Exists = await tx.query("SELECT 1 FROM intake.internal_order WHERE kd_po_code = 'PO-KD-DEV-2601'");
        if (!po1Exists.rowCount) {
          await createDevicePoOrder(tx, rootActor, {
            kd_po_code: "PO-KD-DEV-2601",
            customer_name: "Bệnh viện Đa khoa Trung ương & TT Xét nghiệm Y sinh",
            ship_mode: "TO_KD",
            requested_date: "2026-11-15",
            notes: "Đơn đặt 05 máy tách chiết tự động EZ32 (Phân tích MRP phát hiện thiếu 03 bộ Nguồn 24V & 03 Vỏ máy CNC)",
            model_id: ez32Model.id,
            qty: 5,
            unit_price: 68000000,
          });
        }
      }
      if (hblModel) {
        const po2Exists = await tx.query("SELECT 1 FROM intake.internal_order WHERE kd_po_code = 'PO-KD-DEV-2602'");
        if (!po2Exists.rowCount) {
          await createDevicePoOrder(tx, rootActor, {
            kd_po_code: "PO-KD-DEV-2602",
            customer_name: "Trung tâm Kiểm soát Bệnh tật (CDC) — Khoa Xét nghiệm",
            ship_mode: "TO_KD",
            requested_date: "2026-11-10",
            notes: "Đơn đặt 02 bể ổn nhiệt khô HBL01 (Đủ 100% linh kiện tồn kho, sẵn sàng chuyển sang Lệnh lắp ráp WO)",
            model_id: hblModel.id,
            qty: 2,
            unit_price: 12500000,
          });
        }
      }
    }
  }

  // 10. Seed R&D Projects (New IVD Kit & Product Improvement) with WBS, Material Ledger & Prototype BOM
  if (rdKitProjCount < 2) {
    const rdTaqId = await ensureItemAndStock({
      code: "RD-ENZ-TAQ-HS",
      name: "Enzyme Taq DNA Polymerase HotStart tái tổ hợp nồng độ cao (5 U/µL)",
      item_type: "REAGENT",
      base_uom: "mL",
      lot_code: "LOT-RDTAQ-2601",
      qty: 200,
      wh_code: "KHO-RD",
    });
    const rdDntpId = await ensureItemAndStock({
      code: "RD-RG-DNTP-MIX",
      name: "Hỗn hợp dNTPs Mix siêu tinh khiết (dATP/dCTP/dGTP/dUTP 25mM)",
      item_type: "REAGENT",
      base_uom: "mL",
      lot_code: "LOT-RDDNTP-2601",
      qty: 500,
      wh_code: "KHO-RD",
    });
    const kitDenItemId = await ensureItemAndStock({
      code: "KIT-DENGUE-4P-50T",
      name: "TopSENSI® Dengue 1-4 Multiplex Real-time RT-PCR Kit (50 test)",
      item_type: "FINISHED_KIT",
      base_uom: "kit",
      lot_code: "LOT-DENKIT-INIT",
      qty: 0,
      wh_code: "KHO-KIT",
    });

    const pNew = await createQuickRdProject(tx, rootActor, {
      project_type: "NEW_PRODUCT",
      target_domain: "KIT",
      ivd_class: "CLASS_C",
      name: "Nghiên cứu phát triển Kit Multiplex Real-time RT-PCR phân biệt 4 chủng sốt xuất huyết Dengue (DENV 1–4)",
      target_product_item_id: kitDenItemId,
      budget_amount: 85000000,
      planned_end: "2026-12-20",
      description: "Thiết kế mồi/probe 4 kênh màu (FAM/HEX/ROX/Cy5) phát hiện đồng thời DENV-1, DENV-2, DENV-3, DENV-4 với LoD ≤ 10 copies/rxn.",
    });

    await savePrototypeBom(tx, rootActor, {
      project_id: pNew.id,
      target_product_item_id: kitDenItemId,
      lines: [
        { component_item_id: rdTaqId, component_role: "ENZYME", qty_per_base: 0.5, uom: "mL", scrap_pct: 5, notes: "Taq HotStart + RT Mix cho 50 phản ứng" },
        { component_item_id: rdDntpId, component_role: "MASTER_MIX", qty_per_base: 0.8, uom: "mL", scrap_pct: 3, notes: "Đệm phản ứng + dNTPs/dUTP chống nhiễm chéo" },
      ],
    });

    await tx.query(
      `INSERT INTO rd.spec_evaluation
         (project_id, category, design_stage, parameter, unit, target_value, actual_value, method_ref, result, updated_by)
       VALUES
         ($1, 'ANALYTICAL', 'DESIGN_INPUT', 'Giới hạn phát hiện LoD95 (4 serotype DENV 1-4)', 'copies/rxn', '≤ 10 copies/rxn', '7.5 copies/rxn', 'MTH-PCR-001', 'PASS', $2),
         ($1, 'CLINICAL', 'VALIDATION', 'Độ nhạy & Độ đặc hiệu phân biệt 4 chủng', '%', '≥ 98.0%', '99.2% (n=120 mẫu)', 'MTH-PCR-001', 'PASS', $2)`,
      [pNew.id, rootActor.userId]
    );

    await tx.query(
      `INSERT INTO rd.project_material_ledger
         (project_id, gate_no, entry_type, item_id, qty, uom, estimated_cost, ref_code, purpose, created_by)
       VALUES
         ($1, 1, 'DIRECT_ISSUE', $2, 12.5, 'mL', 6500000, 'PXK-RD-26001', 'Lĩnh Enzyme Taq HotStart khảo sát nhiệt độ bắt cặp mồi G1', $4),
         ($1, 2, 'DIRECT_ISSUE', $3, 25.0, 'mL', 4200000, 'PXK-RD-26002', 'Lĩnh hỗn hợp dNTPs tối ưu hóa công thức MasterMix 4 kênh màu G2', $4)`,
      [pNew.id, rdTaqId, rdDntpId, rootActor.userId]
    );

    await createQuickRdProject(tx, rootActor, {
      project_type: "IMPROVEMENT",
      target_domain: "KIT",
      ivd_class: "CLASS_B",
      name: "Cải tiến Công thức Chất bảo quản Đông khô (Lyophilized Stabilizer) cho dòng Kit TopSENSI vận chuyển nhiệt độ phòng",
      budget_amount: 45000000,
      planned_end: "2026-11-25",
      description: "Thay thế Glycerol bằng hệ đệm Trehalose/Mannitol giúp vận chuyển Kit không cần đá khô trong 14 ngày ở 37°C.",
    });
  }

  // 11. Seed QA/QC Reference Standards, Analytical Methods, Retention Samples & Pending QC Queue Lots
  if (qaStdCount < 3) {
    await saveReferenceStandard(tx, rootActor, {
      code: "STD-HBV-POS",
      name: "Chứng dương chuẩn Plasmid HBV DNA chuẩn hóa WHO (10^4 copies/µL)",
      standard_type: "POSITIVE_CONTROL",
      target_domain: "KIT",
      lot_no: "LOT-STDHBV-2601",
      source_strain: "WHO International Standard NIBSC / pUC57-HBV",
      concentration: "10^4 copies/µL",
      target_metric: "Ct Value (FAM)",
      target_value: 26.0,
      lower_limit: 25.0,
      upper_limit: 27.0,
      unit: "Ct",
      storage_location: "KHO-QA · Tủ âm sâu -80°C (Khay S1)",
      aliquots_total: 100,
      aliquots_remaining: 84,
      max_freeze_thaw: 3,
      notes: "Dùng bắt buộc trong mỗi mẻ FQC xuất xưởng Kit HBV Real-time PCR",
    });

    await saveReferenceStandard(tx, rootActor, {
      code: "STD-LOD-PANEL",
      name: "Bộ Panel Độ nhạy Giới hạn phát hiện LoD (10^3 · 10^2 · 50 · 10 · 5 copies/µL)",
      standard_type: "LOD_PANEL",
      target_domain: "KIT",
      lot_no: "LOT-LODPNL-2601",
      source_strain: "Dãy pha loãng chuẩn định lượng Digital PCR",
      concentration: "5 – 1000 copies/µL (5 mức)",
      target_metric: "Tỷ lệ phát hiện ở 10 copies/rxn",
      target_value: 100,
      lower_limit: 95,
      upper_limit: 100,
      unit: "%",
      storage_location: "KHO-QA · Tủ âm sâu -80°C (Khay S2)",
      aliquots_total: 40,
      aliquots_remaining: 32,
      max_freeze_thaw: 2,
      notes: "Bộ mẫu chuẩn kiểm tra độ nhạy giải phóng lô Kit thành phẩm",
    });

    await saveReferenceStandard(tx, rootActor, {
      code: "STD-NTC-WATER",
      name: "Chứng âm chuẩn Nước siêu tinh khiết không Nuclease (Negative Control / NTC)",
      standard_type: "NEGATIVE_CONTROL",
      target_domain: "ALL",
      lot_no: "LOT-NTC-2601",
      source_strain: "DEPC-Free / DNase-RNase Free Molecular Grade",
      concentration: "0 copies/µL",
      target_metric: "Tín hiệu khuếch đại nền",
      target_value: 0,
      lower_limit: 0,
      upper_limit: 0,
      unit: "RFU",
      storage_location: "KHO-QA · Tủ mát 2-8°C (Kệ N1)",
      aliquots_total: 200,
      aliquots_remaining: 175,
      max_freeze_thaw: 5,
      notes: "Kiểm soát nhiễm chéo Amplicon trong phòng thí nghiệm QC",
    });

    await saveReferenceStandard(tx, rootActor, {
      code: "STD-OLIGO-HPLC",
      name: "Chất chuẩn Oligo đối chiếu 25-mer RP-HPLC & Khối phổ (MW 7652.0 Da)",
      standard_type: "CHEMICAL_STD",
      target_domain: "OLIGO",
      lot_no: "LOT-STDOLI-2601",
      source_strain: "Oligo tổng hợp chuẩn hiệu chuẩn cột C18",
      concentration: "100 µM (10 OD/mL)",
      target_metric: "Độ tinh khiết đỉnh sắc ký (%Area)",
      target_value: 95.0,
      lower_limit: 90.0,
      upper_limit: 100.0,
      unit: "%",
      storage_location: "KHO-QA · Tủ âm -20°C (Khay O1)",
      aliquots_total: 60,
      aliquots_remaining: 54,
      max_freeze_thaw: 4,
      notes: "Dùng kiểm tra System Suitability hệ thống HPLC trước khi chạy QC Oligo",
    });

    await saveQcMethod(tx, rootActor, {
      code: "MTH-PCR-001",
      name: "Phương pháp Kiểm định Hoạt tính, Chứng dương/âm & Độ nhạy (LoD) Kit Real-time PCR",
      category: "QPCR_ASSAY",
      instrument_type: "Hệ thống Real-time PCR 96 giếng (CFX96 / BioCycler Q96)",
      required_standard_type: "POSITIVE_CONTROL",
      principle: "Khuếch đại trình tự đích bằng đầu dò TaqMan Probe và xác định chu kỳ ngưỡng (Ct) so với Bộ mẫu chuẩn dương/âm và Panel LoD.",
      suitability_criteria: "Chứng dương STD-HBV-POS có Ct trong khoảng [25.0 – 27.0]; Chứng âm NTC không lên tín hiệu (No Ct); Hệ số tương quan R² ≥ 0.990.",
      sop_steps: [
        { step_no: 1, title: "Chuẩn bị mẫu chuẩn & thuốc thử", detail: "Rã đông bộ mẫu chuẩn STD-HBV-POS, STD-LOD-PANEL và lô Kit cần kiểm trên block lạnh 2–8°C." },
        { step_no: 2, title: "Pha trộn & Chia giếng", detail: "Hút 20 µL hỗn hợp MasterMix vào từng giếng quang học, nạp 5 µL mẫu chuẩn/mẫu thử (lặp lại 3 giếng/mức)." },
        { step_no: 3, title: "Chạy chu trình nhiệt & Đánh giá", detail: "Chạy chương trình 95°C 3 phút; 40 chu kỳ (95°C 10s, 60°C 30s thu tín hiệu FAM/HEX) và đối chiếu tiêu chuẩn." },
      ],
      validation_summary: {
        repeatability_cv_pct: "1.42%",
        reproducibility_cv_pct: "2.15%",
        lod_value: "10 copies/rxn (95% CI)",
        specificity_pct: "100%",
        linearity_r2: "0.999",
        validated_date: "2026-01-20",
      },
      status: "EFFECTIVE",
    });

    await saveQcMethod(tx, rootActor, {
      code: "MTH-OLI-002",
      name: "Phương pháp Phân tích Độ tinh khiết & Định lượng Oligo bằng Quang phổ UV 260nm & RP-HPLC",
      category: "HPLC_CHROMATOGRAPHY",
      instrument_type: "Hệ thống Sắc ký lỏng RP-HPLC C18 & Quang phổ NanoDrop One",
      required_standard_type: "CHEMICAL_STD",
      principle: "Đo hấp thụ quang ở bước sóng 260nm/280nm để tính tổng OD260 và tách phân đoạn trên cột đảo pha C18 để xác định % độ tinh khiết.",
      suitability_criteria: "Mẫu chuẩn STD-OLIGO-HPLC cho đỉnh đơn sắc nét, thời gian lưu Rt lệch không quá ±0.2 phút, %Area ≥ 90%.",
      sop_steps: [
        { step_no: 1, title: "Đo mật độ quang OD260", detail: "Hòa tan mẫu Oligo trong nước không Nuclease, đo A260 và tỷ số A260/A280 trên máy NanoDrop." },
        { step_no: 2, title: "Tiêm mẫu phân tích RP-HPLC", detail: "Tiêm 10 µL dịch mẫu qua cột C18 (gradient TEAA / Acetonitrile), tích phân diện tích đỉnh chính ở 260nm." },
      ],
      validation_summary: {
        repeatability_cv_pct: "0.85%",
        reproducibility_cv_pct: "1.30%",
        lod_value: "0.05 OD260",
        specificity_pct: "99.5%",
        linearity_r2: "0.9995",
        validated_date: "2026-01-25",
      },
      status: "EFFECTIVE",
    });

    await saveQcMethod(tx, rootActor, {
      code: "MTH-DEV-003",
      name: "Phương pháp Kiểm định An toàn Điện IEC 61010 & Độ chính xác Nhiệt độ Thiết bị Xuất xưởng",
      category: "ELECTRICAL_SAFETY",
      instrument_type: "Thiết bị đo an toàn điện Fluke & Đầu dò nhiệt đa kênh chuẩn",
      required_standard_type: "CALIBRATOR",
      principle: "Kiểm tra dòng rò vỏ máy, điện trở nối đất bảo vệ và độ đồng đều nhiệt độ block gia nhiệt sau 48h chạy rà Burn-in.",
      suitability_criteria: "Điện trở nối đất ≤ 0.1 Ω; Dòng rò < 0.5 mA; Sai số nhiệt độ tại 90°C nằm trong ±0.2°C.",
      sop_steps: [
        { step_no: 1, title: "Đo kiểm an toàn điện", detail: "Đo điện trở tiếp địa và dòng rò cách điện ở điện áp 230VAC." },
        { step_no: 2, title: "Đo hiệu chuẩn nhiệt độ & Quang học", detail: "Đặt đầu dò chuẩn vào các vị trí giếng, ghi nhận độ trôi nhiệt độ sau 30 phút ổn định." },
      ],
      validation_summary: {
        repeatability_cv_pct: "0.40%",
        reproducibility_cv_pct: "0.75%",
        lod_value: "±0.05°C",
        specificity_pct: "100%",
        linearity_r2: "0.9998",
        validated_date: "2026-02-01",
      },
      status: "EFFECTIVE",
    });

    // Seed 3 Quarantine Lots (1 Raw Material IQC, 1 Semi-finished IPQC, 1 Finished Kit FQC) so QC Reception Queue is populated
    let semiMmixItem = (await tx.query("SELECT * FROM master.item WHERE code = 'BTP-MMIX-HBV-BULK' LIMIT 1")).rows[0];
    if (!semiMmixItem) {
      semiMmixItem = await createItem(tx, rootActor, {
        code: "BTP-MMIX-HBV-BULK",
        name: "Bán thành phẩm Dung dịch qPCR MasterMix HBV Bulk (Mẻ pha chế 500mL)",
        item_type: "SEMI_FINISHED",
        base_uom: "mL",
        tracking: "LOT",
        receipt_qc_required: true,
        shelf_life_days: 365,
      });
    }

    const kitWh = whMap["KHO-KIT"];
    if (semiMmixItem && kitWh) {
      const lotIpqcExists = await tx.query("SELECT 1 FROM inv.lot WHERE code = 'LOT-BTP-MMIX-2610'");
      if (!lotIpqcExists.rowCount) {
        const lIpqc = await createLot(tx, rootActor, {
          item_id: semiMmixItem.id,
          origin: "PREPARATION",
          code: "LOT-BTP-MMIX-2610",
          mfg_date: "2026-10-25",
          expiry_date: "2027-10-25",
        });
        const recDoc = await createStockDocument(tx, rootActor, {
          doc_type: "RECEIPT",
          reason_code: "PRODUCTION",
          warehouse_id: kitWh.whId,
          lines: [{ item_id: semiMmixItem.id, lot_id: lIpqc.id, to_location_id: kitWh.btId, qty: 500, uom: "mL" }],
        });
        await postStockDocument(tx, rootActor, recDoc.id, recDoc.version);
      }
    }

    const hbvKitItem = (await tx.query("SELECT id, base_uom FROM master.item WHERE code = 'KIT-HBV-50T.D.IC'")).rows[0];
    if (hbvKitItem && kitWh) {
      const lotFqcExists = await tx.query("SELECT 1 FROM inv.lot WHERE code = 'LOT-KIT-HBV-2610A'");
      if (!lotFqcExists.rowCount) {
        const lFqc = await createLot(tx, rootActor, {
          item_id: hbvKitItem.id,
          origin: "PRODUCTION",
          code: "LOT-KIT-HBV-2610A",
          mfg_date: "2026-10-28",
          expiry_date: "2027-10-28",
        });
        const recDoc = await createStockDocument(tx, rootActor, {
          doc_type: "RECEIPT",
          reason_code: "PRODUCTION",
          warehouse_id: kitWh.whId,
          lines: [{ item_id: hbvKitItem.id, lot_id: lFqc.id, to_location_id: kitWh.btId, qty: 100, uom: hbvKitItem.base_uom }],
        });
        await postStockDocument(tx, rootActor, recDoc.id, recDoc.version);

        await saveRetentionSample(tx, rootActor, {
          lot_id: lFqc.id,
          item_id: hbvKitItem.id,
          sample_category: "FINISHED_KIT",
          qty_retained: 3,
          uom: hbvKitItem.base_uom,
          storage_temp: "-20°C",
          storage_location: "KHO-QA · Tủ Mẫu Lưu R1 (Khay Kit Xuất Xưởng)",
          notes: "Mẫu lưu đối chứng & theo dõi độ ổn định thời gian thực (0, 3, 6, 9, 12 tháng)",
        });
      }
    }
  }

  // 10. Seed sample Internal Orders for KIT & OLIGO departments + Central Hub Stock & Open PRs
  if (kitOligoOrderCount < 2) {
    const hbvItem = (await tx.query("SELECT id, base_uom FROM master.item WHERE code = 'KIT-HBV-50T.D.IC' LIMIT 1")).rows[0];
    if (hbvItem) {
      await createInternalOrderManual(tx, rootActor, {
        target_module: "KIT",
        kd_po_code: "PO-KD-KIT-2601",
        kd_so_code: "SO-KD-901",
        ship_mode: "TO_KD",
        customer_name: "Kho Thương Mại Kinh Doanh — Cấp Bệnh viện Chợ Rẫy & Bạch Mai",
        requested_date: "2026-11-18",
        notes: "Đơn đặt hàng Kit định lượng HBV-DNA Real-time PCR (50 test/hộp) phục vụ thầu Quý 4",
        auto_accept: true,
        lines: [{ item_id: hbvItem.id, qty: 40, transfer_price: 2650000 }],
      });
    }

    let oligoCustomItem = (await tx.query("SELECT * FROM master.item WHERE code = 'OLI-CUSTOM-QPCR-SET' LIMIT 1")).rows[0];
    if (!oligoCustomItem) {
      oligoCustomItem = await createItem(tx, rootActor, {
        code: "OLI-CUSTOM-QPCR-SET",
        name: "Bộ Mồi & Đầu dò TaqMan Probe Tổng hợp theo yêu cầu (200 nmol, HPLC)",
        item_type: "OLIGO_SERVICE",
        base_uom: "tube",
        tracking: "LOT",
        kd_item_code: "OLI-CUSTOM-QPCR-SET",
        receipt_qc_required: true,
        shelf_life_days: 730,
      });
    }

    if (oligoCustomItem) {
      await createInternalOrderManual(tx, rootActor, {
        target_module: "OLIGO",
        kd_po_code: "PO-KD-OLI-2601",
        kd_so_code: "SO-KD-902",
        ship_mode: "DROP_SHIP",
        customer_name: "Viện Vệ sinh Dịch tễ Trung ương (NIHE)",
        customer_address: "Số 1 Yec Xanh, Hai Bà Trưng, Hà Nội",
        requested_date: "2026-11-12",
        notes: "Đơn đặt tổng hợp bộ Primer & Probe chẩn đoán tác nhân hô hấp (Giao thẳng khách)",
        auto_accept: true,
        lines: [{ item_id: oligoCustomItem.id, qty: 15, transfer_price: 950000 }],
      });
    }

    // Ensure KHO-TONG has released stock of key enzymes/reagents & create an open PR from P-KIT so Hub Dispatch works out-of-the-box
    const khoTongWh = whMap["KHO-TONG"];
    const khoKitWh = whMap["KHO-KIT"];
    const taqItem = (await tx.query("SELECT id, base_uom, is_purchasable FROM master.item WHERE code = 'NVL-TAQ-POLY' LIMIT 1")).rows[0];
    if (khoTongWh && taqItem) {
      const lotHubExists = await tx.query("SELECT 1 FROM inv.lot WHERE code = 'LOT-HUB-TAQ-2610'");
      if (!lotHubExists.rowCount) {
        const lHub = await createLot(tx, rootActor, {
          item_id: taqItem.id,
          origin: "OPENING",
          code: "LOT-HUB-TAQ-2610",
          mfr_lot_no: "NEB-TAQ-9981",
          mfg_date: "2026-09-01",
          expiry_date: "2027-09-01",
        });
        await tx.query("UPDATE inv.lot SET status = 'RELEASED' WHERE id = $1", [lHub.id]);
        const hubDoc = await createStockDocument(tx, rootActor, {
          doc_type: "RECEIPT",
          reason_code: "OPENING",
          warehouse_id: khoTongWh.whId,
          lines: [{ item_id: taqItem.id, lot_id: lHub.id, to_location_id: khoTongWh.a1Id, qty: 2500, uom: taqItem.base_uom }],
        });
        await postStockDocument(tx, rootActor, hubDoc.id, hubDoc.version);
      }

      if (khoKitWh && deptIdByModule["KIT"] && taqItem.is_purchasable) {
        const existingKitPr = await tx.query(
          "SELECT 1 FROM purchase.purchase_request WHERE org_unit_id = $1 AND reason LIKE '%tuần 45%' LIMIT 1",
          [deptIdByModule["KIT"]]
        );
        if (!existingKitPr.rowCount) {
          const prKit = await createRequest(tx, rootActor, {
            org_unit_id: deptIdByModule["KIT"],
            target_warehouse_id: khoKitWh.whId,
            needed_by: "2026-11-05",
            reason: "Bổ sung Enzyme HotStart Taq Polymerase cho mẻ sản xuất Kit HBV tuần 45",
            lines: [{ item_id: taqItem.id, qty: 500, uom: taqItem.base_uom, est_price: 185000 }],
          });
          await tx.query("UPDATE purchase.purchase_request SET status = 'APPROVED', priority = 'URGENT', approved_by = $2 WHERE id = $1", [
            prKit.id,
            rootActor.userId,
          ]);
        }
      }
    }
  }

  bootstrapped = true;
}
