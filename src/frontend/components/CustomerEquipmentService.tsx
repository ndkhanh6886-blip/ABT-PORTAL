"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Wrench,
  ShieldCheck,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Plus,
  Search,
  Filter,
  Eye,
  Download,
  Printer,
  FileText,
  Paperclip,
  Check,
  X,
  AlertCircle,
  Truck,
  Activity,
  Trash2,
  ExternalLink,
  Upload,
  Cpu,
  RefreshCw,
  Sparkles,
  Layers,
  Thermometer,
  Wind,
  Sliders,
  Settings,
  Edit3,
  Save,
  RotateCcw,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { useNotification } from "@/frontend/contexts/NotificationContext";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { usePersonnel, filterPersonnelByDept } from "@/frontend/utils/usePersonnel";
import { useCompanyConfig } from "@/frontend/utils/companyConfig";

// Dòng thiết bị trong danh mục phân phối & dịch vụ kỹ thuật của ABT
export type EquipmentCategory =
  | "PCR_REALTIME"       // Real-time PCR, PCR thường, Digital PCR
  | "EXTRACTION"         // Máy tách chiết DNA/RNA tự động, Robot phân phối mẫu
  | "BIOSAFETY_CABINET"  // Tủ an toàn sinh học Cấp II Type A2/B2, Tủ cấy vi sinh Clean Bench
  | "COLD_STORAGE"       // Tủ âm sâu -86°C, Tủ trữ mẫu -20°C, Tủ bảo quản máu y tế
  | "CENTRIFUGE"         // Máy ly tâm lắng, Ly tâm lạnh công suất lớn
  | "NGS_SEQUENCING"     // Hệ thống giải trình tự gen NGS / Sanger
  | "ELISA_SPECTRO"      // Máy đọc & rửa microplate ELISA, Máy quang phổ UV-Vis / Nanodrop
  | "AUTOCLAVE"          // Nồi hấp tiệt trùng y tế, Tủ sấy tiệt trùng
  | "GENERAL_LAB"        // Thiết bị đo lường & phân tích cơ bản (pH, cân vi lượng, vortex,...)
  | (string & {});       // Cho phép thêm nhóm thiết bị tùy chỉnh linh hoạt

export interface SOPChecklistConfig {
  name: string;
  badgeColor: string;
  standardProtocol: string;
  checklist: Array<{ key: string; label: string; defaultNote?: string }>;
}

export const BADGE_COLOR_OPTIONS = [
  { label: "Xanh Dương (Blue)", value: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200" },
  { label: "Lục Bảo (Emerald)", value: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200" },
  { label: "Tím Thạch Anh (Purple)", value: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200" },
  { label: "Xanh Lam (Cyan)", value: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300 border-cyan-200" },
  { label: "Hổ Phách (Amber)", value: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200" },
  { label: "Chàm Đậm (Indigo)", value: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-indigo-200" },
  { label: "Hồng Sen (Pink)", value: "bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-300 border-pink-200" },
  { label: "Cam Đất (Orange)", value: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300 border-orange-200" },
  { label: "Xám Kỹ Thuật (Slate)", value: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200" }
];

export const DEFAULT_EQUIPMENT_CATEGORIES_CONFIG: Record<string, SOPChecklistConfig> = {
  PCR_REALTIME: {
    name: "Máy Real-time PCR & PCR",
    badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200",
    standardProtocol: "ISO 13485:2016 & Service Manual (Block Peltier/Optics Calibration)",
    checklist: [
      { key: "opticsClean", label: "1. Vệ sinh khối quang học, lăng kính & bộ lọc huỳnh quang" },
      { key: "thermalCalib", label: "2. Hiệu chuẩn dải nhiệt độ khối Block Peltier (95°C / 60°C / 72°C ±0.1°C)" },
      { key: "heatedLid", label: "3. Kiểm tra áp lực nắp nhiệt heated lid & cảm biến chống ngưng tụ (105°C)" },
      { key: "electricalSafety", label: "4. Kiểm tra an toàn điện & tiếp địa chống rò (IEC 62353)" },
      { key: "firmwareUpdate", label: "5. Kiểm tra phiên bản firmware & phần mềm phân tích kết quả" },
      { key: "qcValidation", label: "6. Chạy mẫu chuẩn QC Run xác nhận độ lặp lại và chỉ số Ct" }
    ]
  },
  EXTRACTION: {
    name: "Máy Tách Chiết Tự Động & Robot Mẫu",
    badgeColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200",
    standardProtocol: "Quy chuẩn kỹ thuật ABT-MagPure & Liquid Handling Workstation",
    checklist: [
      { key: "magneticRods", label: "1. Vệ sinh & khử nhiễm thanh từ / đầu bao tip nam châm" },
      { key: "heatingStrip", label: "2. Hiệu chuẩn thanh gia nhiệt ủ ly giải mẫu (Lysis 56°C - 80°C)" },
      { key: "axisMotors", label: "3. Kiểm tra dây curoa truyền động & động cơ trục cơ khí X-Y-Z" },
      { key: "uvDoorSensor", label: "4. Kiểm tra đèn UV khử khuẩn và cảm biến an toàn cửa kính" },
      { key: "electricalSafety", label: "5. Kiểm tra an toàn điện & hệ thống board mạch điều khiển" },
      { key: "qcValidation", label: "6. Chạy thử nghiệm chu trình tách chiết không tải và mẫu thử" }
    ]
  },
  BIOSAFETY_CABINET: {
    name: "Tủ An Toàn Sinh Học Cấp II & Tủ Cấy",
    badgeColor: "bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200",
    standardProtocol: "Tiêu chuẩn NSF/ANSI 49 & EN 12469 (Chứng nhận an toàn sinh học)",
    checklist: [
      { key: "downflowVel", label: "1. Đo vận tốc dòng khí thổi xuống màng lọc (Downflow: 0.28 - 0.40 m/s)" },
      { key: "inflowVel", label: "2. Đo vận tốc dòng khí hút bảo vệ mặt trước (Inflow: ≥0.50 m/s)" },
      { key: "hepaIntegrity", label: "3. Kiểm tra độ nguyên vẹn & rò rỉ màng lọc HEPA/ULPA (Khí dung PAO/DOP)" },
      { key: "pressureAlarm", label: "4. Kiểm tra cảm biến chênh áp màng lọc và còi báo động áp suất vi sai" },
      { key: "uvLightLux", label: "5. Đo cường độ bức xạ đèn UV khử nhiễm và độ sáng đèn LED chiếu sáng" },
      { key: "certSticker", label: "6. Dán tem kiểm định an toàn sinh học (Biohazard Safety Certified)" }
    ]
  },
  COLD_STORAGE: {
    name: "Tủ Âm Sâu -86°C & Tủ Trữ Mẫu",
    badgeColor: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300 border-cyan-200",
    standardProtocol: "Tiêu chuẩn bảo quản mẫu sinh học WHO / CDC & DIN 58375",
    checklist: [
      { key: "condenserFilter", label: "1. Vệ sinh dàn nóng ngưng tụ, quạt gió làm mát và lưới lọc bụi" },
      { key: "cascadePressure", label: "2. Kiểm tra áp suất gas lạnh tầng 1 & tầng 2 hệ máy nén Cascade" },
      { key: "doorGasket", label: "3. Kiểm tra độ kín gioăng cao su cánh cửa, van cân bằng áp suất chân không" },
      { key: "tempSensorCalib", label: "4. Hiệu chuẩn cảm biến nhiệt độ RTD/Pt100 và độ đồng đều buồng trữ (-86°C)" },
      { key: "batteryBackup", label: "5. Kiểm tra ắc quy lưu điện dự phòng báo động mất nguồn và quá nhiệt" },
      { key: "compressorLoad", label: "6. Đo dòng tiêu thụ điện máy nén (Ampe) và chu kỳ đóng/ngắt rơ-le" }
    ]
  },
  CENTRIFUGE: {
    name: "Máy Ly Tâm & Ly Tâm Lạnh",
    badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200",
    standardProtocol: "Tiêu chuẩn an toàn IEC 61010-2-020 (Rotor & Speed Safety)",
    checklist: [
      { key: "rotorMount", label: "1. Kiểm tra ren khóa rotor, kiểm tra nứt mỏi kim loại và bôi trơn trục" },
      { key: "motorDrive", label: "2. Kiểm tra chổi than / động cơ cảm ứng điện từ không chổi than" },
      { key: "imbalanceSensor", label: "3. Kiểm tra cảm biến chống mất cân bằng độ rung động (Imbalance Switch)" },
      { key: "lidLockSafety", label: "4. Kiểm tra khóa điện từ an toàn nắp máy khi rotor đang quay" },
      { key: "opticalRpm", label: "5. Đo và hiệu chuẩn tốc độ vòng quay thực tế bằng súng quang (Optical Tachometer)" },
      { key: "coolingChamber", label: "6. Kiểm tra hệ thống máy nén làm lạnh buồng ly tâm (Dải 4°C - 20°C)" }
    ]
  },
  NGS_SEQUENCING: {
    name: "Hệ Thống Giải Trình Tự Gen NGS",
    badgeColor: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-indigo-200",
    standardProtocol: "Illumina / MGI Platform Technical Service Specification",
    checklist: [
      { key: "fluidicsPrime", label: "1. Vệ sinh & sục rửa đường ống dẫn hóa chất giải trình tự (Wash & Prime)" },
      { key: "laserOptics", label: "2. Căn chỉnh hệ thống quang học Laser kích thích và camera thu tín hiệu" },
      { key: "syringePumps", label: "3. Kiểm tra bơm tiêm vi thể tích và các van khóa phân phối dung dịch" },
      { key: "thermalStage", label: "4. Kiểm tra đế nhiệt bề mặt Flowcell và cảm biến nhiệt độ tiếp xúc" },
      { key: "softwareSuite", label: "5. Cập nhật phần mềm điều khiển thiết bị & kiểm tra dung lượng ổ đĩa" },
      { key: "selfDiagnostic", label: "6. Chạy chu trình tự chẩn đoán tổng thể (System Self-Diagnostic Test)" }
    ]
  },
  ELISA_SPECTRO: {
    name: "Máy Đọc/Rửa ELISA & Quang Phổ",
    badgeColor: "bg-pink-100 text-pink-800 dark:bg-pink-900/50 dark:text-pink-300 border-pink-200",
    standardProtocol: "Clinical Laboratory Photometry Standards (CLSI)",
    checklist: [
      { key: "manifoldNeedles", label: "1. Thông tắc và cân chỉnh đầu kim hút/rửa, ống dẫn chất thải máy rửa" },
      { key: "lampIntensity", label: "2. Kiểm tra cường độ bóng đèn nguồn sáng (Xenon/Halogen Lamp)" },
      { key: "filterWheel", label: "3. Kiểm tra và định vị bước sóng bánh xe kính lọc (405, 450, 492, 630 nm)" },
      { key: "carrierMechanism", label: "4. Kiểm tra thanh trượt và cơ cấu dịch chuyển khay plate 96 giếng" },
      { key: "photometricLinear", label: "5. Kiểm tra độ tuyến tính hấp thụ quang OD với tấm plate chuẩn (NIST)" },
      { key: "dispenseAccuracy", label: "6. Kiểm tra độ chính xác thể tích dung dịch phân phối và hút kiệt đáy giếng" }
    ]
  },
  AUTOCLAVE: {
    name: "Nồi Hấp Tiệt Trùng Y Tế",
    badgeColor: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300 border-orange-200",
    standardProtocol: "Quy chuẩn an toàn thiết bị áp lực QCVN & EN 285",
    checklist: [
      { key: "safetyReliefValve", label: "1. Kích hoạt thử nghiệm xả thủ công van an toàn áp suất hơi" },
      { key: "waterSensor", label: "2. Vệ sinh que đo cảm biến mực nước cất và tẩy cặn buồng gia nhiệt" },
      { key: "siliconeGasket", label: "3. Kiểm tra độ đàn hồi gioăng cao su silicone chịu nhiệt nắp nồi" },
      { key: "solenoidValve", label: "4. Kiểm tra van xả chân không và van solenoid điều tiết áp suất" },
      { key: "pressureGauge", label: "5. Hiệu chuẩn đồng hồ đo áp suất và cảm biến nhiệt độ buồng hấp (121°C - 134°C)" },
      { key: "bioIndicator", label: "6. Chạy chu trình kiểm tra với que chỉ thị sinh học/hóa học (Bowie-Dick)" }
    ]
  },
  GENERAL_LAB: {
    name: "Thiết Bị Phòng Thử Nghiệm Chung",
    badgeColor: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200",
    standardProtocol: "General Laboratory Equipment Maintenance Standard",
    checklist: [
      { key: "cleanBody", label: "1. Vệ sinh tổng thể thân vỏ, bàn cơ khí và khử nhiễm kháng vi sinh" },
      { key: "powerGround", label: "2. Kiểm tra nguồn cấp, adapter nguồn và đo tiếp địa chống rò rỉ điện" },
      { key: "sensorCalib", label: "3. Hiệu chuẩn cảm biến / điện cực / khối quả cân chuẩn đo lường" },
      { key: "motorDrive", label: "4. Kiểm tra động cơ khuấy / lắc / gia nhiệt điều tốc" },
      { key: "displayKeypad", label: "5. Kiểm tra màn hình hiển thị số và các phím bấm điều khiển" },
      { key: "sampleTest", label: "6. Chạy thử nghiệm mẫu chuẩn nghiệm thu thông số kỹ thuật" }
    ]
  }
};

export const EQUIPMENT_CATEGORIES_CONFIG = DEFAULT_EQUIPMENT_CATEGORIES_CONFIG;

export function getCategoryForDevice(category?: EquipmentCategory, deviceName?: string, customConfigs?: Record<string, SOPChecklistConfig>): EquipmentCategory {
  if (category) {
    if (customConfigs && customConfigs[category]) return category;
    if ((DEFAULT_EQUIPMENT_CATEGORIES_CONFIG as any)[category]) return category;
  }
  const name = (deviceName || "").toLowerCase();
  if (name.includes("an toàn sinh học") || name.includes("biosafety") || name.includes("tủ cấy") || name.includes("clean bench")) return "BIOSAFETY_CABINET";
  if (name.includes("âm sâu") || name.includes("tủ lạnh") || name.includes("freezer") || name.includes("trữ mẫu")) return "COLD_STORAGE";
  if (name.includes("tách chiết") || name.includes("magpure") || name.includes("hút mẫu") || name.includes("liquid handling")) return "EXTRACTION";
  if (name.includes("ly tâm") || name.includes("centrifuge")) return "CENTRIFUGE";
  if (name.includes("trình tự") || name.includes("ngs") || name.includes("sequenc")) return "NGS_SEQUENCING";
  if (name.includes("elisa") || name.includes("quang phổ") || name.includes("nanodrop") || name.includes("spectro")) return "ELISA_SPECTRO";
  if (name.includes("nồi hấp") || name.includes("autoclave") || name.includes("tiệt trùng")) return "AUTOCLAVE";
  if (name.includes("pcr") || name.includes("real-time") || name.includes("qpcr") || name.includes("cycler") || name.includes("luân nhiệt")) return "PCR_REALTIME";

  if (customConfigs) {
    for (const [key, cfg] of Object.entries(customConfigs)) {
      if (cfg.name && name.includes(cfg.name.toLowerCase())) return key as EquipmentCategory;
    }
  }
  return "GENERAL_LAB";
}

export interface CustomerDeviceService {
  id: string;
  code: string;
  type: "BAO_TRI_DINH_KY" | "SUA_CHUA_SU_CO" | "HIEU_CHUAN_KIEM_DINH" | "LAP_DAT_BAN_GIAO";
  category?: EquipmentCategory;
  hospitalName: string;
  department: string;
  deviceName: string;
  model: string;
  serialNumber: string;
  assignedEngineer: string;
  scheduledDate: string;
  completedDate?: string;
  status: "CHO_THUC_HIEN" | "DANG_XU_LY" | "HOAN_THANH" | "QUA_HAN";
  priority: "KHAN_CAP" | "CAO" | "TIEU_CHUAN";
  checklist?: Record<string, boolean>;
  issueDescription?: string;
  serviceReportNotes?: string;
  sparePartsUsed?: string;
  hospitalContactPerson?: string;
  hospitalContactPhone?: string;
  attachments?: Array<{ name: string; url: string; size?: string; type?: string; uploadedAt?: string }>;
}

export interface CustomerInstalledDevice {
  id: string;
  deviceCode: string;
  category?: EquipmentCategory;
  deviceName: string;
  model: string;
  serialNumber: string;
  hospitalName: string;
  department: string;
  installationDate: string;
  warrantyExpiry: string;
  maintenanceIntervalMonths: number;
  lastMaintenanceDate: string;
  nextMaintenanceDate: string;
  status: "HOAT_DONG_TOT" | "CAN_BAO_TRI" | "DANG_CO_SU_CO";
  assignedEngineer: string;
}

export const CustomerEquipmentService: React.FC = () => {
  const companyConfig = useCompanyConfig();
  const { showToast } = useNotification();
  const { user } = useAuth();
  const personnel = usePersonnel();
  const engineers = useMemo(() => filterPersonnelByDept(personnel, ["application", "ứng dụng", "kỹ thuật", "fse", "kỹ sư"]), [personnel]);

  const [activeSubTab, setActiveSubTab] = useState<"pm_schedule" | "breakfix" | "installed_base" | "sop_config">("pm_schedule");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [hospitalFilter, setHospitalFilter] = useState("all");

  // Installed Base (Danh bạ thiết bị đa dạng các dòng sản phẩm ABT đã lắp đặt tại bệnh viện)
  const [installedDevices, setInstalledDevices] = useState<CustomerInstalledDevice[]>([]);

  // Service Tickets & PM Schedule (Lịch bảo trì định kỳ & Sửa chữa sự cố đa dòng máy)
  const [services, setServices] = useState<CustomerDeviceService[]>([]);

  // Dynamic Category SOP Configurations
  const [categoryConfigs, setCategoryConfigs] = useState<Record<string, SOPChecklistConfig>>(() => {
    if (typeof window !== "undefined") {
      try {
        const local = localStorage.getItem("app_equipment_categories_config");
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
            return { ...DEFAULT_EQUIPMENT_CATEGORIES_CONFIG, ...parsed };
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    return DEFAULT_EQUIPMENT_CATEGORIES_CONFIG;
  });

  const [activeConfigCat, setActiveConfigCat] = useState<string>("PCR_REALTIME");
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isNewCatModalOpen, setIsNewCatModalOpen] = useState(false);
  const [newCatForm, setNewCatForm] = useState({
    key: "",
    name: "",
    standardProtocol: "ISO 13485:2016 & Service Manual",
    badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200"
  });

  const getCatConfig = (cat: string): SOPChecklistConfig => {
    return (
      categoryConfigs[cat] ||
      (DEFAULT_EQUIPMENT_CATEGORIES_CONFIG as any)[cat] ||
      DEFAULT_EQUIPMENT_CATEGORIES_CONFIG.GENERAL_LAB
    );
  };

  const saveCategoryConfigs = async (updated: Record<string, SOPChecklistConfig>) => {
    setCategoryConfigs(updated);
    try {
      localStorage.setItem("app_equipment_categories_config", JSON.stringify(updated));
      await fetch("/api/storage?key=app_equipment_categories_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "app_equipment_categories_config", data: updated })
      });
      showToast("Đã lưu cài đặt quy trình các nhóm thiết bị thành công!", "success");
    } catch (e) {
      console.error("Failed to save equipment categories config:", e);
      showToast("Đã lưu quy trình vào bộ nhớ cục bộ!", "info");
    }
  };

  const resetAllCategoryConfigs = async () => {
    if (window.confirm("Bạn có chắc chắn muốn khôi phục toàn bộ quy trình các nhóm thiết bị về tiêu chuẩn ISO / NSX mặc định ban đầu không?")) {
      await saveCategoryConfigs(DEFAULT_EQUIPMENT_CATEGORIES_CONFIG);
      showToast("Đã khôi phục quy trình kiểm định về tiêu chuẩn gốc!", "success");
    }
  };

  const resetSingleCategory = async (catKey: string) => {
    const defaultCfg = (DEFAULT_EQUIPMENT_CATEGORIES_CONFIG as any)[catKey];
    if (defaultCfg) {
      const updated = { ...categoryConfigs, [catKey]: defaultCfg };
      await saveCategoryConfigs(updated);
      showToast(`Đã khôi phục quy trình nhóm "${defaultCfg.name}" về chuẩn ban đầu!`, "success");
    }
  };

  const handleUpdateCategoryMeta = (catKey: string, field: "name" | "standardProtocol" | "badgeColor", val: string) => {
    const cur = getCatConfig(catKey);
    const updated = {
      ...categoryConfigs,
      [catKey]: {
        ...cur,
        [field]: val
      }
    };
    setCategoryConfigs(updated);
  };

  const handleAddChecklistItem = (catKey: string) => {
    const cur = getCatConfig(catKey);
    const stepNum = (cur.checklist?.length || 0) + 1;
    const newStep = {
      key: `step_${Date.now().toString().slice(-4)}_${stepNum}`,
      label: `${stepNum}. Tiêu chuẩn kiểm định mới...`,
      defaultNote: "Đạt chuẩn kỹ thuật theo Service Manual của Hãng"
    };
    const updated = {
      ...categoryConfigs,
      [catKey]: {
        ...cur,
        checklist: [...(cur.checklist || []), newStep]
      }
    };
    setCategoryConfigs(updated);
  };

  const handleUpdateChecklistItem = (catKey: string, stepIdx: number, field: "label" | "defaultNote", val: string) => {
    const cur = getCatConfig(catKey);
    const list = [...(cur.checklist || [])];
    if (!list[stepIdx]) return;
    list[stepIdx] = { ...list[stepIdx], [field]: val };
    const updated = {
      ...categoryConfigs,
      [catKey]: {
        ...cur,
        checklist: list
      }
    };
    setCategoryConfigs(updated);
  };

  const handleDeleteChecklistItem = (catKey: string, stepIdx: number) => {
    const cur = getCatConfig(catKey);
    const list = (cur.checklist || []).filter((_, idx) => idx !== stepIdx);
    const updated = {
      ...categoryConfigs,
      [catKey]: {
        ...cur,
        checklist: list
      }
    };
    setCategoryConfigs(updated);
  };

  const handleMoveChecklistItem = (catKey: string, stepIdx: number, direction: "up" | "down") => {
    const cur = getCatConfig(catKey);
    const list = [...(cur.checklist || [])];
    const targetIdx = direction === "up" ? stepIdx - 1 : stepIdx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const temp = list[stepIdx];
    list[stepIdx] = list[targetIdx];
    list[targetIdx] = temp;
    const updated = {
      ...categoryConfigs,
      [catKey]: {
        ...cur,
        checklist: list
      }
    };
    setCategoryConfigs(updated);
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatForm.name.trim()) {
      showToast("Vui lòng nhập tên nhóm thiết bị!", "error");
      return;
    }
    const cleanKey = (newCatForm.key.trim() || newCatForm.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_")).slice(0, 30);
    if (categoryConfigs[cleanKey]) {
      showToast("Mã nhóm thiết bị này đã tồn tại!", "error");
      return;
    }
    const newConfig: SOPChecklistConfig = {
      name: newCatForm.name.trim(),
      standardProtocol: newCatForm.standardProtocol.trim() || "ISO 13485:2016 & Service Manual",
      badgeColor: newCatForm.badgeColor,
      checklist: [
        { key: "step_clean", label: "1. Vệ sinh tổng thể thân vỏ, cơ cấu & khử nhiễm vi sinh", defaultNote: "Thân vỏ sạch sẽ, không bám cặn hóa chất" },
        { key: "step_power", label: "2. Kiểm tra nguồn điện cấp, adapter nguồn và tiếp địa an toàn", defaultNote: "Điện áp ổn định, dòng rò an toàn theo IEC 62353" },
        { key: "step_sensors", label: "3. Kiểm tra cảm biến đo lường và khối chấp hành cơ điện", defaultNote: "Tín hiệu cảm biến phản hồi chuẩn xác" },
        { key: "step_qc", label: "4. Chạy kiểm tra mẫu chuẩn xác nhận thông số kỹ thuật", defaultNote: "Thông số kết quả nằm trong giới hạn cho phép (Acceptable)" }
      ]
    };
    const updated = { ...categoryConfigs, [cleanKey]: newConfig };
    saveCategoryConfigs(updated);
    setActiveConfigCat(cleanKey);
    setIsNewCatModalOpen(false);
    setNewCatForm({
      key: "",
      name: "",
      standardProtocol: "ISO 13485:2016 & Service Manual",
      badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200"
    });
    showToast(`Đã thêm nhóm thiết bị mới "${newConfig.name}"!`, "success");
  };

  const handleDeleteCustomCategory = (catKey: string) => {
    if ((DEFAULT_EQUIPMENT_CATEGORIES_CONFIG as any)[catKey]) {
      showToast("Không thể xóa nhóm thiết bị mặc định hệ thống. Bạn có thể khôi phục hoặc đổi tên!", "error");
      return;
    }
    if (window.confirm(`Bạn có chắc chắn muốn xóa nhóm thiết bị "${categoryConfigs[catKey]?.name}"?`)) {
      const copy = { ...categoryConfigs };
      delete copy[catKey];
      saveCategoryConfigs(copy);
      setActiveConfigCat("PCR_REALTIME");
      showToast("Đã xóa nhóm thiết bị tùy chỉnh!", "success");
    }
  };

  // Modal States
  const [isNewPMModalOpen, setIsNewPMModalOpen] = useState(false);
  const [isNewBreakfixModalOpen, setIsNewBreakfixModalOpen] = useState(false);
  const [isNewDeviceModalOpen, setIsNewDeviceModalOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<CustomerDeviceService | null>(null);
  const [isFSRViewerModalOpen, setIsFSRViewerModalOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<{ name: string; url: string; type?: string } | null>(null);

  // New PM Form
  const [pmForm, setPmForm] = useState({
    code: `PM-${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}-${Date.now().toString().slice(-3)}`,
    hospitalName: "",
    department: "Khoa Vi Sinh / Sinh Học Phân Tử",
    deviceId: "",
    category: "PCR_REALTIME" as EquipmentCategory,
    scheduledDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    assignedEngineer: "",
    priority: "CAO" as CustomerDeviceService["priority"],
    serviceReportNotes: "Bảo trì định kỳ theo khuyến cáo nhà sản xuất và tiêu chuẩn ISO 13485.",
    hospitalContactPerson: "",
    hospitalContactPhone: "",
    checklist: {} as Record<string, boolean>
  });

  const openNewPMModal = (initialDevId?: string) => {
    const targetDev = (initialDevId ? installedDevices.find(d => d.id === initialDevId) : null) || installedDevices[0] || null;
    const cat = targetDev ? getCategoryForDevice(targetDev.category, targetDev.deviceName, categoryConfigs) : "PCR_REALTIME";
    const config = getCatConfig(cat);
    const initChecklist: Record<string, boolean> = {};
    (config.checklist || []).forEach(chk => {
      initChecklist[chk.key] = true;
    });

    setPmForm({
      code: `PM-${new Date().getFullYear()}-Q${Math.floor(new Date().getMonth() / 3) + 1}-${Date.now().toString().slice(-3)}`,
      hospitalName: targetDev?.hospitalName || "",
      department: targetDev?.department || "Khoa Xét Nghiệm",
      deviceId: targetDev?.id || "",
      category: cat,
      scheduledDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      assignedEngineer: "",
      priority: "CAO",
      serviceReportNotes: "Bảo trì định kỳ theo khuyến cáo nhà sản xuất và tiêu chuẩn ISO 13485.",
      hospitalContactPerson: "",
      hospitalContactPhone: "",
      checklist: initChecklist
    });
    setIsNewPMModalOpen(true);
  };

  // New Break-fix Form
  const [breakfixForm, setBreakfixForm] = useState({
    code: `CM-${new Date().getFullYear()}-BF-${Date.now().toString().slice(-3)}`,
    hospitalName: "",
    department: "Khoa Xét Nghiệm",
    deviceId: "",
    category: "PCR_REALTIME" as EquipmentCategory,
    scheduledDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    assignedEngineer: "",
    priority: "KHAN_CAP" as CustomerDeviceService["priority"],
    issueDescription: "",
    hospitalContactPerson: "",
    hospitalContactPhone: ""
  });

  const openNewBreakfixModal = (initialDevId?: string) => {
    const targetDev = (initialDevId ? installedDevices.find(d => d.id === initialDevId) : null) || installedDevices[0] || null;
    const cat = targetDev ? getCategoryForDevice(targetDev.category, targetDev.deviceName, categoryConfigs) : "PCR_REALTIME";
    setBreakfixForm({
      code: `CM-${new Date().getFullYear()}-BF-${Date.now().toString().slice(-3)}`,
      hospitalName: targetDev?.hospitalName || "",
      department: targetDev?.department || "Khoa Xét Nghiệm",
      deviceId: targetDev?.id || "",
      category: cat,
      scheduledDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      assignedEngineer: "",
      priority: "KHAN_CAP",
      issueDescription: "",
      hospitalContactPerson: "",
      hospitalContactPhone: ""
    });
    setIsNewBreakfixModalOpen(true);
  };

  // New Installed Device Form
  const [newDeviceForm, setNewDeviceForm] = useState({
    deviceName: "Hệ thống Real-time PCR Tự Động ABT-9600",
    model: "ABT-PCR-9600",
    category: "PCR_REALTIME" as EquipmentCategory,
    serialNumber: `SN-ABT-${Date.now().toString().slice(-5)}`,
    hospitalName: "",
    department: "Khoa Xét Nghiệm",
    installationDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    warrantyExpiry: "31/12/2028",
    maintenanceIntervalMonths: 6,
    assignedEngineer: ""
  });

  // Sync with PostgreSQL Backend Storage
  useEffect(() => {
    const loadBackendData = async () => {
      try {
        const [servicesRes, devicesRes, catConfigRes] = await Promise.all([
          fetch("/api/storage?key=app_customer_services"),
          fetch("/api/storage?key=app_installed_devices"),
          fetch("/api/storage?key=app_equipment_categories_config")
        ]);
        const srvData = await servicesRes.json();
        const devData = await devicesRes.json();
        const catData = await catConfigRes.json();

        if (srvData && Array.isArray(srvData.data) && srvData.data.length > 0) {
          setServices(srvData.data);
        }
        if (devData && Array.isArray(devData.data) && devData.data.length > 0) {
          setInstalledDevices(devData.data);
        }
        if (catData && catData.data && typeof catData.data === "object" && Object.keys(catData.data).length > 0) {
          setCategoryConfigs(prev => ({ ...prev, ...catData.data }));
          localStorage.setItem("app_equipment_categories_config", JSON.stringify(catData.data));
        }
      } catch (err) {
        console.error("Failed to load customer service data:", err);
      }
    };
    loadBackendData();
  }, []);

  const saveServices = async (updated: CustomerDeviceService[]) => {
    setServices(updated);
    try {
      await fetch("/api/storage?key=app_customer_services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "app_customer_services", data: updated })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const saveInstalledDevices = async (updated: CustomerInstalledDevice[]) => {
    setInstalledDevices(updated);
    try {
      await fetch("/api/storage?key=app_installed_devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "app_installed_devices", data: updated })
      });
    } catch (e) {
      console.error(e);
    }
  };

  // KPI Metrics Calculation
  const metrics = useMemo(() => {
    const totalInstalled = installedDevices.length;
    const pendingPM = services.filter(s => (s.type === "BAO_TRI_DINH_KY" || s.type === "HIEU_CHUAN_KIEM_DINH") && s.status !== "HOAN_THANH").length;
    const activeBreakfix = services.filter(s => s.type === "SUA_CHUA_SU_CO" && s.status !== "HOAN_THANH").length;
    const completedFSR = services.filter(s => s.status === "HOAN_THANH").length;

    return { totalInstalled, pendingPM, activeBreakfix, completedFSR };
  }, [installedDevices, services]);

  // Filtered Services List
  const filteredServices = useMemo(() => {
    return services.filter(s => {
      const matchType =
        activeSubTab === "pm_schedule"
          ? s.type === "BAO_TRI_DINH_KY" || s.type === "HIEU_CHUAN_KIEM_DINH"
          : activeSubTab === "breakfix"
          ? s.type === "SUA_CHUA_SU_CO"
          : true;

      const cat = getCategoryForDevice(s.category, s.deviceName, categoryConfigs);
      const matchCategory = categoryFilter === "all" || cat === categoryFilter;

      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        s.code.toLowerCase().includes(q) ||
        s.hospitalName.toLowerCase().includes(q) ||
        s.deviceName.toLowerCase().includes(q) ||
        s.model.toLowerCase().includes(q) ||
        s.serialNumber.toLowerCase().includes(q) ||
        s.assignedEngineer.toLowerCase().includes(q);

      const matchStatus = statusFilter === "all" || s.status === statusFilter;
      const matchHospital = hospitalFilter === "all" || s.hospitalName === hospitalFilter;

      return matchType && matchCategory && matchSearch && matchStatus && matchHospital;
    });
  }, [services, activeSubTab, searchQuery, statusFilter, categoryFilter, hospitalFilter, categoryConfigs]);

  // Filtered Installed Base List
  const filteredDevices = useMemo(() => {
    return installedDevices.filter(d => {
      const cat = getCategoryForDevice(d.category, d.deviceName, categoryConfigs);
      const matchCategory = categoryFilter === "all" || cat === categoryFilter;

      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        d.deviceCode.toLowerCase().includes(q) ||
        d.deviceName.toLowerCase().includes(q) ||
        d.hospitalName.toLowerCase().includes(q) ||
        d.model.toLowerCase().includes(q) ||
        d.serialNumber.toLowerCase().includes(q) ||
        d.department.toLowerCase().includes(q);

      return matchCategory && matchSearch;
    });
  }, [installedDevices, searchQuery, categoryFilter, categoryConfigs]);

  // Handlers
  const handleCreatePM = (e: React.FormEvent) => {
    e.preventDefault();
    const dev = installedDevices.find(d => d.id === pmForm.deviceId) || installedDevices[0];
    const cat = getCategoryForDevice(dev?.category || pmForm.category, dev?.deviceName || pmForm.code, categoryConfigs);
    const config = getCatConfig(cat);

    const finalChecklist: Record<string, boolean> = { ...pmForm.checklist };
    (config.checklist || []).forEach(chk => {
      if (finalChecklist[chk.key] === undefined) {
        finalChecklist[chk.key] = true;
      }
    });

    const newTicket: CustomerDeviceService = {
      id: `SRV-${Date.now().toString().slice(-6)}`,
      code: pmForm.code,
      type: "BAO_TRI_DINH_KY",
      category: cat,
      hospitalName: dev?.hospitalName || pmForm.hospitalName,
      department: dev?.department || pmForm.department,
      deviceName: dev?.deviceName || "Thiết bị y tế ABT",
      model: dev?.model || "Standard Model",
      serialNumber: dev?.serialNumber || "SN-PENDING",
      assignedEngineer: pmForm.assignedEngineer,
      scheduledDate: pmForm.scheduledDate,
      status: "CHO_THUC_HIEN",
      priority: pmForm.priority,
      checklist: finalChecklist,
      serviceReportNotes: pmForm.serviceReportNotes,
      hospitalContactPerson: pmForm.hospitalContactPerson,
      hospitalContactPhone: pmForm.hospitalContactPhone,
      attachments: []
    };

    const updated = [newTicket, ...services];
    saveServices(updated);
    setIsNewPMModalOpen(false);
    showToast(`Đã lập kế hoạch bảo trì định kỳ ${newTicket.code} thành công!`, "success");
  };

  const handleCreateBreakfix = (e: React.FormEvent) => {
    e.preventDefault();
    const dev = installedDevices.find(d => d.id === breakfixForm.deviceId);
    const cat = getCategoryForDevice(dev?.category, dev?.deviceName);

    const newTicket: CustomerDeviceService = {
      id: `SRV-${Date.now().toString().slice(-6)}`,
      code: breakfixForm.code,
      type: "SUA_CHUA_SU_CO",
      category: cat,
      hospitalName: dev?.hospitalName || breakfixForm.hospitalName,
      department: dev?.department || breakfixForm.department,
      deviceName: dev?.deviceName || "Thiết bị y tế ABT",
      model: dev?.model || "Standard Model",
      serialNumber: dev?.serialNumber || "SN-PENDING",
      assignedEngineer: breakfixForm.assignedEngineer,
      scheduledDate: breakfixForm.scheduledDate,
      status: "DANG_XU_LY",
      priority: breakfixForm.priority,
      issueDescription: breakfixForm.issueDescription,
      hospitalContactPerson: breakfixForm.hospitalContactPerson,
      hospitalContactPhone: breakfixForm.hospitalContactPhone,
      checklist: {},
      attachments: []
    };

    const updated = [newTicket, ...services];
    saveServices(updated);
    setIsNewBreakfixModalOpen(false);
    showToast(`Đã tiếp nhận sự cố khẩn cấp ${newTicket.code} và điều phối FSE!`, "success");
  };

  const handleCreateInstalledDevice = (e: React.FormEvent) => {
    e.preventDefault();
    const newDevice: CustomerInstalledDevice = {
      id: `DEV-${Date.now().toString().slice(-5)}`,
      deviceCode: `ABT-EQ-${Date.now().toString().slice(-4)}`,
      category: newDeviceForm.category,
      deviceName: newDeviceForm.deviceName,
      model: newDeviceForm.model,
      serialNumber: newDeviceForm.serialNumber,
      hospitalName: newDeviceForm.hospitalName,
      department: newDeviceForm.department,
      installationDate: newDeviceForm.installationDate,
      warrantyExpiry: newDeviceForm.warrantyExpiry,
      maintenanceIntervalMonths: Number(newDeviceForm.maintenanceIntervalMonths),
      lastMaintenanceDate: newDeviceForm.installationDate,
      nextMaintenanceDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      status: "HOAT_DONG_TOT",
      assignedEngineer: newDeviceForm.assignedEngineer
    };

    const updated = [newDevice, ...installedDevices];
    saveInstalledDevices(updated);
    setIsNewDeviceModalOpen(false);
    showToast(`Đã bàn giao và lưu thông tin máy ${newDevice.deviceName} vào viện!`, "success");
  };

  const handleUpdateStatus = (ticketId: string, newStatus: CustomerDeviceService["status"]) => {
    const updated = services.map(s => {
      if (s.id === ticketId) {
        return {
          ...s,
          status: newStatus,
          completedDate: newStatus === "HOAN_THANH" ? new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : s.completedDate
        };
      }
      return s;
    });
    saveServices(updated);
    showToast("Cập nhật trạng thái lệnh kỹ thuật thành công!", "success");
  };

  // Reusable Category SOP Detail Editor
  const renderCategoryDetailEditor = (catKey: string, isInsideModal: boolean = false) => {
    const cfg = getCatConfig(catKey);
    const isDefault = Boolean((DEFAULT_EQUIPMENT_CATEGORIES_CONFIG as any)[catKey]);

    return (
      <div className="space-y-4">
        {/* Category Metadata Form */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-200 dark:border-slate-700/60">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${cfg.badgeColor}`}>
                {cfg.name}
              </span>
              <span className="text-[10px] font-mono text-slate-400">Mã: {catKey}</span>
            </div>
            <div className="flex items-center gap-2">
              {isDefault ? (
                <button
                  type="button"
                  onClick={() => resetSingleCategory(catKey)}
                  className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 text-[10.5px] font-bold border border-amber-200 dark:border-amber-800/60 flex items-center gap-1 cursor-pointer transition-all"
                  title="Khôi phục nhóm này về tiêu chuẩn mặc định"
                >
                  <RotateCcw className="w-3 h-3 text-amber-500" />
                  <span>Khôi Phục Chuẩn Gốc</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDeleteCustomCategory(catKey)}
                  className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 text-[10.5px] font-bold border border-rose-200 dark:border-rose-800/60 flex items-center gap-1 cursor-pointer transition-all"
                  title="Xóa nhóm thiết bị tùy chỉnh này"
                >
                  <Trash2 className="w-3 h-3 text-rose-500" />
                  <span>Xóa Nhóm Này</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tên Nhóm Thiết Bị
              </label>
              <input
                type="text"
                value={cfg.name}
                onChange={e => handleUpdateCategoryMeta(catKey, "name", e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                placeholder="Ví dụ: Máy Real-time PCR & PCR"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Quy Chuẩn / Tiêu Chuẩn Kỹ Thuật Áp Dụng
              </label>
              <input
                type="text"
                value={cfg.standardProtocol}
                onChange={e => handleUpdateCategoryMeta(catKey, "standardProtocol", e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                placeholder="Ví dụ: ISO 13485:2016 & Service Manual"
              />
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
              Màu Sắc Nhận Diện (Badge Color)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {BADGE_COLOR_OPTIONS.map(opt => {
                const isSelected = cfg.badgeColor === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => handleUpdateCategoryMeta(catKey, "badgeColor", opt.value)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${opt.value} ${
                      isSelected ? "ring-2 ring-indigo-500 scale-105 shadow-xs" : "opacity-80 hover:opacity-100"
                    }`}
                  >
                    {isSelected && <span className="mr-1">✓</span>}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Checklist Steps Editor */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Quy Trình Kiểm Định &amp; Tiêu Chuẩn Đo Lường</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  {cfg.checklist?.length || 0} tiêu chuẩn
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Các hạng mục bắt buộc kỹ sư kỹ thuật FSE/FAS phải kiểm tra, đo đạc thông số và tích chọn nghiệm thu trên FSR.
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleAddChecklistItem(catKey)}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/20 active:scale-95 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Thêm Tiêu Chuẩn Mới</span>
            </button>
          </div>

          <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-1">
            {(cfg.checklist || []).length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs italic">
                Chưa có tiêu chuẩn kiểm định nào trong nhóm này. Hãy bấm &quot;+ Thêm Tiêu Chuẩn Mới&quot;.
              </div>
            ) : (
              (cfg.checklist || []).map((step, idx) => (
                <div
                  key={step.key || idx}
                  className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-750 space-y-2 transition-all hover:border-slate-300 dark:hover:border-slate-650"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-600 text-white font-mono text-[10.5px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>

                    <div className="flex-1">
                      <input
                        type="text"
                        value={step.label}
                        onChange={e => handleUpdateChecklistItem(catKey, idx, "label", e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-900 dark:text-white"
                        placeholder="Nội dung tiêu chuẩn kiểm tra..."
                      />
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveChecklistItem(catKey, idx, "up")}
                        className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-750 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-all"
                        title="Di chuyển lên"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === (cfg.checklist || []).length - 1}
                        onClick={() => handleMoveChecklistItem(catKey, idx, "down")}
                        className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-750 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-all"
                        title="Di chuyển xuống"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteChecklistItem(catKey, idx)}
                        className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/60 hover:bg-rose-200 dark:hover:bg-rose-900 text-rose-600 dark:text-rose-300 cursor-pointer transition-all"
                        title="Xóa tiêu chuẩn này"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="pl-8">
                    <input
                      type="text"
                      value={step.defaultNote || ""}
                      onChange={e => handleUpdateChecklistItem(catKey, idx, "defaultNote", e.target.value)}
                      placeholder="Ghi chú hướng dẫn kỹ thuật / Tiêu chuẩn nghiệm thu..."
                      className="w-full px-2.5 py-1 bg-white/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] text-slate-600 dark:text-slate-400 font-mono"
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
            <span className="text-[11px] text-slate-400">
              * Dữ liệu quy trình sẽ được đồng bộ và lưu trữ vĩnh viễn trên cơ sở dữ liệu.
            </span>
            <button
              type="button"
              onClick={() => {
                saveCategoryConfigs(categoryConfigs);
                if (isInsideModal) {
                  setIsConfigModalOpen(false);
                }
              }}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/30 cursor-pointer active:scale-95 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>Lưu Cấu Hình Quy Trình Nhóm Này</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Professional Service Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Thiết bị đang vận hành</div>
            <div className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{metrics.totalInstalled} máy</div>
            <div className="text-[10px] text-emerald-600 font-semibold mt-0.5">Tại các bệnh viện &amp; viện Pasteur</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Kế hoạch bảo trì (PM)</div>
            <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-0.5">{metrics.pendingPM} kế hoạch</div>
            <div className="text-[10px] text-amber-600 font-semibold mt-0.5">Định kỳ 3-6 tháng theo SOP hãng</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Sự cố khẩn tại viện (CM)</div>
            <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-0.5">{metrics.activeBreakfix} sự cố</div>
            <div className="text-[10px] text-rose-600 font-semibold mt-0.5">SLA can thiệp khẩn &lt;2h - 4h</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Đã nghiệm thu kỹ thuật (FSR)</div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{metrics.completedFSR} biên bản</div>
            <div className="text-[10px] text-emerald-600 font-semibold mt-0.5">Ký số &amp; xuất file A4 lưu trữ</div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs & Actions Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveSubTab("pm_schedule")}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === "pm_schedule"
                ? "bg-amber-600 text-white shadow-md shadow-amber-600/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Lịch Bảo Trì Định Kỳ (PM)</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
              {services.filter(s => s.type === "BAO_TRI_DINH_KY").length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab("breakfix")}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === "breakfix"
                ? "bg-rose-600 text-white shadow-md shadow-rose-600/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>Sửa Chữa Sự Cố Khẩn Cấp (CM)</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
              {services.filter(s => s.type === "SUA_CHUA_SU_CO").length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab("installed_base")}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === "installed_base"
                ? "bg-blue-600 text-white shadow-md shadow-blue-600/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Danh Bạ Máy Lắp Đặt Tại Viện ({installedDevices.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab("sop_config")}
            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === "sop_config"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Cài Đặt Quy Trình Thiết Bị</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
              {Object.keys(categoryConfigs).length} nhóm
            </span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {activeSubTab === "pm_schedule" && (
            <button
              onClick={() => openNewPMModal()}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-md shadow-amber-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Lập Kế Hoạch Bảo Trì PM</span>
            </button>
          )}

          {activeSubTab === "breakfix" && (
            <button
              onClick={() => openNewBreakfixModal()}
              className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-md shadow-rose-600/20 transition-all cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>+ Tiếp Nhận Báo Lỗi Khẩn Cấp</span>
            </button>
          )}

          {activeSubTab === "installed_base" && (
            <button
              onClick={() => setIsNewDeviceModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md shadow-blue-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>+ Bàn Giao Thiết Bị Mới Vào Viện</span>
            </button>
          )}

          {activeSubTab === "sop_config" && (
            <div className="flex items-center gap-2">
              <button
                onClick={resetAllCategoryConfigs}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
                title="Khôi phục toàn bộ về tiêu chuẩn ISO ban đầu"
              >
                <RotateCcw className="w-4 h-4 text-amber-500" />
                <span>Khôi Phục Mặc Định</span>
              </button>
              <button
                onClick={() => setIsNewCatModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Thêm Nhóm Thiết Bị Mới</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Multi-Category Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm theo mã PM/CM, Bệnh viện, Tên máy, Số Serial, Kỹ sư FSE..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-amber-500/20"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Equipment Category Filter */}
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-200 font-bold cursor-pointer"
          >
            <option value="all">Tất cả dòng thiết bị ({installedDevices.length} máy)</option>
            {Object.entries(categoryConfigs).map(([catKey, cfg]) => (
              <option key={catKey} value={catKey}>
                {cfg.name}
              </option>
            ))}
          </select>

          {activeSubTab !== "installed_base" && (
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-800 dark:text-slate-200 font-semibold cursor-pointer"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="CHO_THUC_HIEN">Chờ thực hiện</option>
              <option value="DANG_XU_LY">Đang xử lý tại viện</option>
              <option value="HOAN_THANH">Đã hoàn thành FSR</option>
            </select>
          )}
        </div>
      </div>

      {/* VIEW 1: PM SCHEDULE & BREAKFIX TICKETS */}
      {(activeSubTab === "pm_schedule" || activeSubTab === "breakfix") && (
        <div className="grid grid-cols-1 gap-4">
          {filteredServices.length === 0 ? (
          <div className="text-center py-12 p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 text-xs space-y-2">
            <Check className="w-8 h-8 text-slate-500 mx-auto opacity-50" />
            <p className="font-semibold text-slate-300">Chưa có lịch bảo trì hoặc sự cố nào được ghi nhận.</p>
            <p className="text-[11px] text-slate-500">Nhấn &quot;+ Lập Kế Hoạch Bảo Trì PM&quot; hoặc &quot;+ Tiếp Nhận Báo Lỗi Khẩn Cấp&quot; để tạo mới.</p>
          </div>
        ) : (
          filteredServices.map(srv => {
            const isPM = srv.type === "BAO_TRI_DINH_KY" || srv.type === "HIEU_CHUAN_KIEM_DINH";
            const priorityColor =
              srv.priority === "KHAN_CAP"
                ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400 border-rose-200"
                : srv.priority === "CAO"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200"
                : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200";

            const statusBadge =
              srv.status === "HOAN_THANH"
                ? { label: "Đã hoàn thành FSR", bg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" }
                : srv.status === "DANG_XU_LY"
                ? { label: "Kỹ sư đang tại viện", bg: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400" }
                : { label: "Chờ triển khai", bg: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" };

            const cat = getCategoryForDevice(srv.category, srv.deviceName, categoryConfigs);
            const catConfig = getCatConfig(cat);

            return (
              <div
                key={srv.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all space-y-4"
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                      {srv.code}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${catConfig.badgeColor}`}>
                      {catConfig.name}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${priorityColor}`}>
                      {srv.priority === "KHAN_CAP" ? "Khẩn cấp" : srv.priority === "CAO" ? "Ưu tiên cao" : "Tiêu chuẩn"}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadge.bg}`}>
                      {statusBadge.label}
                    </span>
                  </div>

                  <div className="text-xs text-slate-500 flex items-center gap-3">
                    <span>Lịch thực hiện: <strong className="text-slate-800 dark:text-slate-200">{srv.scheduledDate}</strong></span>
                    {srv.completedDate && (
                      <span className="text-emerald-600 font-semibold">✓ Đã nghiệm thu: {srv.completedDate}</span>
                    )}
                  </div>
                </div>

                {/* Device & Hospital Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400">Bệnh viện &amp; Khoa phòng:</span>
                    <div className="font-bold text-slate-900 dark:text-white text-sm mt-0.5">{srv.hospitalName}</div>
                    <div className="text-slate-500">{srv.department}</div>
                    {srv.hospitalContactPerson && (
                      <div className="text-[11px] text-slate-400 mt-1">
                        Liên hệ: {srv.hospitalContactPerson} ({srv.hospitalContactPhone})
                      </div>
                    )}
                  </div>

                  <div>
                    <span className="text-slate-400">Thiết bị y tế:</span>
                    <div className="font-bold text-slate-900 dark:text-white text-sm mt-0.5">{srv.deviceName}</div>
                    <div className="text-slate-500">
                      Model: <span className="font-mono">{srv.model}</span> | SN:{" "}
                      <span className="font-mono font-bold text-emerald-600">{srv.serialNumber}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-400">Kỹ sư FSE phụ trách:</span>
                    <div className="font-bold text-slate-900 dark:text-white text-sm mt-0.5">{srv.assignedEngineer}</div>
                    <div className="text-slate-500 text-[11px]">Đội Dịch vụ Kỹ thuật ABT (FSE Team)</div>
                  </div>
                </div>

                {/* Issue Description (For Breakfix) */}
                {srv.issueDescription && (
                  <div className="p-3 bg-rose-50/70 dark:bg-rose-950/30 rounded-xl border border-rose-200 dark:border-rose-900 text-xs">
                    <div className="font-bold text-rose-800 dark:text-rose-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Chi tiết sự cố thiết bị tại bệnh viện:</span>
                    </div>
                    <p className="mt-1 text-slate-700 dark:text-slate-300 font-sans">{srv.issueDescription}</p>
                    {srv.sparePartsUsed && (
                      <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400 font-mono">
                        Linh kiện thay thế: {srv.sparePartsUsed}
                      </div>
                    )}
                  </div>
                )}

                {/* Dynamic Category SOP Checklist (6 Steps) */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-extrabold uppercase">
                        {catConfig.name}
                      </span>
                      <span>Quy Trình Kiểm Tra Kỹ Thuật 6 Tiêu Chuẩn:</span>
                    </div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      Quy chuẩn: {catConfig.standardProtocol}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
                    {catConfig.checklist.map(chk => {
                      const isDone = srv.checklist ? Boolean((srv.checklist as any)[chk.key] ?? true) : true;
                      return (
                        <div key={chk.key} className="flex items-start gap-1.5 text-slate-700 dark:text-slate-300">
                          <span
                            className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5 ${
                              isDone ? "bg-emerald-500 text-white" : "bg-slate-300 dark:bg-slate-700 text-slate-600"
                            }`}
                          >
                            {isDone ? "✓" : "•"}
                          </span>
                          <span className={isDone ? "font-semibold text-slate-900 dark:text-white leading-tight" : "text-slate-500 leading-tight"}>
                            {chk.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-400 text-[11px]">
                    <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                    <span>{srv.attachments?.length || 0} tài liệu / ảnh đính kèm</span>
                    {srv.attachments && srv.attachments.length > 0 && (
                      <button
                        onClick={() => setPreviewAttachment(srv.attachments![0])}
                        className="text-blue-600 hover:underline font-bold ml-1 cursor-pointer"
                      >
                        [Xem file: {srv.attachments[0].name.slice(0, 24)}...]
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelectedService(srv);
                        setIsFSRViewerModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60 rounded-xl font-bold cursor-pointer transition-all border border-blue-200 dark:border-blue-800"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Xem Biên Bản FSR (A4)</span>
                    </button>

                    {srv.status !== "HOAN_THANH" ? (
                      <button
                        onClick={() => handleUpdateStatus(srv.id, "HOAN_THANH")}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-md shadow-emerald-600/20"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Nghiệm Thu Hoàn Thành</span>
                      </button>
                    ) : (
                      <span className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 rounded-xl font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Đã nghiệm thu &amp; Bàn giao
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        </div>
      )}

      {/* VIEW 2: INSTALLED BASE (DANH BẠ MÁY LẮP ĐẶT TẠI VIỆN) */}
      {activeSubTab === "installed_base" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Cơ Sở Thiết Bị Xét Nghiệm ABT Đã Lắp Đặt Tại Khách Hàng (Customer Installed Base)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Theo dõi toàn diện số Serial, hạn bảo hành, phân loại dòng máy và kỹ sư phụ trách từng máy tại các bệnh viện.
              </p>
            </div>
            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono font-bold text-xs rounded-xl">
              Tổng số: {filteredDevices.length} máy
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-800">
                  <th className="py-3 px-4">Mã Quản Lý</th>
                  <th className="py-3 px-4">Tên Thiết Bị &amp; Dòng Máy</th>
                  <th className="py-3 px-4">Số Serial</th>
                  <th className="py-3 px-4">Bệnh Viện &amp; Khoa Phòng</th>
                  <th className="py-3 px-4">Ngày Lắp Đặt</th>
                  <th className="py-3 px-4">Hạn Bảo Hành</th>
                  <th className="py-3 px-4">Bảo Trì Tiếp Theo</th>
                  <th className="py-3 px-4 text-center">Tình Trạng</th>
                  <th className="py-3 px-4 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredDevices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 italic text-xs">
                      Chưa có thiết bị nào trong danh bạ khách hàng. Nhấn &quot;+ Bàn Giao Thiết Bị Mới Vào Viện&quot; để thêm thiết bị thực tế.
                    </td>
                  </tr>
                ) : (
                  filteredDevices.map(dev => {
                    const cat = getCategoryForDevice(dev.category, dev.deviceName, categoryConfigs);
                    const catConfig = getCatConfig(cat);

                    return (
                      <tr key={dev.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono font-bold text-blue-600 dark:text-blue-400 whitespace-nowrap">
                          {dev.deviceCode}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900 dark:text-white">{dev.deviceName}</span>
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-extrabold border ${catConfig.badgeColor}`}>
                              {catConfig.name}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{dev.model}</div>
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-emerald-600 whitespace-nowrap">
                          {dev.serialNumber}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-800 dark:text-slate-200">{dev.hospitalName}</div>
                          <div className="text-[10px] text-slate-400">{dev.department}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {dev.installationDate}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {dev.warrantyExpiry}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-amber-600 whitespace-nowrap">
                          {dev.nextMaintenanceDate}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              dev.status === "HOAT_DONG_TOT"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                : dev.status === "CAN_BAO_TRI"
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                                : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                            }`}
                          >
                            {dev.status === "HOAT_DONG_TOT"
                              ? "Hoạt động tốt"
                              : dev.status === "CAN_BAO_TRI"
                              ? "Đến hạn bảo trì"
                              : "Đang có sự cố"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <button
                            onClick={() => openNewPMModal(dev.id)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 rounded-lg text-[11px] font-bold cursor-pointer border border-amber-200 dark:border-amber-800 shadow-2xs transition-all active:scale-95"
                          >
                            Lên Lịch Bảo Trì
                          </button>
                        </td>
                      </tr>
                    );
                })
              )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: CÀI ĐẶT QUY TRÌNH THIẾT BỊ (SOP CONFIG) */}
      {activeSubTab === "sop_config" && (
        <div className="space-y-4">
          {/* Header Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-indigo-900/60 via-indigo-950/40 to-slate-900 border border-indigo-800/50 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs uppercase tracking-wider">
                <Sliders className="w-4 h-4" />
                <span>Trung Tâm Cấu Hình &amp; Chuẩn Hóa Quy Trình Thiết Bị (SOP Protocols)</span>
              </div>
              <h3 className="text-base font-black text-white">
                Cài Đặt Quy Trình &amp; Tiêu Chuẩn Kiểm Định Theo Nhóm Thiết Bị Y Tế
              </h3>
              <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                Thiết lập bộ tiêu chuẩn kiểm tra an toàn điện (IEC 62353), hiệu chuẩn quang học/nhiệt độ theo khuyến cáo NSX và chuẩn ISO 13485:2016 cho từng dòng máy. Dữ liệu sẽ tự động áp dụng vào Lịch Bảo Trì PM và Biên bản nghiệm thu FSR.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsNewCatModalOpen(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 cursor-pointer active:scale-95 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>+ Thêm Nhóm Mới</span>
              </button>
            </div>
          </div>

          {/* 2-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left column: List of categories */}
            <div className="lg:col-span-4 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 px-2 pt-1 flex items-center justify-between">
                <span>Danh Mục Nhóm Thiết Bị ({Object.keys(categoryConfigs).length})</span>
                <span className="text-[10px] text-slate-400 font-normal">Chọn nhóm để chỉnh sửa</span>
              </div>

              <div className="space-y-1.5 max-h-[75vh] overflow-y-auto pr-1">
                {Object.entries(categoryConfigs).map(([catKey, cfg]) => {
                  const isSelected = activeConfigCat === catKey;
                  const matchingDevCount = installedDevices.filter(d => getCategoryForDevice(d.category, d.deviceName, categoryConfigs) === catKey).length;

                  return (
                    <div
                      key={catKey}
                      onClick={() => setActiveConfigCat(catKey)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? "bg-indigo-50/90 dark:bg-indigo-950/70 border-indigo-400 dark:border-indigo-600 shadow-xs ring-1 ring-indigo-400/40"
                          : "bg-white dark:bg-slate-850 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${cfg.badgeColor}`}>
                          {cfg.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold">
                          {cfg.checklist?.length || 0} bước
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-1.5 truncate">
                        {cfg.standardProtocol}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                        <span>Đã lắp đặt: <strong className="text-slate-700 dark:text-slate-300">{matchingDevCount} máy</strong></span>
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-0.5">
                          {isSelected ? "Đang chỉnh sửa ▸" : "Chỉnh sửa"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right column: Category Editor */}
            <div className="lg:col-span-8">
              {renderCategoryDetailEditor(activeConfigCat)}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: LẬP KẾ HOẠCH BẢO TRÌ ĐỊNH KỲ (PM MODAL) */}
      {isNewPMModalOpen && (
        <Modal
          isOpen={isNewPMModalOpen}
          onClose={() => setIsNewPMModalOpen(false)}
          title="Lập Kế Hoạch Bảo Trì Thiết Bị Định Kỳ (Preventive Maintenance - PM)"
          size="2xl"
        >
          <form onSubmit={handleCreatePM} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Mã Lệnh Bảo Trì (PM)</label>
                <input
                  type="text"
                  value={pmForm.code}
                  onChange={e => setPmForm({ ...pmForm, code: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Mức Độ Ưu Tiên</label>
                <select
                  value={pmForm.priority}
                  onChange={e => setPmForm({ ...pmForm, priority: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  <option value="CAO">Ưu Tiên Cao (Hạn bảo trì &lt;15 ngày)</option>
                  <option value="TIEU_CHUAN">Tiêu Chuẩn (Định kỳ định chuẩn)</option>
                  <option value="KHAN_CAP">Khẩn Cấp</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Chọn Thiết Bị Cần Bảo Trì (Từ Danh Bạ Máy Lắp Đặt)
              </label>
              <select
                value={pmForm.deviceId}
                onChange={e => {
                  const dev = installedDevices.find(d => d.id === e.target.value);
                  const cat = getCategoryForDevice(dev?.category, dev?.deviceName, categoryConfigs);
                  const config = getCatConfig(cat);
                  const initChecklist: Record<string, boolean> = {};
                  (config.checklist || []).forEach(chk => {
                    initChecklist[chk.key] = true;
                  });
                  setPmForm({
                    ...pmForm,
                    deviceId: e.target.value,
                    category: cat,
                    hospitalName: dev?.hospitalName || pmForm.hospitalName,
                    department: dev?.department || pmForm.department,
                    checklist: initChecklist
                  });
                }}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
              >
                {installedDevices.map(d => {
                  const cat = getCategoryForDevice(d.category, d.deviceName, categoryConfigs);
                  const config = getCatConfig(cat);
                  return (
                    <option key={d.id} value={d.id}>
                      [{config?.name || "Máy"}] {d.deviceName} - {d.hospitalName} ({d.serialNumber})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Dynamic Checklist Preview for the selected device */}
            {(() => {
              const selectedDev = installedDevices.find(d => d.id === pmForm.deviceId) || installedDevices[0];
              const cat = getCategoryForDevice(selectedDev?.category || pmForm.category, selectedDev?.deviceName, categoryConfigs);
              const config = getCatConfig(cat);
              const checklistItems = config.checklist || [];

              return (
                <div className="p-3.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 dark:text-slate-200 flex-wrap gap-2">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${config.badgeColor}`}>
                        {config.name}
                      </span>
                      <span>Quy trình {checklistItems.length} tiêu chuẩn kiểm định sẽ triển khai:</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">{config.standardProtocol}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveConfigCat(cat);
                          setIsConfigModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-all active:scale-95"
                        title="Tùy chỉnh nội dung các bước tiêu chuẩn kiểm định cho nhóm thiết bị này"
                      >
                        <Sliders className="w-3 h-3" />
                        <span>⚙️ Cài Đặt Quy Trình Nhóm Này</span>
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    {checklistItems.map((chk, idx) => {
                      const isChecked = pmForm.checklist ? (pmForm.checklist[chk.key] !== false) : true;
                      return (
                        <div
                          key={chk.key || idx}
                          onClick={() => {
                            setPmForm(prev => ({
                              ...prev,
                              checklist: {
                                ...prev.checklist,
                                [chk.key]: !isChecked
                              }
                            }));
                          }}
                          className={`flex items-start gap-2 p-2 rounded-lg border transition-all cursor-pointer ${
                            isChecked
                              ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-500/50 shadow-2xs"
                              : "bg-slate-100/60 dark:bg-slate-900/40 border-dashed border-slate-300 dark:border-slate-800 opacity-60"
                          }`}
                        >
                          <span className={`w-4 h-4 rounded-full font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5 ${
                            isChecked
                              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : "bg-slate-300 dark:bg-slate-700 text-slate-500"
                          }`}>
                            {isChecked ? "✓" : "○"}
                          </span>
                          <div className="flex-1">
                            <span className="text-slate-800 dark:text-slate-200 font-medium leading-snug">{chk.label}</span>
                            {chk.defaultNote && (
                              <div className="text-[9.5px] text-slate-400 mt-0.5">{chk.defaultNote}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                    <span>* Kỹ sư có thể click để bật/tắt áp dụng từng tiêu chuẩn cho ca bảo trì này.</span>
                    <span className="font-semibold text-emerald-600">
                      Đã kích hoạt {Object.values(pmForm.checklist || {}).filter(v => v !== false).length || checklistItems.length}/{checklistItems.length} tiêu chuẩn
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Ngày Kế Hoạch Triển Khai</label>
                <input
                  type="text"
                  value={pmForm.scheduledDate}
                  onChange={e => setPmForm({ ...pmForm, scheduledDate: e.target.value })}
                  placeholder="dd/mm/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Kỹ Sư FSE Phụ Trách</label>
                <select
                  value={pmForm.assignedEngineer}
                  onChange={e => setPmForm({ ...pmForm, assignedEngineer: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  <option value="">-- Chọn kỹ sư --</option>
                  {pmForm.assignedEngineer && !engineers.some(p => p.full_name === pmForm.assignedEngineer) && (
                    <option value={pmForm.assignedEngineer}>{pmForm.assignedEngineer}</option>
                  )}
                  {engineers.map(p => (
                    <option key={p.employee_code || p.full_name} value={p.full_name}>{p.full_name}{p.position ? ` (${p.position})` : ""}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Người Liên Hệ Tại Bệnh Viện</label>
                <input
                  type="text"
                  value={pmForm.hospitalContactPerson}
                  onChange={e => setPmForm({ ...pmForm, hospitalContactPerson: e.target.value })}
                  placeholder="Ví dụ: TS. BS. Nguyễn Lê Minh"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Số Điện Thoại Liên Hệ</label>
                <input
                  type="text"
                  value={pmForm.hospitalContactPhone}
                  onChange={e => setPmForm({ ...pmForm, hospitalContactPhone: e.target.value })}
                  placeholder="Ví dụ: 0908 123 456"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Ghi Chú Kế Hoạch Bảo Trì</label>
              <textarea
                value={pmForm.serviceReportNotes}
                onChange={e => setPmForm({ ...pmForm, serviceReportNotes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white resize-none"
              />
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewPMModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold shadow-md shadow-amber-600/30"
              >
                Lưu Kế Hoạch Bảo Trì
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 2: TIẾP NHẬN SỰ CỐ MÁY KHẨN (BREAK-FIX CM) */}
      {isNewBreakfixModalOpen && (
        <Modal
          isOpen={isNewBreakfixModalOpen}
          onClose={() => setIsNewBreakfixModalOpen(false)}
          title="Tiếp Nhận &amp; Điều Phối Sửa Chữa Sự Cố Thiết Bị (Break-fix Ticket)"
          size="2xl"
        >
          <form onSubmit={handleCreateBreakfix} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Mã Lệnh Sửa Chữa (CM)</label>
                <input
                  type="text"
                  value={breakfixForm.code}
                  onChange={e => setBreakfixForm({ ...breakfixForm, code: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Mức Độ Khẩn Cấp</label>
                <select
                  value={breakfixForm.priority}
                  onChange={e => setBreakfixForm({ ...breakfixForm, priority: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-rose-600"
                >
                  <option value="KHAN_CAP">Khẩn Cấp (Máy dừng chạy mẫu - Can thiệp &lt;2h)</option>
                  <option value="CAO">Ưu Tiên Cao (Lỗi tín hiệu - Can thiệp trong ngày)</option>
                  <option value="TIEU_CHUAN">Tiêu Chuẩn</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Chọn Máy Đang Gặp Sự Cố
              </label>
              <select
                value={breakfixForm.deviceId}
                onChange={e => {
                  const dev = installedDevices.find(d => d.id === e.target.value);
                  const cat = getCategoryForDevice(dev?.category, dev?.deviceName, categoryConfigs);
                  setBreakfixForm({
                    ...breakfixForm,
                    deviceId: e.target.value,
                    category: cat,
                    hospitalName: dev?.hospitalName || breakfixForm.hospitalName,
                    department: dev?.department || breakfixForm.department
                  });
                }}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  {installedDevices.map(d => {
                    const cat = getCategoryForDevice(d.category, d.deviceName, categoryConfigs);
                    const config = getCatConfig(cat);
                    return (
                      <option key={d.id} value={d.id}>
                        [{config?.name || "Máy"}] {d.deviceName} - {d.hospitalName} ({d.serialNumber})
                      </option>
                    );
                  })}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Mô Tả Triệu Chứng / Mã Lỗi Thiết Bị Báo (Error Code)
              </label>
              <textarea
                value={breakfixForm.issueDescription}
                onChange={e => setBreakfixForm({ ...breakfixForm, issueDescription: e.target.value })}
                placeholder="Ví dụ: Tủ âm sâu báo chuông Alarm Temp High (-60°C); hoặc Máy ly tâm báo lỗi Err 01 Imbalance..."
                rows={3}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white resize-none"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Kỹ Sư FSE Trực Tiếp Can Thiệp</label>
                <select
                  value={breakfixForm.assignedEngineer}
                  onChange={e => setBreakfixForm({ ...breakfixForm, assignedEngineer: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  <option value="">-- Chọn kỹ sư --</option>
                  {breakfixForm.assignedEngineer && !engineers.some(p => p.full_name === breakfixForm.assignedEngineer) && (
                    <option value={breakfixForm.assignedEngineer}>{breakfixForm.assignedEngineer}</option>
                  )}
                  {engineers.map(p => (
                    <option key={p.employee_code || p.full_name} value={p.full_name}>{p.full_name}{p.position ? ` (${p.position})` : ""}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Thời Gian Đến Viện Dự Kiến</label>
                <input
                  type="text"
                  value={breakfixForm.scheduledDate}
                  onChange={e => setBreakfixForm({ ...breakfixForm, scheduledDate: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Bác Sĩ / Kỹ Thuật Viên Báo Lỗi</label>
                <input
                  type="text"
                  value={breakfixForm.hospitalContactPerson}
                  onChange={e => setBreakfixForm({ ...breakfixForm, hospitalContactPerson: e.target.value })}
                  placeholder="Họ tên người báo lỗi"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Số Điện Thoại Trực Khoa</label>
                <input
                  type="text"
                  value={breakfixForm.hospitalContactPhone}
                  onChange={e => setBreakfixForm({ ...breakfixForm, hospitalContactPhone: e.target.value })}
                  placeholder="Số điện thoại"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewBreakfixModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/30"
              >
                Tạo Lệnh Sửa Chữa Khẩn
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 3: BÀN GIAO THIẾT BỊ MỚI VÀO VIỆN (INSTALLED DEVICE MODAL) */}
      {isNewDeviceModalOpen && (
        <Modal
          isOpen={isNewDeviceModalOpen}
          onClose={() => setIsNewDeviceModalOpen(false)}
          title="Bàn Giao &amp; Ghi Nhận Thiết Bị Mới Vào Bệnh Viện (New Installed Base)"
          size="2xl"
        >
          <form onSubmit={handleCreateInstalledDevice} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Phân Loại Dòng Thiết Bị</label>
                <select
                  value={newDeviceForm.category}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, category: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  {Object.entries(categoryConfigs).map(([catKey, cfg]) => (
                    <option key={catKey} value={catKey}>
                      {cfg.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Tên Thiết Bị</label>
                <input
                  type="text"
                  value={newDeviceForm.deviceName}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, deviceName: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-bold"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Model Thiết Bị</label>
                <input
                  type="text"
                  value={newDeviceForm.model}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, model: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Số Serial Number (SN)</label>
                <input
                  type="text"
                  value={newDeviceForm.serialNumber}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, serialNumber: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-emerald-600"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Bệnh Viện Bàn Giao</label>
                <input
                  type="text"
                  value={newDeviceForm.hospitalName}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, hospitalName: e.target.value })}
                  placeholder="Ví dụ: Bệnh Viện Chợ Rẫy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Khoa / Phòng Lắp Đặt</label>
                <input
                  type="text"
                  value={newDeviceForm.department}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, department: e.target.value })}
                  placeholder="Ví dụ: Khoa Vi Sinh"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Ngày Bàn Giao</label>
                <input
                  type="text"
                  value={newDeviceForm.installationDate}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, installationDate: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Hạn Bảo Hành</label>
                <input
                  type="text"
                  value={newDeviceForm.warrantyExpiry}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, warrantyExpiry: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Chu Kỳ Bảo Trì (Tháng)</label>
                <select
                  value={newDeviceForm.maintenanceIntervalMonths}
                  onChange={e => setNewDeviceForm({ ...newDeviceForm, maintenanceIntervalMonths: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                >
                  <option value={3}>3 tháng / lần</option>
                  <option value={6}>6 tháng / lần (Chuẩn)</option>
                  <option value={12}>12 tháng / lần</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewDeviceModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/30"
              >
                Lưu Vào Danh Bạ Máy
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL 4: BIÊN BẢN DỊCH VỤ KỸ THUẬT SỐ HÓA A4 (FIELD SERVICE REPORT - FSR) */}
      {isFSRViewerModalOpen && selectedService && (
        <Modal
          isOpen={isFSRViewerModalOpen}
          onClose={() => setIsFSRViewerModalOpen(false)}
          title={`Biên Bản Dịch Vụ Kỹ Thuật (FSR): ${selectedService.code}`}
          size="5xl"
        >
          <div className="space-y-4">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between p-3 bg-slate-800 rounded-2xl text-white">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-amber-400">{selectedService.code}</span>
                <span className="text-xs text-slate-300">• {selectedService.hospitalName}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>In Biên Bản (A4)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(selectedService.id, "HOAN_THANH")}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Phê Duyệt &amp; Nghiệm Thu</span>
                </button>
              </div>
            </div>

            {/* A4 Document Rendering Frame */}
            <div className="max-h-[75vh] overflow-y-auto p-4 bg-slate-950/40 rounded-2xl border border-slate-700/50">
              <div className="max-w-4xl mx-auto bg-white text-slate-900 p-8 sm:p-12 rounded-2xl shadow-2xl border border-slate-300 space-y-6 font-sans select-text">
                {/* Official Letterhead */}
                <div className="flex items-center justify-between border-b-2 border-slate-800 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-orange-600 text-white font-black flex items-center justify-center text-lg">
                      {companyConfig.companyName?.slice(0, 3)?.toUpperCase() || "ABT"}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-base">{companyConfig.companyName || "CÔNG TY CỔ PHẦN CÔNG NGHỆ SINH HỌC & THIẾT BỊ Y TẾ ABT"}</div>
                      <div className="text-xs text-slate-500 font-sans">PHÒNG ỨNG DỤNG LÂM SÀNG &amp; DỊCH VỤ KỸ THUẬT (FAS / FSE)</div>
                      <div className="text-[11px] text-slate-400 font-sans">Hotline Kỹ Thuật: {companyConfig.companyPhone || "0908 123 456"} {companyConfig.companyEmail ? `• Email: ${companyConfig.companyEmail}` : ""}</div>
                    </div>
                  </div>
                  <div className="text-right font-sans text-xs">
                    <div className="font-mono font-bold text-slate-800 text-sm">{selectedService.code}</div>
                    <div className="text-slate-500">Mã FSR: FSR-{selectedService.id}</div>
                    <div className="text-emerald-700 font-bold">Chuẩn ISO 13485:2016</div>
                  </div>
                </div>

                {/* Title */}
                <div className="text-center pt-2 space-y-1">
                  <h2 className="text-xl font-bold uppercase tracking-tight text-slate-900">
                    BIÊN BẢN DỊCH VỤ BẢO TRÌ &amp; SỬA CHỮA THIẾT BỊ Y TẾ
                  </h2>
                  <div className="text-xs font-mono italic text-slate-600">
                    (FIELD SERVICE &amp; PREVENTIVE MAINTENANCE REPORT)
                  </div>
                </div>

                {/* Customer & Machine Info */}
                <div className="grid grid-cols-2 gap-4 text-xs font-sans bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <div className="space-y-1">
                    <div><span className="text-slate-500">Đơn vị sử dụng:</span> <strong className="text-slate-900">{selectedService.hospitalName}</strong></div>
                    <div><span className="text-slate-500">Khoa / Phòng:</span> {selectedService.department}</div>
                    <div><span className="text-slate-500">Đại diện tiếp nhận:</span> {selectedService.hospitalContactPerson || "Bác sĩ / Kỹ thuật viên phụ trách"}</div>
                    <div><span className="text-slate-500">Số điện thoại:</span> {selectedService.hospitalContactPhone || "N/A"}</div>
                  </div>
                  <div className="space-y-1">
                    {(() => {
                      const cat = getCategoryForDevice(selectedService.category, selectedService.deviceName, categoryConfigs);
                      const catConfig = getCatConfig(cat);
                      return (
                        <>
                          <div>
                            <span className="text-slate-500">Dòng thiết bị:</span>{" "}
                            <strong className="text-blue-700 uppercase font-bold">{catConfig?.name}</strong>
                          </div>
                          <div><span className="text-slate-500">Tên thiết bị:</span> <strong className="text-slate-900">{selectedService.deviceName}</strong></div>
                          <div><span className="text-slate-500">Model:</span> <span className="font-mono">{selectedService.model}</span></div>
                          <div><span className="text-slate-500">Số Serial (SN):</span> <strong className="font-mono text-emerald-700">{selectedService.serialNumber}</strong></div>
                          <div><span className="text-slate-500">Kỹ sư FSE:</span> <strong className="text-slate-900">{selectedService.assignedEngineer}</strong></div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Service Details & Results */}
                <div className="space-y-4 text-xs leading-relaxed text-slate-800">
                  <div>
                    <strong className="text-slate-900 font-sans uppercase">I. NỘI DUNG VÀ HẠNG MỤC CÔNG VIỆC TRIỂN KHAI:</strong>
                    <div className="mt-1 p-3 bg-slate-50 rounded-xl border border-slate-200 font-sans">
                      {selectedService.serviceReportNotes || "Đã thực hiện đầy đủ các hạng mục theo quy trình bảo trì chuẩn của nhà sản xuất."}
                    </div>
                  </div>

                  {/* Dynamic Category SOP Checklist Rendering */}
                  {(() => {
                    const cat = getCategoryForDevice(selectedService.category, selectedService.deviceName, categoryConfigs);
                    const config = getCatConfig(cat);
                    return (
                      <div>
                        <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                          <strong className="text-slate-900 font-sans uppercase">
                            II. KẾT QUẢ ĐỐI CHIẾU {config.checklist?.length || 6} TIÊU CHUẨN KỸ THUẬT:
                          </strong>
                          <span className="text-[10px] font-mono font-bold text-blue-700 font-sans">
                            Áp dụng: {config.standardProtocol}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-2 font-sans text-[11px]">
                          {config.checklist.map(chk => {
                            const isDone = selectedService.checklist ? Boolean((selectedService.checklist as any)[chk.key] ?? true) : true;
                            return (
                              <div
                                key={chk.key}
                                className={`flex items-start gap-2 p-2 rounded-lg border ${
                                  isDone
                                    ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                                    : "bg-amber-50/80 border-amber-200 text-amber-950"
                                }`}
                              >
                                <span className="font-bold text-xs">{isDone ? "✓" : "⚠"}</span>
                                <div>
                                  <div className="font-semibold">{chk.label}</div>
                                  <div className="text-[10px] text-slate-500">
                                    {isDone ? "Đạt chuẩn kỹ thuật theo Service Manual của Hãng" : "Cần theo dõi thêm"}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {selectedService.sparePartsUsed && (
                    <div>
                      <strong className="text-slate-900 font-sans uppercase">III. LINH KIỆN VÀ PHỤ TÙNG TIÊU HAO ĐÃ THAY THẾ:</strong>
                      <p className="mt-1 font-mono text-slate-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                        {selectedService.sparePartsUsed}
                      </p>
                    </div>
                  )}

                  <div>
                    <strong className="text-slate-900 font-sans uppercase">IV. KẾT LUẬN &amp; KHUYẾN NGHỊ KỸ THUẬT:</strong>
                    <p className="mt-1 text-slate-700 font-sans">
                      Thiết bị xét nghiệm đã được kiểm định toàn diện theo quy chuẩn chuyên ngành, hoạt động ổn định và đủ điều kiện tiếp tục vận hành phục vụ chuyên môn tại bệnh viện. Đã dán tem bảo trì định kỳ có giá trị đến ngày <strong>{selectedService.scheduledDate}</strong>.
                    </p>
                  </div>
                </div>

                {/* Signatures */}
                <div className="pt-8 border-t border-slate-300 font-sans">
                  <div className="grid grid-cols-2 gap-8 text-center text-xs">
                    <div className="space-y-2">
                      <div className="font-bold text-slate-900 uppercase">ĐẠI DIỆN BỆNH VIỆN / TRƯỞNG KHOA</div>
                      <div className="text-[11px] text-slate-500 italic">(Ký, ghi rõ họ tên và đóng dấu)</div>
                      <div className="h-20 flex items-center justify-center">
                        <span className="text-slate-400 italic text-xs">[Đã xác nhận dịch vụ]</span>
                      </div>
                      <div className="font-bold text-slate-800">{selectedService.hospitalContactPerson || "Bác Sĩ Trưởng Khoa"}</div>
                    </div>

                    <div className="space-y-2">
                      <div className="font-bold text-slate-900 uppercase">KỸ SƯ DỊCH VỤ KỸ THUẬT ({companyConfig.companyName ? companyConfig.companyName.toUpperCase() : "FSE"})</div>
                      <div className="text-[11px] text-slate-500 italic">(Ký và ghi rõ họ tên)</div>
                      <div className="h-20 flex items-center justify-center">
                        <span className="text-blue-600 font-sans text-lg italic font-bold">
                          {selectedService.assignedEngineer}
                        </span>
                      </div>
                      <div className="font-bold text-slate-800">{selectedService.assignedEngineer}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 5: DOCUMENT & IMAGE PREVIEW LIGHTBOX */}
      {previewAttachment && (
        <Modal
          isOpen={Boolean(previewAttachment)}
          onClose={() => setPreviewAttachment(null)}
          title={`Xem trước tệp: ${previewAttachment.name}`}
          size="4xl"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-slate-800 dark:text-slate-200">{previewAttachment.name}</span>
              <a
                href={previewAttachment.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline flex items-center gap-1 font-bold"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Mở trong tab mới
              </a>
            </div>

            <div className="min-h-[400px] max-h-[70vh] flex items-center justify-center bg-slate-950/20 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
              {previewAttachment.type?.includes("pdf") || previewAttachment.name.endsWith(".pdf") ? (
                <iframe
                  src={previewAttachment.url}
                  className="w-full h-[65vh] border-0"
                  title={previewAttachment.name}
                />
              ) : (
                <img
                  src={previewAttachment.url}
                  alt={previewAttachment.name}
                  className="max-h-[65vh] object-contain rounded-xl"
                />
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 6: CÀI ĐẶT QUY TRÌNH NHÓM THIẾT BỊ (TỪ MODAL PM HOẶC QUICK ACTION) */}
      {isConfigModalOpen && (
        <Modal
          isOpen={isConfigModalOpen}
          onClose={() => setIsConfigModalOpen(false)}
          title={`Cài Đặt Quy Trình Kiểm Định - ${getCatConfig(activeConfigCat).name}`}
          size="4xl"
        >
          {renderCategoryDetailEditor(activeConfigCat, true)}
        </Modal>
      )}

      {/* MODAL 7: THÊM NHÓM THIẾT BỊ MỚI (NEW CATEGORY) */}
      {isNewCatModalOpen && (
        <Modal
          isOpen={isNewCatModalOpen}
          onClose={() => setIsNewCatModalOpen(false)}
          title="Tạo Nhóm Thiết Bị Mới & Khởi Tạo Quy Trình Chuẩn (SOP Protocol)"
          size="md"
        >
          <form onSubmit={handleCreateCategory} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tên Nhóm Thiết Bị <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={newCatForm.name}
                onChange={e => setNewCatForm({ ...newCatForm, name: e.target.value })}
                placeholder="Ví dụ: Máy Phân Tích Huyết Học Laser Tự Động"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Mã Định Danh (Key Code - Tùy chọn)
              </label>
              <input
                type="text"
                value={newCatForm.key}
                onChange={e => setNewCatForm({ ...newCatForm, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                placeholder="Ví dụ: HEMATOLOGY_ANALYZER (để trống sẽ tự sinh)"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tiêu Chuẩn / Quy Chuẩn Kỹ Thuật Áp Dụng
              </label>
              <input
                type="text"
                value={newCatForm.standardProtocol}
                onChange={e => setNewCatForm({ ...newCatForm, standardProtocol: e.target.value })}
                placeholder="Ví dụ: CLSI H26-A2 & ISO 15189"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Màu Sắc Nhận Diện
              </label>
              <div className="flex flex-wrap gap-1.5">
                {BADGE_COLOR_OPTIONS.map(opt => {
                  const isSelected = newCatForm.badgeColor === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setNewCatForm({ ...newCatForm, badgeColor: opt.value })}
                      className={`px-2 py-0.5 rounded-lg text-[9.5px] font-bold border transition-all cursor-pointer ${opt.value} ${
                        isSelected ? "ring-2 ring-indigo-500 scale-105" : "opacity-80"
                      }`}
                    >
                      {opt.label.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewCatModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 cursor-pointer"
              >
                Tạo Nhóm &amp; Khởi Tạo Quy Trình
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
