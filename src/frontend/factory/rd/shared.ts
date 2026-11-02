"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export interface RdContextData {
  units: { id: string; code: string; name: string; module_key: string }[];
  targetUnits: { id: string; code: string; name: string; module_key: string }[];
  goals: { id: string; code: string; name: string; period: string; description: string | null; status: string; idea_count: number }[];
  criteria: { id: string; eval_type: "TECH" | "BIZ"; code: string; name: string; weight: number; scale_max: number; status: string; version: number }[];
  templates: { id: string; code: string; name: string; domain: string; items: { id: string; gate_no: number; gate_name: string; stage_after: string; seq: number; item_name: string; doc_type: string; is_required: boolean }[] }[];
  warehouses: { id: string; code: string; name: string; owner_org_unit_id: string; purpose: string }[];
  locations: { id: string; warehouse_id: string; code: string; name: string; temperature_condition: string; is_quarantine: boolean }[];
  items: { id: string; code: string; name: string; item_type: string; base_uom: string }[];
  rd_staff?: { name: string; role: string; specialty: string; user_id?: number | null }[];
}

export function useRdContext(perm = "rd.view") {
  return useQuery({
    queryKey: ["factory", "rd", "context", perm],
    queryFn: () => api<RdContextData>(`/api/factory/rd/units?perm=${perm}`),
  });
}

export const DOMAIN_LABEL: Record<string, string> = {
  KIT: "Kit Chẩn đoán IVD / PCR",
  OLIGO: "Oligonucleotide / Probe",
  DEVICE: "Thiết bị Y tế / Lab",
  SOFTWARE: "Phần mềm & Thuật toán Y sinh",
  OTHER: "Nghiên cứu cơ bản / Khác",
};

export const IVD_CLASS_LABEL: Record<string, string> = {
  CLASS_A: "IVD Loại A",
  CLASS_B: "IVD Loại B",
  CLASS_C: "IVD Loại C",
  CLASS_D: "IVD Loại D",
  RUO: "RUO (Chỉ dùng nghiên cứu)",
  NA: "Không áp dụng",
};
