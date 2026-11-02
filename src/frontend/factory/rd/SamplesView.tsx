"use client";

import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  Dna,
  Download,
  FileText,
  Filter,
  Flame,
  History,
  MapPin,
  Microscope,
  Plus,
  Search,
  Snowflake,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../api";
import { Empty } from "../ui";

const apiGet = <T,>(path: string) => api<T>(path);
const apiPost = <T,>(path: string, payload: unknown) => api<T>(path, { method: "POST", json: payload });

interface ClinicalSpecimenItem {
  id: string;
  patientId: string;
  diagnosis: string;
  volume: number;
  unit: string;
  status: string;
  location?: string;
}

interface SampleGrowthHistoryItem {
  id: string;
  date: string;
  action: string;
  performer: string;
  details: string;
  resultVolume?: string;
}

interface NormalizedSample {
  dbId: string;
  id: string; // Display code e.g. SMP-001
  orgUnitId: string;
  orgUnitName: string;
  name: string;
  category: string;
  sampleType: string;
  target: string;
  concentration: string;
  referenceCt: number | null;
  volume: number;
  initialVolume: number;
  unit: string;
  location: string;
  warehouseId: string | null;
  locationId: string | null;
  source: string;
  date: string;
  status: string; // QC status: "Đạt tiêu chuẩn" | "Chờ kiểm định" | "Cần kiểm tra lại" | "Hết mẫu"
  biobankStatus: string; // STORED | IN_USE | DEPLETED | DISPOSED
  biosafetyLevel: string;
  freezeThawCount: number;
  maxFreezeThaw: number;
  thawWarning: boolean;
  coaName: string | null;
  growthStatus: "Stock" | "Activated" | "Culturing" | "Degraded";
  parentId?: string | null;
  parentCode?: string | null;
  parentName?: string | null;
  lineageType?: "culture" | "aliquot" | "extraction" | null;
  specimens?: ClinicalSpecimenItem[];
  growthHistory: SampleGrowthHistoryItem[];
}

function mapRowToSample(r: any): NormalizedSample {
  const meta = r.metadata || {};
  const vol = Number(r.current_volume ?? 0);
  let category = meta.category;
  if (!category) {
    switch (r.sample_type) {
      case "BLOOD":
      case "SERUM_PLASMA":
      case "SWAB":
        category = "Bệnh phẩm";
        break;
      case "STRAIN":
        category = "Vi khuẩn chuẩn";
        break;
      case "DNA":
        category = "DNA chuẩn";
        break;
      case "RNA":
        category = "RNA";
        break;
      case "PLASMID":
        category = "Plasmid chứng dương";
        break;
      case "CONTROL_PANEL":
        category = "Panel ngoại kiểm";
        break;
      default:
        category = "Bệnh phẩm";
    }
  }
  const qcStatus =
    vol <= 0 || r.status === "DEPLETED" || r.status === "DISPOSED"
      ? "Hết mẫu"
      : meta.qcStatus || "Đạt tiêu chuẩn";

  const concentration =
    meta.concentration ||
    (r.reference_ct != null ? `Ct = ${r.reference_ct}` : "Chưa xác định");

  const locParts = [
    r.warehouse_code,
    r.location_code ? `${r.location_code}${r.temperature_condition ? ` (${r.temperature_condition})` : ""}` : null,
    r.box_position || meta.locationText,
  ].filter(Boolean);

  const location = meta.locationText || r.box_position || locParts.join(" · ") || "Chưa gán vị trí";

  const dateStr = r.collected_at
    ? String(r.collected_at).slice(0, 10)
    : r.created_at
      ? String(r.created_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10);

  const history: SampleGrowthHistoryItem[] =
    Array.isArray(meta.growthHistory) && meta.growthHistory.length > 0
      ? meta.growthHistory
      : [
          {
            id: `GH-INIT-${r.id}`,
            date: dateStr,
            action: "Khởi tạo",
            performer: "Nghiên cứu viên R&D",
            details: `Tiếp nhận mẫu sinh học từ ${r.source || "nguồn cung cấp"}`,
            resultVolume: `${r.initial_volume ?? vol} ${r.uom || "mL"}`,
          },
        ];

  return {
    dbId: r.id,
    id: r.code || r.id,
    orgUnitId: r.org_unit_id,
    orgUnitName: r.org_unit_name || "Phòng Nghiên cứu & Phát triển (R&D)",
    name: r.name,
    category,
    sampleType: r.sample_type,
    target: r.target_pathogen || "Chưa xác định",
    concentration,
    referenceCt: r.reference_ct != null ? Number(r.reference_ct) : null,
    volume: vol,
    initialVolume: Number(r.initial_volume ?? vol),
    unit: r.uom === "mL" ? "ml" : r.uom === "µL" ? "ul" : r.uom || "ml",
    location,
    warehouseId: r.warehouse_id || null,
    locationId: r.location_id || null,
    source: r.source || "Không rõ",
    date: dateStr,
    status: qcStatus,
    biobankStatus: r.status || "STORED",
    biosafetyLevel: r.biosafety_level || "BSL2",
    freezeThawCount: Number(r.freeze_thaw_count ?? 0),
    maxFreezeThaw: Number(r.max_freeze_thaw ?? 3),
    thawWarning: Boolean(r.thaw_warning),
    coaName: meta.coaName || null,
    growthStatus: meta.growthStatus || "Stock",
    parentId: meta.parentId || null,
    parentCode: meta.parentCode || null,
    parentName: meta.parentName || null,
    lineageType: meta.lineageType || null,
    specimens: Array.isArray(meta.specimens) ? meta.specimens : undefined,
    growthHistory: history,
  };
}

export function SamplesView({ canManage = true }: { canManage?: boolean } = {}) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ text: string; kind: "ok" | "err" } | null>(null);
  const showToast = (text: string, kind: "ok" | "err" = "ok") => setMsg({ text, kind });
  void canManage;

  const q = useQuery({
    queryKey: ["factory", "rd", "samples"],
    queryFn: () => apiGet<any[]>("/api/factory/rd/samples"),
  });
  const orgUnits = useQuery({
    queryKey: ["factory", "org-units"],
    queryFn: () => apiGet<any[]>("/api/factory/org-units"),
  });
  const projects = useQuery({
    queryKey: ["factory", "rd", "projects"],
    queryFn: () => apiGet<any[]>("/api/factory/rd/projects"),
  });
  const experiments = useQuery({
    queryKey: ["factory", "rd", "eln"],
    queryFn: () => apiGet<any[]>("/api/factory/rd/eln"),
  });

  const rdUnits = useMemo(() => {
    const all = orgUnits.data ?? [];
    const filtered = all.filter(
      (u: any) => u.code?.includes("RD") || u.name?.toLowerCase().includes("nghiên cứu") || u.code === "KHOI-SX"
    );
    return filtered.length ? filtered : all;
  }, [orgUnits.data]);

  const samples: NormalizedSample[] = useMemo(() => (q.data ?? []).map(mapRowToSample), [q.data]);
  const rdProjects = projects.data ?? [];

  // Filter & Search States (matching old R&D software)
  const [sampleCategoryFilter, setSampleCategoryFilter] = useState("Tất Cả");
  const [sampleStatusFilter, setSampleStatusFilter] = useState("Tất Cả");
  const [sampleSearchTerm, setSampleSearchTerm] = useState("");

  // Modals States
  const [isSampleModalOpen, setIsSampleModalOpen] = useState(false);
  const [selectedDbId, setSelectedDbId] = useState<string | null>(null);
  const [isSampleDetailModalOpen, setIsSampleDetailModalOpen] = useState(false);
  const [isProliferateModalOpen, setIsProliferateModalOpen] = useState(false);
  const [isUseSampleModalOpen, setIsUseSampleModalOpen] = useState(false);
  const [isCreateChildModalOpen, setIsCreateChildModalOpen] = useState(false);
  const [isImportSpecimensModalOpen, setIsImportSpecimensModalOpen] = useState(false);
  const [isAddSingleSpecimenModalOpen, setIsAddSingleSpecimenModalOpen] = useState(false);
  const [isConsumeSpecimenModalOpen, setIsConsumeSpecimenModalOpen] = useState(false);
  const [activeSpecimenToConsume, setActiveSpecimenToConsume] = useState<ClinicalSpecimenItem | null>(null);

  // Registration Form States
  const [regCategory, setRegCategory] = useState("Bệnh phẩm");
  const [useBatchImport, setUseBatchImport] = useState(false);
  const [batchSpecimensText, setBatchSpecimensText] = useState("");
  const [importSpecimensText, setImportSpecimensText] = useState("");

  // Child Sample Creation States
  const [isMultipleTubes, setIsMultipleTubes] = useState(false);
  const [tubeCountInput, setTubeCountInput] = useState<number>(2);
  const [inoculumInput, setInoculumInput] = useState<string>("");

  const importInputRef = useRef<HTMLInputElement | null>(null);

  const activeSampleDetail = useMemo(
    () => samples.find((s) => s.dbId === selectedDbId || s.id === selectedDbId) ?? null,
    [samples, selectedDbId]
  );

  const filteredSamples = useMemo(() => {
    return samples.filter((s) => {
      const matchCat = sampleCategoryFilter === "Tất Cả" || s.category === sampleCategoryFilter;
      const matchStatus =
        sampleStatusFilter === "Tất Cả" ||
        (sampleStatusFilter === "Hết mẫu" ? s.volume <= 0 || s.status === "Hết mẫu" : s.status === sampleStatusFilter);
      const qStr = sampleSearchTerm.trim().toLowerCase();
      const matchSearch =
        !qStr ||
        s.name.toLowerCase().includes(qStr) ||
        s.target.toLowerCase().includes(qStr) ||
        s.id.toLowerCase().includes(qStr) ||
        s.source.toLowerCase().includes(qStr) ||
        s.location.toLowerCase().includes(qStr);
      return matchCat && matchStatus && matchSearch;
    });
  }, [samples, sampleCategoryFilter, sampleStatusFilter, sampleSearchTerm]);

  // Helper: Download COA File
  const handleDownloadCOA = (sample: NormalizedSample) => {
    const content = `CHỨNG NHẬN PHÂN TÍCH CHẤT LƯỢNG MẪU SINH HỌC (COA)
=========================================================
Mã mẫu hệ thống: ${sample.id}
Tên mẫu / Chủng: ${sample.name}
Phân loại: ${sample.category}
Tác nhân đích (Target): ${sample.target}
Nồng độ / Mật độ / Giá trị Ct: ${sample.concentration}
Thể tích hiện tại: ${sample.volume} ${sample.unit} (Ban đầu: ${sample.initialVolume} ${sample.unit})
Nguồn gốc: ${sample.source}
Ngày tiếp nhận: ${sample.date}
Vị trí bảo quản: ${sample.location}
An toàn sinh học: ${sample.biosafetyLevel} (Chu kỳ rã đông: ${sample.freezeThawCount}/${sample.maxFreezeThaw})
Trạng thái QC: ${sample.status}
Trạng thái sinh trưởng: ${sample.growthStatus}
=========================================================
LỊCH SỬ NUÔI CẤY & TIÊU HAO:
${sample.growthHistory.map((h) => `- [${h.date}] ${h.action} (${h.performer}): ${h.details} (Tồn: ${h.resultVolume || "N/A"})`).join("\n")}

Hệ thống Quản trị R&D & Biobank ABT - Xác nhận điện tử.`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sample.coaName ? sample.coaName.replace(/\.[^/.]+$/, ".txt") : `COA_${sample.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã tải xuống chứng nhận COA cho mẫu ${sample.id}`);
  };

  // Helper: Export Samples List to Excel
  const handleExportSamplesExcel = () => {
    try {
      const exportData = samples.map((s) => ({
        "Mã Mẫu": s.id,
        "Tên Mẫu": s.name,
        "Phân Loại": s.category,
        "Tác Nhân Đích": s.target,
        "Nồng Độ / Mật Độ": s.concentration,
        "Thể Tích Hiện Tại": s.volume,
        "Đơn Vị": s.unit,
        "Vị Trí Bảo Quản": s.location,
        "Nguồn Gốc": s.source,
        "Ngày Thu Nhận": s.date,
        "Trạng Thái QC": s.status,
        "Trạng Thái Sinh Trưởng": s.growthStatus || "Stock",
        "Số Lần Rã Đông": `${s.freezeThawCount}/${s.maxFreezeThaw}`,
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Danh_Sach_Mau");
      XLSX.writeFile(wb, `Danh_Sach_Nguon_Mau_RD_${new Date().toISOString().substring(0, 10)}.xlsx`);
      showToast("Đã xuất danh sách nguồn mẫu ra file Excel thành công!");
    } catch {
      showToast("Có lỗi xảy ra khi xuất file Excel.", "err");
    }
  };

  // Helper: Download Clinical Specimen Template Excel
  const handleDownloadSpecimenTemplate = () => {
    try {
      const templateData = [
        {
          "Mã Mẫu": "CL-SARS-001",
          "Mã Bệnh Nhân": "BN-901",
          "Kết Quả / Ct": "Dương tính (Ct=22.4)",
          "Thể Tích": 0.5,
          "Vị Trí (Tùy chọn)": "Hộp S-1, Ô A1",
        },
        {
          "Mã Mẫu": "CL-SARS-002",
          "Mã Bệnh Nhân": "BN-902",
          "Kết Quả / Ct": "Âm tính",
          "Thể Tích": 0.3,
          "Vị Trí (Tùy chọn)": "Hộp S-1, Ô A2",
        },
        {
          "Mã Mẫu": "CL-SARS-003",
          "Mã Bệnh Nhân": "BN-903",
          "Kết Quả / Ct": "Dương tính yếu (Ct=35.1)",
          "Thể Tích": 0.4,
          "Vị Trí (Tùy chọn)": "Hộp S-1, Ô A3",
        },
      ];
      const ws = XLSX.utils.json_to_sheet(templateData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mau_Nhap_Benh_Pham");
      XLSX.writeFile(wb, "File_Mau_Nhap_Benh_Pham.xlsx");
      showToast("Đã tải file Excel mẫu thành công!");
    } catch {
      showToast("Không thể tạo file mẫu.", "err");
    }
  };

  // Helper: Parse Excel file into CSV text for batch clinical specimen textarea
  const handleLoadExcelFile = (file: File, setTextCallback: (text: string) => void) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const startIdx =
          jsonData.length > 0 &&
          typeof jsonData[0][0] === "string" &&
          (jsonData[0][0].toLowerCase().includes("mã") || jsonData[0][0].toLowerCase().includes("id"))
            ? 1
            : 0;

        const lines: string[] = [];
        for (let i = startIdx; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (row && row.length >= 2 && row[0]) {
            const id = String(row[0] || "").trim();
            const patientId = String(row[1] || "Khuyết danh").trim();
            const diag = String(row[2] || "Chưa có kết quả").trim();
            const vol = row[3] !== undefined ? String(row[3]).trim() : "0.5";
            const loc = row[4] !== undefined ? String(row[4]).trim() : "";
            lines.push(loc ? `${id},${patientId},${diag},${vol},${loc}` : `${id},${patientId},${diag},${vol}`);
          }
        }

        if (lines.length > 0) {
          setTextCallback(lines.join("\n"));
          showToast(`Đã đọc thành công ${lines.length} dòng bệnh phẩm từ file Excel!`);
        } else {
          showToast("File Excel không có dữ liệu hợp lệ.", "err");
        }
      } catch {
        showToast("Lỗi khi đọc file Excel. Vui lòng kiểm tra lại định dạng.", "err");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Mutations
  const createMut = useMutation({
    mutationFn: (payload: any) => apiPost<any>("/api/factory/rd/samples", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "rd", "samples"] });
    },
    onError: (e: any) => showToast(e.message, "err"),
  });

  const eventMut = useMutation({
    mutationFn: ({ dbId, payload }: { dbId: string; payload: any }) =>
      apiPost<any>(`/api/factory/rd/samples/${dbId}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["factory", "rd", "samples"] });
    },
    onError: (e: any) => showToast(e.message, "err"),
  });

  // Bulk Excel Import Handler
  const handleImportSamplesListExcel = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (jsonData.length === 0) {
          showToast("File Excel trống hoặc không đúng cấu trúc!", "err");
          return;
        }

        const parsedSamples = jsonData.map((row, idx) => {
          const id = row["Mã Mẫu"] || row["ID"] || row["Mã"] || `SMP-IMP-${Date.now().toString().slice(-3)}-${idx + 1}`;
          const name = row["Tên Mẫu"] || row["Tên"] || row["Name"] || "Mẫu không tên";
          const category = row["Phân Loại"] || row["Loại"] || row["Category"] || "Bệnh phẩm";
          const target = row["Tác Nhân Đích"] || row["Đích"] || row["Target"] || "Chưa xác định";
          const concentration = row["Nồng Độ / Mật Độ"] || row["Nồng Độ"] || row["Concentration"] || "Chưa xác định";
          const volume = parseFloat(row["Thể Tích Hiện Tại"] ?? row["Thể Tích"] ?? row["Volume"] ?? "1.0") || 0;
          const unit = row["Đơn Vị"] || row["Unit"] || "ml";
          const location = row["Vị Trí Bảo Quản"] || row["Vị Trí"] || row["Location"] || "Chưa phân bổ";
          const source = row["Nguồn Gốc"] || row["Nguồn"] || row["Source"] || "Không rõ";
          const date = row["Ngày Thu Nhận"] || row["Ngày"] || row["Date"] || new Date().toISOString().substring(0, 10);
          const status = row["Trạng Thái QC"] || row["Trạng Thái"] || row["Status"] || (volume <= 0 ? "Hết mẫu" : "Đạt tiêu chuẩn");
          const growthStatus = row["Trạng Thái Sinh Trưởng"] || "Stock";

          return {
            id: String(id).trim(),
            name: String(name).trim(),
            category: String(category).trim(),
            target: String(target).trim(),
            concentration: String(concentration).trim(),
            volume,
            unit: String(unit).trim(),
            location: String(location).trim(),
            source: String(source).trim(),
            date: String(date).trim(),
            status: String(status).trim(),
            growthStatus: String(growthStatus).trim(),
          };
        });

        await createMut.mutateAsync({
          action: "BULK_IMPORT",
          org_unit_id: rdUnits[0]?.id,
          samples: parsedSamples,
        });
        showToast(`Đã nhập thành công ${parsedSamples.length} mẫu sinh học từ file Excel!`);
      } catch (err: any) {
        showToast(err?.message || "Lỗi khi đọc file Excel nhập danh sách mẫu!", "err");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Clear All Samples Handler
  const handleClearAllSamples = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn XÓA TẤT CẢ các mẫu sinh học trong danh sách hiện tại không? Hành động này không thể hoàn tác!")) {
      return;
    }
    await createMut.mutateAsync({
      action: "CLEAR_ALL",
      org_unit_id: rdUnits[0]?.id,
    });
    setIsSampleDetailModalOpen(false);
    setSelectedDbId(null);
    showToast("Đã xóa toàn bộ danh sách mẫu sinh học.");
  };

  // Register New Sample Submit Handler
  const handleAddSample = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get("coaFile") as File | null;
    const category = (formData.get("category") as string) || "Bệnh phẩm";
    const unit = (formData.get("unit") as string) || "ml";
    const location = (formData.get("location") as string) || "";
    const source = (formData.get("source") as string) || "";

    let parsedSpecimens: ClinicalSpecimenItem[] = [];
    let initialVolume = parseFloat(formData.get("volume") as string) || 0;
    let concentration = (formData.get("concentration") as string) || "";

    if (category === "Bệnh phẩm" && useBatchImport && batchSpecimensText.trim() !== "") {
      const lines = batchSpecimensText.split(/\r?\n/).filter((l) => l.trim() !== "");
      lines.forEach((line, index) => {
        const parts = line.split(/[,\t]/).map((p) => p.trim());
        if (parts.length >= 2) {
          const vol = parseFloat(parts[3]);
          const specVol = !Number.isNaN(vol) ? vol : 0.5;
          parsedSpecimens.push({
            id: parts[0] || `CL-NEW-${index + 1}`,
            patientId: parts[1] || "Khuyết danh",
            diagnosis: parts[2] || "Chưa rõ",
            volume: specVol,
            unit,
            status: specVol <= 0 ? "Hết mẫu" : "Đạt",
            location: parts[4] || location,
          });
        }
      });
      initialVolume = Number(parsedSpecimens.reduce((acc, cur) => acc + cur.volume, 0).toFixed(4));
      concentration = `Lô ${parsedSpecimens.length} mẫu bệnh phẩm`;
    }

    await createMut.mutateAsync({
      org_unit_id: (formData.get("org_unit_id") as string) || rdUnits[0]?.id,
      name: formData.get("name") as string,
      category,
      target_pathogen: formData.get("target") as string,
      concentration,
      initial_volume: initialVolume,
      uom: unit,
      box_position: location,
      source,
      qc_status: formData.get("status") as string,
      biosafety_level: (formData.get("biosafety_level") as string) || "BSL2",
      max_freeze_thaw: Number(formData.get("max_freeze_thaw") || 3),
      coa_name: file && file.name ? file.name : null,
      specimens: parsedSpecimens.length > 0 ? parsedSpecimens : undefined,
    });

    setIsSampleModalOpen(false);
    setUseBatchImport(false);
    setBatchSpecimensText("");
    showToast("Đã đăng ký mẫu sinh học mới vào hệ thống R&D!");
  };

  // Proliferate / Activate Sample Submit Handler
  const handleProliferateSample = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSampleDetail) return;
    const formData = new FormData(e.currentTarget);
    const newVolume = parseFloat(formData.get("newVolume") as string) || activeSampleDetail.volume;
    const newConcentration = (formData.get("newConcentration") as string) || activeSampleDetail.concentration;
    const conditions = (formData.get("conditions") as string) || "";
    const performer = (formData.get("performer") as string) || "Nghiên cứu viên R&D";
    const date = (formData.get("date") as string) || new Date().toISOString().substring(0, 10);

    await eventMut.mutateAsync({
      dbId: activeSampleDetail.dbId,
      payload: {
        event_type: "PROLIFERATE",
        new_volume: newVolume,
        new_concentration: newConcentration,
        conditions,
        performer,
        date,
      },
    });
    setIsProliferateModalOpen(false);
    setIsSampleDetailModalOpen(true);
    showToast(`Đã ghi nhận hoạt hóa / tăng sinh mẫu ${activeSampleDetail.id} thành công!`);
  };

  // Consume / Use Sample Submit Handler
  const handleUseSample = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSampleDetail) return;
    const formData = new FormData(e.currentTarget);
    const consumedVolume = parseFloat(formData.get("consumedVolume") as string) || 0;
    const projectUse = (formData.get("projectUse") as string) || "";
    const purpose = (formData.get("purpose") as string) || "";
    const performer = (formData.get("performer") as string) || "Nghiên cứu viên R&D";
    const date = (formData.get("date") as string) || new Date().toISOString().substring(0, 10);
    const isQuantitative = formData.get("isQuantitative") === "on";
    const experimentId = (formData.get("experimentId") as string) || null;

    if (consumedVolume > activeSampleDetail.volume) {
      showToast("Thể tích sử dụng vượt quá thể tích mẫu hiện có trong kho!", "err");
      return;
    }

    await eventMut.mutateAsync({
      dbId: activeSampleDetail.dbId,
      payload: {
        event_type: "USE",
        volume_used: consumedVolume,
        project_use: projectUse,
        purpose,
        performer,
        date,
        is_quantitative: isQuantitative,
        experiment_id: experimentId || null,
        reason: `[Đề tài: ${projectUse}] ${purpose}`,
      },
    });
    setIsUseSampleModalOpen(false);
    setIsSampleDetailModalOpen(true);
    showToast(`Đã cập nhật trừ tồn kho mẫu ${activeSampleDetail.id} (-${consumedVolume} ${activeSampleDetail.unit}).`);
  };

  // Create Child Sample(s) Submit Handler
  const handleCreateChildSample = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSampleDetail) return;
    const formData = new FormData(e.currentTarget);
    const tubeCount = isMultipleTubes ? parseInt(formData.get("tubeCount") as string) || 2 : 1;
    const inoculumPerTube = parseFloat(formData.get("inoculumVolume") as string) || 0;
    const totalInoculum = Number((inoculumPerTube * tubeCount).toFixed(4));

    if (totalInoculum > activeSampleDetail.volume) {
      showToast(
        `Tổng thể tích trích từ mẫu mẹ (${totalInoculum} ${activeSampleDetail.unit} cho ${tubeCount} ống) vượt quá tồn kho hiện tại (${activeSampleDetail.volume} ${activeSampleDetail.unit})!`,
        "err"
      );
      return;
    }

    await eventMut.mutateAsync({
      dbId: activeSampleDetail.dbId,
      payload: {
        event_type: "CREATE_CHILDREN",
        is_multiple_tubes: isMultipleTubes,
        tube_count: tubeCount,
        lineage_type: (formData.get("lineageType") as string) || "culture",
        child_name: formData.get("childName") as string,
        child_code: formData.get("childId") as string,
        child_unit: (formData.get("childUnit") as string) || activeSampleDetail.unit,
        inoculum_volume: inoculumPerTube,
        child_volume: parseFloat(formData.get("childVolume") as string) || 1,
        child_concentration: formData.get("childConcentration") as string,
        child_location: formData.get("childLocation") as string,
        performer: (formData.get("performer") as string) || "Nghiên cứu viên R&D",
        date: (formData.get("date") as string) || new Date().toISOString().substring(0, 10),
      },
    });

    setIsCreateChildModalOpen(false);
    setIsMultipleTubes(false);
    setInoculumInput("");
    setIsSampleDetailModalOpen(true);
    showToast(
      isMultipleTubes
        ? `Đã tạo đồng loạt ${tubeCount} ống mẫu con thành công!`
        : `Đã tạo mẫu con mới từ mẫu mẹ ${activeSampleDetail.id}!`
    );
  };

  // Clinical Specimen Handlers
  const handleImportSpecimens = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSampleDetail || !importSpecimensText.trim()) return;
    await eventMut.mutateAsync({
      dbId: activeSampleDetail.dbId,
      payload: {
        event_type: "IMPORT_SPECIMENS",
        specimens_csv: importSpecimensText,
      },
    });
    setImportSpecimensText("");
    setIsImportSpecimensModalOpen(false);
    setIsSampleDetailModalOpen(true);
    showToast("Đã nhập danh sách ống bệnh phẩm vào lô mẫu thành công!");
  };

  const handleAutoGenerateSpecimens = async () => {
    if (!activeSampleDetail) return;
    await eventMut.mutateAsync({
      dbId: activeSampleDetail.dbId,
      payload: {
        event_type: "AUTO_GENERATE_SPECIMENS",
      },
    });
    setIsImportSpecimensModalOpen(false);
    setIsSampleDetailModalOpen(true);
    showToast("Đã tự động khởi tạo danh sách 10 mẫu bệnh phẩm lâm sàng!");
  };

  const handleAddSingleSpecimen = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSampleDetail) return;
    const formData = new FormData(e.currentTarget);
    await eventMut.mutateAsync({
      dbId: activeSampleDetail.dbId,
      payload: {
        event_type: "ADD_SINGLE_SPECIMEN",
        specimen: {
          id: formData.get("specId") as string,
          patientId: formData.get("patientId") as string,
          diagnosis: formData.get("diagnosis") as string,
          volume: parseFloat(formData.get("volume") as string) || 0.5,
          location: (formData.get("location") as string) || activeSampleDetail.location,
        },
      },
    });
    setIsAddSingleSpecimenModalOpen(false);
    setIsSampleDetailModalOpen(true);
    showToast("Đã thêm ống bệnh phẩm mới vào lô mẫu!");
  };

  const handleConsumeSingleSpecimen = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSampleDetail || !activeSpecimenToConsume) return;
    const formData = new FormData(e.currentTarget);
    const consumedVol = parseFloat(formData.get("consumedVolume") as string) || 0;
    if (consumedVol > activeSpecimenToConsume.volume) {
      showToast("Thể tích sử dụng vượt quá thể tích còn lại của ống bệnh phẩm này!", "err");
      return;
    }
    await eventMut.mutateAsync({
      dbId: activeSampleDetail.dbId,
      payload: {
        event_type: "CONSUME_SPECIMEN",
        specimen_id: activeSpecimenToConsume.id,
        volume_used: consumedVol,
        performer: (formData.get("performer") as string) || "Nghiên cứu viên R&D",
        project_use: (formData.get("projectUse") as string) || "",
        purpose: (formData.get("purpose") as string) || "",
        date: (formData.get("date") as string) || new Date().toISOString().substring(0, 10),
      },
    });
    setIsConsumeSpecimenModalOpen(false);
    setActiveSpecimenToConsume(null);
    setIsSampleDetailModalOpen(true);
    showToast(`Đã trừ ${consumedVol} ${activeSampleDetail.unit} từ ống bệnh phẩm ${activeSpecimenToConsume.id}!`);
  };

  const handleDeleteSample = async (sample: NormalizedSample) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa mẫu sinh học "${sample.name}" (${sample.id}) khỏi hệ thống?`)) {
      return;
    }
    await eventMut.mutateAsync({
      dbId: sample.dbId,
      payload: { event_type: "DELETE" },
    });
    setIsSampleDetailModalOpen(false);
    setSelectedDbId(null);
    showToast(`Đã xóa mẫu ${sample.id} khỏi hệ thống.`);
  };

  const qcWarningCount = samples.filter((s) => s.status === "Cần kiểm tra lại" || s.thawWarning).length;

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`flex items-center justify-between px-4 py-3 rounded-xl border text-xs font-bold ${
            msg.kind === "err"
              ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
              : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
          }`}
        >
          <span className="flex items-center gap-2">
            {msg.kind === "err" ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            {msg.text}
          </span>
          <button type="button" onClick={() => setMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header Action Bar (Copied from Old R&D Software) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2.5">
            <Dna className="w-5 h-5 text-blue-400" />
            Quản Lý Nguồn Mẫu Sinh Học & Chủng Chuẩn (R&D Biobank)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Quản lý tập trung bệnh phẩm lâm sàng, chủng vi khuẩn/virus chuẩn, mẫu DNA/RNA, phả hệ mẫu con (Aliquot/Nuôi cấy) và kiểm soát rã đông.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportSamplesExcel}
            className="flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer"
            title="Xuất danh sách mẫu ra file Excel"
          >
            <Download className="w-4 h-4" />
            <span>Xuất Excel</span>
          </button>

          <label
            className="flex items-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer"
            title="Nhập danh sách mẫu từ file Excel"
          >
            <Upload className="w-4 h-4" />
            <span>Nhập Excel</span>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImportSamplesListExcel(file);
                  e.target.value = "";
                }
              }}
              className="hidden"
            />
          </label>

          {samples.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllSamples}
              className="flex items-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 px-3.5 py-2.5 rounded-xl font-bold text-xs transition-all cursor-pointer"
              title="Xóa tất cả các mẫu trong danh sách"
            >
              <Trash2 className="w-4 h-4" />
              <span>Xóa Tất Cả Mẫu</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsSampleModalOpen(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-bold text-xs shadow-lg shadow-blue-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Đăng Ký Mẫu Mới</span>
          </button>
        </div>
      </div>

      {q.isLoading && (
        <div className="p-6 text-center text-xs text-slate-400">Đang tải danh sách nguồn mẫu sinh học...</div>
      )}
      {q.error && (
        <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
          {(q.error as Error).message}
        </div>
      )}

      {/* Main Grid: Left 2/3 Table + Right 1/3 Stats & Filters (Exact Old R&D Layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Danh Mục Nguồn Mẫu Sinh Học */}
        <div className="lg:col-span-2">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                  <Dna className="w-4 h-4 text-blue-400" />
                  Danh Mục Nguồn Mẫu Sinh Học ({filteredSamples.length})
                </h3>
                {(sampleCategoryFilter !== "Tất Cả" || sampleStatusFilter !== "Tất Cả") && (
                  <div className="flex items-center gap-1.5">
                    {sampleCategoryFilter !== "Tất Cả" && (
                      <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 text-[10px] font-bold">
                        {sampleCategoryFilter}
                      </span>
                    )}
                    {sampleStatusFilter !== "Tất Cả" && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-[10px] font-bold">
                        {sampleStatusFilter}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSampleCategoryFilter("Tất Cả");
                        setSampleStatusFilter("Tất Cả");
                      }}
                      className="text-[10px] text-slate-400 hover:text-white underline ml-1"
                    >
                      Bỏ lọc
                    </button>
                  </div>
                )}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Tìm kiếm mẫu, mã, đối tượng..."
                  value={sampleSearchTerm}
                  onChange={(e) => setSampleSearchTerm(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 w-64"
                />
              </div>
            </div>

            {filteredSamples.length === 0 ? (
              <div className="p-8">
                <Empty text="Không tìm thấy mẫu sinh học nào khớp với bộ lọc hiện tại." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="px-5 py-3.5">Mẫu / Phân loại</th>
                      <th className="px-4 py-3.5">Tác nhân đích</th>
                      <th className="px-4 py-3.5">Tồn kho / Nồng độ</th>
                      <th className="px-4 py-3.5">QC / Sinh trưởng</th>
                      <th className="px-5 py-3.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {filteredSamples.map((sample) => (
                      <tr
                        key={sample.dbId}
                        onClick={() => {
                          setSelectedDbId(sample.dbId);
                          setIsSampleDetailModalOpen(true);
                        }}
                        className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                sample.category === "Bệnh phẩm"
                                  ? "bg-amber-500/10 text-amber-400"
                                  : sample.category.includes("Vi")
                                    ? "bg-blue-500/10 text-blue-400"
                                    : "bg-emerald-500/10 text-emerald-400"
                              }`}
                            >
                              <Dna className="w-4 h-4" />
                            </div>
                            <div className="space-y-0.5">
                              <div className="font-bold text-white group-hover:text-blue-400 transition-colors flex items-center gap-1.5">
                                {sample.name}
                              </div>
                              <div className="text-[10px] text-slate-400 flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-slate-300 font-semibold">{sample.id}</span>
                                <span>•</span>
                                <span>{sample.category}</span>
                                {sample.parentId && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-bold text-[9px] border border-blue-500/25">
                                    Mẫu con từ {sample.parentCode || sample.parentId}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <span className="font-bold text-slate-200">{sample.target}</span>
                          <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[180px]" title={sample.location}>
                            📍 {sample.location}
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <div className="space-y-0.5">
                            <div
                              className={`font-bold ${
                                sample.volume <= 0 ? "text-rose-500" : "text-white"
                              }`}
                            >
                              {sample.volume} {sample.unit}
                            </div>
                            {sample.category === "Bệnh phẩm" && sample.specimens && sample.specimens.length > 0 ? (
                              <div className="text-[10px] text-amber-400 font-bold">
                                ({sample.specimens.length} ống bệnh phẩm)
                              </div>
                            ) : (
                              <div className="text-[10px] text-slate-400">{sample.concentration}</div>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight border ${
                                sample.status === "Đạt tiêu chuẩn" && sample.volume > 0
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : sample.status === "Hết mẫu" || sample.volume <= 0
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              }`}
                            >
                              {sample.volume <= 0 ? "Hết mẫu" : sample.status}
                            </span>

                            <div className="flex items-center gap-1.5">
                              {sample.growthStatus && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                    sample.growthStatus === "Activated"
                                      ? "bg-blue-500/10 text-blue-400"
                                      : sample.growthStatus === "Culturing"
                                        ? "bg-purple-500/10 text-purple-400"
                                        : "bg-slate-800 text-slate-400"
                                  }`}
                                >
                                  {sample.growthStatus === "Activated"
                                    ? "Đã hoạt hóa"
                                    : sample.growthStatus === "Culturing"
                                      ? "Đang tăng sinh"
                                      : sample.growthStatus === "Degraded"
                                        ? "Thoái hóa"
                                        : "Chủng gốc"}
                                </span>
                              )}
                              {sample.freezeThawCount > 0 && (
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                                    sample.thawWarning
                                      ? "bg-rose-500/15 text-rose-400 font-bold"
                                      : "bg-slate-800 text-slate-400"
                                  }`}
                                  title="Số lần rã đông"
                                >
                                  ❄️ {sample.freezeThawCount}/{sample.maxFreezeThaw}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="px-5 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            {sample.coaName && (
                              <button
                                type="button"
                                onClick={() => handleDownloadCOA(sample)}
                                className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all cursor-pointer"
                                title={`Tải COA: ${sample.coaName}`}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDbId(sample.dbId);
                                setIsSampleDetailModalOpen(true);
                              }}
                              className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-blue-600 transition-all cursor-pointer"
                              title="Xem chi tiết & Nhật ký mẫu"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right 1 Column: Thống Kê Kho Mẫu & Bộ Lọc Phân Loại (Exact Old R&D Sidebar) */}
        <div className="space-y-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-5">
            <h3 className="font-bold text-white flex items-center gap-2 text-sm">
              <Microscope className="w-4 h-4 text-blue-400" />
              Thống Kê Kho Mẫu
            </h3>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Tổng số mẫu</span>
                <div className="text-2xl font-bold text-white">{samples.length}</div>
              </div>
              <div className="p-4 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-1">
                <span className="text-[10px] font-bold text-amber-400 uppercase">Mẫu bệnh phẩm</span>
                <div className="text-2xl font-bold text-amber-400">
                  {samples.filter((s) => s.category === "Bệnh phẩm").length}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/20 space-y-1">
                <span className="text-[10px] font-bold text-blue-400 uppercase">Mẫu chuẩn VSV</span>
                <div className="text-2xl font-bold text-blue-400">
                  {samples.filter((s) => s.category.includes("Vi")).length}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-1">
                <span className="text-[10px] font-bold text-emerald-400 uppercase">DNA / RNA</span>
                <div className="text-2xl font-bold text-emerald-400">
                  {samples.filter((s) => s.category.includes("DNA") || s.category.includes("RNA")).length}
                </div>
              </div>
            </div>

            {qcWarningCount > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    Yêu cầu kiểm QC lại:
                  </span>
                  <span className="text-amber-400 font-bold">{qcWarningCount} mẫu</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Các mẫu lưu trữ dài hạn (&gt; 6 tháng) hoặc vượt ngưỡng rã đông cần được kiểm tra lại giá trị Ct hoặc mật độ khuẩn lạc trước khi đưa vào thử nghiệm.
                </p>
              </div>
            )}
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="font-bold text-white flex items-center gap-2 text-sm">
              <Filter className="w-4 h-4 text-blue-400" />
              Bộ Lọc Phân Loại
            </h3>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Loại mẫu sinh học</label>
                <select
                  value={sampleCategoryFilter}
                  onChange={(e) => setSampleCategoryFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                >
                  <option value="Tất Cả">Tất Cả Danh Mục</option>
                  <option value="Bệnh phẩm">Bệnh phẩm (Clinical Specimens)</option>
                  <option value="Vi khuẩn chuẩn">Vi khuẩn chuẩn (Standard Bacteria)</option>
                  <option value="Virus chuẩn">Virus chuẩn (Standard Virus)</option>
                  <option value="DNA chuẩn">DNA chuẩn (Reference DNA)</option>
                  <option value="RNA">RNA (Reference RNA)</option>
                  <option value="Plasmid chứng dương">Plasmid chứng dương</option>
                  <option value="Panel ngoại kiểm">Panel ngoại kiểm / Chuẩn quốc tế</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Trạng thái QC chất lượng</label>
                <select
                  value={sampleStatusFilter}
                  onChange={(e) => setSampleStatusFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                >
                  <option value="Tất Cả">Tất Cả Trạng Thái</option>
                  <option value="Đạt tiêu chuẩn">Đạt tiêu chuẩn (Passed)</option>
                  <option value="Chờ kiểm định">Chờ kiểm định (Pending)</option>
                  <option value="Cần kiểm tra lại">Cần kiểm tra lại (Needs Re-QC)</option>
                  <option value="Hết mẫu">Hết mẫu (Out of Stock)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =====================================================================
          MODAL 1: ĐĂNG KÝ MẪU NGHIÊN CỨU MỚI (With Clinical Batch Import)
      ====================================================================== */}
      {isSampleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Dna className="w-4 h-4 text-blue-400" />
                Đăng Ký Mẫu Nghiên Cứu Mới
              </h3>
              <button
                type="button"
                onClick={() => setIsSampleModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSample} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Tên mẫu / Nhãn mẫu *</label>
                  <input
                    name="name"
                    required
                    placeholder="VD: Mẫu chuẩn E. coli ATCC 25922 hoặc Lô bệnh phẩm dịch tỵ hầu SARS-CoV-2"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Phòng R&D quản lý</label>
                  <select
                    name="org_unit_id"
                    defaultValue={rdUnits[0]?.id || ""}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  >
                    {rdUnits.map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Phân Loại Mẫu *</label>
                  <select
                    name="category"
                    value={regCategory}
                    onChange={(e) => {
                      setRegCategory(e.target.value);
                      if (e.target.value !== "Bệnh phẩm") {
                        setUseBatchImport(false);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  >
                    <option value="Bệnh phẩm">Bệnh phẩm (Specimen)</option>
                    <option value="Vi khuẩn chuẩn">Vi khuẩn chuẩn (Standard Bacteria)</option>
                    <option value="Virus chuẩn">Virus chuẩn (Standard Virus)</option>
                    <option value="DNA chuẩn">DNA chuẩn</option>
                    <option value="RNA">RNA</option>
                    <option value="Plasmid chứng dương">Plasmid chứng dương</option>
                    <option value="Panel ngoại kiểm">Panel ngoại kiểm / Chuẩn quốc tế</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Tác Nhân Đích / Đối Tượng *</label>
                  <input
                    name="target"
                    required
                    placeholder="VD: E. coli, SARS-CoV-2, HBV..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {regCategory === "Bệnh phẩm" && (
                <div className="flex items-center gap-2.5 pt-1">
                  <input
                    id="useBatchImport"
                    type="checkbox"
                    checked={useBatchImport}
                    onChange={(e) => setUseBatchImport(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-blue-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="useBatchImport" className="text-xs font-bold text-amber-400 uppercase cursor-pointer select-none">
                    Nhập danh sách nhiều ống bệnh phẩm lâm sàng chi tiết (Ct/Kết quả, Thể tích, Mã BN)
                  </label>
                </div>
              )}

              {useBatchImport ? (
                <div className="space-y-3 border border-slate-800 bg-slate-950/60 p-4 rounded-2xl">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-3 border-b border-slate-800">
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 font-bold uppercase block">File Mẫu Nhập Liệu</span>
                      <button
                        type="button"
                        onClick={handleDownloadSpecimenTemplate}
                        className="w-full flex items-center justify-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Tải File Excel Mẫu
                      </button>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] text-slate-400 font-bold uppercase block">Tải Lên File Excel (.xlsx/.csv)</span>
                      <label className="w-full flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer">
                        <Plus className="w-3.5 h-3.5" />
                        Chọn file Excel nhập mẫu
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleLoadExcelFile(file, setBatchSpecimensText);
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Dán danh sách bệnh phẩm (CSV/Text)</label>
                    <button
                      type="button"
                      onClick={() => {
                        setBatchSpecimensText(
                          "CL-SARS-006,BN-906,Dương tính (Ct=24.5),0.5\nCL-SARS-007,BN-907,Âm tính,0.2\nCL-SARS-008,BN-908,Dương tính (Ct=31.2),0.4\nCL-SARS-009,BN-909,Dương tính (Ct=18.9),0.3\nCL-SARS-010,BN-910,Âm tính,0.5"
                        );
                      }}
                      className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                    >
                      ✨ Sinh nhanh 5 mẫu thử
                    </button>
                  </div>

                  <textarea
                    value={batchSpecimensText}
                    onChange={(e) => setBatchSpecimensText(e.target.value)}
                    placeholder={"Mã_mẫu,Mã_BN,Kết_quả_hoặc_Ct,Thể_tích\nVí dụ:\nCL-SARS-006,BN-906,Dương tính (Ct=22.4),0.5\nCL-SARS-007,BN-907,Âm tính,0.3"}
                    rows={4}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 outline-none focus:border-blue-500"
                  />

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Đơn Vị Thể Tích Chung</label>
                    <select
                      name="unit"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 outline-none focus:border-blue-500"
                    >
                      <option value="ml">ml</option>
                      <option value="ul">ul (µL)</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Nồng Độ / Mật Độ / Giá Trị Ct Ban Đầu *</label>
                    <input
                      name="concentration"
                      required
                      placeholder="VD: Ct = 22.4 hoặc 1.5 x 10^8 CFU/ml"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-400 uppercase">Thể Tích *</label>
                      <input
                        name="volume"
                        type="number"
                        step="any"
                        min="0.0001"
                        required
                        placeholder="1.5"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-400 uppercase">Đơn Vị</label>
                      <select
                        name="unit"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                      >
                        <option value="ml">ml</option>
                        <option value="ul">ul (µL)</option>
                        <option value="vial">vial</option>
                        <option value="tube">ống</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Nguồn Gốc Mẫu (Viện / Bệnh Viện / ATCC) *</label>
                  <input
                    name="source"
                    required
                    placeholder="VD: Bệnh viện Bạch Mai, Viện Vệ sinh Dịch tễ, ATCC..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Trạng Thái QC</label>
                  <select
                    name="status"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  >
                    <option value="Đạt tiêu chuẩn">Đạt tiêu chuẩn (Passed)</option>
                    <option value="Chờ kiểm định">Chờ kiểm định (Pending)</option>
                    <option value="Cần kiểm tra lại">Cần kiểm tra lại (Needs QC)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Vị Trí Lưu Trữ / Bảo Quản *</label>
                  <input
                    name="location"
                    required
                    placeholder="VD: Tủ âm sâu -80°C (Tủ A, Ngăn 2, Hộp S-1)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase">An toàn SH</label>
                    <select
                      name="biosafety_level"
                      defaultValue="BSL2"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                    >
                      <option value="BSL1">BSL-1</option>
                      <option value="BSL2">BSL-2</option>
                      <option value="BSL3">BSL-3</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Max Rã đông</label>
                    <input
                      name="max_freeze_thaw"
                      type="number"
                      min="1"
                      max="20"
                      defaultValue="3"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Tài liệu COA Đính Kèm (Nếu có)</label>
                <input
                  name="coaFile"
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-400 outline-none cursor-pointer"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSampleModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-600/20"
                >
                  {createMut.isPending ? "Đang lưu..." : "Đăng Ký Mẫu Mới"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: CHI TIẾT NGUỒN MẪU SINH HỌC & NHẬT KÝ HOẠT ĐỘNG
      ====================================================================== */}
      {isSampleDetailModalOpen && activeSampleDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Dna className="w-4 h-4 text-blue-400" />
                Thông Tin Mẫu Nghiên Cứu: {activeSampleDetail.name}
              </h3>
              <button
                type="button"
                onClick={() => setIsSampleDetailModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Parent Sample Lineage Banner */}
              {activeSampleDetail.parentId && (
                <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-between text-xs">
                  <span className="text-slate-300">
                    🔗 Mẫu này được nuôi cấy / phân chia / tách chiết từ mẫu mẹ:{" "}
                    <strong className="text-white">
                      {activeSampleDetail.parentName} ({activeSampleDetail.parentCode || activeSampleDetail.parentId})
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const parentSample = samples.find(
                        (s) => s.dbId === activeSampleDetail.parentId || s.id === activeSampleDetail.parentCode
                      );
                      if (parentSample) {
                        setSelectedDbId(parentSample.dbId);
                      } else {
                        showToast("Không tìm thấy mẫu mẹ trên hệ thống (có thể đã bị xóa).", "err");
                      }
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold hover:bg-blue-500 transition-colors cursor-pointer"
                  >
                    Xem Mẫu Mẹ
                  </button>
                </div>
              )}

              {/* Top KPI Metadata Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Mã Mẫu</span>
                  <div className="text-xs font-mono text-white mt-1 font-bold">{activeSampleDetail.id}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Loại Mẫu</span>
                  <div className="text-xs text-white mt-1 font-bold">{activeSampleDetail.category}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Đích Phân Tích</span>
                  <div className="text-xs text-white mt-1 font-bold">{activeSampleDetail.target}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Tồn Kho Hiện Tại</span>
                  <div className={`text-xs mt-1 font-bold ${activeSampleDetail.volume <= 0 ? "text-rose-400" : "text-blue-400"}`}>
                    {activeSampleDetail.volume <= 0
                      ? "Hết mẫu"
                      : `${activeSampleDetail.volume} ${activeSampleDetail.unit}`}
                  </div>
                </div>
              </div>

              {/* Detail Info & Statuses */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5 text-xs">
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Nồng độ / Mật độ:</span>
                    <span className="text-white font-bold">{activeSampleDetail.concentration}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Nguồn gốc:</span>
                    <span className="text-white font-bold">{activeSampleDetail.source}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Ngày thu nhận:</span>
                    <span className="text-white font-bold">{activeSampleDetail.date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Vị trí bảo quản:</span>
                    <span className="text-white font-bold text-right">{activeSampleDetail.location}</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between gap-3">
                  <div className="space-y-2">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">
                      Trạng Thái QC, Sinh Trưởng & Kiểm Soát Rã Đông
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                          activeSampleDetail.status === "Đạt tiêu chuẩn" && activeSampleDetail.volume > 0
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : activeSampleDetail.volume <= 0 || activeSampleDetail.status === "Hết mẫu"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }`}
                      >
                        {activeSampleDetail.volume <= 0 ? "Hết mẫu" : activeSampleDetail.status}
                      </span>

                      <span className="px-2.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold uppercase">
                        {activeSampleDetail.growthStatus === "Activated"
                          ? "Đã hoạt hóa (Activated)"
                          : activeSampleDetail.growthStatus === "Culturing"
                            ? "Đang tăng sinh"
                            : "Chủng gốc (Stock)"}
                      </span>

                      <span
                        className={`px-2.5 py-0.5 rounded text-[10px] font-bold border ${
                          activeSampleDetail.thawWarning
                            ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                            : "bg-slate-800 text-slate-300 border-slate-700"
                        }`}
                      >
                        ❄️ Rã đông: {activeSampleDetail.freezeThawCount}/{activeSampleDetail.maxFreezeThaw} ({activeSampleDetail.biosafetyLevel})
                      </span>
                    </div>
                  </div>

                  {/* Quick Biobank Freeze/Thaw + COA Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                    <div className="flex items-center gap-2">
                      {activeSampleDetail.biobankStatus === "STORED" && (
                        <button
                          type="button"
                          onClick={() =>
                            eventMut.mutate(
                              {
                                dbId: activeSampleDetail.dbId,
                                payload: { event_type: "THAW", reason: "Lấy mẫu ra khỏi tủ âm sâu để thao tác" },
                              },
                              { onSuccess: () => showToast(`Đã ghi nhận rã đông (+1) cho mẫu ${activeSampleDetail.id}`) }
                            )
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-[11px] font-bold cursor-pointer"
                        >
                          <Snowflake className="w-3.5 h-3.5" />
                          Rã đông (+1)
                        </button>
                      )}
                      {activeSampleDetail.biobankStatus === "IN_USE" && (
                        <button
                          type="button"
                          onClick={() =>
                            eventMut.mutate(
                              {
                                dbId: activeSampleDetail.dbId,
                                payload: { event_type: "REFREEZE", reason: "Cấp đông lại vào tủ lưu trữ" },
                              },
                              { onSuccess: () => showToast(`Đã cấp đông lại mẫu ${activeSampleDetail.id}`) }
                            )
                          }
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 text-[11px] font-bold cursor-pointer"
                        >
                          <Snowflake className="w-3.5 h-3.5" />
                          Cấp đông lại
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDownloadCOA(activeSampleDetail)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Xuất Chứng Nhận COA
                    </button>
                  </div>
                </div>
              </div>

              {/* Child Samples Section (Các mẫu con đã tách chiết / nuôi cấy từ mẫu này) */}
              {samples.some((s) => s.parentId === activeSampleDetail.dbId || s.parentCode === activeSampleDetail.id) && (
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">
                    Các Mẫu Con Được Nuôi Cấy / Phân Chia / Tách Chiết Từ Mẫu Này:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {samples
                      .filter((s) => s.parentId === activeSampleDetail.dbId || s.parentCode === activeSampleDetail.id)
                      .map((child) => (
                        <button
                          key={child.dbId}
                          type="button"
                          onClick={() => setSelectedDbId(child.dbId)}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-200 flex items-center gap-2 transition-all cursor-pointer"
                        >
                          <Dna className="w-3.5 h-3.5 text-blue-400" />
                          <span className="font-bold">{child.name}</span>
                          <span className="text-[10px] font-mono text-slate-400">({child.id})</span>
                          <span className="text-[10px] text-emerald-400 font-bold">
                            {child.volume} {child.unit}
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Clinical Specimens Sub-table (Danh Sách Bệnh Phẩm Lâm Sàng Chi Tiết when category === "Bệnh phẩm") */}
              {activeSampleDetail.category === "Bệnh phẩm" && (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-300 uppercase flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-400" />
                      Danh Sách Ống Bệnh Phẩm Lâm Sàng Chi Tiết ({activeSampleDetail.specimens?.length || 0} mẫu)
                    </h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSampleDetailModalOpen(false);
                          setIsImportSpecimensModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Nhập nhanh Excel/CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSampleDetailModalOpen(false);
                          setIsAddSingleSpecimenModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Thêm đơn lẻ
                      </button>
                    </div>
                  </div>

                  {activeSampleDetail.specimens && activeSampleDetail.specimens.length > 0 ? (
                    <div className="max-h-60 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950/60">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-900 sticky top-0 text-[10px] font-bold text-slate-400 uppercase border-b border-slate-800">
                          <tr>
                            <th className="py-2.5 px-3">Mã Ống</th>
                            <th className="py-2.5 px-3">Mã BN</th>
                            <th className="py-2.5 px-3">Kết Quả / Ct</th>
                            <th className="py-2.5 px-3">Vị Trí</th>
                            <th className="py-2.5 px-3">Thể Tích</th>
                            <th className="py-2.5 px-3">QC</th>
                            <th className="py-2.5 px-3 text-right">Thao Tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {activeSampleDetail.specimens.map((spec) => (
                            <tr key={spec.id} className="hover:bg-slate-800/40">
                              <td className="py-2 px-3 font-mono font-bold text-white">{spec.id}</td>
                              <td className="py-2 px-3 text-slate-300">{spec.patientId}</td>
                              <td className="py-2 px-3">
                                <span
                                  className={
                                    spec.diagnosis.includes("Dương tính")
                                      ? "text-rose-400 font-bold"
                                      : spec.diagnosis.includes("Âm tính")
                                        ? "text-emerald-400 font-bold"
                                        : "text-amber-400"
                                  }
                                >
                                  {spec.diagnosis}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-400 text-[11px]">{spec.location || "—"}</td>
                              <td className="py-2 px-3 text-slate-200 font-mono">
                                {spec.volume} {spec.unit}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                    spec.status === "Đạt" && spec.volume > 0
                                      ? "bg-emerald-500/10 text-emerald-400"
                                      : spec.volume <= 0 || spec.status === "Hết mẫu"
                                        ? "bg-rose-500/10 text-rose-400"
                                        : "bg-amber-500/10 text-amber-400"
                                  }`}
                                >
                                  {spec.volume <= 0 ? "Hết mẫu" : spec.status}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right">
                                <button
                                  type="button"
                                  disabled={spec.volume <= 0}
                                  onClick={() => {
                                    setActiveSpecimenToConsume(spec);
                                    setIsSampleDetailModalOpen(false);
                                    setIsConsumeSpecimenModalOpen(true);
                                  }}
                                  className="px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white rounded text-[10px] font-bold transition-all disabled:opacity-40 cursor-pointer"
                                >
                                  Sử dụng
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="p-5 rounded-xl bg-slate-950/50 border border-dashed border-slate-800 text-center space-y-2">
                      <p className="text-xs text-slate-400">
                        Chưa có danh sách các ống bệnh phẩm lâm sàng chi tiết cho lô mẫu này.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSampleDetailModalOpen(false);
                          setIsImportSpecimensModalOpen(true);
                        }}
                        className="px-3.5 py-1.5 bg-amber-500 text-slate-950 rounded-xl text-xs font-bold hover:bg-amber-400 transition-all cursor-pointer"
                      >
                        + Khởi tạo / Nhập danh sách bệnh phẩm ngay
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Primary Lifecycle Action Buttons (Sử Dụng, Tăng Sinh, Tạo Mẫu Con, Xóa Mẫu) */}
              <div className="flex flex-wrap gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsSampleDetailModalOpen(false);
                    setIsUseSampleModalOpen(true);
                  }}
                  disabled={activeSampleDetail.volume <= 0}
                  className="flex-1 min-w-[160px] py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl border border-slate-700 flex items-center justify-center gap-2 transition-all text-xs disabled:opacity-40 cursor-pointer"
                >
                  <Microscope className="w-4 h-4 text-rose-400" />
                  Ghi Nhận Sử Dụng / Tiêu Hao
                </button>

                {(activeSampleDetail.category.includes("Vi") || activeSampleDetail.sampleType === "STRAIN") && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsSampleDetailModalOpen(false);
                      setIsProliferateModalOpen(true);
                    }}
                    className="flex-1 min-w-[160px] py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all text-xs cursor-pointer"
                  >
                    <Flame className="w-4 h-4" />
                    Hoạt Hóa / Tăng Sinh Mẫu
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setIsSampleDetailModalOpen(false);
                    setIsCreateChildModalOpen(true);
                  }}
                  disabled={activeSampleDetail.volume <= 0}
                  className="flex-1 min-w-[160px] py-2.5 bg-emerald-600/15 hover:bg-emerald-600 text-emerald-400 hover:text-white font-bold rounded-xl border border-emerald-500/30 flex items-center justify-center gap-2 transition-all text-xs disabled:opacity-40 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Tạo Mẫu Con (Nuôi cấy / Chia nhỏ)
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteSample(activeSampleDetail)}
                  className="px-4 py-2.5 bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white font-bold rounded-xl border border-rose-500/20 flex items-center justify-center gap-1.5 transition-all text-xs cursor-pointer"
                  title="Xóa mẫu sinh học này"
                >
                  <Trash2 className="w-4 h-4" />
                  Xóa Mẫu
                </button>
              </div>

              {/* Activity & Growth Timeline (Nhật Ký Nuôi Cấy, Tăng Sinh & Sử Dụng Mẫu) */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                <h4 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2">
                  <History className="w-4 h-4 text-blue-400" />
                  Nhật Ký Nuôi Cấy, Tăng Sinh & Sử Dụng Mẫu ({activeSampleDetail.growthHistory.length})
                </h4>

                <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                  {[...activeSampleDetail.growthHistory].reverse().map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1.5 text-xs"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                              item.action === "Tăng sinh"
                                ? "bg-blue-500/15 text-blue-400"
                                : item.action === "Sử dụng"
                                  ? "bg-rose-500/15 text-rose-400"
                                  : item.action === "Tạo mẫu con"
                                    ? "bg-purple-500/15 text-purple-400"
                                    : item.action === "Rã đông" || item.action === "Cấp đông lại"
                                      ? "bg-amber-500/15 text-amber-400"
                                      : "bg-emerald-500/15 text-emerald-400"
                            }`}
                          >
                            {item.action}
                          </span>
                          <span className="font-bold text-white">{item.performer}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">{item.date}</span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">{item.details}</p>
                      {item.resultVolume && (
                        <div className="text-[10px] text-slate-400 font-mono">
                          Tồn kho sau thao tác: <strong className="text-white">{item.resultVolume}</strong>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: HOẠT HÓA / NUÔI CẤY TĂNG SINH MẪU
      ====================================================================== */}
      {isProliferateModalOpen && activeSampleDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Flame className="w-4 h-4 text-blue-400" />
                Hoạt Hóa / Tăng Sinh Mẫu: {activeSampleDetail.name}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsProliferateModalOpen(false);
                  setIsSampleDetailModalOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleProliferateSample} className="p-6 space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Ghi nhận quá trình hoạt hóa chủng chuẩn hoặc nuôi cấy tăng sinh trong môi trường dinh dưỡng để làm mới nguồn mẫu và tăng thể tích dự trữ.
              </p>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Người thực hiện</label>
                <input
                  name="performer"
                  defaultValue="Mai Hoàng Khánh Chi"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Môi trường & Điều kiện nuôi cấy *</label>
                <textarea
                  name="conditions"
                  rows={3}
                  required
                  placeholder="VD: Cấy truyền trong 5ml môi trường LB Broth, ủ lắc 200 rpm ở 37°C trong 18 giờ..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Thể tích thu hoạch mới ({activeSampleDetail.unit}) *
                  </label>
                  <input
                    name="newVolume"
                    type="number"
                    step="any"
                    required
                    defaultValue={activeSampleDetail.volume + 5}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Mật độ / Nồng độ đạt được *</label>
                  <input
                    name="newConcentration"
                    required
                    defaultValue={activeSampleDetail.concentration}
                    placeholder="VD: 2.0 x 10^9 CFU/ml"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Ngày thực hiện</label>
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().substring(0, 10)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsProliferateModalOpen(false);
                    setIsSampleDetailModalOpen(true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={eventMut.isPending}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20 text-xs"
                >
                  Xác Nhận Tăng Sinh
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: GHI NHẬN SỬ DỤNG / TIÊU HAO MẪU
      ====================================================================== */}
      {isUseSampleModalOpen && activeSampleDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Microscope className="w-4 h-4 text-rose-400" />
                Xuất Dùng / Tiêu Hao Mẫu: {activeSampleDetail.name}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsUseSampleModalOpen(false);
                  setIsSampleDetailModalOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUseSample} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Thể tích lấy sử dụng ({activeSampleDetail.unit}) *
                  </label>
                  <input
                    name="consumedVolume"
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    placeholder="VD: 0.2"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Tồn kho hiện tại</label>
                  <div className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-blue-400 font-mono font-bold">
                    {activeSampleDetail.volume} {activeSampleDetail.unit}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Người lấy mẫu</label>
                <input
                  name="performer"
                  defaultValue="Nguyễn Quốc Bảo"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Đề tài / Dự án sử dụng *</label>
                <select
                  name="projectUse"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                >
                  {rdProjects.map((p: any) => (
                    <option key={p.id} value={p.name}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                  <option value="Kit PCR Đa Mồi chẩn đoán nhanh SARS-CoV-2 & Cúm A/B">
                    Kit PCR Đa Mồi chẩn đoán nhanh SARS-CoV-2 & Cúm A/B
                  </option>
                  <option value="Tối ưu hóa quy trình nuôi cấy vi khuẩn E. coli">
                    Tối ưu hóa quy trình nuôi cấy vi khuẩn E. coli
                  </option>
                  <option value="Thực nghiệm phòng Lab độc lập / Nghiên cứu tự do">
                    Thực nghiệm phòng Lab độc lập / Nghiên cứu tự do
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Liên kết Thí nghiệm ELN (Tùy chọn)</label>
                <select
                  name="experimentId"
                  defaultValue=""
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                >
                  <option value="">— Không gắn thí nghiệm ELN cụ thể —</option>
                  {(experiments.data ?? []).map((ex: any) => (
                    <option key={ex.id} value={ex.id}>
                      {ex.code} — {ex.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Thí nghiệm / Công việc cụ thể *</label>
                <input
                  name="purpose"
                  required
                  placeholder="VD: Chạy đối chứng dương thẩm định độ nhạy LoD"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" name="isQuantitative" className="rounded border-slate-700 bg-slate-950" />
                Dùng cho thí nghiệm định lượng (LoD / chuẩn độ — kiểm tra chặn nếu vượt số lần rã đông)
              </label>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Ngày sử dụng</label>
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().substring(0, 10)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsUseSampleModalOpen(false);
                    setIsSampleDetailModalOpen(true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={eventMut.isPending}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl shadow-lg shadow-rose-600/20 text-xs"
                >
                  Xác Nhận Trừ Kho
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 5: TẠO MẪU CON TỪ MẪU MẸ (Single or Multi-tube Batch Aliquot/Culture)
      ====================================================================== */}
      {isCreateChildModalOpen && activeSampleDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                Tạo Mẫu Con từ: {activeSampleDetail.name}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsCreateChildModalOpen(false);
                  setIsSampleDetailModalOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateChildSample} className="p-6 space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Trích thể tích từ mẫu mẹ để nuôi cấy tăng sinh chủng mới, phân chia ống aliquot hoặc tách chiết nucleic acid (DNA/RNA). Mẫu con tự động kế thừa tác nhân đích và liên kết phả hệ với mẫu mẹ.
              </p>

              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
                <input
                  id="isMultipleTubes"
                  name="isMultipleTubes"
                  type="checkbox"
                  checked={isMultipleTubes}
                  onChange={(e) => setIsMultipleTubes(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-emerald-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="isMultipleTubes" className="text-xs font-bold text-emerald-400 uppercase cursor-pointer select-none">
                  Chia nhiều ống mẫu con đồng thời (Aliquoting / Batch Sub-culture)
                </label>
              </div>

              {isMultipleTubes && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Số Lượng Ống Phân Chia (2 – 100 ống)</label>
                  <input
                    name="tubeCount"
                    type="number"
                    min="2"
                    max="100"
                    required={isMultipleTubes}
                    value={tubeCountInput}
                    onChange={(e) => setTubeCountInput(parseInt(e.target.value) || 2)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Tác Nhân Đích (Kế thừa)</label>
                  <div className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-300 font-bold">
                    {activeSampleDetail.target}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Kiểu Mẫu Con</label>
                  <select
                    name="lineageType"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  >
                    <option value="culture">Nuôi cấy tăng sinh (Culture)</option>
                    <option value="aliquot">Chia nhỏ (Aliquot)</option>
                    <option value="extraction">Tách chiết DNA/RNA</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Tên Mẫu Con *</label>
                <input
                  name="childName"
                  required
                  key={isMultipleTubes ? "multi-name" : "single-name"}
                  defaultValue={
                    isMultipleTubes ? `${activeSampleDetail.name} (Lô)` : `${activeSampleDetail.name} (Mẫu con)`
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    {isMultipleTubes ? "Tiền tố Mã Mẫu Con *" : "Mã Mẫu Con *"}
                  </label>
                  <input
                    name="childId"
                    required
                    key={isMultipleTubes ? "multi-id" : "single-id"}
                    defaultValue={
                      isMultipleTubes
                        ? `${activeSampleDetail.id}-A`
                        : `${activeSampleDetail.id}-C${
                            samples.filter(
                              (s) => s.parentId === activeSampleDetail.dbId || s.parentCode === activeSampleDetail.id
                            ).length + 1
                          }`
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Đơn Vị Mẫu Con</label>
                  <select
                    name="childUnit"
                    defaultValue={activeSampleDetail.unit}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  >
                    <option value="ml">ml</option>
                    <option value="ul">ul (µL)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    {isMultipleTubes
                      ? `Thể tích trích mẹ / mỗi ống (${activeSampleDetail.unit}) *`
                      : `Thể tích giống trích mẹ (${activeSampleDetail.unit}) *`}
                  </label>
                  <input
                    name="inoculumVolume"
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    value={inoculumInput}
                    onChange={(e) => setInoculumInput(e.target.value)}
                    placeholder={`Tồn mẹ: ${activeSampleDetail.volume} ${activeSampleDetail.unit}`}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    {isMultipleTubes ? "Thể tích mỗi ống con *" : "Thể tích thu hoạch con *"}
                  </label>
                  <input
                    name="childVolume"
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    placeholder="VD: 1.0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {isMultipleTubes && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 font-bold">
                  ⚠️ Tổng lượng giống trích từ mẫu mẹ:{" "}
                  {(tubeCountInput * (parseFloat(inoculumInput) || 0)).toFixed(4)} {activeSampleDetail.unit} (Tồn hiện tại:{" "}
                  {activeSampleDetail.volume} {activeSampleDetail.unit})
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Nồng Độ / Mật Độ Mẫu Con *</label>
                  <input
                    name="childConcentration"
                    required
                    defaultValue={activeSampleDetail.concentration}
                    placeholder="VD: 2.0 x 10^8 CFU/ml"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Người Thao Tác</label>
                  <input
                    name="performer"
                    defaultValue="Nguyễn Quốc Bảo"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Vị Trí Lưu Trữ Mẫu Con *</label>
                  <input
                    name="childLocation"
                    required
                    defaultValue={activeSampleDetail.location}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Ngày Thao Tác</label>
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().substring(0, 10)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateChildModalOpen(false);
                    setIsSampleDetailModalOpen(true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={eventMut.isPending}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/20 text-xs"
                >
                  {isMultipleTubes ? `Xác Nhận Tạo ${tubeCountInput} Ống Mẫu Con` : "Xác Nhận Tạo Mẫu Con"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 6: NHẬP NHANH DANH SÁCH BỆNH PHẨM LÂM SÀNG (Excel / CSV / Auto-10)
      ====================================================================== */}
      {isImportSpecimensModalOpen && activeSampleDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-amber-400" />
                Nhập Nhanh Danh Sách Bệnh Phẩm: {activeSampleDetail.name}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsImportSpecimensModalOpen(false);
                  setIsSampleDetailModalOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleImportSpecimens} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-3 border-b border-slate-800">
                <button
                  type="button"
                  onClick={handleDownloadSpecimenTemplate}
                  className="flex items-center justify-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 px-3 py-2.5 rounded-xl text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Tải File Excel Mẫu
                </button>
                <label className="flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 px-3 py-2.5 rounded-xl text-xs font-bold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" />
                  Chọn file Excel (.xlsx/.csv)
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleLoadExcelFile(file, setImportSpecimensText);
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">
                  Hoặc dán dữ liệu CSV (Mã_mẫu,Mã_BN,Kết_quả,Thể_tích,Vị_trí):
                </span>
                <button
                  type="button"
                  onClick={handleAutoGenerateSpecimens}
                  className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  ✨ Tạo nhanh 10 mẫu thử
                </button>
              </div>

              <textarea
                rows={5}
                value={importSpecimensText}
                onChange={(e) => setImportSpecimensText(e.target.value)}
                placeholder={"CL-006,BN-9901,Dương tính (Ct = 20.5),0.4,Hộp S-1 Ô B1\nCL-007,BN-9902,Âm tính,0.5,Hộp S-1 Ô B2"}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs font-mono text-slate-200 outline-none focus:border-blue-500"
              />

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsImportSpecimensModalOpen(false);
                    setIsSampleDetailModalOpen(true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={eventMut.isPending}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs"
                >
                  Xác Nhận Nhập Dữ Liệu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 7: THÊM ĐƠN LẺ ỐNG BỆNH PHẨM LÂM SÀNG
      ====================================================================== */}
      {isAddSingleSpecimenModalOpen && activeSampleDetail && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">Thêm Ống Bệnh Phẩm Đơn Lẻ</h3>
              <button
                type="button"
                onClick={() => {
                  setIsAddSingleSpecimenModalOpen(false);
                  setIsSampleDetailModalOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSingleSpecimen} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Mã Ống Bệnh Phẩm *</label>
                  <input
                    name="specId"
                    required
                    defaultValue={`CL-${(activeSampleDetail.specimens?.length || 0) + 1}`}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Mã Bệnh Nhân *</label>
                  <input
                    name="patientId"
                    required
                    placeholder="VD: BN-8835"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Kết Quả Chẩn Đoán / Giá Trị Ct *</label>
                <input
                  name="diagnosis"
                  required
                  placeholder="VD: Dương tính (Ct = 21.6) hoặc Âm tính"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Thể Tích ({activeSampleDetail.unit}) *
                  </label>
                  <input
                    name="volume"
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    defaultValue="0.5"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Vị Trí Ô Lưu Trữ</label>
                  <input
                    name="location"
                    defaultValue={activeSampleDetail.location}
                    placeholder="VD: Hộp S-1, Ô A6"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddSingleSpecimenModalOpen(false);
                    setIsSampleDetailModalOpen(true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={eventMut.isPending}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs"
                >
                  Thêm Vào Danh Sách
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 8: TIÊU HAO ỐNG BỆNH PHẨM CỤ THỂ (CL-xxx)
      ====================================================================== */}
      {isConsumeSpecimenModalOpen && activeSampleDetail && activeSpecimenToConsume && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white">
                Tiêu Hao Ống Bệnh Phẩm: {activeSpecimenToConsume.id}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsConsumeSpecimenModalOpen(false);
                  setIsSampleDetailModalOpen(true);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConsumeSingleSpecimen} className="p-6 space-y-4">
              <p className="text-xs text-slate-400 leading-relaxed">
                Nhập thể tích tiêu hao cho ống bệnh phẩm cụ thể{" "}
                <span className="text-blue-400 font-bold font-mono">{activeSpecimenToConsume.id}</span> (Bệnh nhân:{" "}
                <span className="text-white font-bold">{activeSpecimenToConsume.patientId}</span> —{" "}
                <span>{activeSpecimenToConsume.diagnosis}</span>).
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">
                    Thể tích tiêu hao ({activeSampleDetail.unit}) *
                  </label>
                  <input
                    name="consumedVolume"
                    type="number"
                    step="any"
                    min="0.0001"
                    required
                    placeholder="VD: 0.1"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase">Tồn kho của ống</label>
                  <div className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-amber-400 font-mono font-bold">
                    {activeSpecimenToConsume.volume} {activeSampleDetail.unit}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Người sử dụng</label>
                <input
                  name="performer"
                  defaultValue="Nguyễn Quốc Bảo"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Đề tài / Dự án sử dụng *</label>
                <select
                  name="projectUse"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                >
                  {rdProjects.map((p: any) => (
                    <option key={p.id} value={p.name}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                  <option value="Kit PCR Đa Mồi chẩn đoán nhanh SARS-CoV-2 & Cúm A/B">
                    Kit PCR Đa Mồi chẩn đoán nhanh SARS-CoV-2 & Cúm A/B
                  </option>
                  <option value="Thực nghiệm phòng Lab độc lập / Nghiên cứu tự do">
                    Thực nghiệm phòng Lab độc lập / Nghiên cứu tự do
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Thí nghiệm / Công việc cụ thể *</label>
                <input
                  name="purpose"
                  required
                  placeholder="VD: Đánh giá độ nhạy lâm sàng thử nghiệm"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase">Ngày sử dụng</label>
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().substring(0, 10)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsConsumeSpecimenModalOpen(false);
                    setIsSampleDetailModalOpen(true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs"
                >
                  Hủy Bỏ
                </button>
                <button
                  type="submit"
                  disabled={eventMut.isPending}
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs"
                >
                  Xác Nhận Sử Dụng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
