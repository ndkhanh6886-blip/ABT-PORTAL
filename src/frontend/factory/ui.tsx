"use client";

import React from "react";

/** Small shared building blocks so every factory screen looks the same. */

export function Card({ title, actions, children }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TERM_TOOLTIPS: Record<string, string> = {
  EBR: "EBR (Electronic Batch Record): Hồ sơ lô sản xuất điện tử ghi nhận từng bước thao tác",
  BOM: "BOM (Bill of Materials): Định mức nguyên vật liệu & cấu trúc đóng gói của sản phẩm",
  ROUTING: "Routing: Quy trình các bước công đoạn sản xuất chuẩn",
  PO: "PO (Purchase / Production Order): Đơn đặt hàng / Lệnh sản xuất",
  FEFO: "FEFO (First Expired, First Out): Quy tắc ưu tiên xuất kho lô hết hạn trước",
  IFU: "IFU (Instructions For Use): Tờ hướng dẫn sử dụng đi kèm trong hộp sản phẩm",
  COA: "COA (Certificate of Analysis): Giấy chứng nhận phân tích chất lượng xuất xưởng",
  IPQC: "IPQC (In-Process Quality Control): Kiểm soát chất lượng bán thành phẩm xen kẽ giữa các công đoạn",
  IQC: "IQC (Incoming Quality Control): Kiểm tra chất lượng nguyên vật liệu đầu vào",
  FQC: "FQC (Final Quality Control): Kiểm định chất lượng thành phẩm trước xuất xưởng",
  QC: "QC (Quality Control): Kiểm soát chất lượng",
  QA: "QA (Quality Assurance): Đảm bảo chất lượng",
  NCR: "NCR (Non-Conformance Report): Báo cáo sự không phù hợp / Sản phẩm lỗi",
  CAPA: "CAPA (Corrective and Preventive Action): Hành động khắc phục và phòng ngừa",
  LINE_CLEARANCE: "Line Clearance: Kiểm tra dọn sạch dây chuyền, khử trùng UV và hủy nhãn lô cũ trước khi chạy lô mới",
  REWORK: "Rework: Lệnh làm lại / Thay thế hộp thành phần bị lỗi",
  ALIQUOT: "Aliquot: Chia lẻ hóa chất vào từng ống thành phần theo định lượng",
  CLONE: "Clone: Nhân bản toàn bộ dữ liệu sang phiên bản mới",
  DRAFT: "DRAFT: Bản nháp (đang soạn thảo, chưa áp dụng sản xuất)",
  EFFECTIVE: "EFFECTIVE: Đang có hiệu lực chính thức để áp dụng sản xuất",
  OBSOLETE: "OBSOLETE: Đã ngừng hiệu lực / Lỗi thời",
  UDI: "UDI (Unique Device Identifier): Mã định danh thiết bị y tế duy nhất theo chuẩn quốc tế",
  GMP: "GMP (Good Manufacturing Practice): Thực hành sản xuất tốt",
  RMA: "RMA (Return Merchandise Authorization): Tiếp nhận bảo hành / sửa chữa thiết bị khách hàng gửi về",
  PR: "PR (Purchase Requisition): Phiếu đề nghị mua hàng vật tư thiếu",
};

function extractTextFromNode(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextFromNode).join(" ");
  if (React.isValidElement(node)) {
    return extractTextFromNode((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function buildAutoVietnameseTooltip(text: string): string | undefined {
  const upper = text.toUpperCase();
  const matched: string[] = [];
  if (upper.includes("LINE CLEARANCE")) matched.push(TERM_TOOLTIPS.LINE_CLEARANCE);
  for (const [k, desc] of Object.entries(TERM_TOOLTIPS)) {
    if (k === "LINE_CLEARANCE") continue;
    const regex = new RegExp(`\\b${k}\\b`, "i");
    if (regex.test(text)) matched.push(desc);
  }
  if (matched.length > 0) return matched.join(" · ");
  return text.trim() || undefined;
}

export function Button({
  variant = "primary",
  className = "",
  title,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "secondary" | "danger" }) {
  const styles =
    variant === "primary"
      ? "bg-sky-600 hover:bg-sky-700 text-white border border-sky-700/30 shadow-xs disabled:bg-slate-200 disabled:text-slate-500 disabled:border-slate-300"
      : variant === "danger"
        ? "bg-rose-600 hover:bg-rose-700 text-white border border-rose-700/30 shadow-xs disabled:bg-slate-200 disabled:text-slate-500 disabled:border-slate-300"
        : variant === "secondary"
          ? "border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/60 disabled:opacity-50"
          : "border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50";
  const computedTitle = title || buildAutoVietnameseTooltip(extractTextFromNode(children));
  return (
    <button
      {...props}
      title={computedTitle}
      className={`min-h-9 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:cursor-not-allowed ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full factory-input-width min-h-9 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500";

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Empty({ children, text }: { children?: React.ReactNode; text?: string }) {
  return <div className="py-10 text-center text-sm text-slate-400">{children ?? text}</div>;
}

export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            {head.map((h, i) => (
              <th key={i} className="py-2 pr-3 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-200">{children}</tbody>
      </table>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  RELEASED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  EFFECTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  DONE: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  PASSED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  QUARANTINE: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  PENDING: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  AWAITING_CHECK: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  WAITING_QC: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900",
  PENDING_QC: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  CONFIRMED: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  IN_PROGRESS: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  IN_REVIEW: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  PENDING_RELEASE: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900",
  ON_HOLD: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900",
  REJECTED: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  FAILED: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
  EXPIRED: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  OBSOLETE: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  CANCELLED: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  SKIPPED: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};
export const LOT_STATUS_LABEL: Record<string, string> = {
  QUARANTINE: "Biệt trữ",
  PENDING_QC: "Chờ kiểm định QC",
  RELEASED: "Đã giải phóng (Đạt)",
  ON_HOLD: "Tạm giữ (Hold)",
  REJECTED: "Không đạt (Loại bỏ)",
  EXPIRED: "Hết hạn",
  DRAFT: "Bản nháp",
  IN_REVIEW: "Chờ thẩm định",
  EFFECTIVE: "Đang hiệu lực",
  OBSOLETE: "Hết hiệu lực",
  CONFIRMED: "Đã xác nhận",
  IN_PROGRESS: "Đang thực hiện",
  PENDING: "Chờ thực hiện",
  AWAITING_CHECK: "Chờ ký kiểm tra chéo",
  WAITING_QC: "Chờ QC xác nhận thông qua",
  PASSED: "QC đã thông qua",
  PENDING_RELEASE: "Chờ QA duyệt xuất xưởng",
  COMPLETED: "Đã hoàn thành",
  DONE: "Đã hoàn tất",
  FAILED: "Báo lỗi / Không đạt",
  SKIPPED: "Đã bỏ qua",
  CANCELLED: "Đã hủy",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const vnLabel = label ?? LOT_STATUS_LABEL[status] ?? status;
  return (
    <span
      title={`Trạng thái: ${vnLabel} (Mã gốc: ${status})`}
      className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full border text-[11px] font-bold ${STATUS_STYLE[status] ?? STATUS_STYLE.EXPIRED}`}
    >
      {vnLabel}
    </span>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between pt-3 text-xs text-slate-500">
      <span>{total.toLocaleString("vi-VN")} dòng</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Trước
        </Button>
        <span>
          {page}/{pages}
        </span>
        <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  );
}
