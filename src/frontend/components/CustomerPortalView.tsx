"use client";

import React, { useState, useEffect } from "react";
import { 
  Search, 
  Package, 
  Truck, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Star, 
  FileText, 
  ShieldCheck, 
  Building2, 
  Phone, 
  Mail, 
  User, 
  ArrowLeft, 
  Send, 
  Sparkles,
  ExternalLink,
  ChevronRight,
  Thermometer,
  Layers,
  HelpCircle,
  Activity,
  HeartPulse,
  Info,
  Lock,
  LogOut,
  KeyRound,
  ShieldAlert,
  Building,
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Sliders,
  Settings2,
  Microscope,
  UploadCloud,
  X,
  Paperclip,
  Film,
  Image as ImageIcon,
  FileSpreadsheet,
  PlayCircle,
  Eye,
  Download
} from "lucide-react";

interface CustomerPortalViewProps {
  onBackToStaffLogin: () => void;
}

export const CustomerPortalView: React.FC<CustomerPortalViewProps> = ({ onBackToStaffLogin }) => {
  // State: Khách hàng đăng nhập bảo mật
  const [customer, setCustomer] = useState<{
    id: number;
    customer_code: string;
    name: string;
    phone: string;
    email?: string;
    tax_code?: string;
    address?: string;
    contact_person?: string;
  } | null>(null);

  const [loginCode, setLoginCode] = useState("");
  const [loginPhone, setLoginPhone] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [demoAccounts, setDemoAccounts] = useState<any[]>([]);

  const [activeTab, setActiveTab] = useState<"orders" | "feedback" | "incident">("orders");

  // State: Tra cứu đơn hàng
  const [searchQuery, setSearchQuery] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

  // State: Đánh giá dịch vụ (CSAT / NPS)
  const [fbName, setFbName] = useState("");
  const [fbPhone, setFbPhone] = useState("");
  const [fbOrg, setFbOrg] = useState("");
  const [fbOrderCode, setFbOrderCode] = useState("");
  const [npsScore, setNpsScore] = useState<number>(10);
  const [csatColdChain, setCsatColdChain] = useState<number>(5);
  const [csatDelivery, setCsatDelivery] = useState<number>(5);
  const [csatProduct, setCsatProduct] = useState<number>(5);
  const [csatSupport, setCsatSupport] = useState<number>(5);
  const [fbComments, setFbComments] = useState("");
  const [isSubmittingFb, setIsSubmittingFb] = useState(false);
  const [fbSuccessMsg, setFbSuccessMsg] = useState("");

  // State: Báo cáo sự cố y tế (Incident)
  const [incName, setIncName] = useState("");
  const [incPhone, setIncPhone] = useState("");
  const [incEmail, setIncEmail] = useState("");
  const [incOrg, setIncOrg] = useState("");
  const [incOrderCode, setIncOrderCode] = useState("");
  const [incProductCode, setIncProductCode] = useState("");
  const [incProductName, setIncProductName] = useState("");
  const [incLotNumber, setIncLotNumber] = useState("");

  // 1. Loại sự cố dạng ô stick chọn (Checkboxes) & Cài đặt bổ sung
  const [incidentCategories, setIncidentCategories] = useState<{ id: string; label: string; icon?: string }[]>([
    { id: "FALSE_POSITIVE", label: "Nghi ngờ Dương tính giả (False Positive)", icon: "⚠️" },
    { id: "FALSE_NEGATIVE", label: "Nghi ngờ Âm tính giả (False Negative)", icon: "⚠️" },
    { id: "HIGH_BACKGROUND", label: "Tín hiệu nền cao / Lỗi đường cong Ct (Ct anomaly)", icon: "📈" },
    { id: "COLD_CHAIN_BROKEN", label: "Mất chuỗi lạnh / Đá rã đông lúc nhận hàng", icon: "❄️" },
    { id: "LEAKAGE_DAMAGED", label: "Hỏng bao bì / Rò rỉ hóa chất sinh phẩm", icon: "📦" },
    { id: "INTERNAL_CONTROL_FAIL", label: "Chứng nội kiểm (Internal Control - IC) không lên", icon: "🧪" },
    { id: "INSTRUMENT_ERROR", label: "Thiết bị / Máy PCR báo mã lỗi phần cứng", icon: "⚙️" },
    { id: "REAGENT_EXPIRY", label: "Nghi ngờ hạn dùng / Hóa chất kết tủa đổi màu", icon: "⏳" },
    { id: "EXTRACTION_ISSUE", label: "Lỗi tách chiết mẫu / Nồng độ axit nucleic kém", icon: "🧬" }
  ]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(["FALSE_POSITIVE"]);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState("");

  const [incSeverity, setIncSeverity] = useState("HIGH");
  const [incPatientImpact, setIncPatientImpact] = useState("PATIENT_SAMPLE_RETESTED");
  const [incInstrument, setIncInstrument] = useState("Bio-Rad CFX96 Touch");
  const [incAffectedTests, setIncAffectedTests] = useState<number>(10);
  const [incDescription, setIncDescription] = useState("");

  // 2. Thông tin phục vụ xác định nguyên nhân (Root Cause Analysis - RCA)
  const [rcaStorageTemp, setRcaStorageTemp] = useState("-20°C (Nhiệt độ ổn định, không mất điện)");
  const [rcaColdChainArrival, setRcaColdChainArrival] = useState("Đá khô/gel còn nguyên vẹn lúc nhận");
  const [rcaExtractionMethod, setRcaExtractionMethod] = useState("Tách chiết hạt từ tự động (Automated Magnetic Beads)");
  const [rcaSampleType, setRcaSampleType] = useState("Dịch phết tỵ hầu / Họng");
  const [rcaNcPcResult, setRcaNcPcResult] = useState("NC âm tính (No Ct), PC lên tốt ở Ct 22-24");
  const [rcaInternalControl, setRcaInternalControl] = useState("PASS");
  const [rcaFrequency, setRcaFrequency] = useState("MULTI_WELL");
  const [rcaCrossCheck, setRcaCrossCheck] = useState("Đã thử chạy song song với kit lô cũ, kết quả bình thường");
  
  // Các trường thông tin tùy biến bổ sung theo yêu cầu chẩn đoán
  const [customRcaFields, setCustomRcaFields] = useState<{ id: string; label: string; value: string }[]>([
    { id: "1", label: "Số chu kỳ luân nhiệt (PCR Cycles)", value: "40 chu kỳ" },
    { id: "2", label: "Kênh màu huỳnh quang bị ảnh hưởng", value: "FAM & HEX" }
  ]);
  const [newRcaFieldLabel, setNewRcaFieldLabel] = useState("");
  const [isAddingRcaField, setIsAddingRcaField] = useState(false);

  const [isSubmittingInc, setIsSubmittingInc] = useState(false);
  const [createdIncidentCode, setCreatedIncidentCode] = useState("");

  // Hàm chọn/bỏ chọn loại sự cố
  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) => 
      prev.includes(id) 
        ? (prev.length > 1 ? prev.filter((c) => c !== id) : prev)
        : [...prev, id]
    );
  };

  // Hàm thêm loại sự cố mới
  const handleAddCustomCategory = () => {
    if (!newCategoryLabel.trim()) return;
    const newId = `CUSTOM_${Date.now()}`;
    const newCat = { id: newId, label: newCategoryLabel.trim(), icon: "📌" };
    setIncidentCategories((prev) => [...prev, newCat]);
    setSelectedCategories((prev) => [...prev, newId]);
    setNewCategoryLabel("");
    setIsAddingCategory(false);
  };

  // Hàm thêm trường thông tin xác định nguyên nhân mới
  const handleAddCustomRcaField = () => {
    if (!newRcaFieldLabel.trim()) return;
    const newField = {
      id: String(Date.now()),
      label: newRcaFieldLabel.trim(),
      value: ""
    };
    setCustomRcaFields((prev) => [...prev, newField]);
    setNewRcaFieldLabel("");
    setIsAddingRcaField(false);
  };

  const handleUpdateCustomRcaField = (id: string, value: string) => {
    setCustomRcaFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, value } : f))
    );
  };

  const handleDeleteCustomRcaField = (id: string) => {
    setCustomRcaFields((prev) => prev.filter((f) => f.id !== id));
  };

  // 3. State & Handlers: Đính kèm hình ảnh, video, tập tin dữ liệu
  interface IncidentAttachment {
    name: string;
    url: string;
    size: number;
    type: string;
    category: "image" | "video" | "document" | "raw_data";
  }

  const [incAttachments, setIncAttachments] = useState<IncidentAttachment[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsUploadingFiles(true);
    setUploadError("");

    const newAttachments: IncidentAttachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const ext = file.name.split(".").pop()?.toLowerCase() || "";
          let cat: "image" | "video" | "document" | "raw_data" = "document";
          if (file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
            cat = "image";
          } else if (file.type.startsWith("video/") || ["mp4", "mov", "webm", "avi"].includes(ext)) {
            cat = "video";
          } else if (["pcrd", "eds", "csv", "tsv", "dat", "log"].includes(ext)) {
            cat = "raw_data";
          }

          newAttachments.push({
            name: data.name || file.name,
            url: data.url,
            size: data.size || file.size,
            type: data.type || file.type,
            category: cat,
          });
        } else {
          setUploadError(data.error || `Lỗi tải lên tệp ${file.name}`);
        }
      } catch (err: any) {
        console.error("Upload error:", err);
        setUploadError(`Lỗi kết nối khi tải tệp ${file.name}`);
      }
    }

    setIncAttachments((prev) => [...prev, ...newAttachments]);
    setIsUploadingFiles(false);
  };

  const handleRemoveAttachment = (index: number) => {
    setIncAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // State: Tra cứu Ticket Sự Cố
  const [ticketSearchCode, setTicketSearchCode] = useState("");
  const [trackedIncident, setTrackedIncident] = useState<any>(null);
  const [isSearchingTicket, setIsSearchingTicket] = useState(false);
  const [ticketError, setTicketError] = useState("");

  // Khôi phục phiên đăng nhập từ sessionStorage
  useEffect(() => {
    // Kiểm tra phiên lưu trong sessionStorage
    try {
      const saved = sessionStorage.getItem("abt_customer_session");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.customer_code) {
          setCustomer(parsed);
          setFbName(parsed.name || "");
          setFbPhone(parsed.phone || "");
          setFbOrg(parsed.name || "");
          setIncName(parsed.contact_person || parsed.name || "");
          setIncPhone(parsed.phone || "");
          setIncEmail(parsed.email || "");
          setIncOrg(parsed.name || "");
          fetchOrders(parsed.id, parsed.customer_code, "");
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchOrders = async (cId?: number, cCode?: string, q = "") => {
    const idToUse = cId ?? customer?.id;
    const codeToUse = cCode ?? customer?.customer_code;
    if (!idToUse && !codeToUse) {
      setOrders([]);
      setSelectedOrder(null);
      return;
    }

    setIsLoadingOrders(true);
    try {
      const res = await fetch(
        `/api/portal/customer?action=track_orders&customer_id=${idToUse}&customer_code=${encodeURIComponent(codeToUse || "")}&query=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      if (res.ok && data.orders) {
        setOrders(data.orders);
        if (data.orders.length > 0) {
          setSelectedOrder(data.orders[0]);
        } else {
          setSelectedOrder(null);
        }
      } else {
        setOrders([]);
        setSelectedOrder(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const handleSearchOrders = (e: React.FormEvent) => {
    e.preventDefault();
    if (customer) {
      fetchOrders(customer.id, customer.customer_code, searchQuery);
    }
  };

  const handleCustomerLogin = async (codeToSubmit?: string, phoneToSubmit?: string) => {
    const targetCode = (codeToSubmit ?? loginCode).trim();
    const targetPhone = (phoneToSubmit ?? loginPhone).trim();

    if (!targetCode || !targetPhone) {
      setLoginError("Vui lòng nhập đầy đủ Mã khách hàng và Số điện thoại đăng ký");
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch("/api/portal/customer?action=login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_code: targetCode, phone: targetPhone })
      });
      const data = await res.json();

      if (res.ok && data.customer) {
        setCustomer(data.customer);
        try {
          sessionStorage.setItem("abt_customer_session", JSON.stringify(data.customer));
        } catch (e) {}

        // Điền trước thông tin cho form đánh giá và báo cáo sự cố
        setFbName(data.customer.name || "");
        setFbPhone(data.customer.phone || "");
        setFbOrg(data.customer.name || "");
        setIncName(data.customer.contact_person || data.customer.name || "");
        setIncPhone(data.customer.phone || "");
        setIncEmail(data.customer.email || "");
        setIncOrg(data.customer.name || "");

        fetchOrders(data.customer.id, data.customer.customer_code, "");
      } else {
        setLoginError(data.error || "Mã khách hàng hoặc Số điện thoại không chính xác.");
      }
    } catch (e: any) {
      setLoginError("Lỗi kết nối máy chủ: " + e.message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setCustomer(null);
    setOrders([]);
    setSelectedOrder(null);
    setSearchQuery("");
    setLoginError("");
    try {
      sessionStorage.removeItem("abt_customer_session");
    } catch (e) {}
  };

  // Submit Feedback
  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingFb(true);
    setFbSuccessMsg("");
    try {
      const res = await fetch("/api/portal/customer?action=submit_feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: fbName,
          customer_phone: fbPhone,
          organization: fbOrg,
          order_code: fbOrderCode,
          nps_score: npsScore,
          csat_cold_chain: csatColdChain,
          csat_delivery: csatDelivery,
          csat_product: csatProduct,
          csat_support: csatSupport,
          comments: fbComments
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFbSuccessMsg("Cảm ơn Quý khách! Đánh giá chất lượng của Quý khách đã được ghi nhận vào hệ thống quản lý ISO 9001 của ABT.");
        setFbComments("");
      } else {
        alert(data.error || "Lỗi khi gửi đánh giá");
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi kết nối");
    } finally {
      setIsSubmittingFb(false);
    }
  };

  // Submit Incident Report
  const handleSubmitIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingInc(true);
    setCreatedIncidentCode("");
    try {
      const res = await fetch("/api/portal/customer?action=report_incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: incName,
          customer_phone: incPhone,
          customer_email: incEmail,
          organization: incOrg,
          order_code: incOrderCode,
          product_code: incProductCode,
          product_name: incProductName,
          lot_number: incLotNumber,
          incident_categories: selectedCategories,
          incident_category: selectedCategories.map(c => {
            const found = incidentCategories.find(cat => cat.id === c);
            return found ? found.label : c;
          }).join("; "),
          root_cause_data: {
            storage_temp: rcaStorageTemp,
            cold_chain_arrival: rcaColdChainArrival,
            extraction_method: rcaExtractionMethod,
            sample_type: rcaSampleType,
            nc_pc_result: rcaNcPcResult,
            internal_control: rcaInternalControl,
            frequency: rcaFrequency,
            cross_check: rcaCrossCheck,
            custom_fields: customRcaFields
          },
          severity: incSeverity,
          patient_impact: incPatientImpact,
          instrument_model: incInstrument,
          affected_tests: incAffectedTests,
          description: incDescription,
          attachments: incAttachments
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCreatedIncidentCode(data.incident_code);
        setIncDescription("");
        setIncAttachments([]);
      } else {
        alert(data.error || "Lỗi khi gửi báo cáo sự cố");
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi kết nối");
    } finally {
      setIsSubmittingInc(false);
    }
  };

  // Track Ticket
  const handleSearchTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSearchCode.trim()) return;
    setIsSearchingTicket(true);
    setTicketError("");
    setTrackedIncident(null);
    try {
      const res = await fetch(`/api/portal/customer?action=track_incident&incident_code=${encodeURIComponent(ticketSearchCode)}`);
      const data = await res.json();
      if (res.ok && data.incident) {
        setTrackedIncident(data.incident);
      } else {
        setTicketError(data.error || "Không tìm thấy hồ sơ sự cố");
      }
    } catch (err) {
      setTicketError("Lỗi kết nối tra cứu");
    } finally {
      setIsSearchingTicket(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-teal-500 selection:text-white">
      {/* Top Header */}
      <header className="w-full px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center font-black text-white text-base shadow-lg shadow-teal-500/20 ring-2 ring-teal-400/20">
            ABT
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-base tracking-tight text-white font-mono">ABT CLIENT HUB</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                customer 
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" 
                  : "bg-teal-500/20 text-teal-400 border border-teal-500/30"
              }`}>
                {customer ? "Đã Xác Thực Y Tế" : "Healthcare Customer Portal"}
              </span>
            </div>
            {customer ? (
              <div className="flex items-center gap-2 mt-0.5 text-xs text-teal-300 font-semibold truncate max-w-md">
                <Building2 className="w-3.5 h-3.5 shrink-0 text-teal-400" />
                <span className="truncate">{customer.name}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-teal-400 border border-teal-500/30 shrink-0">
                  {customer.customer_code}
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">Cổng Dịch Vụ Khách Hàng, Tra Cứu Đơn &amp; Quản Trị Chất Lượng Y Tế</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-[11px] text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
            <span>Tiêu Chuẩn ISO 9001 / ISO 13485</span>
          </div>

          {customer && (
            <button
              type="button"
              onClick={handleLogout}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-700/60 text-slate-300 border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Đăng xuất khỏi phiên tra cứu của đơn vị"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Đăng Xuất</span>
            </button>
          )}

          <button
            type="button"
            onClick={onBackToStaffLogin}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-orange-400" />
            <span>Cổng Nội Bộ ABT</span>
          </button>
        </div>
      </header>

      {/* Conditional: Login View if !customer */}
      {!customer ? (
        <div className="flex-1 flex flex-col justify-center items-center px-4 py-10 max-w-xl mx-auto w-full text-center">
          <div className="w-full bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden text-left">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-teal-500 via-emerald-500 to-teal-400" />

            <div className="text-center space-y-2 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 text-teal-400 mx-auto flex items-center justify-center shadow-inner">
                <ShieldCheck className="w-8 h-8 text-teal-400" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Xác Thực Khách Hàng Y Tế
              </h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                Để bảo mật thông tin đơn hàng, nhiệt độ chuỗi lạnh và chứng chỉ COA, Quý Bệnh viện / Viện nghiên cứu vui lòng xác thực bằng <strong className="text-teal-300">Mã Khách Hàng</strong> và <strong className="text-teal-300">Số Điện Thoại</strong> đã đăng ký.
              </p>
            </div>

            {loginError && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1">{loginError}</div>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); handleCustomerLogin(); }} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-teal-400" />
                  <span>MÃ KHÁCH HÀNG / BỆNH VIỆN (*)</span>
                </label>
                <input
                  type="text"
                  required
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value.toUpperCase())}
                  placeholder="Ví dụ: KH-ABT-001"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl text-sm font-mono font-bold text-white placeholder-slate-600 focus:outline-none transition-all uppercase"
                />
                <p className="text-[10px] text-slate-500">Mã định danh khách hàng trên hợp đồng nguyên tắc hoặc hóa đơn VAT.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-teal-400" />
                  <span>SỐ ĐIỆN THOẠI ĐĂNG KÝ (*)</span>
                </label>
                <input
                  type="tel"
                  required
                  value={loginPhone}
                  onChange={(e) => setLoginPhone(e.target.value)}
                  placeholder="Ví dụ: 0912345678"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl text-sm font-mono font-bold text-white placeholder-slate-600 focus:outline-none transition-all"
                />
                <p className="text-[10px] text-slate-500">Số điện thoại phụ trách mua sắm vật tư hoặc Trưởng phòng xét nghiệm.</p>
              </div>

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white shadow-lg shadow-teal-900/40 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {isLoggingIn ? (
                  <>
                    <Clock className="w-4 h-4 animate-spin" />
                    <span>Đang kiểm tra bảo mật...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Xác Thực &amp; Vào Cổng Tra Cứu</span>
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={onBackToStaffLogin}
                className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-orange-400" />
                <span>Quay lại Cổng Đăng Nhập Nội Bộ ABT</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Hero Banner */}
          <section className="bg-gradient-to-r from-teal-950/60 via-slate-900 to-slate-950 border-b border-slate-800 px-6 py-6">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1 text-left">
                <div className="inline-flex items-center gap-1.5 text-xs text-teal-400 font-semibold">
                  <HeartPulse className="w-4 h-4 text-rose-400" />
                  <span>Cổng Dịch Vụ Dành Riêng Cho: <strong className="text-white ml-1">{customer.name}</strong></span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  Dịch Vụ Hậu Mãi &amp; Tiếp Nhận Phản Hồi Chất Lượng Chuẩn Quốc Tế
                </h1>
                <p className="text-xs text-slate-400 max-w-2xl">
                  Tra cứu tức thời hành trình chuỗi lạnh, tải chứng từ y tế gốc (CoA, Hóa đơn VAT) và gửi góp ý, báo cáo sự cố kỹ thuật trực tiếp đến Ban Đảm Bảo Chất Lượng (QA/QC).
                </p>
              </div>

              {/* Navigation Pill Tabs */}
              <div className="flex items-center bg-slate-900 border border-slate-800 p-1 rounded-2xl shrink-0">
                <button
                  onClick={() => setActiveTab("orders")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === "orders" 
                      ? "bg-teal-600 text-white shadow-md shadow-teal-950/50" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Package className="w-4 h-4" />
                  <span>Tra Cứu Đơn &amp; Lịch Sử</span>
                </button>
                <button
                  onClick={() => setActiveTab("feedback")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === "feedback" 
                      ? "bg-teal-600 text-white shadow-md shadow-teal-950/50" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Star className="w-4 h-4 text-amber-400" />
                  <span>Đánh Giá CSAT / NPS</span>
                </button>
                <button
                  onClick={() => setActiveTab("incident")}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === "incident" 
                      ? "bg-rose-600 text-white shadow-md shadow-rose-950/50" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Báo Cáo Sự Cố ISO 13485</span>
                </button>
              </div>
            </div>
          </section>

          {/* Main Body */}
          <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
            
            {/* ================= TAB 1: TRA CỨU ĐƠN HÀNG ================= */}
            {activeTab === "orders" && (
              <div className="space-y-6">
                {/* Search Bar */}
                <form onSubmit={handleSearchOrders} className="flex gap-2 max-w-2xl mx-auto">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Tìm kiếm trong đơn hàng của ${customer.name} (theo mã SO, tên kit sinh phẩm)...`}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isLoadingOrders}
                    className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-xl shadow cursor-pointer transition-all"
                  >
                    {isLoadingOrders ? "Đang tìm..." : "Tra Cứu"}
                  </button>
                </form>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Order List */}
              <div className="lg:col-span-5 space-y-3">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider text-left flex items-center justify-between">
                  <span>Đơn Hàng Của Quý Viện ({orders.length})</span>
                  <span className="text-[10px] text-teal-400 font-normal">Bảo mật chuẩn ISO 13485</span>
                </div>

                {orders.length === 0 ? (
                  <div className="p-8 text-center bg-slate-900/60 border border-slate-800 rounded-2xl text-slate-500 text-xs">
                    Chưa có đơn hàng nào được ghi nhận cho tài khoản [{customer?.customer_code}] {customer?.name}. Quý Viện vui lòng liên hệ nhân viên phụ trách ABT nếu cần đối soát.
                  </div>
                ) : (
                  orders.map((ord) => {
                    const isSelected = selectedOrder?.id === ord.id;
                    const items = typeof ord.items === "string" ? JSON.parse(ord.items) : ord.items || [];

                    return (
                      <div
                        key={ord.id}
                        onClick={() => setSelectedOrder(ord)}
                        className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                          isSelected 
                            ? "bg-teal-950/40 border-teal-500/80 shadow-lg shadow-teal-950/30" 
                            : "bg-slate-900/80 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-xs text-teal-400">{ord.order_code}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            ord.delivery_status === "DELIVERED"
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                              : "bg-amber-950 text-amber-300 border border-amber-800"
                          }`}>
                            {ord.delivery_status === "DELIVERED" ? "Đã Giao Thành Công" : "Đang Vận Chuyển"}
                          </span>
                        </div>
                        <div className="font-bold text-sm text-white mt-1.5">{ord.customer_name}</div>
                        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                          <span>Ngày đặt: {new Date(ord.order_date).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                          <span className="font-mono font-bold text-emerald-400">
                            {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(ord.total_amount || 0)}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {items.length} mặt hàng ({items[0]?.product_name || items[0]?.productName || "Sản phẩm sinh phẩm"})
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Order Detail & Timeline */}
              <div className="lg:col-span-7">
                {selectedOrder ? (
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6 text-left shadow-xl">
                    <div className="flex items-start justify-between border-b border-slate-800 pb-4">
                      <div>
                        <div className="text-[11px] text-teal-400 font-mono font-bold">CHI TIẾT ĐƠN HÀNG</div>
                        <h2 className="text-xl font-bold text-white mt-0.5">{selectedOrder.order_code}</h2>
                        <div className="text-xs text-slate-400 mt-1">Đơn vị tiếp nhận: <strong className="text-slate-200">{selectedOrder.customer_name}</strong></div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Tổng Giá Trị</div>
                        <div className="text-lg font-mono font-black text-emerald-400">
                          {new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(selectedOrder.total_amount || 0)}
                        </div>
                      </div>
                    </div>

                    {/* Timeline Stepper 5 Chặng */}
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 text-teal-400" />
                        <span>Hành Trình Giao Hàng &amp; Chuỗi Lạnh</span>
                      </div>
                      <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                        <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-bold">
                          <div className="space-y-1">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500 mx-auto flex items-center justify-center">✓</div>
                            <span className="text-emerald-400">Xác Nhận Đơn</span>
                          </div>
                          <div className="space-y-1">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500 mx-auto flex items-center justify-center">✓</div>
                            <span className="text-emerald-400">Đóng Hộp Lạnh</span>
                          </div>
                          <div className="space-y-1">
                            <div className="w-6 h-6 rounded-full bg-teal-500/20 text-teal-400 border border-teal-500 mx-auto flex items-center justify-center">✓</div>
                            <span className="text-teal-400">Xe Chuyên Dụng</span>
                          </div>
                          <div className="space-y-1">
                            <div className={`w-6 h-6 rounded-full mx-auto flex items-center justify-center ${
                              selectedOrder.delivery_status === "DELIVERED"
                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500"
                                : "bg-slate-800 text-slate-500 border border-slate-700"
                            }`}>
                              {selectedOrder.delivery_status === "DELIVERED" ? "✓" : "4"}
                            </div>
                            <span className={selectedOrder.delivery_status === "DELIVERED" ? "text-emerald-400" : "text-slate-500"}>
                              Đã Bàn Giao
                            </span>
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <Thermometer className="w-3.5 h-3.5 text-cyan-400" />
                            Nhiệt độ bảo quản: <strong className="text-cyan-300">-20°C (Đá khô CO2)</strong>
                          </span>
                          <span>Vận đơn: <strong className="font-mono text-white">{selectedOrder.tracking_code || "ABT-EXP-01"}</strong></span>
                        </div>
                      </div>
                    </div>

                    {/* Products In Order */}
                    <div className="space-y-2">
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Danh Mục Sản Phẩm &amp; Lô Hàng Đã Giao
                      </div>
                      <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-950">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 text-slate-400 text-[10px] uppercase font-bold bg-slate-900/60">
                              <th className="p-2.5">Sản Phẩm</th>
                              <th className="p-2.5 w-24">Số Lô (Lot)</th>
                              <th className="p-2.5 w-20 text-center">SL</th>
                              <th className="p-2.5 w-24 text-right">Đơn Giá</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {(typeof selectedOrder.items === "string" ? JSON.parse(selectedOrder.items) : selectedOrder.items || []).map((it: any, idx: number) => (
                              <tr key={idx}>
                                <td className="p-2.5">
                                  <div className="font-bold text-white">{it.productName || it.product_name}</div>
                                  <div className="text-[10px] font-mono text-slate-400">{it.productCode || it.product_code}</div>
                                </td>
                                <td className="p-2.5 font-mono text-[11px] text-amber-300">
                                  {it.lot_number || it.lotNumber || "—"}
                                </td>
                                <td className="p-2.5 text-center font-bold text-white font-mono">{it.quantity}</td>
                                <td className="p-2.5 text-right font-mono text-slate-300">
                                  {new Intl.NumberFormat("vi-VN").format(it.price || it.unitPrice || 0)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Quick E-Documents & Action Buttons */}
                    <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); alert("Chứng nhận phân tích chất lượng CoA gốc cho Lô hàng này đã được chứng thực số."); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5"
                        >
                          <FileText className="w-3.5 h-3.5 text-teal-400" />
                          <span>Tải Phiếu CoA Gốc</span>
                        </a>
                        <a
                          href="#"
                          onClick={(e) => { e.preventDefault(); alert("Hóa đơn điện tử VAT được phát hành theo thông tư 78 của Tổng cục Thuế."); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Hóa Đơn VAT</span>
                        </a>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFbOrderCode(selectedOrder.order_code);
                            setFbOrg(selectedOrder.customer_name);
                            setActiveTab("feedback");
                          }}
                          className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white flex items-center gap-1 shadow cursor-pointer"
                        >
                          <Star className="w-3.5 h-3.5" />
                          <span>Đánh Giá Đơn Này</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIncOrderCode(selectedOrder.order_code);
                            setIncOrg(selectedOrder.customer_name);
                            const items = typeof selectedOrder.items === "string" ? JSON.parse(selectedOrder.items) : selectedOrder.items || [];
                            if (items.length > 0) {
                              setIncProductCode(items[0].productCode || items[0].product_code || "");
                              setIncProductName(items[0].productName || items[0].product_name || "");
                              setIncLotNumber(items[0].lot_number || items[0].lotNumber || "LOT-HPV-2026-01");
                            }
                            setActiveTab("incident");
                          }}
                          className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-1 shadow cursor-pointer"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>Báo Sự Cố Lô Hàng</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-12 text-center bg-slate-900/60 border border-slate-800 rounded-3xl text-slate-500 text-xs">
                    Vui lòng chọn một đơn hàng từ danh sách bên trái để xem chi tiết.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 2: ĐÁNH GIÁ DỊCH VỤ CSAT / NPS ================= */}
        {activeTab === "feedback" && (
          <div className="max-w-3xl mx-auto space-y-6 text-left">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl">
              <div>
                <div className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span>Khảo Sát Độ Hài Lòng &amp; Chất Lượng Dịch Vụ (Chuẩn ISO 9001:2015)</span>
                </div>
                <h2 className="text-xl font-black text-white mt-1">Góp Ý &amp; Đánh Giá Trải Nghiệm Khách Hàng</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Ý kiến của Quý khách là cơ sở trọng yếu để ABT cải tiến chất lượng chuỗi lạnh và nâng cao năng lực hỗ trợ kỹ thuật xét nghiệm.
                </p>
              </div>

              {fbSuccessMsg && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>{fbSuccessMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmitFeedback} className="space-y-5">
                {/* Thông tin người gửi */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-300 mb-1">Họ tên Bác sĩ / Kỹ thuật viên *</label>
                    <input
                      type="text"
                      required
                      value={fbName}
                      onChange={(e) => setFbName(e.target.value)}
                      placeholder="VD: Bs. Nguyễn Văn An"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-300 mb-1">Số điện thoại liên hệ *</label>
                    <input
                      type="text"
                      required
                      value={fbPhone}
                      onChange={(e) => setFbPhone(e.target.value)}
                      placeholder="0912 345 678"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-300 mb-1">Bệnh viện / Phòng Xét Nghiệm</label>
                    <input
                      type="text"
                      value={fbOrg}
                      onChange={(e) => setFbOrg(e.target.value)}
                      placeholder="VD: Bệnh viện Đa khoa Quốc tế Vinmec"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-300 mb-1">Mã đơn hàng cần đánh giá</label>
                    {orders.length > 0 ? (
                      <select
                        value={fbOrderCode}
                        onChange={(e) => setFbOrderCode(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-amber-300 font-mono"
                      >
                        <option value="">-- Chọn đơn hàng của Quý Viện (hoặc góp ý chung) --</option>
                        {orders.map((o) => (
                          <option key={o.id} value={o.order_code}>
                            {o.order_code} ({new Date(o.order_date).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}) - {o.delivery_status === "DELIVERED" ? "Đã Giao" : "Đang Vận Chuyển"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={fbOrderCode}
                        onChange={(e) => setFbOrderCode(e.target.value)}
                        placeholder="VD: SO-2026-088"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-amber-300 font-mono"
                      />
                    )}
                  </div>
                </div>

                {/* NPS Question */}
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white">
                      Khả năng Quý khách giới thiệu ABT cho đồng nghiệp hoặc phòng xét nghiệm khác? (NPS)
                    </label>
                    <span className="font-mono font-black text-amber-400 text-sm">{npsScore} / 10 Điểm</span>
                  </div>
                  <div className="flex items-center justify-between gap-1 overflow-x-auto py-1">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setNpsScore(num)}
                        className={`w-9 h-9 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                          npsScore === num
                            ? "bg-amber-500 text-black shadow-lg shadow-amber-500/30 scale-105"
                            : "bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 font-medium">
                    <span>0: Hoàn toàn không sẵn lòng</span>
                    <span>10: Rất nhiệt tình giới thiệu</span>
                  </div>
                </div>

                {/* 4 Tiêu chí CSAT (1-5 Sao) */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-white uppercase tracking-wider">
                    Đánh Giá Chi Tiết Theo 4 Trụ Cột Vận Hành (1 - 5 Sao)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* CSAT 1 */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                        <span>1. Chuỗi lạnh &amp; Đóng gói</span>
                        <span className="text-amber-400 font-bold">{csatColdChain} ★</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setCsatColdChain(s)}
                            className={`p-1.5 rounded text-xs cursor-pointer ${s <= csatColdChain ? "text-amber-400" : "text-slate-600"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* CSAT 2 */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                        <span>2. Thời gian &amp; Tốc độ giao</span>
                        <span className="text-amber-400 font-bold">{csatDelivery} ★</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setCsatDelivery(s)}
                            className={`p-1.5 rounded text-xs cursor-pointer ${s <= csatDelivery ? "text-amber-400" : "text-slate-600"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* CSAT 3 */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                        <span>3. Chất lượng &amp; Độ ổn định kit</span>
                        <span className="text-amber-400 font-bold">{csatProduct} ★</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setCsatProduct(s)}
                            className={`p-1.5 rounded text-xs cursor-pointer ${s <= csatProduct ? "text-amber-400" : "text-slate-600"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* CSAT 4 */}
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                      <div className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
                        <span>4. Hỗ trợ kỹ thuật Application</span>
                        <span className="text-amber-400 font-bold">{csatSupport} ★</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setCsatSupport(s)}
                            className={`p-1.5 rounded text-xs cursor-pointer ${s <= csatSupport ? "text-amber-400" : "text-slate-600"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Ý kiến góp ý mở rộng */}
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-300 mb-1">
                    Ý kiến đóng góp cụ thể hoặc đề xuất cải tiến
                  </label>
                  <textarea
                    rows={3}
                    value={fbComments}
                    onChange={(e) => setFbComments(e.target.value)}
                    placeholder="Quý khách có yêu cầu gì thêm về nhiệt độ đá khô, nhãn phụ tiếng Việt, tài liệu hướng dẫn quy trình chạy máy..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingFb}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmittingFb ? "Đang gửi..." : "GỬI ĐÁNH GIÁ CHẤT LƯỢNG"}</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ================= TAB 3: BÁO CÁO SỰ CỐ Y TẾ ISO 13485 ================= */}
        {activeTab === "incident" && (
          <div className="space-y-8 max-w-4xl mx-auto text-left">
            {/* Form báo cáo sự cố mới */}
            <div className="bg-slate-900 border border-rose-900/40 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

              <div className="border-b border-slate-800 pb-4">
                <div className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span>Cảnh Giác Y Tế &amp; Báo Cáo Khiếu Nại Kỹ Thuật (Medical Device Vigilance - ISO 13485)</span>
                </div>
                <h2 className="text-xl font-black text-white mt-1">Phiếu Tiếp Nhận Sự Cố Sinh Phẩm &amp; Thiết Bị Y Tế</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Áp dụng theo hướng dẫn cảnh giác dược/vật tư y tế. Mọi báo cáo sẽ được gắn mã kiểm định tự động và điều tra nguyên nhân gốc rễ (CAPA) trong vòng 2 giờ.
                </p>
              </div>

              {createdIncidentCode && (
                <div className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-600 text-slate-200 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span>HỆ THỐNG ĐÃ TIẾP NHẬN BÁO CÁO THÀNH CÔNG!</span>
                  </div>
                  <div>
                    Mã Ticket Sự Cố Của Quý Khách: <strong className="font-mono text-amber-300 text-sm bg-black/40 px-2 py-0.5 rounded">{createdIncidentCode}</strong>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Ban Quản lý Chất lượng (QA) và Chuyên viên Kỹ thuật sinh học phân tử của ABT đã nhận được thông báo khẩn và sẽ chủ động liên hệ Quý viện để hỗ trợ xử lý mẫu.
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmitIncident} className="space-y-4">
                {/* Người báo cáo */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Họ tên Cán bộ báo cáo *</label>
                    <input
                      type="text"
                      required
                      value={incName}
                      onChange={(e) => setIncName(e.target.value)}
                      placeholder="Bs / KTV Xét nghiệm..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Số điện thoại khẩn cấp *</label>
                    <input
                      type="text"
                      required
                      value={incPhone}
                      onChange={(e) => setIncPhone(e.target.value)}
                      placeholder="0918..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Tên Bệnh Viện / Đơn Vị *</label>
                    <input
                      type="text"
                      required
                      value={incOrg}
                      onChange={(e) => setIncOrg(e.target.value)}
                      placeholder="Bệnh viện Chợ Rẫy..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                    />
                  </div>
                </div>

                {/* Thông tin sản phẩm & Lô */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Mã Sản Phẩm / Tên Kit *</label>
                    <input
                      type="text"
                      required
                      value={incProductCode}
                      onChange={(e) => setIncProductCode(e.target.value)}
                      placeholder="Mã SKU (VD: HI-007.A, SQH-115...) hoặc Tên kit"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-amber-300 mb-1">Số Lô Sản Xuất (LOT NUMBER) *</label>
                    <input
                      type="text"
                      required
                      value={incLotNumber}
                      onChange={(e) => setIncLotNumber(e.target.value)}
                      placeholder="LOT-HPV-2026-01..."
                      className="w-full bg-slate-950 border border-amber-800/80 rounded-lg p-2 text-xs text-amber-300 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Mã Đơn Hàng SO liên quan</label>
                    {orders.length > 0 ? (
                      <select
                        value={incOrderCode}
                        onChange={(e) => setIncOrderCode(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                      >
                        <option value="">-- Chọn đơn hàng liên quan (nếu có) --</option>
                        {orders.map((o) => (
                          <option key={o.id} value={o.order_code}>
                            {o.order_code} ({new Date(o.order_date).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={incOrderCode}
                        onChange={(e) => setIncOrderCode(e.target.value)}
                        placeholder="SO-2026-088..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                      />
                    )}
                  </div>
                </div>

                {/* 1. LOẠI SỰ CỐ NGHI NGỜ (Ô STICK CHỌN & CÀI ĐẶT BỔ SUNG) */}
                <div className="space-y-2.5 p-4 bg-slate-950/80 rounded-2xl border border-slate-800">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="text-xs font-bold uppercase text-rose-300 flex items-center gap-1.5">
                        <CheckSquare className="w-4 h-4 text-rose-400" />
                        <span>Loại sự cố nghi ngờ (*) - Tích chọn các hiện tượng quan sát được:</span>
                      </label>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Quý Viện có thể chọn đồng thời nhiều biểu hiện sự cố hoặc tự bổ sung loại sự cố mới bên dưới.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsAddingCategory(!isAddingCategory)}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-teal-400 border border-teal-500/30 flex items-center gap-1 self-start cursor-pointer transition-all shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Cài đặt / Thêm loại sự cố</span>
                    </button>
                  </div>

                  {/* Form cài đặt bổ sung loại sự cố mới */}
                  {isAddingCategory && (
                    <div className="p-3 bg-slate-900 rounded-xl border border-teal-500/40 flex items-center gap-2">
                      <input
                        type="text"
                        value={newCategoryLabel}
                        onChange={(e) => setNewCategoryLabel(e.target.value)}
                        placeholder="Nhập tên loại sự cố mới cần bổ sung vào danh mục..."
                        className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-400"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomCategory}
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs rounded-lg cursor-pointer"
                      >
                        Thêm vào
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddingCategory(false)}
                        className="p-1.5 text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Lưới các ô stick chọn (Checkboxes) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                    {incidentCategories.map((cat) => {
                      const isChecked = selectedCategories.includes(cat.id);
                      return (
                        <div
                          key={cat.id}
                          onClick={() => toggleCategory(cat.id)}
                          className={`p-2.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition-all select-none ${
                            isChecked
                              ? "bg-rose-950/40 border-rose-500/70 text-rose-200 shadow-xs"
                              : "bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700"
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-rose-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500" />
                            )}
                          </div>
                          <div className="text-xs font-medium leading-tight">
                            <span className="mr-1">{cat.icon || "📌"}</span>
                            {cat.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mức độ & Ảnh hưởng lâm sàng */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Mức độ nghiêm trọng *</label>
                    <select
                      value={incSeverity}
                      onChange={(e) => setIncSeverity(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-rose-300 font-bold"
                    >
                      <option value="CRITICAL">Cấp 1 - Khẩn Cấp (Nguy cơ sai lệch kết quả BN)</option>
                      <option value="HIGH">Cấp 2 - Cao (Gián đoạn chạy mẫu trong ngày)</option>
                      <option value="MEDIUM">Cấp 3 - Trung Bình (Nghi ngờ chất lượng)</option>
                      <option value="LOW">Cấp 4 - Nhẹ (Hình thức bao bì / Tem nhãn)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Ảnh hưởng lâm sàng *</label>
                    <select
                      value={incPatientImpact}
                      onChange={(e) => setIncPatientImpact(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                    >
                      <option value="PATIENT_SAMPLE_RETESTED">Đã lưu trữ mẫu, chờ hóa chất chạy lại</option>
                      <option value="RESULT_HOLD">Đang tạm giữ kết quả chưa trả Bệnh nhân</option>
                      <option value="DETECTED_IN_QC">Phát hiện ở mẫu chứng nội / QC định kỳ</option>
                      <option value="NO_IMPACT">Chưa đưa vào xét nghiệm mẫu thật</option>
                    </select>
                  </div>
                </div>

                {/* Máy xét nghiệm & SL test */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Model máy PCR / Hệ thống phân tích</label>
                    <input
                      type="text"
                      value={incInstrument}
                      onChange={(e) => setIncInstrument(e.target.value)}
                      placeholder="Bio-Rad CFX96, ABI 7500, LineGene 9600..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Số lượng test (phản ứng) bị ảnh hưởng</label>
                    <input
                      type="number"
                      min="1"
                      value={incAffectedTests}
                      onChange={(e) => setIncAffectedTests(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                {/* 2. THÔNG TIN PHỤC VỤ XÁC ĐỊNH NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS - RCA) */}
                <div className="space-y-4 p-4.5 bg-gradient-to-b from-slate-950 to-slate-900/90 rounded-2xl border border-indigo-900/40 shadow-inner">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div className="space-y-0.5 text-left">
                      <div className="text-xs font-bold uppercase text-indigo-300 flex items-center gap-1.5">
                        <Microscope className="w-4 h-4 text-indigo-400" />
                        <span>Thông Tin Kỹ Thuật Phục Vụ Xác Định Nguyên Nhân (CAPA / Root Cause)</span>
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Cung cấp dữ liệu thực tế tại phòng Lab giúp Chuyên viên Kỹ thuật ABT tái lập thí nghiệm và tìm chính xác nguyên nhân gốc rễ.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsAddingRcaField(!isAddingRcaField)}
                      className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/50 flex items-center gap-1 self-start cursor-pointer transition-all shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Cài đặt / Bổ sung trường nguyên nhân</span>
                    </button>
                  </div>

                  {/* Form thêm trường chẩn đoán nguyên nhân tùy biến */}
                  {isAddingRcaField && (
                    <div className="p-3 bg-slate-900 rounded-xl border border-indigo-500/50 flex items-center gap-2">
                      <input
                        type="text"
                        value={newRcaFieldLabel}
                        onChange={(e) => setNewRcaFieldLabel(e.target.value)}
                        placeholder="Nhập tên trường thông tin cần bổ sung (VD: Nồng độ NanoDrop, Hãng ống tube, Ca trực...)"
                        className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomRcaField}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg cursor-pointer"
                      >
                        Thêm trường
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddingRcaField(false)}
                        className="p-1.5 text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Các ô thông tin chẩn đoán tiêu chuẩn */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
                    {/* Trường 1: Điều kiện bảo quản thực tế */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        1. Điều kiện tủ bảo quản tại Lab
                      </label>
                      <input
                        type="text"
                        value={rcaStorageTemp}
                        onChange={(e) => setRcaStorageTemp(e.target.value)}
                        placeholder="VD: Tủ âm -20°C (nhiệt độ thực đo -19°C), không mất điện..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      />
                    </div>

                    {/* Trường 2: Tình trạng chuỗi lạnh lúc nhận hàng */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        2. Tình trạng chuỗi lạnh khi nhận
                      </label>
                      <select
                        value={rcaColdChainArrival}
                        onChange={(e) => setRcaColdChainArrival(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-medium"
                      >
                        <option value="Đá khô/gel còn nguyên vẹn lúc nhận">Đá khô / Đá gel còn nguyên vẹn, thùng kín</option>
                        <option value="Đá gel tan một phần, nhiệt độ mát">Đá gel tan một phần, còn mát</option>
                        <option value="Rã đông hoàn toàn, nhiệt độ phòng">Rã đông hoàn toàn, nhiệt độ ấm</option>
                        <option value="Không kiểm tra nhiệt độ lúc nhận">Chưa kiểm tra nhiệt độ lúc nhận</option>
                      </select>
                    </div>

                    {/* Trường 3: Quy trình & Kit tách chiết */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        3. Phương pháp / Kit tách chiết mẫu
                      </label>
                      <input
                        type="text"
                        value={rcaExtractionMethod}
                        onChange={(e) => setRcaExtractionMethod(e.target.value)}
                        placeholder="VD: Tách chiết tự động hạt từ KingFisher / Lô MAG-2026..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      />
                    </div>

                    {/* Trường 4: Loại mẫu bệnh phẩm */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        4. Loại mẫu bệnh phẩm & bảo quản mẫu
                      </label>
                      <select
                        value={rcaSampleType}
                        onChange={(e) => setRcaSampleType(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-medium"
                      >
                        <option value="Dịch phết tỵ hầu / Họng">Dịch phết tỵ hầu / Họng (VTM/UTM)</option>
                        <option value="Huyết thanh / Huyết tương">Huyết thanh / Huyết tương</option>
                        <option value="Máu toàn phần EDTA">Máu toàn phần EDTA</option>
                        <option value="Mẫu đờm / Rửa phế quản (BAL)">Mẫu đờm / Rửa phế quản (BAL)</option>
                        <option value="Mẫu mô / Sinh thiết paraffin (FFPE)">Mẫu mô / Sinh thiết paraffin (FFPE)</option>
                        <option value="Nước tiểu / Dịch cơ thể khác">Nước tiểu / Dịch cơ thể khác</option>
                        <option value="Khác">Khác (mô tả trong ghi chú)</option>
                      </select>
                    </div>

                    {/* Trường 5: Kết quả đối chứng âm & dương */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        5. Kết quả chứng đối chứng (NC &amp; PC)
                      </label>
                      <input
                        type="text"
                        value={rcaNcPcResult}
                        onChange={(e) => setRcaNcPcResult(e.target.value)}
                        placeholder="VD: NC âm tính (No Ct), PC lên tốt ở Ct 22-24..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      />
                    </div>

                    {/* Trường 6: Chứng nội kiểm IC */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        6. Chứng nội kiểm tra (Internal Control - IC)
                      </label>
                      <select
                        value={rcaInternalControl}
                        onChange={(e) => setRcaInternalControl(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-medium"
                      >
                        <option value="PASS">Đạt chuẩn (Ct IC trong dải tiêu chuẩn 24 - 30)</option>
                        <option value="FAIL_HIGH">Không đạt: Ct IC quá cao (&gt; 35 chu kỳ)</option>
                        <option value="FAIL_NO_CT">Không đạt: Hoàn toàn không lên tín hiệu IC (No Ct)</option>
                        <option value="NOT_APPLICABLE">Không sử dụng / Không áp dụng</option>
                      </select>
                    </div>

                    {/* Trường 7: Tần suất xuất hiện */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        7. Tần suất &amp; Phạm vi phân bố lỗi
                      </label>
                      <select
                        value={rcaFrequency}
                        onChange={(e) => setRcaFrequency(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-medium"
                      >
                        <option value="SINGLE_WELL">Chỉ xảy ra ở 1 giếng / mẫu cá biệt</option>
                        <option value="MULTI_WELL">Nhiều giếng rải rác trên đĩa</option>
                        <option value="FULL_PLATE">Toàn bộ đĩa run (Full 96 giếng hỏng)</option>
                        <option value="MULTIPLE_RUNS">Lặp lại ở nhiều mẻ run khác nhau</option>
                      </select>
                    </div>

                    {/* Trường 8: Thử nghiệm đối chứng chéo */}
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-300 mb-1">
                        8. Thử nghiệm đối chứng chéo (Cross-check)
                      </label>
                      <input
                        type="text"
                        value={rcaCrossCheck}
                        onChange={(e) => setRcaCrossCheck(e.target.value)}
                        placeholder="VD: Đã chạy song song với kit lô cũ kết quả chuẩn, nghi do hóa chất lô mới..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                      />
                    </div>
                  </div>

                  {/* Hiển thị các trường thông tin tùy chỉnh do người dùng thêm */}
                  {customRcaFields.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-2 text-left">
                      <span className="text-[10px] font-bold uppercase text-indigo-400 block">
                        Các trường thông tin chẩn đoán bổ sung tùy chỉnh ({customRcaFields.length}):
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {customRcaFields.map((field) => (
                          <div key={field.id} className="p-2.5 bg-slate-950 rounded-xl border border-indigo-900/50 flex items-center gap-2">
                            <div className="flex-1">
                              <label className="block text-[10px] font-bold text-indigo-300 truncate">
                                {field.label}
                              </label>
                              <input
                                type="text"
                                value={field.value}
                                onChange={(e) => handleUpdateCustomRcaField(field.id, e.target.value)}
                                placeholder={`Nhập dữ liệu cho ${field.label}...`}
                                className="w-full bg-transparent text-xs text-white placeholder-slate-600 focus:outline-none mt-0.5"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteCustomRcaField(field.id)}
                              className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                              title="Xóa trường này"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Mô tả chi tiết */}
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Mô tả hiện tượng sự cố chi tiết *</label>
                  <textarea
                    rows={3}
                    required
                    value={incDescription}
                    onChange={(e) => setIncDescription(e.target.value)}
                    placeholder="Mô tả cụ thể: Đường cong Ct khuếch đại ở giếng nào, nhiệt độ đọc được trên nhiệt kế thùng hàng, mã lỗi trên màn hình máy..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-white placeholder-slate-600"
                  />
                </div>

                {/* 3. ĐÍNH KÈM HÌNH ẢNH, VIDEO & FILE DỮ LIỆU CHẨN ĐOÁN (ISO 13485) */}
                <div className="space-y-3 p-4 bg-slate-950/80 rounded-2xl border border-slate-800">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="text-left">
                      <label className="text-xs font-bold uppercase text-teal-300 flex items-center gap-1.5">
                        <Paperclip className="w-4 h-4 text-teal-400" />
                        <span>Đính kèm Bằng Chứng Kỹ Thuật (Hình ảnh, Video, File Dữ Liệu PCR)</span>
                      </label>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Hỗ trợ ảnh đường cong Ct (.png, .jpg), video máy báo lỗi (.mp4, .mov), file kết quả PCR/COA (.pcrd, .eds, .xlsx, .csv, .pdf)
                      </p>
                    </div>
                    {incAttachments.length > 0 && (
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30 self-start">
                        {incAttachments.length} tệp đã chọn
                      </span>
                    )}
                  </div>

                  {/* Vùng kéo thả & Chọn file */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(true);
                    }}
                    onDragLeave={() => setIsDraggingOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDraggingOver(false);
                      if (e.dataTransfer.files) {
                        handleUploadFiles(e.dataTransfer.files);
                      }
                    }}
                    className={`relative border-2 border-dashed rounded-2xl p-5 text-center transition-all cursor-pointer ${
                      isDraggingOver
                        ? "border-teal-400 bg-teal-500/10 scale-[1.01]"
                        : "border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/60"
                    }`}
                  >
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.ppt,.pptx,.txt,.pcrd,.eds,.zip,.rar,.7z"
                      onChange={(e) => {
                        if (e.target.files) handleUploadFiles(e.target.files);
                        e.target.value = "";
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      disabled={isUploadingFiles}
                    />

                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                        {isUploadingFiles ? (
                          <div className="w-6 h-6 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <UploadCloud className="w-6 h-6" />
                        )}
                      </div>

                      <div>
                        <div className="text-xs font-bold text-slate-200">
                          {isUploadingFiles ? (
                            <span className="text-teal-400">Đang tải và xử lý tệp lên máy chủ...</span>
                          ) : (
                            <span>
                              Kéo thả tệp vào đây hoặc <span className="text-teal-400 underline underline-offset-2">chọn từ thiết bị</span>
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Hỗ trợ: Hình ảnh (JPG, PNG, WebP) • Video (MP4, MOV, WebM) • Dữ liệu máy (PCRD, EDS, Excel, CSV, PDF)
                        </p>
                      </div>

                      {/* Gợi ý các loại tệp */}
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-[10px]">
                        <span className="px-2 py-0.5 rounded-md bg-slate-800/80 text-emerald-400 border border-emerald-900/40 flex items-center gap-1">
                          <ImageIcon className="w-3 h-3" /> Ảnh biểu đồ Ct
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-slate-800/80 text-indigo-400 border border-indigo-900/40 flex items-center gap-1">
                          <Film className="w-3 h-3" /> Clip máy báo lỗi
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-slate-800/80 text-amber-400 border border-amber-900/40 flex items-center gap-1">
                          <FileSpreadsheet className="w-3 h-3" /> File kết quả PCR/Excel
                        </span>
                      </div>
                    </div>
                  </div>

                  {uploadError && (
                    <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-800 text-xs text-rose-300">
                      {uploadError}
                    </div>
                  )}

                  {/* Danh sách các tệp đã đính kèm */}
                  {incAttachments.length > 0 && (
                    <div className="space-y-2 pt-2 text-left">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">
                        Danh sách tệp đính kèm ({incAttachments.length}):
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {incAttachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-start gap-2.5 group hover:border-slate-700 transition-all relative overflow-hidden"
                          >
                            {/* Thumbnail / Icon preview */}
                            <div className="w-12 h-12 rounded-lg bg-slate-950 border border-slate-800 shrink-0 overflow-hidden flex items-center justify-center relative">
                              {att.category === "image" ? (
                                <img
                                  src={att.url}
                                  alt={att.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : att.category === "video" ? (
                                <div className="w-full h-full bg-indigo-950/40 flex items-center justify-center text-indigo-400">
                                  <Film className="w-5 h-5" />
                                </div>
                              ) : att.name.endsWith(".xlsx") || att.name.endsWith(".xls") || att.name.endsWith(".csv") ? (
                                <div className="w-full h-full bg-emerald-950/40 flex items-center justify-center text-emerald-400">
                                  <FileSpreadsheet className="w-5 h-5" />
                                </div>
                              ) : (
                                <div className="w-full h-full bg-teal-950/40 flex items-center justify-center text-teal-400">
                                  <FileText className="w-5 h-5" />
                                </div>
                              )}
                            </div>

                            {/* Thông tin tệp */}
                            <div className="flex-1 min-w-0 pr-6">
                              <p className="text-xs font-bold text-white truncate" title={att.name}>
                                {att.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400">
                                <span className={`px-1.5 py-0.2 rounded uppercase font-bold text-[9px] ${
                                  att.category === "image"
                                    ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                    : att.category === "video"
                                    ? "bg-indigo-950 text-indigo-300 border border-indigo-800"
                                    : "bg-teal-950 text-teal-300 border border-teal-800"
                                }`}>
                                  {att.category === "image" ? "Ảnh" : att.category === "video" ? "Video" : "Tài liệu"}
                                </span>
                                <span>{formatFileSize(att.size)}</span>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10px] text-teal-400 hover:text-teal-300 flex items-center gap-0.5"
                                >
                                  <Eye className="w-3 h-3" /> Xem thử
                                </a>
                              </div>
                            </div>

                            {/* Nút xóa */}
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(idx)}
                              className="absolute top-2 right-2 p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer rounded-md hover:bg-slate-800"
                              title="Gỡ bỏ tệp này"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
                  <Info className="w-4 h-4 text-teal-400 shrink-0" />
                  <span>
                    Ngay sau khi gửi, hệ thống tự động khóa cảnh báo tạm thời đối với số Lô này trong hệ thống QA để ngăn chặn rủi ro cho các khách hàng khác.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingInc}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>{isSubmittingInc ? "Đang gửi báo cáo khẩn cấp..." : "GỬI BÁO CÁO SỰ CỐ Y TẾ (KHẨN CẤP)"}</span>
                </button>
              </form>
            </div>

            {/* Tra cứu tiến trình Ticket sự cố đã gửi */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-teal-400" />
                    Tra Cứu Tiến Trình Xử Lý Ticket Sự Cố
                  </h3>
                  <p className="text-[11px] text-slate-400">Kiểm tra kết luận điều tra và hành động khắc phục CAPA từ ABT</p>
                </div>
              </div>

              <form onSubmit={handleSearchTicket} className="flex gap-2">
                <input
                  type="text"
                  value={ticketSearchCode}
                  onChange={(e) => setTicketSearchCode(e.target.value)}
                  placeholder="Nhập mã Ticket sự cố (VD: INC-2026-001)..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-amber-300 font-mono"
                />
                <button
                  type="submit"
                  disabled={isSearchingTicket}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl cursor-pointer"
                >
                  {isSearchingTicket ? "Đang tra..." : "Kiểm Tra"}
                </button>
              </form>

              {ticketError && (
                <div className="text-xs text-rose-400 p-2">{ticketError}</div>
              )}

              {trackedIncident && (
                <div className="p-5 bg-slate-950 rounded-2xl border border-slate-800 space-y-4 text-left">
                  {/* Header & Status */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-amber-400" />
                        <span className="font-mono font-bold text-base text-amber-300">{trackedIncident.incident_code}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Bệnh viện: <strong className="text-slate-200">{trackedIncident.organization || trackedIncident.customer_name}</strong>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider font-mono border ${
                        trackedIncident.status === "RESOLVED"
                          ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                          : trackedIncident.status === "CLOSED_NOT_ISSUE" || trackedIncident.resolution_status === "Not an issue"
                          ? "bg-blue-950 text-blue-300 border-blue-800"
                          : trackedIncident.status === "INVESTIGATING"
                          ? "bg-amber-950 text-amber-300 border-amber-800"
                          : "bg-teal-950 text-teal-300 border-teal-800"
                      }`}>
                        {trackedIncident.status === "RESOLVED"
                          ? "ĐÃ XỬ LÝ XONG (BAN HÀNH CAPA)"
                          : trackedIncident.status === "CLOSED_NOT_ISSUE" || trackedIncident.resolution_status === "Not an issue"
                          ? "KẾT LUẬN: KHÔNG PHẢI SỰ CỐ"
                          : trackedIncident.status === "INVESTIGATING"
                          ? "ĐANG ĐIỀU TRA KỸ THUẬT"
                          : "ĐÃ TIẾP NHẬN YÊU CẦU"}
                      </span>
                    </div>
                  </div>

                  {/* 3-Stage Progress Timeline */}
                  <div className="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800/80 space-y-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                      Tiến Trình Xử Lý 2 Chiều Chuẩn ISO 13485:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {/* Stage 1 */}
                      <div className="p-2.5 rounded-lg bg-slate-950/80 border border-teal-800/50 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                        <div className="text-[11px] leading-tight">
                          <strong className="text-teal-300 block">1. Tiếp nhận sự cố</strong>
                          <span className="text-slate-400 text-[10px]">
                            {new Date(trackedIncident.created_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
                          </span>
                        </div>
                      </div>

                      {/* Stage 2 */}
                      <div className={`p-2.5 rounded-lg bg-slate-950/80 border flex items-start gap-2 ${
                        trackedIncident.status === "INVESTIGATING" || trackedIncident.status === "RESOLVED" || trackedIncident.status === "CLOSED_NOT_ISSUE"
                          ? "border-amber-700/60"
                          : "border-slate-800 opacity-60"
                      }`}>
                        {trackedIncident.status === "RESOLVED" || trackedIncident.status === "CLOSED_NOT_ISSUE" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : trackedIncident.status === "INVESTIGATING" ? (
                          <Microscope className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
                        ) : (
                          <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        )}
                        <div className="text-[11px] leading-tight">
                          <strong className={trackedIncident.status === "INVESTIGATING" ? "text-amber-300 block" : "text-slate-300 block"}>
                            2. Thẩm định &amp; Khảo sát
                          </strong>
                          <span className="text-slate-400 text-[10px]">
                            Phụ trách: {trackedIncident.handled_by || "Kỹ thuật & App ABT"}
                          </span>
                        </div>
                      </div>

                      {/* Stage 3 */}
                      <div className={`p-2.5 rounded-lg bg-slate-950/80 border flex items-start gap-2 ${
                        trackedIncident.status === "RESOLVED"
                          ? "border-emerald-700/70"
                          : trackedIncident.status === "CLOSED_NOT_ISSUE"
                          ? "border-blue-700/70"
                          : "border-slate-800 opacity-50"
                      }`}>
                        {trackedIncident.status === "RESOLVED" ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        ) : trackedIncident.status === "CLOSED_NOT_ISSUE" ? (
                          <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                        ) : (
                          <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        )}
                        <div className="text-[11px] leading-tight">
                          <strong className={trackedIncident.status === "RESOLVED" ? "text-emerald-300 block" : trackedIncident.status === "CLOSED_NOT_ISSUE" ? "text-blue-300 block" : "text-slate-400 block"}>
                            3. Kết luận &amp; CAPA
                          </strong>
                          <span className="text-slate-400 text-[10px]">
                            {trackedIncident.updated_at ? new Date(trackedIncident.updated_at).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "Đang tiến hành"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Incident Product Info */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs p-3 bg-slate-900/40 rounded-xl border border-slate-800/80">
                    <div>
                      <span className="text-slate-500 text-[10px] block">Sản phẩm:</span>
                      <strong className="text-white text-[11px] line-clamp-1">{trackedIncident.product_name}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Số Lô (Lot):</span>
                      <strong className="font-mono text-amber-300 text-[11px]">{trackedIncident.lot_number || "Chưa rõ"}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Mức độ ưu tiên:</span>
                      <strong className="text-rose-400 text-[11px]">{trackedIncident.severity}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Người xử lý:</span>
                      <strong className="text-teal-300 text-[11px]">{trackedIncident.handled_by || "Chuyên viên App"}</strong>
                    </div>
                  </div>

                  {/* Customer Description */}
                  <div className="text-xs text-slate-300 p-3 bg-slate-900 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">Hiện tượng sự cố Quý Viện ghi nhận:</span>
                    <p className="italic text-slate-200">"{trackedIncident.description}"</p>
                  </div>

                  {/* Attachments */}
                  {(() => {
                    let attList: any[] = [];
                    try {
                      if (Array.isArray(trackedIncident.attachments)) {
                        attList = trackedIncident.attachments;
                      } else if (typeof trackedIncident.attachments === "string" && trackedIncident.attachments.trim().startsWith("[")) {
                        attList = JSON.parse(trackedIncident.attachments);
                      }
                    } catch (e) {
                      attList = [];
                    }

                    if (!attList || attList.length === 0) return null;

                    return (
                      <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2 text-left">
                        <span className="text-[10px] text-teal-400 uppercase font-bold flex items-center gap-1.5">
                          <Paperclip className="w-3.5 h-3.5" />
                          Hồ sơ &amp; Bằng chứng đính kèm ({attList.length}):
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {attList.map((file: any, fIdx: number) => {
                            const isImg = file.category === "image" || (file.type && file.type.startsWith("image/")) || /\.(png|jpe?g|webp|gif)$/i.test(file.name || file.url || "");
                            const isVid = file.category === "video" || (file.type && file.type.startsWith("video/")) || /\.(mp4|mov|webm|avi)$/i.test(file.name || file.url || "");

                            return (
                              <div key={fIdx} className="p-2 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
                                {isImg && (
                                  <a href={file.url} target="_blank" rel="noreferrer" className="block w-full h-24 rounded overflow-hidden bg-slate-900 group">
                                    <img src={file.url} alt={file.name} className="w-full h-full object-cover group-hover:scale-105 transition-all" />
                                  </a>
                                )}
                                {isVid && (
                                  <video src={file.url} controls className="w-full h-24 rounded bg-black object-cover" />
                                )}
                                <div className="flex items-center justify-between gap-1 text-[11px]">
                                  <span className="truncate text-slate-200 font-medium" title={file.name}>
                                    {file.name}
                                  </span>
                                  <a
                                    href={file.url}
                                    download={file.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300"
                                    title="Tải về"
                                  >
                                    <Download className="w-3 h-3" />
                                  </a>
                                </div>
                                {file.size && (
                                  <span className="text-[9px] text-slate-500">{formatFileSize(file.size)}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 2-WAY FEEDBACK: NOT AN ISSUE REASON */}
                  {(trackedIncident.status === "CLOSED_NOT_ISSUE" || trackedIncident.resolution_status === "Not an issue" || trackedIncident.not_real_issue_reason) && (
                    <div className="text-xs text-blue-300 p-3 bg-blue-950/40 rounded-xl border border-blue-800/60 space-y-1">
                      <span className="text-[10px] text-blue-400 uppercase font-black flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-blue-400" />
                        Kết luận kỹ thuật: Không phải lỗi do sinh phẩm
                      </span>
                      <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">
                        {trackedIncident.not_real_issue_reason || "Đội ngũ kỹ thuật đã thẩm định đối chứng trên lô mẫu lưu và xác định lỗi phát sinh từ thao tác vận hành hoặc điều kiện bảo quản tại chỗ của thiết bị."}
                      </p>
                    </div>
                  )}

                  {/* 2-WAY FEEDBACK: ROOT CAUSE CONCLUSION */}
                  {trackedIncident.root_cause_conclusion && (
                    <div className="text-xs text-amber-200 p-3 bg-amber-950/30 rounded-xl border border-amber-800/50 space-y-1">
                      <span className="text-[10px] text-amber-400 uppercase font-bold flex items-center gap-1">
                        <Microscope className="w-3.5 h-3.5" />
                        Kết luận nguyên nhân gốc rễ (Root Cause Analysis):
                      </span>
                      <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{trackedIncident.root_cause_conclusion}</p>
                    </div>
                  )}

                  {/* 2-WAY FEEDBACK: FINAL CUSTOMER SOLUTION */}
                  {trackedIncident.final_customer_solution && (
                    <div className="text-xs text-teal-200 p-3 bg-teal-950/40 rounded-xl border border-teal-800/60 space-y-1">
                      <span className="text-[10px] text-teal-400 uppercase font-bold block">Phương án giải quyết dành cho Quý Viện:</span>
                      <p className="text-slate-200 leading-relaxed font-semibold whitespace-pre-wrap">{trackedIncident.final_customer_solution}</p>
                    </div>
                  )}

                  {/* 2-WAY FEEDBACK: CAPA ACTION */}
                  {(trackedIncident.capa_action || trackedIncident.corrective_actions || trackedIncident.preventive_actions) && (
                    <div className="text-xs text-emerald-300 p-3.5 bg-emerald-950/40 rounded-xl border border-emerald-800/60 space-y-2">
                      <div className="flex items-center gap-1.5 text-emerald-400 uppercase font-black text-[11px]">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Hành động khắc phục &amp; phòng ngừa (CAPA - ISO 13485):
                      </div>
                      
                      {trackedIncident.corrective_actions && (
                        <div>
                          <strong className="text-emerald-400 text-[10px] uppercase block">Biện pháp khắc phục (Corrective Action):</strong>
                          <p className="text-slate-200 mt-0.5 whitespace-pre-wrap">{trackedIncident.corrective_actions}</p>
                        </div>
                      )}

                      {trackedIncident.preventive_actions && (
                        <div>
                          <strong className="text-emerald-400 text-[10px] uppercase block">Biện pháp phòng ngừa (Preventive Action):</strong>
                          <p className="text-slate-200 mt-0.5 whitespace-pre-wrap">{trackedIncident.preventive_actions}</p>
                        </div>
                      )}

                      {!trackedIncident.corrective_actions && !trackedIncident.preventive_actions && trackedIncident.capa_action && (
                        <p className="text-slate-200 whitespace-pre-wrap">{trackedIncident.capa_action}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      </main>
        </>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 px-6 py-4 text-center text-xs text-slate-500">
        <p>© 2026 ABT Co., Ltd • Hệ Thống Chăm Sóc Đối Tác Y Tế &amp; Cảnh Giác Thiết Bị Sinh Học Chuẩn ISO 13485</p>
      </footer>
    </div>
  );
};

export default CustomerPortalView;
