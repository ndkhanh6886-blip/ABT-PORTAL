"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export interface Scale {
  code: string;
  label: string;
  synth_nmol: number;
}
export const useScales = () => useQuery({ queryKey: ["factory", "oligo-scales"], queryFn: () => api<Scale[]>("/api/factory/oligo/scales"), staleTime: 300_000 });

export const PURIFICATION = { DESALT: "Desalt", OPC: "OPC", HPLC: "HPLC", PAGE: "PAGE" } as const;
export const FORMAT = { LYOPHILIZED: "Đông khô", LIQUID: "Dung dịch" } as const;
export const PRODUCT = { PRIMER: "Primer", PROBE: "Probe", AMPLICON_LINEAR: "Amplicon", AMPLICON_PLASMID: "Plasmid" } as const;
export const SEQ_STATUS: Record<string, [string, string]> = {
  PENDING: ["QUARANTINE", "Chờ tổng hợp"],
  SPLIT: ["EXPIRED", "Đã tách ống"],
  POOLED: ["PENDING_QC", "Đã gộp"],
  QUEUED: ["PENDING_QC", "Đã xếp mẻ"],
  SYNTHESIZING: ["PENDING_QC", "Đang tổng hợp"],
  SYNTHESIZED: ["PENDING_QC", "Đã tổng hợp"],
  POST_PROCESSING: ["PENDING_QC", "Hậu tổng hợp"],
  QC: ["PENDING_QC", "Đang QC"],
  COMPLETED: ["RELEASED", "Hoàn thành"],
  DELIVERED: ["RELEASED", "Đã giao"],
  FAILED: ["REJECTED", "Lỗi"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
};
export const ORDER_STATUS: Record<string, [string, string]> = {
  PENDING: ["QUARANTINE", "Chờ"],
  IN_PROGRESS: ["PENDING_QC", "Đang thực hiện"],
  COMPLETED: ["RELEASED", "Hoàn thành"],
  DELIVERED: ["RELEASED", "Đã giao"],
  FAILED: ["REJECTED", "Lỗi"],
  CANCELLED: ["EXPIRED", "Đã hủy"],
};

export interface OligoUnit { id: string; code: string; name: string }
export const useOligoUnits = (perm: string) =>
  useQuery({ queryKey: ["factory", "oligo-units", perm], queryFn: () => api<OligoUnit[]>(`/api/factory/oligo/units?perm=${perm}`), staleTime: 300_000 });

export const BATCH_STATUS: Record<string, [string, string]> = {
  PLANNED: ["QUARANTINE", "Đã lập kế hoạch"],
  RUNNING: ["PENDING_QC", "Đang chạy"],
  COMPLETED: ["RELEASED", "Hoàn thành"],
  CANCELLED: ["CANCELLED", "Đã hủy"],
  ABORTED: ["REJECTED", "Dừng giữa chừng"],
};
