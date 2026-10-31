"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "./api";
import { Button, ErrorNote, Field, inputClass } from "./ui";

/** An action the server says the user may run now (GET …/{id} → actions). */
export interface AllowedAction {
  action: string;
  to: string;
  signature?: string;
  reasonRequired: boolean;
  blockedBy: string[];
}

const MEANING: Record<string, string> = { PERFORMED: "Thực hiện", CHECKED: "Kiểm tra", REVIEWED: "Xem xét", APPROVED: "Phê duyệt", RELEASED: "Giải phóng" };

/**
 * Buttons for a record's state-machine actions. Buttons come from the server (never inferred here);
 * a blocked action shows why; a reason / e-signature is asked for in a dialog before sending.
 */
export function ActionBar({
  endpoint,
  version,
  actions,
  labels,
  extraPayload,
  onDone,
}: {
  endpoint: string;
  version: number;
  actions: AllowedAction[];
  labels: Record<string, string>;
  extraPayload?: Record<string, unknown> | ((action: string) => Record<string, unknown> | undefined);
  onDone: () => void;
}) {
  const [open, setOpen] = useState<AllowedAction | null>(null);
  const [reason, setReason] = useState("");
  const [authMethod, setAuthMethod] = useState<"PIN" | "PASSWORD">("PIN");
  const [pin, setPin] = useState("");
  const run = useMutation({
    mutationFn: (a: AllowedAction) => {
      const payload = typeof extraPayload === "function" ? extraPayload(a.action) : extraPayload;
      return api(endpoint, {
        method: "POST",
        json: {
          action: a.action,
          expectedVersion: version,
          reason: reason || undefined,
          payload,
          credential: a.signature ? { method: authMethod, secret: pin } : undefined,
        },
      });
    },
    onSuccess: () => {
      setOpen(null);
      setReason("");
      setPin("");
      onDone();
    },
  });
  const start = (a: AllowedAction) => {
    run.reset();
    if (a.signature || a.reasonRequired) setOpen(a);
    else run.mutate(a);
  };

  if (!actions.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.action}
            variant={a.blockedBy.length ? "ghost" : "primary"}
            disabled={a.blockedBy.length > 0 || run.isPending}
            title={a.blockedBy.join(" ")}
            onClick={() => start(a)}
          >
            {labels[a.action] ?? a.action}
            {a.signature && " ✍"}
          </Button>
        ))}
      </div>
      {actions.filter((a) => a.blockedBy.length).map((a) => (
        <p key={a.action} className="text-[11px] text-amber-700 dark:text-amber-400">
          {labels[a.action] ?? a.action}: {a.blockedBy.join(" ")}
        </p>
      ))}
      {!open && <ErrorNote error={run.error} />}
      {open && (
        <form
          className="grid gap-2 sm:grid-cols-3 items-end p-3 rounded-xl border border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/30"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate(open);
          }}
        >
          <div className="sm:col-span-3 text-xs font-bold text-slate-700 dark:text-slate-200">
            {labels[open.action] ?? open.action}
            {open.signature && <span className="font-normal"> — ký điện tử với ý nghĩa “{MEANING[open.signature] ?? open.signature}”</span>}
          </div>
          {open.reasonRequired && (
            <Field label="Lý do *">
              <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
            </Field>
          )}
          {open.signature && (
            <Field
              label={authMethod === "PIN" ? "Mã PIN chữ ký điện tử cá nhân *" : "Mật khẩu đăng nhập *"}
              hint="Chọn ký bằng Mã PIN cá nhân hoặc Mật khẩu đăng nhập (Chuẩn 21 CFR Part 11)"
            >
              <div className="flex gap-1.5">
                <select
                  className={`${inputClass} w-28`}
                  value={authMethod}
                  onChange={(e) => {
                    const m = e.target.value as "PIN" | "PASSWORD";
                    setAuthMethod(m);
                    setPin("");
                  }}
                >
                  <option value="PIN">Mã PIN</option>
                  <option value="PASSWORD">Mật khẩu</option>
                </select>
                <input
                  className={inputClass}
                  type="password"
                  inputMode={authMethod === "PIN" ? "numeric" : "text"}
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  required
                  autoFocus={!open.reasonRequired}
                />
              </div>
            </Field>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(null)}>Hủy</Button>
            <Button type="submit" disabled={run.isPending}>{run.isPending ? "Đang gửi…" : "Xác nhận"}</Button>
          </div>
          <div className="sm:col-span-3"><ErrorNote error={run.error} /></div>
        </form>
      )}
    </div>
  );
}
