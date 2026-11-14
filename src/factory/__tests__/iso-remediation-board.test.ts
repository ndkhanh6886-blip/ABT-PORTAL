import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "./helpers";
import { syncPermissions, type AuthzActor } from "../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../core/stateMachine";
import { makeItem, makeSite, stockedLot } from "../inv/__tests__/fixtures";
import { createStockDocument, postStockDocument } from "../inv/documents";
import { lotMachine, type Lot } from "../inv/lots";
import { createSpecDraft, specMachine } from "../qms/specs";
import { updateCoaCertificate } from "../qms/qaOps";
import { getProductionOrderDetail } from "../kit/ordersEbr";
import { listQualityRecords, traceKitLotGenealogy } from "../kit/qualityTrace";
import {
  createProject,
  projectGateMachine,
  saveRiskItem,
  saveSpecEvaluation,
  updateGateDeliverable,
} from "../rd/projects";
import { createTransferFromProjectBom, savePrototypeBom } from "../rd/projectOps";
import { cleanColumn, createColumn, recordColumnRun } from "../asset/columns";
import "../modules";

beforeAll(() => withTransaction((tx) => syncPermissions(tx)));
afterAll(closeFactoryPool);

const PIN = "482910";
const signed = { credential: { method: "PIN" as const, secret: PIN } };
const uniq = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

async function act<S extends string, R extends { id: string; status: S; version: number }>(
  machine: MachineDef<S, R>,
  actor: AuthzActor,
  id: string,
  action: string,
  extra: Partial<TransitionRequest> = {}
): Promise<R> {
  const row = (await getFactoryPool().query(`SELECT status, version FROM ${machine.table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  if (extra.credential) await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) =>
    runTransition(tx, machine, actor, req, extra.credential ? { signerAuthenticated: true } : {})
  );
}

describe("System Audit & Architecture Board — ISO Remediation Verification", () => {
  it("1. SEC-02: QC Spec approval enforces electronic signature & segregation of duties", async () => {
    const site = await makeSite();
    const item = await makeItem(site);
    const author = await createUser("QC Spec Author", PIN);
    const reviewer = await createUser("QC Spec Reviewer", PIN);

    await grant(author, ["qms.spec.manage", "qms.spec.approve", "qms.qc.view"]);
    await grant(reviewer, ["qms.spec.approve", "qms.qc.view"]);

    const spec = await withTransaction((tx) =>
      createSpecDraft(tx, author, {
        name: `Spec SEC-02 ${uniq()}`,
        applies_to: "ITEM",
        item_id: item.id,
        parameters: [{ name: "pH", value_type: "NUMERIC", lower_limit: 7.0, upper_limit: 8.0, is_critical: true }],
      })
    );
    expect(spec.status).toBe("DRAFT");

    await expect(
      withTransaction((tx) =>
        runTransition(tx, specMachine, reviewer, { id: spec.id, action: "approve", expectedVersion: spec.version }, {})
      )
    ).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED" });

    const reqAuthor: TransitionRequest = {
      id: spec.id,
      action: "approve",
      expectedVersion: spec.version,
      ...signed,
    };
    await preAuthenticate(specMachine, "DRAFT", reqAuthor, author);
    await expect(
      withTransaction((tx) => runTransition(tx, specMachine, author, reqAuthor, { signerAuthenticated: true }))
    ).rejects.toMatchObject({ code: "GUARD_FAILED" });

    const approved = await act(specMachine, reviewer, spec.id, "approve", signed);
    expect(approved.status).toBe("EFFECTIVE");
  });

  it("2. VIBE-02: COA append-only trigger, revision superseding (-R2 + SHA-256), and EBR/Genealogy resolution", async () => {
    const site = await makeSite();
    const product = await makeItem(site);
    const lot = await stockedLot(site, product.id, 50, "2028-12-31");
    const qaIssuer = await createUser("QA Issuer COA", PIN);
    const qaReviewer = await createUser("QA Reviewer COA", PIN);

    await grant(qaReviewer, ["qms.qc.review", "qms.qc.view", "kit.view"]);

    const uid = uniq();
    const { order, rev1 } = await withTransaction(async (tx) => {
      const bom = (
        await tx.query(
          `INSERT INTO kit.bom (code, org_unit_id, product_item_id, name, base_uom, status)
           VALUES ($1, $2, $3, $4, $5, 'EFFECTIVE') RETURNING id`,
          [`BOM-COA-${uid}`, site.dept, product.id, `BOM ${uid}`, product.base_uom]
        )
      ).rows[0];
      const routing = (
        await tx.query(
          `INSERT INTO kit.routing (code, org_unit_id, product_item_id, name, status)
           VALUES ($1, $2, $3, $4, 'EFFECTIVE') RETURNING id`,
          [`RT-COA-${uid}`, site.dept, product.id, `Routing ${uid}`]
        )
      ).rows[0];
      const ord = (
        await tx.query(
          `INSERT INTO kit.production_order
             (code, org_unit_id, product_item_id, bom_id, routing_id, warehouse_id, planned_qty, good_qty, uom, lot_id, mfg_date, expiry_date, status)
           VALUES ($1, $2, $3, $4, $5, $6, 50, 50, $7, $8, '2026-11-14', '2028-12-31', 'COMPLETED')
           RETURNING *`,
          [`PO-COA-${uid}`, site.dept, product.id, bom.id, routing.id, site.warehouse, product.base_uom, lot.id]
        )
      ).rows[0];
      const coa1 = (
        await tx.query(
          `INSERT INTO kit.coa_certificate
             (code, lot_id, production_order_id, product_code, product_name, lot_code, mfg_date, expiry_date,
              tests_per_kit, good_qty, uom, issued_by, issued_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, '2026-11-14', '2028-12-31', 50, 50, $7, $8, $9)
           RETURNING *`,
          [
            `COA-${uid}`,
            lot.id,
            ord.id,
            product.code,
            product.name,
            lot.code,
            product.base_uom,
            qaIssuer.userId,
            qaIssuer.name,
          ]
        )
      ).rows[0];
      return { order: ord, rev1: coa1 };
    });

    await expect(
      getFactoryPool().query("UPDATE kit.coa_certificate SET qc_summary = 'tampered' WHERE id = $1", [rev1.id])
    ).rejects.toThrow();

    const rev2 = await withTransaction((tx) =>
      updateCoaCertificate(
        tx,
        qaReviewer,
        {
          id: rev1.id,
          code: rev1.code,
          product_code: rev1.product_code,
          product_name: rev1.product_name,
          lot_code: rev1.lot_code,
          mfg_date: "2026-11-14",
          expiry_date: "2028-12-31",
          tests_per_kit: 50,
          good_qty: 50,
          uom: rev1.uom,
          issued_by_name: qaReviewer.name,
          qc_summary: "Amended COA summary",
          reason: "Bổ sung ghi chú độ ổn định",
          qc_results_snapshot: [
            { parameter_name: "Độ nhạy", spec_limit: "LOD <= 10 copies", observed_value: "5 copies", passed: true },
          ],
        },
        { requireSignature: true, signerAuthenticated: true, ...signed }
      )
    );

    expect(rev2.code).toBe(`${rev1.code}-R2`);
    expect(Number(rev2.revision_no)).toBe(2);
    expect(rev2.amended_from_id).toBe(rev1.id);
    expect(String(rev2.sha256_hash)).toMatch(/^[0-9a-f]{64}$/);

    const detail = await withTransaction((tx) => getProductionOrderDetail(tx, qaReviewer, order.id));
    expect(detail.coa?.id).toBe(rev2.id);
    expect(detail.coa?.is_superseded).toBe(false);

    const genealogy = await withTransaction((tx) => traceKitLotGenealogy(tx, qaReviewer, lot.id));
    expect(genealogy.coa?.id).toBe(rev2.id);
    expect(genealogy.coa?.is_superseded).toBe(false);

    const quality = await withTransaction((tx) => listQualityRecords(tx, qaReviewer));
    const qRev1 = quality.coas.find((c: { id: string }) => c.id === rev1.id);
    const qRev2 = quality.coas.find((c: { id: string }) => c.id === rev2.id);
    expect(qRev1?.is_superseded).toBe(true);
    expect(qRev2?.is_superseded).toBe(false);
  });

  it("3. BUG-07 & BUG-06: Progressive DHF stage freeze & early-gate PENDING spec evaluation", async () => {
    const site = await makeSite();
    const researcher = await createUser("RD Researcher Progressive", PIN);
    const reviewer = await createUser("RD Reviewer Progressive", PIN);

    await grant(researcher, ["rd.view", "rd.project.manage"], site.dept);
    await grant(reviewer, ["rd.view", "rd.project.manage", "rd.gate.review"], site.dept);

    const proj = await withTransaction((tx) =>
      createProject(tx, researcher, {
        name: `Kit PCR DHF Progressive ${uniq()}`,
        owner_org_unit_id: site.dept,
        target_domain: "KIT",
      })
    );

    const s0 = await withTransaction((tx) =>
      saveSpecEvaluation(tx, researcher, proj.id, null, {
        category: "CLINICAL",
        design_stage: "USER_NEED",
        parameter: "Thời gian trả kết quả",
        unit: "phút",
        target_value: "<= 60",
        result: "PENDING",
      })
    );
    expect(s0.design_stage).toBe("USER_NEED");
    expect(s0.result).toBe("PENDING");

    const gate0 = proj.gates[0];
    for (const d of gate0.deliverables) {
      await withTransaction((tx) =>
        updateGateDeliverable(tx, researcher, d.id, { status: "SUBMITTED", notes: "Minh chứng G0" })
      );
    }
    await act(projectGateMachine, researcher, gate0.id, "submit");
    for (const d of gate0.deliverables) {
      await withTransaction((tx) => updateGateDeliverable(tx, reviewer, d.id, { status: "ACCEPTED" }));
    }
    const passedGate0 = await act(projectGateMachine, reviewer, gate0.id, "decide_go", {
      ...signed,
      reason: "Thông qua Gate 0",
    });
    expect(passedGate0.status).toBe("PASSED");

    await expect(
      withTransaction((tx) =>
        saveSpecEvaluation(tx, researcher, proj.id, s0.id, {
          category: "CLINICAL",
          design_stage: "USER_NEED",
          parameter: "Thời gian trả kết quả",
          unit: "phút",
          target_value: "<= 90",
          result: "PENDING",
        })
      )
    ).rejects.toMatchObject({ code: "DHF_STAGE_FROZEN" });

    const s0Updated = await withTransaction((tx) =>
      saveSpecEvaluation(tx, researcher, proj.id, s0.id, {
        category: "CLINICAL",
        design_stage: "USER_NEED",
        parameter: "Thời gian trả kết quả",
        unit: "phút",
        target_value: "<= 60",
        actual_value: "45",
        result: "PASS",
      })
    );
    expect(s0Updated.actual_value).toBe("45");
    expect(s0Updated.result).toBe("PASS");

    const s1 = await withTransaction((tx) =>
      saveSpecEvaluation(tx, researcher, proj.id, null, {
        category: "ANALYTICAL",
        design_stage: "DESIGN_INPUT",
        parameter: "Giới hạn phát hiện (LOD)",
        unit: "copies/mL",
        target_value: "<= 100",
        result: "PENDING",
      })
    );
    expect(s1.design_stage).toBe("DESIGN_INPUT");

    const risk = await withTransaction((tx) =>
      saveRiskItem(tx, researcher, proj.id, null, {
        hazard: "Nhiễu nền kênh huỳnh quang",
        hazardous_situation: "Độ lặp lại CV% tăng ở nồng độ thấp",
        harm: "Âm tính giả trên mẫu tải lượng thấp",
        severity: 4,
        occurrence: 2,
        detection: 2,
        status: "OPEN",
      })
    );
    expect(risk.status).toBe("OPEN");
  });

  it("4. BUG-05: R&D Prototype BOM custom component role normalization on Tech Transfer", async () => {
    const existingKitDept = (
      await getFactoryPool().query("SELECT id FROM core.org_unit WHERE module_key = 'KIT' AND status = 'ACTIVE' LIMIT 1")
    ).rows[0];
    if (!existingKitDept) {
      const kitDeptId = await createOrgUnit(`KIT-${uniq()}`);
      await getFactoryPool().query("UPDATE core.org_unit SET module_key = 'KIT' WHERE id = $1", [kitDeptId]);
    }

    const site = await makeSite();
    const product = await makeItem(site);
    const comp = await makeItem(site);
    const rdLead = await createUser("RD Transfer Lead", PIN);

    await grant(rdLead, ["rd.view", "rd.project.manage", "rd.transfer.manage", "kit.bom.manage", "kit.view"]);

    const proj = await withTransaction((tx) =>
      createProject(tx, rdLead, {
        name: `Kit Chuyển giao Custom Role ${uniq()}`,
        owner_org_unit_id: site.dept,
        target_domain: "KIT",
      })
    );

    await withTransaction((tx) =>
      savePrototypeBom(tx, rdLead, {
        project_id: proj.id,
        target_product_item_id: product.id,
        lines: [
          {
            component_item_id: comp.id,
            component_role: "CUSTOM_ADJUVANT",
            qty_per_base: 2.5,
            uom: comp.base_uom,
            scrap_pct: 0,
          },
        ],
      })
    );

    await withTransaction((tx) => createTransferFromProjectBom(tx, rdLead, { project_id: proj.id }));

    const lines = (
      await getFactoryPool().query(
        `SELECT bl.component_role
           FROM kit.bom_line bl
           JOIN kit.bom b ON b.id = bl.bom_id
          WHERE b.product_item_id = $1`,
        [product.id]
      )
    ).rows;
    expect(lines.length).toBe(1);
    expect(lines[0].component_role).toBe("REAGENT");
  });

  it("5. Quarantine & Rejected lot stock adjustment bypass blocked (LOT_NOT_RELEASED & LOT_REJECTED)", async () => {
    const site = await makeSite();
    const qcItem = await makeItem(site, { receipt_qc_required: true });
    const unreleased = await stockedLot(site, qcItem.id, 100, "2028-01-01", { release: false });
    expect(unreleased.status).toBe("QUARANTINE");

    const gainQuarantineDoc = await withTransaction((tx) =>
      createStockDocument(tx, site.admin, {
        doc_type: "ADJUSTMENT",
        reason_code: "COUNT_GAIN",
        warehouse_id: site.warehouse,
        lines: [{ item_id: qcItem.id, lot_id: unreleased.id, to_location_id: site.shelf, qty: 5, uom: qcItem.base_uom }],
      })
    );
    await expect(
      withTransaction((tx) => postStockDocument(tx, site.admin, gainQuarantineDoc.id, gainQuarantineDoc.version))
    ).rejects.toMatchObject({ code: "LOT_NOT_RELEASED" });

    const freeItem = await makeItem(site);
    const relLot = await stockedLot(site, freeItem.id, 100, "2028-01-01");
    expect(relLot.status).toBe("RELEASED");

    const onHold = await act<Lot["status"], Lot>(lotMachine, site.admin, relLot.id, "hold", {
      reason: "Nghi nhiễm chéo",
    });
    expect(onHold.status).toBe("ON_HOLD");

    const rejected = await act<Lot["status"], Lot>(lotMachine, site.admin, onHold.id, "reject", {
      reason: "Không đạt QC",
    });
    expect(rejected.status).toBe("REJECTED");

    const gainRejectedDoc = await withTransaction((tx) =>
      createStockDocument(tx, site.admin, {
        doc_type: "ADJUSTMENT",
        reason_code: "COUNT_GAIN",
        warehouse_id: site.warehouse,
        lines: [
          { item_id: freeItem.id, lot_id: rejected.id, to_location_id: site.quarantine, qty: 5, uom: freeItem.base_uom },
        ],
      })
    );
    await expect(
      withTransaction((tx) => postStockDocument(tx, site.admin, gainRejectedDoc.id, gainRejectedDoc.version))
    ).rejects.toMatchObject({ code: "LOT_REJECTED" });
  });

  it("6. COLUMN_CLEANING_REQUIRED: cross-molecule HPLC column run blocked until cleaned", async () => {
    const operator = await createUser("HPLC Operator ISO", PIN);
    await grant(operator, ["asset.manage", "asset.operate", "asset.view", "oligo.post.manage", "oligo.view"]);

    const col = await withTransaction((tx) =>
      createColumn(tx, operator, {
        code: `COL-ISO-${uniq()}`,
        name: "Waters XBridge C18",
        price_vnd: 25_000_000,
        design_runs: 200,
      })
    );

    await withTransaction((tx) =>
      recordColumnRun(tx, operator, col.id, {
        sequence_code: "SEQ-DNA-1",
        step_name: "RP-HPLC",
        molecule_type: "DNA",
      })
    );

    await expect(
      withTransaction((tx) =>
        recordColumnRun(tx, operator, col.id, {
          sequence_code: "SEQ-RNA-1",
          step_name: "RP-HPLC",
          molecule_type: "RNA",
        })
      )
    ).rejects.toMatchObject({ code: "COLUMN_CLEANING_REQUIRED" });

    await withTransaction((tx) => cleanColumn(tx, operator, col.id, "Wash ACN/Water 80:20 30 min"));

    await withTransaction((tx) =>
      recordColumnRun(tx, operator, col.id, {
        sequence_code: "SEQ-RNA-1",
        step_name: "RP-HPLC",
        molecule_type: "RNA",
      })
    );

    const check = (
      await getFactoryPool().query(
        `SELECT c.last_molecule_type,
                c.last_cleaned_at,
                (SELECT count(*)::int FROM asset.lc_column_run r WHERE r.column_id = c.id) AS runs_used
           FROM asset.lc_column c
          WHERE c.id = $1`,
        [col.id]
      )
    ).rows[0];
    expect(check.last_molecule_type).toBe("RNA");
    expect(check.last_cleaned_at).toBeTruthy();
    expect(Number(check.runs_used)).toBe(2);
  });
});
