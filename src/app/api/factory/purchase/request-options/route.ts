import { factoryRoute } from "@/factory/http";
import { hasFactoryPermission } from "@/factory/core/authz";

export interface PrReasonOption {
  id: string;
  category: string;
  label: string;
  value: string;
  entity_type?: string;
  entity_id?: string;
}

const STANDARD_REASONS_BY_MODULE: Record<string, { category: string; label: string; value: string }[]> = {
  RD: [
    {
      category: "Danh mục lý do R&D chuẩn",
      label: "Phục vụ dự án nghiên cứu & phát triển sản phẩm mới (R&D)",
      value: "Phục vụ dự án nghiên cứu & phát triển sản phẩm mới (R&D)",
    },
    {
      category: "Danh mục lý do R&D chuẩn",
      label: "Thực nghiệm tối ưu hóa công thức / Thí nghiệm ELN",
      value: "Thực nghiệm tối ưu hóa công thức / Thí nghiệm ELN",
    },
    {
      category: "Danh mục lý do R&D chuẩn",
      label: "Thẩm định độ nhạy, độ đặc hiệu & độ ổn định (Verification / Validation)",
      value: "Thẩm định độ nhạy, độ đặc hiệu & độ ổn định (Verification / Validation)",
    },
    {
      category: "Danh mục lý do R&D chuẩn",
      label: "Bổ sung hóa chất, mẫu chuẩn & vật tư tiêu hao phòng Lab R&D",
      value: "Bổ sung hóa chất, mẫu chuẩn & vật tư tiêu hao phòng Lab R&D",
    },
  ],
  KIT: [
    {
      category: "Danh mục lý do Sản xuất Kit chuẩn",
      label: "Bổ sung nguyên vật liệu thiếu cho Lệnh sản xuất Kit (eBR)",
      value: "Bổ sung nguyên vật liệu thiếu cho Lệnh sản xuất Kit (eBR)",
    },
    {
      category: "Danh mục lý do Sản xuất Kit chuẩn",
      label: "Pha chế Bán thành phẩm (MasterMix / Enzyme Mix / Đệm Buffer)",
      value: "Pha chế Bán thành phẩm (MasterMix / Enzyme Mix / Đệm Buffer)",
    },
    {
      category: "Danh mục lý do Sản xuất Kit chuẩn",
      label: "Bổ sung tồn kho an toàn dưới định mức tối thiểu (Kho Kit)",
      value: "Bổ sung tồn kho an toàn dưới định mức tối thiểu (Kho Kit)",
    },
    {
      category: "Danh mục lý do Sản xuất Kit chuẩn",
      label: "Mua bao bì cấp 1, cấp 2, tem nhãn & tờ hướng dẫn sử dụng (IFU)",
      value: "Mua bao bì cấp 1, cấp 2, tem nhãn & tờ hướng dẫn sử dụng (IFU)",
    },
  ],
  OLIGO: [
    {
      category: "Danh mục lý do Tổng hợp Oligo chuẩn",
      label: "Mua hóa chất chạy máy tổng hợp Oligo (Amidite A/C/G/T, Activator, Deblock, Cap A/B, Oxidizer)",
      value: "Mua hóa chất chạy máy tổng hợp Oligo (Amidite A/C/G/T, Activator, Deblock, Cap A/B, Oxidizer)",
    },
    {
      category: "Danh mục lý do Tổng hợp Oligo chuẩn",
      label: "Mua cột CPG, phẩm nhuộm huỳnh quang (FAM/HEX/CY5/BHQ) & dung môi tinh sạch HPLC/OPC",
      value: "Mua cột CPG, phẩm nhuộm huỳnh quang (FAM/HEX/CY5/BHQ) & dung môi tinh sạch HPLC/OPC",
    },
    {
      category: "Danh mục lý do Tổng hợp Oligo chuẩn",
      label: "Bổ sung vật tư tiêu hao (Tube đông khô, đĩa 96 giếng, đầu côn lọc) cho Phòng Oligo",
      value: "Bổ sung vật tư tiêu hao (Tube đông khô, đĩa 96 giếng, đầu côn lọc) cho Phòng Oligo",
    },
  ],
  DEVICE: [
    {
      category: "Danh mục lý do Kỹ thuật - Thiết bị chuẩn",
      label: "Mua linh kiện cơ - điện tử - quang học phục vụ Lệnh lắp ráp Thiết bị (mBOM)",
      value: "Mua linh kiện cơ - điện tử - quang học phục vụ Lệnh lắp ráp Thiết bị (mBOM)",
    },
    {
      category: "Danh mục lý do Kỹ thuật - Thiết bị chuẩn",
      label: "Mua linh kiện dự phòng bảo trì, hiệu chuẩn & sửa chữa bảo hành (RMA)",
      value: "Mua linh kiện dự phòng bảo trì, hiệu chuẩn & sửa chữa bảo hành (RMA)",
    },
    {
      category: "Danh mục lý do Kỹ thuật - Thiết bị chuẩn",
      label: "Mua phụ kiện đi kèm máy & vật tư kiểm định xuất xưởng (FAT / Burn-in Test)",
      value: "Mua phụ kiện đi kèm máy & vật tư kiểm định xuất xưởng (FAT / Burn-in Test)",
    },
  ],
  QMS: [
    {
      category: "Danh mục lý do QA/QC chuẩn",
      label: "Mua chất chuẩn đối chiếu (Reference Standard / Panel chuẩn) phục vụ kiểm nghiệm QC",
      value: "Mua chất chuẩn đối chiếu (Reference Standard / Panel chuẩn) phục vụ kiểm nghiệm QC",
    },
    {
      category: "Danh mục lý do QA/QC chuẩn",
      label: "Mua hóa chất & vật tư kiểm tra IQC đầu vào / IPQC / FQC xuất xưởng",
      value: "Mua hóa chất & vật tư kiểm tra IQC đầu vào / IPQC / FQC xuất xưởng",
    },
    {
      category: "Danh mục lý do QA/QC chuẩn",
      label: "Phục vụ nghiên cứu theo dõi độ ổn định dài hạn & cấp tốc (Stability Study)",
      value: "Phục vụ nghiên cứu theo dõi độ ổn định dài hạn & cấp tốc (Stability Study)",
    },
  ],
  DEFAULT: [
    {
      category: "Danh mục lý do chung",
      label: "Bổ sung nguyên vật liệu & hóa chất phục vụ kế hoạch hoạt động của phòng",
      value: "Bổ sung nguyên vật liệu & hóa chất phục vụ kế hoạch hoạt động của phòng",
    },
    {
      category: "Danh mục lý do chung",
      label: "Bù đắp tồn kho an toàn dưới định mức tối thiểu (Safety Stock)",
      value: "Bù đắp tồn kho an toàn dưới định mức tối thiểu (Safety Stock)",
    },
    {
      category: "Danh mục lý do chung",
      label: "Mua sắm vật tư tiêu hao & dụng cụ phòng thí nghiệm định kỳ",
      value: "Mua sắm vật tư tiêu hao & dụng cụ phòng thí nghiệm định kỳ",
    },
  ],
};

function detectModuleKey(unit: { code?: string; name?: string; module_key?: string | null }): string {
  if (unit.module_key) return String(unit.module_key).toUpperCase();
  const text = `${unit.code || ""} ${unit.name || ""}`.toUpperCase();
  if (text.includes("RD") || text.includes("R&D") || text.includes("NGHIÊN CỨU")) return "RD";
  if (text.includes("KIT")) return "KIT";
  if (text.includes("OLIGO")) return "OLIGO";
  if (text.includes("DEV") || text.includes("THIẾT BỊ") || text.includes("KỸ THUẬT")) return "DEVICE";
  if (text.includes("QC") || text.includes("QA") || text.includes("QMS")) return "QMS";
  return "DEFAULT";
}

/** Departments the user may request for, each with its own active warehouses, reason templates, and live projects/orders. */
export const GET = factoryRoute(async (tx, { actor }) => {
  const units = (
    await tx.query("SELECT id, code, name, module_key FROM core.org_unit WHERE status = 'ACTIVE' AND unit_type <> 'COMPANY' ORDER BY code")
  ).rows;

  // Query active R&D projects, experiments, Kit production orders, Oligo orders, Device work orders for reason dropdown
  const [rdProjects, rdExps, kitPos, oligoOrders, deviceWos, internalOrders] = await Promise.all([
    tx.query("SELECT id, code, name FROM rd.project WHERE status NOT IN ('CLOSED', 'CANCELLED') ORDER BY created_at DESC LIMIT 30").catch(() => ({ rows: [] })),
    tx.query("SELECT id, code, title FROM rd.experiment ORDER BY created_at DESC LIMIT 20").catch(() => ({ rows: [] })),
    tx.query(
      `SELECT po.id, po.code, i.name AS item_name
         FROM kit.production_order po
         LEFT JOIN master.item i ON i.id = po.item_id
        WHERE po.status NOT IN ('CLOSED', 'CANCELLED')
        ORDER BY po.created_at DESC LIMIT 30`
    ).catch(() => ({ rows: [] })),
    tx.query(
      `SELECT id, code, customer_label
         FROM oligo.oligo_order
        WHERE status NOT IN ('CLOSED', 'CANCELLED')
        ORDER BY created_at DESC LIMIT 30`
    ).catch(() => ({ rows: [] })),
    tx.query(
      `SELECT wo.id, wo.code, dm.name AS model_name
         FROM device.work_order wo
         LEFT JOIN device.device_model dm ON dm.id = wo.model_id
        WHERE wo.status NOT IN ('CLOSED', 'CANCELLED')
        ORDER BY wo.created_at DESC LIMIT 30`
    ).catch(() => ({ rows: [] })),
    tx.query(
      `SELECT o.id, o.code, o.kd_po_code, u.module_key
         FROM intake.internal_order o
         LEFT JOIN core.org_unit u ON u.id = o.org_unit_id
        WHERE o.status NOT IN ('CLOSED', 'CANCELLED', 'REJECTED')
        ORDER BY o.created_at DESC LIMIT 30`
    ).catch(() => ({ rows: [] })),
  ]);

  const out = [];
  for (const u of units) {
    if (!(await hasFactoryPermission(tx, actor, "purchase.pr.create", u.id))) continue;
    const warehouses = (
      await tx.query("SELECT id, code, name FROM master.warehouse WHERE owner_org_unit_id = $1 AND status = 'ACTIVE' ORDER BY code", [u.id])
    ).rows;

    const modKey = detectModuleKey(u);
    const reasons: PrReasonOption[] = [];

    if (modKey === "RD") {
      for (const prj of rdProjects.rows) {
        const val = `Dự án R&D [${prj.code}]: ${prj.name}`;
        reasons.push({
          id: `rd-prj-${prj.id}`,
          category: "📌 Dự án R&D & Thí nghiệm ELN đang triển khai",
          label: val,
          value: val,
          entity_type: "rd_project",
          entity_id: prj.id,
        });
      }
      for (const exp of rdExps.rows) {
        const val = `Thí nghiệm ELN [${exp.code}]: ${exp.title}`;
        reasons.push({
          id: `rd-exp-${exp.id}`,
          category: "📌 Dự án R&D & Thí nghiệm ELN đang triển khai",
          label: val,
          value: val,
          entity_type: "rd_experiment",
          entity_id: exp.id,
        });
      }
    } else if (modKey === "KIT") {
      for (const po of kitPos.rows) {
        const val = `Phục vụ Lệnh SX Kit [${po.code}]${po.item_name ? ` — ${po.item_name}` : ""}`;
        reasons.push({
          id: `kit-po-${po.id}`,
          category: "📌 Lệnh sản xuất Kit & Đơn nội bộ đang chạy",
          label: val,
          value: val,
          entity_type: "kit_production_order",
          entity_id: po.id,
        });
      }
    } else if (modKey === "OLIGO") {
      for (const oo of oligoOrders.rows) {
        const val = `Phục vụ Đơn Tổng hợp Oligo [${oo.code}]${oo.customer_label ? ` — ${oo.customer_label}` : ""}`;
        reasons.push({
          id: `oli-ord-${oo.id}`,
          category: "📌 Đơn Tổng hợp Oligo đang xử lý",
          label: val,
          value: val,
          entity_type: "oligo_order",
          entity_id: oo.id,
        });
      }
    } else if (modKey === "DEVICE") {
      for (const wo of deviceWos.rows) {
        const val = `Phục vụ Lệnh lắp ráp Thiết bị [${wo.code}]${wo.model_name ? ` — ${wo.model_name}` : ""}`;
        reasons.push({
          id: `dev-wo-${wo.id}`,
          category: "📌 Lệnh lắp ráp Thiết bị đang chạy",
          label: val,
          value: val,
          entity_type: "device_work_order",
          entity_id: wo.id,
        });
      }
    }

    for (const io of internalOrders.rows) {
      if (!io.module_key || String(io.module_key).toUpperCase() === modKey) {
        const val = `Phục vụ Đơn hàng nội bộ [${io.code}] (PO: ${io.kd_po_code})`;
        reasons.push({
          id: `io-${io.id}`,
          category: "📌 Đơn hàng nội bộ liên quan",
          label: val,
          value: val,
          entity_type: "internal_order",
          entity_id: io.id,
        });
      }
    }

    const stdList = [...(STANDARD_REASONS_BY_MODULE[modKey] || []), ...STANDARD_REASONS_BY_MODULE.DEFAULT];
    stdList.forEach((std, idx) => {
      reasons.push({
        id: `std-${modKey}-${idx}`,
        category: std.category,
        label: std.label,
        value: std.value,
      });
    });

    out.push({ ...u, module_key: modKey, warehouses, reasons });
  }
  return out;
});
