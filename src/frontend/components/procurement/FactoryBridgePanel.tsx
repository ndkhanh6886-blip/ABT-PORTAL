"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Factory, RefreshCw } from "lucide-react";

/**
 * Cung Ứng → Nhà máy: POs of internal suppliers (the factory departments), sending them to the
 * factory, following its progress and receiving its shipments with the factory's lots pre-filled.
 */

interface Overview {
  units: Record<string, string>;
  suppliers: { id: number; supplier_code: string; name: string }[];
  internal: { supplier_id: number; factory_unit: string }[];
  pos: {
    id: number; po_code: string; status: string; supplier_name: string; expected_delivery_date: string | null; factory_unit: string; sent: boolean;
    ship_mode: string | null; ship_to: any; kd_so_code: string | null; factory_order_code: string | null; factory_status: string | null;
    committed_date: string | null; reject_reason: string | null;
  }[];
  shipments: {
    id: string; po_id: number; po_code: string; shipment_code: string; ship_mode: string; ship_to: any; status: string; lines: any[];
    proof_file_name: string | null; inbound_code: string | null; created_at: string;
  }[];
  outbox_pending: { n: number; last_error: string | null };
}

const FACTORY_STATUS: Record<string, string> = {
  SENT: "Đã gửi, chờ nhà máy",
  ACCEPTED: "Nhà máy đã nhận đơn",
  IN_PRODUCTION: "Đang sản xuất",
  READY: "Sẵn sàng giao",
  PARTIALLY_DELIVERED: "Giao một phần",
  DELIVERED: "Đã giao đủ",
  CLOSED: "Hoàn tất",
  REJECTED: "Nhà máy từ chối",
  CANCELLED: "Đã hủy",
  CANCEL_REQUESTED: "Đã báo hủy",
};

async function call(body: any) {
  const res = await fetch("/api/procurement/factory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

const input = "px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs";
const btn = "px-3 py-1.5 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50 cursor-pointer";
const ghost = "px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer";

function SendForm({ poId, onDone }: { poId: number; onDone: () => void }) {
  const [mode, setMode] = useState<"TO_KD" | "DROP_SHIP">("TO_KD");
  const [to, setTo] = useState({ name: "", address: "", receiver: "", phone: "" });
  const [so, setSo] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap gap-2 items-end p-2 rounded-lg bg-orange-50 dark:bg-orange-950/30"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr("");
        try {
          await call({ action: "send_po", po_id: poId, ship_mode: mode, ship_to: mode === "DROP_SHIP" ? to : null, kd_so_code: so || null });
          onDone();
        } catch (x: any) {
          setErr(x.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <select className={input} value={mode} onChange={(e) => setMode(e.target.value as any)}>
        <option value="TO_KD">Giao về kho Kinh doanh</option>
        <option value="DROP_SHIP">Giao thẳng cho khách</option>
      </select>
      <input className={input} placeholder="Số đơn bán liên quan" value={so} onChange={(e) => setSo(e.target.value)} />
      {mode === "DROP_SHIP" && (
        <>
          <input className={input} placeholder="Tên khách hàng *" value={to.name} onChange={(e) => setTo({ ...to, name: e.target.value })} required />
          <input className={`${input} min-w-64`} placeholder="Địa chỉ giao *" value={to.address} onChange={(e) => setTo({ ...to, address: e.target.value })} required />
          <input className={input} placeholder="Người nhận" value={to.receiver} onChange={(e) => setTo({ ...to, receiver: e.target.value })} />
          <input className={input} placeholder="Điện thoại" value={to.phone} onChange={(e) => setTo({ ...to, phone: e.target.value })} />
        </>
      )}
      <button className={btn} disabled={busy}>Gửi đơn cho nhà máy</button>
      {err && <span className="w-full text-rose-600 text-xs">{err}</span>}
    </form>
  );
}

function ReceiveShipment({ s, onDone }: { s: Overview["shipments"][number]; onDone: () => void }) {
  const [warehouse, setWarehouse] = useState(s.ship_mode === "DROP_SHIP" ? "Kho KD – Giao thẳng" : "Kho Trung Tâm");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const receive = async () => {
    setBusy(true);
    setErr("");
    try {
      // the normal PO receipt, with the factory's lots; the shipment id makes a repeated click harmless
      const res = await fetch("/api/procurement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "receive_to_inventory",
          po_id: s.po_id,
          request_id: s.id,
          warehouse_name: warehouse,
          inbound_type: s.ship_mode === "DROP_SHIP" ? "Giao thẳng từ nhà máy" : "Nhập từ nhà máy",
          receipt_notes: `Phiếu giao nhà máy ${s.shipment_code}`,
          lines: s.lines.map((l) => ({
            line_index: l.line_index,
            product_code: l.product_code,
            product_name: l.product_name,
            unit: l.unit,
            quantity: l.quantity,
            unit_price: l.unit_price,
            lot_number: l.lot_number,
            expiry_date: l.expiry_date,
            no_expiry: !l.expiry_date,
            manufacture_date: l.manufacture_date,
            qc_status: "Đạt (QA nhà máy đã giải phóng lô)",
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
      await call({ action: "ack_shipment", shipment_id: s.id });
      onDone();
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input className={input} value={warehouse} onChange={(e) => setWarehouse(e.target.value)} aria-label="Kho nhập" />
      <button className={btn} disabled={busy || (s.ship_mode === "DROP_SHIP" && s.status !== "DELIVERED")} onClick={receive}>
        {s.ship_mode === "DROP_SHIP" ? "Ghi nhận giao thẳng" : "Nhập kho"}
      </button>
      {s.ship_mode === "DROP_SHIP" && s.status !== "DELIVERED" && <span className="text-amber-600 text-xs">Chờ nhà máy tải biên bản khách ký.</span>}
      {err && <span className="text-rose-600 text-xs">{err}</span>}
    </div>
  );
}

export function FactoryBridgePanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/procurement/factory", { credentials: "same-origin" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setData(d);
      setError("");
    } catch (e: any) {
      setError(e.message || "Không tải được dữ liệu nhà máy");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const unitOf = (supplierId: number) => data?.internal.find((i) => i.supplier_id === supplierId)?.factory_unit ?? "";

  return (
    <div className="flex flex-col gap-4 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Factory className="w-4 h-4" /> Đơn cho nhà máy (nhà cung cấp nội bộ)</h3>
        <button className={ghost} onClick={load}><RefreshCw className="w-3.5 h-3.5 inline" /> Tải lại</button>
      </div>
      {error && <div className="text-rose-600">{error}</div>}
      {data && data.outbox_pending.n > 0 && (
        <div className="text-amber-700 dark:text-amber-400">
          {data.outbox_pending.n} thông điệp đang chờ gửi sang nhà máy{data.outbox_pending.last_error ? `: ${data.outbox_pending.last_error}` : ""}.
        </div>
      )}

      {data && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <div className="font-bold mb-2">PO của nhà máy</div>
          {data.pos.length === 0 && <p className="text-slate-400">Chưa có PO nào cho nhà cung cấp nội bộ. Khai báo nhà cung cấp nội bộ bên dưới, rồi lập PO như thường lệ.</p>}
          <div className="flex flex-col gap-2">
            {data.pos.map((p) => (
              <div key={p.id} className="p-2 rounded-lg border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
                <div className="flex flex-wrap gap-2 items-center">
                  <b className="font-mono">{p.po_code}</b> · {p.supplier_name} ({data.units[p.factory_unit]}) · PO: {p.status}
                  {p.sent ? (
                    <span className="px-2 rounded-full bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300">
                      {FACTORY_STATUS[p.factory_status ?? ""] ?? p.factory_status}
                      {p.factory_order_code && ` · ${p.factory_order_code}`}
                      {p.committed_date && ` · cam kết ${String(p.committed_date).slice(0, 10)}`}
                    </span>
                  ) : (
                    sending !== p.id && <button className={ghost} onClick={() => setSending(p.id)}>Gửi nhà máy…</button>
                  )}
                  {p.ship_mode === "DROP_SHIP" && <span>· Giao thẳng: {p.ship_to?.name}</span>}
                  {p.reject_reason && <span className="text-rose-600">· Lý do từ chối: {p.reject_reason}</span>}
                  {p.sent && String(p.status).toUpperCase() === "CANCELLED" && p.factory_status !== "CANCEL_REQUESTED" && (
                    <button className={ghost} onClick={async () => { try { await call({ action: "notify_cancel", po_id: p.id, reason: window.prompt("Lý do hủy:") || "" }); load(); } catch (e: any) { window.alert(e.message); } }}>
                      Báo hủy cho nhà máy
                    </button>
                  )}
                </div>
                {sending === p.id && <SendForm poId={p.id} onDone={() => { setSending(null); load(); }} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {data && data.shipments.length > 0 && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <div className="font-bold mb-2">Hàng nhà máy giao</div>
          <div className="flex flex-col gap-2">
            {data.shipments.map((s) => (
              <div key={s.id} className="p-2 rounded-lg border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
                <div>
                  <b className="font-mono">{s.shipment_code}</b> · PO {s.po_code} · {s.ship_mode === "DROP_SHIP" ? `Giao thẳng ${s.ship_to?.name ?? ""}` : "Về kho KD"} ·{" "}
                  {s.status === "RECEIVED" ? `Đã nhập ${s.inbound_code}` : s.status === "DELIVERED" ? `Đã giao khách (biên bản: ${s.proof_file_name})` : "Chờ nhận"}
                </div>
                <ul className="pl-3 list-disc">
                  {s.lines.map((l: any, i: number) => (
                    <li key={i}>{l.product_code} — {l.quantity} {l.unit} · lô {l.lot_number ?? "—"} · HSD {l.expiry_date ?? "—"}</li>
                  ))}
                </ul>
                {s.status !== "RECEIVED" && <ReceiveShipment s={s} onDone={load} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {data && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
          <div className="font-bold mb-2">Nhà cung cấp nội bộ</div>
          <p className="text-slate-500 mb-2">Gắn nhà cung cấp với phòng sản xuất của nhà máy. PO cho nhà cung cấp này sẽ được gửi sang phòng đó.</p>
          <div className="grid gap-1 max-h-64 overflow-auto">
            {data.suppliers.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <span className="w-24 font-mono">{s.supplier_code}</span>
                <span className="flex-1 truncate">{s.name}</span>
                <select
                  className={input}
                  value={unitOf(s.id)}
                  onChange={async (e) => {
                    try {
                      await call({ action: "set_internal_supplier", supplier_id: s.id, factory_unit: e.target.value || null });
                      load();
                    } catch (x: any) {
                      window.alert(x.message);
                    }
                  }}
                >
                  <option value="">— không phải nhà máy —</option>
                  {Object.entries(data.units).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
