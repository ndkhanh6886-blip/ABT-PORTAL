import { factoryRoute } from "@/factory/http";
import { ensureFactoryBootstrapped } from "@/factory/bootstrap";
import { query } from "@/backend/db/db";

const SAMPLE_LEGAL_LICENSES = [
  {
    id: "LIC-ABT-001",
    licenseNumber: "24000185/ĐKLH-BYT-TB-CT",
    productName: "Bộ Kit Định Lượng HBV Real-time PCR (TopSENSI® HBV qPCR Kit - Chia sẵn .D.IC • KIT-HBV-50T.D.IC)",
    deviceClass: "Loại C",
    manufacturer: "Công ty TNHH Giải pháp Y sinh ABT (Nhà máy ISO 13485)",
    origin: "Việt Nam",
    issueDate: "15/03/2024",
    expiryDate: "15/03/2029",
    status: "CON_HAN",
    agency: "Bộ Y Tế - Cục Cơ Sở Hạ Tầng & Thiết Bị Y Tế",
    notes: "Liên kết Hồ sơ Thiết kế DHF-HBV-qPCR (Phòng Nghiên Cứu R&D) & BOM KIT-HBV-50T.D.IC (Phòng Sản Xuất Kit).",
  },
  {
    id: "LIC-ABT-002",
    licenseNumber: "24000219/ĐKLH-BYT-TB-CT",
    productName: "Bộ Kit Tách Chiết DNA/RNA Tự Động Từ Hạt Từ (TopPURE® MagaQuick Viral Extraction • KIT-VL2370-50T)",
    deviceClass: "Loại A",
    manufacturer: "Công ty TNHH Giải pháp Y sinh ABT (Nhà máy ISO 13485)",
    origin: "Việt Nam",
    issueDate: "10/01/2024",
    expiryDate: "31/12/2028",
    status: "CON_HAN",
    agency: "Sở Y Tế TP. Hồ Chí Minh",
    notes: "Liên kết trực tiếp với mã thành phẩm KIT-VL2370-50T tại Phòng Sản Xuất Kit.",
  },
  {
    id: "LIC-ABT-003",
    licenseNumber: "23000892/PCBB-BYT-TB",
    productName: "Hệ Thống Máy Tách Chiết Axit Nucleic Tự Động 32 Mẫu ABT (Model EZ32)",
    deviceClass: "Loại B",
    manufacturer: "Phòng Kỹ thuật – Thiết bị ABT (DMR EZ32 Rev A)",
    origin: "Việt Nam",
    issueDate: "20/06/2023",
    expiryDate: "20/06/2028",
    status: "CON_HAN",
    agency: "Sở Y Tế TP. Hồ Chí Minh",
    notes: "Liên kết Hồ sơ Thiết bị Gốc DMR EZ32 Rev A (Phòng Kỹ Thuật – Thiết Bị).",
  },
];

const SAMPLE_LEGAL_TENDERS = [
  {
    id: "TND-ABT-001",
    code: "TBMT-2026-CR-088",
    hospitalName: "Bệnh viện Chợ Rẫy — Khoa Sinh học Phân tử",
    packageName: "Gói thầu Cung cấp Sinh phẩm Chẩn đoán HBV/HCV Real-time PCR (.D.IC) & Hóa chất tách chiết từ tính năm 2026",
    bidValue: "2.850.000.000 VNĐ",
    submissionDeadline: "25/11/2026",
    status: "DAT_CHUAN",
    checklist: {
      circulationLicense: true,
      loaAuthorization: true,
      iso13485: true,
      financialReport: true,
      gdpGspColdChain: true,
    },
    notes: "Đã đính kèm COA xuất xưởng từ Phòng QA/QC, Số lưu hành 24000185/ĐKLH-BYT-TB-CT và Chứng chỉ ISO 13485:2016.",
    assignedLawyer: "LS. Đỗ Quỳnh Trang",
  },
  {
    id: "TND-ABT-002",
    code: "TBMT-2026-ND1-042",
    hospitalName: "Bệnh viện Nhi Đồng 1",
    packageName: "Gói thầu Mua sắm Máy tách chiết tự động 32 giếng EZ32 & Bộ Kit tách chiết DNA/RNA",
    bidValue: "1.420.000.000 VNĐ",
    submissionDeadline: "15/11/2026",
    status: "DANG_RA_SOAT",
    checklist: {
      circulationLicense: true,
      loaAuthorization: true,
      iso13485: true,
      financialReport: true,
      gdpGspColdChain: true,
    },
    notes: "Liên kết hồ sơ kỹ thuật DMR EZ32 Rev A (Phòng Kỹ Thuật – Thiết Bị) & Kit KIT-VL2370-50T (Phòng Sản Xuất Kit).",
    assignedLawyer: "LS. Đỗ Quỳnh Trang",
  },
];

const SAMPLE_LEGAL_CONTRACTS = [
  {
    id: "CTR-ABT-001",
    code: "HĐKT-2026/ABT-CR-019",
    title: "Hợp đồng Cung ứng Kit HBV qPCR (.D.IC) & Đặt máy tách chiết tự động EZ32",
    partnerName: "Bệnh viện Chợ Rẫy",
    type: "Bán hàng Bệnh Viện",
    value: "1.950.000.000 VNĐ",
    requester: "Phòng Kinh Doanh",
    department: "Kinh Doanh",
    submitDate: "01/02/2026",
    status: "DA_THONG_QUA",
    riskLevel: "THAP",
    riskNotes: "Cam kết bảo quản chuỗi lạnh -20°C đối với Kit qPCR và SLA bảo hành 24h cho máy EZ32; liên kết COA từng lô từ Phòng QA/QC.",
    expiryDate: "31/12/2026",
    assignedLawyer: "LS. Đỗ Quỳnh Trang",
  },
  {
    id: "CTR-ABT-002",
    code: "HĐGC-2026/ABT-CNC-004",
    title: "Hợp đồng Gia công Cơ khí CNC Khung vỏ nhôm Anodize & Đầu từ tính máy EZ32",
    partnerName: "Công ty Cơ khí Chính xác & Mạch in CNC Việt Nam",
    type: "Thuê kho / Dịch vụ",
    value: "480.000.000 VNĐ",
    requester: "KS. Hoàng Gia Huy",
    department: "Kỹ Thuật – Thiết Bị",
    submitDate: "12/03/2026",
    status: "DA_THONG_QUA",
    riskLevel: "THAP",
    riskNotes: "Kèm Thỏa thuận Bảo mật Bản vẽ Kỹ thuật (NDA) cho bản vẽ DRW-EZ32-MECH-01 thuộc Hồ sơ DMR EZ32.",
    expiryDate: "31/12/2026",
    assignedLawyer: "LS. Đỗ Quỳnh Trang",
  },
];

const SAMPLE_LEGAL_DOCUMENTS = [
  {
    id: "DOC-ABT-001",
    code: "NĐ-98/2021/NĐ-CP",
    title: "Nghị định 98/2021/NĐ-CP & NĐ 07/2023/NĐ-CP về Quản lý Trang thiết bị Y tế & Sinh phẩm Chẩn đoán IVD",
    category: "Nghị Định & Luật",
    issuingBody: "Chính phủ & Bộ Y Tế",
    effectiveDate: "01/01/2022",
    status: "DANG_HIEU_LUC",
    summary: "Quy định phân loại TTBYT/IVD (Loại A, B, C, D), hồ sơ kỹ thuật CSDT, công bố tiêu chuẩn áp dụng, đăng ký số lưu hành và truy xuất nguồn gốc lô sản xuất.",
  },
  {
    id: "DOC-ABT-002",
    code: "ISO-13485:2016",
    title: "Tiêu chuẩn Quốc tế ISO 13485:2016 — Hệ thống Quản lý Chất lượng Trang thiết bị Y tế & Sinh phẩm IVD",
    category: "Tiêu Chuẩn ISO/TCVN",
    issuingBody: "ISO / TUV Rheinland",
    effectiveDate: "01/03/2016",
    status: "DANG_HIEU_LUC",
    summary: "Kiểm soát toàn diện Hồ sơ Lịch sử Thiết kế (DHF - R&D), Hồ sơ Thiết bị Gốc (DMR), Hồ sơ Lô Điện tử (eBR - Kit/Oligo), Hồ sơ Lịch sử Thiết bị (DHR - Máy) và CAPA/NCR.",
  },
];

async function ensureSampleLegalStorage(): Promise<void> {
  const seeds: { key: string; data: any[]; matchField: string }[] = [
    { key: "legal_licenses", data: SAMPLE_LEGAL_LICENSES, matchField: "licenseNumber" },
    { key: "legal_tenders", data: SAMPLE_LEGAL_TENDERS, matchField: "code" },
    { key: "legal_contracts", data: SAMPLE_LEGAL_CONTRACTS, matchField: "code" },
    { key: "legal_documents", data: SAMPLE_LEGAL_DOCUMENTS, matchField: "code" },
  ];
  for (const s of seeds) {
    const res = await query("SELECT data FROM app_storage WHERE key = $1", [s.key]);
    const existing = res.rows[0]?.data;
    const isValid = Array.isArray(existing) && existing.length > 0 && existing[0]?.[s.matchField];
    if (!isValid) {
      await query(
        `INSERT INTO app_storage (key, data, version, updated_at)
         VALUES ($1, $2::jsonb, 1, NOW())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        [s.key, JSON.stringify(s.data)]
      );
    }
  }
}

export const GET = factoryRoute(async (tx, { actor }) => {
  await ensureFactoryBootstrapped(tx, actor);
  if (process.env.FACTORY_ALLOW_DEMO_SEED === "1") {
    await ensureSampleLegalStorage().catch(() => {});

    // Ensure standard QMS Controlled Documents (SOPs) exist so QA/QC and Legal share controlled documents
    const qaOrg = (await tx.query("SELECT id FROM core.org_unit WHERE module_key = 'QA' LIMIT 1")).rows[0];
    const rdOrg = (await tx.query("SELECT id FROM core.org_unit WHERE module_key = 'RD' LIMIT 1")).rows[0];
    const docCount = Number((await tx.query("SELECT count(*)::int AS c FROM qms.controlled_document")).rows[0]?.c ?? 0);
    if (docCount === 0) {
      await tx.query(
        `INSERT INTO qms.controlled_document
           (code, doc_version, title, doc_type, org_unit_id, effective_date, review_due_date, content_summary, status, approved_by, approved_at, created_by)
         VALUES
           ('SOP-QA-001', 1, 'Quy trình Thẩm định QC & Giải phóng Lô Xuất Xưởng (COA) theo ISO 13485:2016', 'SOP', $1, '2026-01-01', '2027-01-01',
            'Quy định trình tự kiểm nghiệm IQC/IPQC/OQC, đối soát hồ sơ lô eBR/DHR và cấp Chứng nhận phân tích xuất xưởng (COA) phục vụ lưu hành & đấu thầu bệnh viện.',
            'EFFECTIVE', 1, now(), 1),
           ('SOP-RD-002', 1, 'Quy trình Kiểm soát Thiết kế (DHF), Thẩm định Hiệu năng Lâm sàng & Hồ sơ CSDT Đăng ký Lưu hành IVD', 'SOP', $2, '2026-01-01', '2027-01-01',
            'Quy định cấu trúc Hồ sơ Lịch sử Thiết kế (DHF), nghiên cứu độ ổn định (Stability) và bàn giao hồ sơ kỹ thuật CSDT sang Phòng Pháp Chế đăng ký số lưu hành Bộ Y Tế.',
            'EFFECTIVE', 1, now(), 1)
         ON CONFLICT DO NOTHING`,
        [qaOrg?.id ?? null, rdOrg?.id ?? null]
      );
    }
  }

  const products = (
    await tx.query(`
      SELECT id, code, name, item_type, base_uom, storage_temp, shelf_life_days
        FROM master.item
       WHERE status = 'ACTIVE' AND item_type IN ('FINISHED_KIT', 'DEVICE', 'SEMI_FINISHED')
       ORDER BY item_type, code
    `)
  ).rows;

  const dhf_projects = (
    await tx.query(`
      SELECT id, code, name, product_line, target_specs, status, start_date, target_date
        FROM rd.project
       ORDER BY created_at DESC LIMIT 30
    `)
  ).rows;

  const dmr_revisions = (
    await tx.query(`
      SELECT r.id, m.code AS model_code, m.name AS model_name, m.category, m.warranty_months,
             r.revision, r.firmware_version, r.dmr_summary, r.status, r.released_at
        FROM device.model_revision r
        JOIN device.device_model m ON m.id = r.model_id
       ORDER BY m.code, r.created_at DESC
    `)
  ).rows;

  const coas = (
    await tx.query(`
      SELECT *
        FROM kit.coa_certificate
       ORDER BY issued_at DESC LIMIT 30
    `)
  ).rows;

  const controlled_docs = (
    await tx.query(`
      SELECT id, code, doc_version, title, doc_type, effective_date, review_due_date, content_summary, status
        FROM qms.controlled_document
       ORDER BY code, doc_version DESC LIMIT 30
    `)
  ).rows;

  const pulseRow = (
    await tx.query(`
      SELECT
        (SELECT count(*)::int FROM rd.project WHERE status NOT IN ('CLOSED', 'CANCELLED')) AS rd_projects,
        (SELECT count(*)::int FROM kit.production_order WHERE status NOT IN ('COMPLETED', 'CANCELLED')) AS kit_orders,
        (SELECT count(*)::int FROM oligo.synthesis_batch WHERE status NOT IN ('COMPLETED', 'CANCELLED')) AS oligo_batches,
        (SELECT count(*)::int FROM device.production_order WHERE status NOT IN ('COMPLETED', 'CANCELLED')) AS device_orders,
        (SELECT count(*)::int FROM qms.ncr WHERE status != 'CLOSED') AS open_ncrs,
        (SELECT count(*)::int FROM inv.lot WHERE qa_status = 'QUARANTINE') AS quarantine_lots,
        (SELECT count(*)::int FROM plan.intake_order WHERE status NOT IN ('CLOSED', 'CANCELLED')) AS intake_orders,
        (SELECT count(*)::int FROM proc.purchase_requisition WHERE status NOT IN ('CLOSED', 'REJECTED', 'CANCELLED')) AS open_prs,
        (SELECT count(*)::int FROM inv.lot WHERE status = 'ACTIVE') AS active_lots
    `)
  ).rows[0] ?? {};

  return {
    products,
    dhf_projects,
    dmr_revisions,
    coas,
    controlled_docs,
    pulse: pulseRow,
  };
});
