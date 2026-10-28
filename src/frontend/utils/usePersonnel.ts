"use client";

import { useEffect, useState } from "react";

export interface PersonnelRecord {
  employee_code?: string;
  full_name: string;
  department?: string;
  position?: string;
  email?: string;
  phone?: string;
  status?: string;
}

/** Danh sách nhân sự đang hoạt động lấy từ Cài Đặt → Nhân sự (bảng personnel) */
export const usePersonnel = (): PersonnelRecord[] => {
  const [personnel, setPersonnel] = useState<PersonnelRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/settings?action=overview");
        if (!res.ok) return;
        const data = await res.json();
        const list = (Array.isArray(data.personnel) ? data.personnel : []).filter(
          (p: any) => String(p?.full_name || "").trim() && p.status !== "INACTIVE"
        );
        if (!cancelled) setPersonnel(list);
      } catch (err) {
        console.error("Failed to load personnel:", err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return personnel;
};

/** Nhân sự có phòng ban hoặc chức vụ chứa một trong các từ khóa (không phân biệt hoa thường) */
export const filterPersonnelByDept = (personnel: PersonnelRecord[], keywords: string[]) =>
  personnel.filter(p => {
    const text = `${p.department || ""} ${p.position || ""}`.toLowerCase();
    return keywords.some(k => text.includes(k));
  });
