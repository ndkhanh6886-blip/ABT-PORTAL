"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Printer,
  X,
  QrCode,
  Barcode as BarcodeIcon,
  Download,
  Copy,
  Check,
  Sparkles,
  Layers,
  Settings2,
  FileSpreadsheet,
  ThermometerSnowflake,
  ShieldCheck,
  Calendar
} from "lucide-react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { useCompanyConfig } from "@/frontend/utils/companyConfig";

export interface PrintableItem {
  id?: number | string;
  product_code: string;
  product_name: string;
  batch_lot: string;
  expiry_date: string;
  storage_condition?: string;
  quantity?: number;
  unit?: string;
  serial_number?: string;
  manufacturer?: string;
}

interface BarcodePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: PrintableItem | null;
}

export const BarcodePrintModal: React.FC<BarcodePrintModalProps> = ({
  isOpen,
  onClose,
  item
}) => {
  const companyConfig = useCompanyConfig();
  const [printCopies, setPrintCopies] = useState<number>(1);
  const [labelSize, setLabelSize] = useState<"35x22" | "50x30" | "75x50" | "100x60" | "a4_tomy">("75x50");
  const [codeType, setCodeType] = useState<"both" | "barcode_only" | "qr_only">("both");
  const [includeStorage, setIncludeStorage] = useState(true);
  const [includeCompany, setIncludeCompany] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copiedText, setCopiedText] = useState(false);
  const barcodeSvgRef = useRef<SVGSVGElement>(null);
  const previewCardRef = useRef<HTMLDivElement>(null);

  // Sync initial copies with item quantity if available
  useEffect(() => {
    if (item && item.quantity && item.quantity > 0) {
      setPrintCopies(Math.min(item.quantity, 50));
    } else {
      setPrintCopies(1);
    }
  }, [item]);

  // Generate QR Code & Barcode Code 128 when item or options change
  useEffect(() => {
    if (!item) return;

    // 1. Generate 2D QR Code data payload
    const qrPayload = JSON.stringify({
      tbr_id: "ABT-IVD-VN",
      sku: item.product_code,
      lot: item.batch_lot,
      exp: item.expiry_date,
      storage: item.storage_condition || "-20°C",
      serial: item.serial_number || `SN-${item.batch_lot}-001`,
      url: `${process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "https://abt-portal.com")}/verify?sku=${encodeURIComponent(item.product_code)}&lot=${encodeURIComponent(item.batch_lot)}`
    });

    QRCode.toDataURL(qrPayload, {
      width: 240,
      margin: 1,
      color: {
        dark: "#0f172a",
        light: "#ffffff"
      },
      errorCorrectionLevel: "M"
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error("QR Code generation error:", err));

    // 2. Generate 1D Code 128 Barcode
    if (barcodeSvgRef.current) {
      try {
        const barcodeValue = `${item.product_code}-${item.batch_lot}`.slice(0, 24);
        JsBarcode(barcodeSvgRef.current, barcodeValue, {
          format: "CODE128",
          lineColor: "#0f172a",
          width: labelSize === "35x22" ? 1.1 : (labelSize === "50x30" ? 1.4 : 1.6),
          height: labelSize === "35x22" ? 22 : (labelSize === "50x30" ? 30 : 42),
          displayValue: true,
          fontSize: labelSize === "35x22" ? 8 : 10,
          font: "monospace",
          textMargin: labelSize === "35x22" ? 1 : 2,
          margin: labelSize === "35x22" ? 1 : 4
        });
      } catch (err) {
        console.warn("JsBarcode render error:", err);
      }
    }
  }, [item, labelSize, codeType]);

  if (!isOpen || !item) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCopyCode = () => {
    const text = `${item.product_code} | Lô: ${item.batch_lot} | HSD: ${item.expiry_date}`;
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      {/* CSS In chuyên dụng cho máy in tem nhãn nhiệt và máy in A4 */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #print-label-container,
          #print-label-container * {
            visibility: visible;
          }
          #print-label-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 0;
            background: white !important;
            color: black !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            margin: 2mm;
            size: auto;
          }
        }
      `}</style>

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 flex items-center justify-center font-bold">
              <BarcodeIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-slate-900 dark:text-white text-base">
                  IN TEM NHÃN MÃ VẠCH &amp; QR CODE CHUẨN Y TẾ
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                  Chuẩn Code 128 / QR 2D
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Thiết kế tem nhãn chuyên dụng cho sinh phẩm, kit chẩn đoán IVD và thiết bị ABT
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body: Chia 2 cột (Cài đặt bên trái, Xem trước bên phải) */}
        <div className="p-5 sm:p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* CỘT TRÁI: CẤU HÌNH IN (5 Cột) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Thông tin sản phẩm được chọn */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-500">Mã SKU:</span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md">
                  {item.product_code}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-white leading-snug">
                {item.product_name}
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px]">
                <div>
                  <span className="text-slate-400 block">Số Lô (Lot):</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                    {item.batch_lot}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Hạn dùng (EXP):</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {item.expiry_date}
                  </span>
                </div>
              </div>
              {item.storage_condition && (
                <div className="flex items-center gap-1.5 text-[11px] text-sky-600 dark:text-sky-400 font-medium pt-1">
                  <ThermometerSnowflake className="w-3.5 h-3.5 shrink-0" />
                  <span>Bảo quản: {item.storage_condition}</span>
                </div>
              )}
            </div>

            {/* Cài đặt cấu hình nhãn in */}
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Khổ tem nhãn (Dạng cuộn / Giấy A4)</span>
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { id: "35x22", name: "35 × 22 mm", desc: "Ống Cryo / Lọ mẫu nhỏ" },
                    { id: "50x30", name: "50 × 30 mm", desc: "Hộp nhỏ / Ống nghiệm" },
                    { id: "75x50", name: "75 × 50 mm", desc: "Chuẩn Hộp Kit vừa" },
                    { id: "100x60", name: "100 × 60 mm", desc: "Thùng Carton lớn" },
                    { id: "a4_tomy", name: "Decal A4 Tomy", desc: "In 65 - 100 tem/trang", colSpan: true }
                  ].map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => setLabelSize(size.id as any)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        size.colSpan ? "col-span-2" : ""
                      } ${
                        labelSize === size.id
                          ? "border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/60 dark:border-indigo-500 font-bold shadow-xs"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      }`}
                    >
                      <div className="font-bold text-slate-900 dark:text-white flex items-center justify-between">
                        <span>{size.name}</span>
                        {labelSize === size.id && <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{size.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Định dạng mã hóa hiển thị</span>
                </label>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  {[
                    { id: "both", label: "Mã Vạch + QR" },
                    { id: "barcode_only", label: "Chỉ Mã Vạch 1D" },
                    { id: "qr_only", label: "Chỉ Mã QR 2D" }
                  ].map((ct) => (
                    <button
                      key={ct.id}
                      type="button"
                      onClick={() => setCodeType(ct.id as any)}
                      className={`py-2 px-2 rounded-xl text-center font-semibold text-[11px] transition-all border ${
                        codeType === ct.id
                          ? "border-indigo-600 bg-indigo-600 text-white font-bold"
                          : "border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {ct.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Số lượng tem cần in
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={printCopies}
                      onChange={(e) => setPrintCopies(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold text-slate-900 dark:text-white text-center text-sm"
                    />
                    {item.quantity && (
                      <button
                        type="button"
                        onClick={() => setPrintCopies(item.quantity || 1)}
                        className="px-2 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 whitespace-nowrap"
                        title="In toàn bộ tồn kho"
                      >
                        Tồn: {item.quantity}
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 pt-4">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeCompany}
                      onChange={(e) => setIncludeCompany(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-slate-700 dark:text-slate-300">Tiêu đề ABT</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeStorage}
                      onChange={(e) => setIncludeStorage(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-slate-700 dark:text-slate-300">Nhiệt độ bảo quản</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* CỘT PHẢI: XEM TRƯỚC TEM NHÃN THỜI GIAN THỰC (7 Cột) */}
          <div className="lg:col-span-7 flex flex-col items-center justify-center p-6 bg-slate-100/70 dark:bg-slate-950/70 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 min-h-[380px]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Hình ảnh xem trước con tem thực tế (Tỷ lệ in 100%)</span>
            </div>

            {/* KHỐI CON TEM (RENDER VIEW) */}
            <div
              id="print-label-container"
              ref={previewCardRef}
              className={`bg-white text-slate-900 border-2 border-slate-800 shadow-xl rounded-lg transition-all select-none ${
                labelSize === "35x22"
                  ? "w-[245px] min-h-[145px] p-2"
                  : labelSize === "50x30"
                  ? "w-[280px] min-h-[170px] p-3"
                  : labelSize === "100x60"
                  ? "w-[420px] min-h-[250px] p-4"
                  : "w-[340px] min-h-[220px] p-3.5"
              }`}
            >
              {/* Header Công ty TNHH Giải pháp Y sinh ABT */}
              {includeCompany && (
                <div className={`border-b border-slate-900 flex items-center justify-between ${labelSize === "35x22" ? "pb-0.5 mb-1" : "pb-1 mb-2 border-b-2"}`}>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 bg-slate-900 text-white font-black text-[8px] flex items-center justify-center rounded-xs">
                      {companyConfig.companyName?.slice(0, 1)?.toUpperCase() || "T"}
                    </div>
                    <span className={`font-black tracking-tight uppercase ${labelSize === "35x22" ? "text-[8px]" : "text-[10px]"}`}>
                      {companyConfig.companyName || "Công ty TNHH Giải pháp Y sinh ABT"}
                    </span>
                  </div>
                  <span className={`font-mono font-bold text-slate-500 ${labelSize === "35x22" ? "text-[7px]" : "text-[8px]"}`}>IVD STANDARD</span>
                </div>
              )}

              {/* Tên sản phẩm & SKU */}
              <div className={labelSize === "35x22" ? "mb-1" : "mb-1.5"}>
                <div className={`font-extrabold leading-snug line-clamp-2 ${labelSize === "35x22" ? "text-[10px]" : "text-xs"}`}>
                  {item.product_name}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`font-mono font-bold bg-slate-100 px-1 rounded ${labelSize === "35x22" ? "text-[8px]" : "text-[10px]"}`}>
                    Mã: {item.product_code}
                  </span>
                  {item.unit && (
                    <span className={`text-slate-600 font-semibold ${labelSize === "35x22" ? "text-[8px]" : "text-[9px]"}`}>
                      ĐVT: {item.unit}
                    </span>
                  )}
                </div>
              </div>

              {/* Thân mã vạch & QR */}
              <div className={`grid grid-cols-12 gap-1.5 items-center ${labelSize === "35x22" ? "my-1" : "my-2"}`}>
                {/* 1D Barcode Code 128 */}
                {(codeType === "both" || codeType === "barcode_only") && (
                  <div className={codeType === "both" ? "col-span-8 flex flex-col items-center" : "col-span-12 flex flex-col items-center"}>
                    <svg ref={barcodeSvgRef} className="max-w-full h-auto" />
                  </div>
                )}

                {/* 2D QR Code */}
                {(codeType === "both" || codeType === "qr_only") && (
                  <div className={codeType === "both" ? "col-span-4 flex flex-col items-center justify-center" : "col-span-12 flex flex-col items-center justify-center"}>
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="QR Code"
                        className={`border border-slate-300 p-0.5 rounded bg-white shadow-xs ${labelSize === "35x22" ? "w-11 h-11" : "w-16 h-16"}`}
                      />
                    ) : (
                      <div className={`bg-slate-100 animate-pulse rounded ${labelSize === "35x22" ? "w-11 h-11" : "w-16 h-16"}`} />
                    )}
                    <span className={`font-mono text-slate-500 mt-0.5 ${labelSize === "35x22" ? "text-[7px]" : "text-[8px]"}`}>Quét xác thực</span>
                  </div>
                )}
              </div>

              {/* Thông tin Lô, HSD, Bảo quản */}
              <div className={`border-t border-slate-900/40 grid grid-cols-2 gap-1 ${labelSize === "35x22" ? "pt-1 mt-0.5 text-[8px]" : "pt-1.5 mt-1 text-[9px]"}`}>
                <div>
                  <span className="text-slate-500 font-bold block">Số Lô (LOT):</span>
                  <span className={`font-mono font-black text-slate-900 ${labelSize === "35x22" ? "text-[9px]" : "text-[10px]"}`}>
                    {item.batch_lot}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block">Hạn dùng (EXP):</span>
                  <span className={`font-black text-slate-900 ${labelSize === "35x22" ? "text-[9px]" : "text-[10px]"}`}>
                    {item.expiry_date}
                  </span>
                </div>
                {includeStorage && item.storage_condition && (
                  <div className={`col-span-2 border-t border-dashed border-slate-300 flex items-center justify-between font-bold text-slate-700 ${labelSize === "35x22" ? "pt-0.5 text-[7px]" : "pt-0.5 text-[8px]"}`}>
                    <span>BẢO QUẢN:</span>
                    <span className="uppercase text-blue-700 truncate">{item.storage_condition}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Nút thao tác nhanh dưới hình xem trước */}
            <div className="flex items-center gap-2 mt-4 text-xs">
              <button
                type="button"
                onClick={handleCopyCode}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {copiedText ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-emerald-600">Đã chép mã</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Sao chép thông tin</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (qrDataUrl) {
                    const a = document.createElement("a");
                    a.href = qrDataUrl;
                    a.download = `QR_${item.product_code}_${item.batch_lot}.png`;
                    a.click();
                  }
                }}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                <span>Tải ảnh QR PNG</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>
              Sẵn sàng xuất lệnh in <strong>{printCopies} bản</strong> ra máy in nhiệt hoặc máy in A4
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              Hủy bỏ
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            >
              <Printer className="w-4 h-4" />
              <span>XUẤT LỆNH IN TEM ({printCopies} CON)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
