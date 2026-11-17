import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthzActor } from "../../core/authz";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../../core/db";
import { preAuthenticate, runTransition, type MachineDef, type TransitionRequest } from "../../core/stateMachine";
import { migrate } from "../../db/migrate";
import { createOrgUnit, createUser, grant } from "../../__tests__/helpers";
import "../../modules";
import { createProject } from "../projects";
import {
  attachTechTransferFile,
  createTechTransferPackage,
  deleteTransferTemplate,
  getProjectTransferPrefill,
  getTechTransferDetail,
  listTechTransfers,
  listTransferTemplates,
  readTechTransferFile,
  saveTechTransferChecklistItem,
  saveTransferTemplate,
  techTransferMachine,
  updateTechTransferPackage,
} from "../transfer";

const PIN = "482910";
const signed = { credential: { method: "PIN" as const, secret: PIN } };

async function act<S extends string, R extends { id: string; status: S; version: number }>(
  machine: MachineDef<S, R>,
  actor: AuthzActor,
  id: string,
  action: string,
  extra: Partial<TransitionRequest> = {}
): Promise<R> {
  const row = (await getFactoryPool().query(`SELECT status, version FROM ${machine.table} WHERE id = $1`, [id])).rows[0];
  const req: TransitionRequest = { id, action, expectedVersion: row.version, ...extra };
  await preAuthenticate(machine, row.status, req, actor);
  return withTransaction((tx) => runTransition(tx, machine, actor, req, { signerAuthenticated: true }));
}

describe("Tech Transfer Dossier & Templates (ISO 13485 §7.3.8)", () => {
  let rdDept: string;
  let kitDept: string;
  let researcher: AuthzActor;
  let rdHead: AuthzActor;
  let kitHead: AuthzActor;

  beforeAll(async () => {
    await migrate(getFactoryPool());

    rdDept = await createOrgUnit("RD-TT");
    kitDept = await createOrgUnit("KIT-PROD-TT");

    researcher = await createUser("Chuyên viên R&D Chuyển giao", PIN);
    await grant(
      researcher,
      ["rd.view", "rd.project.manage", "rd.transfer.manage", "master.data.view", "inv.stock.view"],
      rdDept
    );

    rdHead = await createUser("Trưởng phòng R&D Chuyển giao", PIN);
    await grant(
      rdHead,
      ["rd.view", "rd.project.manage", "rd.transfer.manage", "master.data.view"],
      rdDept
    );

    kitHead = await createUser("Trưởng xưởng Kit Tiếp nhận", PIN);
    await grant(kitHead, ["rd.view", "rd.transfer.accept", "qms.qc.view", "kit.view"], kitDept);
  });

  afterAll(closeFactoryPool);

  it("1. Lists default ISO 13485 dossier templates (15 PCR / 6 Oligo / 6 Device items) and supports custom template CRUD", async () => {
    const defaults = await withTransaction((tx) => listTransferTemplates(tx, rdHead));
    const pcrTpl = defaults.find((t) => t.code === "TT-IVD-PCR-STD");
    const oligoTpl = defaults.find((t) => t.code === "TT-OLIGO-STD");
    const deviceTpl = defaults.find((t) => t.code === "TT-DEVICE-STD");

    expect(pcrTpl).toBeDefined();
    expect(pcrTpl!.items).toHaveLength(15);
    const sectionCodes = new Set(pcrTpl!.items.map((i: any) => i.section_code));
    expect(sectionCodes.size).toBe(8);

    // Confirm all 4 PCR IFU variants & core dossier doc_codes are represented in the seeded PCR template
    const pcrDocCodes = new Set(pcrTpl!.items.map((i: any) => i.doc_code));
    expect(pcrDocCodes.has("IFU_MSDS_PACKAGE")).toBe(true);
    expect(pcrDocCodes.has("BOM_ASL_IQC_SPEC")).toBe(true);
    expect(pcrDocCodes.has("QC_RELEASE_TCCS")).toBe(true);
    const ifuItem = pcrTpl!.items.find((i: any) => i.doc_code === "IFU_MSDS_PACKAGE");
    expect(ifuItem?.guidance).toContain("Không chia sẵn");
    expect(ifuItem?.guidance).toContain("Chia sẵn");

    expect(oligoTpl).toBeDefined();
    expect(oligoTpl!.items).toHaveLength(6);
    expect(deviceTpl).toBeDefined();
    expect(deviceTpl!.items).toHaveLength(6);

    // Create a custom template
    const created = await withTransaction((tx) =>
      saveTransferTemplate(tx, rdHead, {
        name: "Mẫu hồ sơ Kit Lyophilized chuẩn mở rộng",
        domain: "KIT",
        description: "Áp dụng cho dây chuyền đóng gói kit dạng đông khô",
        is_default: false,
        items: [
          {
            seq: 1,
            section_code: "SEC_01_SPEC",
            section_name: "1. Đặc tả sản phẩm",
            doc_code: "LYO_SPEC",
            item_name: "Tiêu chuẩn độ ẩm tồn dư sau đông khô",
            guidance: "Karl Fischer < 2.0%",
            is_required: true,
          },
          {
            seq: 2,
            section_code: "SEC_02_BOM",
            section_name: "2. Định mức & Vật tư",
            doc_code: "VIAL_CLOSURE",
            item_name: "Thông số nút cao su butyl & seal nhôm",
            guidance: null,
            is_required: false,
          },
        ],
      })
    );
    expect(created.code).toMatch(/^TTT-\d{3,}$/);
    expect(created.items).toHaveLength(2);

    // Update & reorder custom template items
    const updated = await withTransaction((tx) =>
      saveTransferTemplate(tx, rdHead, {
        id: created.id,
        name: "Mẫu hồ sơ Kit Lyophilized v2",
        domain: "KIT",
        description: "Đã cập nhật thứ tự mục",
        is_default: false,
        items: [
          {
            seq: 1,
            section_code: "SEC_02_BOM",
            section_name: "2. Định mức & Vật tư",
            doc_code: "VIAL_CLOSURE",
            item_name: "Thông số nút cao su butyl & seal nhôm (Bắt buộc)",
            guidance: "Kiểm tra độ kín chân không",
            is_required: true,
          },
          {
            seq: 2,
            section_code: "SEC_01_SPEC",
            section_name: "1. Đặc tả sản phẩm",
            doc_code: "LYO_SPEC",
            item_name: "Tiêu chuẩn độ ẩm tồn dư sau đông khô",
            guidance: "Karl Fischer < 2.0%",
            is_required: true,
          },
        ],
      })
    );
    expect(updated.name).toBe("Mẫu hồ sơ Kit Lyophilized v2");
    expect(updated.items[0].doc_code).toBe("VIAL_CLOSURE");
    expect(updated.items[1].doc_code).toBe("LYO_SPEC");

    // Clean up custom template (unused)
    await withTransaction((tx) => deleteTransferTemplate(tx, rdHead, created.id));
    const afterDelete = await withTransaction((tx) => listTransferTemplates(tx, rdHead));
    expect(afterDelete.some((t) => t.id === created.id)).toBe(false);
  });

  it("2. Enforces dossier completeness gate, supports multi-file upload/download & custom checklist items, and generates BOM/Routing/QC on signed accept", async () => {
    const project = await withTransaction((tx) =>
      createProject(tx, researcher, {
        name: "Dự án phát triển Kit Real-time PCR Đa kênh K-2026",
        owner_org_unit_id: rdDept,
        project_type: "NEW_PRODUCT",
        target_domain: "KIT",
        ivd_class: "CLASS_C",
        description: "Bộ kit khuếch đại huỳnh quang 4 kênh chuẩn tổng quát",
      })
    );

    const templates = await withTransaction((tx) => listTransferTemplates(tx, researcher, "KIT"));
    const pcrTpl = templates.find((t) => t.code === "TT-IVD-PCR-STD")!;

    // Prefill endpoint works cleanly
    const prefill = await withTransaction((tx) => getProjectTransferPrefill(tx, researcher, project.id));
    expect(prefill.project.id).toBe(project.id);
    expect(prefill.project.code).toBe(project.code);

    // Create DRAFT tech transfer package with multi-line BOM, routing, QC criteria & metadata
    const pkg = await withTransaction((tx) =>
      createTechTransferPackage(tx, researcher, {
        project_id: project.id,
        template_id: pcrTpl.id,
        target_domain: "KIT",
        target_org_unit_id: kitDept,
        title: "Hồ sơ chuyển giao Kit Real-time PCR Đa kênh K-2026 (50 test/hộp)",
        bom_specification: [
          {
            component_code: "MM-2X-STD",
            component_name: "Dung dịch Mastermix 2X khởi động nóng",
            qty_per_kit: 1.25,
            qty_aliquoted: 1.0,
            uom: "mL",
            role: "MASTER_MIX",
            scrap_pct: 3,
            box_no: 1,
          },
          {
            component_code: "PR-MIX-4C",
            component_name: "Hỗn hợp Mồi & Mẫu dò huỳnh quang 4 màu",
            qty_per_kit: 0.5,
            qty_aliquoted: 0.5,
            uom: "mL",
            role: "PRIMER_PROBE",
            scrap_pct: 5,
            box_no: 1,
          },
          {
            component_code: "CTRL-POS-SYN",
            component_name: "Chứng dương tổng hợp chuẩn hiệu chuẩn",
            qty_per_kit: 0.1,
            qty_aliquoted: 0.1,
            uom: "mL",
            role: "POSITIVE_CONTROL",
            scrap_pct: 2,
            box_no: 1,
          },
          {
            component_code: "TUBE-8-02ML",
            component_name: "Dải 8 tube phản ứng 0.2mL nắp quang học",
            qty_per_kit: 8,
            qty_aliquoted: 8,
            uom: "EA",
            role: "PACKAGING",
            scrap_pct: 1,
            box_no: 2,
          },
        ],
        routing_steps: [
          { seq: 10, step_name: "Pha chế bán thành phẩm Mastermix tại phòng sạch", params: "2-8°C, độ ẩm < 50%", qc_check: "IPQC-01: pH & độ dẫn" },
          { seq: 20, step_name: "Chia liều tự động vào tube & kiểm tra thể tích", params: "Dung sai ±2%", qc_check: "IPQC-02: Trọng lượng ống" },
          { seq: 30, step_name: "Dán nhãn UDI, kẹp IFU phù hợp biến thể & đóng hộp", params: "1 hộp x 50 test", qc_check: "FQC-01: Kiểm tra trực quan & barcode" },
        ],
        qc_release_criteria: [
          { stage: "IQC", parameter: "Độ tinh sạch Primer/Probe (HPLC)", method: "RP-HPLC", unit: "%", target: ">= 90%" },
          { stage: "IPQC", parameter: "Thể tích chia liều mỗi giếng", method: "Cân phân tích", unit: "µL", target: "20 ± 0.5" },
          { stage: "FQC", parameter: "Độ nhạy phân tích (LoD95)", method: "qPCR chuẩn", unit: "copies/rxn", target: "<= 10" },
          { stage: "FQC", parameter: "Chứng âm (NTC) không tín hiệu", method: "qPCR 45 chu kỳ", unit: "Ct", target: "Undetermined" },
        ],
        transfer_metadata: {
          batch_size_std: "500 hộp (25.000 test)/lô",
          storage_condition: "-20°C ± 5°C, tránh ánh sáng trực tiếp",
          shelf_life_months: 12,
          cleanroom_class: "ISO Class 7 / Tủ an toàn cấp II",
          cold_chain_required: true,
          biosafety_notes: "Tuân thủ thao tác vô trùng phòng sạch phân tử, tránh nhiễm chéo DNA.",
        },
        stability_summary: "Ổn định 12 tháng ở -20°C; đạt 6 tháng thử nghiệm tăng tốc và 5 chu kỳ đông/rã đông.",
        validation_summary: "LoD95 đạt 8 copies/rxn trên cả 4 kênh huỳnh quang; CV nội lô < 2.1%; độ nhạy tương thích đạt 99.2%.",
        submit_now: false,
      })
    );

    expect(pkg.status).toBe("DRAFT");
    expect(pkg.code).toMatch(/^TTP?\d{2}-/);

    // Verify list formatting has zero 'undefined' artifacts and accurate checklist counters
    const listRows = await withTransaction((tx) => listTechTransfers(tx, researcher, project.id));
    expect(listRows).toHaveLength(1);
    expect(listRows[0].bom_specification).toHaveLength(4);
    expect(listRows[0].dossier_total).toBe(15);

    // Update draft stability summary
    await withTransaction((tx) =>
      updateTechTransferPackage(tx, researcher, pkg.id, {
        stability_summary: "Ổn định 12 tháng ở -20°C; đạt 6 tháng tăng tốc & 5 chu kỳ đông/rã đông (cập nhật rev 2).",
      })
    );

    // Add a custom package-level checklist item
    await withTransaction((tx) =>
      saveTechTransferChecklistItem(tx, researcher, pkg.id, {
        action: "upsert",
        section_code: "SEC_08_PILOT",
        section_name: "8. Lô thử nghiệm (Pilot) & Nghiệm thu",
        doc_code: "CUSTOM_SOP_CLEAN",
        item_name: "Quy trình vệ sinh dây chuyền chuyển đổi giữa các lô",
        guidance: "Tham chiếu hồ sơ làm sạch",
        is_required: true,
      })
    );

    let detail = await withTransaction((tx) => getTechTransferDetail(tx, researcher, pkg.id));
    expect(detail.items).toHaveLength(16);
    expect(detail.qc_release_criteria).toHaveLength(4);
    expect(detail.transfer_metadata.shelf_life_months).toBe(12);

    // Submitting now MUST fail because required items are still MISSING
    await expect(act(techTransferMachine, researcher, pkg.id, "submit")).rejects.toThrow(/hồ sơ/i);

    // Upload real PDF and CSV buffers to items via attachTechTransferFile
    const pdfItem = detail.items.find((i: any) => i.doc_code === "BOM_ASL_IQC_SPEC")!;
    const csvItem = detail.items.find((i: any) => i.doc_code === "QC_RELEASE_TCCS")!;
    expect(pdfItem).toBeDefined();
    expect(csvItem).toBeDefined();
    const pdfBytes = Buffer.from(
      "%PDF-1.4\n%ABT-TT-Test\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
      "utf8"
    );
    const csvBytes = Buffer.from("parameter,method,target\nLoD95,qPCR,<=10 copies/rxn\nNTC,qPCR,Undetermined\n", "utf8");

    const pdfAttachment = await withTransaction((tx) =>
      attachTechTransferFile(tx, researcher, pkg.id, {
        itemId: pdfItem.id,
        fileName: "BOM_K2026_Rev01.pdf",
        mimeType: "application/pdf",
        data: pdfBytes,
      })
    );
    const csvAttachment = await withTransaction((tx) =>
      attachTechTransferFile(tx, researcher, pkg.id, {
        itemId: csvItem.id,
        fileName: "QC_Spec_K2026.csv",
        mimeType: "text/csv",
        data: csvBytes,
      })
    );

    // Verify byte-for-byte download round-trip
    const readPdf = await withTransaction((tx) => readTechTransferFile(tx, researcher, pkg.id, pdfAttachment.id));
    expect(readPdf.data.equals(pdfBytes)).toBe(true);
    expect(readPdf.mimeType).toBe("application/pdf");

    const readCsv = await withTransaction((tx) => readTechTransferFile(tx, researcher, pkg.id, csvAttachment.id));
    expect(readCsv.data.equals(csvBytes)).toBe(true);

    // Refresh detail and confirm attached MISSING items auto-promoted to SUBMITTED
    detail = await withTransaction((tx) => getTechTransferDetail(tx, researcher, pkg.id));
    expect(detail.items.find((i: any) => i.id === pdfItem.id)!.status).toBe("SUBMITTED");
    expect(detail.items.find((i: any) => i.id === csvItem.id)!.status).toBe("SUBMITTED");

    // Satisfy all remaining required items (either SUBMITTED with doc_ref_code or WAIVED with notes)
    for (const item of detail.items) {
      if (!item.is_required || item.status !== "MISSING") continue;
      if (item.doc_code === "CLINICAL_EVAL_REPORT") {
        // Test WAIVED path for clinical evaluation exempted under RUO / bridging waiver
        await withTransaction((tx) =>
          saveTechTransferChecklistItem(tx, researcher, pkg.id, {
            action: "upsert",
            id: item.id,
            status: "WAIVED",
            notes: "Miễn trừ thử nghiệm lâm sàng bổ sung theo quyết định hội đồng chuyển giao.",
          })
        );
      } else {
        await withTransaction((tx) =>
          saveTechTransferChecklistItem(tx, researcher, pkg.id, {
            action: "upsert",
            id: item.id,
            status: "SUBMITTED",
            doc_ref_code: `DOC-${item.doc_code}-R01`,
            notes: "Đã hoàn tất đối chiếu DHF",
          })
        );
      }
    }

    // Submit package -> succeeds now that all required items are satisfied!
    const submitted = await act(techTransferMachine, researcher, pkg.id, "submit");
    expect(submitted.status).toBe("SUBMITTED");

    // Receiving Kit Production head signs accept with PIN
    const accepted = await act(techTransferMachine, kitHead, pkg.id, "accept", signed);
    expect(accepted.status).toBe("ACCEPTED");

    // Re-fetch package detail to read post-accept effects (product_item_id & created_qc_spec_id)
    const acceptedDetail = await withTransaction((tx) => getTechTransferDetail(tx, kitHead, pkg.id));
    expect(acceptedDetail.product_item_id).toBeTruthy();
    expect(acceptedDetail.created_qc_spec_id).toBeTruthy();

    // Verify generated QC Spec, BOM (including qty_per_base_aliquoted & mapped role), and Routing in DB
    const pool = getFactoryPool();
    const specRow = (
      await pool.query("SELECT * FROM qms.qc_spec WHERE id = $1", [acceptedDetail.created_qc_spec_id])
    ).rows[0];
    expect(specRow).toBeDefined();
    expect(specRow.status).toBe("DRAFT");
    const specParams = (
      await pool.query("SELECT * FROM qms.qc_spec_parameter WHERE spec_id = $1 ORDER BY seq", [specRow.id])
    ).rows;
    expect(specParams.length).toBeGreaterThanOrEqual(4);
    expect(specParams.some((c: any) => c.name?.includes("LoD95"))).toBe(true);

    const bomRow = (
      await pool.query(
        "SELECT id FROM kit.bom WHERE product_item_id = $1 ORDER BY created_at DESC LIMIT 1",
        [acceptedDetail.product_item_id]
      )
    ).rows[0];
    expect(bomRow).toBeDefined();

    const bomLines = (
      await pool.query(
        "SELECT l.*, i.code AS item_code FROM kit.bom_line l JOIN master.item i ON i.id = l.component_item_id WHERE l.bom_id = $1 ORDER BY l.line_no",
        [bomRow.id]
      )
    ).rows;
    expect(bomLines).toHaveLength(4);
    expect(bomLines[0].item_code).toBe("MM-2X-STD");
    expect(Number(bomLines[0].qty_per_base)).toBe(1.25);
    expect(Number(bomLines[0].qty_per_base_aliquoted)).toBe(1.0);
    expect(Number(bomLines[0].scrap_pct)).toBe(3);

    const routingSteps = (
      await pool.query(
        "SELECT rs.* FROM kit.routing_step rs JOIN kit.routing r ON r.id = rs.routing_id WHERE r.product_item_id = $1 ORDER BY rs.seq",
        [acceptedDetail.product_item_id]
      )
    ).rows;
    expect(routingSteps).toHaveLength(3);
    expect(routingSteps[0].step_name).toContain("Mastermix");

    // Complete transition (receiving dept signs off completion with verified pilot lot)
    const completed = await act(techTransferMachine, kitHead, pkg.id, "complete", {
      payload: { pilot_lot_ref: "PILOT-K2026-01" },
    });
    expect(completed.status).toBe("COMPLETED");
  });
});
