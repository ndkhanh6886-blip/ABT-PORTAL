"use client";

import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { Button, Card, ErrorNote, Table } from "../ui";

interface Row {
  line: number;
  name: string | null;
  input: string;
  error?: string;
  result?: {
    normalized: string;
    length: number;
    gc_percent: number;
    molecule_type: string;
    product_type: string;
    mw: number;
    ext_coeff_260: number;
    nmol_per_od: number;
    ug_per_od: number;
    tm: number;
    modifications: string[];
    warnings: string[];
  };
}

const TYPE: Record<string, string> = { PRIMER: "Primer", PROBE: "Probe", AMPLICON: "Amplicon" };
const num = (v: number, d = 2) => v.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Paste sequences (one per line, optionally "name<TAB>sequence") and get MW, ε260, nmol/OD, µg/OD, Tm. */
export function CalculatorView() {
  const [text, setText] = useState("");
  const run = useMutation({ mutationFn: () => api<Row[]>("/api/factory/oligo/analyze", { method: "POST", json: { text } }) });
  const copy = () => {
    if (!run.data) return;
    const head = ["Tên", "Trình tự chuẩn hóa", "Độ dài", "GC%", "Loại", "MW", "ε260", "nmol/OD", "µg/OD", "Tm (°C)"].join("\t");
    const body = run.data
      .filter((r) => r.result)
      .map((r) => [r.name ?? "", r.result!.normalized, r.result!.length, r.result!.gc_percent, TYPE[r.result!.product_type], r.result!.mw, r.result!.ext_coeff_260, r.result!.nmol_per_od, r.result!.ug_per_od, r.result!.tm].join("\t"));
    void navigator.clipboard?.writeText([head, ...body].join("\n"));
  };

  return (
    <Card title="Tính thông số trình tự">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
        Mỗi dòng một trình tự, có thể kèm tên: <code>Tên⇥Trình tự</code> hoặc <code>Tên; Trình tự</code>. Modification viết <code>/FAM/</code>, <code>/BHQ1/</code> hoặc
        cách nhau bằng gạch ngang (<code>5'-FAM-ATGC-BHQ1-3'</code>); LNA <code>+A</code>, 2'-OMe <code>mA</code>, 2'-F <code>fA</code>, <code>5mC</code>, base suy biến IUPAC và
        inosine <code>I</code>. Công thức giống OligoFlow cũ (Na⁺ 50 mM, oligo 0,25 µM).
      </p>
      <textarea
        className="w-full min-h-36 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 font-mono text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
        placeholder={"Primer F\tATGCTTTAGCAGGACAGTC\nProbe 1\t/FAM/ATGCTTTAGCAGGAC/BHQ1/"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="flex gap-2 my-3">
        <Button onClick={() => run.mutate()} disabled={run.isPending || !text.trim()}>{run.isPending ? "Đang tính…" : "Tính"}</Button>
        {run.data && <Button variant="ghost" onClick={copy}>Sao chép bảng (dán vào Excel)</Button>}
      </div>
      <ErrorNote error={run.error} />
      {run.data && (
        <Table head={["#", "Tên", "Trình tự chuẩn hóa", "Dài", "GC%", "Loại", "MW", "ε260", "nmol/OD", "µg/OD", "Tm °C"]}>
          {run.data.map((r) =>
            r.error ? (
              <tr key={r.line}>
                <td className="py-2 pr-3">{r.line}</td>
                <td className="py-2 pr-3">{r.name ?? ""}</td>
                <td colSpan={9} className="py-2 pr-3 text-rose-600 dark:text-rose-400">
                  <span className="font-mono">{r.input}</span> — {r.error}
                </td>
              </tr>
            ) : (
              <tr key={r.line}>
                <td className="py-2 pr-3 align-top">{r.line}</td>
                <td className="py-2 pr-3 align-top">{r.name ?? ""}</td>
                <td className="py-2 pr-3 align-top font-mono break-all">
                  {r.result!.normalized}
                  {r.result!.warnings.map((w, i) => (
                    <div key={i} className="font-sans text-[11px] text-amber-700 dark:text-amber-400">⚠ {w}</div>
                  ))}
                </td>
                <td className="py-2 pr-3 align-top text-right">{r.result!.length}</td>
                <td className="py-2 pr-3 align-top text-right">{num(r.result!.gc_percent, 1)}</td>
                <td className="py-2 pr-3 align-top whitespace-nowrap">{r.result!.molecule_type === "RNA" ? "RNA " : ""}{TYPE[r.result!.product_type]}</td>
                <td className="py-2 pr-3 align-top text-right whitespace-nowrap">{num(r.result!.mw)}</td>
                <td className="py-2 pr-3 align-top text-right whitespace-nowrap">{num(r.result!.ext_coeff_260, 0)}</td>
                <td className="py-2 pr-3 align-top text-right">{num(r.result!.nmol_per_od)}</td>
                <td className="py-2 pr-3 align-top text-right">{num(r.result!.ug_per_od)}</td>
                <td className="py-2 pr-3 align-top text-right">{num(r.result!.tm, 1)}</td>
              </tr>
            )
          )}
        </Table>
      )}
    </Card>
  );
}
