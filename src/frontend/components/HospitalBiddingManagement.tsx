"use client";

import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import {
  Building2,
  FileText,
  Calendar,
  DollarSign,
  Award,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Search,
  Filter,
  Plus,
  TrendingUp,
  FileCheck,
  Package,
  Layers,
  Sparkles,
  ExternalLink,
  Printer,
  Download,
  AlertCircle,
  Percent,
  Cpu,
  Pencil
} from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { todayVN } from "@/backend/services/dates";

export type TenderStatus =
  | "CHUAN_BI_HSDT"  // Đang soạn thảo Hồ sơ dự thầu & Bảo lãnh
  | "DA_NOP_HSDT"    // Đã nộp thầu & đang chờ mở thầu
  | "DANG_DANH_GIA"  // Đang chấm thầu / Làm rõ hồ sơ
  | "TRUNG_THAU"     // Trúng thầu toàn bộ & Ký Hợp đồng khung
  | "TRUNG_MOT_PHAN" // Trúng thầu một phần (trúng một số lô/phần)
  | "TRUOT_THAU";    // Trượt thầu / Hủy thầu

export type TenderType =
  | "THIET_BI"                  // Gói thầu mua sắm thiết bị y tế
  | "HOA_CHAT_KIT"              // Gói thầu mua sắm hóa chất & sinh phẩm xét nghiệm y tế
  | "DAT_MAY_MUON"              // Gói thầu Đặt máy mượn - Tiêu hao hóa chất (Reagent Rental)
  | "TRUONG_HOC_THIET_BI"       // Trường học / Viện NC - Thiết bị phân tích & Phòng Lab đào tạo
  | "TRUONG_HOC_HOA_CHAT"       // Trường học / Viện NC - Hóa chất & Vật tư nghiên cứu, thí nghiệm
  | "CONG_NGHIEP_KIEM_NGHIEM"   // Công nghiệp / Nhà máy - Thiết bị & Hóa chất kiểm nghiệm QC/KCS
  | "CONG_NGHIEP_SAN_XUAT"      // Công nghiệp / Nhà máy - Vật tư, Men vi sinh & Sinh phẩm môi trường
  | "DICH_VU_KT"                // Gói thầu dịch vụ bảo trì, hiệu chuẩn & kỹ thuật
  | "GOI_THAU_KHAC";            // Gói thầu tổng hợp / Mua sắm khác

export const getTenderTypeBadge = (type: TenderType | string) => {
  switch (type) {
    case "THIET_BI":
      return { 
        label: "Y tế: Thiết bị", 
        fullLabel: "Mua sắm thiết bị y tế",
        bg: "bg-blue-100 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800" 
      };
    case "HOA_CHAT_KIT":
      return { 
        label: "Y tế: Hóa chất & Kit", 
        fullLabel: "Mua sắm hóa chất & kit test y tế",
        bg: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/80 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800" 
      };
    case "DAT_MAY_MUON":
      return { 
        label: "Y tế: Đặt máy mượn", 
        fullLabel: "Đặt máy mượn (Reagent Rental)",
        bg: "bg-purple-100 text-purple-700 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-200 dark:border-purple-800" 
      };
    case "TRUONG_HOC_THIET_BI":
      return { 
        label: "Trường học: Thiết bị Lab", 
        fullLabel: "Trường học - Thiết bị phân tích & Lab đào tạo",
        bg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800" 
      };
    case "TRUONG_HOC_HOA_CHAT":
      return { 
        label: "Trường học: Hóa chất & VT", 
        fullLabel: "Trường học - Hóa chất & Vật tư thí nghiệm",
        bg: "bg-teal-100 text-teal-700 dark:bg-teal-950/80 dark:text-teal-300 border border-teal-200 dark:border-teal-800" 
      };
    case "CONG_NGHIEP_KIEM_NGHIEM":
      return { 
        label: "Công nghiệp: Kiểm nghiệm QC", 
        fullLabel: "Công nghiệp - Thiết bị & Hóa chất kiểm nghiệm QC/KCS",
        bg: "bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200 dark:border-amber-800" 
      };
    case "CONG_NGHIEP_SAN_XUAT":
      return { 
        label: "Công nghiệp: Men & Sinh phẩm", 
        fullLabel: "Công nghiệp - Men vi sinh & Sinh phẩm môi trường",
        bg: "bg-orange-100 text-orange-700 dark:bg-orange-950/80 dark:text-orange-300 border border-orange-200 dark:border-orange-800" 
      };
    case "DICH_VU_KT":
      return { 
        label: "Dịch vụ kỹ thuật", 
        fullLabel: "Dịch vụ bảo trì, hiệu chuẩn kỹ thuật",
        bg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700" 
      };
    case "GOI_THAU_KHAC":
    default:
      return { 
        label: "Gói thầu khác", 
        fullLabel: "Gói thầu khác",
        bg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700" 
      };
  }
};

export interface HospitalTender {
  id: string;
  bidCode: string; // Số hiệu TBMT / KHLCNT
  tenderName: string; // Tên gói thầu
  hospitalName: string; // Chủ đầu tư / Bệnh viện
  procurementAgency: string; // Bên mời thầu
  tenderType: TenderType;
  biddingMethod: "RONG_RAI_QUA_MANG" | "CHAO_HANG_CANH_TRANH" | "CHI_DINH_THAU";
  packageBudget: number; // Giá gói thầu (VNĐ)
  ourBidPrice: number; // Giá dự thầu của TBRs (VNĐ)
  submissionDeadline: string; // Thời điểm đóng thầu dd/mm/yyyy HH:mm
  bidSecurityAmount: number; // Giá trị bảo lãnh dự thầu ngân hàng (VNĐ)
  status: TenderStatus;
  leadSalesRep: string;
  competitorsInfo?: string;
  contractAwardDate?: string;
  totalDeliveryCalls?: number; // Số đợt gọi hàng theo HĐ khung
  completedDeliveryCalls?: number; // Số đợt đã giao
  notes?: string;
  lostReason?: string; // Lý do trượt thầu / hủy thầu
  winningCompetitor?: string; // Đơn vị trúng thầu
  winningBidPrice?: number; // Giá trúng thầu của đối thủ
  bankGuaranteeReturned?: boolean; // Đã thu hồi bảo lãnh ngân hàng
  closedDate?: string; // Ngày kết thúc hồ sơ
  closedNotes?: string; // Ghi chú kết thúc / rút kinh nghiệm
  wonLots?: string; // Chi tiết phân lô trúng thầu (ví dụ: "Trúng Lô 1 & 2")
  actualWonPrice?: number; // Giá trị trúng thầu thực tế (VNĐ)
  decisionNumber?: string; // Số quyết định phê duyệt KQLCNT
  decisionDate?: string; // Ngày ban hành quyết định trúng thầu
  winNotes?: string; // Ghi chú trúng thầu & thực hiện hợp đồng
}

export interface ReagentRentalAgreement {
  id: string;
  code: string;
  hospitalName: string;
  department: string;
  placedDeviceName: string;
  model: string;
  serialNumber: string;
  associatedReagents: string;
  startDate: string;
  endDate: string;
  monthlyCommitmentTests: number; // Số test cam kết / tháng
  currentMonthActualTests: number; // Số test thực tế tháng này
  pricePerTest: number; // Đơn giá mỗi test
  assignedSalesRep: string;
  assignedFSE: string;
  status: "HOAT_DONG_TOT" | "CANH_BAO_HUT_CAM_KET" | "HET_HAN";
}

// ============================================================
// TIỆN ÍCH SỐ TIỀN (VNĐ) - PHÂN CÁCH PHẦN NGHÌN
// ============================================================

import { parseMoney, formatThousands, MoneyInput } from "@/frontend/components/MoneyInput";
export { parseMoney, formatThousands, MoneyInput };

// ============================================================
// DANH SÁCH NVKD PHỤ TRÁCH (SALE + ADMIN + BAN GIÁM ĐỐC)
// ============================================================

export interface SalesRepOption {
  name: string;
  position: string;
  group: "Kinh Doanh (Sale)" | "Admin" | "Ban Giám Đốc";
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Quản Trị Hệ Thống",
  sales_head: "Trưởng Phòng Kinh Doanh",
  sales_rep: "Chuyên Viên Kinh Doanh",
  sales_admin: "Admin Kinh Doanh"
};

/** Danh sách dự phòng khi chưa tải được nhân sự từ CSDL */
const FALLBACK_SALES_REPS: SalesRepOption[] = [];

/** Phân nhóm một nhân sự; trả về null nếu không thuộc Sale / Admin / Ban Giám Đốc */
const classifySalesRep = (department: string, position: string, role: string): SalesRepOption["group"] | null => {
  const dept = (department || "").toLowerCase();
  const pos = (position || "").toLowerCase();
  const r = (role || "").toLowerCase();
  if (dept.includes("giám đốc") || pos.includes("giám đốc") || r === "director") return "Ban Giám Đốc";
  if (pos.includes("admin") || r.includes("admin") || pos.includes("quản trị")) return "Admin";
  if (
    dept.includes("kinh doanh") || dept.includes("sales") ||
    pos.includes("kinh doanh") || pos.includes("sales") || /\bpm\b/.test(pos) || pos.includes("sản phẩm") ||
    r.startsWith("sales")
  ) {
    return "Kinh Doanh (Sale)";
  }
  return null;
};

/** Gộp nhân sự (bảng personnel) + tài khoản (bảng users), lọc Sale/Admin/BGĐ đang hoạt động, bỏ trùng tên */
const buildSalesRepOptions = (personnel: any[], users: any[]): SalesRepOption[] => {
  const map = new Map<string, SalesRepOption>();

  for (const p of personnel) {
    if (p?.status && p.status !== "ACTIVE") continue;
    const name = String(p?.full_name || "").trim();
    if (!name) continue;
    const group = classifySalesRep(p.department, p.position, "");
    if (group) map.set(name, { name, position: p.position || "", group });
  }

  for (const u of users) {
    if (u?.is_active === false) continue;
    const name = String(u?.full_name || "").trim();
    if (!name || map.has(name)) continue;
    const group = classifySalesRep(u.department, "", u.role);
    if (group) map.set(name, { name, position: ROLE_LABELS[u.role] || u.role || "", group });
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "vi"));
};

/** Giá trị mặc định của form "Theo Dõi Gói Thầu Mới" */
const createDefaultBidForm = (defaultRep: string = "Lê Hữu Nhân") => ({
  bidCode: `TBMT-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
  tenderName: "",
  hospitalName: "",
  procurementAgency: "Phòng Mua hàng / Ban QLDA",
  tenderType: "HOA_CHAT_KIT" as TenderType,
  biddingMethod: "RONG_RAI_QUA_MANG" as HospitalTender["biddingMethod"],
  packageBudget: 2000000000,
  ourBidPrice: 1900000000,
  submissionDeadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toLocaleDateString("vi-VN") + " 09:00",
  bidSecurityAmount: 50000000,
  leadSalesRep: defaultRep,
  notes: ""
});

/** Danh sách kỹ sư FSE bảo trì */
const FSE_OPTIONS = ["Vũ Nhật Tân", "Huỳnh Ngọc Nhi", "Vũ Thị Quỳnh Như"];

/** Giá trị mặc định của form "Thêm Hợp Đồng Đặt Máy Mượn" */
const createDefaultRentalForm = (defaultRep: string = "Lê Hữu Nhân") => ({
  code: `RR-${Date.now().toString().slice(-4)}`,
  hospitalName: "Bệnh Viện Chợ Rẫy - TP.HCM",
  department: "Khoa Vi Sinh / Sinh Học Phân Tử",
  placedDeviceName: "Hệ thống Real-time PCR TBR-9600",
  model: "TBR-PCR-9600",
  serialNumber: `SN-TBR-2026-${Date.now().toString().slice(-3)}`,
  associatedReagents: "Kit Real-time PCR HPV High Risk & HBV Định Lượng",
  startDate: new Date().toLocaleDateString("vi-VN"),
  endDate: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toLocaleDateString("vi-VN"),
  monthlyCommitmentTests: 500,
  currentMonthActualTests: 520,
  pricePerTest: 120000,
  assignedSalesRep: defaultRep,
  assignedFSE: FSE_OPTIONS[0]
});

export const HospitalBiddingManagement: React.FC = () => {
  const { showToast } = useNotification();
  const { user } = useAuth();

  const [activeSubTab, setActiveSubTab] = useState<"tenders" | "reagent_rental">("tenders");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Initial Bidding Projects
  const [tenders, setTenders] = useState<HospitalTender[]>([]);

  // Initial Reagent Rental Agreements
  const [rentals, setRentals] = useState<ReagentRentalAgreement[]>([]);

  // Modal States
  const [isNewBidModalOpen, setIsNewBidModalOpen] = useState(false);
  const [isNewRentalModalOpen, setIsNewRentalModalOpen] = useState(false);
  const [isCloseTenderModalOpen, setIsCloseTenderModalOpen] = useState(false);
  const [selectedTender, setSelectedTender] = useState<HospitalTender | null>(null);
  const [selectedTenderForClose, setSelectedTenderForClose] = useState<HospitalTender | null>(null);

  // Close / Lost Tender Form State
  const [closeTenderForm, setCloseTenderForm] = useState({
    status: "TRUOT_THAU" as TenderStatus,
    lostReason: "Giá dự thầu của TBRs cao hơn đối thủ",
    customReason: "",
    winningCompetitor: "",
    winningBidPrice: 0,
    bankGuaranteeReturned: true,
    closedNotes: ""
  });

  // Win Tender Form State
  const [isWinTenderModalOpen, setIsWinTenderModalOpen] = useState(false);
  const [selectedTenderForWin, setSelectedTenderForWin] = useState<HospitalTender | null>(null);
  const [winTenderForm, setWinTenderForm] = useState({
    status: "TRUNG_THAU" as TenderStatus,
    actualWonPrice: 0,
    wonLots: "",
    lostLotsInfo: "",
    decisionNumber: "",
    decisionDate: "",
    contractAwardDate: "",
    totalDeliveryCalls: 1,
    winNotes: ""
  });

  // New Bid Form State
  const [newBidForm, setNewBidForm] = useState(() => createDefaultBidForm());
  // Khi khác null: modal đang ở chế độ chỉnh sửa gói thầu có id này
  const [editingTenderId, setEditingTenderId] = useState<string | null>(null);

  // Danh sách NVKD phụ trách: toàn bộ nhân sự Kinh Doanh (Sale), Admin và Ban Giám Đốc lấy từ CSDL
  const [salesReps, setSalesReps] = useState<SalesRepOption[]>(FALLBACK_SALES_REPS);

  useEffect(() => {
    const loadSalesReps = async () => {
      try {
        const res = await fetch("/api/settings?action=overview");
        if (!res.ok) return;
        const data = await res.json();
        const list = buildSalesRepOptions(
          Array.isArray(data.personnel) ? data.personnel : [],
          Array.isArray(data.users) ? data.users : []
        );
        if (list.length > 0) setSalesReps(list);
      } catch (err) {
        console.error("Failed to load sales reps:", err);
      }
    };
    loadSalesReps();
  }, []);

  const pickDefaultRep = () => {
    const me = (user?.full_name || user?.name || "").trim();
    if (me && salesReps.some(r => r.name === me)) return me;
    return salesReps[0]?.name || "";
  };

  const renderSalesRepOptions = (currentValue: string) => {
    const groups: SalesRepOption["group"][] = ["Kinh Doanh (Sale)", "Admin", "Ban Giám Đốc"];
    const hasCurrent = !currentValue || salesReps.some(r => r.name === currentValue);
    return (
      <>
        {!hasCurrent && <option value={currentValue}>{currentValue}</option>}
        {groups.map(g => {
          const items = salesReps.filter(r => r.group === g);
          if (items.length === 0) return null;
          return (
            <optgroup key={g} label={g}>
              {items.map(r => (
                <option key={r.name} value={r.name}>
                  {r.position ? `${r.name} (${r.position})` : r.name}
                </option>
              ))}
            </optgroup>
          );
        })}
      </>
    );
  };

  // New Rental Agreement Form State
  const [newRentalForm, setNewRentalForm] = useState(() => createDefaultRentalForm());
  // Khi khác null: modal đang ở chế độ chỉnh sửa hợp đồng đặt máy mượn có id này
  const [editingRentalId, setEditingRentalId] = useState<string | null>(null);

  // Sync with PostgreSQL
  useEffect(() => {
    const loadBiddingData = async () => {
      try {
        const [bidsRes, rentalsRes] = await Promise.all([
          fetch("/api/storage?key=sales_hospital_bids"),
          fetch("/api/storage?key=sales_reagent_rentals")
        ]);
        const bidsJson = await bidsRes.json();
        const rentalsJson = await rentalsRes.json();

        if (bidsJson && Array.isArray(bidsJson.data) && bidsJson.data.length > 0) {
          setTenders(
            bidsJson.data.map((t: HospitalTender) => ({
              ...t,
              packageBudget: parseMoney(t.packageBudget),
              ourBidPrice: parseMoney(t.ourBidPrice),
              bidSecurityAmount: parseMoney(t.bidSecurityAmount),
              winningBidPrice: t.winningBidPrice !== undefined ? parseMoney(t.winningBidPrice) : undefined,
              actualWonPrice: t.actualWonPrice !== undefined ? parseMoney(t.actualWonPrice) : undefined
            }))
          );
        }
        if (rentalsJson && Array.isArray(rentalsJson.data) && rentalsJson.data.length > 0) {
          setRentals(
            rentalsJson.data.map((r: ReagentRentalAgreement) => ({
              ...r,
              pricePerTest: parseMoney(r.pricePerTest),
              monthlyCommitmentTests: parseMoney(r.monthlyCommitmentTests),
              currentMonthActualTests: parseMoney(r.currentMonthActualTests)
            }))
          );
        }
      } catch (err) {
        console.error("Failed to load bidding data:", err);
      }
    };
    loadBiddingData();
  }, []);

  const saveTenders = async (updated: HospitalTender[]) => {
    setTenders(updated);
    try {
      await fetch("/api/storage?key=sales_hospital_bids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "sales_hospital_bids", data: updated })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const saveRentals = async (updated: ReagentRentalAgreement[]) => {
    setRentals(updated);
    try {
      await fetch("/api/storage?key=sales_reagent_rentals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "sales_reagent_rentals", data: updated })
      });
    } catch (e) {
      console.error(e);
    }
  };

  // KPI Calculations
  const biddingMetrics = useMemo(() => {
    const activeTenders = tenders.filter(t => t.status !== "TRUNG_THAU" && t.status !== "TRUNG_MOT_PHAN" && t.status !== "TRUOT_THAU");
    const wonTenders = tenders.filter(t => t.status === "TRUNG_THAU" || t.status === "TRUNG_MOT_PHAN");
    const totalClosed = wonTenders.length + tenders.filter(t => t.status === "TRUOT_THAU").length;
    const winRate = totalClosed > 0 ? Math.round((wonTenders.length / totalClosed) * 100) : 80;

    const totalActiveBudget = activeTenders.reduce((sum, t) => sum + parseMoney(t.ourBidPrice), 0);
    const totalWonValue = wonTenders.reduce((sum, t) => sum + parseMoney(t.actualWonPrice ?? t.ourBidPrice), 0);

    const totalRentals = rentals.length;
    const warningRentals = rentals.filter(r => r.status === "CANH_BAO_HUT_CAM_KET").length;

    return {
      activeTendersCount: activeTenders.length,
      totalActiveBudget,
      wonCount: wonTenders.length,
      totalWonValue,
      winRate,
      totalRentals,
      warningRentals
    };
  }, [tenders, rentals]);

  // Filtered Tenders
  const filteredTenders = useMemo(() => {
    return tenders.filter(t => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        t.bidCode.toLowerCase().includes(q) ||
        t.tenderName.toLowerCase().includes(q) ||
        t.hospitalName.toLowerCase().includes(q) ||
        t.leadSalesRep.toLowerCase().includes(q);

      const matchType = typeFilter === "all" || t.tenderType === typeFilter;
      const matchStatus = statusFilter === "all" || t.status === statusFilter;

      return matchSearch && matchType && matchStatus;
    });
  }, [tenders, searchQuery, typeFilter, statusFilter]);

  // Handlers
  const handleOpenNewBid = () => {
    setEditingTenderId(null);
    setNewBidForm(createDefaultBidForm(pickDefaultRep()));
    setIsNewBidModalOpen(true);
  };

  const handleOpenEditBid = (tender: HospitalTender) => {
    setEditingTenderId(tender.id);
    setNewBidForm({
      bidCode: tender.bidCode,
      tenderName: tender.tenderName,
      hospitalName: tender.hospitalName,
      procurementAgency: tender.procurementAgency,
      tenderType: tender.tenderType,
      biddingMethod: tender.biddingMethod,
      packageBudget: parseMoney(tender.packageBudget),
      ourBidPrice: parseMoney(tender.ourBidPrice),
      submissionDeadline: tender.submissionDeadline,
      bidSecurityAmount: parseMoney(tender.bidSecurityAmount),
      leadSalesRep: tender.leadSalesRep,
      notes: tender.notes || ""
    });
    setIsNewBidModalOpen(true);
  };

  const handleCreateBid = (e: React.FormEvent) => {
    e.preventDefault();

    // Chế độ chỉnh sửa: cập nhật gói thầu đã có, giữ nguyên trạng thái & lịch sử
    if (editingTenderId) {
      const updated = tenders.map(t =>
        t.id === editingTenderId
          ? {
              ...t,
              bidCode: newBidForm.bidCode,
              tenderName: newBidForm.tenderName,
              hospitalName: newBidForm.hospitalName,
              tenderType: newBidForm.tenderType,
              packageBudget: parseMoney(newBidForm.packageBudget),
              ourBidPrice: parseMoney(newBidForm.ourBidPrice),
              submissionDeadline: newBidForm.submissionDeadline,
              bidSecurityAmount: parseMoney(newBidForm.bidSecurityAmount),
              leadSalesRep: newBidForm.leadSalesRep,
              notes: newBidForm.notes
            }
          : t
      );
      saveTenders(updated);
      setIsNewBidModalOpen(false);
      setEditingTenderId(null);
      showToast(`Đã cập nhật gói thầu "${newBidForm.bidCode}"!`, "success");
      return;
    }

    const newBid: HospitalTender = {
      id: `BID-${Date.now().toString().slice(-6)}`,
      bidCode: newBidForm.bidCode,
      tenderName: newBidForm.tenderName,
      hospitalName: newBidForm.hospitalName,
      procurementAgency: newBidForm.procurementAgency,
      tenderType: newBidForm.tenderType,
      biddingMethod: newBidForm.biddingMethod,
      packageBudget: parseMoney(newBidForm.packageBudget),
      ourBidPrice: parseMoney(newBidForm.ourBidPrice),
      submissionDeadline: newBidForm.submissionDeadline,
      bidSecurityAmount: parseMoney(newBidForm.bidSecurityAmount),
      status: "CHUAN_BI_HSDT",
      leadSalesRep: newBidForm.leadSalesRep,
      notes: newBidForm.notes,
      totalDeliveryCalls: 4,
      completedDeliveryCalls: 0
    };

    const updated = [newBid, ...tenders];
    saveTenders(updated);
    setIsNewBidModalOpen(false);
    showToast(`Đã thêm gói thầu "${newBid.tenderName.slice(0, 30)}..." vào hệ thống theo dõi!`, "success");
  };

  const handleOpenNewRental = () => {
    setEditingRentalId(null);
    setNewRentalForm(createDefaultRentalForm(pickDefaultRep()));
    setIsNewRentalModalOpen(true);
  };

  const handleOpenEditRental = (rental: ReagentRentalAgreement) => {
    setEditingRentalId(rental.id);
    setNewRentalForm({
      code: rental.code,
      hospitalName: rental.hospitalName,
      department: rental.department,
      placedDeviceName: rental.placedDeviceName,
      model: rental.model,
      serialNumber: rental.serialNumber,
      associatedReagents: rental.associatedReagents,
      startDate: rental.startDate || "",
      endDate: rental.endDate || "",
      monthlyCommitmentTests: parseMoney(rental.monthlyCommitmentTests),
      currentMonthActualTests: parseMoney(rental.currentMonthActualTests),
      pricePerTest: parseMoney(rental.pricePerTest),
      assignedSalesRep: rental.assignedSalesRep,
      assignedFSE: rental.assignedFSE
    });
    setIsNewRentalModalOpen(true);
  };

  const handleCreateRental = (e: React.FormEvent) => {
    e.preventDefault();
    const monthlyCommit = parseMoney(newRentalForm.monthlyCommitmentTests) || 1;
    const actual = parseMoney(newRentalForm.currentMonthActualTests);
    const isWarning = (actual / monthlyCommit) < 0.8;

    const rentalFields = {
      code: newRentalForm.code,
      hospitalName: newRentalForm.hospitalName,
      department: newRentalForm.department,
      placedDeviceName: newRentalForm.placedDeviceName,
      model: newRentalForm.model,
      serialNumber: newRentalForm.serialNumber,
      associatedReagents: newRentalForm.associatedReagents,
      startDate: newRentalForm.startDate,
      endDate: newRentalForm.endDate,
      monthlyCommitmentTests: monthlyCommit,
      currentMonthActualTests: actual,
      pricePerTest: parseMoney(newRentalForm.pricePerTest),
      assignedSalesRep: newRentalForm.assignedSalesRep,
      assignedFSE: newRentalForm.assignedFSE
    };

    // Chế độ chỉnh sửa: cập nhật hợp đồng đã có, tính lại trạng thái cam kết (giữ nguyên nếu đã hết hạn)
    if (editingRentalId) {
      const updated = rentals.map(r =>
        r.id === editingRentalId
          ? {
              ...r,
              ...rentalFields,
              status: r.status === "HET_HAN" ? r.status : (isWarning ? "CANH_BAO_HUT_CAM_KET" : "HOAT_DONG_TOT") as ReagentRentalAgreement["status"]
            }
          : r
      );
      saveRentals(updated);
      setIsNewRentalModalOpen(false);
      setEditingRentalId(null);
      showToast(`Đã cập nhật hợp đồng đặt máy mượn "${rentalFields.code}"!`, "success");
      return;
    }

    const newRental: ReagentRentalAgreement = {
      id: `RNT-${Date.now().toString().slice(-6)}`,
      ...rentalFields,
      status: isWarning ? "CANH_BAO_HUT_CAM_KET" : "HOAT_DONG_TOT"
    };

    const updated = [newRental, ...rentals];
    saveRentals(updated);
    setIsNewRentalModalOpen(false);
    showToast(`Đã lưu hợp đồng đặt máy mượn "${newRental.code}" thành công!`, "success");
  };

  const handleUpdateTenderStatus = (tenderId: string, newStatus: TenderStatus) => {
    const updated = tenders.map(t =>
      t.id === tenderId
        ? {
            ...t,
            status: newStatus,
            contractAwardDate: newStatus === "TRUNG_THAU" ? new Date().toLocaleDateString("vi-VN") : t.contractAwardDate
          }
        : t
    );
    saveTenders(updated);
    showToast("Cập nhật trạng thái gói thầu thành công!", "success");
  };

  const handleOpenCloseTenderModal = (tender: HospitalTender, targetStatus: TenderStatus = "TRUOT_THAU") => {
    setSelectedTenderForClose(tender);
    setCloseTenderForm({
      status: targetStatus,
      lostReason: tender.lostReason || "Giá dự thầu của TBRs cao hơn đối thủ",
      customReason: "",
      winningCompetitor: tender.winningCompetitor || "",
      winningBidPrice: tender.winningBidPrice || 0,
      bankGuaranteeReturned: tender.bankGuaranteeReturned ?? true,
      closedNotes: tender.closedNotes || ""
    });
    setIsCloseTenderModalOpen(true);
  };

  const handleConfirmCloseTender = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenderForClose) return;

    const finalReason = closeTenderForm.lostReason === "Khác" && closeTenderForm.customReason
      ? closeTenderForm.customReason
      : closeTenderForm.lostReason;

    const updated = tenders.map(t =>
      t.id === selectedTenderForClose.id
        ? {
            ...t,
            status: closeTenderForm.status,
            lostReason: finalReason,
            winningCompetitor: closeTenderForm.winningCompetitor || undefined,
            winningBidPrice: Number(closeTenderForm.winningBidPrice) || undefined,
            bankGuaranteeReturned: closeTenderForm.bankGuaranteeReturned,
            closedDate: new Date().toLocaleDateString("vi-VN"),
            closedNotes: closeTenderForm.closedNotes || undefined
          }
        : t
    );

    saveTenders(updated);
    setIsCloseTenderModalOpen(false);
    setSelectedTenderForClose(null);
    showToast(`Đã ghi nhận kết quả và kết thúc hồ sơ gói thầu "${selectedTenderForClose.bidCode}"!`, "info");
  };

  const handleOpenWinTenderModal = (tender: HospitalTender, targetStatus: TenderStatus = "TRUNG_THAU") => {
    setSelectedTenderForWin(tender);
    setWinTenderForm({
      status: targetStatus === "TRUNG_MOT_PHAN" ? "TRUNG_MOT_PHAN" : "TRUNG_THAU",
      actualWonPrice: tender.actualWonPrice !== undefined ? tender.actualWonPrice : tender.ourBidPrice,
      wonLots: tender.wonLots || "",
      lostLotsInfo: tender.lostReason || "",
      decisionNumber: tender.decisionNumber || "",
      decisionDate: tender.decisionDate || todayVN(),
      contractAwardDate: tender.contractAwardDate || new Date().toLocaleDateString("vi-VN"),
      totalDeliveryCalls: tender.totalDeliveryCalls || 1,
      winNotes: tender.winNotes || tender.closedNotes || ""
    });
    setIsWinTenderModalOpen(true);
  };

  const handleConfirmWinTender = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenderForWin) return;

    const wonPrice = Number(winTenderForm.actualWonPrice) || selectedTenderForWin.ourBidPrice;
    const isPartial = winTenderForm.status === "TRUNG_MOT_PHAN";

    const updated = tenders.map(t =>
      t.id === selectedTenderForWin.id
        ? {
            ...t,
            status: winTenderForm.status,
            actualWonPrice: wonPrice,
            wonLots: isPartial ? (winTenderForm.wonLots || "Trúng một số lô") : undefined,
            lostReason: isPartial ? (winTenderForm.lostLotsInfo || undefined) : undefined,
            decisionNumber: winTenderForm.decisionNumber || undefined,
            decisionDate: winTenderForm.decisionDate || undefined,
            contractAwardDate: winTenderForm.contractAwardDate || new Date().toLocaleDateString("vi-VN"),
            totalDeliveryCalls: Number(winTenderForm.totalDeliveryCalls) || 1,
            winNotes: winTenderForm.winNotes || undefined,
            closedNotes: winTenderForm.winNotes || undefined
          }
        : t
    );

    saveTenders(updated);
    setIsWinTenderModalOpen(false);
    setSelectedTenderForWin(null);
    showToast(
      isPartial 
        ? `Đã ghi nhận kết quả trúng thầu một phần cho gói "${selectedTenderForWin.bidCode}"!`
        : `Chúc mừng! Đã ghi nhận trúng thầu thành công gói "${selectedTenderForWin.bidCode}"!`,
      "success"
    );
  };

  const handleIncrementDelivery = (tenderId: string) => {
    const updated = tenders.map(t => {
      if (t.id === tenderId) {
        const current = t.completedDeliveryCalls || 0;
        const total = t.totalDeliveryCalls || 1;
        const next = Math.min(total, current + 1);
        return { ...t, completedDeliveryCalls: next };
      }
      return t;
    });
    saveTenders(updated);
    showToast("Đã ghi nhận giao thêm 01 đợt hàng theo hợp đồng khung!", "success");
  };

  const formatVND = (val: unknown) => {
    const num = parseMoney(val);
    if (num >= 1000000000) {
      return `${(num / 1000000000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ`;
    }
    if (num >= 1000000) {
      return `${(num / 1000000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`;
    }
    // Dưới 1 triệu: hiển thị đầy đủ có phân cách phần nghìn (tránh hiện "0 tr")
    return num.toLocaleString("vi-VN");
  };

  return (
    <div className="space-y-6">
      {/* 4 Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Gói Thầu Đang Tham Gia</span>
            <Building2 className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {biddingMetrics.activeTendersCount} gói thầu
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Tổng giá trị dự thầu: <strong>{formatVND(biddingMetrics.totalActiveBudget)} VNĐ</strong>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Gói Thầu Đã Trúng (Won)</span>
            <Award className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {biddingMetrics.wonCount} gói trúng
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">
            Doanh số trúng thầu: {formatVND(biddingMetrics.totalWonValue)} VNĐ
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Tỷ Lệ Trúng Thầu (Win Rate)</span>
            <Percent className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-500 mt-1">
            {biddingMetrics.winRate}%
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Theo tiêu chí kỹ thuật &amp; giá cạnh tranh
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Đặt Máy Mượn (Reagent Rental)</span>
            <Cpu className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
            {biddingMetrics.totalRentals} hợp đồng
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {biddingMetrics.warningRentals > 0 ? (
              <span className="text-rose-500 font-bold">⚠ {biddingMetrics.warningRentals} đơn vị đang hụt cam kết</span>
            ) : (
              <span className="text-emerald-600 font-bold">✓ 100% đơn vị đạt cam kết test</span>
            )}
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs & Actions Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab("tenders")}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === "tenders"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Gói Thầu ({tenders.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab("reagent_rental")}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === "reagent_rental"
                ? "bg-purple-600 text-white shadow-md shadow-purple-600/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Hợp Đồng Đặt Máy Mượn Hóa Chất (Reagent Rental)</span>
            {biddingMetrics.warningRentals > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-mono font-bold">
                {biddingMetrics.warningRentals}
              </span>
            )}
          </button>
        </div>

        {/* Action Button */}
        <div>
          {activeSubTab === "tenders" ? (
            <button
              onClick={handleOpenNewBid}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Theo Dõi Gói Thầu Mới</span>
            </button>
          ) : (
            <button
              onClick={handleOpenNewRental}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-md shadow-purple-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Thêm Hợp Đồng Đặt Máy Mượn</span>
            </button>
          )}
        </div>
      </div>

      {/* SUB-VIEW 1: HOSPITAL BIDDING PROJECTS */}
      {activeSubTab === "tenders" && (
        <div className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tìm theo số hiệu TBMT, Tên gói thầu, Đơn vị mời thầu..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <option value="all">Tất cả loại gói thầu</option>
                <optgroup label="🏥 Mảng Y Tế & Bệnh Viện">
                  <option value="THIET_BI">Mua sắm thiết bị y tế</option>
                  <option value="HOA_CHAT_KIT">Mua sắm hóa chất &amp; kit test y tế</option>
                  <option value="DAT_MAY_MUON">Đặt máy mượn (Reagent Rental)</option>
                </optgroup>
                <optgroup label="🏫 Mảng Trường Học & Viện Nghiên Cứu">
                  <option value="TRUONG_HOC_THIET_BI">Trường học - Thiết bị phân tích &amp; Phòng Lab</option>
                  <option value="TRUONG_HOC_HOA_CHAT">Trường học - Hóa chất &amp; Vật tư thí nghiệm</option>
                </optgroup>
                <optgroup label="🏭 Mảng Công Nghiệp & Nhà Máy">
                  <option value="CONG_NGHIEP_KIEM_NGHIEM">Công nghiệp - Thiết bị &amp; Hóa chất kiểm nghiệm QC/KCS</option>
                  <option value="CONG_NGHIEP_SAN_XUAT">Công nghiệp - Men vi sinh &amp; Sinh phẩm môi trường</option>
                </optgroup>
                <optgroup label="🔧 Dịch Vụ & Khác">
                  <option value="DICH_VU_KT">Dịch vụ bảo trì, hiệu chuẩn kỹ thuật</option>
                  <option value="GOI_THAU_KHAC">Gói thầu khác</option>
                </optgroup>
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
              >
                <option value="all">Tất cả trạng thái thầu</option>
                <option value="CHUAN_BI_HSDT">Đang chuẩn bị HSDT</option>
                <option value="DA_NOP_HSDT">Đã nộp thầu</option>
                <option value="DANG_DANH_GIA">Đang chấm thầu</option>
                <option value="TRUNG_THAU">Đã trúng thầu toàn bộ (Won)</option>
                <option value="TRUNG_MOT_PHAN">Trúng một phần / một số lô</option>
                <option value="TRUOT_THAU">Trượt thầu (Lost)</option>
              </select>
            </div>
          </div>

          {/* Tenders Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                    <th className="py-3 px-4">Số Hiệu TBMT</th>
                    <th className="py-3 px-4">Tên Gói Thầu &amp; Đơn Vị Mời Thầu</th>
                    <th className="py-3 px-4">Phân Loại</th>
                    <th className="py-3 px-4">Giá Gói Thầu</th>
                    <th className="py-3 px-4">Giá Dự Thầu / Giá Trúng</th>
                    <th className="py-3 px-4">Hạn Đóng Thầu</th>
                    <th className="py-3 px-4 text-center">Trạng Thái</th>
                    <th className="py-3 px-4 text-center">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredTenders.map(tender => {
                    const statusConfig = {
                      CHUAN_BI_HSDT: { label: "Chuẩn bị HSDT", bg: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
                      DA_NOP_HSDT: { label: "Đã nộp thầu", bg: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
                      DANG_DANH_GIA: { label: "Đang chấm thầu", bg: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" },
                      TRUNG_THAU: { label: "Trúng thầu (Won)", bg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 font-bold" },
                      TRUNG_MOT_PHAN: { label: "Trúng một phần", bg: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 font-bold border border-teal-300 dark:border-teal-800" },
                      TRUOT_THAU: { label: "Trượt thầu", bg: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400" }
                    }[tender.status] || { label: tender.status, bg: "bg-slate-100 text-slate-700" };

                    const budgetNum = parseMoney(tender.packageBudget);
                    const bidNum = parseMoney(tender.actualWonPrice ?? tender.ourBidPrice);
                    const savingsPercent = budgetNum > 0 ? `${Math.round(((budgetNum - bidNum) / budgetNum) * 100)}%` : "—";

                    return (
                      <tr key={tender.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3.5 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                          {tender.bidCode}
                          <div className="text-[10px] text-slate-400 font-sans font-normal">
                            BL: {formatVND(tender.bidSecurityAmount)} VNĐ
                          </div>
                        </td>

                        <td className="py-3.5 px-4 max-w-sm">
                          <div className="font-bold text-slate-900 dark:text-white leading-tight">
                            {tender.tenderName}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <strong className="text-slate-700 dark:text-slate-300">{tender.hospitalName}</strong>
                          </div>
                          {tender.winNotes && (
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 italic mt-0.5 line-clamp-1" title={tender.winNotes}>
                              🏆 {tender.winNotes}
                            </div>
                          )}
                          {tender.notes && !tender.winNotes && (
                            <div className="text-[10px] text-slate-400 italic mt-0.5 line-clamp-1">
                              {tender.notes}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {(() => {
                            const badge = getTenderTypeBadge(tender.tenderType);
                            return (
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${badge.bg}`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            NVKD: {tender.leadSalesRep}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {formatVND(tender.packageBudget)} VNĐ
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap font-mono">
                          <div className="font-bold text-emerald-600 dark:text-emerald-400">
                            {formatVND(tender.actualWonPrice ?? tender.ourBidPrice)} VNĐ
                          </div>
                          {tender.actualWonPrice && tender.actualWonPrice !== tender.ourBidPrice && (
                            <div className="text-[10px] text-slate-400 line-through">
                              Dự thầu: {formatVND(tender.ourBidPrice)} VNĐ
                            </div>
                          )}
                          <div className="text-[10px] text-slate-400">
                            Tiết kiệm: {savingsPercent}%
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          {tender.submissionDeadline}
                        </td>

                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold ${statusConfig.bg}`}>
                            {statusConfig.label}
                          </span>
                          {tender.wonLots && (
                            <div className="text-[10px] text-teal-700 dark:text-teal-300 mt-1 max-w-[150px] truncate mx-auto font-medium" title={tender.wonLots}>
                              🎯 {tender.wonLots}
                            </div>
                          )}
                          {(tender.status === "TRUNG_THAU" || tender.status === "TRUNG_MOT_PHAN") && tender.totalDeliveryCalls && (
                            <div className="text-[10px] text-emerald-600 mt-1 font-mono">
                              Đã giao: {tender.completedDeliveryCalls || 0}/{tender.totalDeliveryCalls} đợt
                            </div>
                          )}
                          {tender.status === "TRUOT_THAU" && (
                            <div className="mt-1 text-left text-[10px] max-w-[150px] mx-auto space-y-0.5">
                              {tender.lostReason && (
                                <div className="text-rose-500 font-medium truncate" title={tender.lostReason}>
                                  Lý do: {tender.lostReason}
                                </div>
                              )}
                              {tender.bankGuaranteeReturned !== undefined && (
                                <div className={`font-mono text-[9px] ${tender.bankGuaranteeReturned ? "text-emerald-500" : "text-amber-500"}`}>
                                  {tender.bankGuaranteeReturned ? "✓ Đã thu hồi BL" : "⚠ Chưa thu hồi BL"}
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {/* Chỉnh sửa thông tin gói thầu (giá, bảo lãnh, NVKD...) */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditBid(tender)}
                              className="flex items-center gap-1 px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 dark:text-indigo-300 dark:border-indigo-800 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                              title="Chỉnh sửa thông tin gói thầu (giá gói thầu, giá dự thầu, bảo lãnh, NVKD...)"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Sửa</span>
                            </button>

                            {/* Giai đoạn 1: Chuẩn bị HSDT */}
                            {tender.status === "CHUAN_BI_HSDT" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateTenderStatus(tender.id, "DA_NOP_HSDT")}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-xs"
                                  title="Đánh dấu đã nộp thầu thành công"
                                >
                                  Đã Nộp Thầu
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenCloseTenderModal(tender, "TRUOT_THAU")}
                                  className="px-2 py-1 bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 dark:bg-slate-800 dark:hover:bg-rose-950/60 dark:text-slate-300 dark:hover:text-rose-300 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                                  title="Hủy tham gia / Rút hồ sơ dự thầu"
                                >
                                  Hủy / Rút
                                </button>
                              </>
                            )}

                            {/* Giai đoạn 2: Đã nộp HSDT */}
                            {tender.status === "DA_NOP_HSDT" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateTenderStatus(tender.id, "DANG_DANH_GIA")}
                                  className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-xs"
                                  title="Đánh dấu đã mở thầu & đang trong giai đoạn chấm thầu"
                                >
                                  Đang Chấm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenCloseTenderModal(tender, "TRUOT_THAU")}
                                  className="px-2 py-1 bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 dark:bg-slate-800 dark:hover:bg-rose-950/60 dark:text-slate-300 dark:hover:text-rose-300 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                                  title="Bệnh viện hủy gói thầu hoặc không hợp lệ"
                                >
                                  Hủy Thầu
                                </button>
                              </>
                            )}

                            {/* Giai đoạn 3: Đang chấm thầu - 2 LỰA CHỌN RÕ RÀNG: TRÚNG THẦU HOẶC TRƯỢT THẦU */}
                            {tender.status === "DANG_DANH_GIA" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleOpenWinTenderModal(tender, "TRUNG_THAU")}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1"
                                  title="Ghi nhận trúng thầu (toàn bộ hoặc trúng một số lô) kèm ghi chú"
                                >
                                  <span>🏆 Trúng Thầu</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleOpenCloseTenderModal(tender, "TRUOT_THAU")}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all shadow-xs flex items-center gap-1"
                                  title="Ghi nhận không trúng thầu, lưu lý do và kết thúc hồ sơ"
                                >
                                  <span>❌ Trượt Thầu</span>
                                </button>
                              </>
                            )}

                            {/* Giai đoạn 4: Đã trúng thầu hoặc trúng một phần */}
                            {(tender.status === "TRUNG_THAU" || tender.status === "TRUNG_MOT_PHAN") && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenWinTenderModal(tender, tender.status)}
                                  className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-lg text-[10px] font-bold cursor-pointer transition-all border border-emerald-200 dark:border-emerald-800"
                                  title="Xem & sửa thông tin trúng thầu, phân lô, số QĐ, ghi chú"
                                >
                                  Chi Tiết Trúng
                                </button>
                                {(tender.completedDeliveryCalls || 0) < (tender.totalDeliveryCalls || 1) ? (
                                  <button
                                    type="button"
                                    onClick={() => handleIncrementDelivery(tender.id)}
                                    className="px-2 py-1 bg-emerald-700/80 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                                    title="Ghi nhận giao thêm 01 đợt hàng theo HĐ khung"
                                  >
                                    +1 Đợt ({tender.completedDeliveryCalls || 0}/{tender.totalDeliveryCalls || 1})
                                  </button>
                                ) : (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded text-[10px] font-bold">
                                    ✓ Đã giao đủ
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Giai đoạn 5: Đã trượt thầu / Kết thúc hồ sơ */}
                            {tender.status === "TRUOT_THAU" && (
                              <button
                                type="button"
                                onClick={() => handleOpenCloseTenderModal(tender, "TRUOT_THAU")}
                                className="px-2 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900/60 rounded-lg text-[10px] font-bold cursor-pointer transition-all border border-rose-200 dark:border-rose-900"
                                title="Xem chi tiết lý do trượt thầu & tình trạng bảo lãnh"
                              >
                                Xem Lý Do / Đóng
                              </button>
                            )}

                            {/* Dropdown chỉnh trực tiếp trạng thái bất cứ lúc nào */}
                            <select
                              value={tender.status}
                              onChange={(e) => {
                                const newSt = e.target.value as TenderStatus;
                                if (newSt === "TRUOT_THAU") {
                                  handleOpenCloseTenderModal(tender, "TRUOT_THAU");
                                } else if (newSt === "TRUNG_THAU" || newSt === "TRUNG_MOT_PHAN") {
                                  handleOpenWinTenderModal(tender, newSt);
                                } else {
                                  handleUpdateTenderStatus(tender.id, newSt);
                                }
                              }}
                              className="px-1.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-[9px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                              title="Tùy chọn đổi trạng thái nhanh"
                            >
                              <option value="CHUAN_BI_HSDT">1. Soạn HSDT</option>
                              <option value="DA_NOP_HSDT">2. Đã nộp</option>
                              <option value="DANG_DANH_GIA">3. Đang chấm</option>
                              <option value="TRUNG_THAU">4. Trúng thầu toàn bộ</option>
                              <option value="TRUNG_MOT_PHAN">4.5. Trúng một phần (Lô)</option>
                              <option value="TRUOT_THAU">5. Trượt thầu (Lost)</option>
                            </select>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: REAGENT RENTAL AGREEMENTS (ĐẶT MÁY MƯỢN HÓA CHẤT) */}
      {activeSubTab === "reagent_rental" && (
        <div className="space-y-4">
          <div className="bg-purple-50 dark:bg-purple-950/30 p-4 rounded-2xl border border-purple-200 dark:border-purple-900 text-xs">
            <h4 className="font-bold text-purple-900 dark:text-purple-300 text-sm flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              <span>Mô Hình Đặt Máy Xét Nghiệm Cho Mượn - Tiêu Hao Hóa Chất (Reagent Rental Agreements)</span>
            </h4>
            <p className="mt-1 text-slate-600 dark:text-slate-300 leading-relaxed">
              TBRs / ABT trang bị máy xét nghiệm (Real-time PCR, Tách chiết,...) tại bệnh viện không thu tiền máy. Bệnh viện cam kết sản lượng tiêu thụ kit test tối thiểu hàng tháng. Hệ thống tự động đối soát và phát tín hiệu cảnh báo nếu viện chạy dưới 70% định mức cam kết.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rentals.map(rnt => {
              const commitTests = parseMoney(rnt.monthlyCommitmentTests);
              const consumptionRate = commitTests > 0 ? Math.round((parseMoney(rnt.currentMonthActualTests) / commitTests) * 100) : 0;
              const isWarning = consumptionRate < 80;

              return (
                <div
                  key={rnt.id}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                    <span className="font-mono text-xs font-bold text-purple-600 dark:text-purple-400">
                      {rnt.code}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          !isWarning
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                            : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                        }`}
                      >
                        {!isWarning ? "Đạt Cam Kết" : "Cảnh Báo Hụt Mẫu"}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleOpenEditRental(rnt)}
                        className="flex items-center gap-1 px-2 py-0.5 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:hover:bg-purple-900/60 dark:text-purple-300 dark:border-purple-800 rounded-lg text-[10px] font-bold cursor-pointer transition-all"
                        title="Chỉnh sửa thông tin hợp đồng đặt máy mượn"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Sửa</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900 dark:text-white text-sm">{rnt.hospitalName}</div>
                    <div className="text-xs text-slate-500">{rnt.department}</div>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl space-y-1.5 text-xs">
                    <div>
                      <span className="text-slate-400">Thiết bị mượn:</span>{" "}
                      <strong className="text-slate-800 dark:text-slate-200">{rnt.placedDeviceName}</strong>
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      SN: {rnt.serialNumber} | Model: {rnt.model}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400">
                      Hóa chất: {rnt.associatedReagents}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Thời hạn: {rnt.startDate || "—"} → {rnt.endDate || "—"} | Đơn giá: {formatThousands(rnt.pricePerTest) || "0"} VNĐ/test
                    </div>
                  </div>

                  {/* Commitment vs Actual Consumption Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Tiêu hao tháng này:</span>
                      <span className="font-mono font-bold">
                        <strong className={isWarning ? "text-rose-600" : "text-emerald-600"}>
                          {rnt.currentMonthActualTests}
                        </strong>{" "}
                        / {rnt.monthlyCommitmentTests} test ({consumptionRate}%)
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          !isWarning ? "bg-emerald-500" : "bg-rose-500"
                        }`}
                        style={{ width: `${Math.min(100, consumptionRate)}%` }}
                      />
                    </div>
                  </div>

                  {/* Personnel Responsible */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                    <span>NVKD: <strong>{rnt.assignedSalesRep}</strong></span>
                    <span>FSE: <strong>{rnt.assignedFSE}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL: TẠO GÓI THẦU MỚI (NEW TENDER MODAL) */}
      {isNewBidModalOpen && (
        <Modal
          isOpen={isNewBidModalOpen}
          onClose={() => { setIsNewBidModalOpen(false); setEditingTenderId(null); }}
          title={editingTenderId ? "Chỉnh Sửa Gói Thầu" : "Theo Dõi Gói Thầu Mới"}
          size="2xl"
        >
          <form onSubmit={handleCreateBid} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Số Hiệu KHLCNT / TBMT
                </label>
                <input
                  type="text"
                  value={newBidForm.bidCode}
                  onChange={e => setNewBidForm({ ...newBidForm, bidCode: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Phân Loại Gói Thầu
                </label>
                <select
                  value={newBidForm.tenderType}
                  onChange={e => setNewBidForm({ ...newBidForm, tenderType: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  <optgroup label="🏥 Mảng Y Tế & Bệnh Viện">
                    <option value="HOA_CHAT_KIT">Mua sắm hóa chất &amp; kit xét nghiệm</option>
                    <option value="THIET_BI">Mua sắm thiết bị y tế</option>
                    <option value="DAT_MAY_MUON">Đặt máy mượn (Reagent Rental)</option>
                  </optgroup>
                  <optgroup label="🏫 Mảng Trường Học & Viện Nghiên Cứu">
                    <option value="TRUONG_HOC_THIET_BI">Trường học - Thiết bị phân tích &amp; Phòng Lab</option>
                    <option value="TRUONG_HOC_HOA_CHAT">Trường học - Hóa chất &amp; Vật tư thí nghiệm</option>
                  </optgroup>
                  <optgroup label="🏭 Mảng Công Nghiệp & Nhà Máy">
                    <option value="CONG_NGHIEP_KIEM_NGHIEM">Công nghiệp - Thiết bị &amp; Hóa chất kiểm nghiệm QC/KCS</option>
                    <option value="CONG_NGHIEP_SAN_XUAT">Công nghiệp - Men vi sinh &amp; Sinh phẩm môi trường</option>
                  </optgroup>
                  <optgroup label="🔧 Dịch Vụ & Khác">
                    <option value="DICH_VU_KT">Dịch vụ bảo trì, hiệu chuẩn kỹ thuật</option>
                    <option value="GOI_THAU_KHAC">Gói thầu khác</option>
                  </optgroup>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tên Gói Thầu (Theo Thông Báo Mời Thầu)
              </label>
              <textarea
                value={newBidForm.tenderName}
                onChange={e => setNewBidForm({ ...newBidForm, tenderName: e.target.value })}
                rows={2}
                placeholder="Ví dụ: Gói thầu mua sắm thiết bị phân tích / hóa chất sinh phẩm kiểm nghiệm..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white resize-none font-bold"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Đơn Vị Mời Thầu / Chủ Đầu Tư (Bệnh viện, Trường học, Doanh nghiệp...)
                </label>
                <input
                  type="text"
                  value={newBidForm.hospitalName}
                  onChange={e => setNewBidForm({ ...newBidForm, hospitalName: e.target.value })}
                  placeholder="Ví dụ: Bệnh Viện Chợ Rẫy, ĐH Bách Khoa, Masan Group..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Thời Điểm Đóng Thầu
                </label>
                <input
                  type="text"
                  value={newBidForm.submissionDeadline}
                  onChange={e => setNewBidForm({ ...newBidForm, submissionDeadline: e.target.value })}
                  placeholder="dd/mm/yyyy HH:mm"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Giá Gói Thầu (VNĐ)
                </label>
                <MoneyInput
                  value={newBidForm.packageBudget}
                  onValueChange={v => setNewBidForm({ ...newBidForm, packageBudget: v })}
                  placeholder="Ví dụ: 2.000.000.000"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Giá Dự Thầu TBRs (VNĐ)
                </label>
                <MoneyInput
                  value={newBidForm.ourBidPrice}
                  onValueChange={v => setNewBidForm({ ...newBidForm, ourBidPrice: v })}
                  placeholder="Ví dụ: 1.900.000.000"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-emerald-600"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Bảo Lãnh Dự Thầu (VNĐ)
                </label>
                <MoneyInput
                  value={newBidForm.bidSecurityAmount}
                  onValueChange={v => setNewBidForm({ ...newBidForm, bidSecurityAmount: v })}
                  placeholder="Ví dụ: 50.000.000"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                NVKD Phụ Trách Thầu
              </label>
              <select
                value={newBidForm.leadSalesRep}
                onChange={e => setNewBidForm({ ...newBidForm, leadSalesRep: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
              >
                {renderSalesRepOptions(newBidForm.leadSalesRep)}
              </select>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewBidModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
              >
                {editingTenderId ? "Cập Nhật Gói Thầu" : "Lưu Gói Thầu"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: TẠO HỢP ĐỒNG ĐẶT MÁY MƯỢN MỚI (NEW REAGENT RENTAL MODAL) */}
      {isNewRentalModalOpen && (
        <Modal
          isOpen={isNewRentalModalOpen}
          onClose={() => { setIsNewRentalModalOpen(false); setEditingRentalId(null); }}
          title={editingRentalId ? "Chỉnh Sửa Hợp Đồng Đặt Máy Mượn" : "Tạo Thỏa Thuận Đặt Máy Mượn - Tiêu Hao Hóa Chất (Reagent Rental)"}
          size="2xl"
        >
          <form onSubmit={handleCreateRental} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Mã Hợp Đồng / Thỏa Thuận
                </label>
                <input
                  type="text"
                  value={newRentalForm.code}
                  onChange={e => setNewRentalForm({ ...newRentalForm, code: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Bệnh Viện / Đơn Vị Đặt Máy
                </label>
                <input
                  type="text"
                  value={newRentalForm.hospitalName}
                  onChange={e => setNewRentalForm({ ...newRentalForm, hospitalName: e.target.value })}
                  placeholder="Ví dụ: Bệnh Viện Chợ Rẫy - TP.HCM"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Khoa / Phòng Sử Dụng
                </label>
                <input
                  type="text"
                  value={newRentalForm.department}
                  onChange={e => setNewRentalForm({ ...newRentalForm, department: e.target.value })}
                  placeholder="Ví dụ: Khoa Vi Sinh / Sinh Học Phân Tử"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Thiết Bị Đặt Mượn
                </label>
                <input
                  type="text"
                  value={newRentalForm.placedDeviceName}
                  onChange={e => setNewRentalForm({ ...newRentalForm, placedDeviceName: e.target.value })}
                  placeholder="Ví dụ: Hệ thống Real-time PCR TBR-9600"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-bold"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Model Máy
                </label>
                <input
                  type="text"
                  value={newRentalForm.model}
                  onChange={e => setNewRentalForm({ ...newRentalForm, model: e.target.value })}
                  placeholder="Ví dụ: TBR-PCR-9600"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Số Serial (SN)
                </label>
                <input
                  type="text"
                  value={newRentalForm.serialNumber}
                  onChange={e => setNewRentalForm({ ...newRentalForm, serialNumber: e.target.value })}
                  placeholder="Ví dụ: SN-TBR-2026-088"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Hóa Chất / Kit Test Đi Kèm Hợp Đồng
              </label>
              <input
                type="text"
                value={newRentalForm.associatedReagents}
                onChange={e => setNewRentalForm({ ...newRentalForm, associatedReagents: e.target.value })}
                placeholder="Ví dụ: Kit Real-time PCR HPV High Risk & HBV Định Lượng..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Ngày Bắt Đầu Hợp Đồng
                </label>
                <input
                  type="text"
                  value={newRentalForm.startDate}
                  onChange={e => setNewRentalForm({ ...newRentalForm, startDate: e.target.value })}
                  placeholder="dd/mm/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Ngày Kết Thúc Hợp Đồng
                </label>
                <input
                  type="text"
                  value={newRentalForm.endDate}
                  onChange={e => setNewRentalForm({ ...newRentalForm, endDate: e.target.value })}
                  placeholder="dd/mm/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Cam Kết Mẫu (Test/Tháng)
                </label>
                <MoneyInput
                  value={newRentalForm.monthlyCommitmentTests}
                  onValueChange={v => setNewRentalForm({ ...newRentalForm, monthlyCommitmentTests: v })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-purple-600"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Thực Tế Tháng Này (Test)
                </label>
                <MoneyInput
                  value={newRentalForm.currentMonthActualTests}
                  onValueChange={v => setNewRentalForm({ ...newRentalForm, currentMonthActualTests: v })}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-emerald-600"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Đơn Giá Mỗi Test (VNĐ)
                </label>
                <MoneyInput
                  value={newRentalForm.pricePerTest}
                  onValueChange={v => setNewRentalForm({ ...newRentalForm, pricePerTest: v })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  NVKD Phụ Trách
                </label>
                <select
                  value={newRentalForm.assignedSalesRep}
                  onChange={e => setNewRentalForm({ ...newRentalForm, assignedSalesRep: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  {renderSalesRepOptions(newRentalForm.assignedSalesRep)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Kỹ Sư FSE Bảo Trì
                </label>
                <select
                  value={newRentalForm.assignedFSE}
                  onChange={e => setNewRentalForm({ ...newRentalForm, assignedFSE: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  {newRentalForm.assignedFSE && !FSE_OPTIONS.includes(newRentalForm.assignedFSE) && (
                    <option value={newRentalForm.assignedFSE}>{newRentalForm.assignedFSE}</option>
                  )}
                  {FSE_OPTIONS.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewRentalModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-600/30"
              >
                {editingRentalId ? "Cập Nhật Hợp Đồng" : "Lưu Hợp Đồng Đặt Máy Mượn"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: KẾT QUẢ ĐẤU THẦU & KẾT THÚC HỒ SƠ (LOST TENDER / CLOSE BID MODAL) */}
      {isCloseTenderModalOpen && selectedTenderForClose && (
        <Modal
          isOpen={isCloseTenderModalOpen}
          onClose={() => {
            setIsCloseTenderModalOpen(false);
            setSelectedTenderForClose(null);
          }}
          title={`Ghi Nhận Kết Quả & Kết Thúc Hồ Sơ: ${selectedTenderForClose.bidCode}`}
          size="2xl"
        >
          <form onSubmit={handleConfirmCloseTender} className="space-y-4">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700/80 space-y-1">
              <div className="font-bold text-xs text-slate-900 dark:text-white">
                {selectedTenderForClose.tenderName}
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>Chủ đầu tư: <strong>{selectedTenderForClose.hospitalName}</strong></span>
                <span>Giá dự thầu TBRs: <strong className="text-emerald-600 font-mono">{formatVND(selectedTenderForClose.ourBidPrice)} VNĐ</strong></span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Kết Quả Cuối Cùng Của Hồ Sơ
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${
                  closeTenderForm.status === "TRUOT_THAU"
                    ? "bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-950/60 dark:border-rose-900 dark:text-rose-300"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                }`}>
                  <input
                    type="radio"
                    name="closeStatus"
                    value="TRUOT_THAU"
                    checked={closeTenderForm.status === "TRUOT_THAU"}
                    onChange={() => setCloseTenderForm({ ...closeTenderForm, status: "TRUOT_THAU" })}
                    className="text-rose-600"
                  />
                  <span>❌ Trượt Thầu (Thua thầu đối thủ)</span>
                </label>

                <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${
                  closeTenderForm.status === "CHUAN_BI_HSDT"
                    ? "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/60 dark:border-amber-900 dark:text-amber-300"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                }`}>
                  <input
                    type="radio"
                    name="closeStatus"
                    value="CHUAN_BI_HSDT"
                    checked={closeTenderForm.status === "CHUAN_BI_HSDT"}
                    onChange={() => setCloseTenderForm({ ...closeTenderForm, status: "CHUAN_BI_HSDT", lostReason: "Bên mời thầu hủy gói thầu hoặc đấu thầu lại" })}
                    className="text-amber-600"
                  />
                  <span>⚠️ Hủy Thầu / Rút Hồ Sơ</span>
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Lý Do Chính Khiến Không Trúng Thầu
              </label>
              <select
                value={closeTenderForm.lostReason}
                onChange={e => setCloseTenderForm({ ...closeTenderForm, lostReason: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
              >
                <option value="Giá dự thầu của TBRs cao hơn đối thủ">Giá dự thầu của TBRs cao hơn đối thủ</option>
                <option value="Hồ sơ kỹ thuật chưa đáp ứng yêu cầu HSMT">Hồ sơ kỹ thuật chưa đáp ứng yêu cầu HSMT</option>
                <option value="Đối thủ có ưu thế công nghệ hoặc độc quyền thiết bị">Đối thủ có ưu thế công nghệ hoặc độc quyền thiết bị</option>
                <option value="Không kịp bổ sung làm rõ hồ sơ theo hạn định">Không kịp bổ sung làm rõ hồ sơ theo hạn định</option>
                <option value="Bên mời thầu hủy gói thầu hoặc đấu thầu lại">Bên mời thầu hủy gói thầu hoặc đấu thầu lại</option>
                <option value="Khác">Lý do khác (Nhập chi tiết bên dưới)</option>
              </select>
            </div>

            {closeTenderForm.lostReason === "Khác" && (
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Nhập Lý Do Chi Tiết
                </label>
                <input
                  type="text"
                  value={closeTenderForm.customReason}
                  onChange={e => setCloseTenderForm({ ...closeTenderForm, customReason: e.target.value })}
                  placeholder="Ghi rõ nguyên nhân không trúng thầu..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Đơn Vị / Hãng Trúng Thầu (Nếu biết)
                </label>
                <input
                  type="text"
                  value={closeTenderForm.winningCompetitor}
                  onChange={e => setCloseTenderForm({ ...closeTenderForm, winningCompetitor: e.target.value })}
                  placeholder="Ví dụ: Công ty Dược Y Tế X / Roche..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Giá Trúng Thầu Của Đối Thủ (VNĐ)
                </label>
                <MoneyInput
                  value={closeTenderForm.winningBidPrice}
                  onValueChange={v => setCloseTenderForm({ ...closeTenderForm, winningBidPrice: v })}
                  placeholder="Ví dụ: 3.800.000.000"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Thu hồi bảo lãnh dự thầu ngân hàng */}
            <div className="p-3 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-xl border border-indigo-200 dark:border-indigo-900/60 flex items-start gap-2.5">
              <input
                type="checkbox"
                id="bankGuaranteeCheck"
                checked={closeTenderForm.bankGuaranteeReturned}
                onChange={e => setCloseTenderForm({ ...closeTenderForm, bankGuaranteeReturned: e.target.checked })}
                className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
              />
              <label htmlFor="bankGuaranteeCheck" className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <strong className="text-indigo-900 dark:text-indigo-300 block">
                  Đã đề nghị Chủ đầu tư / Bên mời thầu hoàn trả / Giải tỏa Thư Bảo Lãnh Ngân Hàng
                </strong>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Số tiền bảo lãnh: <strong>{formatVND(selectedTenderForClose.bidSecurityAmount)} VNĐ</strong>. Tích chọn để xác nhận hoàn tất thủ tục tài chính, giải phóng hạn mức bảo lãnh tại ngân hàng.
                </span>
              </label>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Ghi Chú Rút Kinh Nghiệm Hồ Sơ
              </label>
              <textarea
                value={closeTenderForm.closedNotes}
                onChange={e => setCloseTenderForm({ ...closeTenderForm, closedNotes: e.target.value })}
                rows={2}
                placeholder="Ghi nhận lưu ý cho lần dự thầu tiếp theo tại đơn vị này..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white resize-none"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCloseTenderModalOpen(false);
                  setSelectedTenderForClose(null);
                }}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                Hủy Bỏ
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/30 cursor-pointer transition-all"
              >
                Xác Nhận &amp; Kết Thúc Hồ Sơ
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL GHI NHẬN KẾT QUẢ TRÚNG THẦU / TRÚNG MỘT SỐ LÔ */}
      {isWinTenderModalOpen && selectedTenderForWin && (
        <Modal
          isOpen={isWinTenderModalOpen}
          onClose={() => {
            setIsWinTenderModalOpen(false);
            setSelectedTenderForWin(null);
          }}
          title={`🏆 Ghi Nhận Kết Quả Trúng Thầu: ${selectedTenderForWin.bidCode}`}
          size="2xl"
        >
          <form onSubmit={handleConfirmWinTender} className="space-y-4">
            <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-1">
              <div className="font-bold text-xs text-slate-900 dark:text-white">
                {selectedTenderForWin.tenderName}
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between">
                <span>Chủ đầu tư: <strong>{selectedTenderForWin.hospitalName}</strong></span>
                <span>Giá dự thầu: <strong className="text-indigo-600 font-mono">{formatVND(selectedTenderForWin.ourBidPrice)} VNĐ</strong></span>
              </div>
            </div>

            {/* Phạm vi trúng thầu: Trúng toàn bộ hay trúng một phần (phân lô) */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Phạm Vi &amp; Kết Quả Trúng Thầu *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${
                  winTenderForm.status === "TRUNG_THAU"
                    ? "bg-emerald-50 border-emerald-400 text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300 shadow-xs"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                }`}>
                  <input
                    type="radio"
                    name="winStatus"
                    value="TRUNG_THAU"
                    checked={winTenderForm.status === "TRUNG_THAU"}
                    onChange={() => setWinTenderForm({ ...winTenderForm, status: "TRUNG_THAU" })}
                    className="text-emerald-600"
                  />
                  <span>🏆 Trúng toàn bộ gói thầu</span>
                </label>

                <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${
                  winTenderForm.status === "TRUNG_MOT_PHAN"
                    ? "bg-teal-50 border-teal-400 text-teal-800 dark:bg-teal-950/60 dark:border-teal-800 dark:text-teal-300 shadow-xs"
                    : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                }`}>
                  <input
                    type="radio"
                    name="winStatus"
                    value="TRUNG_MOT_PHAN"
                    checked={winTenderForm.status === "TRUNG_MOT_PHAN"}
                    onChange={() => setWinTenderForm({ ...winTenderForm, status: "TRUNG_MOT_PHAN" })}
                    className="text-teal-600"
                  />
                  <span>🎯 Trúng một phần (Có phân lô)</span>
                </label>
              </div>
            </div>

            {/* Chi tiết phân lô khi trúng một phần */}
            {winTenderForm.status === "TRUNG_MOT_PHAN" && (
              <div className="p-3 bg-teal-50/50 dark:bg-teal-950/30 rounded-xl border border-teal-200 dark:border-teal-900 space-y-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-teal-900 dark:text-teal-200">
                    Danh Sách Các Lô Trúng Thầu *
                  </label>
                  <input
                    type="text"
                    value={winTenderForm.wonLots}
                    onChange={e => setWinTenderForm({ ...winTenderForm, wonLots: e.target.value })}
                    placeholder="VD: Trúng Lô 1 (Hệ thống Realtime PCR) &amp; Lô 2 (Bộ kit tách chiết)..."
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-teal-300 dark:border-teal-700 rounded-xl text-xs text-slate-900 dark:text-white font-medium"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                    Các Lô Trượt Thầu &amp; Đơn Vị Trúng (Nếu biết)
                  </label>
                  <input
                    type="text"
                    value={winTenderForm.lostLotsInfo}
                    onChange={e => setWinTenderForm({ ...winTenderForm, lostLotsInfo: e.target.value })}
                    placeholder="VD: Trượt Lô 3 (Hóa chất chuyên dụng) về tay Công ty X do giá thấp hơn..."
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* Giá trị trúng thầu thực tế & Số Quyết định */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Giá Trị Trúng Thầu Thực Tế (VNĐ) *
                </label>
                <MoneyInput
                  value={winTenderForm.actualWonPrice}
                  onValueChange={v => setWinTenderForm({ ...winTenderForm, actualWonPrice: v })}
                  placeholder="Giá trúng thầu sau thương thảo / giá các lô trúng..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400"
                  required
                />
                <div className="text-[10px] text-slate-400">
                  {winTenderForm.status === "TRUNG_MOT_PHAN" 
                    ? "Tổng giá trị của các phân lô mà TBRs trúng thầu"
                    : "Giá trúng thầu chính thức được phê duyệt"}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Số Quyết Định Phê Duyệt KQLCNT
                </label>
                <input
                  type="text"
                  value={winTenderForm.decisionNumber}
                  onChange={e => setWinTenderForm({ ...winTenderForm, decisionNumber: e.target.value })}
                  placeholder="VD: 158/QĐ-BV, 2026/QĐ-SYT..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Ngày Ban Hành Quyết Định / Ký HĐ Khung
                </label>
                <input
                  type="date"
                  value={winTenderForm.decisionDate}
                  onChange={e => setWinTenderForm({ ...winTenderForm, decisionDate: e.target.value, contractAwardDate: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Số Đợt Gọi Hàng Dự Kiến (HĐ Khung)
                </label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={winTenderForm.totalDeliveryCalls}
                  onChange={e => setWinTenderForm({ ...winTenderForm, totalDeliveryCalls: parseInt(e.target.value) || 1 })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Ghi chú trúng thầu & thực hiện hợp đồng */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Ghi Chú Trúng Thầu &amp; Kế Hoạch Triển Khai
              </label>
              <textarea
                rows={3}
                value={winTenderForm.winNotes}
                onChange={e => setWinTenderForm({ ...winTenderForm, winNotes: e.target.value })}
                placeholder="Ghi chú điều kiện bảo lãnh thực hiện hợp đồng, thời hạn giao hàng đợt 1, đầu mối liên hệ của bệnh viện, phụ lục thỏa thuận..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none resize-none font-medium"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsWinTenderModalOpen(false);
                  setSelectedTenderForWin(null);
                }}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
              >
                Hủy Bỏ
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 cursor-pointer transition-all flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Lưu Kết Quả Trúng Thầu</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
