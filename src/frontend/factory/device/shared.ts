"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export interface DeviceOptions {
  units: { id: string; code: string; name: string; unit_type: string }[];
  warehouses: { id: string; code: string; name: string; owner_org_unit_id: string }[];
  items: { id: string; code: string; name: string; item_type: string; base_uom: string; tracking: string }[];
  vendors: { id: string; code: string; name: string }[];
  serial_units: {
    id: string;
    serial_no: string;
    status: string;
    customer_name: string | null;
    warranty_end: string | null;
    model_code: string;
    model_name: string;
    org_unit_id: string;
  }[];
}

export function useDeviceOptions() {
  return useQuery({
    queryKey: ["factory", "device", "options"],
    queryFn: () => api<DeviceOptions>("/api/factory/device/options"),
  });
}

export const STATION_LABELS: Record<string, string> = {
  STATION_1_MECH: "Trạm 1: Cơ khí & Khung vỏ",
  STATION_2_PCB: "Trạm 2: Điện & Bo mạch điều khiển",
  STATION_3_FW: "Trạm 3: Module Quang/Nhiệt & Nạp Firmware",
  STATION_4_FQC: "Trạm 4: Chạy lão hóa (Burn-in) & FQC",
  FIELD_SERVICE: "Bảo hành / Dịch vụ hiện trường",
};

export const MODEL_CATEGORY_LABELS: Record<string, string> = {
  THERMAL_CYCLER: "Máy luân nhiệt / Real-time PCR",
  EXTRACTOR: "Máy tách chiết DNA/RNA tự động",
  CENTRIFUGE: "Máy ly tâm tốc độ cao",
  SPIN_COLUMN_SYSTEM: "Hệ thống cột lọc / phụ kiện",
  INCUBATOR: "Tủ ủ nhiệt / Dry bath",
  SPECTROPHOTOMETER: "Máy quang phổ đo nồng độ",
  OTHER: "Thiết bị phòng lab khác",
};

export const MODEL_STATUS: Record<string, [string, string]> = {
  DEVELOPMENT: ["PENDING_QC", "Đang phát triển"],
  COMMERCIAL: ["RELEASED", "Thương mại hóa"],
  DISCONTINUED: ["EXPIRED", "Ngừng sản xuất"],
};

export const REVISION_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Bản nháp DMR"],
  RELEASED: ["RELEASED", "Đang hiệu lực (RELEASED)"],
  OBSOLETE: ["EXPIRED", "Hết hiệu lực (OBSOLETE)"],
};

export const ECO_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Nháp"],
  IMPACT_ASSESSMENT: ["QUARANTINE", "Đang đánh giá ảnh hưởng"],
  PENDING_APPROVAL: ["QUARANTINE", "Chờ hội đồng duyệt"],
  APPROVED: ["RELEASED", "Đã duyệt (Chờ ban hành)"],
  REJECTED: ["REJECTED", "Từ chối"],
  IMPLEMENTED: ["RELEASED", "Đã ban hành hiệu lực"],
  CLOSED: ["EXPIRED", "Đã xác minh & đóng"],
};

export const ORDER_STATUS: Record<string, [string, string]> = {
  RECEIVED: ["PENDING_QC", "Mới tiếp nhận"],
  APPROVED: ["QUARANTINE", "Đã duyệt lệnh"],
  IN_PRODUCTION: ["QUARANTINE", "Đang lắp ráp"],
  QC_TESTING: ["QUARANTINE", "Đang kiểm tra FQC"],
  READY: ["RELEASED", "Sẵn sàng bàn giao"],
  DELIVERED: ["RELEASED", "Đã bàn giao"],
  CANCELLED: ["REJECTED", "Đã hủy"],
};

export const UNIT_STATUS: Record<string, [string, string]> = {
  IN_ASSEMBLY: ["PENDING_QC", "Đang lắp ráp (Trạm 1–3)"],
  BURN_IN: ["QUARANTINE", "Đang chạy lão hóa (Burn-in)"],
  FQC: ["QUARANTINE", "Đang kiểm tra xuất xưởng (FQC)"],
  QA_PASSED: ["RELEASED", "QA đã giải phóng xuất xưởng"],
  DELIVERED: ["RELEASED", "Đã giao khách hàng"],
  IN_SERVICE_FIELD: ["RELEASED", "Đang vận hành tại khách hàng"],
  UNDER_SERVICE: ["ON_HOLD", "Đang bảo hành / sửa chữa"],
  DECOMMISSIONED: ["EXPIRED", "Ngừng lưu hành"],
};

export const SUBCONTRACT_STATUS: Record<string, [string, string]> = {
  DRAFT: ["PENDING_QC", "Nháp"],
  ISSUED: ["QUARANTINE", "Đã gửi nhà cung cấp"],
  PARTIALLY_RECEIVED: ["QUARANTINE", "Nhận một phần"],
  RECEIVED: ["RELEASED", "Đã nhận đủ"],
  CLOSED: ["EXPIRED", "Đã đóng đơn"],
  CANCELLED: ["REJECTED", "Đã hủy"],
};

export const TICKET_STATUS: Record<string, [string, string]> = {
  OPEN: ["PENDING_QC", "Mới tiếp nhận"],
  DIAGNOSING: ["QUARANTINE", "Đang chẩn đoán lỗi"],
  AWAITING_PARTS: ["ON_HOLD", "Chờ linh kiện thay thế"],
  IN_REPAIR: ["QUARANTINE", "Đang sửa chữa / bảo trì"],
  RESOLVED: ["RELEASED", "Đã khắc phục (Chờ đóng)"],
  CLOSED: ["EXPIRED", "Đã đóng phiếu"],
  CANCELLED: ["REJECTED", "Đã hủy"],
};
