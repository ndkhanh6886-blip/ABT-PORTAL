"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { HeartHandshake, Plus, CalendarClock, Search, Pencil, Trash2, Star, Paperclip, CheckCircle2 } from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { AttachmentPicker, AttachmentList, type Attachment } from "@/frontend/components/AttachmentPicker";
import { todayVN } from "@/backend/services/dates";

export const TECH_CARE_TYPES = [
    "Gọi hỏi thăm định kỳ",
    "Đào tạo / hướng dẫn sử dụng",
    "Hỗ trợ kỹ thuật từ xa",
    "Tư vấn quy trình / tối ưu xét nghiệm",
    "Thăm khách hàng tại chỗ",
    "Thu thập phản hồi / khảo sát hài lòng",
    "Khác",
];

type Log = {
    id: number; customer_id?: number | null; customer_name: string; contact_name?: string | null; activity_type: string;
    activity_date: string; content: string; satisfaction?: number | null; performed_by?: string | null;
    attachments?: Attachment[]; next_followup_date?: string | null; next_followup_note?: string | null; followup_done?: boolean;
};

const ymd = (v: any) => (v ? String(v).slice(0, 10) : "");
const vn = (v: any) => { const s = ymd(v); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ""; };
const emptyForm = (performer: string) => ({
    id: 0, customer_name: "", contact_name: "", activity_type: TECH_CARE_TYPES[0], activity_date: todayVN(), content: "",
    satisfaction: 0, performed_by: performer, attachments: [] as Attachment[], next_followup_date: "", next_followup_note: "",
    completes_followup_of: 0,
});

/** Nhật ký chăm sóc khách hàng về kỹ thuật (không gắn với hỏng máy): gọi hỏi thăm, đào tạo, hỗ trợ từ xa... + lịch hẹn chăm sóc tiếp. */
export function TechCareLog({ currentUserName, showToast }: { currentUserName: string; showToast: (m: string, t?: any) => void }) {
    const [logs, setLogs] = useState<Log[]>([]);
    const [due, setDue] = useState<Log[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState("");
    const [customers, setCustomers] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(() => emptyForm(currentUserName));
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch(`/api/application?action=tech_care&customer=${encodeURIComponent(search)}&type=${encodeURIComponent(typeFilter)}`);
            const d = await r.json().catch(() => ({}));
            if (r.ok) { setLogs(d.logs || []); setDue(d.due || []); }
        } finally { setLoading(false); }
    }, [search, typeFilter]);

    useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
    useEffect(() => {
        // gợi ý tên khách hàng (không có quyền xem Kinh doanh thì gõ tay)
        fetch("/api/sales?action=customers").then(r => (r.ok ? r.json() : null)).then(d => {
            if (d && Array.isArray(d.customers)) setCustomers(Array.from(new Set(d.customers.map((c: any) => String(c.name || "").trim()).filter(Boolean))) as string[]);
        }).catch(() => {});
    }, []);

    const today = todayVN();
    const dueGroups = useMemo(() => ({
        overdue: due.filter(x => ymd(x.next_followup_date) < today),
        today: due.filter(x => ymd(x.next_followup_date) === today),
        soon: due.filter(x => ymd(x.next_followup_date) > today),
    }), [due, today]);

    const openNew = (preset?: Partial<ReturnType<typeof emptyForm>>) => { setForm({ ...emptyForm(currentUserName), ...(preset || {}) }); setOpen(true); };
    const openEdit = (l: Log) => {
        setForm({
            id: l.id, customer_name: l.customer_name, contact_name: l.contact_name || "", activity_type: l.activity_type,
            activity_date: ymd(l.activity_date), content: l.content, satisfaction: l.satisfaction || 0, performed_by: l.performed_by || "",
            attachments: Array.isArray(l.attachments) ? l.attachments : [], next_followup_date: ymd(l.next_followup_date),
            next_followup_note: l.next_followup_note || "", completes_followup_of: 0,
        });
        setOpen(true);
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.customer_name.trim() || !form.content.trim()) { showToast("Cần nhập khách hàng và nội dung chăm sóc", "error"); return; }
        if (form.next_followup_date && form.next_followup_date < form.activity_date) { showToast("Ngày hẹn chăm sóc tiếp phải sau ngày thực hiện", "error"); return; }
        setSaving(true);
        try {
            const r = await fetch("/api/application?action=tech_care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.success) { showToast(d.error || "Không lưu được nhật ký", "error"); return; }
            showToast(form.id ? "Đã cập nhật nhật ký chăm sóc" : "Đã ghi nhận lần chăm sóc kỹ thuật", "success");
            setOpen(false);
            load();
        } catch { showToast("Lỗi kết nối máy chủ", "error"); } finally { setSaving(false); }
    };

    const post = async (action: string, id: number, okMsg: string) => {
        const r = await fetch(`/api/application?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        if (r.ok) { showToast(okMsg, "success"); load(); } else showToast("Không thực hiện được", "error");
    };

    const input = "w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-primary/50";
    const label = "text-[11px] font-bold text-slate-400 uppercase";

    const DueRow = ({ x, tone }: { x: Log; tone: string }) => (
        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
            <div className="min-w-0">
                <div className="font-bold text-white truncate">{x.customer_name}</div>
                <div className="text-[11px] text-slate-300 truncate">{vn(x.next_followup_date)} · {x.next_followup_note || `Sau lần "${x.activity_type}"`}</div>
            </div>
            <div className="flex gap-1.5 shrink-0">
                <button type="button" onClick={() => openNew({ customer_name: x.customer_name, contact_name: x.contact_name || "", completes_followup_of: x.id, content: x.next_followup_note || "" })}
                    className="px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-[11px] cursor-pointer">Ghi nhận lần chăm sóc</button>
                <button type="button" onClick={() => post("tech_care_followup_done", x.id, "Đã bỏ lịch hẹn")}
                    className="px-2.5 py-1 rounded-lg border border-white/15 text-slate-300 hover:bg-white/10 text-[11px] cursor-pointer" title="Không cần chăm sóc lần này">Bỏ hẹn</button>
            </div>
        </div>
    );

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-black text-white flex items-center gap-2"><HeartHandshake className="w-4 h-4 text-teal-400" /> Nhật ký chăm sóc khách hàng về kỹ thuật</h3>
                    <p className="text-[11px] text-slate-400">Gọi hỏi thăm, đào tạo, hỗ trợ từ xa, tư vấn quy trình, thu thập phản hồi... Hiện cả trên dòng thời gian hoạt động của khách hàng.</p>
                </div>
                <button type="button" onClick={() => openNew()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs cursor-pointer">
                    <Plus className="w-4 h-4" /> Ghi nhận chăm sóc
                </button>
            </div>

            {due.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 space-y-2">
                    <div className="text-xs font-bold text-white flex items-center gap-1.5"><CalendarClock className="w-4 h-4 text-amber-400" /> Lịch hẹn chăm sóc (quá hạn & 7 ngày tới)</div>
                    {dueGroups.overdue.map(x => <DueRow key={x.id} x={x} tone="border-rose-500/40 bg-rose-500/10" />)}
                    {dueGroups.today.map(x => <DueRow key={x.id} x={x} tone="border-amber-500/40 bg-amber-500/10" />)}
                    {dueGroups.soon.map(x => <DueRow key={x.id} x={x} tone="border-white/10 bg-white/5" />)}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Tìm theo khách hàng..." className={`${input} pl-9`} />
                </div>
                <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={`${input} w-auto`}>
                    <option value="">Tất cả loại hoạt động</option>
                    {TECH_CARE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>

            <div className="rounded-2xl border border-white/10 overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="bg-white/5 text-slate-400 text-[10px] uppercase">
                        <tr>
                            <th className="text-left p-3">Ngày</th><th className="text-left p-3">Khách hàng</th><th className="text-left p-3">Hoạt động</th>
                            <th className="text-left p-3">Nội dung</th><th className="text-left p-3">Hài lòng</th><th className="text-left p-3">Người thực hiện</th>
                            <th className="text-left p-3">Hẹn tiếp</th><th className="p-3"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.length === 0 && (
                            <tr><td colSpan={8} className="p-8 text-center text-slate-500">{loading ? "Đang tải..." : "Chưa có nhật ký chăm sóc kỹ thuật nào."}</td></tr>
                        )}
                        {logs.map(l => (
                            <tr key={l.id} className="border-t border-white/5 align-top hover:bg-white/5">
                                <td className="p-3 whitespace-nowrap text-slate-300">{vn(l.activity_date)}</td>
                                <td className="p-3 font-bold text-white">{l.customer_name}{l.contact_name && <div className="text-[10px] font-normal text-slate-400">{l.contact_name}</div>}</td>
                                <td className="p-3 text-teal-300 whitespace-nowrap">{l.activity_type}</td>
                                <td className="p-3 text-slate-300 max-w-[360px]">
                                    <div className="whitespace-pre-wrap break-words">{l.content}</div>
                                    {Array.isArray(l.attachments) && l.attachments.length > 0 && (
                                        <details className="mt-1"><summary className="text-[10px] text-indigo-300 cursor-pointer flex items-center gap-1"><Paperclip className="w-3 h-3" /> {l.attachments.length} tệp</summary>
                                            <div className="mt-1"><AttachmentList files={l.attachments} /></div></details>
                                    )}
                                </td>
                                <td className="p-3 whitespace-nowrap">{l.satisfaction ? <span className="text-amber-400">{"★".repeat(l.satisfaction)}<span className="text-slate-600">{"★".repeat(5 - l.satisfaction)}</span></span> : <span className="text-slate-600">—</span>}</td>
                                <td className="p-3 text-slate-300 whitespace-nowrap">{l.performed_by || "—"}</td>
                                <td className="p-3 whitespace-nowrap">
                                    {l.next_followup_date ? (
                                        <span className={l.followup_done ? "text-slate-500 line-through" : ymd(l.next_followup_date) < today ? "text-rose-400 font-bold" : "text-amber-300"}>
                                            {vn(l.next_followup_date)}
                                        </span>
                                    ) : <span className="text-slate-600">—</span>}
                                    {l.followup_done && <CheckCircle2 className="inline w-3.5 h-3.5 ml-1 text-emerald-500" />}
                                </td>
                                <td className="p-3 whitespace-nowrap text-right">
                                    <button type="button" onClick={() => openEdit(l)} className="p-1 text-slate-400 hover:text-white cursor-pointer" title="Sửa"><Pencil className="w-3.5 h-3.5" /></button>
                                    <button type="button" onClick={() => { if (confirm(`Xóa nhật ký chăm sóc "${l.activity_type}" của ${l.customer_name}?`)) post("delete_tech_care", l.id, "Đã xóa nhật ký"); }}
                                        className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer" title="Xóa"><Trash2 className="w-3.5 h-3.5" /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal isOpen={open} onClose={() => setOpen(false)} title={form.id ? "SỬA NHẬT KÝ CHĂM SÓC KỸ THUẬT" : "GHI NHẬN CHĂM SÓC KHÁCH HÀNG VỀ KỸ THUẬT"} size="2xl">
                <form onSubmit={save} className="space-y-4 text-slate-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className={label}>Khách hàng / cơ sở y tế *</label>
                            <input required list="tech-care-customers" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} placeholder="Gõ để tìm khách hàng" className={input} />
                            <datalist id="tech-care-customers">{customers.map(c => <option key={c} value={c} />)}</datalist>
                        </div>
                        <div className="space-y-1">
                            <label className={label}>Người liên hệ</label>
                            <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} placeholder="BS / KTV, SĐT" className={input} />
                        </div>
                        <div className="space-y-1">
                            <label className={label}>Loại hoạt động *</label>
                            <select value={form.activity_type} onChange={e => setForm({ ...form, activity_type: e.target.value })} className={input}>
                                {TECH_CARE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className={label}>Ngày thực hiện</label>
                                <input type="date" value={form.activity_date} onChange={e => setForm({ ...form, activity_date: e.target.value })} className={input} />
                            </div>
                            <div className="space-y-1">
                                <label className={label}>Người thực hiện</label>
                                <input value={form.performed_by} onChange={e => setForm({ ...form, performed_by: e.target.value })} className={input} />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className={label}>Nội dung / kết quả chăm sóc *</label>
                        <textarea required rows={4} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })}
                            placeholder="Nội dung trao đổi, vấn đề khách nêu, hướng dẫn đã đưa, cam kết với khách..." className={input} />
                    </div>
                    <div className="space-y-1">
                        <label className={label}>Mức độ hài lòng của khách (nếu có)</label>
                        <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map(n => (
                                <button key={n} type="button" onClick={() => setForm({ ...form, satisfaction: form.satisfaction === n ? 0 : n })} className="p-0.5 cursor-pointer" title={`${n}/5`}>
                                    <Star className={`w-5 h-5 ${n <= form.satisfaction ? "text-amber-400 fill-amber-400" : "text-slate-600"}`} />
                                </button>
                            ))}
                            {form.satisfaction > 0 && <span className="text-[11px] text-slate-400 ml-1">{form.satisfaction}/5</span>}
                        </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                        <AttachmentPicker files={form.attachments} onChange={files => setForm({ ...form, attachments: files })} label="Tài liệu / hình ảnh" hint="Biên bản đào tạo, ảnh buổi hướng dẫn, phiếu khảo sát..." />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="space-y-1">
                            <label className={label}>Hẹn chăm sóc tiếp</label>
                            <input type="date" value={form.next_followup_date} onChange={e => setForm({ ...form, next_followup_date: e.target.value })} className={input} />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                            <label className={label}>Nội dung hẹn</label>
                            <input value={form.next_followup_note} onChange={e => setForm({ ...form, next_followup_note: e.target.value })} placeholder="VD: gọi lại kiểm tra kết quả sau khi đổi quy trình" className={input} />
                        </div>
                    </div>
                    <div className="flex gap-3 pt-3 border-t border-white/5">
                        <button type="button" onClick={() => setOpen(false)} className="flex-1 py-2.5 bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5 font-bold rounded-xl text-xs cursor-pointer">Hủy</button>
                        <button type="submit" disabled={saving} className="flex-2 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white font-bold rounded-xl text-xs cursor-pointer">
                            {saving ? "Đang lưu..." : form.id ? "Lưu thay đổi" : "Ghi nhận"}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
