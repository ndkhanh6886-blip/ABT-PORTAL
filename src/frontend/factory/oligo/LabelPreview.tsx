"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, ErrorNote } from "../ui";
import { labelHtml, previewTubeLabels, printWithReprint } from "./labels";

/**
 * Tube labels of one or several sequences, viewable at any stage (values not measured yet stay empty).
 * Printing — which is recorded — is offered for the sequences whose OD has been measured.
 */
export function LabelPreview({ sequenceIds, canPrint, onClose }: { sequenceIds: string[]; canPrint: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const labels = useQuery({ queryKey: ["factory", "oligo-label-preview", sequenceIds.join(",")], queryFn: () => previewTubeLabels(sequenceIds) });
  const printableIds = [...new Set((labels.data ?? []).filter((l) => l.printable).map((l) => l.sequence_id))];
  const waiting = [...new Set((labels.data ?? []).filter((l) => !l.printable).map((l) => l.code))];
  const print = useMutation({
    mutationFn: () => printWithReprint(printableIds),
    onSuccess: () => ["oligo-label-preview", "oligo-delivery", "oligo-post-detail"].forEach((k) => qc.invalidateQueries({ queryKey: ["factory", k] })),
  });
  return (
    <Card title={`Nhãn ống (${labels.data?.length ?? 0} nhãn)`} actions={<Button variant="ghost" onClick={onClose}>Đóng</Button>}>
      <ErrorNote error={labels.error ?? print.error} />
      {labels.data && (
        <div className="flex flex-col gap-2">
          <iframe title="Xem trước nhãn" className="w-full h-80 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-200" srcDoc={labelHtml(labels.data, false)} />
          <div className="flex flex-wrap gap-2 items-center text-xs">
            {canPrint && printableIds.length > 0 && <Button onClick={() => print.mutate()} disabled={print.isPending}>In nhãn ({printableIds.length} trình tự)</Button>}
            {waiting.length > 0 && <span className="text-amber-700 dark:text-amber-400">Chưa in được (chưa đo OD ở hậu tổng hợp{waiting.length ? `: ${waiting.join(", ")}` : ""}). Nhãn đang hiện là bản xem trước.</span>}
            {!canPrint && printableIds.length > 0 && <span className="text-slate-500">Cần quyền in nhãn / giao Oligo để in.</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
