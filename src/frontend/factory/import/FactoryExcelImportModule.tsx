"use client";

import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { api, fmtDate } from "../api";
import { Button, Card, Empty, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";

export interface TemplateFieldSpec {
  key: string;
  label: string;
  required?: boolean;
  example: string;
  description: string;
}

export interface ExcelTemplateDef {
  key: string;
  badge: string;
  title: string;
  subtitle: string;
  depts: string[];
  defaultDept: string;
  defaultWarehouse?: string;
  fields: TemplateFieldSpec[];
  sampleRows: Record<string, string | number>[];
}

export const EXCEL_TEMPLATES: ExcelTemplateDef[] = [
  {
    key: "INVENTORY_STOCK",
    badge: "Kho & Tồn kho Lô FEFO",
    title: "1. Nhập Danh mục Vật tư, Hóa chất & Tồn kho Lô (FEFO)",
    subtitle: "Dùng cho Kho Tổng Nhà máy và tất cả Kho nhánh (Kho R&D, Kho Kit, Kho Oligo, Kho Thiết bị, Kho QA/QC)",
    depts: ["ALL", "KHO", "P-RD", "P-KIT", "P-OLIGO", "P-DEVICE", "P-QA"],
    defaultDept: "P-KIT",
    defaultWarehouse: "KHO-KIT",
    fields: [
      { key: "item_code", label: "Mã vật tư", required: true, example: "ENZ-TAQ-5U", description: "Mã định danh duy nhất của vật tư / hóa chất / bán thành phẩm" },
      { key: "item_name", label: "Tên vật tư", required: true, example: "HotStart Taq DNA Polymerase (5 U/µL)", description: "Tên đầy đủ của hóa chất, vật tư tiêu hao hoặc linh kiện" },
      { key: "item_type", label: "Phân loại", required: true, example: "REAGENT", description: "RAW_MATERIAL | REAGENT | CONSUMABLE | COMPONENT | SEMI_FINISHED | FINISHED_KIT | DEVICE" },
      { key: "base_uom", label: "Đơn vị", required: true, example: "mL", description: "Đơn vị tính gốc (mL, uL, g, kg, pcs, box, kit, set)" },
      { key: "storage_condition", label: "Bảo quản", example: "-20", description: "Điều kiện nhiệt độ bảo quản: RT | 2-8 | -20 | -80" },
      { key: "warehouse_code", label: "Mã kho", example: "KHO-KIT", description: "Mã kho nhập tồn (KHO-TONG, KHO-RD, KHO-KIT, KHO-OLIGO, KHO-QA...)" },
      { key: "lot_code", label: "Số lô", example: "LOT-TAQ-2611A", description: "Mã lô nội bộ hoặc số lô kiểm soát FEFO" },
      { key: "mfr_lot_no", label: "Lô NSX", example: "MFR-99281", description: "Số lô gốc của nhà sản xuất trên nhãn COA" },
      { key: "qty_on_hand", label: "Số lượng tồn", example: "250", description: "Số lượng nhập tồn thực tế theo đơn vị gốc" },
      { key: "mfg_date", label: "Ngày SX", example: "2026-06-01", description: "Ngày sản xuất định dạng YYYY-MM-DD hoặc DD/MM/YYYY" },
      { key: "expiry_date", label: "Hạn dùng", example: "2027-12-31", description: "Hạn sử dụng định dạng YYYY-MM-DD hoặc DD/MM/YYYY" },
      { key: "min_stock", label: "Tồn tối thiểu", example: "50", description: "Mức tồn kho tối thiểu cảnh báo đặt hàng (ROP)" },
      { key: "notes", label: "Ghi chú", example: "Hóa chất chuẩn IVD nhập khẩu", description: "Ghi chú nhà cung cấp, vị trí kệ/tủ đông" },
    ],
    sampleRows: [
      {
        item_code: "ENZ-TAQ-5U",
        item_name: "HotStart Taq DNA Polymerase 5 U/µL (Chuẩn IVD)",
        item_type: "REAGENT",
        base_uom: "mL",
        storage_condition: "-20",
        warehouse_code: "KHO-KIT",
        lot_code: "LOT-TAQ-2611A",
        mfr_lot_no: "TF-2026-881",
        qty_on_hand: 120,
        mfg_date: "2026-05-15",
        expiry_date: "2027-11-15",
        min_stock: 20,
        notes: "Tủ âm -20°C Kho Kit · Ngăn A1",
      },
      {
        item_code: "BUF-PCR-10X",
        item_name: "Đệm phản ứng qPCR Reaction Buffer 10X (Tris-HCl pH 8.3)",
        item_type: "REAGENT",
        base_uom: "mL",
        storage_condition: "-20",
        warehouse_code: "KHO-RD",
        lot_code: "LOT-BUF-2611B",
        mfr_lot_no: "ABT-B2611",
        qty_on_hand: 500,
        mfg_date: "2026-08-01",
        expiry_date: "2028-02-01",
        min_stock: 100,
        notes: "Dùng chung cho R&D và Sản xuất Kit",
      },
      {
        item_code: "AMD-CE-DA",
        item_name: "dA-CE Phosphoramidite 100g (Nguyên liệu tổng hợp Oligo)",
        item_type: "RAW_MATERIAL",
        base_uom: "g",
        storage_condition: "2-8",
        warehouse_code: "KHO-OLIGO",
        lot_code: "LOT-AMD-A26",
        mfr_lot_no: "GLEN-7721",
        qty_on_hand: 300,
        mfg_date: "2026-07-10",
        expiry_date: "2027-07-10",
        min_stock: 50,
        notes: "Bảo quản khan dưới khí Argon",
      },
    ],
  },
  {
    key: "LAB_EQUIPMENT",
    badge: "Thiết bị & Hiệu chuẩn",
    title: "2. Nhập Danh mục Thiết bị Phòng Lab, Máy Sản xuất & Lịch Hiệu chuẩn",
    subtitle: "Quản lý máy PCR, máy tổng hợp Oligo, hệ thống HPLC, cân phân tích, tủ âm sâu cho mọi phòng ban",
    depts: ["ALL", "P-RD", "P-KIT", "P-OLIGO", "P-DEVICE", "P-QA"],
    defaultDept: "P-RD",
    fields: [
      { key: "asset_code", label: "Mã thiết bị", required: true, example: "TB-RD-PCR02", description: "Mã quản lý tài sản / thiết bị phòng Lab" },
      { key: "asset_name", label: "Tên thiết bị", required: true, example: "Máy Real-time PCR Rotor-Gene Q 5plex HRM", description: "Tên đầy đủ của máy móc / thiết bị" },
      { key: "asset_type", label: "Loại thiết bị", required: true, example: "PCR", description: "PCR | HPLC | SYNTHESIZER | CENTRIFUGE | FREEZER | BALANCE | SPECTROPHOTOMETER | MASS_SPEC | OTHER" },
      { key: "dept_code", label: "Mã phòng", required: true, example: "P-RD", description: "Phòng quản lý: P-RD | P-KIT | P-OLIGO | P-DEVICE | P-QA" },
      { key: "manufacturer", label: "Hãng sản xuất", example: "QIAGEN", description: "Tên hãng chế tạo (Bio-Rad, Thermo, Waters, ABI, QIAGEN...)" },
      { key: "model", label: "Model", example: "Rotor-Gene Q", description: "Ký hiệu đời máy / Model" },
      { key: "serial_no", label: "Số Serial", example: "RGQ-2026-0512", description: "Số Serial máy phục vụ hồ sơ hiệu chuẩn ISO 13485" },
      { key: "calibration_interval_days", label: "Chu kỳ hiệu chuẩn (ngày)", example: "365", description: "Số ngày định kỳ phải hiệu chuẩn lại (90, 180, 365)" },
      { key: "next_calibration_due", label: "Hạn hiệu chuẩn", example: "2027-06-30", description: "Ngày đến hạn hiệu chuẩn tiếp theo (YYYY-MM-DD)" },
      { key: "status", label: "Trạng thái", example: "IN_SERVICE", description: "IN_SERVICE (Đang hoạt động) | UNDER_MAINTENANCE | OUT_OF_CALIBRATION" },
    ],
    sampleRows: [
      {
        asset_code: "TB-RD-PCR02",
        asset_name: "Hệ thống Real-time PCR QIAGEN Rotor-Gene Q 5plex",
        asset_type: "PCR",
        dept_code: "P-RD",
        manufacturer: "QIAGEN (Đức)",
        model: "Rotor-Gene Q 5plex HRM",
        serial_no: "RGQ-261098",
        calibration_interval_days: 365,
        next_calibration_due: "2027-08-15",
        status: "IN_SERVICE",
      },
      {
        asset_code: "TB-OLIGO-HPLC02",
        asset_name: "Hệ thống Sắc ký lỏng hiệu năng cao Waters Alliance e2695",
        asset_type: "HPLC",
        dept_code: "P-OLIGO",
        manufacturer: "Waters Corporation",
        model: "Alliance e2695 Separations Module",
        serial_no: "WT-E2695-4410",
        calibration_interval_days: 180,
        next_calibration_due: "2027-04-20",
        status: "IN_SERVICE",
      },
      {
        asset_code: "TB-KIT-LYO01",
        asset_name: "Hệ thống Đông khô Chân không Tự động VirTis AdVantage Pro",
        asset_type: "OTHER",
        dept_code: "P-KIT",
        manufacturer: "SP Scientific",
        model: "AdVantage Pro 85",
        serial_no: "SP-LYO-9012",
        calibration_interval_days: 180,
        next_calibration_due: "2027-05-10",
        status: "IN_SERVICE",
      },
    ],
  },
  {
    key: "KIT_BOM_FORMULA",
    badge: "Định mức BOM Kit & BTP",
    title: "3. Nhập Công thức Định mức BOM Kit (Thành phẩm & Bán thành phẩm)",
    subtitle: "Nhập hàng loạt công thức BOM sản xuất Kit IVD, Bán thành phẩm MasterMix, thông tin TCCS và người phụ trách",
    depts: ["ALL", "P-KIT", "P-RD"],
    defaultDept: "P-KIT",
    fields: [
      { key: "bom_code", label: "Mã BOM", required: true, example: "BOM-DEN-50T-V1", description: "Mã định mức BOM (Các dòng cùng Mã BOM sẽ gộp vào 1 bộ BOM)" },
      { key: "bom_name", label: "Tên công thức BOM", required: true, example: "Định mức TopSENSI Dengue 1-4 Multiplex qPCR Kit (50 test)", description: "Tên phiên bản định mức BOM" },
      { key: "bom_type", label: "Loại BOM", required: true, example: "FINISHED_KIT", description: "FINISHED_KIT (Thành phẩm) | SEMI_FINISHED (Bán thành phẩm)" },
      { key: "product_code", label: "Mã sản phẩm", required: true, example: "KIT-DEN-50T", description: "Mã thành phẩm Kit hoặc Bán thành phẩm đầu ra" },
      { key: "product_name", label: "Tên sản phẩm", required: true, example: "TopSENSI Dengue 1-4 Multiplex qPCR Kit", description: "Tên sản phẩm đích" },
      { key: "tests_per_kit", label: "Số test/bộ", example: "50", description: "Quy cách số phản ứng / bộ Kit (VD: 50, 100)" },
      { key: "tccs_code", label: "Mã TCCS", example: "TCCS 18:2026/ABT", description: "Số hiệu Tiêu chuẩn cơ sở phục vụ in nhãn & COA" },
      { key: "responsible_person", label: "Người phụ trách", example: "ThS. Phạm Thị Thu Hà", description: "Chuyên viên phụ trách kỹ thuật / tự động giao lệnh SX" },
      { key: "component_code", label: "Mã NVL thành phần", required: true, example: "BTP-MMX-DEN", description: "Mã bán thành phẩm / nguyên liệu thành phần trong BOM" },
      { key: "component_name", label: "Tên NVL thành phần", required: true, example: "Bán thành phẩm Dengue Multiplex MasterMix 2X", description: "Tên thành phần" },
      { key: "stage_name", label: "Vai trò / Công đoạn", example: "1. Pha chế & Chia lẻ", description: "Công đoạn sử dụng thành phần này" },
      { key: "qty_per_base", label: "Định mức/bộ", required: true, example: "0.75", description: "Số lượng thành phần tiêu hao cho 1 bộ sản phẩm" },
      { key: "uom", label: "Đơn vị", required: true, example: "mL", description: "Đơn vị tính của thành phần (mL, uL, pcs, box)" },
      { key: "fill_volume_ul", label: "Thể tích nạp (µL)", example: "750", description: "Thể tích chiết rót vào mỗi ống con (µL)" },
      { key: "scrap_pct", label: "Hao hụt (%)", example: "3", description: "Tỷ lệ hao hụt định mức (%)" },
    ],
    sampleRows: [
      {
        bom_code: "BOM-DEN-50T-V1",
        bom_name: "Định mức chuẩn TopSENSI Dengue 1-4 Multiplex qPCR Kit (50 test)",
        bom_type: "FINISHED_KIT",
        product_code: "KIT-DEN-50T",
        product_name: "TopSENSI Dengue 1-4 Multiplex qPCR Kit (50 test)",
        tests_per_kit: 50,
        tccs_code: "TCCS 18:2026/ABT",
        responsible_person: "ThS. Phạm Thị Thu Hà (Tổ trưởng Pha chế Kit)",
        component_code: "BTP-MMX-DEN",
        component_name: "Ống 1: Dengue Multiplex qPCR MasterMix 2X",
        stage_name: "1. Chia lẻ Aliquot bán thành phẩm",
        qty_per_base: 0.75,
        uom: "mL",
        fill_volume_ul: 750,
        scrap_pct: 3,
      },
      {
        bom_code: "BOM-DEN-50T-V1",
        bom_name: "Định mức chuẩn TopSENSI Dengue 1-4 Multiplex qPCR Kit (50 test)",
        bom_type: "FINISHED_KIT",
        product_code: "KIT-DEN-50T",
        product_name: "TopSENSI Dengue 1-4 Multiplex qPCR Kit (50 test)",
        tests_per_kit: 50,
        tccs_code: "TCCS 18:2026/ABT",
        responsible_person: "ThS. Phạm Thị Thu Hà (Tổ trưởng Pha chế Kit)",
        component_code: "BTP-PC-DEN",
        component_name: "Ống 2: Chứng dương Dengue 1-4 Positive Control",
        stage_name: "1. Chia lẻ Aliquot bán thành phẩm",
        qty_per_base: 0.1,
        uom: "mL",
        fill_volume_ul: 100,
        scrap_pct: 2,
      },
      {
        bom_code: "BOM-DEN-50T-V1",
        bom_name: "Định mức chuẩn TopSENSI Dengue 1-4 Multiplex qPCR Kit (50 test)",
        bom_type: "FINISHED_KIT",
        product_code: "KIT-DEN-50T",
        product_name: "TopSENSI Dengue 1-4 Multiplex qPCR Kit (50 test)",
        tests_per_kit: 50,
        tccs_code: "TCCS 18:2026/ABT",
        responsible_person: "ThS. Phạm Thị Thu Hà (Tổ trưởng Pha chế Kit)",
        component_code: "PKG-BOX-50T",
        component_name: "Hộp giấy in màu TopSENSI Kit 50 test + Khay xốp",
        stage_name: "2. Đóng gói & Dán nhãn UDI",
        qty_per_base: 1,
        uom: "pcs",
        fill_volume_ul: 0,
        scrap_pct: 1,
      },
    ],
  },
  {
    key: "PREP_OLIGO_FORMULA",
    badge: "Công thức Pha chế Hóa chất",
    title: "4. Nhập Công thức Pha chế Hóa chất, Đệm Buffer & Dung dịch Oligo",
    subtitle: "Dùng cho Pha chế dung dịch Amidite/Reagent Oligo, Đệm tách chiết từ tính, Đệm TE/PBS và MasterMix gốc",
    depts: ["ALL", "P-OLIGO", "P-KIT", "P-RD"],
    defaultDept: "P-OLIGO",
    fields: [
      { key: "formula_code", label: "Mã công thức", required: true, example: "PREP-TEAA-01M", description: "Mã công thức pha chế (Các dòng cùng mã sẽ gộp thành 1 công thức)" },
      { key: "formula_name", label: "Tên công thức pha chế", required: true, example: "Pha đệm chạy sắc ký HPLC 0.1M TEAA pH 7.0 (Mẻ 10 Lít)", description: "Tên đầy đủ của công thức pha chế" },
      { key: "category", label: "Nhóm pha chế", example: "Pha động HPLC Oligo", description: "Phân nhóm công thức (Pha động HPLC, Hoạt hóa Amidite, Đệm tách chiết...)" },
      { key: "output_item_code", label: "Mã hóa chất đích", required: true, example: "SOL-TEAA-01M", description: "Mã bán thành phẩm / dung dịch thu được sau pha chế" },
      { key: "output_item_name", label: "Tên hóa chất đích", required: true, example: "Dung dịch đệm 0.1M TEAA pH 7.0 (Pha động A HPLC)", description: "Tên hóa chất thành phẩm thu được" },
      { key: "basis_qty", label: "Mẻ chuẩn", required: true, example: "10000", description: "Quy mô mẻ pha chế chuẩn (VD: 1000 mL, 10000 mL)" },
      { key: "basis_uom", label: "Đơn vị mẻ", required: true, example: "mL", description: "Đơn vị của mẻ chuẩn (mL, L, g)" },
      { key: "shelf_life_days", label: "Hạn dùng (ngày)", example: "90", description: "Hạn sử dụng của dung dịch sau khi pha (ngày)" },
      { key: "ingredient_code", label: "Mã nguyên liệu", required: true, example: "CHEM-TEA-PURE", description: "Mã hóa chất nguyên liệu đầu vào" },
      { key: "ingredient_name", label: "Tên nguyên liệu", required: true, example: "Triethylamine (TEA) tinh khiết sắc ký ≥ 99.5%", description: "Tên hóa chất nguyên liệu" },
      { key: "ingredient_qty", label: "Lượng dùng", required: true, example: "139.5", description: "Lượng nguyên liệu cần lấy cho 1 mẻ chuẩn" },
      { key: "ingredient_uom", label: "Đơn vị NL", required: true, example: "mL", description: "Đơn vị tính của nguyên liệu" },
      { key: "instructions", label: "Hướng dẫn pha chế SOP", example: "Hòa TEA vào 8L nước siêu sạch, chỉnh pH = 7.0 bằng Acid Acetic băng, lọc màng 0.22 µm.", description: "Quy trình các bước pha chế & kiểm tra pH/độ dẫn" },
    ],
    sampleRows: [
      {
        formula_code: "PREP-TEAA-01M",
        formula_name: "Công thức pha đệm sắc ký HPLC 0.1M TEAA pH 7.0 (Mẻ 10.000 mL)",
        category: "Pha động HPLC Oligo",
        output_item_code: "SOL-TEAA-01M",
        output_item_name: "Dung dịch đệm 0.1M TEAA pH 7.0 (Đã lọc 0.22 µm)",
        basis_qty: 10000,
        basis_uom: "mL",
        shelf_life_days: 60,
        ingredient_code: "CHEM-TEA-HPLC",
        ingredient_name: "Triethylamine (TEA) HPLC Grade",
        ingredient_qty: 139.5,
        ingredient_uom: "mL",
        instructions: "1. Đong 8.500 mL nước khử ion Ultrapure.\n2. Thêm từ từ 139.5 mL Triethylamine và 57.2 mL Acid Acetic băng.\n3. Chuẩn độ pH đạt 7.00 ± 0.05, định mức đủ 10.000 mL, lọc chân không qua màng 0.22 µm và đuổi khí siêu âm 15 phút.",
      },
      {
        formula_code: "PREP-TEAA-01M",
        formula_name: "Công thức pha đệm sắc ký HPLC 0.1M TEAA pH 7.0 (Mẻ 10.000 mL)",
        category: "Pha động HPLC Oligo",
        output_item_code: "SOL-TEAA-01M",
        output_item_name: "Dung dịch đệm 0.1M TEAA pH 7.0 (Đã lọc 0.22 µm)",
        basis_qty: 10000,
        basis_uom: "mL",
        shelf_life_days: 60,
        ingredient_code: "CHEM-ACOH-GLAC",
        ingredient_name: "Acid Acetic băng (Glacial Acetic Acid ≥ 99.8%)",
        ingredient_qty: 57.2,
        ingredient_uom: "mL",
        instructions: "Chỉnh pH về đúng 7.00 ± 0.05 ở 25°C.",
      },
    ],
  },
  {
    key: "DEVICE_MODEL_BOM",
    badge: "Thiết bị & Cây BOM Cơ-Điện",
    title: "5. Nhập Danh mục Thiết bị Thương mại & Cây Định mức Linh kiện (mBOM)",
    subtitle: "Dành cho Phòng Kỹ thuật – Thiết bị: Nhập Model máy thương mại, phiên bản thiết kế (DMR) và danh mục linh kiện lắp ráp",
    depts: ["ALL", "P-DEVICE", "P-RD"],
    defaultDept: "P-DEVICE",
    fields: [
      { key: "model_code", label: "Mã Model Thiết bị", required: true, example: "EZ-32-PRO", description: "Mã Model thiết bị thương mại (Các dòng cùng mã sẽ gộp linh kiện vào cùng 1 máy)" },
      { key: "model_name", label: "Tên thiết bị thương mại", required: true, example: "Máy tách chiết DNA/RNA tự động 32 mẫu ABT EZ-32 Pro", description: "Tên thương mại của thiết bị" },
      { key: "category", label: "Nhóm thiết bị", example: "EXTRACTOR", description: "THERMAL_CYCLER | EXTRACTOR | CENTRIFUGE | SPIN_COLUMN_SYSTEM | INCUBATOR | OTHER" },
      { key: "warranty_months", label: "Bảo hành (tháng)", example: "24", description: "Thời hạn bảo hành tiêu chuẩn (tháng)" },
      { key: "price", label: "Giá niêm yết (VNĐ)", example: "165000000", description: "Đơn giá thương mại niêm yết (VNĐ)" },
      { key: "part_code", label: "Mã linh kiện", required: true, example: "LK-STEP-NEMA17", description: "Mã linh kiện cơ khí / bo mạch PCB / quang học trong cây mBOM" },
      { key: "part_name", label: "Tên linh kiện", required: true, example: "Động cơ bước tuyến tính trục Z NEMA17 + Trục vít me bi", description: "Tên chi tiết của linh kiện lắp ráp" },
      { key: "qty_per_device", label: "Định mức/máy", required: true, example: "2", description: "Số lượng linh kiện cần cho 1 máy hoàn chỉnh" },
      { key: "uom", label: "Đơn vị", example: "pcs", description: "Đơn vị tính (pcs, set, m)" },
      { key: "station_code", label: "Trạm lắp ráp", example: "STATION_1_MECH", description: "STATION_1_MECH (Cơ khí) | STATION_2_PCB (Điện tử) | STATION_3_FW (Firmware) | STATION_4_FQC (Burn-in/FQC)" },
      { key: "notes", label: "Ghi chú", example: "Cần căn chỉnh đồng trục ±0.05mm", description: "Ghi chú kỹ thuật lắp ráp hoặc nhà cung cấp gia công" },
    ],
    sampleRows: [
      {
        model_code: "EZ-32-PRO",
        model_name: "Máy tách chiết Acid Nucleic tự động 32 giếng ABT EZ-32 Pro",
        category: "EXTRACTOR",
        warranty_months: 24,
        price: 165000000,
        part_code: "LK-FRAME-EZ32",
        part_name: "Khung vỏ hợp kim nhôm CNC Anodized + Cửa chắn UV",
        qty_per_device: 1,
        uom: "set",
        station_code: "STATION_1_MECH",
        notes: "Gia công CNC đạt dung sai ±0.05mm",
      },
      {
        model_code: "EZ-32-PRO",
        model_name: "Máy tách chiết Acid Nucleic tự động 32 giếng ABT EZ-32 Pro",
        category: "EXTRACTOR",
        warranty_months: 24,
        price: 165000000,
        part_code: "LK-MAG-ROD32",
        part_name: "Cụm 32 thanh từ vĩnh cửu Neodymium N52 mạ Niken",
        qty_per_device: 1,
        uom: "set",
        station_code: "STATION_1_MECH",
        notes: "Cường độ từ trường ≥ 4500 Gauss",
      },
      {
        model_code: "EZ-32-PRO",
        model_name: "Máy tách chiết Acid Nucleic tự động 32 giếng ABT EZ-32 Pro",
        category: "EXTRACTOR",
        warranty_months: 24,
        price: 165000000,
        part_code: "LK-PCB-MAIN32",
        part_name: "Bo mạch điều khiển chính ARM Cortex-M7 + Màn hình cảm ứng 7 inch",
        qty_per_device: 1,
        uom: "pcs",
        station_code: "STATION_2_PCB",
        notes: "Nạp sẵn Firmware điều khiển nhiệt & trục từ",
      },
    ],
  },
  {
    key: "ROUTING_SOP",
    badge: "Quy trình Công đoạn & SOP",
    title: "6. Nhập Quy trình Công đoạn Sản xuất (Routing) & Hướng dẫn Thao tác SOP",
    subtitle: "Thiết lập các bước công đoạn sản xuất chuẩn, thời gian định mức và điểm kiểm soát IPQC xen kẽ",
    depts: ["ALL", "P-KIT", "P-OLIGO", "P-DEVICE"],
    defaultDept: "P-KIT",
    fields: [
      { key: "routing_code", label: "Mã quy trình", required: true, example: "RT-KIT-DEN-V1", description: "Mã quy trình công đoạn (Các dòng cùng mã sẽ gộp thành các bước của 1 quy trình)" },
      { key: "routing_name", label: "Tên quy trình / SOP", required: true, example: "Quy trình sản xuất chuẩn Kit Real-time PCR Dengue 1-4 (4 công đoạn)", description: "Tên quy trình sản xuất" },
      { key: "product_code", label: "Mã sản phẩm", required: true, example: "KIT-DEN-50T", description: "Mã sản phẩm áp dụng quy trình này" },
      { key: "product_name", label: "Tên sản phẩm", example: "TopSENSI Dengue 1-4 Multiplex qPCR Kit", description: "Tên sản phẩm" },
      { key: "step_no", label: "Thứ tự bước", required: true, example: "10", description: "Số thứ tự bước công đoạn (10, 20, 30, 40...)" },
      { key: "step_code", label: "Mã công đoạn", required: true, example: "STEP-10-PREP", description: "Mã viết tắt của bước công đoạn" },
      { key: "step_name", label: "Tên công đoạn", required: true, example: "Dọn dây chuyền Line Clearance & Pha phối trộn MasterMix gốc", description: "Tên bước công đoạn sản xuất" },
      { key: "work_center", label: "Phòng / Khu vực", example: "Phòng Sạch Pha Chế Class 10.000", description: "Khu vực / buồng sạch thực hiện" },
      { key: "std_minutes", label: "Thời gian chuẩn (phút)", example: "45", description: "Thời gian định mức hoàn thành bước công đoạn (phút)" },
      { key: "ipqc_required", label: "Yêu cầu IPQC", example: "Y", description: "Y (Có dừng chờ QC kiểm tra xen kẽ) | N (Không)" },
      { key: "instructions", label: "Hướng dẫn thao tác SOP", required: true, example: "Chiếu UV 30 phút, kiểm tra chênh áp ≥ 15 Pa, rã đông hóa chất trên khay lạnh 2-8°C...", description: "Hướng dẫn chi tiết thao tác & thông số môi trường cần ghi trong Hồ sơ lô (EBR)" },
    ],
    sampleRows: [
      {
        routing_code: "RT-KIT-DEN-V1",
        routing_name: "Quy trình sản xuất chuẩn Kit qPCR Dengue 1-4 (ISO 13485)",
        product_code: "KIT-DEN-50T",
        product_name: "TopSENSI Dengue 1-4 Multiplex qPCR Kit",
        step_no: 10,
        step_code: "S10-MIX",
        step_name: "Line Clearance & Phối trộn bán thành phẩm MasterMix 2X",
        work_center: "Phòng Sạch MasterMix (Áp lực dương)",
        std_minutes: 45,
        ipqc_required: "Y",
        instructions: "1. Kiểm tra chênh áp phòng ≥ 15 Pa, nhiệt độ 18–22°C.\n2. Phối trộn Buffer, dNTPs, Enzyme HotStart Taq và Primer/Probe theo định mức BOM.\n3. Lấy 02 mẫu bán thành phẩm gửi QC chạy kiểm tra IPQC trước khi chia lẻ.",
      },
      {
        routing_code: "RT-KIT-DEN-V1",
        routing_name: "Quy trình sản xuất chuẩn Kit qPCR Dengue 1-4 (ISO 13485)",
        product_code: "KIT-DEN-50T",
        product_name: "TopSENSI Dengue 1-4 Multiplex qPCR Kit",
        step_no: 20,
        step_code: "S20-ALIQUOT",
        step_name: "Chiết rót chia lẻ tự động Aliquot vào ống 1.5mL & Dán nhãn ống",
        work_center: "Buồng Chia lẻ Tự động",
        std_minutes: 60,
        ipqc_required: "Y",
        instructions: "1. Cài đặt Robot chiết rót 750 µL/ống (sai số ±1.5%).\n2. Cân kiểm tra khối lượng ngẫu nhiên 10 ống đầu, giữa và cuối ca.\n3. Dán tem chịu lạnh -80°C lên thân ống.",
      },
      {
        routing_code: "RT-KIT-DEN-V1",
        routing_name: "Quy trình sản xuất chuẩn Kit qPCR Dengue 1-4 (ISO 13485)",
        product_code: "KIT-DEN-50T",
        product_name: "TopSENSI Dengue 1-4 Multiplex qPCR Kit",
        step_no: 30,
        step_code: "S30-PACK",
        step_name: "Đóng hộp thành phẩm, Kèm tờ HDSD (IFU) & Dán tem UDI xuất xưởng",
        work_center: "Khu vực Đóng gói Hoàn thiện",
        std_minutes: 40,
        ipqc_required: "Y",
        instructions: "1. Xếp đủ ống MasterMix, Chứng dương, Chứng âm, Nước Nuclease-free vào khay xốp.\n2. Đặt tờ HDSD đã phê duyệt và dán nhãn hộp ngoài có mã vạch UDI.",
      },
    ],
  },
  {
    key: "QC_METHOD_SPEC",
    badge: "Phương pháp & Tiêu chuẩn QC",
    title: "7. Nhập Phương pháp Kiểm nghiệm (QC Method) & Tiêu chuẩn Chất lượng",
    subtitle: "Dành cho Phòng QA/QC và các phòng kỹ thuật: Chuẩn hóa phương pháp thử nghiệm IQC, IPQC, FQC và tiêu chuẩn SST",
    depts: ["ALL", "P-QA", "P-KIT", "P-OLIGO", "P-DEVICE", "P-RD"],
    defaultDept: "P-QA",
    fields: [
      { key: "method_code", label: "Mã phương pháp QC", required: true, example: "QCM-QPCR-DEN01", description: "Mã phương pháp kiểm nghiệm chuẩn (SOP-QC)" },
      { key: "method_name", label: "Tên phương pháp / Tiêu chuẩn QC", required: true, example: "Phương pháp kiểm định hiệu năng xuất xưởng FQC Kit qPCR Dengue 1-4", description: "Tên phương pháp kiểm nghiệm" },
      { key: "category", label: "Nhóm phương pháp", required: true, example: "QPCR_ASSAY", description: "QPCR_ASSAY | HPLC_CHROMATOGRAPHY | PAGE_ELECTROPHORESIS | UV_VIS_OD | ELECTRICAL_SAFETY | PHYSICOCHEMICAL" },
      { key: "instrument_type", label: "Thiết bị đo", example: "Máy Real-time PCR QuantStudio 5 / CFX96", description: "Loại máy đo sử dụng trong phương pháp" },
      { key: "principle", label: "Nguyên lý & Quy trình", required: true, example: "Chạy đường chuẩn 3 nồng độ (10^4, 10^2, 10^1 copies/rxn) lặp lại 3 lần kèm NTC.", description: "Tóm tắt nguyên lý phân tích và các bước tiến hành" },
      { key: "suitability_criteria", label: "Tiêu chuẩn chấp nhận (SST)", required: true, example: "Chứng dương Ct = 26.0 ± 1.5; R² ≥ 0.990; NTC không có tín hiệu khuếch đại (No Ct).", description: "Điều kiện tương thích hệ thống & ngưỡng ĐẠT/KHÔNG ĐẠT" },
    ],
    sampleRows: [
      {
        method_code: "QCM-QPCR-DEN01",
        method_name: "Phương pháp kiểm định xuất xưởng (FQC) Kit Real-time PCR Dengue 1-4",
        category: "QPCR_ASSAY",
        instrument_type: "Hệ thống Real-time PCR Applied Biosystems QuantStudio 5",
        principle: "Khuếch đại đồng thời 4 huyết thanh Dengue trên dải chuẩn độ nhạy LoD (10 copies/rxn) và панель đặc hiệu chéo (Zika, Chikungunya, HBV).",
        suitability_criteria: "1. Chứng dương: 25.0 ≤ Ct ≤ 28.0 (CV% ≤ 3%).\n2. Mẫu LoD 10 copies/rxn: Dương tính 100% (3/3 giếng).\n3. Chứng âm NTC: Không có đường cong khuếch đại sau 45 chu kỳ.",
      },
      {
        method_code: "QCM-HPLC-OLI02",
        method_name: "Phương pháp xác định độ tinh khiết Probe Huỳnh quang bằng RP-HPLC",
        category: "HPLC_CHROMATOGRAPHY",
        instrument_type: "Hệ thống Waters Alliance HPLC + Cột XBridge BEH C18",
        principle: "Sắc ký pha đảo sử dụng hệ đệm Gradient 0.1M TEAA / Acetonitrile ở 60°C, đọc hấp thụ UV tại 260 nm và bước sóng màu nhuộm.",
        suitability_criteria: "Độ tinh khiết diện tích đỉnh chính (Main Peak Area %) ≥ 85.0% đối với Probe gắn FAM/HEX/Cy5.",
      },
    ],
  },
  {
    key: "RD_PROJECT_WBS",
    badge: "Dự án R&D & Công việc WBS",
    title: "8. Nhập Danh mục Dự án R&D, Phân công Công việc WBS & Kết quả Thực nghiệm",
    subtitle: "Dành cho Phòng Nghiên cứu R&D: Nhập nhanh lộ trình công việc WBS theo cổng Stage-Gate (G0–G4), giao nhân viên R&D và ghi nhận kết quả",
    depts: ["ALL", "P-RD"],
    defaultDept: "P-RD",
    fields: [
      { key: "project_code", label: "Mã dự án R&D", required: true, example: "PRJ26-003", description: "Mã dự án R&D (Nếu mã chưa có sẽ tự động khởi tạo dự án mới)" },
      { key: "project_name", label: "Tên dự án R&D", required: true, example: "Nghiên cứu phát triển Kit Real-time PCR đa mồi phát hiện virus cúm A/B & RSV", description: "Tên đề tài dự án R&D" },
      { key: "leader_name", label: "Chủ nhiệm đề tài", example: "TS. Nguyễn Minh Tuấn (Trưởng phòng R&D)", description: "Họ tên Chủ nhiệm đề tài R&D" },
      { key: "task_code", label: "Mã việc WBS", required: true, example: "PRJ26-003-WBS-06", description: "Mã hạng mục công việc WBS" },
      { key: "gate_no", label: "Cổng Gate", required: true, example: "2", description: "Số thứ tự cổng Stage-Gate: 0 (TPP) | 1 (Feasibility) | 2 (Optimization) | 3 (V&V) | 4 (Transfer)" },
      { key: "task_title", label: "Nội dung công việc WBS", required: true, example: "Khảo sát độ ổn định nhiệt tăng tốc ở 37°C trong 14 ngày của MasterMix", description: "Tên công việc / thực nghiệm cần thực hiện" },
      { key: "assignee_name", label: "Nghiên cứu viên phụ trách", required: true, example: "ThS. Lê Thị Mai Anh (Chuyên viên Đệm & Công thức)", description: "Nhân viên phòng R&D chịu trách nhiệm thực hiện" },
      { key: "due_date", label: "Hạn hoàn thành", example: "2026-12-15", description: "Hạn chót hoàn thành (YYYY-MM-DD)" },
      { key: "status", label: "Trạng thái", example: "DONE", description: "TODO (Chưa làm) | IN_PROGRESS (Đang làm) | DONE (Hoàn thành) | BLOCKED" },
      { key: "outcome_verdict", label: "Đánh giá kết luận", example: "PASS", description: "PASS (Đạt mục tiêu) | OPTIMIZE (Cần tối ưu) | FAIL (Không đạt) | PENDING" },
      { key: "protocol_summary", label: "Phương pháp thực nghiệm", example: "Ủ các lô MasterMix ở 37°C, lấy mẫu tại ngày 0, 3, 7, 14 chạy qPCR so sánh ΔCt.", description: "Tóm tắt quy trình thực nghiệm đã chạy" },
      { key: "result_summary", label: "Tóm tắt kết quả", example: "Độ lệch ΔCt sau 14 ngày ở 37°C chỉ 0.28 chu kỳ (≤ 0.5), tương đương hạn dùng 12 tháng ở -20°C.", description: "Kết quả thực nghiệm ghi nhận được" },
    ],
    sampleRows: [
      {
        project_code: "PRJ26-003",
        project_name: "Nghiên cứu phát triển Kit Real-time PCR đa mồi phát hiện virus cúm A/B & RSV",
        leader_name: "TS. Nguyễn Minh Tuấn (Trưởng phòng R&D)",
        task_code: "PRJ26-003-WBS-06",
        gate_no: 2,
        task_title: "Khảo sát chất bảo vệ lạnh (Cryoprotectant Trehalose 5%) chống suy giảm hoạt tính sau 5 chu kỳ rã đông",
        assignee_name: "ThS. Lê Thị Mai Anh (Chuyên viên Đệm & Công thức)",
        due_date: "2026-11-25",
        status: "DONE",
        outcome_verdict: "PASS",
        protocol_summary: "Thực hiện 5 chu kỳ đông đá (-20°C) và rã đông (25°C) trên 3 công thức chứa Trehalose 2%, 5%, 8%; đo Ct và RFU trên mẫu chuẩn 100 copies/rxn.",
        result_summary: "Công thức bổ sung Trehalose 5% giữ nguyên hiệu suất khuếch đại (ΔCt = 0.15 chu kỳ, RFU giảm < 3% sau 5 lần rã đông).",
      },
      {
        project_code: "PRJ26-003",
        project_name: "Nghiên cứu phát triển Kit Real-time PCR đa mồi phát hiện virus cúm A/B & RSV",
        leader_name: "TS. Nguyễn Minh Tuấn (Trưởng phòng R&D)",
        task_code: "PRJ26-003-WBS-07",
        gate_no: 3,
        task_title: "Đánh giá độ đặc hiệu chéo (Cross-reactivity) với 15 tác nhân đường hô hấp phổ biến",
        assignee_name: "CN. Võ Ngọc Hân (Nghiên cứu viên Thẩm định V&V)",
        due_date: "2026-12-05",
        status: "IN_PROGRESS",
        outcome_verdict: "PENDING",
        protocol_summary: "Chạy phản ứng với mẫu chuẩn SARS-CoV-2, Adenovirus, Rhinovirus, Mycoplasma pneumoniae ở nồng độ cao 10^6 copies/rxn.",
        result_summary: "Đã hoàn tất 10/15 tác nhân: 100% âm tính đặc hiệu trên kênh FAM/HEX/Cy5, không có phản ứng chéo.",
      },
    ],
  },
];

const DEPT_FILTER_TABS = [
  { code: "ALL", label: "🌐 Tất cả Phòng ban Kỹ thuật" },
  { code: "P-RD", label: "🔬 Nghiên cứu R&D" },
  { code: "P-KIT", label: "📦 Sản xuất Kit" },
  { code: "P-OLIGO", label: "🧬 Tổng hợp Oligo" },
  { code: "P-DEVICE", label: "⚙️ Kỹ thuật – Thiết bị" },
  { code: "P-QA", label: "🛡️ Đảm bảo & Kiểm soát Chất lượng (QA/QC)" },
  { code: "KHO", label: "🏭 Kho Nhà Máy & Cung ứng NVL" },
];

export default function FactoryExcelImportModule() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [deptFilter, setDeptFilter] = useState("ALL");
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("INVENTORY_STOCK");
  const [targetDeptCode, setTargetDeptCode] = useState("P-KIT");
  const [targetWarehouseCode, setTargetWarehouseCode] = useState("KHO-KIT");

  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<Record<string, any>[]>([]);
  const [importResult, setImportResult] = useState<{
    total_rows: number;
    created_count: number;
    updated_count: number;
    error_count: number;
    errors: { row_no: number; code?: string; message: string }[];
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["factory", "excel-import", "overview"],
    queryFn: () => api<any>("/api/factory/import"),
  });

  const activeTemplate =
    EXCEL_TEMPLATES.find((t) => t.key === selectedTemplateKey) ?? EXCEL_TEMPLATES[0];

  const visibleTemplates =
    deptFilter === "ALL"
      ? EXCEL_TEMPLATES
      : EXCEL_TEMPLATES.filter((t) => t.depts.includes(deptFilter));

  const selectTemplate = (tpl: ExcelTemplateDef) => {
    setSelectedTemplateKey(tpl.key);
    setTargetDeptCode(deptFilter !== "ALL" && deptFilter !== "KHO" ? deptFilter : tpl.defaultDept);
    if (tpl.defaultWarehouse) {
      setTargetWarehouseCode(tpl.defaultWarehouse);
    }
    setImportResult(null);
    setParseError(null);
    setUploadedFileName(`${tpl.key}_Mau_Demo.xlsx`);
    setPreviewRows(tpl.sampleRows.map((r) => ({ ...r })));
  };

  // Initialize sample rows on first load if empty
  React.useEffect(() => {
    if (previewRows.length === 0 && !uploadedFileName) {
      setPreviewRows(activeTemplate.sampleRows.map((r) => ({ ...r })));
      setUploadedFileName(`${activeTemplate.key}_Du_Lieu_Mau.xlsx`);
    }
  }, []);

  /** Generates and downloads a real multi-sheet .xlsx file with Vietnamese headers, sample rows, and column guide */
  const downloadExcelTemplate = (tpl: ExcelTemplateDef) => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Data Sheet with clear Vietnamese column headers
    const headerRow = tpl.fields.map((f) => (f.required ? `${f.label} *` : f.label));
    const keyRow = tpl.fields.map((f) => f.key);
    const dataMatrix: any[][] = [
      headerRow,
      keyRow,
      ...tpl.sampleRows.map((row) => tpl.fields.map((f) => row[f.key] ?? "")),
    ];

    const wsData = XLSX.utils.aoa_to_sheet(dataMatrix);
    wsData["!cols"] = tpl.fields.map((f) => ({
      wch: Math.max(f.label.length + 6, String(f.example).length + 5, 18),
    }));
    XLSX.utils.book_append_sheet(wb, wsData, "Du_Lieu_Nhap");

    // Sheet 2: Detailed Field Documentation & Instructions
    const guideMatrix: any[][] = [
      ["MÃ CỘT KỸ THUẬT", "TÊN CỘT TIẾNG VIỆT", "BẮT BUỘC", "GIÁ TRỊ MẪU", "HƯỚNG DẪN & QUY TẮC NHẬP LIỆU"],
      ...tpl.fields.map((f) => [
        f.key,
        f.label,
        f.required ? "Bắt buộc (*)" : "Tùy chọn",
        f.example,
        f.description,
      ]),
    ];
    const wsGuide = XLSX.utils.aoa_to_sheet(guideMatrix);
    wsGuide["!cols"] = [{ wch: 24 }, { wch: 28 }, { wch: 16 }, { wch: 32 }, { wch: 65 }];
    XLSX.utils.book_append_sheet(wb, wsGuide, "Huong_Dan_Cot");

    XLSX.writeFile(wb, `ABT_Bieu_Mau_${tpl.key}.xlsx`);
  };

  /** Parses an uploaded .xlsx / .xls / .csv file and maps headers (Vietnamese or English) to template field keys */
  const handleFileUpload = async (file: File) => {
    setParseError(null);
    setImportResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) {
        setParseError("File Excel không có trang tính (Sheet) nào.");
        return;
      }
      const ws = wb.Sheets[firstSheetName];
      const rawMatrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
      if (rawMatrix.length < 2) {
        setParseError("File Excel chưa có dòng dữ liệu nào.");
        return;
      }

      // Detect whether row 1 is the technical key row (from our 2-header template) or data row
      const row0 = (rawMatrix[0] || []).map((c) => String(c || "").trim());
      const row1 = (rawMatrix[1] || []).map((c) => String(c || "").trim());
      const fieldKeySet = new Set(activeTemplate.fields.map((f) => f.key.toLowerCase()));

      const row1MatchesKeys =
        row1.filter((cell) => fieldKeySet.has(cell.toLowerCase())).length >=
        Math.min(2, activeTemplate.fields.length);

      const headerRow = row1MatchesKeys ? row1 : row0;
      const startRowIdx = row1MatchesKeys ? 2 : 1;

      // Map each column index to a template field key
      const colToFieldKey: (string | null)[] = headerRow.map((hdr) => {
        const clean = hdr.replace(/\s*\*\s*$/, "").trim().toLowerCase();
        const found = activeTemplate.fields.find(
          (f) => f.key.toLowerCase() === clean || f.label.toLowerCase() === clean
        );
        return found ? found.key : hdr || null;
      });

      const parsedRows: Record<string, any>[] = [];
      for (let rIdx = startRowIdx; rIdx < rawMatrix.length; rIdx++) {
        const arr = rawMatrix[rIdx];
        if (!Array.isArray(arr)) continue;
        const hasAnyValue = arr.some((v) => String(v ?? "").trim() !== "");
        if (!hasAnyValue) continue;
        const obj: Record<string, any> = {};
        for (let cIdx = 0; cIdx < colToFieldKey.length; cIdx++) {
          const fk = colToFieldKey[cIdx];
          if (fk) {
            obj[fk] = arr[cIdx] ?? "";
          }
        }
        parsedRows.push(obj);
      }

      if (parsedRows.length === 0) {
        setParseError("Không tìm thấy dòng dữ liệu hợp lệ nào trong file đã chọn.");
        return;
      }

      setUploadedFileName(file.name);
      setPreviewRows(parsedRows);
    } catch (e: any) {
      setParseError(`Không thể đọc file Excel: ${e?.message || String(e)}`);
    }
  };

  const importMut = useMutation({
    mutationFn: () =>
      api<{
        total_rows: number;
        created_count: number;
        updated_count: number;
        error_count: number;
        errors: { row_no: number; code?: string; message: string }[];
      }>("/api/factory/import", {
        method: "POST",
        json: {
          template_key: activeTemplate.key,
          template_name: activeTemplate.title,
          target_dept_code: targetDeptCode,
          target_warehouse_code: targetWarehouseCode,
          file_name: uploadedFileName || `${activeTemplate.key}.xlsx`,
          rows: previewRows,
        },
      }),
    onSuccess: (res) => {
      setImportResult(res);
      qc.invalidateQueries({ queryKey: ["factory"] });
    },
  });

  const validateRow = (row: Record<string, any>): string[] => {
    const missing: string[] = [];
    for (const f of activeTemplate.fields) {
      if (f.required && String(row[f.key] ?? "").trim() === "") {
        missing.push(f.label);
      }
    }
    return missing;
  };

  const validRowCount = previewRows.filter((r) => validateRow(r).length === 0).length;
  const invalidRowCount = previewRows.length - validRowCount;
  const stats = overview.data?.stats;

  return (
    <div className="flex flex-col gap-3">
      {/* Top KPI Bar showing live database totals across Technical Division */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Vật tư & Hóa chất</div>
            <div className="text-sm font-extrabold text-sky-700 dark:text-sky-400">{stats.items_count} mã</div>
            <div className="text-[10px] text-slate-400">{stats.lots_count} lô FEFO</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Thiết bị Phòng Lab</div>
            <div className="text-sm font-extrabold text-indigo-700 dark:text-indigo-400">{stats.assets_count} máy</div>
            <div className="text-[10px] text-slate-400">Đang theo dõi HC</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Định mức BOM Kit</div>
            <div className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">{stats.kit_boms_count} BOM</div>
            <div className="text-[10px] text-slate-400">TP & Bán TP</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Công thức Pha chế</div>
            <div className="text-sm font-extrabold text-teal-700 dark:text-teal-400">{stats.prep_formulas_count} CT</div>
            <div className="text-[10px] text-slate-400">Đệm & Hóa chất Oligo</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Model Thiết bị</div>
            <div className="text-sm font-extrabold text-purple-700 dark:text-purple-400">{stats.device_models_count} model</div>
            <div className="text-[10px] text-slate-400">Kèm cây mBOM</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Quy trình Routing</div>
            <div className="text-sm font-extrabold text-amber-700 dark:text-amber-400">{stats.routings_count} SOP</div>
            <div className="text-[10px] text-slate-400">Công đoạn chuẩn</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Phương pháp QA/QC</div>
            <div className="text-sm font-extrabold text-rose-700 dark:text-rose-400">{stats.qc_methods_count} PP</div>
            <div className="text-[10px] text-slate-400">{stats.qc_specs_count} bộ Spec</div>
          </div>
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="text-[10px] text-slate-500">Dự án & WBS R&D</div>
            <div className="text-sm font-extrabold text-cyan-700 dark:text-cyan-400">{stats.rd_projects_count} dự án</div>
            <div className="text-[10px] text-slate-400">{stats.rd_tasks_count} việc WBS</div>
          </div>
        </div>
      )}

      {/* Step 1: Filter by Technical Department & Choose Standard Excel Template */}
      <Card
        title="Trung Tâm Nhập Dữ Liệu Excel Kéo-Thả & Thư Viện Biểu Mẫu Chuẩn Khối Kỹ Thuật (8 Biểu mẫu Toàn Nhà máy)"
        actions={
          <Button onClick={() => downloadExcelTemplate(activeTemplate)}>
            📥 Tải Biểu Mẫu Excel (.xlsx) Đang Chọn
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {/* Department Filter Bar */}
          <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-500 mr-1">🏢 Chọn Phòng Ban Khối Kỹ Thuật:</span>
            {DEPT_FILTER_TABS.map((d) => {
              const active = deptFilter === d.code;
              return (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => {
                    setDeptFilter(d.code);
                    if (d.code !== "ALL" && d.code !== "KHO") {
                      setTargetDeptCode(d.code);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                    active
                      ? "bg-sky-700 text-white shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>

          {/* Template Cards Grid */}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {visibleTemplates.map((tpl) => {
              const isSelected = tpl.key === activeTemplate.key;
              return (
                <div
                  key={tpl.key}
                  onClick={() => selectTemplate(tpl)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    isSelected
                      ? "border-2 border-sky-600 bg-sky-50/70 dark:bg-sky-950/40 shadow-sm"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-sky-400"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300 text-[10px] font-bold">
                        {tpl.badge}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">{tpl.fields.length} cột</span>
                    </div>
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{tpl.title}</div>
                    <div className="text-[11px] text-slate-500 mt-1 line-clamp-2">{tpl.subtitle}</div>
                  </div>
                  <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadExcelTemplate(tpl);
                      }}
                      className="text-[11px] font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      📥 Tải file mẫu .xlsx
                    </button>
                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                      {isSelected ? "✓ Đang chọn" : "Chọn mẫu →"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Step 2: Drag & Drop Upload Zone + Target Department/Warehouse Configuration */}
      <Card
        title={`Bước 2: Kéo-Thả File Excel hoặc Nhập Trực Tiếp — ${activeTemplate.title}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPreviewRows(activeTemplate.sampleRows.map((r) => ({ ...r })));
                setUploadedFileName(`${activeTemplate.key}_Du_Lieu_Mau.xlsx`);
                setImportResult(null);
              }}
            >
              ⚡ Nạp Dữ Liệu Mẫu Chuẩn Lên Bảng
            </Button>
            <Button variant="ghost" onClick={() => downloadExcelTemplate(activeTemplate)}>
              📥 Tải Biểu Mẫu (.xlsx) Có Kèm Hướng Dẫn
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 text-xs">
          <ErrorNote error={overview.error ?? importMut.error ?? (parseError ? new Error(parseError) : null)} />

          {importResult && (
            <div className="p-3.5 rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-extrabold text-emerald-900 dark:text-emerald-200">
                  ✅ Đã nhập dữ liệu Excel vào hệ thống thành công!
                </div>
                <div className="flex gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-bold">
                    +{importResult.created_count} bản ghi mới
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-sky-600 text-white font-bold">
                    ↻ {importResult.updated_count} bản ghi cập nhật
                  </span>
                  {importResult.error_count > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full bg-rose-600 text-white font-bold">
                      ⚠️ {importResult.error_count} dòng lỗi
                    </span>
                  )}
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="mt-1 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 text-[11px] space-y-0.5">
                  <b>Chi tiết dòng lỗi:</b>
                  {importResult.errors.map((err, i) => (
                    <div key={i}>
                      • Dòng {err.row_no} {err.code ? `(${err.code})` : ""}: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Target Dept / Warehouse selectors + Drag-and-Drop Zone */}
          <div className="grid gap-3 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-4 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 flex flex-col justify-between gap-2.5">
              <div className="space-y-2.5">
                <div className="font-bold text-slate-800 dark:text-slate-100">
                  🎯 Cấu hình Đích Nhập Dữ Liệu Mặc Định
                </div>
                <Field
                  label="Phòng ban quản lý mặc định (nếu trong file để trống)"
                  hint="Tự động gán thiết bị, BOM, quy trình hoặc vật tư về đúng phòng ban"
                >
                  <select className={inputClass} value={targetDeptCode} onChange={(e) => setTargetDeptCode(e.target.value)}>
                    {(overview.data?.departments ?? []).map((d: any) => (
                      <option key={d.code} value={d.code}>
                        {d.code} — {d.name}
                      </option>
                    ))}
                    {!(overview.data?.departments?.length) && (
                      <>
                        <option value="P-RD">P-RD — Phòng Nghiên cứu R&D</option>
                        <option value="P-KIT">P-KIT — Phòng Sản xuất Kit</option>
                        <option value="P-OLIGO">P-OLIGO — Phòng Tổng hợp Oligo</option>
                        <option value="P-DEVICE">P-DEVICE — Phòng Kỹ thuật – Thiết bị</option>
                        <option value="P-QA">P-QA — Phòng QA/QC</option>
                      </>
                    )}
                  </select>
                </Field>
                <Field
                  label="Kho nhập tồn mặc định (đối với biểu mẫu Kho & Vật tư)"
                  hint="Có thể ghi đè từng dòng bằng cột 'Mã kho' trong file Excel"
                >
                  <select className={inputClass} value={targetWarehouseCode} onChange={(e) => setTargetWarehouseCode(e.target.value)}>
                    {(overview.data?.warehouses ?? []).map((w: any) => (
                      <option key={w.code} value={w.code}>
                        {w.code} — {w.name}
                      </option>
                    ))}
                    {!(overview.data?.warehouses?.length) && (
                      <>
                        <option value="KHO-TONG">KHO-TONG — Kho Tổng Nhà Máy</option>
                        <option value="KHO-RD">KHO-RD — Kho Nhánh R&D</option>
                        <option value="KHO-KIT">KHO-KIT — Kho Nhánh Sản xuất Kit</option>
                        <option value="KHO-OLIGO">KHO-OLIGO — Kho Nhánh Oligo</option>
                        <option value="KHO-QA">KHO-QA — Kho Mẫu & Chuẩn QA/QC</option>
                      </>
                    )}
                  </select>
                </Field>
              </div>
              <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 text-[11px] text-slate-600 dark:text-slate-300">
                💡 <b>Mẹo:</b> Hệ thống hỗ trợ cơ chế <b>Upsert thông minh</b> — nếu mã vật tư, thiết bị, công thức BOM hoặc quy trình đã tồn tại thì sẽ cập nhật phiên bản mới nhất, nếu chưa có sẽ tự động khởi tạo.
              </div>
            </div>

            {/* Drag and Drop Area */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileUpload(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`lg:col-span-8 p-6 rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center gap-2 ${
                isDragging
                  ? "border-sky-500 bg-sky-50 dark:bg-sky-950/50 scale-[0.995]"
                  : "border-slate-300 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-900/30 hover:border-sky-500 hover:bg-sky-50/20"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                  e.target.value = "";
                }}
              />
              <div className="w-12 h-12 rounded-2xl bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 flex items-center justify-center text-2xl font-bold">
                📊
              </div>
              <div className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
                Kéo & Thả file Excel (`.xlsx`, `.xls`, `.csv`) vào đây hoặc Bấm để chọn file từ máy tính
              </div>
              <div className="text-xs text-slate-500 max-w-xl">
                Đang áp dụng cấu trúc biểu mẫu: <b className="text-sky-700 dark:text-sky-400">{activeTemplate.title}</b>. Tự động nhận diện tiêu đề cột tiếng Việt hoặc mã cột kỹ thuật.
              </div>
              {uploadedFileName && (
                <div className="mt-1 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-xs">
                  📄 Đang nạp: {uploadedFileName} ({previewRows.length} dòng dữ liệu)
                </div>
              )}
            </div>
          </div>

          {/* Template Schema Quick Reference Bar */}
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
            <div className="font-bold text-slate-700 dark:text-slate-200 mb-1.5">
              📋 Cấu trúc các cột của Biểu mẫu ({activeTemplate.fields.filter((f) => f.required).length} cột bắt buộc có dấu *):
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeTemplate.fields.map((f) => (
                <span
                  key={f.key}
                  title={`${f.description} (Ví dụ: ${f.example})`}
                  className={`px-2 py-1 rounded-lg border text-[11px] ${
                    f.required
                      ? "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-200 font-bold"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {f.label} {f.required && <span className="text-rose-600">*</span>}{" "}
                  <code className="text-[10px] text-slate-400 font-mono">({f.key})</code>
                </span>
              ))}
            </div>
          </div>

          {/* Step 3: Interactive Preview, Validation & Inline Edit Grid */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-sm text-slate-800 dark:text-slate-100">
                Bước 3: Bảng Xem Trước, Kiểm Tra Hợp Lệ & Chỉnh Sửa Trực Tiếp ({previewRows.length} dòng)
              </b>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold text-[11px]">
                ✅ {validRowCount} dòng hợp lệ
              </span>
              {invalidRowCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-[11px]">
                  ⚠️ {invalidRowCount} dòng thiếu thông tin bắt buộc
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  const emptyObj: Record<string, any> = {};
                  activeTemplate.fields.forEach((f) => {
                    emptyObj[f.key] = "";
                  });
                  setPreviewRows([...previewRows, emptyObj]);
                }}
              >
                + Thêm dòng trống
              </Button>
              {previewRows.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPreviewRows([]);
                    setUploadedFileName(null);
                  }}
                >
                  Xóa bảng tạm
                </Button>
              )}
              <Button
                onClick={() => importMut.mutate()}
                disabled={importMut.isPending || previewRows.length === 0}
              >
                {importMut.isPending
                  ? "⏳ Đang đồng bộ vào CSDL..."
                  : `🚀 Xác Nhận Nhập ${previewRows.length} Dòng Vào Hệ Thống`}
              </Button>
            </div>
          </div>

          {previewRows.length === 0 ? (
            <Empty>
              Bảng xem trước đang trống. Hãy kéo-thả file Excel vào khung phía trên hoặc bấm &ldquo;⚡ Nạp Dữ Liệu Mẫu Chuẩn Lên Bảng&rdquo;.
            </Empty>
          ) : (
            <Table
              head={[
                "#",
                "Kiểm tra",
                ...activeTemplate.fields.map((f) => (
                  <span key={f.key} title={f.description}>
                    {f.label} {f.required ? <span className="text-rose-500">*</span> : null}
                  </span>
                )),
                "Xóa",
              ]}
            >
              {previewRows.map((row, rIdx) => {
                const missingCols = validateRow(row);
                return (
                  <tr key={rIdx} className="align-top">
                    <td className="py-1.5 pr-2 font-mono text-slate-400">{rIdx + 1}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {missingCols.length === 0 ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold text-[10px]">
                          ✅ Hợp lệ
                        </span>
                      ) : (
                        <span
                          title={`Thiếu: ${missingCols.join(", ")}`}
                          className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-bold text-[10px]"
                        >
                          ⚠️ Thiếu: {missingCols[0]}
                        </span>
                      )}
                    </td>
                    {activeTemplate.fields.map((f) => (
                      <td key={f.key} className="py-1 pr-2 min-w-36">
                        <input
                          className={`${inputClass} !min-h-7 !py-1 !px-2 !text-xs ${
                            f.required && String(row[f.key] ?? "").trim() === ""
                              ? "border-rose-400 dark:border-rose-700 bg-rose-50/30"
                              : ""
                          }`}
                          value={row[f.key] ?? ""}
                          placeholder={f.example}
                          onChange={(e) => {
                            const next = [...previewRows];
                            next[rIdx] = { ...next[rIdx], [f.key]: e.target.value };
                            setPreviewRows(next);
                          }}
                        />
                      </td>
                    ))}
                    <td className="py-1.5 pr-2">
                      <button
                        type="button"
                        className="text-rose-600 hover:underline text-xs cursor-pointer"
                        onClick={() => setPreviewRows(previewRows.filter((_, i) => i !== rIdx))}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
      </Card>

      {/* Step 4: Audit Log of Excel Imports across Departments */}
      <Card title="Nhật Ký Lịch Sử Nhập Dữ Liệu Excel Khối Kỹ Thuật (Audit Trail)">
        {(overview.data?.recent_logs?.length ?? 0) === 0 ? (
          <Empty>Chưa có lịch sử nhập file Excel nào.</Empty>
        ) : (
          <Table
            head={[
              "Thời gian",
              "Biểu mẫu áp dụng",
              "Phòng ban / Kho đích",
              "Tên file Excel",
              "Tổng số dòng",
              "Tạo mới",
              "Cập nhật",
              "Dòng lỗi",
              "Người thực hiện",
            ]}
          >
            {(overview.data?.recent_logs ?? []).map((lg: any) => (
              <tr key={lg.id}>
                <td className="py-2 pr-3 font-mono whitespace-nowrap">{fmtDate(lg.created_at)}</td>
                <td className="py-2 pr-3 font-semibold">{lg.template_name}</td>
                <td className="py-2 pr-3 font-mono">
                  {lg.target_dept_code || "ALL"}
                  {lg.target_warehouse_code ? ` · ${lg.target_warehouse_code}` : ""}
                </td>
                <td className="py-2 pr-3 font-mono text-sky-700 dark:text-sky-400">{lg.file_name}</td>
                <td className="py-2 pr-3 font-mono">{lg.total_rows}</td>
                <td className="py-2 pr-3 font-mono font-bold text-emerald-700 dark:text-emerald-400">+{lg.created_count}</td>
                <td className="py-2 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{lg.updated_count}</td>
                <td className="py-2 pr-3">
                  <StatusBadge
                    status={lg.error_count > 0 ? "ON_HOLD" : "RELEASED"}
                    label={lg.error_count > 0 ? `${lg.error_count} lỗi` : "100% Thành công"}
                  />
                </td>
                <td className="py-2 pr-3">{lg.actor_name || "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
