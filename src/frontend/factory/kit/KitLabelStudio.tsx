"use client";
import React, { useState, useRef, useEffect } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { printElementHtml } from "../coa";

export interface LabelElementPos {
  x: number;
  y: number;
  fontSize?: number;
  bold?: boolean;
  prefix?: string;
  hidePrefix?: boolean;
  simText?: string;
  customText?: string;
  size_mm?: number;
  width_mm?: number;
  height_mm?: number;
  tempMin?: string;
  tempMax?: string;
}

export interface LabelTargetConfig {
  name: string;
  width_mm: number;
  height_mm: number;
  font_size_pt: number;
  qr_size_mm: number;
  labels_per_row: number;
  label_gap_mm: number;
  vertical_gap_mm: number;
  barcode_type: "QR_2D" | "GS1_DATAMATRIX" | "CODE_128";
  extra_text: string;
  artwork_bg_url?: string | null;
  display_fields: string[];
  positions_json: Record<string, LabelElementPos>;
}

export interface KitLabelDesignBundle {
  outer_box: LabelTargetConfig;
  sub_box: LabelTargetConfig;
  tube: LabelTargetConfig;
  extra_components?: LabelTargetConfig[];
}

export interface LabelSampleData {
  productName: string;
  productCode: string;
  specification: string;
  quantity: string;
  storage: string;
  mfgDate: string;
  expDate: string;
  lotNumber: string;
  manufacturer: string;
  udiDi: string;
  phValue?: string;
  tccsCode?: string;
}

export const SYSTEM_FIELD_OPTIONS: Array<{ id: string; label: string; defaultPrefix: string }> = [
  { id: "logo", label: "Logo ABT", defaultPrefix: "" },
  { id: "product_name", label: "Tên sản phẩm / Bán thành phẩm", defaultPrefix: "" },
  { id: "product_code", label: "Mã sản phẩm (REF)", defaultPrefix: "REF:" },
  { id: "specification", label: "Quy cách đóng gói", defaultPrefix: "Quy cách:" },
  { id: "quantity", label: "Số lượng / Thể tích", defaultPrefix: "SL:" },
  { id: "storage", label: "Điều kiện bảo quản", defaultPrefix: "Bảo quản:" },
  { id: "lot_number", label: "Số lô sản xuất (LOT)", defaultPrefix: "LOT:" },
  { id: "mfg_date", label: "Ngày sản xuất (NSX)", defaultPrefix: "NSX:" },
  { id: "exp_date", label: "Hạn sử dụng (HSD)", defaultPrefix: "HSD:" },
  { id: "ph_value", label: "Giá trị pH (Cho BTP)", defaultPrefix: "pH:" },
  { id: "manufacturer", label: "Tên Nhà sản xuất", defaultPrefix: "" },
  { id: "extra_text", label: "Chú thích / TCCS / ĐKLH", defaultPrefix: "" },
  { id: "qr_code", label: "Mã QR / Barcode GS1", defaultPrefix: "" },
];

export const SYMBOL_OPTIONS: Array<{ id: string; label: string; defaultSize: number }> = [
  { id: "symbol_ivd", label: "[IVD] Chẩn đoán In-Vitro", defaultSize: 6.5 },
  { id: "symbol_lot", label: "[LOT] Biểu tượng Số lô", defaultSize: 6.5 },
  { id: "symbol_expiry", label: "⌛ Hạn sử dụng (Use-by)", defaultSize: 6.5 },
  { id: "symbol_temp_minus_20", label: "🌡️ Bảo quản -20°C", defaultSize: 8 },
  { id: "symbol_temp_2_8", label: "🌡️ Bảo quản 2°C...8°C", defaultSize: 8 },
  { id: "symbol_temp", label: "🌡️ Bảo quản 15°C...25°C", defaultSize: 8 },
  { id: "symbol_temp_15_30", label: "🌡️ Bảo quản 15°C...30°C", defaultSize: 8 },
  { id: "symbol_temp_15_35", label: "🌡️ Bảo quản 15°C...35°C", defaultSize: 8 },
  { id: "symbol_ifu", label: "📖 [i] Xem Hướng dẫn sử dụng", defaultSize: 6.5 },
  { id: "symbol_caution", label: "⚠️ Cảnh báo (Caution)", defaultSize: 6.5 },
  { id: "symbol_keep_dry", label: "☂️ Tránh ẩm / Giữ khô", defaultSize: 6.5 },
  { id: "symbol_sunlight", label: "☀️ Tránh ánh nắng trực tiếp", defaultSize: 6.5 },
  { id: "symbol_tests", label: "Σ Đủ cho <n> xét nghiệm", defaultSize: 6.5 },
  { id: "symbol_do_not_reuse", label: "② Không tái sử dụng", defaultSize: 6.5 },
  { id: "symbol_keep_up", label: "⬆️⬆️ Đặt đứng chiều này", defaultSize: 6.5 },
  { id: "symbol_manufacturer", label: "🏭 Nhà sản xuất (ISO)", defaultSize: 6.5 },
  { id: "symbol_ghs_biohazard", label: "☣️ Nguy hiểm sinh học", defaultSize: 7.5 },
  { id: "symbol_ghs_flammable", label: "🔥 Cảnh báo Dễ cháy (GHS)", defaultSize: 7.5 },
];

export const LABEL_SIZE_PRESETS: Array<{
  label: string;
  width_mm: number;
  height_mm: number;
  font_size_pt: number;
  qr_size_mm: number;
  labels_per_row: number;
  label_gap_mm: number;
  vertical_gap_mm: number;
}> = [
  { label: "Nhãn 100×50 mm (Hộp lớn chuẩn ABT)", width_mm: 100, height_mm: 50, font_size_pt: 8, qr_size_mm: 15, labels_per_row: 1, label_gap_mm: 2, vertical_gap_mm: 2 },
  { label: "Nhãn 80×40 mm (Hộp Kit vừa)", width_mm: 80, height_mm: 40, font_size_pt: 7, qr_size_mm: 13, labels_per_row: 1, label_gap_mm: 2, vertical_gap_mm: 2 },
  { label: "Nhãn 70×40 mm (Chai BTP / Hộp phụ)", width_mm: 70, height_mm: 40, font_size_pt: 7, qr_size_mm: 12, labels_per_row: 1, label_gap_mm: 2, vertical_gap_mm: 2 },
  { label: "Nhãn 50×25 mm (Chai nhỏ / Túi Zip)", width_mm: 50, height_mm: 25, font_size_pt: 6, qr_size_mm: 10, labels_per_row: 2, label_gap_mm: 2, vertical_gap_mm: 2 },
  { label: "Nhãn 35×22 mm (Ống Falcon / Lọ)", width_mm: 35, height_mm: 22, font_size_pt: 5.5, qr_size_mm: 8, labels_per_row: 2, label_gap_mm: 2, vertical_gap_mm: 2 },
  { label: "Nhãn 35×15 mm (Ống 1.5mL — 3 tem/hàng)", width_mm: 35, height_mm: 15, font_size_pt: 5, qr_size_mm: 7, labels_per_row: 3, label_gap_mm: 2, vertical_gap_mm: 3 },
  { label: "Nhãn 22×15 mm (Ống 0.5mL — 3 tem/hàng)", width_mm: 22, height_mm: 15, font_size_pt: 4.5, qr_size_mm: 6, labels_per_row: 3, label_gap_mm: 2, vertical_gap_mm: 3 },
];

export interface LabelPackagingHint {
  box_no?: number;
  box_name?: string;
  component_name?: string;
  container_type?: string;
  fill_qty?: number;
  fill_uom?: string;
  units_per_kit?: number;
  storage_temp?: string;
}

export function buildDefaultLabelBundle(
  sample?: Partial<LabelSampleData>,
  isSemiFinished?: boolean,
  bomCategory?: string,
  packagingItems?: LabelPackagingHint[]
): KitLabelDesignBundle {
  const isPcr = !bomCategory || bomCategory === "PCR Kit";
  const isCold = (sample?.storage || (isPcr ? "-20°C" : "15-25°C")).includes("-20");
  const tempSymbol = isCold ? "symbol_temp_minus_20" : "symbol_temp";
  const firstPkg = packagingItems && packagingItems.length > 0 ? packagingItems[0] : undefined;
  const firstCompLabel = firstPkg?.component_name
    ? `${firstPkg.component_name} (${firstPkg.fill_qty ?? 1} ${firstPkg.fill_uom || (isPcr ? "µL" : "mL")})`
    : isPcr
      ? "Ống hóa chất PCR"
      : "Chai / Lọ dung dịch đệm";

  const outerBox: LabelTargetConfig = {
    name: isSemiFinished ? "Nhãn Chai / Can Bán Thành Phẩm (70×40mm)" : "Nhãn Hộp Ngoài Thành Phẩm (100×50mm)",
    width_mm: isSemiFinished ? 70 : 100,
    height_mm: isSemiFinished ? 40 : 50,
    font_size_pt: isSemiFinished ? 7 : 8,
    qr_size_mm: isSemiFinished ? 12 : 15,
    labels_per_row: 1,
    label_gap_mm: 2,
    vertical_gap_mm: 2,
    barcode_type: "QR_2D",
    extra_text: sample?.tccsCode ? `${sample.tccsCode} · ISO 13485:2016` : "TCCS 01:2026/ABT · ISO 13485:2016",
    display_fields: isSemiFinished
      ? ["logo", "product_name", "product_code", "specification", "lot_number", "mfg_date", "exp_date", "ph_value", "storage", "qr_code", tempSymbol, "symbol_caution"]
      : [
          "logo",
          "product_name",
          "product_code",
          "specification",
          "storage",
          "lot_number",
          "mfg_date",
          "exp_date",
          "manufacturer",
          "extra_text",
          "qr_code",
          "symbol_ivd",
          tempSymbol,
          "symbol_ifu",
          "symbol_keep_dry",
          "symbol_sunlight",
        ],
    positions_json: isSemiFinished
      ? {
          logo: { x: 3, y: 2.5, width_mm: 14, height_mm: 5.5 },
          product_name: { x: 19, y: 2.5, fontSize: 8.5, bold: true, hidePrefix: true },
          product_code: { x: 19, y: 7.5, fontSize: 7, bold: true, prefix: "Mã BTP:" },
          specification: { x: 3, y: 13, fontSize: 6.5, prefix: "Quy cách:" },
          ph_value: { x: 3, y: 17.5, fontSize: 7, bold: true, prefix: "pH chuẩn:" },
          lot_number: { x: 3, y: 22, fontSize: 7, bold: true, prefix: "LOT:" },
          mfg_date: { x: 3, y: 26.5, fontSize: 6.5, prefix: "NSX:" },
          exp_date: { x: 3, y: 31, fontSize: 6.5, bold: true, prefix: "HSD:" },
          storage: { x: 3, y: 35.5, fontSize: 6.5, prefix: "Bảo quản:" },
          qr_code: { x: 54, y: 13, size_mm: 13 },
          [tempSymbol]: { x: 48, y: 29, size_mm: 8.5 },
          symbol_caution: { x: 59, y: 29.5, size_mm: 7 },
        }
      : {
          logo: { x: 3.5, y: 3, width_mm: 16, height_mm: 6.5 },
          product_name: { x: 22, y: 3, fontSize: 9.5, bold: true, hidePrefix: true },
          product_code: { x: 22, y: 8.5, fontSize: 7.5, bold: true, prefix: "REF:" },
          specification: { x: 48, y: 8.5, fontSize: 7.5, bold: true, prefix: "Quy cách:" },
          lot_number: { x: 3.5, y: 15, fontSize: 7.5, bold: true, prefix: "LOT:" },
          mfg_date: { x: 3.5, y: 20, fontSize: 7, prefix: "NSX:" },
          exp_date: { x: 3.5, y: 25, fontSize: 7, bold: true, prefix: "HSD:" },
          storage: { x: 3.5, y: 30, fontSize: 7, prefix: "Bảo quản:" },
          extra_text: { x: 3.5, y: 35, fontSize: 6.5, hidePrefix: true },
          manufacturer: { x: 3.5, y: 44.5, fontSize: 6, bold: true, hidePrefix: true },
          qr_code: { x: 81, y: 14, size_mm: 15 },
          symbol_ivd: { x: 46, y: 36, size_mm: 6.5 },
          [tempSymbol]: { x: 55, y: 35, size_mm: 8.5 },
          symbol_ifu: { x: 66, y: 36, size_mm: 6.5 },
          symbol_keep_dry: { x: 75, y: 36, size_mm: 6.5 },
          symbol_sunlight: { x: 84, y: 36, size_mm: 6.5 },
        },
  };

  const subBox: LabelTargetConfig = {
    name: "Nhãn Hộp Phụ / Hộp Hóa Chất (80×40mm)",
    width_mm: 80,
    height_mm: 40,
    font_size_pt: 7,
    qr_size_mm: 12,
    labels_per_row: 1,
    label_gap_mm: 2,
    vertical_gap_mm: 2,
    barcode_type: "QR_2D",
    extra_text:
      firstPkg?.box_name ||
      (isPcr ? "Hộp 1: Hóa chất Khuếch đại PCR" : "Hộp 1: Hóa chất & Đệm Tách chiết"),
    display_fields: ["logo", "product_name", "extra_text", "lot_number", "exp_date", "storage", "qr_code", "symbol_ivd", tempSymbol],
    positions_json: {
      logo: { x: 3, y: 2.5, width_mm: 13, height_mm: 5.5 },
      product_name: { x: 18, y: 2.5, fontSize: 8, bold: true, hidePrefix: true },
      extra_text: { x: 18, y: 7.5, fontSize: 7, bold: true, hidePrefix: true },
      lot_number: { x: 3, y: 14.5, fontSize: 7, bold: true, prefix: "LOT:" },
      exp_date: { x: 3, y: 19.5, fontSize: 7, bold: true, prefix: "HSD:" },
      storage: { x: 3, y: 24.5, fontSize: 6.5, prefix: "Bảo quản:" },
      qr_code: { x: 64, y: 13, size_mm: 12.5 },
      symbol_ivd: { x: 46, y: 30, size_mm: 6 },
      [tempSymbol]: { x: 55, y: 29, size_mm: 8 },
    },
  };

  const isBottle = firstPkg?.container_type?.startsWith("BOTTLE");
  const tube: LabelTargetConfig = {
    name: isBottle
      ? "Nhãn Chai / Lọ Thành Phần (50×25mm · 2 tem/hàng)"
      : "Nhãn Ống Thành Phần (35×15mm · 3 tem/hàng)",
    width_mm: isBottle ? 50 : 35,
    height_mm: isBottle ? 25 : 15,
    font_size_pt: isBottle ? 6 : 5,
    qr_size_mm: isBottle ? 9 : 6.5,
    labels_per_row: isBottle ? 2 : 3,
    label_gap_mm: 2,
    vertical_gap_mm: 3,
    barcode_type: "QR_2D",
    extra_text: firstCompLabel,
    display_fields: ["product_code", "extra_text", "lot_number", "exp_date", "qr_code"],
    positions_json: isBottle
      ? {
          product_code: { x: 2, y: 2, fontSize: 6.5, bold: true, hidePrefix: true },
          extra_text: { x: 2, y: 6.5, fontSize: 6, bold: true, hidePrefix: true },
          lot_number: { x: 2, y: 12, fontSize: 5.5, prefix: "LOT:" },
          exp_date: { x: 2, y: 17, fontSize: 5.5, prefix: "HSD:" },
          qr_code: { x: 38, y: 6, size_mm: 9.5 },
        }
      : {
          product_code: { x: 1.5, y: 1.2, fontSize: 5.5, bold: true, hidePrefix: true },
          extra_text: { x: 1.5, y: 4.3, fontSize: 5, bold: true, hidePrefix: true },
          lot_number: { x: 1.5, y: 7.8, fontSize: 4.8, prefix: "LOT:" },
          exp_date: { x: 1.5, y: 11, fontSize: 4.8, prefix: "HSD:" },
          qr_code: { x: 26.5, y: 4, size_mm: 6.8 },
        },
  };

  const extraComponents: LabelTargetConfig[] =
    packagingItems && packagingItems.length > 1
      ? packagingItems.slice(1).map((pk, idx) => {
          const pkBottle = pk.container_type?.startsWith("BOTTLE");
          const pkText = `${pk.component_name || `Thành phần #${idx + 2}`} (${pk.fill_qty ?? 1} ${pk.fill_uom || (isPcr ? "µL" : "mL")})`;
          return {
            ...tube,
            name: pk.component_name || `Nhãn Thành Phần #${idx + 2}`,
            width_mm: pkBottle ? 50 : 35,
            height_mm: pkBottle ? 25 : 15,
            font_size_pt: pkBottle ? 6 : 5,
            qr_size_mm: pkBottle ? 9 : 6.5,
            labels_per_row: pkBottle ? 2 : 3,
            extra_text: pkText,
            positions_json: pkBottle
              ? {
                  product_code: { x: 2, y: 2, fontSize: 6.5, bold: true, hidePrefix: true },
                  extra_text: { x: 2, y: 6.5, fontSize: 6, bold: true, hidePrefix: true },
                  lot_number: { x: 2, y: 12, fontSize: 5.5, prefix: "LOT:" },
                  exp_date: { x: 2, y: 17, fontSize: 5.5, prefix: "HSD:" },
                  qr_code: { x: 38, y: 6, size_mm: 9.5 },
                }
              : { ...tube.positions_json },
          };
        })
      : [];

  return { outer_box: outerBox, sub_box: subBox, tube, extra_components: extraComponents };
}

export function normalizeLabelBundle(
  raw: unknown,
  sample?: Partial<LabelSampleData>,
  isSemiFinished?: boolean,
  bomCategory?: string,
  packagingItems?: LabelPackagingHint[]
): KitLabelDesignBundle {
  const defaults = buildDefaultLabelBundle(sample, isSemiFinished, bomCategory, packagingItems);
  if (!raw || typeof raw !== "object" || Object.keys(raw as Record<string, unknown>).length === 0) {
    return { ...defaults, extra_components: defaults.extra_components || [] };
  }
  const obj = raw as Partial<KitLabelDesignBundle>;
  const hasSavedExtras = Array.isArray(obj.extra_components) && obj.extra_components.length > 0;
  return {
    outer_box: obj.outer_box && typeof obj.outer_box === "object" ? { ...defaults.outer_box, ...obj.outer_box } : defaults.outer_box,
    sub_box: obj.sub_box && typeof obj.sub_box === "object" ? { ...defaults.sub_box, ...obj.sub_box } : defaults.sub_box,
    tube: obj.tube && typeof obj.tube === "object" ? { ...defaults.tube, ...obj.tube } : defaults.tube,
    extra_components: hasSavedExtras
      ? obj.extra_components!.map((c, idx) => ({
          ...defaults.tube,
          ...c,
          name: c?.name || `Nhãn Thành Phần #${idx + 2}`,
          positions_json: { ...defaults.tube.positions_json, ...(c?.positions_json || {}) },
        }))
      : defaults.extra_components || [],
  };
}

/** Renders authentic ISO 15223 / GHS / Packaging Vector SVG Symbols */
export function renderIsoSymbolSvg(fieldId: string, pos?: LabelElementPos): React.ReactNode {
  switch (fieldId) {
    case "symbol_lot":
      return (
        <svg viewBox="0 0 42 24" style={{ width: "100%", height: "100%" }}>
          <rect x="1.5" y="1.5" width="39" height="21" fill="none" stroke="#000" strokeWidth="2.2" />
          <text x="21" y="16.5" fontSize="13" fontWeight="bold" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">
            LOT
          </text>
        </svg>
      );
    case "symbol_ivd":
      return (
        <svg viewBox="0 0 42 24" style={{ width: "100%", height: "100%" }}>
          <rect x="1.5" y="1.5" width="39" height="21" fill="none" stroke="#000" strokeWidth="2.2" />
          <text x="21" y="16.5" fontSize="13" fontWeight="bold" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">
            IVD
          </text>
        </svg>
      );
    case "symbol_expiry":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <path d="M6 2h12v4l-4 5 4 5v6H6v-6l4-5-4-5V2z" fill="none" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
          <line x1="4" y1="2" x2="20" y2="2" stroke="#000" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="4" y1="22" x2="20" y2="22" stroke="#000" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M8 19h8l-2.5-3.5h-3L8 19z" fill="#000" />
        </svg>
      );
    case "symbol_temp":
    case "symbol_temp_15_30":
    case "symbol_temp_15_35":
    case "symbol_temp_2_8":
    case "symbol_temp_minus_20": {
      let defaultMin = "15°C";
      let defaultMax = "25°C";
      if (fieldId === "symbol_temp_15_30") defaultMax = "30°C";
      if (fieldId === "symbol_temp_15_35") defaultMax = "35°C";
      if (fieldId === "symbol_temp_2_8") {
        defaultMin = "2°C";
        defaultMax = "8°C";
      }
      if (fieldId === "symbol_temp_minus_20") {
        defaultMin = "";
        defaultMax = "-20°C";
      }
      const tMin = pos?.tempMin !== undefined ? pos.tempMin : defaultMin;
      const tMax = pos?.tempMax !== undefined ? pos.tempMax : defaultMax;
      return (
        <svg viewBox="0 0 46 28" style={{ width: "100%", height: "100%", overflow: "visible" }}>
          <path d="M21 5v12.5a3.5 3.5 0 1 1-3 0V5a1.5 1.5 0 1 1 3 0z" fill="none" stroke="#000" strokeWidth="1.6" />
          <circle cx="19.5" cy="20" r="2.2" fill="#000" />
          <line x1="19.5" y1="10" x2="19.5" y2="19" stroke="#000" strokeWidth="1.5" />
          {tMax && (
            <>
              <line x1="23" y1="6.5" x2="31" y2="6.5" stroke="#000" strokeWidth="1.6" />
              <text x="27" y="5" fontSize="6.5" fontWeight="bold" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">
                {tMax}
              </text>
            </>
          )}
          {tMin && (
            <>
              <line x1="8" y1="16.5" x2="16" y2="16.5" stroke="#000" strokeWidth="1.6" />
              <text x="11" y="23.5" fontSize="6.5" fontWeight="bold" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">
                {tMin}
              </text>
            </>
          )}
        </svg>
      );
    }
    case "symbol_caution":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <path d="M12 2.5L1.8 20.5h20.4L12 2.5z" fill="none" stroke="#000" strokeWidth="2.1" strokeLinejoin="round" />
          <line x1="12" y1="9" x2="12" y2="15" stroke="#000" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="12" cy="18" r="1.4" fill="#000" />
        </svg>
      );
    case "symbol_ifu":
      return (
        <svg viewBox="0 0 30 24" style={{ width: "100%", height: "100%" }}>
          <path d="M3 4.5C6.5 3.5 11.5 3.5 15 5.5C18.5 3.5 23.5 3.5 27 4.5V19.5C23.5 18.5 18.5 18.5 15 20.5C11.5 18.5 6.5 18.5 3 19.5V4.5Z" fill="none" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
          <line x1="15" y1="5.5" x2="15" y2="20.5" stroke="#000" strokeWidth="1.6" />
          <circle cx="21" cy="9.2" r="1.1" fill="#000" />
          <line x1="21" y1="11.5" x2="21" y2="16" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "symbol_keep_up":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <path d="M7 17V5M7 5L3.5 9M7 5L10.5 9" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 17V5M17 5L13.5 9M17 5L20.5 9" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="3" y1="20.5" x2="21" y2="20.5" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "symbol_sunlight":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <circle cx="7" cy="6.5" r="2.5" fill="#000" />
          <line x1="11" y1="8.5" x2="18" y2="3" stroke="#000" strokeWidth="1.5" strokeDasharray="1.5 1" />
          <path d="M11 13L17 9L22 14" fill="none" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
          <rect x="13" y="14" width="6" height="6" fill="#000" />
        </svg>
      );
    case "symbol_keep_dry":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <path d="M3 13a9 9 0 0 1 18 0Z" fill="none" stroke="#000" strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M12 13v5.5a2 2 0 0 1-4 0" fill="none" stroke="#000" strokeWidth="1.9" strokeLinecap="round" />
          <line x1="7" y1="2.5" x2="6" y2="5.5" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="12" y1="2" x2="11" y2="5" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="17" y1="2.5" x2="16" y2="5.5" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "symbol_tests":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <rect x="2" y="2" width="20" height="20" fill="none" stroke="#000" strokeWidth="1.9" />
          <path d="M16.5 6.5H7.5L12.5 12L7.5 17.5H16.5" fill="none" stroke="#000" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "symbol_do_not_reuse":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <circle cx="12" cy="12" r="9.5" fill="none" stroke="#000" strokeWidth="2" />
          <text x="12" y="16.5" fontSize="13" fontWeight="bold" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">
            2
          </text>
          <line x1="5" y1="19" x2="19" y2="5" stroke="#000" strokeWidth="2" />
        </svg>
      );
    case "symbol_manufacturer":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <path d="M2.5 21V9.5L8.5 14V9.5L14.5 14V4.5H21.5V21H2.5Z" fill="#000" />
        </svg>
      );
    case "symbol_ghs_biohazard":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <polygon points="12,1.5 22.5,12 12,22.5 1.5,12" fill="#fff" stroke="#dc2626" strokeWidth="2.2" />
          <circle cx="12" cy="9.2" r="2.8" fill="none" stroke="#000" strokeWidth="1.5" />
          <circle cx="9.6" cy="13.5" r="2.8" fill="none" stroke="#000" strokeWidth="1.5" />
          <circle cx="14.4" cy="13.5" r="2.8" fill="none" stroke="#000" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="1.3" fill="#fff" stroke="#000" strokeWidth="1" />
        </svg>
      );
    case "symbol_ghs_flammable":
      return (
        <svg viewBox="0 0 24 24" style={{ width: "100%", height: "100%" }}>
          <polygon points="12,1.5 22.5,12 12,22.5 1.5,12" fill="#fff" stroke="#dc2626" strokeWidth="2.2" />
          <path d="M12 5.5c1.5 2.5 3.5 4 3.5 6.8a3.5 3.5 0 0 1-7 0c0-1.6.9-3 2-4.2-.2 1.2.5 1.8 1 2-.3-1.5.1-3.2.5-4.6z" fill="#000" />
          <line x1="8" y1="17.2" x2="16" y2="17.2" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}

/** Real scannable SVG QR / GS1 2D / Code-128 renderer using qrcode & jsbarcode */
function renderBarcodeSvg(type: "QR_2D" | "GS1_DATAMATRIX" | "CODE_128", value: string) {
  const safeVal = (value || "ABT").trim();
  if (type === "CODE_128") {
    if (typeof document !== "undefined") {
      try {
        const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        JsBarcode(svgNode, safeVal, {
          format: "CODE128",
          displayValue: true,
          fontSize: 10,
          textMargin: 1,
          height: 28,
          margin: 2,
          lineColor: "#000000",
          background: "#ffffff",
        });
        svgNode.setAttribute("style", "width:100%;height:100%;background:#fff;display:block");
        return (
          <div
            style={{ width: "100%", height: "100%", background: "#fff" }}
            dangerouslySetInnerHTML={{ __html: svgNode.outerHTML }}
          />
        );
      } catch {
        // fallback below if non-printable char
      }
    }
  }

  try {
    const qr = QRCode.create(safeVal, { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const data = qr.modules.data;
    let d = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (data[r * size + c]) {
          d += `M${c + 1},${r + 1}h1v1h-1z`;
        }
      }
    }
    return (
      <svg
        viewBox={`0 0 ${size + 2} ${size + 2}`}
        shapeRendering="crispEdges"
        style={{ width: "100%", height: "100%", background: "#fff", display: "block" }}
      >
        <rect x="0" y="0" width={size + 2} height={size + 2} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
    );
  } catch {
    return null;
  }
}

/** Single Label Canvas Component — supports both static visual preview & interactive drag-and-drop editing */
export function VisualLabelCanvas({
  config,
  sample,
  scale = 3.8,
  interactive = false,
  selectedField = null,
  onSelectField,
  onUpdatePosition,
  cleanPrint = false,
}: {
  config: LabelTargetConfig;
  sample: LabelSampleData;
  scale?: number;
  interactive?: boolean;
  selectedField?: string | null;
  onSelectField?: (fieldId: string | null) => void;
  onUpdatePosition?: (fieldId: string, x: number, y: number) => void;
  cleanPrint?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [draggingField, setDraggingField] = useState<string | null>(null);
  const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const widthPx = config.width_mm * scale;
  const heightPx = config.height_mm * scale;

  useEffect(() => {
    if (!interactive || !draggingField || !onUpdatePosition) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const rawX = (e.clientX - rect.left - dragOffset.current.dx) / scale;
      const rawY = (e.clientY - rect.top - dragOffset.current.dy) / scale;
      const clampedX = Math.max(0, Math.min(config.width_mm - 2, Math.round(rawX * 2) / 2));
      const clampedY = Math.max(0, Math.min(config.height_mm - 1.5, Math.round(rawY * 2) / 2));
      onUpdatePosition(draggingField, clampedX, clampedY);
    };
    const handleMouseUp = () => setDraggingField(null);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [interactive, draggingField, scale, config.width_mm, config.height_mm, onUpdatePosition]);

  const getFieldText = (fieldId: string, pos: LabelElementPos): { prefix: string; value: string } => {
    const sys = SYSTEM_FIELD_OPTIONS.find((f) => f.id === fieldId);
    const prefix = pos.hidePrefix ? "" : pos.prefix !== undefined ? pos.prefix : sys?.defaultPrefix || "";
    if (pos.simText) return { prefix, value: pos.simText };
    if (fieldId.startsWith("custom_text_")) return { prefix: "", value: pos.customText || "Chữ tùy chỉnh" };
    switch (fieldId) {
      case "product_name":
        return { prefix, value: sample.productName };
      case "product_code":
        return { prefix, value: sample.productCode };
      case "specification":
        return { prefix, value: sample.specification };
      case "quantity":
        return { prefix, value: sample.quantity };
      case "storage":
        return { prefix, value: sample.storage };
      case "mfg_date":
        return { prefix, value: sample.mfgDate };
      case "exp_date":
        return { prefix, value: sample.expDate };
      case "lot_number":
        return { prefix, value: sample.lotNumber };
      case "ph_value":
        return { prefix, value: sample.phValue || "8.30 ± 0.1" };
      case "manufacturer":
        return { prefix, value: sample.manufacturer };
      case "extra_text":
        return { prefix, value: config.extra_text || sample.tccsCode || "" };
      default:
        return { prefix: "", value: fieldId };
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={() => {
        if (interactive && onSelectField) onSelectField(null);
      }}
      style={{
        position: "relative",
        width: `${widthPx}px`,
        height: `${heightPx}px`,
        backgroundColor: "#ffffff",
        color: "#000000",
        borderRadius: cleanPrint ? "2px" : "5px",
        border: cleanPrint ? "1px solid #cbd5e1" : interactive ? "2px solid #3b82f6" : "1.5px solid #94a3b8",
        boxShadow: cleanPrint ? "none" : "0 8px 22px rgba(0, 0, 0, 0.35)",
        overflow: "hidden",
        userSelect: "none",
        fontFamily: "Arial, Helvetica, sans-serif",
        backgroundImage: config.artwork_bg_url
          ? `url(${config.artwork_bg_url})`
          : interactive && !cleanPrint
          ? `linear-gradient(to right, rgba(59,130,246,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,0.09) 1px, transparent 1px)`
          : "none",
        backgroundSize: config.artwork_bg_url ? "cover" : `${5 * scale}px ${5 * scale}px`,
        backgroundPosition: "center",
      }}
    >
      {/* Top accent bar for large box labels */}
      {config.width_mm >= 65 && !config.artwork_bg_url && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: `${Math.max(2, 1.1 * scale)}px`,
            background: "linear-gradient(90deg, #0284c7 0%, #0ea5e9 55%, #10b981 100%)",
          }}
        />
      )}

      {config.display_fields.map((fieldId, idx) => {
        const pos = config.positions_json[fieldId] || {
          x: 2.5,
          y: 2.5 + idx * 4.2,
          fontSize: config.font_size_pt,
        };
        const isSelected = interactive && selectedField === fieldId;
        const leftPx = pos.x * scale;
        const topPx = pos.y * scale;
        const fontPt = pos.fontSize ?? config.font_size_pt;
        const fontPx = Math.max(7, fontPt * (scale / 2.65));

        const handleMouseDown = (e: React.MouseEvent) => {
          if (!interactive) return;
          e.stopPropagation();
          onSelectField?.(fieldId);
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          dragOffset.current = {
            dx: e.clientX - rect.left - leftPx,
            dy: e.clientY - rect.top - topPx,
          };
          setDraggingField(fieldId);
        };

        // 1. Logo ABT
        if (fieldId === "logo") {
          const wMm = pos.width_mm ?? (config.width_mm >= 65 ? 15 : 10);
          const hMm = pos.height_mm ?? (config.width_mm >= 65 ? 6 : 4.2);
          return (
            <div
              key={fieldId}
              onMouseDown={handleMouseDown}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: `${leftPx}px`,
                top: `${topPx}px`,
                width: `${wMm * scale}px`,
                height: `${hMm * scale}px`,
                cursor: interactive ? "grab" : "default",
                outline: isSelected ? "1.5px dashed #2563eb" : "none",
                backgroundColor: isSelected ? "rgba(37,99,235,0.08)" : "transparent",
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg viewBox="0 0 120 44" style={{ width: "100%", height: "100%" }}>
                <rect x="2" y="4" width="116" height="36" rx="6" fill="#0284c7" />
                <text x="60" y="26" fontSize="22" fontWeight="900" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#ffffff" letterSpacing="2">
                  ABT
                </text>
                <text x="60" y="36.5" fontSize="6.5" fontWeight="bold" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#e0f2fe" letterSpacing="1.2">
                  BIOLAB SOLUTIONS
                </text>
              </svg>
            </div>
          );
        }

        // 2. QR / Barcode
        if (fieldId === "qr_code") {
          const qrMm = pos.size_mm ?? config.qr_size_mm ?? 12;
          const qrW = config.barcode_type === "CODE_128" ? qrMm * 1.9 * scale : qrMm * scale;
          const qrH = config.barcode_type === "CODE_128" ? qrMm * 0.75 * scale : qrMm * scale;
          return (
            <div
              key={fieldId}
              onMouseDown={handleMouseDown}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: `${leftPx}px`,
                top: `${topPx}px`,
                width: `${qrW}px`,
                height: `${qrH}px`,
                cursor: interactive ? "grab" : "default",
                outline: isSelected ? "1.5px dashed #2563eb" : "none",
                backgroundColor: "#fff",
                padding: "1px",
              }}
            >
              {renderBarcodeSvg(config.barcode_type || "QR_2D", `${sample.udiDi}|LOT:${sample.lotNumber}|EXP:${sample.expDate}`)}
            </div>
          );
        }

        // 3. ISO / GHS Symbols
        if (fieldId.startsWith("symbol_")) {
          const symOpt = SYMBOL_OPTIONS.find((s) => s.id === fieldId);
          const sMm = pos.size_mm ?? symOpt?.defaultSize ?? 6.5;
          const isWide = fieldId === "symbol_lot" || fieldId === "symbol_ivd" || fieldId.startsWith("symbol_temp");
          return (
            <div
              key={fieldId}
              onMouseDown={handleMouseDown}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: `${leftPx}px`,
                top: `${topPx}px`,
                width: `${(isWide ? sMm * 1.45 : sMm) * scale}px`,
                height: `${sMm * scale}px`,
                cursor: interactive ? "grab" : "default",
                outline: isSelected ? "1.5px dashed #2563eb" : "none",
                backgroundColor: isSelected ? "rgba(37,99,235,0.08)" : "transparent",
              }}
            >
              {renderIsoSymbolSvg(fieldId, pos)}
            </div>
          );
        }

        // 4. Text / Data Field
        const { prefix, value } = getFieldText(fieldId, pos);
        return (
          <div
            key={fieldId}
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: `${leftPx}px`,
              top: `${topPx}px`,
              fontSize: `${fontPx}px`,
              fontWeight: pos.bold || fieldId === "product_name" || fieldId === "product_code" ? 700 : 500,
              color: fieldId === "product_name" ? "#0f172a" : "#111827",
              lineHeight: 1.18,
              whiteSpace: "nowrap",
              cursor: interactive ? "grab" : "default",
              outline: isSelected ? "1.5px dashed #2563eb" : "none",
              backgroundColor: isSelected ? "rgba(37,99,235,0.10)" : "transparent",
              padding: "0 1px",
              borderRadius: "2px",
            }}
          >
            {prefix ? <span style={{ fontWeight: 700, marginRight: "3px" }}>{prefix}</span> : null}
            <span>{value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Interactive WYSIWYG Label Studio Component */
export function KitLabelStudio({
  bundle,
  sample,
  isSemiFinished = false,
  packagingItems = [],
  bomLines = [],
  onChangeBundle,
  onSave,
  busy = false,
}: {
  bundle: KitLabelDesignBundle;
  sample: LabelSampleData;
  isSemiFinished?: boolean;
  packagingItems?: Array<{
    component_name?: string;
    fill_qty?: number | string;
    fill_uom?: string;
    box_no?: number | string;
    box_name?: string;
    storage_temp?: string;
  }>;
  bomLines?: Array<{
    component_code?: string;
    component_name?: string;
    qty_per_base?: number | string;
    uom?: string;
    box_no?: number | string;
  }>;
  onChangeBundle: (next: KitLabelDesignBundle) => void;
  onSave?: () => void;
  busy?: boolean;
}) {
  const [activeTarget, setActiveTarget] = useState<string>("outer_box");
  const [selectedField, setSelectedField] = useState<string | null>("product_name");
  const [cleanPreviewMode, setCleanPreviewMode] = useState(false);
  const [showAddCompModal, setShowAddCompModal] = useState(false);
  const printStageRef = useRef<HTMLDivElement>(null);
  const [newCompForm, setNewCompForm] = useState({
    compName: "HBV Primer/Probe Mix (250 µL)",
    templateType: "tube" as "tube" | "sub_box" | "outer_box",
  });

  const extraList = bundle.extra_components || [];
  const isExtraTarget = activeTarget.startsWith("extra_");
  const extraIdx = isExtraTarget ? Number(activeTarget.replace("extra_", "")) : -1;

  const currentConfig: LabelTargetConfig =
    isExtraTarget && extraList[extraIdx]
      ? extraList[extraIdx]
      : activeTarget === "sub_box"
        ? bundle.sub_box
        : activeTarget === "tube"
          ? bundle.tube
          : bundle.outer_box;

  const scale = currentConfig.width_mm <= 40 ? 6.2 : currentConfig.width_mm <= 75 ? 4.8 : 4.2;

  const updateCurrentTarget = (patch: Partial<LabelTargetConfig>) => {
    if (isExtraTarget && extraList[extraIdx]) {
      const nextExtra = [...extraList];
      nextExtra[extraIdx] = {
        ...currentConfig,
        ...patch,
      };
      onChangeBundle({
        ...bundle,
        extra_components: nextExtra,
      });
      return;
    }
    const key = (activeTarget === "sub_box" || activeTarget === "tube" ? activeTarget : "outer_box") as
      | "outer_box"
      | "sub_box"
      | "tube";
    onChangeBundle({
      ...bundle,
      [key]: {
        ...currentConfig,
        ...patch,
      },
    });
  };

  const handleAddExtraComponent = (customText?: string, baseKind: "tube" | "sub_box" | "outer_box" = "tube") => {
    const baseCfg =
      baseKind === "sub_box" ? bundle.sub_box : baseKind === "outer_box" ? bundle.outer_box : bundle.tube;
    const labelText = (customText ?? newCompForm.compName).trim() || `Thành phần #${extraList.length + 2}`;
    const clonedPos: Record<string, LabelElementPos> = {};
    for (const [k, v] of Object.entries(baseCfg.positions_json || {})) {
      clonedPos[k] = { ...v };
    }
    const newTarget: LabelTargetConfig = {
      ...baseCfg,
      name: `Nhãn: ${labelText}`,
      extra_text: labelText,
      display_fields: [...baseCfg.display_fields],
      positions_json: clonedPos,
    };
    const nextExtra = [...extraList, newTarget];
    onChangeBundle({
      ...bundle,
      extra_components: nextExtra,
    });
    setActiveTarget(`extra_${nextExtra.length - 1}`);
    setSelectedField("extra_text");
    setShowAddCompModal(false);
  };

  const handleCloneCurrentTarget = () => {
    const clonedPos: Record<string, LabelElementPos> = {};
    for (const [k, v] of Object.entries(currentConfig.positions_json || {})) {
      clonedPos[k] = { ...v };
    }
    const cloneName = `${currentConfig.extra_text || currentConfig.name} (Bản sao)`;
    const newTarget: LabelTargetConfig = {
      ...currentConfig,
      name: `Nhãn: ${cloneName}`,
      extra_text: cloneName,
      display_fields: [...currentConfig.display_fields],
      positions_json: clonedPos,
    };
    const nextExtra = [...extraList, newTarget];
    onChangeBundle({
      ...bundle,
      extra_components: nextExtra,
    });
    setActiveTarget(`extra_${nextExtra.length - 1}`);
    setSelectedField("extra_text");
  };

  const handleDeleteExtraTarget = (idx: number) => {
    const nextExtra = extraList.filter((_, i) => i !== idx);
    onChangeBundle({
      ...bundle,
      extra_components: nextExtra,
    });
    setActiveTarget("tube");
  };

  const handleSyncFromBomComponents = () => {
    const candidates: string[] = [];
    if (packagingItems.length > 0) {
      for (const pk of packagingItems) {
        if (!pk.component_name) continue;
        const vol = pk.fill_qty ? ` (${pk.fill_qty} ${pk.fill_uom || "µL"})` : "";
        candidates.push(`${pk.component_name}${vol}`);
      }
    } else if (bomLines.length > 0) {
      for (const l of bomLines) {
        if (!l.component_name) continue;
        const vol = l.qty_per_base ? ` (${l.qty_per_base} ${l.uom || ""})` : "";
        candidates.push(`${l.component_name}${vol}`);
      }
    }
    if (candidates.length === 0) {
      candidates.push(
        "qPCR MasterMix 2X (550 µL)",
        "Primer/Probe Mix (250 µL)",
        "Internal Control - IC (500 µL)",
        "Positive Control - PC (200 µL)",
        "Nuclease-Free Water (1.000 µL)"
      );
    }
    const firstTubeText = candidates[0] || bundle.tube.extra_text;
    const existingNames = new Set([firstTubeText, ...extraList.map((e) => e.extra_text)]);
    const added: LabelTargetConfig[] = [...extraList];

    for (let i = 1; i < candidates.length; i++) {
      const text = candidates[i];
      if (existingNames.has(text)) continue;
      const clonedPos: Record<string, LabelElementPos> = {};
      for (const [k, v] of Object.entries(bundle.tube.positions_json || {})) {
        clonedPos[k] = { ...v };
      }
      added.push({
        ...bundle.tube,
        name: `Nhãn Ống: ${text}`,
        extra_text: text,
        display_fields: [...bundle.tube.display_fields],
        positions_json: clonedPos,
      });
    }

    onChangeBundle({
      ...bundle,
      tube: {
        ...bundle.tube,
        extra_text: firstTubeText,
        name: `Nhãn Ống 1: ${firstTubeText}`,
      },
      extra_components: added,
    });
    if (added.length > 0) {
      setActiveTarget("extra_0");
    } else {
      setActiveTarget("tube");
    }
  };

  const updateFieldPos = (fieldId: string, patch: Partial<LabelElementPos>) => {
    const existing = currentConfig.positions_json[fieldId] || { x: 3, y: 3, fontSize: currentConfig.font_size_pt };
    updateCurrentTarget({
      positions_json: {
        ...currentConfig.positions_json,
        [fieldId]: {
          ...existing,
          ...patch,
        },
      },
    });
  };

  const toggleField = (fieldId: string) => {
    const exists = currentConfig.display_fields.includes(fieldId);
    if (exists) {
      updateCurrentTarget({
        display_fields: currentConfig.display_fields.filter((f) => f !== fieldId),
      });
      if (selectedField === fieldId) setSelectedField(null);
    } else {
      const nextY = Math.min(currentConfig.height_mm - 5, 3 + currentConfig.display_fields.length * 3.2);
      const sym = SYMBOL_OPTIONS.find((s) => s.id === fieldId);
      updateCurrentTarget({
        display_fields: [...currentConfig.display_fields, fieldId],
        positions_json: {
          ...currentConfig.positions_json,
          [fieldId]: currentConfig.positions_json[fieldId] || {
            x: sym ? Math.max(3, currentConfig.width_mm - 24) : 3.5,
            y: nextY,
            fontSize: currentConfig.font_size_pt,
            size_mm: sym?.defaultSize,
          },
        },
      });
      setSelectedField(fieldId);
    }
  };

  const addCustomTextField = () => {
    const id = `custom_text_${Date.now().toString().slice(-4)}`;
    updateCurrentTarget({
      display_fields: [...currentConfig.display_fields, id],
      positions_json: {
        ...currentConfig.positions_json,
        [id]: {
          x: 4,
          y: Math.max(4, Math.round(currentConfig.height_mm / 2)),
          fontSize: currentConfig.font_size_pt,
          bold: true,
          customText: "Chữ tùy chỉnh mới",
        },
      },
    });
    setSelectedField(id);
  };

  const applyPresetSize = (preset: (typeof LABEL_SIZE_PRESETS)[number]) => {
    const freshDefaults = buildDefaultLabelBundle(sample, isSemiFinished);
    const defaultPos =
      preset.width_mm <= 40
        ? freshDefaults.tube.positions_json
        : preset.width_mm <= 80
        ? freshDefaults.sub_box.positions_json
        : freshDefaults.outer_box.positions_json;
    updateCurrentTarget({
      name: preset.label,
      width_mm: preset.width_mm,
      height_mm: preset.height_mm,
      font_size_pt: preset.font_size_pt,
      qr_size_mm: preset.qr_size_mm,
      labels_per_row: preset.labels_per_row,
      label_gap_mm: preset.label_gap_mm,
      vertical_gap_mm: preset.vertical_gap_mm,
      positions_json: { ...defaultPos, ...currentConfig.positions_json },
    });
  };

  const resetAutoLayout = () => {
    const defaults = buildDefaultLabelBundle(sample, isSemiFinished);
    const fresh =
      activeTarget === "outer_box"
        ? defaults.outer_box
        : activeTarget === "sub_box"
          ? defaults.sub_box
          : defaults.tube;
    updateCurrentTarget({
      display_fields: fresh.display_fields,
      positions_json: fresh.positions_json,
    });
  };

  // Keyboard arrow nudge (0.5mm step)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedField) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const pos = currentConfig.positions_json[selectedField];
      if (!pos) return;
      const step = e.shiftKey ? 2 : 0.5;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        updateFieldPos(selectedField, { x: Math.max(0, Number((pos.x - step).toFixed(1))) });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        updateFieldPos(selectedField, { x: Math.min(currentConfig.width_mm - 2, Number((pos.x + step).toFixed(1))) });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        updateFieldPos(selectedField, { y: Math.max(0, Number((pos.y - step).toFixed(1))) });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        updateFieldPos(selectedField, { y: Math.min(currentConfig.height_mm - 1.5, Number((pos.y + step).toFixed(1))) });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const selectedPos: LabelElementPos | null = selectedField
    ? currentConfig.positions_json[selectedField] || { x: 3, y: 3, fontSize: currentConfig.font_size_pt }
    : null;

  const btnBase =
    "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none border";
  const btnGhost = `${btnBase} border-slate-600 bg-slate-800/90 text-slate-100 hover:bg-slate-700 hover:border-sky-400`;
  const btnPrimary = `${btnBase} border-sky-500 bg-sky-600 text-white hover:bg-sky-500 shadow-sm`;
  const btnSuccess = `${btnBase} border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm`;
  const boxInput =
    "w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white placeholder-slate-400 focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400";
  const numStepperGroup =
    "flex items-stretch w-full h-8 rounded-lg border border-slate-600 bg-slate-900 overflow-hidden focus-within:border-sky-400 focus-within:ring-1 focus-within:ring-sky-400";
  const numStepperBtnLeft =
    "w-7 shrink-0 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border-r border-slate-600 text-xs font-extrabold text-sky-300 cursor-pointer select-none";
  const numStepperBtnRight =
    "w-7 shrink-0 flex items-center justify-center bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border-l border-slate-600 text-xs font-extrabold text-sky-300 cursor-pointer select-none";
  const numStepperInput =
    "w-full min-w-0 bg-transparent px-1 text-center font-mono text-xs font-bold text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";
  const boxLabel = "block text-[11px] font-bold text-slate-300 mb-1 whitespace-nowrap truncate";
  const stepBtn =
    "px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-extrabold text-sky-300 cursor-pointer select-none";

  return (
    <div className="mt-3 rounded-2xl border border-sky-500/40 bg-slate-950/95 p-4 space-y-4 text-slate-100 shadow-xl">
      {/* Studio Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="text-sm font-extrabold text-sky-400 uppercase tracking-wide">
            🎨 STUDIO THIẾT KẾ NHÃN TRỰC QUAN (WYSIWYG ISO 15223 / IVD / BARCODE GS1)
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            Click vào bất kỳ chữ/mã QR trên tem để kéo thả trực tiếp hoặc bấm các nút mũi tên / nút <b>[-] [+]</b> bên dưới để căn chỉnh từng 0.5mm.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnGhost} onClick={() => setCleanPreviewMode((v) => !v)}>
            {cleanPreviewMode ? "📐 Bật lưới thiết kế" : "👁️ Xem bản in sạch"}
          </button>
          <button type="button" className={btnGhost} onClick={resetAutoLayout}>
            ✨ Tự dàn trang chuẩn ABT
          </button>
          <button
            type="button"
            className={btnGhost}
            onClick={() => printElementHtml(printStageRef.current, `Mẫu Nhãn: ${currentConfig.extra_text || currentConfig.name}`)}
          >
            🖨️ In thử mẫu nhãn
          </button>
          {onSave && (
            <button type="button" className={btnPrimary} disabled={busy} onClick={onSave}>
              💾 Lưu mẫu thiết kế nhãn
            </button>
          )}
        </div>
      </div>

      {/* Target Tabs + Add / Clone Component Label Controls */}
      <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-extrabold text-slate-300 uppercase">
            🏷️ Chọn mẫu nhãn thành phần cần thiết kế / chỉnh sửa:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnSuccess} onClick={() => setShowAddCompModal((v) => !v)}>
              ➕ Tạo thêm Nhãn cho Thành phần khác
            </button>
            <button
              type="button"
              className={btnGhost}
              title="Nhân bản nhanh mẫu nhãn đang chọn sang 1 tab mới để đổi tên thành phần"
              onClick={handleCloneCurrentTarget}
            >
              📋 Nhân bản nhãn đang chọn
            </button>
            <button
              type="button"
              className={btnGhost}
              title="Tự động quét danh sách Ống/Thành phần trong BOM và sinh đủ tab nhãn cho từng thành phần"
              onClick={handleSyncFromBomComponents}
            >
              ⚡ Tự tạo đủ Nhãn từ BOM
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            className={`${btnBase} ${
              activeTarget === "outer_box"
                ? "border-sky-400 bg-sky-600 text-white shadow-md ring-2 ring-sky-400/40"
                : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
            }`}
            onClick={() => {
              setActiveTarget("outer_box");
              setSelectedField("product_name");
            }}
          >
            📦 1. {isSemiFinished ? "Nhãn Chai / Can BTP" : "Nhãn Hộp Ngoài"} ({bundle.outer_box.width_mm}×{bundle.outer_box.height_mm}mm)
          </button>

          <button
            type="button"
            className={`${btnBase} ${
              activeTarget === "sub_box"
                ? "border-sky-400 bg-sky-600 text-white shadow-md ring-2 ring-sky-400/40"
                : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
            }`}
            onClick={() => {
              setActiveTarget("sub_box");
              setSelectedField("product_name");
            }}
          >
            🗂️ 2. Nhãn Hộp Thành Phần ({bundle.sub_box.width_mm}×{bundle.sub_box.height_mm}mm)
          </button>

          <button
            type="button"
            className={`${btnBase} ${
              activeTarget === "tube"
                ? "border-sky-400 bg-sky-600 text-white shadow-md ring-2 ring-sky-400/40"
                : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
            }`}
            onClick={() => {
              setActiveTarget("tube");
              setSelectedField("extra_text");
            }}
          >
            🧪 3. {bundle.tube.extra_text ? `Ống 1: ${bundle.tube.extra_text}` : "Nhãn Ống 1"} ({bundle.tube.width_mm}×{bundle.tube.height_mm}mm)
          </button>

          {extraList.map((ext, idx) => {
            const tabKey = `extra_${idx}`;
            const isAct = activeTarget === tabKey;
            return (
              <div key={tabKey} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  className={`${btnBase} ${
                    isAct
                      ? "border-emerald-400 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400/40"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800"
                  }`}
                  onClick={() => {
                    setActiveTarget(tabKey);
                    setSelectedField("extra_text");
                  }}
                >
                  🧪 {idx + 4}. {ext.extra_text || ext.name} ({ext.width_mm}×{ext.height_mm}mm)
                </button>
                <button
                  type="button"
                  title="Xóa mẫu nhãn thành phần này"
                  onClick={() => handleDeleteExtraTarget(idx)}
                  className="px-2 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-800 text-rose-300 border border-rose-700 text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Panel to Add New Component Label */}
      {showAddCompModal && (
        <div className="p-3.5 rounded-xl bg-sky-950/50 border-2 border-sky-500/70 space-y-3">
          <div className="flex items-center justify-between">
            <strong className="text-xs font-extrabold text-sky-300 uppercase">
              ➕ THÊM NHÃN CHO THÀNH PHẦN MỚI (ỐNG REAGENT / CHỨNG DƯƠNG / CHỨNG NỘI IC / BUFFER / HỘP PHỤ)
            </strong>
            <button type="button" className={btnGhost} onClick={() => setShowAddCompModal(false)}>
              Đóng
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className={boxLabel}>1. Tên thành phần &amp; Thể tích in trên nhãn *</label>
              <input
                className={boxInput}
                placeholder="VD: HBV Primer/Probe Mix (250 µL)"
                value={newCompForm.compName}
                onChange={(e) => setNewCompForm({ ...newCompForm, compName: e.target.value })}
              />
            </div>
            <div>
              <label className={boxLabel}>2. Hoặc chọn nhanh từ BOM / Gợi ý chuẩn</label>
              <select
                className={boxInput}
                value=""
                onChange={(e) => {
                  if (e.target.value) setNewCompForm({ ...newCompForm, compName: e.target.value });
                }}
              >
                <option value="">-- Chọn thành phần có sẵn --</option>
                {packagingItems.map((pk, i) => {
                  const txt = `${pk.component_name}${pk.fill_qty ? ` (${pk.fill_qty} ${pk.fill_uom || "µL"})` : ""}`;
                  return (
                    <option key={`pk-${i}`} value={txt}>
                      🧪 {txt}
                    </option>
                  );
                })}
                {bomLines.map((l, i) => {
                  const txt = `${l.component_name}${l.qty_per_base ? ` (${l.qty_per_base} ${l.uom || ""})` : ""}`;
                  return (
                    <option key={`bl-${i}`} value={txt}>
                      🧬 {txt}
                    </option>
                  );
                })}
                <option value="HBV Primer/Probe Mix (250 µL)">🧪 HBV Primer/Probe Mix (250 µL)</option>
                <option value="Internal Control - IC (500 µL)">🧪 Internal Control - IC (500 µL)</option>
                <option value="Positive Control - PC (200 µL)">🧪 Positive Control - PC (200 µL)</option>
                <option value="Negative Control - NC (500 µL)">🧪 Negative Control - NC (500 µL)</option>
                <option value="Nuclease-Free Water (1.000 µL)">🧪 Nuclease-Free Water (1.000 µL)</option>
                <option value="ROX Reference Dye (100 µL)">🧪 ROX Reference Dye (100 µL)</option>
                <option value="Proteinase K Solution (1.2 mL)">🧪 Proteinase K Solution (1.2 mL)</option>
                <option value="Lysis Buffer MLB (50 mL)">🧴 Lysis Buffer MLB (50 mL)</option>
              </select>
            </div>
            <div>
              <label className={boxLabel}>3. Loại khổ tem cơ sở</label>
              <select
                className={boxInput}
                value={newCompForm.templateType}
                onChange={(e) => setNewCompForm({ ...newCompForm, templateType: e.target.value as "tube" | "sub_box" | "outer_box" })}
              >
                <option value="tube">🧪 Nhãn Ống / Lọ ({bundle.tube.width_mm}×{bundle.tube.height_mm}mm · {bundle.tube.labels_per_row} tem/hàng)</option>
                <option value="sub_box">🗂️ Nhãn Hộp phụ / Chai vừa ({bundle.sub_box.width_mm}×{bundle.sub_box.height_mm}mm)</option>
                <option value="outer_box">📦 Nhãn Hộp lớn / Can ({bundle.outer_box.width_mm}×{bundle.outer_box.height_mm}mm)</option>
              </select>
            </div>
            <button
              type="button"
              className={btnSuccess}
              onClick={() => handleAddExtraComponent(newCompForm.compName, newCompForm.templateType)}
            >
              ✓ Tạo Nhãn Thành Phần Này
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left: Live Interactive Canvas + Element Controller */}
        <div className="lg:col-span-7 rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-extrabold text-sky-300">
              📐 Đang thiết kế: {currentConfig.extra_text || currentConfig.name} ({currentConfig.width_mm} × {currentConfig.height_mm} mm · {currentConfig.labels_per_row} tem/hàng)
            </span>
            <select
              className="rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-200"
              value=""
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (!Number.isNaN(idx) && LABEL_SIZE_PRESETS[idx]) {
                  applyPresetSize(LABEL_SIZE_PRESETS[idx]);
                }
              }}
            >
              <option value="">-- Đổi nhanh khổ giấy in tem chuẩn --</option>
              {LABEL_SIZE_PRESETS.map((p, idx) => (
                <option key={p.label} value={idx}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Canvas Stage */}
          <div
            ref={printStageRef}
            style={{
              minHeight: "230px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
              borderRadius: "10px",
              background: cleanPreviewMode ? "#f1f5f9" : "radial-gradient(circle at center, #1e293b 0%, #090d16 100%)",
              border: "1px dashed rgba(148, 163, 184, 0.35)",
              overflowX: "auto",
            }}
          >
            {cleanPreviewMode && currentConfig.labels_per_row > 1 ? (
              <div style={{ display: "flex", gap: `${currentConfig.label_gap_mm * 3.2}px`, alignItems: "center" }}>
                {Array.from({ length: currentConfig.labels_per_row }).map((_, i) => (
                  <VisualLabelCanvas
                    key={i}
                    config={currentConfig}
                    sample={sample}
                    scale={3.6}
                    interactive={false}
                    cleanPrint={true}
                  />
                ))}
              </div>
            ) : (
              <VisualLabelCanvas
                config={currentConfig}
                sample={sample}
                scale={scale}
                interactive={!cleanPreviewMode}
                selectedField={selectedField}
                onSelectField={setSelectedField}
                onUpdatePosition={(fieldId, x, y) => updateFieldPos(fieldId, { x, y })}
                cleanPrint={cleanPreviewMode}
              />
            )}
          </div>

          {/* Quick Field Selector Pills so user can click any field even without clicking canvas */}
          <div className="space-y-1">
            <div className="text-[11px] font-bold text-slate-400">
              👆 Click chọn phần tử trên tem (hoặc bấm vào nút bên dưới) để chỉnh vị trí / cỡ chữ:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {currentConfig.display_fields.map((fid) => {
                const label =
                  SYSTEM_FIELD_OPTIONS.find((f) => f.id === fid)?.label ||
                  SYMBOL_OPTIONS.find((s) => s.id === fid)?.label ||
                  fid;
                const isSel = selectedField === fid;
                return (
                  <button
                    key={fid}
                    type="button"
                    onClick={() => setSelectedField(fid)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold border cursor-pointer transition-all ${
                      isSel
                        ? "border-sky-400 bg-sky-600 text-white shadow-xs"
                        : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Element Inspector with Crisp Input Boxes & +/- Stepper Buttons */}
          {selectedField && selectedPos ? (
            <div className="p-3.5 rounded-xl bg-slate-950 border-2 border-sky-500/60 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div className="text-xs font-extrabold text-sky-300">
                  🎯 ĐANG CHỈNH PHẦN TỬ:{" "}
                  <span className="text-white underline">
                    {SYSTEM_FIELD_OPTIONS.find((f) => f.id === selectedField)?.label ||
                      SYMBOL_OPTIONS.find((s) => s.id === selectedField)?.label ||
                      selectedField}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Directional Nudge Buttons */}
                  <button
                    type="button"
                    className={stepBtn}
                    title="Sang trái 0.5mm"
                    onClick={() => updateFieldPos(selectedField, { x: Math.max(0, Number((selectedPos.x - 0.5).toFixed(1))) })}
                  >
                    ⬅️ Trái
                  </button>
                  <button
                    type="button"
                    className={stepBtn}
                    title="Lên trên 0.5mm"
                    onClick={() => updateFieldPos(selectedField, { y: Math.max(0, Number((selectedPos.y - 0.5).toFixed(1))) })}
                  >
                    ⬆️ Lên
                  </button>
                  <button
                    type="button"
                    className={stepBtn}
                    title="Xuống dưới 0.5mm"
                    onClick={() => updateFieldPos(selectedField, { y: Math.min(currentConfig.height_mm - 1, Number((selectedPos.y + 0.5).toFixed(1))) })}
                  >
                    ⬇️ Xuống
                  </button>
                  <button
                    type="button"
                    className={stepBtn}
                    title="Sang phải 0.5mm"
                    onClick={() => updateFieldPos(selectedField, { x: Math.min(currentConfig.width_mm - 1, Number((selectedPos.x + 0.5).toFixed(1))) })}
                  >
                    ➡️ Phải
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-lg bg-rose-950/90 hover:bg-rose-800 text-rose-300 border border-rose-700 text-xs font-bold cursor-pointer ml-1"
                    onClick={() => toggleField(selectedField)}
                  >
                    🗑️ Ẩn khỏi nhãn
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 items-end">
                {/* X Coordinate */}
                <div>
                  <label className={boxLabel}>Tọa độ X (mm)</label>
                  <div className={numStepperGroup}>
                    <button
                      type="button"
                      className={numStepperBtnLeft}
                      onClick={() => updateFieldPos(selectedField, { x: Math.max(0, Number((selectedPos.x - 0.5).toFixed(1))) })}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      className={numStepperInput}
                      value={selectedPos.x}
                      onChange={(e) => updateFieldPos(selectedField, { x: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      className={numStepperBtnRight}
                      onClick={() => updateFieldPos(selectedField, { x: Math.min(currentConfig.width_mm - 1, Number((selectedPos.x + 0.5).toFixed(1))) })}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Y Coordinate */}
                <div>
                  <label className={boxLabel}>Tọa độ Y (mm)</label>
                  <div className={numStepperGroup}>
                    <button
                      type="button"
                      className={numStepperBtnLeft}
                      onClick={() => updateFieldPos(selectedField, { y: Math.max(0, Number((selectedPos.y - 0.5).toFixed(1))) })}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      className={numStepperInput}
                      value={selectedPos.y}
                      onChange={(e) => updateFieldPos(selectedField, { y: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      className={numStepperBtnRight}
                      onClick={() => updateFieldPos(selectedField, { y: Math.min(currentConfig.height_mm - 1, Number((selectedPos.y + 0.5).toFixed(1))) })}
                    >
                      +
                    </button>
                  </div>
                </div>

                {selectedField.startsWith("symbol_") || selectedField === "qr_code" ? (
                  <div>
                    <label className={boxLabel}>Cỡ QR / Icon (mm)</label>
                    <div className={numStepperGroup}>
                      <button
                        type="button"
                        className={numStepperBtnLeft}
                        onClick={() =>
                          updateFieldPos(selectedField, {
                            size_mm: Math.max(3, Number(((selectedPos.size_mm ?? currentConfig.qr_size_mm) - 0.5).toFixed(1))),
                          })
                        }
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="0.5"
                        className={numStepperInput}
                        value={selectedPos.size_mm ?? currentConfig.qr_size_mm}
                        onChange={(e) => updateFieldPos(selectedField, { size_mm: Number(e.target.value) })}
                      />
                      <button
                        type="button"
                        className={numStepperBtnRight}
                        onClick={() =>
                          updateFieldPos(selectedField, {
                            size_mm: Number(((selectedPos.size_mm ?? currentConfig.qr_size_mm) + 0.5).toFixed(1)),
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : selectedField === "logo" ? (
                  <div>
                    <label className={boxLabel}>Rộng Logo (mm)</label>
                    <div className={numStepperGroup}>
                      <button
                        type="button"
                        className={numStepperBtnLeft}
                        onClick={() => updateFieldPos(selectedField, { width_mm: Math.max(5, Number(((selectedPos.width_mm ?? 16) - 0.5).toFixed(1))) })}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="0.5"
                        className={numStepperInput}
                        value={selectedPos.width_mm ?? 16}
                        onChange={(e) => updateFieldPos(selectedField, { width_mm: Number(e.target.value) })}
                      />
                      <button
                        type="button"
                        className={numStepperBtnRight}
                        onClick={() => updateFieldPos(selectedField, { width_mm: Number(((selectedPos.width_mm ?? 16) + 0.5).toFixed(1)) })}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className={boxLabel}>Cỡ chữ (pt)</label>
                    <div className={numStepperGroup}>
                      <button
                        type="button"
                        className={numStepperBtnLeft}
                        onClick={() =>
                          updateFieldPos(selectedField, {
                            fontSize: Math.max(3.5, Number(((selectedPos.fontSize ?? currentConfig.font_size_pt) - 0.5).toFixed(1))),
                          })
                        }
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="0.5"
                        className={numStepperInput}
                        value={selectedPos.fontSize ?? currentConfig.font_size_pt}
                        onChange={(e) => updateFieldPos(selectedField, { fontSize: Number(e.target.value) })}
                      />
                      <button
                        type="button"
                        className={numStepperBtnRight}
                        onClick={() =>
                          updateFieldPos(selectedField, {
                            fontSize: Number(((selectedPos.fontSize ?? currentConfig.font_size_pt) + 0.5).toFixed(1)),
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Extra controls for text style, prefix, or custom value */}
              {!selectedField.startsWith("symbol_") && selectedField !== "logo" && selectedField !== "qr_code" && (
                <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="text-[11px] font-bold text-slate-300">Định dạng chữ &amp; Tiền tố:</span>
                      <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-200 cursor-pointer whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedPos.bold)}
                          onChange={(e) => updateFieldPos(selectedField, { bold: e.target.checked })}
                        />
                        In đậm (Bold)
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-200 cursor-pointer whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedPos.hidePrefix)}
                          onChange={(e) => updateFieldPos(selectedField, { hidePrefix: e.target.checked })}
                        />
                        Ẩn tiền tố (REF/LOT)
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div>
                      <label className={boxLabel}>Tiền tố đứng trước (VD: REF:, LOT:)</label>
                      <input
                        className={boxInput}
                        placeholder="VD: REF:, LOT:, HSD:..."
                        value={selectedPos.prefix ?? SYSTEM_FIELD_OPTIONS.find((f) => f.id === selectedField)?.defaultPrefix ?? ""}
                        onChange={(e) => updateFieldPos(selectedField, { prefix: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={boxLabel}>
                        {selectedField.startsWith("custom_text_")
                          ? "Nội dung chữ cố định in trên nhãn"
                          : "Nội dung ghi đè / mô phỏng (Để trống = Tự lấy từ Lệnh SX / BOM)"}
                      </label>
                      <input
                        className={boxInput}
                        placeholder="Để trống để hệ thống tự điền theo Lệnh SX, hoặc nhập chữ cố định tại đây"
                        value={selectedField.startsWith("custom_text_") ? selectedPos.customText || "" : selectedPos.simText || ""}
                        onChange={(e) =>
                          updateFieldPos(
                            selectedField,
                            selectedField.startsWith("custom_text_") ? { customText: e.target.value } : { simText: e.target.value }
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedField.startsWith("symbol_temp") && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs font-bold text-slate-300">Chọn nhanh dải nhiệt độ trên biểu tượng:</span>
                  {[
                    { label: "-20°C", min: "", max: "-20°C" },
                    { label: "2°C...8°C", min: "2°C", max: "8°C" },
                    { label: "15°C...25°C", min: "15°C", max: "25°C" },
                    { label: "15°C...30°C", min: "15°C", max: "30°C" },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className={btnGhost}
                      onClick={() => updateFieldPos(selectedField, { tempMin: preset.min, tempMax: preset.max })}
                    >
                      🌡️ {preset.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-400 text-center">
              👆 Hãy click vào một dòng chữ hoặc mã QR trên tem nhãn phía trên để hiện bảng nút chỉnh vị trí &amp; cỡ chữ.
            </div>
          )}
        </div>

        {/* Right: Dimensions, Component Name, Fields & ISO/GHS Symbol Palette */}
        <div className="lg:col-span-5 space-y-3">
          {/* Card 1: Dimensions & Component Name */}
          <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 space-y-3">
            <div className="text-xs font-extrabold text-sky-400 uppercase">
              1. Tên Thành Phần &amp; Kích Thước Khổ Giấy In Tem
            </div>

            <div>
              <label className={boxLabel}>
                🧪 Tên thành phần / Dòng chú thích in trên nhãn này:
              </label>
              <input
                className={boxInput}
                placeholder="VD: qPCR MasterMix 2X (550 µL) hoặc HBV Primer/Probe Mix (250 µL)"
                value={currentConfig.extra_text}
                onChange={(e) => updateCurrentTarget({ extra_text: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5 items-end">
              <div>
                <label className={boxLabel}>Chiều rộng (mm)</label>
                <div className={numStepperGroup}>
                  <button
                    type="button"
                    className={numStepperBtnLeft}
                    onClick={() => updateCurrentTarget({ width_mm: Math.max(15, currentConfig.width_mm - 1) })}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    className={numStepperInput}
                    value={currentConfig.width_mm}
                    onChange={(e) => updateCurrentTarget({ width_mm: Math.max(15, Number(e.target.value) || 50) })}
                  />
                  <button
                    type="button"
                    className={numStepperBtnRight}
                    onClick={() => updateCurrentTarget({ width_mm: currentConfig.width_mm + 1 })}
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <label className={boxLabel}>Chiều cao (mm)</label>
                <div className={numStepperGroup}>
                  <button
                    type="button"
                    className={numStepperBtnLeft}
                    onClick={() => updateCurrentTarget({ height_mm: Math.max(10, currentConfig.height_mm - 1) })}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    className={numStepperInput}
                    value={currentConfig.height_mm}
                    onChange={(e) => updateCurrentTarget({ height_mm: Math.max(10, Number(e.target.value) || 25) })}
                  />
                  <button
                    type="button"
                    className={numStepperBtnRight}
                    onClick={() => updateCurrentTarget({ height_mm: currentConfig.height_mm + 1 })}
                  >
                    +
                  </button>
                </div>
              </div>
              <div>
                <label className={boxLabel}>Số tem / hàng</label>
                <div className={numStepperGroup}>
                  <button
                    type="button"
                    className={numStepperBtnLeft}
                    onClick={() => updateCurrentTarget({ labels_per_row: Math.max(1, currentConfig.labels_per_row - 1) })}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    className={numStepperInput}
                    value={currentConfig.labels_per_row}
                    onChange={(e) => updateCurrentTarget({ labels_per_row: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <button
                    type="button"
                    className={numStepperBtnRight}
                    onClick={() => updateCurrentTarget({ labels_per_row: Math.min(5, currentConfig.labels_per_row + 1) })}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div>
                <label className={boxLabel}>Chuẩn Mã vạch trên tem</label>
                <select
                  className={boxInput}
                  value={currentConfig.barcode_type}
                  onChange={(e) => updateCurrentTarget({ barcode_type: e.target.value as LabelTargetConfig["barcode_type"] })}
                >
                  <option value="QR_2D">QR Code 2D</option>
                  <option value="GS1_DATAMATRIX">GS1 DataMatrix (UDI)</option>
                  <option value="CODE_128">Barcode 1D (Code-128)</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <label className={btnGhost}>
                  🖼️ Tải ảnh nền
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const reader = new FileReader();
                      reader.onload = () => updateCurrentTarget({ artwork_bg_url: String(reader.result || "") });
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>
                <button type="button" className={btnGhost} onClick={addCustomTextField}>
                  + Thêm chữ tùy ý
                </button>
                {currentConfig.artwork_bg_url && (
                  <button
                    type="button"
                    className="px-2.5 py-1.5 rounded-lg bg-rose-950 text-rose-300 border border-rose-700 text-xs font-bold cursor-pointer"
                    onClick={() => updateCurrentTarget({ artwork_bg_url: null })}
                  >
                    ✕ Xóa nền
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: System Data Fields Toggle */}
          <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 space-y-2.5">
            <div className="text-xs font-extrabold text-sky-400 uppercase">
              2. Các trường dữ liệu truy xuất tự động (Tick để Hiện/Ẩn trên nhãn)
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {SYSTEM_FIELD_OPTIONS.map((f) => {
                const active = currentConfig.display_fields.includes(f.id);
                return (
                  <label
                    key={f.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border transition-all ${
                      active
                        ? "border-sky-500/60 bg-sky-950/60 text-sky-100"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <input type="checkbox" checked={active} onChange={() => toggleField(f.id)} />
                    <span className="truncate">{f.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Card 3: ISO 15223 / GHS Symbols Palette */}
          <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-3.5 space-y-2.5">
            <div className="text-xs font-extrabold text-emerald-400 uppercase">
              3. Thư viện 18 Biểu tượng ISO 15223 / IVD / GHS Quốc tế
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
              {SYMBOL_OPTIONS.map((sym) => {
                const active = currentConfig.display_fields.includes(sym.id);
                return (
                  <label
                    key={sym.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer border transition-all ${
                      active
                        ? "border-emerald-500/60 bg-emerald-950/60 text-emerald-100"
                        : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <input type="checkbox" checked={active} onChange={() => toggleField(sym.id)} />
                    <span className="truncate">{sym.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
