"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { api, ApiError, fmtDate } from "../api";
import { Button, Card, ErrorNote, Field, inputClass, StatusBadge, Table } from "../ui";
import { printOrderCoa } from "../coa";
import { OrderDeliverySection } from "./DeliveryView";
import { LabelPreview } from "./LabelPreview";
import { FORMAT, ORDER_STATUS, PRODUCT, PURIFICATION, SEQ_STATUS, useScales } from "./shared";

interface PriceLine {
  key: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  unit_price: number;
  amount: number;
}
interface Seq {
  id: string; code: string; name: string; normalized_sequence: string; base_count: number; molecule_type: string; product_type: string; scale_code: string;
  purification: string; format: string; mw: number; tm: number; nmol_per_od: number; ug_per_od: number; ext_coeff_260: number; gc_percent: number;
  raw_sequence: string; modifications: string[]; warnings: string[]; status: string;
  oligo_role?: string | null; target_pathogen?: string | null;
  unit_price?: number; price?: number; price_lines_json?: PriceLine[];
  relation: string | null; pool_master_code: string | null; version: number;
}
interface OrderDetail {
  id: string; code: string; org_unit_id: string; status: string; customer_label: string | null;
  due_date: string | null; initial_due_date?: string | null; due_date_change_count?: number;
  notes: string | null; internal_order_notes?: string | null;
  pricing_type?: string; price_percentage?: number; vat_rate?: number; total_price?: number;
  internal_order_id?: string | null; kd_po_code: string | null; internal_order_code: string | null; requested_date?: string | null;
  sequences: Seq[];
}

/** Parameter table of an order as CSV (Excel opens it through the BOM), for the customer or the COA. */
function exportCsv(o: OrderDetail) {
  const head = ["Mã", "Tên", "Trình tự 5'-3'", "Số base", "Loại", "Thang", "Tinh sạch", "Dạng", "MW (Da)", "Tm (°C)", "GC %", "ε260 (L/mol·cm)", "nmol/OD", "µg/OD", "Modification"];
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = o.sequences
    .filter((s) => s.status !== "CANCELLED")
    .map((s) => [s.code, s.name, s.normalized_sequence, s.base_count, s.molecule_type, s.scale_code, s.purification, s.format, s.mw, s.tm, s.gc_percent, s.ext_coeff_260, s.nmol_per_od, s.ug_per_od, s.modifications.join(" ")].map(q).join(","));
  const blob = new Blob(["﻿" + [head.map(q).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${o.code}-thong-so.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Xuất file Excel (.csv UTF-8 BOM) Bảng kê xuất hóa đơn VAT & Phụ lục chi tiết trình tự Oligo */
function exportOligoInvoiceCsv(
  o: OrderDetail,
  lines: PriceLine[],
  subtotalVnd: number,
  vatRate: number,
  vatAmountVnd: number,
  grandTotalVnd: number
) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const activeSeqs = o.sequences.filter((s) => s.status !== "CANCELLED" && s.status !== "SPLIT");
  const csvLines: string[] = [
    [q("BẢNG KÊ YÊU CẦU XUẤT HÓA ĐƠN GTGT (VAT) — ĐƠN HÀNG TỔNG HỢP OLIGO")].join(","),
    [q("Mã đơn Oligo"), q(o.code), q("PO Kinh doanh"), q(o.kd_po_code || "—"), q("Đơn nội bộ"), q(o.internal_order_code || "—")].join(","),
    [q("Khách hàng"), q(o.customer_label || "—"), q("Ngày giao cam kết"), q(o.due_date ? o.due_date.slice(0, 10) : "—")].join(","),
    "",
    [q("PHẦN I: BẢNG TỔNG HỢP MÃ HÀNG HÓA XUẤT HÓA ĐƠN ĐIỆN TỬ VAT (DÀNH CHO KẾ TOÁN)")].join(","),
    ["STT", "Mã hàng hóa đơn", "Tên hạng mục trên hóa đơn", "ĐVT", "Tổng SL", "Đơn giá trước thuế (VNĐ)", "Thành tiền trước thuế (VNĐ)"].map(q).join(","),
    ...lines.map((l, idx) =>
      [idx + 1, l.code, l.name, l.unit, l.qty, Number(l.unit_price) || 0, Number(l.amount) || 0].map(q).join(",")
    ),
    ["", "", "Cộng tiền hàng (Trước VAT)", "", "", "", subtotalVnd].map(q).join(","),
    ["", "", `Tiền thuế GTGT (VAT ${vatRate}%)`, "", "", "", vatAmountVnd].map(q).join(","),
    ["", "", "TỔNG CỘNG THANH TOÁN (SAU VAT)", "", "", "", grandTotalVnd].map(q).join(","),
    "",
    [q("PHẦN II: PHỤ LỤC BẢNG KÊ CHI TIẾT TRÌNH TỰ OLIGO ĐÍNH KÈM HÓA ĐƠN")].join(","),
    ["STT", "Mã trình tự", "Tên Mồi / Probe", "Trình tự 5'-3'", "Số Base (bp)", "Thang tổng hợp", "Biến đổi (Modification)", "Tinh sạch", "Định dạng", "Đơn giá / Base", "Thành tiền trước VAT (VNĐ)"].map(q).join(","),
    ...activeSeqs.map((s, idx) =>
      [
        idx + 1,
        s.code,
        s.name,
        s.normalized_sequence,
        s.base_count,
        s.scale_code,
        s.modifications.join(" / ") || "Không",
        s.purification,
        s.format,
        Number(s.unit_price ?? 0),
        Number(s.price ?? 0),
      ]
        .map(q)
        .join(",")
    ),
  ];
  const blob = new Blob(["\uFEFF" + csvLines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${o.code}-bang-ke-xuat-hoa-don-oligo.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** In Bảng kê xuất hóa đơn VAT & Phụ lục trình tự Oligo chuẩn A4 */
function printOligoInvoiceSchedule(
  o: OrderDetail,
  lines: PriceLine[],
  subtotalVnd: number,
  vatRate: number,
  vatAmountVnd: number,
  grandTotalVnd: number
) {
  const esc = (v: unknown) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const activeSeqs = o.sequences.filter((s) => s.status !== "CANCELLED" && s.status !== "SPLIT");
  const pricingModeLabel =
    o.pricing_type === "percentage"
      ? `Giá Dealer (${o.price_percentage ?? 100}%)`
      : o.pricing_type === "custom"
      ? "Đơn giá tự do"
      : o.pricing_type === "demo"
      ? "Đơn Demo (0 VNĐ)"
      : "Giá End (100% bảng giá chuẩn)";

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Bảng kê xuất hóa đơn Oligo - ${esc(o.code)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 12px; line-height: 1.45; margin: 0; padding: 16px; }
    .toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
    .btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #0284c7; background: #0284c7; color: #fff; font-weight: 700; cursor: pointer; font-size: 12px; }
    .Header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
    h1 { font-size: 16px; margin: 0 0 4px 0; text-transform: uppercase; color: #0f172a; }
    h2 { font-size: 13px; margin: 14px 0 6px 0; text-transform: uppercase; color: #0369a1; border-left: 4px solid #0284c7; padding-left: 8px; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 700; font-size: 11px; text-transform: uppercase; }
    .num { text-align: right; font-family: Consolas, monospace; }
    .mono { font-family: Consolas, monospace; word-break: break-all; }
    .total-row td { font-weight: 700; background: #f8fafc; }
    .grand-row td { font-weight: 800; background: #ecfdf5; color: #065f46; font-size: 13px; }
    .sig-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; text-align: center; }
    @media print { .toolbar { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn" onclick="window.print()">🖨️ In Bảng Kê Hóa Đơn (A4 / PDF)</button>
  </div>
  <div class="Header">
    <div>
      <div style="font-weight:800;font-size:13px;color:#0369a1;">CÔNG TY TNHH GIẢI PHÁP Y SINH ABT (ABT BIOLAB)</div>
      <div style="font-size:11px;color:#475569;">Phân hệ Sản xuất &amp; Tổng hợp Oligo — Chứng từ phối hợp Kinh doanh &amp; Kế toán</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:800;font-family:Consolas,monospace;font-size:13px;">Mã đơn: ${esc(o.code)}</div>
      <div style="font-size:11px;color:#475569;">Ngày in: ${new Date().toLocaleDateString("vi-VN")}</div>
    </div>
  </div>

  <div style="text-align:center;margin-bottom:12px;">
    <h1>PHIẾU YÊU CẦU &amp; BẢNG KÊ XUẤT HÓA ĐƠN GTGT (VAT) ĐƠN HÀNG OLIGO</h1>
    <div style="font-size:11px;color:#475569;">(Đính kèm Đơn hàng Kinh doanh PO: <b>${esc(o.kd_po_code || "—")}</b> · Đơn nội bộ: <b>${esc(o.internal_order_code || "—")}</b>)</div>
  </div>

  <div class="meta-grid">
    <div><b>Khách hàng / Đơn vị:</b> ${esc(o.customer_label || "—")}</div>
    <div><b>Mã PO Kinh doanh:</b> <span class="mono">${esc(o.kd_po_code || "—")}</span></div>
    <div><b>Mã Đơn nội bộ:</b> <span class="mono">${esc(o.internal_order_code || "—")}</span></div>
    <div><b>Chế độ tính giá:</b> ${esc(pricingModeLabel)}</div>
    <div><b>Tổng số trình tự:</b> <b>${activeSeqs.length}</b> trình tự</div>
    <div><b>Hạn giao cam kết:</b> ${esc(o.due_date ? o.due_date.slice(0, 10) : "—")}</div>
    <div style="grid-column: span 3;"><b>Ghi chú đơn hàng / Yêu cầu hóa đơn:</b> ${esc(o.notes || o.internal_order_notes || "Xuất hóa đơn theo bảng kê mã chuẩn đính kèm")}</div>
  </div>

  <h2>Phần I. Bảng Tổng Hợp Mã Hàng Hóa Xuất Hóa Đơn Điện Tử VAT (Dành cho Kế toán)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:36px;text-align:center;">STT</th>
        <th style="width:125px;">Mã Hàng Hóa Đơn</th>
        <th>Tên Hàng Hóa / Dịch Vụ Kê Khai Trên Hóa Đơn GTGT</th>
        <th style="width:55px;text-align:center;">ĐVT</th>
        <th style="width:70px;" class="num">Tổng SL</th>
        <th style="width:105px;" class="num">Đơn giá (VNĐ)</th>
        <th style="width:120px;" class="num">Thành tiền (VNĐ)</th>
      </tr>
    </thead>
    <tbody>
      ${
        lines.length > 0
          ? lines
              .map(
                (l, i) => `<tr>
          <td style="text-align:center;">${i + 1}</td>
          <td class="mono"><b>${esc(l.code)}</b></td>
          <td>${esc(l.name)}</td>
          <td style="text-align:center;">${esc(l.unit)}</td>
          <td class="num">${Number(l.qty).toLocaleString("vi-VN")}</td>
          <td class="num">${Number(l.unit_price).toLocaleString("vi-VN")}</td>
          <td class="num"><b>${Number(l.amount).toLocaleString("vi-VN")}</b></td>
        </tr>`
              )
              .join("")
          : `<tr><td colspan="7" style="text-align:center;color:#64748b;">Chưa có dòng hạng mục hóa đơn</td></tr>`
      }
      <tr class="total-row">
        <td colspan="6" style="text-align:right;">Cộng tiền hàng (Trước thuế GTGT):</td>
        <td class="num">${subtotalVnd.toLocaleString("vi-VN")} đ</td>
      </tr>
      <tr class="total-row">
        <td colspan="6" style="text-align:right;">Thuế suất GTGT (VAT ${vatRate}%):</td>
        <td class="num">${vatAmountVnd.toLocaleString("vi-VN")} đ</td>
      </tr>
      <tr class="grand-row">
        <td colspan="6" style="text-align:right;">TỔNG CỘNG THANH TOÁN (ĐÃ GỒM VAT):</td>
        <td class="num">${grandTotalVnd.toLocaleString("vi-VN")} VNĐ</td>
      </tr>
    </tbody>
  </table>

  <h2>Phần II. Phụ Lục Bảng Kê Chi Tiết Trình Tự Oligo Đính Kèm Hóa Đơn (${activeSeqs.length} trình tự)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:30px;text-align:center;">#</th>
        <th style="width:85px;">Mã chuỗi</th>
        <th style="width:120px;">Tên Mồi / Probe</th>
        <th>Trình tự Nucleotide (5' → 3')</th>
        <th style="width:48px;" class="num">Base</th>
        <th style="width:70px;">Thang</th>
        <th style="width:110px;">Modification / Tinh sạch</th>
        <th style="width:95px;" class="num">Thành tiền</th>
      </tr>
    </thead>
    <tbody>
      ${activeSeqs
        .map(
          (s, idx) => `<tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td class="mono">${esc(s.code)}</td>
        <td><b>${esc(s.name)}</b></td>
        <td class="mono" style="font-size:10.5px;">${esc(s.normalized_sequence)}</td>
        <td class="num">${s.base_count}</td>
        <td class="mono">${esc(s.scale_code)}</td>
        <td style="font-size:11px;">${esc(s.modifications.length ? s.modifications.join(", ") + " · " : "")}${esc(s.purification)} (${esc(s.format)})</td>
        <td class="num"><b>${Number(s.price ?? 0).toLocaleString("vi-VN")}</b></td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>

  <div class="sig-grid">
    <div>
      <b>NGƯỜI LẬP BẢNG KÊ</b>
      <div style="font-size:10px;color:#64748b;margin-bottom:48px;">(Ký, ghi rõ họ tên)</div>
    </div>
    <div>
      <b>PHÒNG KINH DOANH ĐỐI SOÁT</b>
      <div style="font-size:10px;color:#64748b;margin-bottom:48px;">(Ký, ghi rõ họ tên)</div>
    </div>
    <div>
      <b>KẾ TOÁN XUẤT HÓA ĐƠN</b>
      <div style="font-size:10px;color:#64748b;margin-bottom:48px;">(Ký, ghi rõ số HĐ &amp; ngày xuất)</div>
    </div>
  </div>
</body>
</html>`;

  const w = window.open("", "_blank", "width=980,height=820");
  if (!w) {
    window.alert("Trình duyệt đã chặn cửa sổ bật lên (Pop-up). Vui lòng cho phép mở cửa sổ để in Bảng kê.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export interface ParsedOligoExcelRow {
  name: string;
  sequence: string;
  scale_code: string;
  purification: string;
  format: string;
  role?: string;
  target_pathogen?: string;
}

/** Tải file Excel mẫu (.xlsx) chuẩn cho phép nhập trình tự Primer / Probe / Amplicon */
export function downloadOligoSequenceExcelTemplate(filename = "Mau_Nhap_Trinh_Tu_Oligo_ABT.xlsx") {
  const sampleRows = [
    {
      "Tên trình tự": "HBV-F2",
      "Trình tự 5'-3'": "GAGTGTGGATTCGCACTCCT",
      "Thang tổng hợp": "200NMOL",
      "Tinh sạch": "OPC",
      "Định dạng": "LYOPHILIZED",
      "Phân loại": "PRIMER",
      "Tác nhân đích": "HBV",
    },
    {
      "Tên trình tự": "HBV-R2",
      "Trình tự 5'-3'": "GAGGAGTTGGGGGAGGAGATT",
      "Thang tổng hợp": "200NMOL",
      "Tinh sạch": "OPC",
      "Định dạng": "LYOPHILIZED",
      "Phân loại": "PRIMER",
      "Tác nhân đích": "HBV",
    },
    {
      "Tên trình tự": "HBV-PRB2",
      "Trình tự 5'-3'": "[FAM]CCAYTCRTCCBGCRGGBTR[BHQ1]",
      "Thang tổng hợp": "200NMOL",
      "Tinh sạch": "HPLC",
      "Định dạng": "LYOPHILIZED",
      "Phân loại": "PROBE",
      "Tác nhân đích": "HBV",
    },
    {
      "Tên trình tự": "HBV-Amplicon-PC",
      "Trình tự 5'-3'":
        "GAGTGTGGATTCGCACTCCTCCTGCCTCCACCAATCGCCAGTCAGGAAGGCAGCCTACCCCGCTGTCTCCACCTTTGAGAAACACTCATCCTCAGGCCATGCAGTGGAATTCCACAACCTTCCACCAAACTCTGCAAGATCCCAGAGTGAGAGGCCTGTATTTCCCTGCTGGTGGCTCCAGTTCAGGAACAGTAAACCCTGTTCTGACTACTGCCTCTCCCTTATCGTCAATCTTCTCGAGGATTGGGGACCCTGCGCTGAACATGGAGAACATCACATCAGGATTCCTAGGACCCCTTCTCGTGTTACAGGCGGGGTTTTTCTTGTTGACAAGAATCCTCACAATACCGCAGAGTCTAGACTCGTGGTGGACTTCTCTCAATTTTCTAGGGGG",
      "Thang tổng hợp": "200NMOL",
      "Tinh sạch": "PAGE",
      "Định dạng": "LYOPHILIZED",
      "Phân loại": "TEMPLATE",
      "Tác nhân đích": "HBV",
    },
  ];

  const guideRows = [
    { "Cột thông tin": "Tên trình tự", "Bắt buộc": "Khuyến nghị", "Giá trị hợp lệ / Ghi chú": "Tên Primer / Probe / Amplicon (VD: HBV-F2, DEN1-PRB, SARS2-PC)" },
    { "Cột thông tin": "Trình tự 5'-3'", "Bắt buộc": "Bắt buộc *", "Giá trị hợp lệ / Ghi chú": "Chuỗi nucleotide 5'->3' (A, C, G, T, U, base suy biến IUPAC). Hỗ trợ biến đổi huỳnh quang [FAM]...[BHQ1], [HEX], [ROX], [CY5], [VIC] hoặc /FAM/.../BHQ1/" },
    { "Cột thông tin": "Thang tổng hợp", "Bắt buộc": "Tùy chọn", "Giá trị hợp lệ / Ghi chú": "25NMOL, 50NMOL, 100NMOL, 200NMOL, 1000NMOL (Nếu để trống sẽ lấy theo Thang mặc định trên màn hình)" },
    { "Cột thông tin": "Tinh sạch", "Bắt buộc": "Tùy chọn", "Giá trị hợp lệ / Ghi chú": "DESALT, OPC, HPLC, PAGE (Nếu để trống sẽ lấy theo Tinh sạch mặc định)" },
    { "Cột thông tin": "Định dạng", "Bắt buộc": "Tùy chọn", "Giá trị hợp lệ / Ghi chú": "LYOPHILIZED (Đông khô) hoặc LIQUID (Dung dịch)" },
    { "Cột thông tin": "Phân loại", "Bắt buộc": "Tùy chọn", "Giá trị hợp lệ / Ghi chú": "PRIMER, PROBE, TEMPLATE (Amplicon/Chứng dương). Nếu để trống hệ thống tự nhận diện theo độ dài & huỳnh quang" },
    { "Cột thông tin": "Tác nhân đích", "Bắt buộc": "Tùy chọn", "Giá trị hợp lệ / Ghi chú": "Tên tác nhân đích (VD: HBV, HCV, Dengue, SARS-CoV-2...)" },
  ];

  const wb = XLSX.utils.book_new();
  const wsData = XLSX.utils.json_to_sheet(sampleRows);
  wsData["!cols"] = [
    { wch: 20 },
    { wch: 52 },
    { wch: 15 },
    { wch: 12 },
    { wch: 15 },
    { wch: 14 },
    { wch: 16 },
  ];
  const wsGuide = XLSX.utils.json_to_sheet(guideRows);
  wsGuide["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 90 }];

  XLSX.utils.book_append_sheet(wb, wsData, "Danh_sach_Trinh_tu");
  XLSX.utils.book_append_sheet(wb, wsGuide, "Huong_dan_nhap");
  XLSX.writeFile(wb, filename);
}

/** Đọc file Excel (.xlsx / .xls / .csv) và chuyển thành danh sách trình tự Oligo */
export async function parseOligoSequenceExcelFile(
  file: File,
  defaults: { scale_code?: string; purification?: string; format?: string } = {}
): Promise<{ rows: ParsedOligoExcelRow[]; text: string }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return { rows: [], text: "" };
  const sheet = wb.Sheets[firstSheetName];
  const rawMatrix = XLSX.utils.sheet_to_json< unknown[] >(sheet, { header: 1, defval: "" });
  if (!rawMatrix.length) return { rows: [], text: "" };

  const normHeader = (s: unknown) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const firstRow = (rawMatrix[0] ?? []).map(normHeader);
  const hasHeader = firstRow.some(
    (h) =>
      h.includes("trinh tu") ||
      h.includes("sequence") ||
      h.includes("chuoi") ||
      h.includes("ten") ||
      h.includes("name") ||
      h.includes("primer")
  );

  const findCol = (predicates: string[], fallbackIdx: number) => {
    if (!hasHeader) return fallbackIdx;
    const idx = firstRow.findIndex((h) => predicates.some((p) => h.includes(p)));
    return idx >= 0 ? idx : fallbackIdx;
  };

  const nameCol = findCol(["ten", "name", "ma", "primer", "oligo"], 0);
  const seqCol = findCol(["trinh tu", "sequence", "chuoi", "5'-3'", "5-3", "seq"], 1);
  const scaleCol = findCol(["thang", "scale", "nmol"], 2);
  const purCol = findCol(["tinh sach", "purif", "hplc", "opc", "desalt"], 3);
  const fmtCol = findCol(["dinh dang", "format", "dang"], 4);
  const roleCol = findCol(["phan loai", "role", "loai", "type"], 5);
  const targetCol = findCol(["tac nhan", "target", "pathogen", "dich"], 6);

  const dataRows = hasHeader ? rawMatrix.slice(1) : rawMatrix;
  const rows: ParsedOligoExcelRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i] ?? [];
    const rawSeq = String(r[seqCol] ?? "").trim();
    const rawName = String(r[nameCol] ?? "").trim();
    if (!rawSeq && !rawName) continue;
    // Nếu chỉ có 1 cột chứa chuỗi
    const sequence = rawSeq || rawName;
    if (!sequence) continue;
    const name = rawSeq ? rawName || `Oligo-${rows.length + 1}` : `Oligo-${rows.length + 1}`;

    const rawScale = String(r[scaleCol] ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const scale_code = rawScale || defaults.scale_code || "200NMOL";

    const rawPur = String(r[purCol] ?? "").trim().toUpperCase();
    const purification = ["DESALT", "OPC", "HPLC", "PAGE"].includes(rawPur)
      ? rawPur
      : defaults.purification || "OPC";

    const rawFmt = String(r[fmtCol] ?? "").trim().toUpperCase();
    const format =
      rawFmt === "LIQUID" || rawFmt.includes("DUNG DICH") || rawFmt.includes("DUNG DỊCH")
        ? "LIQUID"
        : defaults.format || "LYOPHILIZED";

    const role = String(r[roleCol] ?? "").trim().toUpperCase() || undefined;
    const target_pathogen = String(r[targetCol] ?? "").trim() || undefined;

    rows.push({
      name,
      sequence,
      scale_code,
      purification,
      format,
      role,
      target_pathogen,
    });
  }

  const text = rows
    .map((r) => {
      const baseCols = [r.name, r.sequence, r.scale_code, r.purification, r.format];
      if (r.role || r.target_pathogen) {
        baseCols.push(r.role || "", r.target_pathogen || "");
      }
      return baseCols.join("; ");
    })
    .join("\n");

  return { rows, text };
}

function AddSequences({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const scales = useScales();
  const [text, setText] = useState("");
  const [excelNotice, setExcelNotice] = useState<string | null>(null);
  const [d, setD] = useState({ scale_code: "200NMOL", purification: "OPC", format: "LYOPHILIZED" });
  const add = useMutation({
    mutationFn: () => api(`/api/factory/oligo/orders/${orderId}/sequences`, { method: "POST", idempotent: true, json: { text, defaults: d } }),
    onSuccess: () => {
      setText("");
      setExcelNotice(null);
      onDone();
    },
  });
  const lineErrors = add.error instanceof ApiError && Array.isArray(add.error.details) ? (add.error.details as { line: number; message: string }[]) : [];

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = await parseOligoSequenceExcelFile(file, d);
      if (parsed.rows.length === 0) {
        window.alert("Không tìm thấy dòng trình tự hợp lệ nào trong file Excel.");
        return;
      }
      setText((prev) => (prev.trim() ? `${prev.trim()}\n${parsed.text}` : parsed.text));
      setExcelNotice(`✅ Đã đọc ${parsed.rows.length} trình tự từ file "${file.name}". Kiểm tra nội dung bên dưới và bấm "Lưu & Thêm trình tự" để hoàn tất.`);
    } catch (err: any) {
      window.alert(`Lỗi đọc file Excel: ${err?.message || "Định dạng file không hợp lệ"}`);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 p-3.5 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-extrabold text-purple-950 dark:text-purple-200">
            🧬 Nhập Danh Sách Trình Tự Oligo (Nhập tay hoặc Nhập từ File Excel)
          </div>
          <div className="text-[11px] text-slate-500">
            Mỗi dòng: <code>Tên; Trình tự 5&apos;-3&apos;; Thang; Tinh sạch; Định dạng</code> (chỉ trình tự là bắt buộc, cột thiếu lấy mặc định).
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => downloadOligoSequenceExcelTemplate()}
            className="px-2.5 py-1.5 rounded-xl border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-900 hover:bg-emerald-50 text-emerald-800 dark:text-emerald-300 font-bold text-xs cursor-pointer shadow-2xs"
          >
            📥 Tải file Excel mẫu (.xlsx)
          </button>
          <label className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer shadow-2xs inline-flex items-center gap-1">
            <span>📤 Nhập trình tự từ file Excel (.xlsx / .csv)</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleExcelUpload}
            />
          </label>
        </div>
      </div>

      {excelNotice && (
        <div className="px-3 py-1.5 rounded-lg bg-emerald-100/90 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs font-semibold flex items-center justify-between gap-2">
          <span>{excelNotice}</span>
          <button type="button" onClick={() => setExcelNotice(null)} className="text-emerald-700 hover:underline text-[11px] cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Thang mặc định">
          <select className={inputClass} value={d.scale_code} onChange={(e) => setD({ ...d, scale_code: e.target.value })}>
            {scales.data?.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Tinh sạch mặc định">
          <select className={inputClass} value={d.purification} onChange={(e) => setD({ ...d, purification: e.target.value })}>
            {Object.entries(PURIFICATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Định dạng mặc định">
          <select className={inputClass} value={d.format} onChange={(e) => setD({ ...d, format: e.target.value })}>
            {Object.entries(FORMAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <textarea
        className="w-full min-h-28 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Primer F; ATGCTTTAGCAGGACAGTC\nProbe; /FAM/ATGCTTTAGCAGGAC/BHQ1/; 200NMOL; HPLC"}
        spellCheck={false}
      />
      {lineErrors.length > 0 ? (
        <ul className="text-xs text-rose-600 list-disc pl-4">{lineErrors.map((e) => <li key={e.line}>Dòng {e.line}: {e.message}</li>)}</ul>
      ) : (
        <ErrorNote error={add.error} />
      )}
      <div className="flex items-center justify-end gap-2">
        {text.trim() && (
          <Button variant="ghost" onClick={() => { setText(""); setExcelNotice(null); }}>
            Xóa nội dung đang nhập
          </Button>
        )}
        <Button onClick={() => add.mutate()} disabled={add.isPending || !text.trim()}>
          {add.isPending ? "Đang lưu…" : "💾 Lưu & Thêm trình tự vào đơn"}
        </Button>
      </div>
    </div>
  );
}

export function OligoOrderPanel({
  id,
  canDeliver = false,
  onClose,
  titleOverride,
  headerBanner,
  footerSlot,
}: {
  id: string;
  canDeliver?: boolean;
  onClose: () => void;
  titleOverride?: string;
  headerBanner?: React.ReactNode;
  footerSlot?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const scales = useScales();
  const [showAddSeq, setShowAddSeq] = useState(false);
  const [labelsFor, setLabelsFor] = useState<string[] | null>(null);

  // State cho Sửa Ghi Chú, Đổi Ngày Giao (Có Cảnh Báo) và Liên Kết Đơn Nội Bộ
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");
  const [dateChangeReason, setDateChangeReason] = useState("");
  const [confirmDateWarning, setConfirmDateWarning] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const [selectedIoId, setSelectedIoId] = useState("");
  const [editingPricing, setEditingPricing] = useState(false);
  const [pricingDraft, setPricingDraft] = useState({
    pricing_type: "auto",
    price_percentage: "100",
    custom_unit_price: "0",
    vat_rate: "8",
  });

  const order = useQuery({ queryKey: ["factory", "oligo-order", id], queryFn: () => api<OrderDetail>(`/api/factory/oligo/orders/${id}`) });
  const intakeOptions = useQuery({
    queryKey: ["factory", "oligo-intake-options"],
    queryFn: () =>
      api<{ id: string; code: string; name: string; internal_orders: { id: string; code: string; kd_po_code: string; committed_date: string | null }[] }[]>(
        "/api/factory/oligo/intake-options"
      ),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["factory", "oligo-order", id] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo-orders"] });
    qc.invalidateQueries({ queryKey: ["factory", "oligo-delivery", id] });
    qc.invalidateQueries({ queryKey: ["factory", "internal-orders"] });
  };
  const act = useMutation({ mutationFn: (f: () => Promise<unknown>) => f(), onSuccess: refresh });
  const post = (url: string, json?: unknown) => act.mutate(() => api(url, { method: "POST", json }));

  const patchMeta = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api(`/api/factory/oligo/orders/${id}`, { method: "PATCH", json: payload }),
    onSuccess: () => {
      setEditingNotes(false);
      setEditingDate(false);
      setEditingLink(false);
      setDateChangeReason("");
      setConfirmDateWarning(false);
      refresh();
    },
  });

  const recalcPricing = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api(`/api/factory/oligo/orders/${id}/pricing`, { method: "POST", json: payload }),
    onSuccess: () => {
      setEditingPricing(false);
      refresh();
    },
  });

  const o = order.data;

  // Tổng hợp các hạng mục hóa đơn VAT từ tất cả trình tự trong đơn
  const aggregatedInvoiceLines = React.useMemo(() => {
    const map = new Map<string, PriceLine>();
    for (const s of (o?.sequences ?? []).filter((x) => x.status !== "CANCELLED" && x.status !== "SPLIT")) {
      for (const l of s.price_lines_json ?? []) {
        const key = `${l.code}::${l.unit_price}`;
        const prev = map.get(key);
        if (prev) {
          prev.qty += Number(l.qty) || 0;
          prev.amount += Number(l.amount) || 0;
        } else {
          map.set(key, { ...l });
        }
      }
    }
    return Array.from(map.values());
  }, [o?.sequences]);

  const subtotalVnd = (o?.sequences ?? [])
    .filter((x) => x.status !== "CANCELLED" && x.status !== "SPLIT")
    .reduce((acc, s) => acc + Number(s.price ?? 0), 0);
  const vatRate = Number(o?.vat_rate ?? 8);
  const vatAmountVnd = Math.round((subtotalVnd * vatRate) / 100);
  const grandTotalVnd = Number(o?.total_price ?? subtotalVnd + vatAmountVnd);

  const isAmpliconSeq = (s: Seq) =>
    Boolean((s as any).is_amplicon) ||
    s.product_type === "AMPLICON_LINEAR" ||
    s.product_type === "AMPLICON_PLASMID" ||
    s.oligo_role === "TEMPLATE" ||
    s.oligo_role === "POSITIVE_CONTROL";

  const activeSeqs = (o?.sequences ?? []).filter((s) => s.status !== "CANCELLED" && s.status !== "SPLIT");
  const primerProbeSeqs = activeSeqs.filter((s) => !isAmpliconSeq(s));
  const ampliconSeqs = activeSeqs.filter((s) => isAmpliconSeq(s));

  const availableInternalOrders =
    intakeOptions.data?.find((u) => u.id === o?.org_unit_id)?.internal_orders ??
    intakeOptions.data?.[0]?.internal_orders ??
    [];

  const jumpToInternalOrder = (internalOrderId?: string | null) => {
    if (!internalOrderId || typeof window === "undefined") return;
    window.sessionStorage.setItem("factory_open_internal_order_id", internalOrderId);
    window.dispatchEvent(
      new CustomEvent("factory-switch-tab", {
        detail: { tab: "factory-orders", internalOrderId },
      })
    );
  };

  return (
    <Card
      title={
        titleOverride ??
        (o
          ? `Chi tiết Đơn Oligo ${o.code}${o.internal_order_code ? ` (Đơn nội bộ: ${o.internal_order_code})` : ""} ${
              o.kd_po_code ? `— PO: ${o.kd_po_code}` : ""
            }`
          : "Đơn Oligo")
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {o && !["COMPLETED", "DELIVERED", "CANCELLED"].includes(o.status) && o.sequences.length > 0 && (
            <Button variant="ghost" onClick={() => setShowAddSeq((v) => !v)}>
              {showAddSeq ? "Đóng thêm trình tự" : "🧬 + Thêm trình tự / Nhập Excel"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Đóng</Button>
        </div>
      }
    >
      <ErrorNote error={order.error ?? act.error ?? patchMeta.error} />
      {o && (
        <div className="flex flex-col gap-3 text-xs">
          {headerBanner}
          {/* 1. Thanh Thông tin Đơn, Liên kết Đơn Nội Bộ & Hạn Giao */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={ORDER_STATUS[o.status][0]} label={ORDER_STATUS[o.status][1]} />
              <span className="font-bold text-slate-900 dark:text-white">{o.customer_label ?? "—"}</span>
              <span>
                · Hạn giao: <b className="text-slate-900 dark:text-white">{fmtDate(o.due_date)}</b>
                {(o.due_date_change_count ?? 0) > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 text-[10px] font-bold">
                    ⚠️ Đã dời lịch {o.due_date_change_count} lần (Ban đầu: {fmtDate(o.initial_due_date ?? null)})
                  </span>
                )}
              </span>
              {o.internal_order_code ? (
                <button
                  type="button"
                  onClick={() => jumpToInternalOrder(o.internal_order_id)}
                  title="Nhấp để chuyển sang màn hình Đơn Nội Bộ và mở đơn này"
                  className="px-2.5 py-0.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 font-mono font-bold text-[11px] hover:underline cursor-pointer"
                >
                  🔗 Đơn nội bộ: {o.internal_order_code} (PO: {o.kd_po_code}) ↗
                </button>
              ) : (
                <span className="text-rose-600 font-semibold">⚠️ Chưa gắn Đơn nội bộ</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="ghost"
                onClick={() => {
                  setNewDueDate(o.due_date?.slice(0, 10) || "");
                  setDateChangeReason("");
                  setConfirmDateWarning(false);
                  setEditingDate((v) => !v);
                }}
              >
                📅 Thay đổi ngày giao
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedIoId(o.internal_order_id || "");
                  setEditingLink((v) => !v);
                }}
              >
                🔗 {o.internal_order_code ? "Đổi liên kết Đơn Nội Bộ" : "Gắn Đơn Nội Bộ"}
              </Button>
              {o.sequences.length > 0 && (
                <Button variant="ghost" onClick={() => exportCsv(o)}>
                  📊 Xuất Excel thông số
                </Button>
              )}
              {activeSeqs.length > 0 && (
                <Button variant="ghost" onClick={() => setLabelsFor(activeSeqs.map((s) => s.id))}>
                  🏷️ Xem / In nhãn ống
                </Button>
              )}
            </div>
          </div>

          {/* 2. Khung Ghi chú Đơn hàng (Hiển thị nổi bật + Cho phép sửa trực tiếp) */}
          <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-800/70 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                <span>📝 Ghi chú đối với Đơn hàng ({o.code}):</span>
              </div>
              {!editingNotes && (
                <button
                  type="button"
                  onClick={() => {
                    setNotesDraft(o.notes || o.internal_order_notes || "");
                    setEditingNotes(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:bg-amber-100 cursor-pointer"
                >
                  ✏️ Cập nhật ghi chú
                </button>
              )}
            </div>
            {editingNotes ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  className={`${inputClass} flex-1`}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="Nhập ghi chú yêu cầu kỹ thuật, quy cách chia ống, tinh sạch, yêu cầu COA..."
                />
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    disabled={patchMeta.isPending}
                    onClick={() => patchMeta.mutate({ notes: notesDraft })}
                  >
                    💾 Lưu ghi chú
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingNotes(false)}>
                    Hủy
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-slate-800 dark:text-slate-200 whitespace-pre-line">
                {o.notes || o.internal_order_notes || (
                  <span className="italic text-slate-400">
                    Chưa có ghi chú. Bấm &ldquo;✏️ Cập nhật ghi chú&rdquo; để thêm lưu ý cho đơn hàng này.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 3. Khung Cảnh Báo Khi Thay Đổi Ngày Giao Hàng */}
          {editingDate && (
            <div className="p-3.5 rounded-xl bg-rose-50/90 dark:bg-rose-950/40 border-2 border-rose-300 dark:border-rose-800 space-y-2.5">
              <div className="font-extrabold text-rose-900 dark:text-rose-200 flex items-center gap-1.5 text-xs">
                <span>🚨 CẢNH BÁO THAY ĐỔI NGÀY GIAO HÀNG (TÁC ĐỘNG CAM KẾT SLA &amp; ĐƠN NỘI BỘ)</span>
              </div>
              <div className="text-[11px] text-rose-800 dark:text-rose-300 space-y-1">
                <p>
                  • Ngày giao ban đầu: <b>{fmtDate(o.initial_due_date ?? o.due_date)}</b> · Ngày giao hiện tại:{" "}
                  <b>{fmtDate(o.due_date)}</b> · Số lần đã dời lịch trước đó: <b>{o.due_date_change_count ?? 0} lần</b>.
                </p>
                <p>
                  • Khi bạn thay đổi ngày giao, hệ thống sẽ <b>tự động cộng +1 lần dời lịch</b>, lưu vết kiểm toán (Audit Trail) và{" "}
                  <b>đồng bộ ngay ngày giao mới sang Đơn Nội Bộ {o.internal_order_code || ""} (PO {o.kd_po_code || ""})</b> để cảnh báo cho bộ phận Kinh doanh / Kế hoạch.
                </p>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-3 items-end">
                <Field label="Ngày giao mới *">
                  <input
                    type="date"
                    className={inputClass}
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    required
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Lý do thay đổi ngày giao (Bắt buộc ghi rõ nguyên nhân) *">
                    <input
                      type="text"
                      className={inputClass}
                      value={dateChangeReason}
                      onChange={(e) => setDateChangeReason(e.target.value)}
                      placeholder="VD: Chờ tinh sạch lại cột HPLC cho Probe / Khách hàng yêu cầu giao gộp lô..."
                      required
                    />
                  </Field>
                </div>
              </div>
              {newDueDate && o.due_date && newDueDate !== o.due_date.slice(0, 10) && (
                <label className="flex items-center gap-2 font-bold text-rose-900 dark:text-rose-200 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={confirmDateWarning}
                    onChange={(e) => setConfirmDateWarning(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span>
                    Tôi đã kiểm tra tác động tiến độ và xác nhận đổi ngày giao từ{" "}
                    <u>{fmtDate(o.due_date)}</u> sang <u>{fmtDate(newDueDate)}</u>.
                  </span>
                </label>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditingDate(false)}>
                  Hủy bỏ
                </Button>
                <Button
                  disabled={
                    patchMeta.isPending ||
                    !newDueDate ||
                    newDueDate === o.due_date?.slice(0, 10) ||
                    dateChangeReason.trim().length < 3 ||
                    !confirmDateWarning
                  }
                  onClick={() =>
                    patchMeta.mutate({
                      due_date: newDueDate,
                      date_change_reason: dateChangeReason.trim(),
                    })
                  }
                >
                  ⚠️ Xác nhận Đổi Ngày Giao &amp; Đồng bộ Đơn Nội Bộ
                </Button>
              </div>
            </div>
          )}

          {/* Khung Đổi / Gắn Liên kết Đơn Nội Bộ */}
          {editingLink && (
            <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 flex flex-wrap items-end justify-between gap-2">
              <div className="flex-1 min-w-64">
                <Field label="Chọn Đơn Nội Bộ (Phòng Tổng hợp Oligo) để liên kết với đơn này">
                  <select
                    className={inputClass}
                    value={selectedIoId}
                    onChange={(e) => setSelectedIoId(e.target.value)}
                  >
                    <option value="">— Chọn Đơn Nội Bộ —</option>
                    {availableInternalOrders.map((io) => (
                      <option key={io.id} value={io.id}>
                        {io.code} · PO Kinh doanh: {io.kd_po_code} (Cam kết: {fmtDate(io.committed_date)})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  disabled={patchMeta.isPending || !selectedIoId}
                  onClick={() => patchMeta.mutate({ internal_order_id: selectedIoId })}
                >
                  🔗 Lưu liên kết Đơn Nội Bộ
                </Button>
                <Button variant="ghost" onClick={() => setEditingLink(false)}>
                  Đóng
                </Button>
              </div>
            </div>
          )}

          {/* 4. Trung tâm Xuất COA cho Đơn Hàng */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-50/80 via-sky-50/60 to-purple-50/80 dark:from-slate-900 dark:via-slate-900 dark:to-purple-950/30 border border-indigo-200 dark:border-slate-800 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-extrabold text-indigo-950 dark:text-indigo-200">
                  📜 Xuất Chứng Chỉ Phân Tích Chất Lượng (COA) Cho Đơn Hàng {o.code}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  Gồm: <b>COA Đơn hàng cho Primer &amp; Probe ({primerProbeSeqs.length} trình tự)</b> và{" "}
                  <b>COA Amplicon ({ampliconSeqs.length} trình tự)</b>.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {primerProbeSeqs.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      printOrderCoa(o.id, "PRIMER_PROBE_ONLY").catch((e) => window.alert(e.message))
                    }
                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs shadow-2xs cursor-pointer"
                  >
                    📜 COA Đơn hàng ({primerProbeSeqs.length} Primer/Probe)
                  </button>
                )}
                {ampliconSeqs.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      printOrderCoa(o.id, "AMPLICONS_ONLY").catch((e) => window.alert(e.message))
                    }
                    className="px-3 py-1.5 rounded-xl border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-900 hover:bg-purple-50 text-purple-800 dark:text-purple-300 font-bold text-xs cursor-pointer"
                  >
                    🧬 COA Amplicon ({ampliconSeqs.length})
                  </button>
                )}
              </div>
            </div>

            {ampliconSeqs.length > 0 && (
              <div className="pt-2 border-t border-indigo-200/60 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-purple-800 dark:text-purple-300">
                  Xuất COA từng Amplicon:
                </span>
                {ampliconSeqs.map((amp) => (
                  <button
                    key={amp.id}
                    type="button"
                    onClick={() =>
                      printOrderCoa(o.id, "AMPLICONS_ONLY", amp.id).catch((e) =>
                        window.alert(e.message)
                      )
                    }
                    className="px-2.5 py-1 rounded-lg bg-purple-100 dark:bg-purple-950/70 hover:bg-purple-200 text-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-800 font-mono text-[11px] font-bold cursor-pointer"
                  >
                    🧬 COA Amplicon: {amp.code} — {amp.name} ({amp.base_count} bp)
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 5. Bảng Tính Tiền Tổng Hợp Oligo & Kê Khai Hạng Mục Hóa Đơn (OLG-...) */}
          <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/70 flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-extrabold text-emerald-950 dark:text-emerald-200">
                  💰 Tính Tiền Tổng Hợp Oligo ({o.code}):
                </span>
                <span className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 font-bold text-[11px] text-emerald-800 dark:text-emerald-300">
                  Chế độ:{" "}
                  {o.pricing_type === "percentage"
                    ? `Giá Dealer (${o.price_percentage ?? 100}%)`
                    : o.pricing_type === "custom"
                    ? "Đơn giá tự do"
                    : o.pricing_type === "demo"
                    ? "Đơn Demo (0đ)"
                    : "Giá End (100%)"}
                </span>
                <span>
                  Trước VAT: <b className="font-mono">{subtotalVnd.toLocaleString("vi-VN")} đ</b>
                </span>
                <span>
                  VAT ({vatRate}%): <b className="font-mono">{vatAmountVnd.toLocaleString("vi-VN")} đ</b>
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-600 text-white font-extrabold font-mono">
                  Tổng cộng: {grandTotalVnd.toLocaleString("vi-VN")} VNĐ
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    printOligoInvoiceSchedule(o, aggregatedInvoiceLines, subtotalVnd, vatRate, vatAmountVnd, grandTotalVnd)
                  }
                  className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-2xs cursor-pointer"
                  title="Xem trước & In Bảng kê xuất hóa đơn VAT kèm Phụ lục trình tự Oligo chuẩn A4"
                >
                  🖨️ In Bảng Kê Xuất Hóa Đơn VAT (A4)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportOligoInvoiceCsv(o, aggregatedInvoiceLines, subtotalVnd, vatRate, vatAmountVnd, grandTotalVnd)
                  }
                  className="px-2.5 py-1 rounded-xl border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-slate-900 hover:bg-emerald-50 text-emerald-800 dark:text-emerald-300 font-bold text-xs cursor-pointer"
                  title="Tải file Excel (.csv UTF-8) Bảng kê mã hàng hóa đơn VAT và Phụ lục trình tự Oligo"
                >
                  📥 Xuất Excel Bảng Kê (.csv)
                </button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPricingDraft({
                      pricing_type: o.pricing_type || "auto",
                      price_percentage: String(o.price_percentage ?? 100),
                      custom_unit_price: "0",
                      vat_rate: String(o.vat_rate ?? 8),
                    });
                    setEditingPricing((v) => !v);
                  }}
                >
                  {editingPricing ? "Đóng cấu hình giá" : "🧮 Đổi chế độ giá / Tính lại tiền"}
                </Button>
              </div>
            </div>

            {editingPricing && (
              <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800/60 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5 items-end">
                <Field label="Chế độ tính giá">
                  <select
                    className={inputClass}
                    value={pricingDraft.pricing_type}
                    onChange={(e) => setPricingDraft({ ...pricingDraft, pricing_type: e.target.value })}
                  >
                    <option value="auto">Giá End (100% bảng giá chuẩn)</option>
                    <option value="percentage">Giá Dealer / Chiết khấu theo %</option>
                    <option value="custom">Đơn giá tự do (VNĐ / base)</option>
                    <option value="demo">Đơn hàng Demo (0 VNĐ)</option>
                  </select>
                </Field>
                {pricingDraft.pricing_type === "percentage" && (
                  <Field label="Tỷ lệ % so với Giá End">
                    <input
                      type="number"
                      className={inputClass}
                      value={pricingDraft.price_percentage}
                      onChange={(e) => setPricingDraft({ ...pricingDraft, price_percentage: e.target.value })}
                    />
                  </Field>
                )}
                {pricingDraft.pricing_type === "custom" && (
                  <Field label="Đơn giá tự nhập (VNĐ / base)">
                    <input
                      type="number"
                      className={inputClass}
                      value={pricingDraft.custom_unit_price}
                      onChange={(e) => setPricingDraft({ ...pricingDraft, custom_unit_price: e.target.value })}
                    />
                  </Field>
                )}
                <Field label="Thuế suất VAT (%)">
                  <input
                    type="number"
                    className={inputClass}
                    value={pricingDraft.vat_rate}
                    onChange={(e) => setPricingDraft({ ...pricingDraft, vat_rate: e.target.value })}
                  />
                </Field>
                <div className="flex items-center gap-1.5">
                  <Button
                    disabled={recalcPricing.isPending}
                    onClick={() =>
                      recalcPricing.mutate({
                        pricing_type: pricingDraft.pricing_type,
                        price_percentage: Number(pricingDraft.price_percentage) || 100,
                        custom_unit_price: Number(pricingDraft.custom_unit_price) || 0,
                        vat_rate: Number(pricingDraft.vat_rate) || 0,
                      })
                    }
                  >
                    {recalcPricing.isPending ? "Đang tính…" : "💾 Áp dụng & Tính lại toàn bộ đơn"}
                  </Button>
                </div>
              </div>
            )}

            {aggregatedInvoiceLines.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer font-bold text-emerald-800 dark:text-emerald-300 select-none">
                  📋 Xem Bảng kê chi tiết mã hàng hóa đơn VAT ({aggregatedInvoiceLines.length} dòng hạng mục OLG-...)
                </summary>
                <div className="mt-2 bg-white dark:bg-slate-950 rounded-xl p-2 border border-emerald-200 dark:border-emerald-900">
                  <Table head={["Mã hàng hóa đơn", "Tên hạng mục", "ĐVT", "Tổng SL", "Đơn giá (VNĐ)", "Thành tiền (VNĐ)"]}>
                    {aggregatedInvoiceLines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-3 font-mono font-bold text-sky-700 dark:text-sky-400">{l.code}</td>
                        <td className="py-1 pr-3">{l.name}</td>
                        <td className="py-1 pr-3 text-slate-500">{l.unit}</td>
                        <td className="py-1 pr-3 text-right font-mono">{l.qty}</td>
                        <td className="py-1 pr-3 text-right font-mono">{Number(l.unit_price).toLocaleString("vi-VN")} đ</td>
                        <td className="py-1 pr-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          {Number(l.amount).toLocaleString("vi-VN")} đ
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </details>
            )}
          </div>

          {!["COMPLETED", "DELIVERED", "CANCELLED"].includes(o.status) && (o.sequences.length === 0 || showAddSeq) && (
            <AddSequences
              orderId={o.id}
              onDone={() => {
                setShowAddSeq(false);
                refresh();
              }}
            />
          )}
          <Table head={["Mã", "Tên", "Trình tự", "Dài", "Loại", "Thang / tinh sạch", "MW (Da)", "Tm (°C)", "GC %", "nmol/OD", "Thành tiền (VNĐ)", "Trạng thái", ""]}>
            {o.sequences.map((s) => (
              <tr key={s.id} className={s.status === "CANCELLED" ? "opacity-50" : ""}>
                <td className="py-2 pr-3 font-mono">{s.code}</td>
                <td className="py-2 pr-3">{s.name}{s.relation === "SPLIT" && <span className="text-slate-400"> (ống tách)</span>}</td>
                <td className="py-2 pr-3 font-mono break-all max-w-80">
                  {s.normalized_sequence}
                  {s.raw_sequence !== s.normalized_sequence && <div className="font-sans text-[11px] text-slate-400">nhập: {s.raw_sequence}</div>}
                  {s.modifications.length > 0 && <div className="font-sans text-[11px] text-sky-700 dark:text-sky-400">Modification: {s.modifications.join(", ")}</div>}
                  {s.warnings.map((w, i) => <div key={i} className="font-sans text-[11px] text-amber-700 dark:text-amber-400">⚠ {w}</div>)}
                </td>
                <td className="py-2 pr-3 text-right">{s.base_count}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{s.molecule_type === "RNA" ? "RNA " : ""}{PRODUCT[s.product_type as keyof typeof PRODUCT]}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{scales.data?.find((x) => x.code === s.scale_code)?.label ?? s.scale_code} · {PURIFICATION[s.purification as keyof typeof PURIFICATION]} · {FORMAT[s.format as keyof typeof FORMAT]}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{s.mw.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right">{s.tm.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right">{s.gc_percent.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right">{s.nmol_per_od.toLocaleString("vi-VN")}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">
                  <div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                    {Number(s.price ?? 0).toLocaleString("vi-VN")} đ
                  </div>
                  <div className="font-mono text-[10px] text-slate-500">
                    {Number(s.unit_price ?? 0).toLocaleString("vi-VN")} đ/nt
                  </div>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <StatusBadge status={SEQ_STATUS[s.status][0]} label={SEQ_STATUS[s.status][1]} />
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <div className="flex flex-wrap items-center gap-1">
                    {s.status !== "CANCELLED" && s.status !== "SPLIT" && <Button variant="ghost" onClick={() => setLabelsFor([s.id])}>Nhãn</Button>}
                    {s.status !== "CANCELLED" && s.status !== "SPLIT" && isAmpliconSeq(s) && (
                      <button
                        type="button"
                        onClick={() => printOrderCoa(o.id, "AMPLICONS_ONLY", s.id).catch((e) => window.alert(e.message))}
                        title="Xuất bản COA cho trình tự Amplicon này"
                        className="px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-950/70 hover:bg-purple-200 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-800 text-[11px] font-bold cursor-pointer"
                      >
                        🧬 COA Amplicon
                      </button>
                    )}
                    {s.status === "PENDING" && !s.relation && (
                      <Button variant="ghost" onClick={() => { const n = Number(window.prompt("Tách thành mấy ống?", "2")); const sc = n >= 2 && window.prompt(`Thang cho mỗi ống (${scales.data?.map((x) => x.code).join(", ")}):`, s.scale_code); if (n >= 2 && sc) post(`/api/factory/oligo/sequences/${s.id}/split`, { parts: Array.from({ length: n }, () => ({ scale_code: sc })) }); }}>
                        Tách
                      </Button>
                    )}
                    {s.status === "SPLIT" && <Button variant="ghost" onClick={() => post(`/api/factory/oligo/sequences/${s.id}/unsplit`)}>Hủy tách</Button>}
                    {s.status === "PENDING" && (
                      <Button variant="ghost" onClick={() => { const r = window.prompt("Lý do hủy trình tự:"); if (r) post(`/api/factory/oligo/sequences/${s.id}/cancel`, { reason: r }); }}>Hủy</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>

          {/* Integrated Labels & Delivery Section inside Order Detail */}
          {labelsFor && <LabelPreview key={labelsFor.join(",")} sequenceIds={labelsFor} canPrint={canDeliver} onClose={() => setLabelsFor(null)} />}
          <OrderDeliverySection orderId={o.id} canDeliver={canDeliver} />

          {footerSlot}

          {!["COMPLETED", "DELIVERED", "CANCELLED"].includes(o.status) && (
            <div><Button variant="ghost" onClick={() => { const r = window.prompt("Lý do hủy cả đơn:"); if (r) post(`/api/factory/oligo/orders/${o.id}/cancel`, { reason: r }); }}>Hủy đơn</Button></div>
          )}
        </div>
      )}
    </Card>
  );
}
