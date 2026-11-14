import { z } from "zod";
import type { Tx } from "../core/db";
import { diffChanges, writeAudit } from "../core/audit";
import { authorize, authorizeAnywhere, hasFactoryPermission, type AuthzActor } from "../core/authz";
import { addDays, vnToday } from "../core/dates";
import { invalid, notFound } from "../core/errors";
import { notifyUsers, usersWithPermission } from "../core/notifications";
import { nextNumber } from "../core/numbering";
import { enqueueEvent } from "../core/outbox";
import { insertRecord, parseInput } from "../core/records";
import { defineMachine, listAllowedActions, runTransition } from "../core/stateMachine";
import { assertUsable } from "../asset/service";
import { allocate, findCandidates } from "../inv/allocation";
import { createStockDocument, stockDocumentMachine } from "../inv/documents";
import { createLot } from "../inv/lots";
import { releaseDemandReservations, reserve } from "../inv/reservations";
import { getItem, toBaseQty } from "../master/service";
import { isUserTrainedForSop } from "../qms/documents";
import { raiseDeviation } from "../qms/incidents";
import { issueCoaFromQcTest } from "../qms/qaOps";
import { createQcTest, registerQcSubject } from "../qms/qcTests";
import { findEffectiveSpec } from "../qms/specs";
import {
  ensureKitBomRoutingAndIfuSchema,
  loadStandardKitRoutingSteps,
  visibleKitOrgUnits,
  type KitBomRow,
  type RoutingStepParamDef,
} from "./bomRouting";
import "./permissions";

export type ProductionOrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "PENDING_QC"
  | "PENDING_RELEASE"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED";

export type ProductionStepStatus = "PENDING" | "IN_PROGRESS" | "AWAITING_CHECK" | "DONE" | "FAILED" | "SKIPPED";

export interface ProductionOrderRow {
  id: string;
  code: string;
  org_unit_id: string;
  product_item_id: string;
  bom_id: string;
  routing_id: string;
  warehouse_id: string;
  planned_qty: string;
  good_qty: string;
  scrap_qty: string;
  sample_qty: string;
  retain_qty: string;
  yield_pct: string | null;
  uom: string;
  lot_id: string | null;
  mfg_date: string | null;
  expiry_date: string | null;
  label_printed_at: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  materials_issued: boolean;
  materials_reconciled: boolean;
  line_clearance_passed: boolean;
  line_clearance_by: number | null;
  line_clearance_at: string | null;
  line_clearance_checklist: Record<string, unknown>;
  qc_test_id: string | null;
  qc_passed: boolean | null;
  qc_summary: string | null;
  reconciliation_note: string | null;
  internal_order_line_id: string | null;
  confirmed_by: number | null;
  confirmed_at: string | null;
  released_by: number | null;
  released_at: string | null;
  order_mode?: "STANDARD" | "ALIQUOTED" | "DEMO";
  supply_form?: "NO_SPLIT_NO_IC" | "NO_SPLIT_WITH_IC" | "SPLIT_NO_IC" | "SPLIT_WITH_IC" | string | null;
  tube_code?: string | null;
  bom_variant_code?: string | null;
  mix_tests_per_kit?: number | null;
  pcr_tubes_per_kit?: number | null;
  is_aliquoted?: boolean;
  is_demo?: boolean;
  demo_specification?: string | null;
  qc_retention_qty?: string;
  no_retention?: boolean;
  actual_ph?: string | null;
  status: ProductionOrderStatus;
  notes: string | null;
  version: number;
  created_by: number | null;
}

const DISCRETE_UOMS = new Set([
  "CAI",
  "CÁI",
  "HOP",
  "HỘP",
  "LO",
  "LỌ",
  "TUI",
  "TÚI",
  "ONG",
  "ỐNG",
  "BO",
  "BỘ",
  "TEM",
  "NHAN",
  "NHÃN",
  "KIT",
  "PCS",
  "BOX",
  "TUBE",
  "VIAL",
  "BOTTLE",
  "SET",
  "EA",
]);

export function parseDemoRatio(spec: string | null | undefined, baseTests: number): number {
  if (!spec || !spec.trim()) return 0.5;
  const s = spec.trim().toLowerCase();
  const frac = s.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den > 0) return Math.min(Math.max(num / den, 0.05), 1);
  }
  const testMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:test|rxn|phản ứng|pu)/i) ?? s.match(/^(\d+(?:\.\d+)?)$/);
  if (testMatch) {
    const tests = Number(testMatch[1]);
    if (tests > 0 && tests <= 5) return tests;
    if (tests > 0 && baseTests > 0) return Math.min(Math.max(tests / baseTests, 0.05), 2);
  }
  return 0.5;
}

export interface ExplodedBomLine {
  bom_line_id: string;
  line_no: number;
  box_no: number;
  component_item_id: string;
  component_code: string;
  component_name: string;
  component_role: string;
  uom: string;
  base_uom: string;
  unit_norm: number;
  effective_order_qty: number;
  demo_ratio_applied: number;
  scrap_pct: number;
  raw_qty: number;
  required_qty: number;
  qty_base: number;
  is_bundled: boolean;
  bundle_parent_code: string | null;
  allow_substitute: boolean;
}

/**
 * ABT Smart BOM Explosion Engine (`explodeKitBom` from `molecularkit-mes`):
 * - Supports 3 modes: `STANDARD`, `ALIQUOTED` (`.D.IC` pre-dispensed), and `DEMO` (`demo_specification` e.g. "25 test", "1/2 bộ").
 * - Handles QC retention kits (`qc_retention_qty`, `no_retention`, `include_in_qc_retention`).
 * - Applies discrete unit ceiling (`CEIL` for bottles, tubes, boxes, labels).
 */
/**
 * Giải mã cấu trúc Số Lô chuẩn ABT (VD: B2611001.C.IC.T02, B2611001.IC.S01, B2611001.T02)
 * để tự động suy ra Dạng cung cấp (`supply_form`) và Mã nhận diện Tube (`tube_code`) ngay khi người dùng gõ Số Lô.
 */
const ABT_KNOWN_TUBE_CODES = new Set(["T02", "T01", "S02", "S01", "LQ02", "MIC", "R01", "LP02"]);

function parseLotCodeToSupplyFormAndTube(lotCode: string | null | undefined): {
  baseLot: string;
  supplyForm: "NO_SPLIT_NO_IC" | "NO_SPLIT_WITH_IC" | "SPLIT_NO_IC" | "SPLIT_WITH_IC" | null;
  tubeCode: string | null;
} {
  const raw = String(lotCode || "").trim().toUpperCase();
  if (!raw || !raw.includes(".")) {
    return { baseLot: raw, supplyForm: null, tubeCode: null };
  }
  const tokens = raw.split(".").filter(Boolean);
  const baseLot = tokens[0] || raw;
  const rest = tokens.slice(1);
  const last = rest[rest.length - 1] || "";
  const tubeCode = ABT_KNOWN_TUBE_CODES.has(last) ? last : null;
  const mid = (tubeCode ? rest.slice(0, -1) : rest).join(".");

  let supplyForm: "NO_SPLIT_NO_IC" | "NO_SPLIT_WITH_IC" | "SPLIT_NO_IC" | "SPLIT_WITH_IC" | null = null;
  if (mid === "C.IC" || mid === "IC.C") supplyForm = "SPLIT_WITH_IC";
  else if (mid === "C") supplyForm = "SPLIT_NO_IC";
  else if (mid === "IC") supplyForm = "NO_SPLIT_WITH_IC";
  else if (mid === "" && tubeCode) supplyForm = "NO_SPLIT_NO_IC";

  return { baseLot, supplyForm, tubeCode };
}

export async function explodeKitBom(tx: Tx, order: ProductionOrderRow, bom: KitBomRow): Promise<ExplodedBomLine[]> {
  const prod = await getItem(tx, order.product_item_id);
  let lotCodeStr = String((order as any).lot_code || "").trim();
  if (!lotCodeStr && order.lot_id) {
    const lr = (await tx.query("SELECT code FROM inv.lot WHERE id = $1", [order.lot_id])).rows[0];
    lotCodeStr = String(lr?.code || "").trim();
  }
  const parsedFromLot = parseLotCodeToSupplyFormAndTube(lotCodeStr);

  const isPcrKit =
    prod.item_type !== "SEMI_FINISHED" &&
    (bom as any).bom_type !== "semi_finished" &&
    String((bom as any).bom_category || "PCR Kit") === "PCR Kit";

  const supplyForm = isPcrKit
    ? String(parsedFromLot.supplyForm || (order as any).supply_form || (bom as any).supply_form || "")
        .trim()
        .toUpperCase()
    : "";
  const tubeCode = isPcrKit
    ? String(parsedFromLot.tubeCode || (order as any).tube_code || "")
        .trim()
        .toUpperCase()
    : "";
  const bomVariant = String((bom as any).variant_code || "BASE").trim().toUpperCase();

  const isAliquoted =
    isPcrKit &&
    (supplyForm === "SPLIT_NO_IC" ||
      supplyForm === "SPLIT_WITH_IC" ||
      Boolean(order.is_aliquoted) ||
      order.order_mode === "ALIQUOTED" ||
      prod.code.toUpperCase().includes(".D.IC") ||
      bomVariant === "C" ||
      bomVariant === "C.IC");

  const hasPreMixedIc =
    isPcrKit &&
    (supplyForm === "NO_SPLIT_WITH_IC" ||
      supplyForm === "SPLIT_WITH_IC" ||
      bomVariant === "IC" ||
      bomVariant === "C.IC" ||
      prod.code.toUpperCase().includes(".IC"));

  const isDemo = Boolean(order.is_demo) || order.order_mode === "DEMO";
  const targetMixTests = isAliquoted ? 64 : 75;
  const targetPcrTubes = isAliquoted ? 64 : 80;
  const baseTests = Number((order as any).mix_tests_per_kit || bom.tests_per_kit || (isPcrKit ? targetMixTests : 50));
  const demoRatio = isDemo ? parseDemoRatio(order.demo_specification, baseTests) : 1;

  const plannedQty = Number(order.planned_qty) || 0;
  const retQty = order.no_retention ? 0 : Number(order.qc_retention_qty || 0);
  const baseQty = Number(bom.base_qty) || 1;

  const lines = (
    await tx.query(
      `SELECT bl.*, it.code AS component_code, it.name AS component_name, it.base_uom, it.item_type
         FROM kit.bom_line bl
         JOIN master.item it ON it.id = bl.component_item_id
        WHERE bl.bom_id = $1
        ORDER BY bl.box_no ASC, bl.line_no ASC`,
      [bom.id]
    )
  ).rows;

  // Look up selected tube strip item if tubeCode is specified (e.g. T02 -> VT-TUBE-T02)
  let selectedTubeItem: any = null;
  if (tubeCode) {
    selectedTubeItem = (
      await tx.query(
        "SELECT * FROM master.item WHERE upper(code) IN ($1, $2) AND status = 'ACTIVE' LIMIT 1",
        [`VT-TUBE-${tubeCode}`, tubeCode]
      )
    ).rows[0];
  }

  let hasHandledPcrTubeStrip = false;
  const result: ExplodedBomLine[] = [];

  for (const l of lines) {
    const codeUpper = String(l.component_code || "").toUpperCase();
    const nameLower = String(l.component_name || "").toLowerCase();

    // 1. Quy tắc IC: Dạng có sẵn IC trong PCR Mix (.IC / .C.IC) thì KHÔNG cung cấp kèm ống IC rời (A001, A002, A003)
    const isStandaloneIcTube =
      l.component_role === "INTERNAL_CONTROL" ||
      /^A00[123]$/i.test(codeUpper) ||
      (!codeUpper.includes("MIX") && /\b(ống ic|amplicon ic|internal control|chứng nội rời)\b/i.test(nameLower));
    if (hasPreMixedIc && isStandaloneIcTube && bomVariant === "BASE") {
      continue;
    }

    // 2. Quy tắc Tube 1.5mL chứa PCR Mix (CTT1.5): Dạng chia sẵn (.C / .C.IC) chia trực tiếp vào 64 tube PCR nên không kèm tube 1.5mL chứa Mix
    const isMix15Tube =
      codeUpper === "CTT1.5" ||
      (l.component_role === "PACKAGING" &&
        (nameLower.includes("1.5") || codeUpper.includes("1.5")) &&
        (nameLower.includes("mix") || String(l.notes || "").toLowerCase().includes("mix")));
    if (isAliquoted && isMix15Tube) {
      continue;
    }

    // 3. Quy tắc Tube/Strip PCR theo máy khách hàng (8 mã: T02, T01, S02, S01, LQ02, MIC, R01, LP02)
    const isPcrTubeLine =
      l.component_role === "PCR_TUBE_STRIP" ||
      codeUpper.startsWith("VT-TUBE-");

    let compItemId = l.component_item_id;
    let compCode = l.component_code;
    let compName = l.component_name;
    let compUom = l.uom;
    let unitNorm =
      isAliquoted && l.qty_per_base_aliquoted !== null && Number(l.qty_per_base_aliquoted) > 0
        ? Number(l.qty_per_base_aliquoted)
        : Number(l.qty_per_base);

    const isPcrMixLine =
      l.component_role === "MASTER_MIX" ||
      (/^M[A-Z0-9]/i.test(codeUpper) && (nameLower.includes("mix") || String(compUom || "").toLowerCase().includes("test")));

    // 3b. Tự động hoán đổi mã Bán thành phẩm PCR Mix (Mxxx <-> MxxxIC) khi chạy công thức cơ bản cho Lô có sẵn IC (.IC / .C.IC)
    if (isPcrKit && isPcrMixLine && hasPreMixedIc && !codeUpper.endsWith("IC")) {
      const strippedRp = codeUpper.replace(/RP$/i, "");
      const candidateCodes = [`${codeUpper}IC`, `${strippedRp}IC`, `${codeUpper}.IC`, `${codeUpper}-IC`];
      const icMixItem = (
        await tx.query(
          "SELECT * FROM master.item WHERE upper(code) = ANY($1::text[]) AND status = 'ACTIVE' ORDER BY CASE WHEN upper(code) = $2 THEN 0 ELSE 1 END LIMIT 1",
          [candidateCodes, `${codeUpper}IC`]
        )
      ).rows[0];
      if (icMixItem) {
        compItemId = icMixItem.id;
        compCode = icMixItem.code;
        compName = icMixItem.name;
      }
    }

    if (isPcrTubeLine) {
      hasHandledPcrTubeStrip = true;
      if (selectedTubeItem) {
        compItemId = selectedTubeItem.id;
        compCode = selectedTubeItem.code;
        compName = selectedTubeItem.name;
        compUom = selectedTubeItem.base_uom;
      }
      unitNorm = targetPcrTubes;
    } else if (
      isAliquoted &&
      (l.qty_per_base_aliquoted === null || Number(l.qty_per_base_aliquoted) <= 0) &&
      bomVariant === "BASE" &&
      (isPcrMixLine || ["MASTER_MIX", "PRIMER_PROBE", "ENZYME"].includes(l.component_role))
    ) {
      // Nếu dùng chung 1 BOM gốc (75 test) để chạy lệnh Chia sẵn (64 test) và chưa điền cột định mức chia sẵn riêng, tự động quy đổi 64/75
      unitNorm = Math.round(((unitNorm * 64) / 75) * 1e4) / 1e4;
    }

    const includeQcRet = l.include_in_qc_retention !== false && l.component_role !== "PACKAGING" && !isPcrTubeLine;
    const effectiveOrderQty = includeQcRet ? plannedQty + retQty : plannedQty;
    const scale = effectiveOrderQty / baseQty;

    // 4. Quy tắc Demo: Hóa chất giảm theo tỉ lệ, nhưng vật tư cố định (chai chứa, vỏ hộp) giữ nguyên
    const isFixedInDemo = Boolean(l.is_demo_fixed_component) || l.component_role === "PACKAGING";
    const lineDemoRatio = isDemo && !isFixedInDemo && l.is_mix_component !== false ? demoRatio : 1;

    const scrapFactor = 1 + Number(l.scrap_pct || 0) / 100;
    const rawQty = scale * unitNorm * lineDemoRatio * scrapFactor;
    const isDiscrete = DISCRETE_UOMS.has(String(compUom || "").trim().toUpperCase()) || isPcrTubeLine;
    const requiredQty = isDiscrete ? Math.ceil(rawQty - 1e-9) : Math.round(rawQty * 1e6) / 1e6;

    const compItem = await getItem(tx, compItemId);
    const qtyBase = Math.round((await toBaseQty(tx, compItem, requiredQty, compUom)) * 1e6) / 1e6;

    result.push({
      bom_line_id: l.id,
      line_no: Number(l.line_no),
      box_no: Number(l.box_no),
      component_item_id: compItemId,
      component_code: compCode,
      component_name: compName,
      component_role: l.component_role,
      uom: compUom,
      base_uom: compItem.base_uom,
      unit_norm: unitNorm,
      effective_order_qty: effectiveOrderQty,
      demo_ratio_applied: lineDemoRatio,
      scrap_pct: Number(l.scrap_pct || 0),
      raw_qty: Math.round(rawQty * 1e6) / 1e6,
      required_qty: requiredQty,
      qty_base: qtyBase,
      is_bundled: Boolean(l.is_bundled),
      bundle_parent_code: l.bundle_parent_code ?? null,
      allow_substitute: Boolean(l.allow_substitute),
    });
  }

  // Nếu trong Công thức BOM chung chưa khai báo dòng PCR_TUBE_STRIP nhưng trên Lot có mã nhận diện Tube (VD: .T02, .S01...), tự động bổ sung dòng Tube PCR tương ứng (80 tube hoặc 64 tube)
  if (!hasHandledPcrTubeStrip && selectedTubeItem) {
    const unitNorm = targetPcrTubes;
    const effectiveOrderQty = plannedQty;
    const scale = effectiveOrderQty / baseQty;
    const requiredQty = Math.ceil(scale * unitNorm - 1e-9);
    const qtyBase = Math.round((await toBaseQty(tx, selectedTubeItem, requiredQty, selectedTubeItem.base_uom)) * 1e6) / 1e6;
    result.push({
      bom_line_id: `auto-tube-${selectedTubeItem.code}`,
      line_no: result.length + 1,
      box_no: 1,
      component_item_id: selectedTubeItem.id,
      component_code: selectedTubeItem.code,
      component_name: selectedTubeItem.name,
      component_role: "PCR_TUBE_STRIP",
      uom: selectedTubeItem.base_uom,
      base_uom: selectedTubeItem.base_uom,
      unit_norm: unitNorm,
      effective_order_qty: effectiveOrderQty,
      demo_ratio_applied: 1,
      scrap_pct: 0,
      raw_qty: requiredQty,
      required_qty: requiredQty,
      qty_base: qtyBase,
      is_bundled: false,
      bundle_parent_code: null,
      allow_substitute: false,
    });
  }

  return result;
}

export interface ProductionStepRow {
  id: string;
  order_id: string;
  routing_step_id: string;
  seq: number;
  step_code: string;
  step_name: string;
  category: string;
  instructions: string;
  sop_doc_code: string | null;
  required_training_doc_code: string | null;
  required_asset_id: string | null;
  asset_id: string | null;
  param_schema: RoutingStepParamDef[];
  param_values: Record<string, unknown>;
  is_qc: boolean;
  requires_check_signature: boolean;
  allow_skip: boolean;
  started_at: string | null;
  completed_at: string | null;
  performed_by: number | null;
  checked_by: number | null;
  checked_at: string | null;
  deviation_id: string | null;
  notes: string | null;
  status: ProductionStepStatus;
  version: number;
}

async function stepOrgUnit(tx: Tx, orderId: string): Promise<string> {
  const o = (await tx.query("SELECT org_unit_id FROM kit.production_order WHERE id = $1", [orderId])).rows[0];
  if (!o) throw notFound("lệnh sản xuất Kit");
  return o.org_unit_id;
}

async function getTolerancePct(tx: Tx): Promise<number> {
  const r = (
    await tx.query("SELECT value FROM core.setting WHERE key = 'kit.material_variance_tolerance_pct'")
  ).rows[0];
  const n = Number(r?.value ?? 5);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

async function getYieldBounds(tx: Tx): Promise<{ min: number; max: number }> {
  const rows = (
    await tx.query("SELECT key, value FROM core.setting WHERE key IN ('kit.min_yield_pct', 'kit.max_yield_pct')")
  ).rows;
  const map = new Map(rows.map((r) => [r.key, Number(r.value)]));
  return {
    min: Number.isFinite(map.get("kit.min_yield_pct")) ? map.get("kit.min_yield_pct")! : 90,
    max: Number.isFinite(map.get("kit.max_yield_pct")) ? map.get("kit.max_yield_pct")! : 102,
  };
}

/**
 * Reconciles actual vs issued material quantities on the warehouse ledger (`inv.stock_document`):
 * - Unused/returned quantities (`issued_qty - actual_qty > 0` or `returned_qty > 0`) are returned to the original lot & location via a `RETURN` stock document.
 * - Over-consumed quantities (`actual_qty - issued_qty > 0`) are issued from the lot/warehouse via an `ISSUE` stock document.
 */
async function syncMaterialReconciliationToLedger(tx: Tx, actor: AuthzActor, order: ProductionOrderRow) {
  if (!order.materials_issued || order.materials_reconciled) return;
  const cons = (
    await tx.query("SELECT * FROM kit.material_consumption WHERE order_id = $1 ORDER BY id FOR UPDATE", [order.id])
  ).rows;

  const returnLines: { item_id: string; lot_id: string; to_location_id: string; qty: number; uom: string }[] = [];
  const extraIssueLines: { item_id: string; lot_id: string; from_location_id: string; qty: number; uom: string }[] = [];

  for (const c of cons) {
    const issued = Number(c.issued_qty);
    const actual = Number(c.actual_qty);
    const diff = Math.round((actual - issued) * 1e6) / 1e6;
    if (diff < -1e-6 && c.lot_id && c.location_id) {
      returnLines.push({
        item_id: c.item_id,
        lot_id: c.lot_id,
        to_location_id: c.location_id,
        qty: Math.abs(diff),
        uom: c.uom,
      });
    } else if (diff > 1e-6) {
      const cands = await findCandidates(tx, c.item_id, [order.warehouse_id], { lock: true });
      const preferred = c.lot_id ? allocate(cands.filter((x) => x.lot_id === c.lot_id), diff) : { picks: [], shortfall: diff };
      const fallback =
        preferred.shortfall > 1e-9
          ? allocate(cands.filter((x) => x.lot_id !== c.lot_id), preferred.shortfall)
          : { picks: [], shortfall: 0 };
      const picks = [...preferred.picks, ...fallback.picks];
      if (fallback.shortfall > 1e-9) {
        const item = await getItem(tx, c.item_id);
        throw invalid(
          `Không đủ tồn kho khả dụng của ${item.code} để hạch toán phần tiêu hao vượt định mức (${diff} ${c.uom}).`,
          undefined,
          "INSUFFICIENT_STOCK"
        );
      }
      for (const p of picks) {
        extraIssueLines.push({
          item_id: c.item_id,
          lot_id: p.candidate.lot_id!,
          from_location_id: p.candidate.location_id,
          qty: p.qty,
          uom: c.uom,
        });
      }
    }
  }

  if (returnLines.length) {
    const retDoc = await createStockDocument(
      tx,
      actor,
      {
        doc_type: "RETURN",
        warehouse_id: order.warehouse_id,
        reason_code: "PRODUCTION_RETURN",
        ref_entity_type: "KIT_ORDER",
        ref_entity_id: order.id,
        notes: `Hoàn trả nguyên vật liệu dư sau quyết toán lệnh ${order.code}`,
        lines: returnLines,
      },
      { trusted: true }
    );
    await runTransition(
      tx,
      stockDocumentMachine,
      actor,
      { id: retDoc.id, action: "post", expectedVersion: retDoc.version },
      { trusted: true }
    );
  }

  if (extraIssueLines.length) {
    const issDoc = await createStockDocument(
      tx,
      actor,
      {
        doc_type: "ISSUE",
        warehouse_id: order.warehouse_id,
        reason_code: "PRODUCTION_ISSUE",
        ref_entity_type: "KIT_ORDER",
        ref_entity_id: order.id,
        notes: `Xuất bổ sung nguyên vật liệu tiêu hao vượt định mức lệnh ${order.code}`,
        lines: extraIssueLines,
      },
      { trusted: true }
    );
    await runTransition(
      tx,
      stockDocumentMachine,
      actor,
      { id: issDoc.id, action: "post", expectedVersion: issDoc.version },
      { trusted: true }
    );
  }

  await tx.query("UPDATE kit.production_order SET materials_reconciled = true WHERE id = $1", [order.id]);
}

/**
 * Kit Production Order State Machine (docs/nha-may/02 §8.2 & §8.4):
 * DRAFT → CONFIRMED → IN_PROGRESS → PENDING_QC → PENDING_RELEASE → COMPLETED ✍
 *       ↘ CANCELLED 📝                        ↘ ON_HOLD 📝
 */
export const productionOrderMachine = defineMachine<ProductionOrderStatus, ProductionOrderRow>({
  entityType: "kit_production_order",
  table: "kit.production_order",
  states: ["DRAFT", "CONFIRMED", "IN_PROGRESS", "PENDING_QC", "PENDING_RELEASE", "ON_HOLD", "COMPLETED", "CANCELLED"],
  terminal: ["COMPLETED", "CANCELLED"],
  scopeOf: (row) => row.org_unit_id,
  transitions: [
    {
      action: "confirm",
      from: "DRAFT",
      to: "CONFIRMED",
      permission: "kit.order.manage",
      guards: [
        {
          code: "SPEC_NOT_EFFECTIVE",
          message: "Định mức BOM và quy trình công đoạn (Routing) phải đang ở trạng thái Có hiệu lực (EFFECTIVE).",
          check: async ({ tx, row }) => {
            const b = (await tx.query("SELECT status FROM kit.bom WHERE id = $1", [row.bom_id])).rows[0];
            const r = (await tx.query("SELECT status FROM kit.routing WHERE id = $1", [row.routing_id])).rows[0];
            return b?.status === "EFFECTIVE" && r?.status === "EFFECTIVE";
          },
        },
      ],
      patch: ({ actor }) => ({ confirmed_by: actor.userId, confirmed_at: new Date() }),
      effects: async ({ tx, actor, updated: row }) => {
        const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1", [row.bom_id])).rows[0] as KitBomRow;
        const mfgDate = row.mfg_date ?? vnToday();
        const expiryDate = row.expiry_date ?? addDays(mfgDate, bom.shelf_life_days || 365);

        // 1. Ensure output Kit lot exists in QUARANTINE with fixed expiry_date from mfg_date + shelf_life_days
        let lotId = row.lot_id;
        if (!lotId) {
          const lot = await createLot(tx, actor, {
            item_id: row.product_item_id,
            origin: "PRODUCTION",
            sequence_key: "LOT_KIT",
            mfg_date: mfgDate,
            expiry_date: expiryDate,
            origin_entity_type: "KIT_ORDER",
            origin_entity_id: row.id,
          });
          lotId = lot.id;
        } else {
          await tx.query(
            "UPDATE inv.lot SET mfg_date = $2, expiry_date = $3, updated_at = now() WHERE id = $1",
            [lotId, mfgDate, expiryDate]
          );
        }

        await tx.query(
          "UPDATE kit.production_order SET lot_id = $2, mfg_date = $3, expiry_date = $4 WHERE id = $1",
          [row.id, lotId, mfgDate, expiryDate]
        );

        // 2. Reserve FEFO/FIFO materials for all non-bundled BOM lines via ABT Smart BOM Explosion Engine (`explodeKitBom`)
        await ensureOrderMaterialConsumptions(tx, actor, row);

        // 3. Copy EBR steps from Routing (including functional step tags & operational flags) if not already initialized at order creation
        await ensureKitBomRoutingAndIfuSchema(tx);
        await ensureKitDailyTrackerAndQcGateSchema(tx);
        const existingStepCnt = Number(
          (await tx.query("SELECT count(*)::int AS c FROM kit.production_step WHERE order_id = $1", [row.id])).rows[0]?.c ?? 0
        );
        if (existingStepCnt === 0) {
          await tx.query(
            `INSERT INTO kit.production_step
               (order_id, routing_step_id, seq, step_code, step_name, category, step_function, work_center, functional_flags,
                instructions, sop_doc_code, required_training_doc_code, required_asset_id, asset_id, param_schema,
                is_qc, requires_check_signature, allow_skip, qc_gate_status)
             SELECT $1, id, seq, step_code, step_name, category,
                    coalesce(step_function, 'FORMULATION_MIXING'),
                    coalesce(work_center, 'Phòng sạch Class 10.000 (ISO 7)'),
                    coalesce(functional_flags, '{}'::jsonb),
                    instructions, sop_doc_code, required_training_doc_code, required_asset_id, required_asset_id, param_schema,
                    is_qc, requires_check_signature, allow_skip,
                    CASE WHEN is_qc THEN 'WAITING_QC' ELSE 'NONE' END
               FROM kit.routing_step WHERE routing_id = $2 ORDER BY seq`,
            [row.id, row.routing_id]
          );
        }
      },
    },
    {
      action: "begin_execution",
      from: "CONFIRMED",
      to: "IN_PROGRESS",
      permission: "kit.ebr.execute",
      guards: [
        {
          code: "LINE_CLEARANCE_REQUIRED",
          message: "Bắt buộc hoàn tất kiểm tra dọn sạch dây chuyền (line_clearance_passed = true) trước khi bắt đầu thực hiện lệnh sản xuất.",
          check: ({ row }) => row.line_clearance_passed === true,
        },
      ],
    },
    {
      action: "submit_qc",
      from: "IN_PROGRESS",
      to: "PENDING_QC",
      permission: "kit.ebr.execute",
      effects: async ({ tx, actor, updated }) => {
        if (updated.lot_id) {
          await tx.query(
            "UPDATE inv.lot SET status = 'PENDING_QC', version = version + 1, updated_at = now() WHERE id = $1 AND status = 'QUARANTINE'",
            [updated.lot_id]
          );
        }
        if (updated.qc_test_id) return;
        const bom = (await tx.query("SELECT qc_spec_id FROM kit.bom WHERE id = $1", [updated.bom_id])).rows[0];
        let specId: string | null = null;
        if (bom?.qc_spec_id) {
          const s = (await tx.query("SELECT id FROM qms.qc_spec WHERE id = $1 AND status = 'EFFECTIVE'", [bom.qc_spec_id])).rows[0];
          specId = s?.id ?? null;
        }
        if (!specId) {
          const eff = await findEffectiveSpec(tx, updated.product_item_id, ["PRODUCT", "ITEM"]);
          specId = eff?.id ?? null;
        }
        if (specId) {
          const test = await createQcTest(tx, actor, {
            entity_type: "PRODUCTION_ORDER",
            entity_id: updated.id,
            spec_id: specId,
            test_kind: "RELEASE",
          });
          await tx.query("UPDATE kit.production_order SET qc_test_id = $2 WHERE id = $1", [updated.id, test.id]);
        }
      },
    },
    {
      action: "cancel",
      from: ["DRAFT", "CONFIRMED"],
      to: "CANCELLED",
      permission: "kit.order.manage",
      reasonRequired: true,
      guards: [
        {
          code: "STEP_ALREADY_STARTED",
          message: "Không thể hủy lệnh sản xuất khi đã có công đoạn bắt đầu thực hiện.",
          check: async ({ tx, row }) => {
            const s = await tx.query(
              "SELECT 1 FROM kit.production_step WHERE order_id = $1 AND status <> 'PENDING' LIMIT 1",
              [row.id]
            );
            return (s.rowCount ?? 0) === 0;
          },
        },
      ],
      effects: async ({ tx, actor, row, reason }) => {
        await releaseDemandReservations(tx, actor, "PRODUCTION_ORDER", row.id, reason ?? "Hủy lệnh sản xuất Kit");
        if (row.materials_issued) {
          const cons = (
            await tx.query(
              "SELECT * FROM kit.material_consumption WHERE order_id = $1 AND issued_qty > 0 ORDER BY id",
              [row.id]
            )
          ).rows;
          if (cons.length) {
            const retDoc = await createStockDocument(
              tx,
              actor,
              {
                doc_type: "RETURN",
                warehouse_id: row.warehouse_id,
                reason_code: "PRODUCTION_RETURN",
                ref_entity_type: "KIT_ORDER",
                ref_entity_id: row.id,
                notes: `Hoàn trả nguyên vật liệu do hủy lệnh ${row.code}`,
                lines: cons.map((c) => ({
                  item_id: c.item_id,
                  lot_id: c.lot_id,
                  to_location_id: c.location_id,
                  qty: Number(c.issued_qty),
                  uom: c.uom,
                })),
              },
              { trusted: true }
            );
            await runTransition(
              tx,
              stockDocumentMachine,
              actor,
              { id: retDoc.id, action: "post", expectedVersion: retDoc.version },
              { trusted: true }
            );
          }
        }
      },
    },
    {
      action: "pass_qc",
      from: "PENDING_QC",
      to: "PENDING_RELEASE",
      permission: "qms.qc.review",
      guards: [
        {
          code: "INVALID_GOOD_QTY",
          message: "Số lượng Kit đạt QC (good_qty) phải lớn hơn 0.",
          check: ({ row, payload }) => Number(payload.good_qty ?? row.planned_qty) > 0,
        },
        {
          code: "QC_TEST_PENDING",
          message: "Phiếu kiểm nghiệm QC của mẻ Kit đang mở và phải được bộ phận QC/QA ký duyệt Đạt (PASS) trước.",
          check: async ({ tx, row }) => {
            if (row.qc_test_id) {
              const qt = (await tx.query("SELECT status, overall_result FROM qms.qc_test WHERE id = $1", [row.qc_test_id])).rows[0];
              return Boolean(qt && qt.status === "REVIEWED" && qt.overall_result === "PASS");
            }
            const bom = row.bom_id
              ? (await tx.query("SELECT qc_spec_id FROM kit.bom WHERE id = $1", [row.bom_id])).rows[0]
              : null;
            if (bom?.qc_spec_id) {
              const spec = (await tx.query("SELECT 1 FROM qms.qc_spec WHERE id = $1 AND status = 'EFFECTIVE'", [bom.qc_spec_id])).rows[0];
              if (spec) return false;
            }
            const eff = await findEffectiveSpec(tx, row.product_item_id, ["PRODUCT", "ITEM"]);
            return !eff?.id;
          },
        },
      ],
      patch: ({ row, payload }) => {
        const planned = Number(row.planned_qty) || 1;
        const goodQty = Number(payload.good_qty ?? row.good_qty ?? row.planned_qty);
        const scrapQty = Number(payload.scrap_qty ?? row.scrap_qty ?? 0);
        const sampleQty = Number(payload.sample_qty ?? row.sample_qty ?? 0);
        const retainQty = Number(payload.retain_qty ?? row.retain_qty ?? 0);
        const yieldPct = Math.round(((goodQty + sampleQty + retainQty) / planned) * 10000) / 100;
        return {
          good_qty: goodQty,
          scrap_qty: scrapQty,
          sample_qty: sampleQty,
          retain_qty: retainQty,
          yield_pct: yieldPct,
          qc_passed: true,
          qc_summary: payload.qc_summary ? String(payload.qc_summary) : "Đạt đầy đủ chỉ tiêu QC xuất xưởng",
        };
      },
      effects: async ({ tx, actor, updated }) => {
        const bounds = await getYieldBounds(tx);
        const y = Number(updated.yield_pct ?? 100);
        if (y < bounds.min || y > bounds.max) {
          await raiseDeviation(tx, actor, {
            source_module: "KIT",
            entity_type: "KIT_ORDER",
            entity_id: updated.id,
            severity: "MEDIUM",
            description: `Hiệu suất mẻ Kit ${updated.code} (${y}%) nằm ngoài giới hạn chuẩn [${bounds.min}% – ${bounds.max}%].`,
          });
        }
      },
    },
    {
      action: "fail_qc",
      from: "PENDING_QC",
      to: "ON_HOLD",
      permission: "kit.order.manage",
      reasonRequired: true,
      patch: ({ reason }) => ({ qc_passed: false, qc_summary: reason ?? null }),
      effects: async ({ tx, actor, row, reason }) => {
        await raiseDeviation(tx, actor, {
          source_module: "KIT",
          entity_type: "KIT_ORDER",
          entity_id: row.id,
          severity: "HIGH",
          description: `Lô Kit thuộc lệnh ${row.code} không đạt QC: ${reason}`,
          ncr: {
            item_id: row.product_item_id,
            lot_id: row.lot_id,
            qty_affected: Number(row.planned_qty),
          },
        });
      },
    },
    {
      action: "hold",
      from: ["IN_PROGRESS", "PENDING_QC", "PENDING_RELEASE"],
      to: "ON_HOLD",
      permission: "kit.order.manage",
      reasonRequired: true,
    },
    {
      action: "rework_from_hold",
      from: "ON_HOLD",
      to: "IN_PROGRESS",
      permission: "kit.order.manage",
      reasonRequired: true,
    },
    {
      action: "resume_from_hold",
      from: "ON_HOLD",
      to: "PENDING_QC",
      permission: "kit.order.manage",
      reasonRequired: true,
    },
    {
      action: "scrap_from_hold",
      from: "ON_HOLD",
      to: "CANCELLED",
      permission: "kit.order.manage",
      signature: "APPROVED",
      reasonRequired: true,
      patch: ({ row, reason }) => ({
        scrap_qty: Number(row.planned_qty),
        good_qty: 0,
        yield_pct: 0,
        qc_passed: false,
        qc_summary: reason ? `Hủy lô (Scrap): ${reason}` : "Hủy lô (Scrap) từ trạng thái tạm giữ",
      }),
      effects: async ({ tx, actor, row, reason }) => {
        await releaseDemandReservations(tx, actor, "PRODUCTION_ORDER", row.id, reason ?? "Hủy lô Kit (Scrap)");
        if (row.lot_id) {
          await tx.query(
            "UPDATE inv.lot SET status = 'REJECTED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
            [row.lot_id, actor.userId]
          );
        }
      },
    },
    {
      action: "release",
      from: "PENDING_RELEASE",
      to: "COMPLETED",
      permission: "kit.order.release",
      signature: "RELEASED",
      guards: [
        {
          code: "QC_PASSED_REQUIRED",
          message: "Lô sản xuất phải được xác nhận Đạt QC (qc_passed = true) trước khi QA giải phóng lô.",
          check: ({ row }) => Boolean(row.qc_passed),
        },
        {
          code: "SELF_RELEASE",
          message: "Người phê duyệt giải phóng lô Kit (QA) phải độc lập với người thực hiện các công đoạn sản xuất và người phân tích / duyệt phiếu QC.",
          check: async ({ tx, actor, row }) => {
            const p = await tx.query(
              "SELECT 1 FROM kit.production_step WHERE order_id = $1 AND performed_by = $2 LIMIT 1",
              [row.id, actor.userId]
            );
            if ((p.rowCount ?? 0) > 0) return false;
            if (row.qc_test_id) {
              const qt = (
                await tx.query("SELECT analyst_id, reviewer_id FROM qms.qc_test WHERE id = $1", [row.qc_test_id])
              ).rows[0];
              if (qt && (qt.analyst_id === actor.userId || qt.reviewer_id === actor.userId)) return false;
            }
            return true;
          },
        },
        {
          code: "OPEN_NCR",
          message: "Không thể giải phóng lô Kit khi đang có phiếu Không phù hợp (NCR) chưa đóng (status <> 'CLOSED') trên lô thành phẩm.",
          check: async ({ tx, row }) => {
            const lotId = (row as any).product_lot_id ?? row.lot_id;
            if (!lotId) return true;
            const ncr = await tx.query(
              "SELECT 1 FROM qms.ncr WHERE (lot_id = $1 OR (entity_type IN ('KIT_ORDER', 'PRODUCTION_ORDER') AND entity_id = $2)) AND status <> 'CLOSED' LIMIT 1",
              [lotId, row.id]
            );
            return (ncr.rowCount ?? 0) === 0;
          },
        },
        {
          code: "EBR_INCOMPLETE",
          message: "Tất cả bước trong hồ sơ lô điện tử (EBR) phải hoàn tất (DONE hoặc SKIPPED) trước khi giải phóng lô.",
          check: async ({ tx, row }) => {
            const inc = await tx.query(
              "SELECT 1 FROM kit.production_step WHERE order_id = $1 AND status NOT IN ('DONE', 'SKIPPED') LIMIT 1",
              [row.id]
            );
            return (inc.rowCount ?? 0) === 0;
          },
        },
        {
          code: "RECONCILIATION_VARIANCE",
          message:
            "Chênh lệch quyết toán nguyên vật liệu vượt ngưỡng cho phép. Bắt buộc nhập lý do giải trình hao hụt trước khi giải phóng lô.",
          check: async ({ tx, row, payload }) => {
            const tol = await getTolerancePct(tx);
            const cons = (
              await tx.query("SELECT * FROM kit.material_consumption WHERE order_id = $1", [row.id])
            ).rows;
            const orderNote = String(payload.reconciliation_note ?? row.reconciliation_note ?? "").trim();
            for (const c of cons) {
              const planned = Number(c.planned_qty);
              const actual = Number(c.actual_qty);
              const variancePct = planned > 0 ? (Math.abs(actual - planned) / planned) * 100 : 0;
              if (variancePct > tol && !String(c.variance_reason ?? "").trim() && !orderNote) {
                return false;
              }
            }
            return true;
          },
        },
      ],
      patch: ({ actor, row, payload }) => ({
        released_by: actor.userId,
        released_at: new Date(),
        reconciliation_note: payload.reconciliation_note
          ? String(payload.reconciliation_note)
          : row.reconciliation_note,
      }),
      effects: async ({ tx, actor, updated, reason }) => {
        if (!updated.lot_id) throw invalid("Lệnh sản xuất chưa được gắn mã lô Kit.");

        // 0. Sync any material consumption variances (returns / extra issues) to the inventory ledger
        await syncMaterialReconciliationToLedger(tx, actor, updated);

        // 1. Transition Kit lot to RELEASED with full audit trail & outbox event
        const lotBefore = (await tx.query("SELECT * FROM inv.lot WHERE id = $1 FOR UPDATE", [updated.lot_id])).rows[0];
        if (lotBefore && lotBefore.status !== "RELEASED") {
          await tx.query(
            "UPDATE inv.lot SET status = 'RELEASED', version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
            [updated.lot_id, actor.userId]
          );
          await writeAudit(tx, actor, {
            entityType: "lot",
            entityId: updated.lot_id,
            action: "release",
            changes: { status: [lotBefore.status, "RELEASED"] },
            reason: reason ?? `Giải phóng lô thành phẩm Kit từ lệnh ${updated.code}`,
          });
          await enqueueEvent(tx, "lot.release", {
            id: updated.lot_id,
            from: lotBefore.status,
            to: "RELEASED",
            by: actor.userId,
          });
        }

        // 2. Find an active non-quarantine location in the order's warehouse to receive the finished Kit lot
        const loc = (
          await tx.query(
            `SELECT id FROM master.location
              WHERE warehouse_id = $1 AND status = 'ACTIVE' AND is_quarantine = false
              ORDER BY code LIMIT 1`,
            [updated.warehouse_id]
          )
        ).rows[0];
        if (!loc) throw invalid("Kho thành phẩm chưa có vị trí lưu trữ hoạt động (ngoài khu biệt trữ).");

        const rcpt = await createStockDocument(
          tx,
          actor,
          {
            doc_type: "RECEIPT",
            warehouse_id: updated.warehouse_id,
            reason_code: "PRODUCTION_OUTPUT",
            ref_entity_type: "KIT_ORDER",
            ref_entity_id: updated.id,
            notes: `Nhập kho thành phẩm Kit từ lệnh ${updated.code}`,
            lines: [
              {
                item_id: updated.product_item_id,
                lot_id: updated.lot_id,
                to_location_id: loc.id,
                qty: Number(updated.good_qty),
                uom: updated.uom,
              },
            ],
          },
          { trusted: true }
        );
        await runTransition(
          tx,
          stockDocumentMachine,
          actor,
          { id: rcpt.id, action: "post", expectedVersion: rcpt.version },
          { trusted: true }
        );

        // 3. Record 2-way lot genealogy (parent material lots -> child Kit lot)
        const cons = (
          await tx.query(
            "SELECT lot_id, actual_qty, uom FROM kit.material_consumption WHERE order_id = $1 AND lot_id IS NOT NULL AND actual_qty > 0",
            [updated.id]
          )
        ).rows;
        for (const c of cons) {
          if (c.lot_id === updated.lot_id) continue;
          await tx.query(
            `INSERT INTO kit.lot_genealogy (parent_lot_id, child_lot_id, production_order_id, qty_used, uom)
             VALUES ($1, $2, $3, $4, $5)`,
            [c.lot_id, updated.lot_id, updated.id, c.actual_qty, c.uom]
          );
        }

        // 4. Sync / Ensure official COA certificate issued by QA/QC (`kit.coa_certificate`)
        // COA is officially issued at the QA/QC tab (`issueCoaFromQcTest`) and mapped here.
        const existingCoa = (
          await tx.query(
            "SELECT id FROM kit.coa_certificate WHERE lot_id = $1 OR production_order_id = $2 LIMIT 1",
            [updated.lot_id, updated.id]
          )
        ).rows[0];

        if (!existingCoa && updated.qc_test_id) {
          const qt = (await tx.query("SELECT status, overall_result FROM qms.qc_test WHERE id = $1", [updated.qc_test_id])).rows[0];
          if (qt?.status === "REVIEWED" && qt?.overall_result === "PASS") {
            await issueCoaFromQcTest(tx, actor, {
              test_id: updated.qc_test_id,
              qc_summary: updated.qc_summary ?? undefined,
            });
          }
        }

        const coaAfterQc = (
          await tx.query(
            "SELECT id FROM kit.coa_certificate WHERE lot_id = $1 OR production_order_id = $2 LIMIT 1",
            [updated.lot_id, updated.id]
          )
        ).rows[0];

        if (!coaAfterQc) {
          const coaCode = await nextNumber(tx, "KIT_COA");
          const prod = await getItem(tx, updated.product_item_id);
          const lotRow = (await tx.query("SELECT code, mfg_date, expiry_date FROM inv.lot WHERE id = $1", [updated.lot_id]))
            .rows[0];
          const bomRow = (await tx.query("SELECT tests_per_kit FROM kit.bom WHERE id = $1", [updated.bom_id])).rows[0];
          const packRows = (
            await tx.query("SELECT * FROM kit.kit_packaging WHERE bom_id = $1 ORDER BY box_no, id", [updated.bom_id])
          ).rows;
          const stepRows = (
            await tx.query(
              "SELECT seq, step_code, step_name, is_qc, param_values, completed_at FROM kit.production_step WHERE order_id = $1 ORDER BY seq",
              [updated.id]
            )
          ).rows;
          const issuer = (
            await tx.query("SELECT display_name FROM core.user_profile WHERE user_id = $1", [actor.userId])
          ).rows[0];

          await tx.query(
            `INSERT INTO kit.coa_certificate
               (code, lot_id, production_order_id, product_code, product_name, lot_code,
                mfg_date, expiry_date, tests_per_kit, good_qty, uom, qc_summary,
                qc_results_snapshot, packaging_snapshot, issued_by, issued_by_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16)`,
            [
              coaCode,
              updated.lot_id,
              updated.id,
              prod.code,
              prod.name,
              lotRow.code,
              updated.mfg_date ?? lotRow.mfg_date,
              updated.expiry_date ?? lotRow.expiry_date,
              bomRow?.tests_per_kit ?? 50,
              updated.good_qty,
              updated.uom,
              updated.qc_summary ?? "Đạt tiêu chuẩn xuất xưởng",
              JSON.stringify(stepRows),
              JSON.stringify(packRows),
              actor.userId,
              issuer?.display_name ?? actor.name,
            ]
          );
        }
      },
    },
  ],
});

async function checkAndAdvanceOrderToPendingQc(tx: Tx, actor: AuthzActor, orderId: string) {
  const remaining = await tx.query(
    "SELECT 1 FROM kit.production_step WHERE order_id = $1 AND status NOT IN ('DONE', 'SKIPPED') LIMIT 1",
    [orderId]
  );
  if ((remaining.rowCount ?? 0) === 0) {
    const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
      | ProductionOrderRow
      | undefined;
    if (order && order.status === "IN_PROGRESS") {
      await runTransition(
        tx,
        productionOrderMachine,
        actor,
        { id: order.id, action: "submit_qc", expectedVersion: order.version },
        { trusted: true }
      );
    }
  }
}

async function evaluateStepParamsAndDeviation(
  tx: Tx,
  actor: AuthzActor,
  step: ProductionStepRow,
  values: Record<string, unknown>
): Promise<string | null> {
  const schema = Array.isArray(step.param_schema) ? step.param_schema : [];
  const outOfRange: string[] = [];
  for (const field of schema) {
    const val = values[field.key];
    if (field.type === "number" && val !== undefined && val !== null && val !== "") {
      const num = Number(val);
      if (field.min !== null && field.min !== undefined && num < field.min) {
        outOfRange.push(`${field.label} = ${num} ${field.unit ?? ""} (< min ${field.min})`);
      }
      if (field.max !== null && field.max !== undefined && num > field.max) {
        outOfRange.push(`${field.label} = ${num} ${field.unit ?? ""} (> max ${field.max})`);
      }
    }
  }
  if (!outOfRange.length) return step.deviation_id;
  const dev = await raiseDeviation(tx, actor, {
    source_module: "KIT",
    entity_type: "KIT_STEP",
    entity_id: step.id,
    step_ref: step.step_code,
    performer_id: actor.userId,
    severity: "MEDIUM",
    description: `Thông số công đoạn ${step.step_code} (${step.step_name}) nằm ngoài giới hạn quy định: ${outOfRange.join("; ")}`,
  });
  return dev.deviation_id;
}

/**
 * Electronic Batch Record (EBR) Step State Machine (docs/nha-may/02 §8.3):
 * PENDING → IN_PROGRESS → AWAITING_CHECK → DONE ✍
 *                       ↘ DONE ✍ (when !requires_check_signature)
 *                       ↘ FAILED 📝
 *         ↘ SKIPPED 📝 ✍
 */
export const productionStepMachine = defineMachine<ProductionStepStatus, ProductionStepRow>({
  entityType: "kit_production_step",
  table: "kit.production_step",
  states: ["PENDING", "IN_PROGRESS", "AWAITING_CHECK", "DONE", "FAILED", "SKIPPED"],
  terminal: ["DONE", "SKIPPED"],
  scopeOf: (row, tx) => stepOrgUnit(tx, row.order_id),
  transitions: [
    {
      action: "start",
      from: "PENDING",
      to: "IN_PROGRESS",
      permission: "kit.ebr.execute",
      guards: [
        {
          code: "MATERIALS_NOT_ISSUED",
          message: "Phải xuất kho nguyên vật liệu cho lệnh sản xuất trước khi bắt đầu công đoạn đầu tiên.",
          check: async ({ tx, row }) => {
            const o = (
              await tx.query("SELECT materials_issued, status FROM kit.production_order WHERE id = $1", [row.order_id])
            ).rows[0];
            return Boolean(o?.materials_issued) && ["CONFIRMED", "IN_PROGRESS"].includes(o?.status);
          },
        },
        {
          code: "PREV_STEP_INCOMPLETE",
          message: "Không được nhảy cóc công đoạn: các bước đứng trước phải ở trạng thái Hoàn thành (DONE) hoặc Bỏ qua (SKIPPED).",
          check: async ({ tx, row }) => {
            const prev = await tx.query(
              "SELECT 1 FROM kit.production_step WHERE order_id = $1 AND seq < $2 AND status NOT IN ('DONE', 'SKIPPED') LIMIT 1",
              [row.order_id, row.seq]
            );
            return (prev.rowCount ?? 0) === 0;
          },
        },
        {
          code: "IPC_GATE_LOCKED",
          message:
            "Chốt chặn QC xen kẽ (IPQC Gate): Công đoạn đứng trước có kiểm soát chất lượng trung gian (is_qc) nhưng chưa được bộ phận QA/QC xác nhận Thông qua (PASSED). Chờ QC xác nhận thông qua mới được tiếp tục.",
          check: async ({ tx, row }) => {
            const unverifiedQc = await tx.query(
              "SELECT 1 FROM kit.production_step WHERE order_id = $1 AND seq < $2 AND is_qc = true AND coalesce(qc_gate_status, 'WAITING_QC') <> 'PASSED' LIMIT 1",
              [row.order_id, row.seq]
            );
            return (unverifiedQc.rowCount ?? 0) === 0;
          },
        },
        {
          code: "SOP_TRAINING_REQUIRED",
          message: "Nhân sự thực hiện chưa có hồ sơ đào tạo đạt (PASS) và còn hiệu lực đối với SOP của công đoạn này.",
          check: async ({ tx, actor, row }) =>
            isUserTrainedForSop(tx, actor.userId, row.required_training_doc_code ?? row.sop_doc_code),
        },
        {
          code: "ASSET_CHECK",
          message: "Thiết bị sử dụng cho công đoạn không sẵn sàng hoặc đã quá hạn hiệu chuẩn.",
          check: async ({ tx, row, payload }) => {
            const assetId = (payload.asset_id as string | undefined) ?? row.asset_id ?? row.required_asset_id;
            if (!assetId) return true;
            await assertUsable(tx, assetId);
            return true;
          },
        },
      ],
      patch: ({ row, payload }) => ({
        started_at: new Date(),
        asset_id: (payload.asset_id as string | undefined) ?? row.asset_id ?? row.required_asset_id,
      }),
      effects: async ({ tx, actor, row }) => {
        const order = (
          await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [row.order_id])
        ).rows[0] as ProductionOrderRow | undefined;
        if (order && order.status === "CONFIRMED") {
          await runTransition(
            tx,
            productionOrderMachine,
            actor,
            { id: order.id, action: "begin_execution", expectedVersion: order.version },
            { trusted: true }
          );
        }
      },
    },
    {
      action: "complete",
      from: "IN_PROGRESS",
      to: "DONE",
      permission: "kit.ebr.execute",
      signature: "PERFORMED",
      guards: [
        {
          code: "REQUIRES_CHECK",
          message: "Công đoạn trọng yếu này yêu cầu chữ ký kiểm tra thứ hai; hãy dùng hành động 'Hoàn tất & Chờ kiểm tra'.",
          check: ({ row }) => !row.requires_check_signature,
        },
        {
          code: "SOP_TRAINING_REQUIRED",
          message: "Nhân sự ký hoàn tất chưa có hồ sơ đào tạo đạt (PASS) và còn hiệu lực đối với SOP của công đoạn này.",
          check: async ({ tx, actor, row }) =>
            isUserTrainedForSop(tx, actor.userId, row.required_training_doc_code ?? row.sop_doc_code),
        },
        {
          code: "QC_ROLE_REQUIRED",
          message: "Bước kiểm tra QC bắt buộc do nhân sự có quyền QC thực hiện.",
          check: async ({ tx, actor, row }) => {
            if (!row.is_qc) return true;
            return (
              (await hasFactoryPermission(tx, actor, "qms.qc.analyze")) ||
              (await hasFactoryPermission(tx, actor, "qms.qc.review"))
            );
          },
        },
        {
          code: "MISSING_PARAMS",
          message: "Vui lòng nhập đầy đủ các thông số bắt buộc của công đoạn.",
          check: ({ row, payload }) => {
            const vals = (payload.param_values ?? row.param_values ?? {}) as Record<string, unknown>;
            const schema = Array.isArray(row.param_schema) ? row.param_schema : [];
            return schema.every((f) => !f.required || (vals[f.key] !== undefined && vals[f.key] !== null && vals[f.key] !== ""));
          },
        },
      ],
      patch: ({ actor, row, payload }) => ({
        param_values: (payload.param_values ?? row.param_values ?? {}) as Record<string, unknown>,
        notes: payload.notes ? String(payload.notes) : row.notes,
        performed_by: actor.userId,
        completed_at: new Date(),
      }),
      effects: async ({ tx, actor, updated }) => {
        const devId = await evaluateStepParamsAndDeviation(tx, actor, updated, updated.param_values);
        if (devId && devId !== updated.deviation_id) {
          await tx.query("UPDATE kit.production_step SET deviation_id = $2 WHERE id = $1", [updated.id, devId]);
        }
        const phVal =
          updated.param_values?.ph ??
          updated.param_values?.actual_ph ??
          updated.param_values?.pH ??
          updated.param_values?.PH;
        if (phVal !== undefined && phVal !== null && String(phVal).trim() !== "") {
          await tx.query("UPDATE kit.production_order SET actual_ph = $2 WHERE id = $1", [
            updated.order_id,
            String(phVal).trim(),
          ]);
        }
        await checkAndAdvanceOrderToPendingQc(tx, actor, updated.order_id);
      },
    },
    {
      action: "complete_for_check",
      from: "IN_PROGRESS",
      to: "AWAITING_CHECK",
      permission: "kit.ebr.execute",
      signature: "PERFORMED",
      guards: [
        {
          code: "SOP_TRAINING_REQUIRED",
          message: "Nhân sự ký hoàn tất chưa có hồ sơ đào tạo đạt (PASS) và còn hiệu lực đối với SOP của công đoạn này.",
          check: async ({ tx, actor, row }) =>
            isUserTrainedForSop(tx, actor.userId, row.required_training_doc_code ?? row.sop_doc_code),
        },
        {
          code: "QC_ROLE_REQUIRED",
          message: "Bước kiểm tra QC bắt buộc do nhân sự có quyền QC thực hiện.",
          check: async ({ tx, actor, row }) => {
            if (!row.is_qc) return true;
            return (
              (await hasFactoryPermission(tx, actor, "qms.qc.analyze")) ||
              (await hasFactoryPermission(tx, actor, "qms.qc.review"))
            );
          },
        },
        {
          code: "MISSING_PARAMS",
          message: "Vui lòng nhập đầy đủ các thông số bắt buộc của công đoạn.",
          check: ({ row, payload }) => {
            const vals = (payload.param_values ?? row.param_values ?? {}) as Record<string, unknown>;
            const schema = Array.isArray(row.param_schema) ? row.param_schema : [];
            return schema.every((f) => !f.required || (vals[f.key] !== undefined && vals[f.key] !== null && vals[f.key] !== ""));
          },
        },
      ],
      patch: ({ actor, row, payload }) => ({
        param_values: (payload.param_values ?? row.param_values ?? {}) as Record<string, unknown>,
        notes: payload.notes ? String(payload.notes) : row.notes,
        performed_by: actor.userId,
        completed_at: new Date(),
      }),
      effects: async ({ tx, actor, updated }) => {
        const devId = await evaluateStepParamsAndDeviation(tx, actor, updated, updated.param_values);
        if (devId && devId !== updated.deviation_id) {
          await tx.query("UPDATE kit.production_step SET deviation_id = $2 WHERE id = $1", [updated.id, devId]);
        }
        const phVal =
          updated.param_values?.ph ??
          updated.param_values?.actual_ph ??
          updated.param_values?.pH ??
          updated.param_values?.PH;
        if (phVal !== undefined && phVal !== null && String(phVal).trim() !== "") {
          await tx.query("UPDATE kit.production_order SET actual_ph = $2 WHERE id = $1", [
            updated.order_id,
            String(phVal).trim(),
          ]);
        }
      },
    },
    {
      action: "check",
      from: "AWAITING_CHECK",
      to: "DONE",
      permission: "kit.ebr.check",
      signature: "CHECKED",
      guards: [
        {
          code: "SELF_CHECK",
          message: "Người ký kiểm tra chéo (Checked) phải khác người trực tiếp thực hiện bước này (Performed).",
          check: ({ actor, row }) => row.performed_by !== actor.userId,
        },
      ],
      patch: ({ actor }) => ({ checked_by: actor.userId, checked_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        await checkAndAdvanceOrderToPendingQc(tx, actor, updated.order_id);
      },
    },
    {
      action: "fail",
      from: "IN_PROGRESS",
      to: "FAILED",
      permission: "kit.ebr.execute",
      reasonRequired: true,
      patch: ({ actor, reason }) => ({ performed_by: actor.userId, completed_at: new Date(), notes: reason ?? null }),
      effects: async ({ tx, actor, updated, reason }) => {
        const dev = await raiseDeviation(tx, actor, {
          source_module: "KIT",
          entity_type: "KIT_STEP",
          entity_id: updated.id,
          step_ref: updated.step_code,
          performer_id: actor.userId,
          severity: "HIGH",
          description: `Công đoạn ${updated.step_code} (${updated.step_name}) thất bại: ${reason}`,
        });
        await tx.query("UPDATE kit.production_step SET deviation_id = $2 WHERE id = $1", [updated.id, dev.deviation_id]);
        const order = (
          await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [updated.order_id])
        ).rows[0] as ProductionOrderRow | undefined;
        if (order && ["IN_PROGRESS", "PENDING_QC", "PENDING_RELEASE"].includes(order.status)) {
          await runTransition(
            tx,
            productionOrderMachine,
            actor,
            {
              id: order.id,
              action: "hold",
              expectedVersion: order.version,
              reason: `Tạm giữ tự động do công đoạn ${updated.step_code} thất bại: ${reason}`,
            },
            { trusted: true }
          );
        }
      },
    },
    {
      action: "reopen",
      from: "FAILED",
      to: "IN_PROGRESS",
      permission: "kit.order.manage",
      reasonRequired: true,
    },
    {
      action: "skip",
      from: "PENDING",
      to: "SKIPPED",
      permission: "kit.order.manage",
      signature: "APPROVED",
      reasonRequired: true,
      guards: [
        {
          code: "SKIP_NOT_ALLOWED",
          message: "Công đoạn này là bắt buộc trong quy trình chuẩn và không cho phép bỏ qua.",
          check: ({ row }) => Boolean(row.allow_skip),
        },
      ],
      patch: ({ reason }) => ({ notes: reason ?? null, completed_at: new Date() }),
      effects: async ({ tx, actor, updated }) => {
        await checkAndAdvanceOrderToPendingQc(tx, actor, updated.order_id);
      },
    },
  ],
});

// ---- QA/QC Subject Hook for Kit Production Orders ----
registerQcSubject("PRODUCTION_ORDER", {
  label: async (tx, id) => {
    const o = (
      await tx.query(
        "SELECT o.code, i.code AS product_code, l.code AS lot_code FROM kit.production_order o JOIN master.item i ON i.id = o.product_item_id LEFT JOIN inv.lot l ON l.id = o.lot_id WHERE o.id = $1",
        [id]
      )
    ).rows[0];
    return o ? `lệnh SX Kit ${o.code} (${o.product_code}, lô ${o.lot_code ?? "N/A"})` : `lệnh SX Kit ${id}`;
  },
  reference: async (tx, id) =>
    (
      await tx.query(
        `SELECT o.code, o.planned_qty::float AS planned_qty, o.good_qty::float AS good_qty, o.uom,
                o.mfg_date::text AS mfg_date, o.expiry_date::text AS expiry_date,
                i.code AS product_code, i.name AS product_name, l.code AS lot_code
           FROM kit.production_order o
           JOIN master.item i ON i.id = o.product_item_id
           LEFT JOIN inv.lot l ON l.id = o.lot_id
          WHERE o.id = $1`,
        [id]
      )
    ).rows[0] ?? {},
  onReviewed: async (tx, actor, test) => {
    const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [test.entity_id])).rows[0] as
      | ProductionOrderRow
      | undefined;
    if (!order) return;
    if (test.overall_result === "PASS") {
      if (order.status === "PENDING_QC") {
        await runTransition(
          tx,
          productionOrderMachine,
          actor,
          {
            id: order.id,
            action: "pass_qc",
            expectedVersion: order.version,
            payload: {
              _from_qc_review: true,
              good_qty: Number(order.good_qty || order.planned_qty),
              qc_summary: `Đạt QC theo phiếu kiểm nghiệm ${test.code}`,
            },
          },
          { trusted: true }
        );
      }
      // Automatically issue official COA at QA/QC and map to Kit & Lot
      if (order.lot_id) {
        await issueCoaFromQcTest(tx, actor, {
          test_id: test.id,
          qc_summary: `Đạt tiêu chuẩn kiểm nghiệm chất lượng theo phiếu QC ${test.code}`,
        });
      }
    } else if (order.status === "PENDING_QC") {
      await runTransition(
        tx,
        productionOrderMachine,
        actor,
        {
          id: order.id,
          action: "fail_qc",
          expectedVersion: order.version,
          reason: `Phiếu kiểm nghiệm QC ${test.code} không đạt (FAIL).`,
        },
        { trusted: true }
      );
    }
  },
});

const lineClearanceSchema = z.object({
  uv_sterilized: z.boolean().optional(),
  prev_labels_cleared: z.boolean().optional(),
  bench_sanitized: z.boolean().optional(),
  env_temp_ok: z.boolean().optional(),
  workstation_sanitized_uv: z.boolean().optional(),
  previous_labels_destroyed: z.boolean().optional(),
  previous_lot_removed: z.boolean().optional(),
  environmental_temp_humidity_ok: z.boolean().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

/**
 * Records GMP Line Clearance (dọn quang dây chuyền, khử trùng UV, loại bỏ nhãn lô trước)
 * on a Kit Production Order before or during EBR execution.
 */
export async function verifyLineClearance(tx: Tx, actor: AuthzActor, orderId: string, input: unknown) {
  const d = parseInput(lineClearanceSchema, input);
  const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | ProductionOrderRow
    | undefined;
  if (!order) throw notFound("lệnh sản xuất Kit");
  await authorize(tx, actor, "kit.ebr.execute", order.org_unit_id);
  const uvOk = Boolean(d.uv_sterilized ?? d.workstation_sanitized_uv);
  const labelsOk = Boolean(d.prev_labels_cleared ?? d.previous_labels_destroyed);
  const benchOk = Boolean(d.bench_sanitized ?? d.previous_lot_removed);
  const envOk = Boolean(d.env_temp_ok ?? d.environmental_temp_humidity_ok);
  if (!uvOk || !labelsOk || !benchOk || !envOk) {
    throw invalid("Tất cả 4 hạng mục dọn quang dây chuyền (Line Clearance) phải được tích xác nhận đạt mới được tiếp tục.");
  }
  const checklist = {
    uv_sterilized: uvOk,
    prev_labels_cleared: labelsOk,
    bench_sanitized: benchOk,
    env_temp_ok: envOk,
    notes: d.notes ?? null,
  };
  const upd = (
    await tx.query(
      `UPDATE kit.production_order
          SET line_clearance_passed = true, line_clearance_by = $2, line_clearance_at = now(),
              line_clearance_checklist = $3::jsonb, version = version + 1, updated_at = now(), updated_by = $2
        WHERE id = $1 RETURNING *`,
      [orderId, actor.userId, JSON.stringify(checklist)]
    )
  ).rows[0] as ProductionOrderRow;

  await writeAudit(tx, actor, {
    entityType: "kit_production_order",
    entityId: orderId,
    action: "verify_line_clearance",
    changes: { line_clearance_passed: [order.line_clearance_passed, true] },
  });
  return upd;
}

const createOrderSchema = z.object({
  org_unit_id: z.string().uuid("chọn phòng Sản xuất Kit"),
  product_item_id: z.string().uuid("chọn sản phẩm Kit / Bán thành phẩm"),
  bom_id: z.string().uuid().optional().nullable(),
  routing_id: z.string().uuid().optional().nullable(),
  warehouse_id: z.string().uuid("chọn kho xuất nguyên liệu & nhập thành phẩm"),
  planned_qty: z.coerce.number().positive("số lượng kế hoạch phải > 0"),
  lot_code: z.string().trim().max(80).optional().nullable(),
  mfg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  order_mode: z.enum(["STANDARD", "ALIQUOTED", "DEMO"]).optional(),
  supply_form: z.enum(["NO_SPLIT_NO_IC", "NO_SPLIT_WITH_IC", "SPLIT_NO_IC", "SPLIT_WITH_IC"]).optional().nullable(),
  tube_code: z.string().trim().max(20).optional().nullable(),
  is_aliquoted: z.boolean().optional(),
  is_demo: z.boolean().optional(),
  demo_specification: z.string().trim().max(100).optional().nullable(),
  qc_retention_qty: z.coerce.number().min(0).default(0),
  no_retention: z.boolean().default(false),
  actual_ph: z.string().trim().max(40).optional().nullable(),
  internal_order_line_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Tự động sinh Mã Lô thành phẩm Kit PCR theo chuẩn ABT:
 * - B{YYMM}{NNN}.[mã tube]: không chia sẵn, không sẵn IC
 * - B{YYMM}{NNN}.IC.[mã tube]: không chia sẵn, sẵn IC
 * - B{YYMM}{NNN}.C.[mã tube]: chia sẵn, không sẵn IC
 * - B{YYMM}{NNN}.C.IC.[mã tube]: chia sẵn, sẵn IC
 */
async function generateAbtStructuredKitLotCode(
  tx: Tx,
  mfgDate: string,
  supplyForm: string | null | undefined,
  tubeCode: string | null | undefined
): Promise<string> {
  const dt = /^\d{4}-\d{2}/.test(mfgDate) ? mfgDate : vnToday();
  const yy = dt.slice(2, 4);
  const mm = dt.slice(5, 7);
  const prefix = `B${yy}${mm}`;
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [prefix]);
  const existingRows = (
    await tx.query("SELECT code FROM inv.lot WHERE upper(code) LIKE $1", [`${prefix}%`])
  ).rows as Array<{ code: string }>;

  let maxSeq = 0;
  for (const r of existingRows) {
    const basePart = String(r.code || "").split(".")[0].toUpperCase();
    const m = basePart.match(/^B\d{4}(\d{3,4})$/);
    if (m) {
      const n = Number(m[1]);
      if (n > maxSeq) maxSeq = n;
    }
  }
  const baseLot = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
  const sf = String(supplyForm || "").toUpperCase();
  const infix =
    sf === "SPLIT_WITH_IC"
      ? "C.IC"
      : sf === "SPLIT_NO_IC"
        ? "C"
        : sf === "NO_SPLIT_WITH_IC"
          ? "IC"
          : "";
  const tube = String(tubeCode || "").trim().toUpperCase();
  const parts = [baseLot];
  if (infix) parts.push(infix);
  if (tube) parts.push(tube);
  return parts.join(".");
}

export async function createProductionOrder(tx: Tx, actor: AuthzActor, input: unknown) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  const d = parseInput(createOrderSchema, input);
  await authorize(tx, actor, "kit.order.manage", d.org_unit_id);
  const product = await getItem(tx, d.product_item_id);

  const parsedTypedLot = parseLotCodeToSupplyFormAndTube(d.lot_code);

  const requestedSupplyForm =
    parsedTypedLot.supplyForm ||
    d.supply_form ||
    (d.order_mode === "ALIQUOTED" || d.is_aliquoted
      ? "SPLIT_WITH_IC"
      : "NO_SPLIT_NO_IC");
  const targetVariantCode =
    requestedSupplyForm === "SPLIT_WITH_IC"
      ? "C.IC"
      : requestedSupplyForm === "SPLIT_NO_IC"
        ? "C"
        : requestedSupplyForm === "NO_SPLIT_WITH_IC"
          ? "IC"
          : "BASE";

  let bomId = d.bom_id ?? null;
  if (!bomId) {
    // Ưu tiên tìm BOM con (variant_code / supply_form) khớp với dạng cung cấp của Mã sản phẩm chính, nếu không có thì lấy BOM gốc EFFECTIVE của Mã chính
    const effBom = (
      await tx.query(
        `SELECT id FROM kit.bom
          WHERE product_item_id = $1 AND status = 'EFFECTIVE'
          ORDER BY
            CASE
              WHEN upper(coalesce(supply_form, '')) = $2 OR upper(coalesce(variant_code, 'BASE')) = $3 THEN 0
              WHEN upper(coalesce(variant_code, 'BASE')) = 'BASE' THEN 1
              ELSE 2
            END ASC,
            bom_version DESC
          LIMIT 1`,
        [d.product_item_id, requestedSupplyForm, targetVariantCode]
      )
    ).rows[0];
    if (!effBom) throw invalid("Sản phẩm chưa có định mức BOM đang có hiệu lực (EFFECTIVE).");
    bomId = effBom.id;
  }

  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1", [bomId])).rows[0] as (KitBomRow & Record<string, unknown>) | undefined;
  if (!bom || bom.product_item_id !== d.product_item_id) throw invalid("BOM không thuộc sản phẩm đã chọn.");

  if (bom.status !== "EFFECTIVE") {
    throw invalid(
      `Định mức BOM ${String(bom.code)} hiện đang ở trạng thái ${String(bom.status)}; phải được phê duyệt có hiệu lực (EFFECTIVE) trước khi phát lệnh sản xuất.`,
      undefined,
      "BOM_NOT_EFFECTIVE"
    );
  }

  let routingId = d.routing_id ?? (bom.routing_id ? String(bom.routing_id) : null);
  if (routingId) {
    const chosenRt = (await tx.query("SELECT id, status, product_item_id FROM kit.routing WHERE id = $1", [routingId])).rows[0];
    if (!chosenRt || chosenRt.status !== "EFFECTIVE") {
      if (d.routing_id) {
        throw invalid("Quy trình công đoạn (Routing) được chọn chưa có hiệu lực (EFFECTIVE).", undefined, "ROUTING_NOT_EFFECTIVE");
      }
      routingId = null;
    } else if (!d.routing_id && !chosenRt.product_item_id) {
      const dedicatedRt = (
        await tx.query(
          "SELECT id FROM kit.routing WHERE product_item_id = $1 AND status = 'EFFECTIVE' ORDER BY routing_version DESC LIMIT 1",
          [d.product_item_id]
        )
      ).rows[0];
      if (dedicatedRt?.id) routingId = String(dedicatedRt.id);
    }
  }
  if (!routingId) {
    const isSemiBom =
      product.item_type === "SEMI_FINISHED" || String(bom.bom_type || "finished_good") === "semi_finished";
    const isLyoBom = !isSemiBom && /đông khô|lyo/i.test(`${product.code} ${product.name} ${bom.name || ""}`);
    const isExtractionBom = !isSemiBom && !isLyoBom && String(bom.bom_category || "PCR Kit") !== "PCR Kit";
    const preferredSharedCode = isSemiBom
      ? "RTG-BTP-MIX"
      : isLyoBom
        ? "RTG-PCR-LYO"
        : isExtractionBom
          ? "RTG-EXT-BUF"
          : "RTG-PCR-STD";

    const effRt = (
      await tx.query(
        `SELECT id FROM kit.routing
          WHERE status = 'EFFECTIVE'
            AND (product_item_id = $1 OR code = $2 OR product_item_id IS NULL)
          ORDER BY
            CASE
              WHEN product_item_id = $1 THEN 0
              WHEN code = $2 THEN 1
              ELSE 2
            END ASC,
            routing_version DESC
          LIMIT 1`,
        [d.product_item_id, preferredSharedCode]
      )
    ).rows[0];
    if (!effRt) {
      throw invalid(
        "Sản phẩm chưa có Quy trình công đoạn (Routing) đang có hiệu lực (EFFECTIVE). Vui lòng phê duyệt Routing trước khi phát lệnh.",
        undefined,
        "MISSING_EFFECTIVE_ROUTING"
      );
    }
    routingId = effRt.id;
  }

  const mfgDate = d.mfg_date ?? vnToday();
  const expiryDate = addDays(mfgDate, bom.shelf_life_days || product.shelf_life_days || 365);
  const code = await nextNumber(tx, "KIT_ORDER");

  const isPcrKit =
    product.item_type !== "SEMI_FINISHED" &&
    String(bom.bom_type || "finished_good") !== "semi_finished" &&
    String(bom.bom_category || "PCR Kit") === "PCR Kit";

  const resolvedSupplyForm = isPcrKit
    ? parsedTypedLot.supplyForm ||
      d.supply_form ||
      (bom.supply_form ? String(bom.supply_form) : null) ||
      requestedSupplyForm
    : null;
  const resolvedTubeCode = isPcrKit
    ? parsedTypedLot.tubeCode ||
      (d.tube_code !== undefined ? (d.tube_code ? d.tube_code.trim().toUpperCase() : null) : "T02")
    : null;

  let customLotCode = d.lot_code?.trim() || undefined;
  // Nếu là Kit PCR và người dùng chỉ gõ mã lô gốc (VD: B2611001) mà chưa gõ hậu tố, tự động ghép hậu tố [.C][.IC].[Mã Tube]
  if (isPcrKit && customLotCode && !customLotCode.includes(".") && resolvedTubeCode) {
    const sf = String(resolvedSupplyForm || "").toUpperCase();
    const infix =
      sf === "SPLIT_WITH_IC"
        ? "C.IC"
        : sf === "SPLIT_NO_IC"
          ? "C"
          : sf === "NO_SPLIT_WITH_IC"
            ? "IC"
            : "";
    customLotCode = [customLotCode.toUpperCase(), infix, resolvedTubeCode].filter(Boolean).join(".");
  }

  const isAliquoted =
    isPcrKit &&
    (resolvedSupplyForm === "SPLIT_NO_IC" ||
      resolvedSupplyForm === "SPLIT_WITH_IC" ||
      Boolean(d.is_aliquoted) ||
      d.order_mode === "ALIQUOTED" ||
      product.code.toUpperCase().includes(".D.IC"));
  const isDemo = Boolean(d.is_demo) || d.order_mode === "DEMO";
  const orderMode = isDemo ? "DEMO" : isAliquoted ? "ALIQUOTED" : d.order_mode ?? "STANDARD";
  const mixTestsPerKit = isPcrKit ? (isAliquoted ? 64 : 75) : Number(bom.tests_per_kit || 50);
  const pcrTubesPerKit = isPcrKit ? (isAliquoted ? 64 : 80) : 0;
  const bomVariantCode = isPcrKit ? String(bom.variant_code || targetVariantCode || "BASE") : "BASE";

  if (isPcrKit && !customLotCode && resolvedTubeCode) {
    customLotCode = await generateAbtStructuredKitLotCode(tx, mfgDate, resolvedSupplyForm, resolvedTubeCode);
  }
  if (customLotCode) {
    const dup = await tx.query("SELECT 1 FROM inv.lot WHERE lower(code) = lower($1) LIMIT 1", [customLotCode]);
    if (dup.rowCount) throw invalid(`Mã số lô '${customLotCode}' đã tồn tại trong hệ thống kho.`);
  }

  const defaultBomRetention = Number(bom.qc_retention_qty ?? 0);
  const retQty = d.no_retention ? 0 : Number(d.qc_retention_qty || defaultBomRetention || 0);
  const autoResponsible = bom.responsible_person_name ? String(bom.responsible_person_name) : null;
  const autoQa = bom.qc_assignee_name ? String(bom.qc_assignee_name) : null;

  const created = await insertRecord<ProductionOrderRow>(tx, actor, "kit.production_order", "kit_production_order", {
    code,
    org_unit_id: d.org_unit_id,
    product_item_id: d.product_item_id,
    bom_id: bomId,
    routing_id: routingId,
    warehouse_id: d.warehouse_id,
    planned_qty: d.planned_qty,
    good_qty: d.planned_qty,
    scrap_qty: 0,
    retain_qty: retQty,
    uom: product.base_uom,
    mfg_date: mfgDate,
    expiry_date: expiryDate,
    priority: d.priority,
    order_mode: orderMode,
    supply_form: resolvedSupplyForm,
    tube_code: resolvedTubeCode,
    bom_variant_code: bomVariantCode,
    mix_tests_per_kit: mixTestsPerKit,
    pcr_tubes_per_kit: pcrTubesPerKit,
    is_aliquoted: isAliquoted,
    is_demo: isDemo,
    demo_specification: d.demo_specification ?? (isDemo ? "25 test" : null),
    qc_retention_qty: retQty,
    no_retention: d.no_retention,
    actual_ph: d.actual_ph ?? null,
    internal_order_line_id: d.internal_order_line_id ?? null,
    notes: d.notes ?? null,
  });

  // Auto-assign responsible production lead & QC assignee from BOM onto the Production Order
  if (autoResponsible || autoQa) {
    await tx.query(
      `UPDATE kit.production_order
          SET team_lead_name = coalesce(team_lead_name, $2),
              qa_assignee_name = coalesce(qa_assignee_name, $3),
              qa_assigned_at = CASE WHEN $3::text IS NOT NULL THEN now() ELSE qa_assigned_at END,
              planned_start_date = coalesce(planned_start_date, $4::date)
        WHERE id = $1`,
      [created.id, autoResponsible, autoQa, mfgDate]
    );
  }

  // Immediately allocate/create the finished goods Lot (in QUARANTINE) on the Production Order so the production team can track it from creation
  const lot = await createLot(tx, actor, {
    item_id: d.product_item_id,
    origin: "PRODUCTION",
    sequence_key: "LOT_KIT",
    code: customLotCode,
    mfg_date: mfgDate,
    expiry_date: expiryDate,
    origin_entity_type: "KIT_ORDER",
    origin_entity_id: created.id,
  });

  const bomLinesSnap = (
    await tx.query(
      `SELECT bl.*, mi.code AS component_code, mi.name AS component_name
         FROM kit.bom_line bl
         JOIN master.item mi ON mi.id = bl.component_item_id
        WHERE bl.bom_id = $1 ORDER BY bl.line_no`,
      [bomId]
    )
  ).rows;
  const packSnap = (
    await tx.query("SELECT * FROM kit.kit_packaging WHERE bom_id = $1 ORDER BY box_no, id", [bomId])
  ).rows;
  await tx.query(
    "UPDATE kit.production_order SET lot_id = $2, bom_snapshot_json = $3::jsonb, packaging_snapshot_json = $4::jsonb WHERE id = $1",
    [created.id, lot.id, JSON.stringify({ bom, lines: bomLinesSnap }), JSON.stringify(packSnap)]
  );

  // Copy EBR steps from Routing immediately so the operator can inspect and print the Batch Manufacturing Worksheet right away
  await tx.query(
    `INSERT INTO kit.production_step
       (order_id, routing_step_id, seq, step_code, step_name, category, step_function, work_center, functional_flags,
        instructions, sop_doc_code, required_training_doc_code, required_asset_id, asset_id, param_schema,
        is_qc, requires_check_signature, allow_skip, qc_gate_status)
     SELECT $1, id, seq, step_code, step_name, category,
            coalesce(step_function, 'FORMULATION_MIXING'),
            coalesce(work_center, 'Phòng sạch Class 10.000 (ISO 7)'),
            coalesce(functional_flags, '{}'::jsonb),
            instructions, sop_doc_code, required_training_doc_code, required_asset_id, required_asset_id, param_schema,
            is_qc, requires_check_signature, allow_skip,
            CASE WHEN is_qc THEN 'WAITING_QC' ELSE 'NONE' END
       FROM kit.routing_step WHERE routing_id = $2 ORDER BY seq`,
    [created.id, routingId]
  );

  return {
    ...created,
    lot_id: lot.id,
    lot_code: lot.code,
    team_lead_name: autoResponsible,
    qa_assignee_name: autoQa,
  };
}

/**
 * Ensures that a confirmed/in-progress Kit Production Order has FEFO material consumption rows
 * allocated from its BOM (`kit.material_consumption`). If a seeded/demo order has 0 rows or
 * insufficient warehouse stock for a BOM component, it automatically allocates available FEFO lots
 * (or initializes a released stock lot in the order's warehouse) so FEFO allocation & material issuance work seamlessly.
 */
async function ensureOrderMaterialConsumptions(tx: Tx, actor: AuthzActor, order: ProductionOrderRow) {
  if (["DRAFT", "CANCELLED"].includes(order.status)) return;
  const existingCount = (
    await tx.query("SELECT count(*)::int AS cnt FROM kit.material_consumption WHERE order_id = $1", [order.id])
  ).rows[0]?.cnt ?? 0;
  if (existingCount > 0) return;

  const bom = (await tx.query("SELECT * FROM kit.bom WHERE id = $1", [order.bom_id])).rows[0] as KitBomRow | undefined;
  if (!bom) return;

  const exploded = await explodeKitBom(tx, order, bom);
  if (!exploded.length) return;

  // Ensure an active non-quarantine storage location exists in order.warehouse_id
  let defaultLoc = (
    await tx.query(
      `SELECT id FROM master.location
        WHERE warehouse_id = $1 AND status = 'ACTIVE' AND is_quarantine = false
        ORDER BY code LIMIT 1`,
      [order.warehouse_id]
    )
  ).rows[0] as { id: string } | undefined;

  if (!defaultLoc) {
    const wh = (await tx.query("SELECT code FROM master.warehouse WHERE id = $1", [order.warehouse_id])).rows[0];
    const locCode = `${wh?.code ?? "KHO"}-MAIN`;
    defaultLoc = (
      await tx.query(
        `INSERT INTO master.location (warehouse_id, code, name, is_quarantine, status)
         VALUES ($1, $2, 'Kệ Bảo Quản Chính (-20°C / +4°C)', false, 'ACTIVE')
         ON CONFLICT (warehouse_id, code) DO UPDATE SET status = 'ACTIVE', is_quarantine = false
         RETURNING id`,
        [order.warehouse_id, locCode]
      )
    ).rows[0] as { id: string };
  }

  for (const l of exploded) {
    if (l.is_bundled) continue;
    if (!(l.qty_base > 0)) continue;

    let picks: Awaited<ReturnType<typeof reserve>> = [];
    let usedUom = l.base_uom;
    try {
      picks = await reserve(tx, actor, {
        item_id: l.component_item_id,
        qty_base: l.qty_base,
        warehouse_ids: [order.warehouse_id],
        demand_entity_type: "PRODUCTION_ORDER",
        demand_entity_id: order.id,
        module: "KIT",
        allow_substitutes: Boolean(l.allow_substitute),
      });
    } catch (err: any) {
      let resolved = false;
      if (err?.code === "INSUFFICIENT_STOCK" && l.allow_substitute) {
        const subs = (
          await tx.query(
            "SELECT * FROM kit.bom_line_substitute WHERE bom_line_id = $1 ORDER BY priority ASC",
            [l.bom_line_id]
          )
        ).rows;
        for (const s of subs) {
          try {
            const subItem = await getItem(tx, s.substitute_item_id);
            const subQty = Math.round(l.qty_base * Number(s.conversion_factor || 1) * 1e6) / 1e6;
            picks = await reserve(tx, actor, {
              item_id: s.substitute_item_id,
              qty_base: subQty,
              warehouse_ids: [order.warehouse_id],
              demand_entity_type: "PRODUCTION_ORDER",
              demand_entity_id: order.id,
              module: "KIT",
              allow_substitutes: false,
            });
            usedUom = subItem.base_uom;
            resolved = true;
            break;
          } catch {
            // try next substitute
          }
        }
      }

      if (!resolved) {
        throw err;
      }
    }

    for (const p of picks) {
      await tx.query(
        `INSERT INTO kit.material_consumption
           (order_id, bom_line_id, item_id, lot_id, location_id, reservation_id, planned_qty, issued_qty, actual_qty, uom)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.id,
          l.bom_line_id,
          p.item_id,
          p.lot_id,
          p.location_id,
          p.reservation_id,
          p.qty_base,
          order.materials_issued ? p.qty_base : 0,
          order.materials_issued ? p.qty_base : 0,
          usedUom,
        ]
      );
    }
  }
}

/**
 * Issues reserved materials into the Kit Production Order by posting an `ISSUE` `inv.stock_document`
 * that consumes the FEFO reservations created during `confirm`.
 */
export async function issueOrderMaterials(tx: Tx, actor: AuthzActor, orderId: string) {
  const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | ProductionOrderRow
    | undefined;
  if (!order) throw notFound("lệnh sản xuất Kit");
  await authorize(tx, actor, "kit.order.manage", order.org_unit_id);
  if (!["CONFIRMED", "IN_PROGRESS"].includes(order.status)) {
    throw invalid("Chỉ được xuất nguyên vật liệu khi lệnh sản xuất ở trạng thái Đã xác nhận (CONFIRMED) hoặc Đang sản xuất.");
  }
  if (order.materials_issued) throw invalid("Nguyên vật liệu của lệnh sản xuất này đã được xuất kho.");

  await ensureOrderMaterialConsumptions(tx, actor, order);

  const cons = (
    await tx.query("SELECT * FROM kit.material_consumption WHERE order_id = $1 ORDER BY id FOR UPDATE", [orderId])
  ).rows;
  if (!cons.length) throw invalid("Lệnh sản xuất không có dòng nguyên vật liệu giữ chỗ nào để xuất.");

  const doc = await createStockDocument(
    tx,
    actor,
    {
      doc_type: "ISSUE",
      warehouse_id: order.warehouse_id,
      reason_code: "PRODUCTION_ISSUE",
      ref_entity_type: "KIT_ORDER",
      ref_entity_id: order.id,
      notes: `Xuất nguyên vật liệu theo FEFO cho lệnh sản xuất Kit ${order.code}`,
      lines: cons.map((c) => ({
        item_id: c.item_id,
        lot_id: c.lot_id,
        from_location_id: c.location_id,
        qty: Number(c.planned_qty),
        uom: c.uom,
        reservation_id: c.reservation_id,
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

  for (const c of cons) {
    await tx.query(
      `UPDATE kit.material_consumption
          SET issued_qty = planned_qty, actual_qty = planned_qty, stock_document_id = $2, variance_pct = 0, updated_at = now()
        WHERE id = $1`,
      [c.id, doc.id]
    );
  }
  await tx.query(
    "UPDATE kit.production_order SET materials_issued = true, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $1",
    [order.id, actor.userId]
  );
  await writeAudit(tx, actor, {
    entityType: "kit_production_order",
    entityId: order.id,
    action: "issue_materials",
    changes: { materials_issued: [false, true], stock_document_id: [null, doc.id] },
  });
  return doc;
}

/**
 * Records label printing for a Kit Production Order. Once printed, `mfg_date` and `expiry_date` are locked.
 */
export async function printOrderLabel(tx: Tx, actor: AuthzActor, orderId: string) {
  const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | ProductionOrderRow
    | undefined;
  if (!order) throw notFound("lệnh sản xuất Kit");
  await authorize(tx, actor, "kit.order.manage", order.org_unit_id);
  if (!order.lot_id) throw invalid("Phải xác nhận lệnh sản xuất để cấp mã lô trước khi in nhãn.");

  const updated = (
    await tx.query(
      `UPDATE kit.production_order
          SET label_printed_at = coalesce(label_printed_at, now()), version = version + 1, updated_at = now(), updated_by = $2
        WHERE id = $1 RETURNING *`,
      [order.id, actor.userId]
    )
  ).rows[0] as ProductionOrderRow;

  await writeAudit(tx, actor, {
    entityType: "kit_production_order",
    entityId: order.id,
    action: "print_label",
    changes: { label_printed_at: [order.label_printed_at, updated.label_printed_at] },
  });
  return updated;
}

/**
 * Updates `mfg_date` (recalculating fixed `expiry_date`) and/or `lot_code` on the production order
 * only while labels have NOT been printed (`!order.label_printed_at`).
 */
export async function updateOrderDates(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  input: { mfg_date?: string | null; lot_code?: string | null; regenerate_lot_code?: boolean }
) {
  const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | ProductionOrderRow
    | undefined;
  if (!order) throw notFound("lệnh sản xuất Kit");
  await authorize(tx, actor, "kit.order.manage", order.org_unit_id);
  if (["COMPLETED", "CANCELLED"].includes(order.status)) {
    throw invalid("Lệnh sản xuất đã kết thúc, không thể thay đổi thông tin lô.");
  }
  if (order.label_printed_at) {
    throw invalid(
      "Nhãn lô Kit đã được in; hệ thống khóa mã lô, ngày sản xuất và hạn dùng để đảm bảo toàn vẹn nhãn GMP.",
      undefined,
      "LABEL_ALREADY_PRINTED"
    );
  }
  const mfgDate = input.mfg_date?.trim() || order.mfg_date || vnToday();
  const bom = (await tx.query("SELECT shelf_life_days FROM kit.bom WHERE id = $1", [order.bom_id])).rows[0];
  const expiryDate = addDays(mfgDate, Number(bom?.shelf_life_days || 365));

  let desiredLotCode: string | undefined;
  if (input.regenerate_lot_code) {
    if ((order as any).tube_code || (order as any).supply_form) {
      desiredLotCode = await generateAbtStructuredKitLotCode(
        tx,
        mfgDate,
        (order as any).supply_form,
        (order as any).tube_code
      );
    } else {
      desiredLotCode = await nextNumber(tx, "LOT_KIT");
    }
  } else if (input.lot_code !== undefined && input.lot_code !== null && input.lot_code.trim() !== "") {
    desiredLotCode = input.lot_code.trim();
  }

  let prevLotCode: string | null = null;
  let newLotCode: string | null = null;
  let lotId = order.lot_id;

  if (!lotId) {
    if (desiredLotCode) {
      const dup = await tx.query("SELECT 1 FROM inv.lot WHERE lower(code) = lower($1) LIMIT 1", [desiredLotCode]);
      if (dup.rowCount) throw invalid(`Mã số lô '${desiredLotCode}' đã tồn tại trong hệ thống kho.`);
    }
    const createdLot = await createLot(tx, actor, {
      item_id: order.product_item_id,
      origin: "PRODUCTION",
      sequence_key: "LOT_KIT",
      code: desiredLotCode,
      mfg_date: mfgDate,
      expiry_date: expiryDate,
      origin_entity_type: "KIT_ORDER",
      origin_entity_id: order.id,
    });
    lotId = createdLot.id;
    newLotCode = createdLot.code;
  } else {
    const curLot = (await tx.query("SELECT code FROM inv.lot WHERE id = $1 FOR UPDATE", [lotId])).rows[0];
    prevLotCode = curLot?.code ?? null;
    newLotCode = prevLotCode;
    if (desiredLotCode && desiredLotCode !== prevLotCode) {
      const dup = await tx.query("SELECT 1 FROM inv.lot WHERE lower(code) = lower($1) AND id <> $2 LIMIT 1", [
        desiredLotCode,
        lotId,
      ]);
      if (dup.rowCount) throw invalid(`Mã số lô '${desiredLotCode}' đã tồn tại trong hệ thống kho.`);
      await tx.query(
        "UPDATE inv.lot SET code = $2, mfg_date = $3, expiry_date = $4, updated_at = now(), updated_by = $5 WHERE id = $1",
        [lotId, desiredLotCode, mfgDate, expiryDate, actor.userId]
      );
      newLotCode = desiredLotCode;
    } else {
      await tx.query("UPDATE inv.lot SET mfg_date = $2, expiry_date = $3, updated_at = now() WHERE id = $1", [
        lotId,
        mfgDate,
        expiryDate,
      ]);
    }
  }

  await tx.query(
    "UPDATE kit.production_order SET lot_id = $2, mfg_date = $3, expiry_date = $4, version = version + 1, updated_at = now(), updated_by = $5 WHERE id = $1",
    [order.id, lotId, mfgDate, expiryDate, actor.userId]
  );

  await writeAudit(tx, actor, {
    entityType: "kit_production_order",
    entityId: order.id,
    action: "update_dates",
    changes: {
      lot_code: [prevLotCode, newLotCode],
      mfg_date: [order.mfg_date, mfgDate],
      expiry_date: [order.expiry_date, expiryDate],
    },
  });
}

const updateConsumptionSchema = z.object({
  consumption_id: z.string().uuid(),
  actual_qty: z.coerce.number().min(0),
  returned_qty: z.coerce.number().min(0).default(0),
  variance_reason: z.string().trim().max(500).optional().nullable(),
});

export async function updateMaterialActuals(tx: Tx, actor: AuthzActor, orderId: string, input: unknown) {
  const d = parseInput(updateConsumptionSchema, input);
  const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | ProductionOrderRow
    | undefined;
  if (!order) throw notFound("lệnh sản xuất Kit");
  await authorize(tx, actor, "kit.order.manage", order.org_unit_id);
  if (["COMPLETED", "CANCELLED"].includes(order.status)) {
    throw invalid("Lệnh sản xuất đã đóng, không thể sửa số liệu quyết toán vật tư.");
  }

  const c = (
    await tx.query("SELECT * FROM kit.material_consumption WHERE id = $1 AND order_id = $2 FOR UPDATE", [
      d.consumption_id,
      orderId,
    ])
  ).rows[0];
  if (!c) throw notFound("dòng quyết toán nguyên vật liệu");

  const planned = Number(c.planned_qty);
  const variancePct = planned > 0 ? Math.round(((d.actual_qty - planned) / planned) * 10000) / 100 : 0;

  const updated = (
    await tx.query(
      `UPDATE kit.material_consumption
          SET actual_qty = $2, returned_qty = $3, variance_pct = $4, variance_reason = $5, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [c.id, d.actual_qty, d.returned_qty, variancePct, d.variance_reason ?? null]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit_production_order",
    entityId: orderId,
    action: "reconcile_material",
    changes: {
      actual_qty: [c.actual_qty, d.actual_qty],
      variance_pct: [c.variance_pct, variancePct],
    },
    reason: d.variance_reason ?? undefined,
  });
  return updated;
}

const splitLotSchema = z.object({
  child_lot_code: z.string().trim().max(80).optional().nullable(),
  split_qty: z.coerce.number().positive("số lượng tách lô phải > 0"),
  mfg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * Splits a Kit lot (`kit.lot_split`) into a child lot with its own Lot Code and optionally customized MFG/EXP date,
 * preserving full parent-child genealogy (`kit.lot_genealogy`).
 */
export async function splitKitLot(tx: Tx, actor: AuthzActor, orderId: string, input: unknown) {
  const d = parseInput(splitLotSchema, input);
  const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0] as
    | ProductionOrderRow
    | undefined;
  if (!order) throw notFound("lệnh sản xuất Kit");
  await authorize(tx, actor, "kit.order.manage", order.org_unit_id);
  if (!order.lot_id) throw invalid("Lệnh sản xuất chưa có lô gốc để tách.");

  const currentGood = Number(order.good_qty || order.planned_qty);
  if (d.split_qty >= currentGood) {
    throw invalid(`Số lượng tách lô (${d.split_qty}) phải nhỏ hơn số lượng hiện có của lô gốc (${currentGood}).`);
  }

  const parentLot = (await tx.query("SELECT * FROM inv.lot WHERE id = $1 FOR UPDATE", [order.lot_id])).rows[0];
  if (!parentLot) throw notFound("lô gốc");

  const customCode = d.child_lot_code?.trim() || undefined;
  if (customCode) {
    const dup = await tx.query("SELECT 1 FROM inv.lot WHERE lower(code) = lower($1) LIMIT 1", [customCode]);
    if (dup.rowCount) throw invalid(`Mã số lô tách '${customCode}' đã tồn tại trong hệ thống kho.`);
  }

  const bom = (await tx.query("SELECT shelf_life_days FROM kit.bom WHERE id = $1", [order.bom_id])).rows[0];
  const mfgDate = d.mfg_date?.trim() || order.mfg_date || parentLot.mfg_date || vnToday();
  const expiryDate = addDays(mfgDate, Number(bom?.shelf_life_days || 365));

  const childLot = await createLot(tx, actor, {
    item_id: order.product_item_id,
    origin: "PRODUCTION",
    sequence_key: "LOT_KIT",
    code: customCode,
    mfg_date: mfgDate,
    expiry_date: expiryDate,
    origin_entity_type: "KIT_ORDER",
    origin_entity_id: order.id,
  });

  if (parentLot.status === "RELEASED") {
    await tx.query("UPDATE inv.lot SET status = 'RELEASED', updated_at = now() WHERE id = $1", [childLot.id]);
  }

  // If the order is already COMPLETED, move on-hand stock from parentLot to childLot via ISSUE + RECEIPT
  if (order.status === "COMPLETED") {
    const oh = (
      await tx.query(
        `SELECT sb.location_id, sb.qty_on_hand
           FROM inv.stock_balance sb
           JOIN master.location loc ON loc.id = sb.location_id
          WHERE sb.lot_id = $1 AND loc.warehouse_id = $2 AND sb.qty_on_hand >= $3
          ORDER BY sb.qty_on_hand DESC LIMIT 1 FOR UPDATE OF sb`,
        [parentLot.id, order.warehouse_id, d.split_qty]
      )
    ).rows[0];
    if (!oh) {
      throw invalid(
        `Không đủ tồn kho khả dụng tại kho của lô ${parentLot.code} để tách ${d.split_qty} ${order.uom}.`,
        undefined,
        "INSUFFICIENT_LOT_BALANCE"
      );
    }
    if (oh) {
      const iss = await createStockDocument(
        tx,
        actor,
        {
          doc_type: "ISSUE",
          warehouse_id: order.warehouse_id,
          reason_code: "LOT_SPLIT_OUT",
          ref_entity_type: "KIT_ORDER",
          ref_entity_id: order.id,
          notes: `Trừ tồn lô gốc ${parentLot.code} để tách sang lô con ${childLot.code}`,
          lines: [
            {
              item_id: order.product_item_id,
              lot_id: parentLot.id,
              from_location_id: oh.location_id,
              qty: d.split_qty,
              uom: order.uom,
            },
          ],
        },
        { trusted: true }
      );
      await runTransition(
        tx,
        stockDocumentMachine,
        actor,
        { id: iss.id, action: "post", expectedVersion: iss.version },
        { trusted: true }
      );

      const rcpt = await createStockDocument(
        tx,
        actor,
        {
          doc_type: "RECEIPT",
          warehouse_id: order.warehouse_id,
          reason_code: "LOT_SPLIT_IN",
          ref_entity_type: "KIT_ORDER",
          ref_entity_id: order.id,
          notes: `Nhập tồn lô con ${childLot.code} tách từ lô gốc ${parentLot.code}`,
          lines: [
            {
              item_id: order.product_item_id,
              lot_id: childLot.id,
              to_location_id: oh.location_id,
              qty: d.split_qty,
              uom: order.uom,
            },
          ],
        },
        { trusted: true }
      );
      await runTransition(
        tx,
        stockDocumentMachine,
        actor,
        { id: rcpt.id, action: "post", expectedVersion: rcpt.version },
        { trusted: true }
      );
    }
  } else {
    const newGood = Math.round((currentGood - d.split_qty) * 1e6) / 1e6;
    await tx.query("UPDATE kit.production_order SET good_qty = $2, updated_at = now() WHERE id = $1", [
      order.id,
      newGood,
    ]);
  }

  await tx.query(
    `INSERT INTO kit.lot_genealogy (parent_lot_id, child_lot_id, production_order_id, qty_used, uom)
     VALUES ($1, $2, $3, $4, $5)`,
    [parentLot.id, childLot.id, order.id, d.split_qty, order.uom]
  );

  const splitRow = (
    await tx.query(
      `INSERT INTO kit.lot_split (source_lot_id, child_lot_id, production_order_id, qty, uom, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *, qty::float AS split_qty`,
      [parentLot.id, childLot.id, order.id, d.split_qty, order.uom, d.reason ?? null, actor.userId]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit_production_order",
    entityId: order.id,
    action: "split_lot",
    changes: { child_lot: [null, `${childLot.code} (${d.split_qty} ${order.uom})`] },
    reason: d.reason ?? undefined,
  });

  return { split: splitRow, child_lot: childLot };
}

let kitDailyTrackerSchemaEnsured = false;

export async function ensureKitDailyTrackerAndQcGateSchema(_tx: Tx) {
  kitDailyTrackerSchemaEnsured = true;
}

export async function assignStepOperator(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  input: { step_id?: string; assigned_to_name?: string; shift_code?: string; planned_date?: string }
) {
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  const stepId = String(input.step_id ?? "").trim();
  if (!stepId) throw invalid("Chọn bước công đoạn cần phân công nhân viên.");
  const step = (
    await tx.query(
      `SELECT s.*, o.org_unit_id
         FROM kit.production_step s
         JOIN kit.production_order o ON o.id = s.order_id
        WHERE s.id = $1 AND s.order_id = $2 FOR UPDATE OF s`,
      [stepId, orderId]
    )
  ).rows[0];
  if (!step) throw notFound("bước công đoạn EBR");
  if (!(await hasFactoryPermission(tx, actor, "kit.order.manage", step.org_unit_id))) {
    await authorize(tx, actor, "kit.ebr.execute", step.org_unit_id);
  }

  const assignedName = input.assigned_to_name?.trim() || null;
  const shiftCode = input.shift_code?.trim() || "CA_SANG";
  const plannedDate = input.planned_date?.trim() || vnToday();

  const updated = (
    await tx.query(
      `UPDATE kit.production_step
          SET assigned_to_name = $2,
              shift_code = $3,
              planned_date = $4::date,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [stepId, assignedName, shiftCode, plannedDate]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit_production_step",
    entityId: stepId,
    action: "assign_operator",
    changes: { assigned_to_name: [step.assigned_to_name, assignedName], shift_code: [step.shift_code, shiftCode] },
  });
  return updated;
}

export async function verifyStepQcGate(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  input: { step_id?: string; decision?: "REQUEST_QC" | "PASS" | "REJECT"; note?: string; param_values?: Record<string, unknown> }
) {
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  const stepId = String(input.step_id ?? "").trim();
  if (!stepId) throw invalid("Chọn bước công đoạn QC cần xác nhận.");
  const step = (
    await tx.query(
      `SELECT s.*, o.code AS order_code, o.org_unit_id, i.code AS product_code, l.code AS lot_code
         FROM kit.production_step s
         JOIN kit.production_order o ON o.id = s.order_id
         JOIN master.item i ON i.id = o.product_item_id
         LEFT JOIN inv.lot l ON l.id = o.lot_id
        WHERE s.id = $1 AND s.order_id = $2 FOR UPDATE OF s`,
      [stepId, orderId]
    )
  ).rows[0];
  if (!step) throw notFound("bước công đoạn EBR");

  const decision = input.decision ?? "PASS";
  const note = input.note?.trim() || null;
  const mergedParams = { ...(step.param_values || {}), ...(input.param_values || {}) };

  if (decision === "REQUEST_QC") {
    await authorize(tx, actor, "kit.ebr.execute", step.org_unit_id);
    const upd = (
      await tx.query(
        `UPDATE kit.production_step
            SET qc_gate_status = 'WAITING_QC',
                param_values = $2::jsonb,
                qc_gate_note = coalesce($3, qc_gate_note),
                started_at = coalesce(started_at, now()),
                performed_by = coalesce(performed_by, $4),
                status = CASE WHEN status = 'PENDING' THEN 'IN_PROGRESS' ELSE status END,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [stepId, JSON.stringify(mergedParams), note, actor.userId]
      )
    ).rows[0];

    const qaDept = (await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-QA' LIMIT 1")).rows[0];
    const qaUsers = await usersWithPermission(tx, "qms.qc.view", qaDept?.id ?? null);
    await notifyUsers(tx, qaUsers, {
      type: "KIT_IPC_GATE_REQUEST",
      title: `[IPQC Xen Kẽ] Chờ QC xác nhận thông qua: Lệnh ${step.order_code} (Lô ${step.lot_code ?? "N/A"})`,
      body: `Bước #${step.seq} (${step.step_code} — ${step.step_name}) của sản phẩm ${step.product_code} đang chờ QC xác nhận thông qua để chuyển sang bước tiếp theo.`,
      entityType: "kit_production_step",
      entityId: stepId,
      link: "/?tab=factory-kit",
      sourceKey: `kit_ipc_req_${stepId}_${Date.now()}`,
    });
    return upd;
  }

  // PASS / REJECT requires strict QA/QC review permission and Separation of Duties
  await authorize(tx, actor, "qms.qc.review", step.org_unit_id);
  if (!step.performed_by) {
    throw invalid("Bước công đoạn phải được thực hiện bởi kỹ thuật viên sản xuất (performed_by) trước khi QA/QC xác nhận cổng IPQC.");
  }
  if (step.performed_by === actor.userId) {
    throw invalid("Người trực tiếp thực hiện bước công đoạn không được tự xác nhận thông qua cổng QC xen kẽ (Nguyên tắc tách nhiệm GMP/ISO 13485).");
  }

  if (decision === "PASS") {
    const phVal = mergedParams?.ph ?? mergedParams?.actual_ph ?? mergedParams?.pH ?? mergedParams?.PH;
    if (phVal !== undefined && phVal !== null && String(phVal).trim() !== "") {
      const phNum = Number(String(phVal).trim());
      if (!Number.isFinite(phNum) || phNum <= 0 || phNum > 14) {
        throw invalid("Giá trị độ pH thực tế không hợp lệ (phải là số trong khoảng 0–14).");
      }
      await tx.query("UPDATE kit.production_order SET actual_ph = $2 WHERE id = $1", [orderId, phNum]);
    }

    const updatedStep = (
      await tx.query(
        `UPDATE kit.production_step
            SET qc_gate_status = 'PASSED',
                qc_verified_by_name = $2,
                qc_verified_at = now(),
                qc_gate_note = coalesce($3, 'Đạt kiểm soát chất lượng trung gian (IPQC) — Cho phép chuyển công đoạn tiếp theo'),
                param_values = $4::jsonb,
                started_at = coalesce(started_at, now()),
                completed_at = coalesce(completed_at, now()),
                checked_by = $5,
                checked_at = now(),
                status = 'DONE',
                version = version + 1,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [stepId, actor.name || "Chuyên viên QA/QC", note, JSON.stringify(mergedParams), actor.userId]
      )
    ).rows[0];

    await writeAudit(tx, actor, {
      entityType: "kit.order_step_execution",
      entityId: stepId,
      action: "IPQC_VERIFY",
      changes: diffChanges(step, updatedStep, ["qc_gate_status", "status", "qc_verified_by_name", "qc_gate_note", "checked_by", "param_values"]),
      reason: note,
    });

    await checkAndAdvanceOrderToPendingQc(tx, actor, orderId);

    const kitUsers = await usersWithPermission(tx, "kit.view", step.org_unit_id);
    await notifyUsers(tx, kitUsers, {
      type: "KIT_IPC_GATE_PASSED",
      title: `✅ [QC Đã Thông Qua IPQC] Lệnh ${step.order_code} — Bước #${step.seq} (${step.step_name})`,
      body: `QA/QC (${actor.name}) đã xác nhận thông qua bước ${step.step_code}. Dây chuyền được phép tiếp tục bước kế tiếp!`,
      entityType: "kit_production_step",
      entityId: stepId,
      link: "/?tab=factory-kit",
      sourceKey: `kit_ipc_pass_${stepId}_${Date.now()}`,
    });
    return updatedStep;
  }

  // REJECT
  const updatedStep = (
    await tx.query(
      `UPDATE kit.production_step
          SET qc_gate_status = 'REJECTED',
              qc_verified_by_name = $2,
              qc_verified_at = now(),
              qc_gate_note = coalesce($3, 'Không đạt IPQC — Yêu cầu dừng công đoạn và điều chỉnh lại mẻ pha chế'),
              status = 'FAILED',
              version = version + 1,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [stepId, actor.name || "Chuyên viên QA/QC", note]
    )
  ).rows[0];

  await writeAudit(tx, actor, {
    entityType: "kit.order_step_execution",
    entityId: stepId,
    action: "IPQC_VERIFY",
    changes: diffChanges(step, updatedStep, ["qc_gate_status", "status", "qc_verified_by_name", "qc_gate_note"]),
    reason: note,
  });

  await raiseDeviation(tx, actor, {
    source_module: "KIT",
    entity_type: "KIT_ORDER",
    entity_id: orderId,
    severity: "MEDIUM",
    step_ref: `${step.order_code} · ${step.step_code}`,
    performer_id: step.performed_by ?? undefined,
    description: `[IPQC Không đạt] Lệnh ${step.order_code} — Bước #${step.seq} (${step.step_name}): ${note ?? "Thông số bán thành phẩm chưa đạt ngưỡng IPQC"}`,
  });

  const kitUsers = await usersWithPermission(tx, "kit.view", step.org_unit_id);
  await notifyUsers(tx, kitUsers, {
    type: "KIT_IPC_GATE_REJECTED",
    title: `❌ [QC Không Thông Qua IPQC] Lệnh ${step.order_code} — Bước #${step.seq} (${step.step_name})`,
    body: `Lý do: ${note ?? "Thông số bán thành phẩm chưa đạt ngưỡng IPQC"}. Yêu cầu xử lý trước khi chạy bước tiếp theo.`,
    entityType: "kit_production_step",
    entityId: stepId,
    link: "/?tab=factory-kit",
    sourceKey: `kit_ipc_rej_${stepId}_${Date.now()}`,
  });
  return updatedStep;
}

export async function listDailyProductionSteps(tx: Tx, actor: AuthzActor) {
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  const units = await visibleKitOrgUnits(tx, actor, "kit.view");
  if (units !== "ALL" && !units.length) return [];

  return (
    await tx.query(
      `SELECT s.*,
              o.code AS order_code, o.status AS order_status, o.planned_qty::float AS planned_qty, o.uom,
              o.priority, o.order_mode, o.mfg_date::text AS mfg_date,
              i.code AS product_code, i.name AS product_name,
              l.code AS lot_code,
              io.code AS internal_order_code, io.kd_po_code, io.committed_date::text AS po_committed_date,
              pp.display_name AS performed_by_name, kp.display_name AS checked_by_name,
              a.code AS asset_code, a.name AS asset_name
         FROM kit.production_step s
         JOIN kit.production_order o ON o.id = s.order_id
         JOIN master.item i ON i.id = o.product_item_id
         LEFT JOIN inv.lot l ON l.id = o.lot_id
         LEFT JOIN intake.internal_order_line iol ON iol.id = o.internal_order_line_id
         LEFT JOIN intake.internal_order io ON io.id = iol.order_id
         LEFT JOIN core.user_profile pp ON pp.user_id = s.performed_by
         LEFT JOIN core.user_profile kp ON kp.user_id = s.checked_by
         LEFT JOIN asset.asset a ON a.id = coalesce(s.asset_id, s.required_asset_id)
        WHERE ($1::uuid[] IS NULL OR o.org_unit_id = ANY($1::uuid[]))
          AND o.status NOT IN ('CANCELLED')
        ORDER BY
          CASE s.qc_gate_status WHEN 'WAITING_QC' THEN 0 WHEN 'REJECTED' THEN 1 ELSE 2 END,
          CASE s.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'AWAITING_CHECK' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END,
          o.created_at DESC, s.seq ASC
        LIMIT 400`,
      [units === "ALL" ? null : units]
    )
  ).rows;
}

/**
 * Lấy danh sách nhân sự thật theo phòng từ bảng `core.user_profile`, `core.org_unit`, `core.user_role` và `core.role`
 * cho Phòng Sản xuất Kit (`P-KIT`) và Phòng QA/QC (`P-QA`).
 */
export async function listDepartmentStaffForKitAndQa(tx: Tx) {
  const rows = (
    await tx.query(
      `SELECT DISTINCT ON (up.user_id)
              up.user_id,
              up.display_name AS full_name,
              COALESCE(r.name, '') AS position,
              COALESCE(r.code, '') AS role_code,
              COALESCE(ou.code, scope_ou.code, '') AS org_code,
              COALESCE(ou.module_key, scope_ou.module_key, '') AS module_key,
              COALESCE(ou.name, scope_ou.name, '') AS department
         FROM core.user_profile up
         LEFT JOIN core.org_unit ou ON ou.id = up.org_unit_id
         LEFT JOIN core.user_role ur ON ur.user_id = up.user_id AND ur.revoked_at IS NULL
         LEFT JOIN core.role r ON r.id = ur.role_id
         LEFT JOIN core.org_unit scope_ou ON scope_ou.id = ur.scope_org_unit_id
        WHERE up.status = 'ACTIVE'
        ORDER BY up.user_id, CASE WHEN r.code LIKE '%_HEAD' THEN 0 ELSE 1 END, r.code ASC NULLS LAST`
    )
  ).rows;

  const kit_staff: { user_id: number; full_name: string; position: string; label: string; is_lead: boolean }[] = [];
  const qa_staff: { user_id: number; full_name: string; position: string; label: string; is_lead: boolean }[] = [];

  for (const r of rows) {
    const deptLower = `${r.org_code} ${r.module_key} ${r.department} ${r.position} ${r.role_code}`.toLowerCase();
    const pos = String(r.position || r.department || "").trim();
    const isLead = /trưởng|quản đốc|phó phòng|lead|head|giám đốc/i.test(`${pos} ${r.role_code}`);
    const label = pos ? `${r.full_name} (${pos})` : String(r.full_name);

    if (r.org_code === "P-KIT" || r.module_key === "KIT" || r.role_code.startsWith("KIT_") || deptLower.includes("kit")) {
      kit_staff.push({ user_id: Number(r.user_id), full_name: r.full_name, position: pos, label, is_lead: isLead });
    }
    if (
      r.org_code === "P-QA" ||
      ["QA", "QMS"].includes(r.module_key) ||
      r.role_code.startsWith("QA_") ||
      deptLower.includes("qa") ||
      deptLower.includes("qc") ||
      deptLower.includes("chất lượng")
    ) {
      qa_staff.push({ user_id: Number(r.user_id), full_name: r.full_name, position: pos, label, is_lead: isLead });
    }
  }

  kit_staff.sort((a, b) => Number(b.is_lead) - Number(a.is_lead) || a.full_name.localeCompare(b.full_name, "vi"));
  qa_staff.sort((a, b) => Number(b.is_lead) - Number(a.is_lead) || a.full_name.localeCompare(b.full_name, "vi"));

  return { kit_staff, qa_staff };
}

/**
 * Bảng Kế hoạch sản xuất theo PO: các lệnh sản xuất kèm kế hoạch (Trưởng nhóm), QA phụ trách (Phòng QA/QC)
 * và tiến độ từng công đoạn của quy trình; cùng danh sách dòng PO Kit chưa được lập kế hoạch.
 */
export async function listProductionPlan(tx: Tx, actor: AuthzActor) {
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  const { kit_staff, qa_staff } = await listDepartmentStaffForKitAndQa(tx);
  let units = await visibleKitOrgUnits(tx, actor, "kit.view");
  // Phòng QA/QC được xem kế hoạch của mọi phòng sản xuất để phân bổ nhân viên giám sát
  if (units !== "ALL" && (await hasFactoryPermission(tx, actor, "qms.qc.view"))) units = "ALL";
  if (units !== "ALL" && !units.length) {
    return { orders: [], unplanned_po_lines: [], kit_staff, qa_staff, can_plan: false, can_assign_qa: false };
  }

  const orders = (
    await tx.query(
      `SELECT o.id, o.code, o.status, o.priority, o.order_mode, o.org_unit_id,
              o.planned_qty::float AS planned_qty, o.good_qty::float AS good_qty, o.uom,
              o.mfg_date::text AS mfg_date, o.planned_start_date::text AS planned_start_date,
              o.planned_end_date::text AS planned_end_date, o.team_lead_name, o.qa_assignee_name,
              o.qa_assigned_at, o.plan_note, o.created_at,
              i.code AS product_code, i.name AS product_name, l.code AS lot_code,
              io.code AS internal_order_code, io.kd_po_code, io.committed_date::text AS po_committed_date,
              (SELECT coalesce(json_agg(json_build_object(
                         'id', s.id, 'seq', s.seq, 'step_code', s.step_code, 'step_name', s.step_name,
                         'status', s.status, 'is_qc', s.is_qc, 'qc_gate_status', s.qc_gate_status,
                         'assigned_to_name', s.assigned_to_name, 'qa_assignee_name', s.qa_assignee_name,
                         'shift_code', s.shift_code, 'planned_date', s.planned_date,
                         'started_at', s.started_at, 'completed_at', s.completed_at) ORDER BY s.seq), '[]'::json)
                 FROM kit.production_step s WHERE s.order_id = o.id) AS steps
         FROM kit.production_order o
         JOIN master.item i ON i.id = o.product_item_id
         LEFT JOIN inv.lot l ON l.id = o.lot_id
         LEFT JOIN intake.internal_order_line iol ON iol.id = o.internal_order_line_id
         LEFT JOIN intake.internal_order io ON io.id = iol.order_id
        WHERE ($1::uuid[] IS NULL OR o.org_unit_id = ANY($1::uuid[]))
          AND o.status <> 'CANCELLED'
        ORDER BY CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END,
                 o.planned_end_date NULLS LAST, o.created_at DESC
        LIMIT 200`,
      [units === "ALL" ? null : units]
    )
  ).rows;

  const unplanned_po_lines = (
    await tx.query(
      `SELECT l.id AS line_id, io.code AS internal_order_code, io.kd_po_code, io.status AS po_status,
              io.committed_date::text AS committed_date, io.requested_date::text AS requested_date,
              COALESCE(i.code, l.kd_item_code) AS item_code, COALESCE(i.name, l.kd_item_name) AS item_name,
              l.qty::float AS qty, COALESCE(l.qty_delivered, 0)::float AS qty_delivered,
              COALESCE(i.base_uom, l.kd_unit, 'kit') AS uom
         FROM intake.internal_order_line l
         JOIN intake.internal_order io ON io.id = l.order_id
         JOIN core.org_unit u ON u.id = io.org_unit_id
         LEFT JOIN master.item i ON i.id = l.item_id
        WHERE u.code = 'P-KIT'
          AND io.status IN ('RECEIVED', 'ACCEPTED', 'IN_PRODUCTION')
          AND NOT EXISTS (
            SELECT 1 FROM kit.production_order po
             WHERE po.internal_order_line_id = l.id AND po.status <> 'CANCELLED'
          )
        ORDER BY io.committed_date NULLS LAST, io.created_at DESC
        LIMIT 100`
    )
  ).rows;

  const can_plan = await hasFactoryPermission(tx, actor, "kit.order.manage");
  const can_assign_qa = can_plan || (await hasFactoryPermission(tx, actor, "qms.qc.review"));
  return { orders, unplanned_po_lines, kit_staff, qa_staff, can_plan, can_assign_qa };
}

/**
 * Trưởng nhóm cập nhật kế hoạch (ngày bắt đầu/kết thúc, trưởng nhóm, ghi chú) — cần quyền `kit.order.manage`.
 * Phòng QA/QC phân bổ nhân viên QA giám sát — cần `qms.qc.review` (hoặc `kit.order.manage`).
 * QA phụ trách được gán xuống mọi bước QC xen kẽ (IPQC) của lệnh.
 */
export async function updateOrderPlan(
  tx: Tx,
  actor: AuthzActor,
  orderId: string,
  input: Record<string, unknown>
) {
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  const order = (await tx.query("SELECT * FROM kit.production_order WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
  if (!order) throw notFound("lệnh sản xuất Kit");

  const planKeys = ["planned_start_date", "planned_end_date", "team_lead_name", "plan_note"];
  const wantsPlan = planKeys.some((k) => k in input);
  const wantsQa = "qa_assignee_name" in input;
  if (!wantsPlan && !wantsQa) throw invalid("Không có thông tin kế hoạch nào để cập nhật.");

  if (wantsPlan) await authorize(tx, actor, "kit.order.manage", order.org_unit_id);
  if (wantsQa && !(await hasFactoryPermission(tx, actor, "qms.qc.review"))) {
    await authorize(tx, actor, "kit.order.manage", order.org_unit_id);
  }

  const pick = (k: string) => {
    if (!(k in input)) return order[k] ?? null;
    const v = input[k];
    return v == null || String(v).trim() === "" ? null : String(v).trim();
  };
  const dateOf = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  const start = dateOf(pick("planned_start_date"));
  const end = dateOf(pick("planned_end_date"));
  if (start && end && start > end) throw invalid("Ngày kết thúc kế hoạch phải sau hoặc bằng ngày bắt đầu.");
  const teamLead = pick("team_lead_name");
  const note = pick("plan_note");
  const qa = pick("qa_assignee_name");
  const qaChanged = wantsQa && qa !== (order.qa_assignee_name ?? null);

  const updated = (
    await tx.query(
      `UPDATE kit.production_order
          SET planned_start_date = $2::date, planned_end_date = $3::date, team_lead_name = $4,
              plan_note = $5, qa_assignee_name = $6,
              qa_assigned_at = CASE WHEN $7::boolean THEN now() ELSE qa_assigned_at END,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [orderId, start, end, teamLead, note, qa, qaChanged]
    )
  ).rows[0];

  if (qaChanged) {
    await tx.query("UPDATE kit.production_step SET qa_assignee_name = $2 WHERE order_id = $1 AND is_qc = true", [orderId, qa]);
    if (qa) {
      const qaDept = (await tx.query("SELECT id FROM core.org_unit WHERE code = 'P-QA' LIMIT 1")).rows[0];
      const users = [
        ...(await usersWithPermission(tx, "qms.qc.view", qaDept?.id ?? null)),
        ...(await usersWithPermission(tx, "kit.view", order.org_unit_id)),
      ];
      await notifyUsers(tx, Array.from(new Set(users)), {
        type: "KIT_QA_ASSIGNED",
        title: `[Phân công QA] ${qa} giám sát Lệnh ${order.code}`,
        body: `Phòng QA/QC phân công ${qa} phụ trách giám sát chất lượng và xác nhận các bước QC xen kẽ (IPQC) của Lệnh ${order.code}.`,
        entityType: "kit_production_order",
        entityId: orderId,
        link: "/?tab=factory-kit",
        sourceKey: `kit_qa_assign_${orderId}_${Date.now()}`,
      });
    }
  }

  await writeAudit(tx, actor, {
    entityType: "kit_production_order",
    entityId: orderId,
    action: wantsPlan ? "update_plan" : "assign_qa",
    changes: {
      planned_start_date: [dateOf(order.planned_start_date), start],
      planned_end_date: [dateOf(order.planned_end_date), end],
      team_lead_name: [order.team_lead_name ?? null, teamLead],
      qa_assignee_name: [order.qa_assignee_name ?? null, qa],
    },
  });
  return updated;
}

export async function listProductionOrders(tx: Tx, actor: AuthzActor) {
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  await authorizeAnywhere(tx, actor, "kit.view");
  const units = await visibleKitOrgUnits(tx, actor, "kit.view");
  if (units !== "ALL" && !units.length) return [];

  return (
    await tx.query(
      `SELECT o.*, o.yield_pct::float AS yield_pct, i.code AS product_code, i.name AS product_name, i.item_type AS product_type,
              b.code AS bom_code, b.bom_version, r.code AS routing_code, r.routing_version,
              l.code AS lot_code, l.status AS lot_status, w.code AS warehouse_code, w.name AS warehouse_name,
              qt.code AS qc_test_code, qt.status AS qc_test_status, qt.overall_result AS qc_test_result,
              (SELECT count(*)::int FROM kit.production_step s WHERE s.order_id = o.id) AS total_steps,
              (SELECT count(*)::int FROM kit.production_step s WHERE s.order_id = o.id AND s.status IN ('DONE', 'SKIPPED')) AS done_steps
         FROM kit.production_order o
         JOIN master.item i ON i.id = o.product_item_id
         JOIN kit.bom b ON b.id = o.bom_id
         JOIN kit.routing r ON r.id = o.routing_id
         JOIN master.warehouse w ON w.id = o.warehouse_id
         LEFT JOIN inv.lot l ON l.id = o.lot_id
         LEFT JOIN qms.qc_test qt ON qt.id = o.qc_test_id
        WHERE ($1::uuid[] IS NULL OR o.org_unit_id = ANY($1::uuid[]))
        ORDER BY o.created_at DESC LIMIT 300`,
      [units === "ALL" ? null : units]
    )
  ).rows;
}

export async function getProductionOrderDetail(tx: Tx, actor: AuthzActor, id: string) {
  await ensureKitBomRoutingAndIfuSchema(tx);
  await ensureKitDailyTrackerAndQcGateSchema(tx);
  await authorizeAnywhere(tx, actor, "kit.view");
  const order = (
    await tx.query(
      `SELECT o.*, o.yield_pct::float AS yield_pct, i.code AS product_code, i.name AS product_name, i.item_type AS product_type,
              b.code AS bom_code, b.bom_version, b.tests_per_kit,
              b.bom_type, b.bom_category, b.parent_item_code, b.tccs_code, b.tccs_file_name, b.tccs_file_url, b.registration_no,
              b.responsible_person_name AS bom_responsible_person_name, b.qc_assignee_name AS bom_qc_assignee_name,
              b.specification AS bom_specification, b.storage_condition AS bom_storage_condition, b.shelf_life_months,
              b.label_template_code, b.label_dimensions, b.udi_di,
              b.ifu_code, b.ifu_version, b.ifu_intended_use, b.ifu_thermal_profile, b.ifu_channels, b.ifu_interpretation,
              b.ifu_file_name, b.ifu_file_url, b.ifu_file_size, b.ifu_aliquoted_file_name, b.ifu_aliquoted_file_url, b.ifu_aliquoted_file_size,
              b.label_design_json,
              r.code AS routing_code, r.routing_version,
              l.code AS lot_code, l.status AS lot_status,
              w.code AS warehouse_code, w.name AS warehouse_name,
              cp.display_name AS confirmed_by_name, rp.display_name AS released_by_name,
              lcp.display_name AS line_clearance_by_name,
              qt.code AS qc_test_code, qt.status AS qc_test_status, qt.overall_result AS qc_test_result,
              io.code AS internal_order_code, io.kd_po_code
         FROM kit.production_order o
         JOIN master.item i ON i.id = o.product_item_id
         JOIN kit.bom b ON b.id = o.bom_id
         JOIN kit.routing r ON r.id = o.routing_id
         JOIN master.warehouse w ON w.id = o.warehouse_id
         LEFT JOIN inv.lot l ON l.id = o.lot_id
         LEFT JOIN core.user_profile cp ON cp.user_id = o.confirmed_by
         LEFT JOIN core.user_profile rp ON rp.user_id = o.released_by
         LEFT JOIN core.user_profile lcp ON lcp.user_id = o.line_clearance_by
         LEFT JOIN qms.qc_test qt ON qt.id = o.qc_test_id
         LEFT JOIN intake.internal_order_line iol ON iol.id = o.internal_order_line_id
         LEFT JOIN intake.internal_order io ON io.id = iol.order_id
        WHERE o.id = $1`,
      [id]
    )
  ).rows[0] as (ProductionOrderRow & Record<string, unknown>) | undefined;
  if (!order) throw notFound("lệnh sản xuất Kit");
  if (!(await hasFactoryPermission(tx, actor, "qms.qc.view"))) {
    await authorize(tx, actor, "kit.view", order.org_unit_id);
  }

  const stepsRaw = (
    await tx.query(
      `SELECT s.*, a.code AS asset_code, a.name AS asset_name,
              pp.display_name AS performed_by_name, kp.display_name AS checked_by_name,
              d.code AS deviation_code, d.severity AS deviation_severity
         FROM kit.production_step s
         LEFT JOIN asset.asset a ON a.id = coalesce(s.asset_id, s.required_asset_id)
         LEFT JOIN core.user_profile pp ON pp.user_id = s.performed_by
         LEFT JOIN core.user_profile kp ON kp.user_id = s.checked_by
         LEFT JOIN qms.deviation d ON d.id = s.deviation_id
        WHERE s.order_id = $1
        ORDER BY s.seq`,
      [id]
    )
  ).rows as (ProductionStepRow & Record<string, unknown>)[];

  const steps = [];
  for (const s of stepsRaw) {
    steps.push({ ...s, allowed_actions: await listAllowedActions(tx, productionStepMachine, actor, s) });
  }

  const toYmd = (v: unknown) => {
    if (!v) return "";
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, "0");
      const d = String(v.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return String(v).slice(0, 10);
  };
  const orderExpYmd = toYmd(order.expiry_date);

  const consumptions = (
    await tx.query(
      `SELECT mc.*, i.code AS item_code, i.name AS item_name,
              l.code AS lot_code, l.expiry_date, loc.code AS location_code,
              bl.box_no, bl.component_role
         FROM kit.material_consumption mc
         JOIN master.item i ON i.id = mc.item_id
         JOIN kit.bom_line bl ON bl.id = mc.bom_line_id
         LEFT JOIN inv.lot l ON l.id = mc.lot_id
         LEFT JOIN master.location loc ON loc.id = mc.location_id
        WHERE mc.order_id = $1
        ORDER BY bl.box_no, bl.line_no, mc.id`,
      [id]
    )
  ).rows.map((c: any) => {
    const lotExpYmd = toYmd(c.expiry_date);
    return {
      ...c,
      expiry_shorter_than_product: Boolean(lotExpYmd && orderExpYmd && lotExpYmd < orderExpYmd),
    };
  });

  const packaging = (
    await tx.query(
      `SELECT kp.*, kp.fill_qty::float AS fill_qty
         FROM kit.kit_packaging kp
        WHERE kp.bom_id = $1 ORDER BY kp.box_no ASC, kp.id ASC`,
      [order.bom_id]
    )
  ).rows;

  const lot_splits = (
    await tx.query(
      `SELECT ls.*, ls.qty::float AS split_qty,
              cl.code AS child_lot_code, cl.mfg_date, cl.expiry_date, cl.status AS child_lot_status,
              up.display_name AS created_by_name
         FROM kit.lot_split ls
         JOIN inv.lot cl ON cl.id = ls.child_lot_id
         LEFT JOIN core.user_profile up ON up.user_id = ls.created_by
        WHERE ls.production_order_id = $1
        ORDER BY ls.created_at DESC`,
      [id]
    )
  ).rows;

  const bomObj = (await tx.query("SELECT * FROM kit.bom WHERE id = $1", [order.bom_id])).rows[0] as KitBomRow;
  const exploded_bom = bomObj ? await explodeKitBom(tx, order, bomObj) : [];

  const coaRow = (
    await tx.query(
      `SELECT c.*,
              (c.superseded_by_id IS NOT NULL OR EXISTS (SELECT 1 FROM kit.coa_certificate child WHERE child.amended_from_id = c.id)) AS is_superseded
         FROM kit.coa_certificate c
        WHERE c.production_order_id = $1
        ORDER BY is_superseded ASC, c.revision_no DESC, c.issued_at DESC
        LIMIT 1`,
      [id]
    )
  ).rows[0] ?? null;
  const coa = coaRow ? { ...coaRow, actual_ph: order.actual_ph ?? null } : null;
  const reworks = (
    await tx.query(
      `SELECT rw.*, i.code AS component_code, i.name AS component_name, l.code AS used_lot_code
         FROM kit.rework_order rw
         LEFT JOIN master.item i ON i.id = rw.component_item_id
         LEFT JOIN inv.lot l ON l.id = rw.used_lot_id
        WHERE rw.production_order_id = $1
        ORDER BY rw.created_at DESC`,
      [id]
    )
  ).rows;

  const allowed_actions = await listAllowedActions(tx, productionOrderMachine, actor, order);
  return { order, steps, consumptions, packaging, lot_splits, exploded_bom, coa, reworks, allowed_actions };
}
