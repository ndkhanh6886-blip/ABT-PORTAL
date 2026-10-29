"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, useFactoryMe } from "../api";
import { Button, Card, ErrorNote, Field, inputClass } from "../ui";

/** One's own e-signature PIN: re-enter the login password, then a 6–8 digit PIN. */
export function PinView() {
  const me = useFactoryMe();
  const qc = useQueryClient();
  const [form, setForm] = useState({ password: "", pin: "", confirm: "" });
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      if (form.pin !== form.confirm) throw new Error("Hai lần nhập PIN không khớp.");
      return api("/api/factory/me/pin", { method: "POST", json: { password: form.password, pin: form.pin } });
    },
    onSuccess: () => {
      setForm({ password: "", pin: "", confirm: "" });
      setDone(true);
      qc.invalidateQueries({ queryKey: ["factory", "me"] });
    },
  });

  return (
    <Card title="Mã PIN chữ ký điện tử">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 max-w-2xl">
        PIN dùng để ký các bước quan trọng (thực hiện, kiểm tra, phê duyệt, giải phóng lô). Mỗi chữ ký gắn với nội dung bản ghi lúc ký:
        nếu bản ghi bị sửa sau đó, chữ ký tự mất hiệu lực. Nhập sai nhiều lần sẽ tạm khóa chữ ký. Không chia sẻ PIN cho người khác.
      </p>
      <p className="text-xs mb-3">
        Trạng thái:{" "}
        <b className={me.data?.profile.has_pin ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
          {me.data?.profile.has_pin ? "Đã đặt PIN" : "Chưa đặt PIN"}
        </b>
      </p>
      <form
        className="grid gap-3 sm:grid-cols-3 max-w-3xl items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(false);
          save.mutate();
        }}
      >
        <Field label="Mật khẩu đăng nhập ABT Portal *">
          <input className={inputClass} type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </Field>
        <Field label="PIN mới (6–8 chữ số) *" hint="Không dùng số lặp lại hoặc liên tiếp">
          <input className={inputClass} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} required />
        </Field>
        <Field label="Nhập lại PIN *">
          <input className={inputClass} type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value.replace(/\D/g, "") })} required />
        </Field>
        <div className="sm:col-span-3 flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Đang lưu…" : me.data?.profile.has_pin ? "Đổi PIN" : "Đặt PIN"}</Button>
          {done && <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">Đã lưu PIN chữ ký.</span>}
        </div>
        <div className="sm:col-span-3"><ErrorNote error={save.error} /></div>
      </form>
    </Card>
  );
}
