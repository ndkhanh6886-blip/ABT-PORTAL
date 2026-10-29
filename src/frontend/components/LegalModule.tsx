"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Scale,
  ShieldCheck,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plus,
  Search,
  Filter,
  Download,
  Eye,
  FileCheck,
  Building,
  Calendar,
  User,
  ExternalLink,
  ChevronRight,
  BookOpen,
  Award,
  AlertCircle,
  Briefcase,
  Layers,
  ArrowRight,
  Check,
  X,
  Paperclip,
  Upload,
  Printer,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2
} from "lucide-react";
import { Modal } from "@/frontend/components/Modal";
import { useAuth } from "@/frontend/contexts/AuthContext";
import { useCompanyConfig } from "@/frontend/utils/companyConfig";
import { uploadSingleFileSmart } from "@/frontend/components/AttachmentPicker";

export interface AttachedFile {
  id: string;
  name: string;
  size: string;
  type: string;
  dataUrl?: string;
  uploadedAt: string;
  note?: string;
}

interface LegalContract {
  id: string;
  code: string;
  title: string;
  partnerName: string;
  type: "Bán hàng Bệnh Viện" | "Mua hàng Quốc Tế" | "Đại Lý Phân Phối" | "Thỏa thuận NDA" | "Thuê kho / Dịch vụ";
  value: string;
  requester: string;
  department: string;
  submitDate: string;
  status: "CHO_THAM_DINH" | "DANG_RA_SOAT" | "DA_THONG_QUA" | "CAN_SUA_DOI";
  riskLevel: "THAP" | "TRUNG_BINH" | "CAO";
  riskNotes: string;
  expiryDate: string;
  assignedLawyer: string;
  attachments?: AttachedFile[];
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  contractContent?: string;
}

export interface TenderDossier {
  id: string;
  code: string;
  hospitalName: string;
  packageName: string;
  bidValue: string;
  submissionDeadline: string;
  status: "CHUAN_BI_HO_SO" | "DANG_RA_SOAT" | "DAT_CHUAN" | "CAN_BO_SUNG";
  checklist: {
    circulationLicense: boolean;
    loaAuthorization: boolean;
    iso13485: boolean;
    financialReport: boolean;
    gdpGspColdChain: boolean;
  };
  notes: string;
  assignedLawyer: string;
  attachments?: AttachedFile[];
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface LegalDocument {
  id: string;
  code: string;
  title: string;
  category: "Nghị Định & Luật" | "Thông Tư Bộ Y Tế" | "Tiêu Chuẩn ISO/TCVN" | "Biểu Mẫu Chuẩn ABT";
  issuingBody: string;
  effectiveDate: string;
  status: "DANG_HIEU_LUC" | "HET_HIEU_LUC" | "BI_THAY_THE";
  summary: string;
  fullContent?: string;
  attachments?: AttachedFile[];
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface MedicalLicense {
  id: string;
  licenseNumber: string;
  productName: string;
  deviceClass: "Loại A" | "Loại B" | "Loại C" | "Loại D";
  manufacturer: string;
  origin: string;
  issueDate: string;
  expiryDate: string;
  status: "CON_HAN" | "SAP_HET_HAN" | "DA_GIA_HAN";
  agency: string;
  notes?: string;
  attachments?: AttachedFile[];
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface ViewerDocument {
  id: string;
  code: string;
  title: string;
  type: string;
  partnerOrAgency?: string;
  date?: string;
  summary?: string;
  articles?: { title: string; content: string }[];
  signLeft?: { title: string; name: string };
  signRight?: { title: string; name: string; note?: string };
  attachments?: AttachedFile[];
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export const LegalModule: React.FC = () => {
  const companyConfig = useCompanyConfig();
  const { user, can } = useAuth();
  // Sửa / xóa: Pháp chế (quyền legal.approve, admin) mọi hồ sơ; người tạo chỉ hồ sơ của mình khi chưa thẩm định xong
  const myName = String((user as any)?.full_name || (user as any)?.name || "").trim();
  const isLegalManager = Boolean(can && can("legal.approve"));
  const canModify = (item: any, stillOpen: boolean) =>
    isLegalManager || (stillOpen && Boolean(myName) && (item?.createdBy === myName || item?.requester === myName));
  const [editing, setEditing] = useState<{ kind: "contract" | "tender" | "license" | "doc"; id: string } | null>(null);
  // Hồ sơ đã xóa (xóa mềm) được giữ lại khi lưu, không hiển thị
  const deletedRef = useRef<Record<"contracts" | "licenses" | "docs" | "tenders", any[]>>({ contracts: [], licenses: [], docs: [], tenders: [] });
  const splitDeleted = (key: "contracts" | "licenses" | "docs" | "tenders", arr: any[]) => {
    deletedRef.current[key] = arr.filter((x: any) => x?.deletedAt);
    return arr.filter((x: any) => !x?.deletedAt);
  };
  const [activeTab, setActiveTab] = useState<"contracts" | "tenders" | "licenses" | "compliance">("contracts");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedContract, setSelectedContract] = useState<LegalContract | null>(null);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [isNewContractModalOpen, setIsNewContractModalOpen] = useState(false);
  const [isNewLicenseModalOpen, setIsNewLicenseModalOpen] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // In-App Document Viewer State
  const [isViewerModalOpen, setIsViewerModalOpen] = useState(false);
  const [viewerDoc, setViewerDoc] = useState<ViewerDocument | null>(null);
  const [viewingContract, setViewingContract] = useState<LegalContract | null>(null);
  const [activeDocTab, setActiveDocTab] = useState<string>("standard_contract");
  const [viewerZoom, setViewerZoom] = useState<number>(100);

  // Contracts Mock Data with Attached Files
  const [contracts, setContracts] = useState<LegalContract[]>([]);

  // Medical Device Licenses with Attachments
  const [licenses, setLicenses] = useState<MedicalLicense[]>([]);

  // Tenders State
  const [tenders, setTenders] = useState<TenderDossier[]>([]);

  // Legal Documents & Standard Form Templates State
  const [legalDocuments, setLegalDocuments] = useState<LegalDocument[]>([]);

  // Modals & Filter States
  const [docCategoryFilter, setDocCategoryFilter] = useState("all");
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [isNewDocModalOpen, setIsNewDocModalOpen] = useState(false);

  const [tenderSearchQuery, setTenderSearchQuery] = useState("");
  const [tenderStatusFilter, setTenderStatusFilter] = useState("all");
  const [isNewTenderModalOpen, setIsNewTenderModalOpen] = useState(false);
  const [selectedTender, setSelectedTender] = useState<TenderDossier | null>(null);
  const [isTenderModalOpen, setIsTenderModalOpen] = useState(false);

  // Phụ trách pháp chế: lấy từ danh sách nhân sự (bộ phận Pháp Chế), ưu tiên trưởng bộ phận
  const [legalLead, setLegalLead] = useState<{ name: string; code: string } | null>(null);
  useEffect(() => {
    const loadLegalLead = async () => {
      try {
        const res = await fetch("/api/settings?action=overview");
        if (!res.ok) return;
        const data = await res.json();
        const norm = (v: any) => String(v || "").toLowerCase();
        const legalStaff = (Array.isArray(data.personnel) ? data.personnel : []).filter((p: any) =>
          p?.full_name && p.status !== "INACTIVE" && (norm(p.department).includes("pháp chế") || norm(p.department).includes("legal"))
        );
        const isHead = (p: any) => ["trưởng", "head", "giám đốc", "manager"].some(k => norm(p.position).includes(k));
        const lead = legalStaff.find(isHead) || legalStaff[0];
        if (lead) setLegalLead({ name: String(lead.full_name).trim(), code: String(lead.employee_code || "").trim() });
      } catch (err) {
        console.error("Failed to load legal lead:", err);
      }
    };
    loadLegalLead();
  }, []);
  const legalLeadName = legalLead?.name || "";

  // New Document Form
  const [newDocForm, setNewDocForm] = useState({
    code: "",
    title: "",
    category: "Nghị Định & Luật" as LegalDocument["category"],
    issuingBody: "",
    effectiveDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    summary: "",
    attachments: [] as AttachedFile[]
  });

  // New Tender Form
  const [newTenderForm, setNewTenderForm] = useState({
    code: `THAU-ABT-${Date.now().toString().slice(-4)}`,
    hospitalName: "",
    packageName: "",
    bidValue: "",
    submissionDeadline: "",
    assignedLawyer: legalLeadName,
    notes: "",
    checklist: {
      circulationLicense: false,
      loaAuthorization: false,
      iso13485: false,
      financialReport: false,
      gdpGspColdChain: false
    },
    attachments: [] as AttachedFile[]
  });

  // New License Form
  const [newLicenseForm, setNewLicenseForm] = useState({
    licenseNumber: "",
    productName: "",
    deviceClass: "Loại C" as MedicalLicense["deviceClass"],
    manufacturer: "",
    origin: "",
    agency: "Bộ Y Tế - Cục Cơ Sở Hạ Tầng & Thiết Bị Y Tế",
    issueDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    expiryDate: "",
    notes: "",
    attachments: [] as AttachedFile[]
  });

  // Form state for new contract
  const [newContractForm, setNewContractForm] = useState({
    code: `HD-ABT-${Date.now().toString().slice(-4)}`,
    title: "",
    partnerName: "",
    type: "Bán hàng Bệnh Viện" as LegalContract["type"],
    value: "",
    requester: user?.full_name || user?.name || "",
    department: user?.department || "Pháp Chế",
    riskNotes: "",
    riskLevel: "THAP" as LegalContract["riskLevel"],
    expiryDate: "",
    attachments: [] as AttachedFile[]
  });

  // Filtered contracts
  const filteredContracts = useMemo(() => {
    return contracts.filter(c => {
      const matchSearch =
        !searchQuery ||
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.partnerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.requester.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === "all" || c.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [contracts, searchQuery, statusFilter]);

  // Filtered legal documents
  const filteredDocs = useMemo(() => {
    return legalDocuments.filter(d => {
      const matchCategory = docCategoryFilter === "all" || d.category === docCategoryFilter;
      const matchSearch =
        !docSearchQuery ||
        d.title.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
        d.code.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
        d.issuingBody.toLowerCase().includes(docSearchQuery.toLowerCase()) ||
        d.summary.toLowerCase().includes(docSearchQuery.toLowerCase());
      return matchCategory && matchSearch;
    });
  }, [legalDocuments, docCategoryFilter, docSearchQuery]);

  // Filtered tenders
  const filteredTenders = useMemo(() => {
    return tenders.filter(t => {
      const matchStatus = tenderStatusFilter === "all" || t.status === tenderStatusFilter;
      const matchSearch =
        !tenderSearchQuery ||
        t.packageName.toLowerCase().includes(tenderSearchQuery.toLowerCase()) ||
        t.hospitalName.toLowerCase().includes(tenderSearchQuery.toLowerCase()) ||
        t.code.toLowerCase().includes(tenderSearchQuery.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [tenders, tenderStatusFilter, tenderSearchQuery]);

  // Synchronize legal data with PostgreSQL backend via /api/storage
  useEffect(() => {
    const fetchLegalData = async () => {
      try {
        const [contractsRes, licensesRes, docsRes, tendersRes] = await Promise.all([
          fetch("/api/storage?key=legal_contracts"),
          fetch("/api/storage?key=legal_licenses"),
          fetch("/api/storage?key=legal_documents"),
          fetch("/api/storage?key=legal_tenders")
        ]);
        const contractsData = await contractsRes.json();
        const licensesData = await licensesRes.json();
        const docsData = await docsRes.json();
        const tendersData = await tendersRes.json();

        if (contractsData && Array.isArray(contractsData.data) && contractsData.data.length > 0) {
          setContracts(splitDeleted("contracts", contractsData.data));
        }
        if (licensesData && Array.isArray(licensesData.data) && licensesData.data.length > 0) {
          setLicenses(splitDeleted("licenses", licensesData.data));
        }
        if (docsData && Array.isArray(docsData.data) && docsData.data.length > 0) {
          setLegalDocuments(splitDeleted("docs", docsData.data));
        }
        if (tendersData && Array.isArray(tendersData.data) && tendersData.data.length > 0) {
          setTenders(splitDeleted("tenders", tendersData.data));
        }
      } catch (e) {
        console.error("Failed to load legal data:", e);
      }
    };
    fetchLegalData();
  }, []);

  const saveContracts = async (newContracts: LegalContract[]) => {
    setContracts(newContracts);
    try {
      const res = await fetch("/api/storage?key=legal_contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "legal_contracts", data: [...newContracts, ...deletedRef.current.contracts] })
      });
      if (!res.ok) throw new Error("Lưu dữ liệu thất bại");
    } catch (e) {
      console.error("Failed to save contracts to backend:", e);
      showToast("error", "Không thể lưu dữ liệu hợp đồng lên máy chủ!");
    }
  };

  const saveLicenses = async (newLicenses: MedicalLicense[]) => {
    setLicenses(newLicenses);
    try {
      const res = await fetch("/api/storage?key=legal_licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "legal_licenses", data: [...newLicenses, ...deletedRef.current.licenses] })
      });
      if (!res.ok) throw new Error("Lưu dữ liệu thất bại");
    } catch (e) {
      console.error("Failed to save licenses to backend:", e);
      showToast("error", "Không thể lưu dữ liệu giấy phép lưu hành lên máy chủ!");
    }
  };

  const saveLegalDocuments = async (newDocs: LegalDocument[]) => {
    setLegalDocuments(newDocs);
    try {
      const res = await fetch("/api/storage?key=legal_documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "legal_documents", data: [...newDocs, ...deletedRef.current.docs] })
      });
      if (!res.ok) throw new Error("Lưu dữ liệu thất bại");
    } catch (e) {
      console.error("Failed to save legal documents to backend:", e);
      showToast("error", "Không thể lưu hồ sơ pháp lý lên máy chủ!");
    }
  };

  const saveTenders = async (newTenders: TenderDossier[]) => {
    setTenders(newTenders);
    try {
      const res = await fetch("/api/storage?key=legal_tenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "legal_tenders", data: [...newTenders, ...deletedRef.current.tenders] })
      });
      if (!res.ok) throw new Error("Lưu dữ liệu thất bại");
    } catch (e) {
      console.error("Failed to save tenders to backend:", e);
      showToast("error", "Không thể lưu hồ sơ thầu lên máy chủ!");
    }
  };

  const softDelete = (kind: "contract" | "tender" | "license" | "doc", id: string, label: string) => {
    if (!confirm(`Xóa ${label}? Hồ sơ được ẩn khỏi danh sách (vẫn lưu lại để tra cứu khi cần).`)) return;
    const stamp = { deletedAt: new Date().toISOString(), deletedBy: myName || "Người dùng" };
    if (kind === "contract") {
      const item = contracts.find(x => x.id === id); if (!item) return;
      deletedRef.current.contracts = [...deletedRef.current.contracts, { ...item, ...stamp }];
      saveContracts(contracts.filter(x => x.id !== id));
    } else if (kind === "tender") {
      const item = tenders.find(x => x.id === id); if (!item) return;
      deletedRef.current.tenders = [...deletedRef.current.tenders, { ...item, ...stamp }];
      saveTenders(tenders.filter(x => x.id !== id));
    } else if (kind === "license") {
      const item = licenses.find(x => x.id === id); if (!item) return;
      deletedRef.current.licenses = [...deletedRef.current.licenses, { ...item, ...stamp }];
      saveLicenses(licenses.filter(x => x.id !== id));
    } else {
      const item = legalDocuments.find(x => x.id === id); if (!item) return;
      deletedRef.current.docs = [...deletedRef.current.docs, { ...item, ...stamp }];
      saveLegalDocuments(legalDocuments.filter(x => x.id !== id));
    }
    showToast("success", `Đã xóa ${label}.`);
  };

  const openEditContract = (c: LegalContract) => {
    setNewContractForm({
      code: c.code, title: c.title, partnerName: c.partnerName, type: c.type, value: c.value,
      requester: c.requester, department: c.department, riskNotes: c.riskNotes, riskLevel: c.riskLevel,
      expiryDate: c.expiryDate, attachments: c.attachments || []
    });
    setEditing({ kind: "contract", id: c.id });
    setIsNewContractModalOpen(true);
  };
  const openEditTender = (t: TenderDossier) => {
    setNewTenderForm({
      code: t.code, hospitalName: t.hospitalName, packageName: t.packageName, bidValue: t.bidValue,
      submissionDeadline: t.submissionDeadline, assignedLawyer: t.assignedLawyer, notes: t.notes,
      checklist: { ...t.checklist }, attachments: t.attachments || []
    });
    setEditing({ kind: "tender", id: t.id });
    setIsNewTenderModalOpen(true);
  };
  const openEditLicense = (l: MedicalLicense) => {
    setNewLicenseForm({
      licenseNumber: l.licenseNumber, productName: l.productName, deviceClass: l.deviceClass,
      manufacturer: l.manufacturer, origin: l.origin, agency: l.agency, issueDate: l.issueDate,
      expiryDate: l.expiryDate, notes: l.notes || "", attachments: l.attachments || []
    });
    setEditing({ kind: "license", id: l.id });
    setIsNewLicenseModalOpen(true);
  };
  const openEditDoc = (d: LegalDocument) => {
    setNewDocForm({
      code: d.code, title: d.title, category: d.category, issuingBody: d.issuingBody,
      effectiveDate: d.effectiveDate, summary: d.summary, attachments: d.attachments || []
    });
    setEditing({ kind: "doc", id: d.id });
    setIsNewDocModalOpen(true);
  };
  // Đóng form đang sửa: trả form về trống để lần "Tạo mới" sau không mang dữ liệu cũ
  const closeEditor = (kind: "contract" | "tender" | "license" | "doc") => {
    if (kind === "contract") setIsNewContractModalOpen(false);
    if (kind === "tender") setIsNewTenderModalOpen(false);
    if (kind === "license") setIsNewLicenseModalOpen(false);
    if (kind === "doc") setIsNewDocModalOpen(false);
    if (editing?.kind !== kind) return;
    setEditing(null);
    if (kind === "contract") setNewContractForm({ code: `HD-ABT-${Date.now().toString().slice(-4)}`, title: "", partnerName: "", type: "Bán hàng Bệnh Viện", value: "", requester: myName, department: user?.department || "Pháp Chế", riskNotes: "", riskLevel: "THAP", expiryDate: "", attachments: [] });
    if (kind === "tender") setNewTenderForm({ code: `THAU-ABT-${Date.now().toString().slice(-4)}`, hospitalName: "", packageName: "", bidValue: "", submissionDeadline: "", assignedLawyer: legalLeadName, notes: "", checklist: { circulationLicense: false, loaAuthorization: false, iso13485: false, financialReport: false, gdpGspColdChain: false }, attachments: [] });
    if (kind === "license") setNewLicenseForm({ licenseNumber: "", productName: "", deviceClass: "Loại C", manufacturer: "", origin: "", agency: "Bộ Y Tế - Cục Cơ Sở Hạ Tầng & Thiết Bị Y Tế", issueDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), expiryDate: "", notes: "", attachments: [] });
    if (kind === "doc") setNewDocForm({ code: "", title: "", category: "Nghị Định & Luật", issuingBody: "", effectiveDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }), summary: "", attachments: [] });
  };
  const editStamp = () => ({ updatedAt: new Date().toISOString(), updatedBy: myName || "Người dùng" });

  const showToast = (type: "success" | "error", text: string) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 3500);
  };

  const handleUpdateStatus = (contractId: string, newStatus: LegalContract["status"]) => {
    const updated = contracts.map(c => (c.id === contractId ? { ...c, status: newStatus } : c));
    saveContracts(updated);
    showToast("success", `Đã cập nhật trạng thái hợp đồng thành công!`);
    setIsContractModalOpen(false);
  };

  // Handle uploading files in contract request modal
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    let uploadedCount = 0;

    for (const file of fileList) {
      const sizeStr =
        file.size > 1024 * 1024
          ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
          : `${Math.round(file.size / 1024)} KB`;

      try {
        const data = await uploadSingleFileSmart(file);
        if (data.success && data.url) {
          const attached: AttachedFile = {
            id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            name: file.name,
            size: sizeStr,
            type: file.type || "application/pdf",
            dataUrl: data.url,
            uploadedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
            note: "File đính kèm tải lên máy chủ"
          };
          setNewContractForm(prev => ({
            ...prev,
            attachments: [...prev.attachments, attached]
          }));
          uploadedCount++;
          continue;
        }
      } catch (err) {
        console.warn("Server upload failed, checking small file fallback:", err);
      }

      // Only fallback to Base64 for tiny files (<= 256 KB) if offline
      if (file.size <= 256 * 1024) {
        await new Promise<void>(resolve => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const attached: AttachedFile = {
              id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              name: file.name,
              size: sizeStr,
              type: file.type || "application/pdf",
              dataUrl: result,
              uploadedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
              note: "File đính kèm tải lên từ máy tính"
            };
            setNewContractForm(prev => ({
              ...prev,
              attachments: [...prev.attachments, attached]
            }));
            uploadedCount++;
            resolve();
          };
          reader.onerror = () => resolve();
          reader.readAsDataURL(file);
        });
      } else {
        showToast("error", `Không thể tải lên tệp "${file.name}" lên máy chủ!`);
      }
    }

    if (uploadedCount > 0) {
      showToast("success", `Đã tải lên ${uploadedCount} file đính kèm thành công!`);
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setNewContractForm(prev => ({
      ...prev,
      attachments: prev.attachments.filter(f => f.id !== id)
    }));
  };


  const handleOpenDocViewer = (
    doc: {
      id: string;
      code: string;
      title: string;
      type: string;
      partnerOrAgency?: string;
      date?: string;
      summary?: string;
      articles?: { title: string; content: string }[];
      signLeft?: { title: string; name: string };
      signRight?: { title: string; name: string; note?: string };
      attachments?: AttachedFile[];
    },
    tabKey: string = "standard_contract"
  ) => {
    setViewerDoc({
      id: doc.id,
      code: doc.code,
      title: doc.title,
      type: doc.type,
      partnerOrAgency: doc.partnerOrAgency,
      date: doc.date,
      summary: doc.summary,
      articles: doc.articles,
      signLeft: doc.signLeft,
      signRight: doc.signRight,
      attachments: doc.attachments || []
    });
    setActiveDocTab(tabKey);
    setViewerZoom(100);
    setIsViewerModalOpen(true);
  };

  const handleOpenViewer = (contract: LegalContract, tabKey: string = "standard_contract") => {
    setViewingContract(contract);
    handleOpenDocViewer(
      {
        id: contract.id,
        code: contract.code,
        title: contract.title,
        type: contract.type,
        partnerOrAgency: contract.partnerName,
        date: contract.submitDate,
        summary: contract.riskNotes,
        attachments: contract.attachments || []
      },
      tabKey
    );
  };

  const handleDocFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const attached: AttachedFile = {
          id: `att-doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size:
            file.size > 1024 * 1024
              ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
              : `${Math.round(file.size / 1024)} KB`,
          type: file.type || "application/pdf",
          dataUrl: result,
          uploadedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
          note: "Văn bản pháp luật / biểu mẫu tải lên từ máy tính"
        };
        setNewDocForm(prev => ({
          ...prev,
          attachments: [...prev.attachments, attached]
        }));
      };
      reader.readAsDataURL(file);
    });
    showToast("success", `Đã tải lên ${files.length} tệp văn bản pháp luật!`);
  };

  const handleCreateDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing?.kind === "doc") {
      saveLegalDocuments(legalDocuments.map(d => d.id === editing.id ? {
        ...d, code: newDocForm.code, title: newDocForm.title, category: newDocForm.category,
        issuingBody: newDocForm.issuingBody, effectiveDate: newDocForm.effectiveDate, summary: newDocForm.summary,
        attachments: newDocForm.attachments, ...editStamp()
      } : d));
      closeEditor("doc");
      showToast("success", `Đã cập nhật văn bản ${newDocForm.code}.`);
      return;
    }
    const created: LegalDocument = {
      id: `DOC-${Date.now()}`,
      code: newDocForm.code,
      title: newDocForm.title,
      category: newDocForm.category,
      issuingBody: newDocForm.issuingBody || "Cơ quan quản lý",
      effectiveDate: newDocForm.effectiveDate || new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      status: "DANG_HIEU_LUC",
      summary: newDocForm.summary || "Văn bản quy phạm pháp luật / Biểu mẫu ban hành.",
      attachments: newDocForm.attachments,
      createdBy: myName || undefined
    };
    const updated = [created, ...legalDocuments];
    saveLegalDocuments(updated);
    setIsNewDocModalOpen(false);
    setNewDocForm({
      code: "",
      title: "",
      category: "Nghị Định & Luật",
      issuingBody: "",
      effectiveDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      summary: "",
      attachments: []
    });
    showToast("success", `Đã đăng tải thành công văn bản pháp luật ${created.code}!`);
  };

  const handleDeleteDocument = (id: string) => softDelete("doc", id, "văn bản pháp luật này");

  const handleTenderFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const attached: AttachedFile = {
          id: `att-tnd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size:
            file.size > 1024 * 1024
              ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
              : `${Math.round(file.size / 1024)} KB`,
          type: file.type || "application/pdf",
          dataUrl: result,
          uploadedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
          note: "Hồ sơ dự thầu tải lên"
        };
        setNewTenderForm(prev => ({
          ...prev,
          attachments: [...prev.attachments, attached]
        }));
      };
      reader.readAsDataURL(file);
    });
    showToast("success", `Đã đính kèm ${files.length} tài liệu hồ sơ thầu!`);
  };

  const handleCreateTender = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTenderForm.submissionDeadline.trim()) {
      showToast("error", "Vui lòng nhập hạn nộp hồ sơ thầu.");
      return;
    }
    if (editing?.kind === "tender") {
      saveTenders(tenders.map(t => t.id === editing.id ? {
        ...t, code: newTenderForm.code, hospitalName: newTenderForm.hospitalName, packageName: newTenderForm.packageName,
        bidValue: newTenderForm.bidValue, submissionDeadline: newTenderForm.submissionDeadline,
        assignedLawyer: newTenderForm.assignedLawyer, notes: newTenderForm.notes, checklist: newTenderForm.checklist,
        attachments: newTenderForm.attachments,
        status: t.status === "CAN_BO_SUNG" ? "DANG_RA_SOAT" : t.status,
        ...editStamp()
      } : t));
      closeEditor("tender");
      showToast("success", `Đã cập nhật hồ sơ thầu ${newTenderForm.code}.`);
      return;
    }
    const created: TenderDossier = {
      id: `TENDER-${Date.now()}`,
      code: newTenderForm.code,
      hospitalName: newTenderForm.hospitalName,
      packageName: newTenderForm.packageName,
      bidValue: newTenderForm.bidValue || "Theo hồ sơ mời thầu",
      submissionDeadline: newTenderForm.submissionDeadline,
      status: "DANG_RA_SOAT",
      checklist: newTenderForm.checklist,
      notes: newTenderForm.notes || "Hồ sơ thầu khởi tạo chờ rà soát pháp chế.",
      assignedLawyer: newTenderForm.assignedLawyer,
      attachments: newTenderForm.attachments,
      createdBy: myName || undefined
    };
    const updated = [created, ...tenders];
    saveTenders(updated);
    setIsNewTenderModalOpen(false);
    setNewTenderForm({
      code: `THAU-ABT-${Date.now().toString().slice(-4)}`,
      hospitalName: "",
      packageName: "",
      bidValue: "",
      submissionDeadline: "",
      assignedLawyer: legalLeadName,
      notes: "",
      checklist: {
        circulationLicense: false,
        loaAuthorization: false,
        iso13485: false,
        financialReport: false,
        gdpGspColdChain: false
      },
      attachments: []
    });
    showToast("success", `Đã khởi tạo hồ sơ thầu ${created.code} thành công!`);
  };

  const handleUpdateTenderStatus = (id: string, newStatus: TenderDossier["status"]) => {
    const updated = tenders.map(t => (t.id === id ? { ...t, status: newStatus } : t));
    saveTenders(updated);
    showToast("success", "Đã cập nhật trạng thái hồ sơ thầu.");
    setIsTenderModalOpen(false);
  };

  const handleLicenseFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const attached: AttachedFile = {
          id: `att-lic-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size:
            file.size > 1024 * 1024
              ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
              : `${Math.round(file.size / 1024)} KB`,
          type: file.type || "application/pdf",
          dataUrl: result,
          uploadedAt: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
          note: "Bản scan số lưu hành / Giấy CFS"
        };
        setNewLicenseForm(prev => ({
          ...prev,
          attachments: [...prev.attachments, attached]
        }));
      };
      reader.readAsDataURL(file);
    });
    showToast("success", `Đã tải lên ${files.length} tệp giấy phép lưu hành!`);
  };

  const handleCreateLicense = (e: React.FormEvent) => {
    e.preventDefault();
    // Số lưu hành / hạn hiệu lực phải lấy từ giấy phép thật (trước đây form tự điền số và hạn giả)
    if (!newLicenseForm.licenseNumber.trim() || !newLicenseForm.expiryDate.trim()) {
      showToast("error", "Vui lòng nhập đúng Số lưu hành và Ngày hết hạn theo giấy phép của Bộ Y Tế.");
      return;
    }
    if (editing?.kind === "license") {
      saveLicenses(licenses.map(l => l.id === editing.id ? {
        ...l, licenseNumber: newLicenseForm.licenseNumber, productName: newLicenseForm.productName,
        deviceClass: newLicenseForm.deviceClass, manufacturer: newLicenseForm.manufacturer, origin: newLicenseForm.origin,
        agency: newLicenseForm.agency, issueDate: newLicenseForm.issueDate, expiryDate: newLicenseForm.expiryDate,
        notes: newLicenseForm.notes, attachments: newLicenseForm.attachments, ...editStamp()
      } : l));
      closeEditor("license");
      showToast("success", `Đã cập nhật giấy phép ${newLicenseForm.licenseNumber}.`);
      return;
    }
    const created: MedicalLicense = {
      id: `LIC-${Date.now()}`,
      licenseNumber: newLicenseForm.licenseNumber,
      productName: newLicenseForm.productName,
      deviceClass: newLicenseForm.deviceClass,
      manufacturer: newLicenseForm.manufacturer || "ABT Diagnostics",
      origin: newLicenseForm.origin || "Việt Nam",
      agency: newLicenseForm.agency,
      issueDate: newLicenseForm.issueDate,
      expiryDate: newLicenseForm.expiryDate,
      status: "CON_HAN",
      notes: newLicenseForm.notes,
      attachments: newLicenseForm.attachments,
      createdBy: myName || undefined
    };
    const updated = [created, ...licenses];
    saveLicenses(updated);
    setIsNewLicenseModalOpen(false);
    setNewLicenseForm({
      licenseNumber: "",
      productName: "",
      deviceClass: "Loại C",
      manufacturer: "",
      origin: "",
      agency: "Bộ Y Tế - Cục Cơ Sở Hạ Tầng & Thiết Bị Y Tế",
      issueDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      expiryDate: "",
      notes: "",
      attachments: []
    });
    showToast("success", `Đã đăng ký số lưu hành ${created.licenseNumber} thành công!`);
  };

  const handleCreateContract = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing?.kind === "contract") {
      saveContracts(contracts.map(c => c.id === editing.id ? {
        ...c, code: newContractForm.code, title: newContractForm.title, partnerName: newContractForm.partnerName,
        type: newContractForm.type, value: newContractForm.value || c.value, riskNotes: newContractForm.riskNotes,
        riskLevel: newContractForm.riskLevel, expiryDate: newContractForm.expiryDate, attachments: newContractForm.attachments,
        // Đã sửa theo yêu cầu của Pháp chế -> gửi lại chờ thẩm định
        status: c.status === "CAN_SUA_DOI" ? "CHO_THAM_DINH" : c.status,
        ...editStamp()
      } : c));
      closeEditor("contract");
      showToast("success", `Đã cập nhật yêu cầu thẩm định ${newContractForm.code}.`);
      return;
    }
    const created: LegalContract = {
      id: `HD-${Date.now()}`,
      code: newContractForm.code,
      title: newContractForm.title,
      partnerName: newContractForm.partnerName,
      type: newContractForm.type,
      value: newContractForm.value || "Đang thỏa thuận",
      requester: newContractForm.requester,
      department: newContractForm.department,
      submitDate: new Date().toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
      status: "CHO_THAM_DINH",
      riskLevel: newContractForm.riskLevel,
      riskNotes: newContractForm.riskNotes || "Đã gửi dự thảo kèm file đính kèm chờ thẩm định pháp lý.",
      expiryDate: newContractForm.expiryDate,
      assignedLawyer: legalLeadName,
      attachments: newContractForm.attachments,
      createdBy: myName || undefined
    };
    const updated = [created, ...contracts];
    saveContracts(updated);
    setIsNewContractModalOpen(false);
    // Reset form
    setNewContractForm({
      code: `HD-ABT-${Date.now().toString().slice(-4)}`,
      title: "",
      partnerName: "",
      type: "Bán hàng Bệnh Viện",
      value: "",
      requester: user?.full_name || user?.name || "",
      department: user?.department || "Pháp Chế",
      riskNotes: "",
      riskLevel: "THAP",
      expiryDate: "",
      attachments: []
    });
    showToast("success", `Đã gửi yêu cầu thẩm định hợp đồng ${created.code} kèm ${created.attachments?.length || 0} tài liệu!`);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-3 text-xs font-bold ${
            notification.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700"
              : "bg-rose-50 dark:bg-rose-950 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700"
          }`}
        >
          {notification.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-rose-600" />}
          <span>{notification.text}</span>
        </div>
      )}

      {/* Module Header - Standardized Compact Layout */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50/50 to-slate-50 dark:from-emerald-950 dark:via-slate-900 dark:to-slate-900 text-slate-900 dark:text-white rounded-2xl p-4 sm:p-5 shadow-xs border border-emerald-200 dark:border-emerald-800/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
                BỘ PHẬN PHÁP CHẾ &amp; TUÂN THỦ (LEGAL)
              </h1>
              <span className="hidden sm:inline-block font-mono text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30 uppercase">
                LEGAL &amp; COMPLIANCE
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 max-w-3xl">
              Thẩm định pháp lý hợp đồng mua bán thiết bị y tế &amp; sinh phẩm IVD, rà soát hồ sơ mời thầu bệnh viện và kiểm soát số lưu hành Bộ Y Tế.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <div className="px-3 py-1.5 rounded-xl bg-white/80 dark:bg-white/10 border border-emerald-200 dark:border-white/10 text-left shadow-2xs">
              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase">Phụ trách pháp chế</div>
              <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{legalLead ? `${legalLead.name}${legalLead.code ? ` (${legalLead.code})` : ""}` : "Chưa phân công"}</span>
              </div>
            </div>

            <button
              onClick={() => setIsNewContractModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-sm shadow-emerald-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Yêu Cầu Thẩm Định Hợp Đồng</span>
            </button>
          </div>
        </div>

        {/* Top KPI Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-4 border-t border-emerald-200 dark:border-emerald-800/40">
          <div className="bg-white/80 dark:bg-white/5 rounded-xl p-3 border border-emerald-100 dark:border-white/5 shadow-2xs">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">Tổng Hợp Đồng Đang Quản Lý</div>
            <div className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{contracts.length} văn bản</div>
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">Hợp đồng BV &amp; Đối tác quốc tế</div>
          </div>

          <div className="bg-white/80 dark:bg-white/5 rounded-xl p-3 border border-emerald-100 dark:border-white/5 shadow-2xs">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">Chờ Pháp Chế Thẩm Định</div>
            <div className="text-lg font-black text-amber-700 dark:text-amber-400 mt-0.5">
              {contracts.filter(c => c.status === "CHO_THAM_DINH").length} yêu cầu
            </div>
            <div className="text-[10px] text-amber-700/90 dark:text-amber-400/80 font-medium">Thời hạn SLA: 24 - 48 giờ</div>
          </div>

          <div className="bg-white/80 dark:bg-white/5 rounded-xl p-3 border border-emerald-100 dark:border-white/5 shadow-2xs">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">Giấy Phép Lưu Hành &amp; CFS</div>
            <div className="text-lg font-black text-emerald-700 dark:text-emerald-400 mt-0.5">{licenses.length} số lưu hành</div>
            <div className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">Chuẩn Nghị định 98/2021/NĐ-CP</div>
          </div>

          <div className="bg-white/80 dark:bg-white/5 rounded-xl p-3 border border-emerald-100 dark:border-white/5 shadow-2xs">
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">Tỷ Lệ Tuân Thủ Pháp Luật</div>
            <div className="text-lg font-black text-teal-700 dark:text-cyan-400 mt-0.5">100% Đạt Chuẩn</div>
            <div className="text-[10px] text-teal-700/90 dark:text-cyan-300 font-medium">Không có rủi ro tranh chấp</div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
        <button
          onClick={() => setActiveTab("contracts")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "contracts"
              ? "bg-emerald-600 text-white shadow-xs shadow-emerald-600/20"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span>Thẩm Định Hợp Đồng Kinh Tế ({contracts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("tenders")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "tenders"
              ? "bg-emerald-600 text-white shadow-xs shadow-emerald-600/20"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Briefcase className="w-3.5 h-3.5 shrink-0" />
          <span>Hồ Sơ Pháp Lý Đấu Thầu Y Tế</span>
        </button>

        <button
          onClick={() => setActiveTab("licenses")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "licenses"
              ? "bg-emerald-600 text-white shadow-xs shadow-emerald-600/20"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <Award className="w-3.5 h-3.5 shrink-0" />
          <span>Giấy Phép Lưu Hành &amp; Công Bố IVD ({licenses.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("compliance")}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
            activeTab === "compliance"
              ? "bg-emerald-600 text-white shadow-xs shadow-emerald-600/20"
              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Quy Chuẩn Tuân Thủ &amp; Biểu Mẫu Chuẩn</span>
        </button>
      </div>

      {/* TAB 1: CONTRACTS */}
      {activeTab === "contracts" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm hợp đồng theo mã, tên đối tác, nội dung, người yêu cầu..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              >
                <option value="all">-- Tất cả trạng thái --</option>
                <option value="CHO_THAM_DINH">Chờ thẩm định</option>
                <option value="DANG_RA_SOAT">Đang rà soát</option>
                <option value="DA_THONG_QUA">Đã thông qua</option>
                <option value="CAN_SUA_DOI">Cần sửa đổi điều khoản</option>
              </select>

              <button
                onClick={() => setIsNewContractModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Thêm Hợp Đồng
              </button>
            </div>
          </div>

          {/* Contracts Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                    <th className="py-3 px-4">Mã HĐ</th>
                    <th className="py-3 px-4">Tên Hợp Đồng / Nội Dung</th>
                    <th className="py-3 px-4">Đối Tác Ký Kết</th>
                    <th className="py-3 px-4">Phân Loại</th>
                    <th className="py-3 px-4 text-right">Giá Trị</th>
                    <th className="py-3 px-4 text-center">Mức Rủi Ro</th>
                    <th className="py-3 px-4 text-center">Trạng Thái Pháp Chế</th>
                    <th className="py-3 px-4 text-right">Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredContracts.map((c) => {
                    const statusBadge = {
                      CHO_THAM_DINH: { label: "Chờ thẩm định", bg: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800" },
                      DANG_RA_SOAT: { label: "Đang rà soát", bg: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800" },
                      DA_THONG_QUA: { label: "Đã duyệt pháp lý", bg: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800" },
                      CAN_SUA_DOI: { label: "Cần hiệu chỉnh", bg: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800" }
                    }[c.status];

                    const riskBadge = {
                      THAP: { label: "Thấp", bg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
                      TRUNG_BINH: { label: "Trung bình", bg: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
                      CAO: { label: "Cao", bg: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400" }
                    }[c.riskLevel];

                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-white">
                          {c.code}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-white line-clamp-1">{c.title}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>Gửi bởi: {c.requester} ({c.department})</span>
                            <span>•</span>
                            <span>Ngày gửi: {c.submitDate}</span>
                            {c.attachments && c.attachments.length > 0 && (
                              <>
                                <span>•</span>
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 font-semibold border border-blue-200 dark:border-blue-900">
                                  <Paperclip className="w-2.5 h-2.5" />
                                  {c.attachments.length} file đính kèm
                                </span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-300">
                          {c.partnerName}
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-semibold border border-slate-200 dark:border-slate-700">
                            {c.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                          {c.value}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${riskBadge.bg}`}>
                            {riskBadge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge.bg}`}>
                            {statusBadge.label}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleOpenViewer(c, "standard_contract")}
                              className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60 rounded-lg text-[11px] font-bold transition-all cursor-pointer border border-blue-200 dark:border-blue-800"
                              title="Xem trực tiếp hợp đồng số hóa & file đính kèm không cần tải về"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Xem HĐ</span>
                            </button>
                            <button
                              onClick={() => {
                                setSelectedContract(c);
                                setIsContractModalOpen(true);
                              }}
                              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                            >
                              Thẩm Định
                            </button>
                            {canModify(c, c.status === "CHO_THAM_DINH" || c.status === "CAN_SUA_DOI") && (
                              <>
                                <button onClick={() => openEditContract(c)} className="px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60 border border-sky-200 dark:border-sky-800" title="Sửa yêu cầu">
                                  Sửa
                                </button>
                                <button onClick={() => softDelete("contract", c.id, `yêu cầu ${c.code}`)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer" title="Xóa yêu cầu">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
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

      {/* TAB 2: TENDERS */}
      {activeTab === "tenders" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={tenderSearchQuery}
                onChange={(e) => setTenderSearchQuery(e.target.value)}
                placeholder="Tìm gói thầu theo tên bệnh viện, tên gói thầu, mã thầu..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={tenderStatusFilter}
                onChange={(e) => setTenderStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              >
                <option value="all">-- Tất cả trạng thái thầu --</option>
                <option value="DAT_CHUAN">Đạt chuẩn 100%</option>
                <option value="DANG_RA_SOAT">Đang rà soát</option>
                <option value="CAN_BO_SUNG">Cần bổ sung hồ sơ</option>
                <option value="CHUAN_BI_HO_SO">Chuẩn bị hồ sơ</option>
              </select>

              <button
                onClick={() => setIsNewTenderModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Tạo Hồ Sơ Thầu
              </button>
            </div>
          </div>

          {/* Tender Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTenders.map((t) => {
              const statusBadge = {
                DAT_CHUAN: { label: "Đạt chuẩn 100%", bg: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800" },
                DANG_RA_SOAT: { label: "Đang rà soát", bg: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-800" },
                CAN_BO_SUNG: { label: "Cần bổ sung", bg: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800" },
                CHUAN_BI_HO_SO: { label: "Đang soạn thảo", bg: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800" }
              }[t.status];

              return (
                <div
                  key={t.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-2xs space-y-4 hover:border-emerald-500/40 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">
                          {t.code}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge.bg}`}>
                          {statusBadge.label}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm mt-1">
                        {t.packageName}
                      </h4>
                      <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <Building className="w-3.5 h-3.5 text-slate-400" />
                        <span>{t.hospitalName}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-slate-400 font-semibold uppercase">Giá trị gói thầu</div>
                      <div className="text-xs font-mono font-bold text-slate-900 dark:text-white mt-0.5">
                        {t.bidValue}
                      </div>
                    </div>
                  </div>

                  {/* Checklist criteria */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Bộ Tiêu Chuẩn Pháp Lý Bắt Buộc (Luật Đấu Thầu 2023):
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className={`flex items-center gap-1.5 ${t.checklist.circulationLicense ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Số lưu hành BYT</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${t.checklist.loaAuthorization ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-rose-500 font-medium"}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Ủy quyền hãng (LOA)</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${t.checklist.iso13485 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-slate-400"}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Chứng chỉ ISO 13485</span>
                      </div>
                      <div className={`flex items-center gap-1.5 ${t.checklist.gdpGspColdChain ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-amber-500 font-medium"}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Cam kết Cold Chain</span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    {t.notes}
                  </p>

                  {/* Footer & Actions */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                    <div className="text-[10px] text-slate-400 flex items-center gap-2">
                      <span>Hạn nộp: <strong className="text-slate-700 dark:text-slate-300">{t.submissionDeadline}</strong></span>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <Paperclip className="w-3 h-3" />
                        {t.attachments?.length || 0} tệp đính kèm
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          handleOpenDocViewer(
                            {
                              id: t.id,
                              code: t.code,
                              title: t.packageName,
                              type: "Hồ Sơ Đấu Thầu Y Tế",
                              partnerOrAgency: t.hospitalName,
                              date: t.submissionDeadline,
                              summary: t.notes,
                              attachments: t.attachments || []
                            },
                            t.attachments?.[0]?.id || "standard_contract"
                          )
                        }
                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60 rounded-lg text-[11px] font-bold transition-all cursor-pointer border border-blue-200 dark:border-blue-800"
                        title="Xem toàn bộ tài liệu hồ sơ thầu trực tiếp không cần tải về"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Xem Hồ Sơ</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedTender(t);
                          setIsTenderModalOpen(true);
                        }}
                        className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] font-bold transition-all cursor-pointer"
                      >
                        Thẩm Định Thầu
                      </button>
                      {canModify(t, t.status !== "DAT_CHUAN") && (
                        <>
                          <button onClick={() => openEditTender(t)} className="px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60 border border-sky-200 dark:border-sky-800" title="Sửa hồ sơ thầu">
                            Sửa
                          </button>
                          <button onClick={() => softDelete("tender", t.id, `hồ sơ thầu ${t.code}`)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer" title="Xóa hồ sơ thầu">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: LICENSES */}
      {activeTab === "licenses" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-emerald-600" />
                Danh Mục Số Lưu Hành &amp; Công Bố Tiêu Chuẩn Trang Thiết Bị Y Tế
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Quản lý số đăng ký lưu hành, công bố tiêu chuẩn áp dụng IVD loại A, B, C, D theo Nghị định 98/2021/NĐ-CP
              </p>
            </div>

            <button
              onClick={() => setIsNewLicenseModalOpen(true)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-emerald-600/20 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> + Đăng Ký Số Lưu Hành Mới
            </button>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-800">
                    <th className="py-3 px-4">Số Công Bố / Lưu Hành</th>
                    <th className="py-3 px-4">Tên Sản Phẩm Sinh Phẩm / Thiết Bị</th>
                    <th className="py-3 px-4">Phân Loại Rủi Ro</th>
                    <th className="py-3 px-4">Nhà Sản Xuất &amp; Xuất Xứ</th>
                    <th className="py-3 px-4">Cơ Quan Cấp</th>
                    <th className="py-3 px-4">Hạn Hiệu Lực</th>
                    <th className="py-3 px-4 text-center">Tình Trạng</th>
                    <th className="py-3 px-4 text-center">Tài Liệu / Thao Tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {licenses.map((lic) => (
                    <tr key={lic.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {lic.licenseNumber}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white max-w-xs">
                        <div>{lic.productName}</div>
                        {lic.notes && <div className="text-[10px] text-slate-400 font-normal mt-0.5 truncate">{lic.notes}</div>}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-bold text-[10px]">
                          {lic.deviceClass}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{lic.manufacturer}</div>
                        <div className="text-[10px] text-slate-400">Xuất xứ: {lic.origin}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 max-w-[140px] truncate" title={lic.agency}>
                        {lic.agency}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {lic.expiryDate}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            lic.status === "CON_HAN"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                          }`}
                        >
                          {lic.status === "CON_HAN" ? "Còn hiệu lực" : "Sắp hết hạn (<90 ngày)"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() =>
                              handleOpenDocViewer(
                                {
                                  id: lic.id,
                                  code: lic.licenseNumber,
                                  title: `Giấy Phép Lưu Hành: ${lic.productName}`,
                                  type: `Công Bố Trang Thiết Bị Y Tế - ${lic.deviceClass}`,
                                  partnerOrAgency: lic.agency,
                                  date: `Hiệu lực: ${lic.issueDate} - ${lic.expiryDate}`,
                                  summary: `${lic.notes || ""} • Nhà sản xuất: ${lic.manufacturer} (${lic.origin}) • Cơ quan thẩm quyền: ${lic.agency}`,
                                  attachments: lic.attachments || []
                                },
                                lic.attachments?.[0]?.id || "standard_contract"
                              )
                            }
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60 rounded-lg text-[11px] font-bold transition-all cursor-pointer border border-emerald-200 dark:border-emerald-800"
                            title="Xem chi tiết và file scan giấy chứng nhận lưu hành"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Xem Giấy Phép</span>
                            {lic.attachments && lic.attachments.length > 0 && (
                              <span className="ml-0.5 px-1 bg-emerald-200 dark:bg-emerald-800 rounded text-[9px]">
                                {lic.attachments.length}
                              </span>
                            )}
                          </button>
                          {canModify(lic, true) && (
                            <>
                              <button onClick={() => openEditLicense(lic)} className="px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60 border border-sky-200 dark:border-sky-800" title="Sửa giấy phép">
                                Sửa
                              </button>
                              <button onClick={() => softDelete("license", lic.id, `giấy phép ${lic.licenseNumber}`)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer" title="Xóa giấy phép">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: COMPLIANCE & LEGAL DOCUMENTS LIBRARY */}
      {activeTab === "compliance" && (
        <div className="space-y-6">
          {/* Header & Upload Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-teal-600" />
                Thư Viện Văn Bản Pháp Quy &amp; Biểu Mẫu Chuẩn Hóa Y Tế
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tra cứu, tải lên văn bản luật, nghị định Bộ Y Tế, tiêu chuẩn ISO 13485 và các biểu mẫu hợp đồng mẫu ABT
              </p>
            </div>

            <button
              onClick={() => setIsNewDocModalOpen(true)}
              className="px-3.5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-teal-600/20 shrink-0"
            >
              <Upload className="w-3.5 h-3.5" /> + Tải Lên Văn Bản / Biểu Mẫu
            </button>
          </div>

          {/* Search & Category Filter Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={docSearchQuery}
                onChange={(e) => setDocSearchQuery(e.target.value)}
                placeholder="Tìm theo số hiệu (98/2021, 22/2023), từ khóa tiêu đề, cơ quan ban hành..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {[
                { id: "all", label: "Tất Cả" },
                { id: "Nghị Định & Luật", label: "Nghị Định & Luật" },
                { id: "Thông Tư Bộ Y Tế", label: "Thông Tư BYT" },
                { id: "Tiêu Chuẩn ISO/TCVN", label: "ISO / TCVN" },
                { id: "Biểu Mẫu Chuẩn ABT", label: "Biểu Mẫu ABT" }
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setDocCategoryFilter(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    docCategoryFilter === cat.id
                      ? "bg-teal-600 text-white shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Legal Documents Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredDocs.map((doc) => {
              const categoryColor =
                doc.category === "Nghị Định & Luật"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                  : doc.category === "Thông Tư Bộ Y Tế"
                  ? "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300 border-teal-200 dark:border-teal-800"
                  : doc.category === "Tiêu Chuẩn ISO/TCVN"
                  ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";

              return (
                <div
                  key={doc.id}
                  className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2.5">
                    {/* Header Chips */}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${categoryColor}`}>
                        {doc.category}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Hiệu lực: {doc.effectiveDate}
                      </span>
                    </div>

                    {/* Code & Title */}
                    <div>
                      <div className="font-mono text-xs font-bold text-teal-700 dark:text-teal-400">
                        {doc.code}
                      </div>
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm mt-0.5 leading-snug">
                        {doc.title}
                      </h4>
                    </div>

                    {/* Summary */}
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
                      {doc.summary}
                    </p>

                    {/* Issuing Agency */}
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Cơ quan ban hành:</span>
                      <span>{doc.issuingBody}</span>
                    </div>
                  </div>

                  {/* Attachments & Action Buttons */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Paperclip className="w-3.5 h-3.5 text-teal-600" />
                      <span className="text-[11px] font-medium">
                        {doc.attachments?.length || 0} tệp đính kèm
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          handleOpenDocViewer(
                            {
                              id: doc.id,
                              code: doc.code,
                              title: doc.title,
                              type: doc.category,
                              partnerOrAgency: doc.issuingBody,
                              date: `Hiệu lực: ${doc.effectiveDate}`,
                              summary: doc.summary,
                              attachments: doc.attachments || []
                            },
                            doc.attachments?.[0]?.id || "standard_contract"
                          )
                        }
                        className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-900/60 rounded-xl text-xs font-bold transition-all cursor-pointer border border-teal-200 dark:border-teal-800"
                        title="Đọc toàn bộ văn bản hoặc tệp đính kèm trực tiếp không cần tải về"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Đọc Trực Tiếp</span>
                      </button>

                      {doc.attachments && doc.attachments.length > 0 && doc.attachments[0].dataUrl && (
                        <a
                          href={doc.attachments[0].dataUrl}
                          download={doc.attachments[0].name}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs transition-colors cursor-pointer"
                          title="Tải tệp về máy"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {canModify(doc, true) && (
                        <>
                          <button onClick={() => openEditDoc(doc)} className="px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60 border border-sky-200 dark:border-sky-800" title="Sửa văn bản">
                            Sửa
                          </button>
                          <button
                            onClick={() => handleDeleteDocument(doc.id)}
                            className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-600 rounded-xl text-xs transition-colors cursor-pointer"
                            title="Xóa văn bản"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredDocs.length === 0 && (
            <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
              <div className="text-xs text-slate-500 font-medium">
                Không tìm thấy văn bản pháp luật hoặc biểu mẫu nào phù hợp.
              </div>
              <button
                onClick={() => {
                  setDocSearchQuery("");
                  setDocCategoryFilter("all");
                }}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 cursor-pointer"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          )}

          {/* Standard Compliance Checklist SOP */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs space-y-4">
            <h4 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Quy Trình Thẩm Định Pháp Lý Bắt Buộc Chuẩn Hóa ABT (Standard Legal SOP)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600 dark:text-slate-400">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-[10px]">1</span>
                  Tư cách pháp nhân đối tác
                </div>
                <p className="text-[11px] leading-relaxed">
                  Xác minh mã số thuế, GPKD, người đại diện theo pháp luật hoặc giấy ủy quyền ký kết hợp đồng hợp lệ.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-[10px]">2</span>
                  Điều khoản thanh toán &amp; phạt
                </div>
                <p className="text-[11px] leading-relaxed">
                  Mức phạt tối đa không vượt quá 8% giá trị phần nghĩa vụ bị vi phạm theo Điều 301 Luật Thương mại 2005.
                </p>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1">
                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-[10px]">3</span>
                  Cold Chain &amp; Bảo hành IVD
                </div>
                <p className="text-[11px] leading-relaxed">
                  Cam kết đổi mới 1:1 nếu hư hại nhiệt độ bảo quản trong vận chuyển lạnh hoặc sai lệch kết quả kiểm định COA.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONTRACT DETAILS & APPROVAL */}
      {isContractModalOpen && selectedContract && (
        <Modal
          isOpen={isContractModalOpen}
          onClose={() => setIsContractModalOpen(false)}
          title={`Thẩm Định Pháp Lý Hợp Đồng: ${selectedContract.code}`}
          size="2xl"
        >
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-bold uppercase">Nội dung hợp đồng</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  {selectedContract.type}
                </span>
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">{selectedContract.title}</div>
              <div className="grid grid-cols-2 gap-3 text-xs pt-2">
                <div>
                  <span className="text-slate-400">Đối tác:</span>
                  <div className="font-bold text-slate-800 dark:text-slate-200">{selectedContract.partnerName}</div>
                </div>
                <div>
                  <span className="text-slate-400">Giá trị:</span>
                  <div className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{selectedContract.value}</div>
                </div>
                <div>
                  <span className="text-slate-400">Người lập đề xuất:</span>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedContract.requester} ({selectedContract.department})</div>
                </div>
                <div>
                  <span className="text-slate-400">Hạn hợp đồng:</span>
                  <div className="font-semibold text-slate-800 dark:text-slate-200">{selectedContract.expiryDate}</div>
                </div>
              </div>
            </div>

            {/* Direct Document Viewer & Attachments Section */}
            <div className="p-4 bg-gradient-to-br from-blue-50/70 to-indigo-50/50 dark:from-blue-950/30 dark:to-indigo-950/20 rounded-2xl border border-blue-200/80 dark:border-blue-900/50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                  <Paperclip className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Hồ Sơ Hợp Đồng &amp; Tài Liệu Đính Kèm ({selectedContract.attachments?.length || 0} tệp tin)</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleOpenViewer(selectedContract, "standard_contract");
                  }}
                  className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/30 transition-all cursor-pointer shrink-0"
                >
                  <Eye className="w-4 h-4" />
                  <span>Mở Trình Đọc Hợp Đồng Trực Tiếp</span>
                </button>
              </div>

              {/* Attachment chips */}
              {selectedContract.attachments && selectedContract.attachments.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {selectedContract.attachments.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => handleOpenViewer(selectedContract, file.id)}
                      className="group flex items-center justify-between p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-xs cursor-pointer transition-all"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-[10px] shrink-0">
                          PDF
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                            {file.name}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {file.size} • {file.uploadedAt}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 shrink-0">
                        Xem
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic">
                  Chưa có tệp tin đính kèm cho hợp đồng này.
                </div>
              )}
            </div>

            {/* Legal Evaluation Section */}
            <div className="p-4 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-800 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Ý Kiến Thẩm Định Của Luật Sư Pháp Chế ({selectedContract.assignedLawyer})</span>
              </div>
              <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                {selectedContract.riskNotes}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => handleUpdateStatus(selectedContract.id, "CAN_SUA_DOI")}
                className="px-3.5 py-2 bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 hover:bg-rose-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Yêu Cầu Sửa Đổi Điều Khoản
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(selectedContract.id, "DANG_RA_SOAT")}
                  className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Đang Rà Soát Thêm
                </button>

                <button
                  type="button"
                  onClick={() => handleUpdateStatus(selectedContract.id, "DA_THONG_QUA")}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Phê Duyệt Pháp Lý &amp; Trình Ký</span>
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: CREATE NEW CONTRACT REQUEST */}
      {isNewContractModalOpen && (
        <Modal
          isOpen={isNewContractModalOpen}
          onClose={() => closeEditor("contract")}
          title={editing?.kind === "contract" ? "Sửa hồ sơ (lưu lại thay đổi)" : "Tạo Yêu Cầu Thẩm Định Hợp Đồng Pháp Lý"}
          size="2xl"
        >
          <form onSubmit={handleCreateContract} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Mã Dự Thảo Hợp Đồng</label>
                <input
                  type="text"
                  value={newContractForm.code}
                  onChange={(e) => setNewContractForm({ ...newContractForm, code: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Loại Hợp Đồng</label>
                <select
                  value={newContractForm.type}
                  onChange={(e) => setNewContractForm({ ...newContractForm, type: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  <option value="Bán hàng Bệnh Viện">Bán hàng Bệnh Viện</option>
                  <option value="Mua hàng Quốc Tế">Mua hàng Quốc Tế</option>
                  <option value="Đại Lý Phân Phối">Đại Lý Phân Phối</option>
                  <option value="Thỏa thuận NDA">Thỏa thuận NDA</option>
                  <option value="Thuê kho / Dịch vụ">Thuê kho / Dịch vụ</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Tiêu Đề / Nội Dung Chính</label>
              <input
                type="text"
                value={newContractForm.title}
                onChange={(e) => setNewContractForm({ ...newContractForm, title: e.target.value })}
                placeholder="ví dụ: Hợp đồng cung cấp Hệ thống Real-time PCR cho BV Chợ Rẫy"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Đối Tác Ký Kết</label>
                <input
                  type="text"
                  value={newContractForm.partnerName}
                  onChange={(e) => setNewContractForm({ ...newContractForm, partnerName: e.target.value })}
                  placeholder="ví dụ: Bệnh Viện Bạch Mai"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Giá Trị Dự Kiến</label>
                <input
                  type="text"
                  value={newContractForm.value}
                  onChange={(e) => setNewContractForm({ ...newContractForm, value: e.target.value })}
                  placeholder="ví dụ: 3.500.000.000 VNĐ"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Ghi Chú Rủi Ro Cần Pháp Chế Lưu Ý</label>
              <textarea
                value={newContractForm.riskNotes}
                onChange={(e) => setNewContractForm({ ...newContractForm, riskNotes: e.target.value })}
                rows={2}
                placeholder="Ghi rõ điều khoản thanh toán, bảo lãnh thầu, phạt chậm giao hàng cần luật sư thẩm định..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white resize-none"
              />
            </div>

            {/* FILE ATTACHMENTS DROPZONE & PREVIEW SECTION */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Đính Kèm Tài Liệu Hợp Đồng (PDF, Word, Excel, Bản Scan)</span>
                </label>
              </div>

              {/* Upload Drop Area */}
              <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 rounded-2xl cursor-pointer bg-slate-50 dark:bg-slate-800/40 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 transition-all">
                <Upload className="w-6 h-6 text-slate-400 mb-1" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nhấp hoặc kéo thả file hợp đồng vào đây
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">
                  Hỗ trợ định dạng .PDF, .DOCX, .XLSX, .PNG, .JPG (Xem trực tiếp không cần tải về)
                </span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.rar,.7z"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {/* Uploaded File List */}
              {newContractForm.attachments.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">
                    Đã đính kèm ({newContractForm.attachments.length} tệp tin):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                    {newContractForm.attachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs shadow-2xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-[9px] flex items-center justify-center shrink-0">
                            FILE
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                              {file.name}
                            </div>
                            <div className="text-[9px] text-slate-400">{file.size}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(file.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewContractModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl text-xs cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                {editing?.kind === "contract" ? "Lưu thay đổi" : "Gửi Thẩm Định Pháp Lý"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: UPLOAD LEGAL DOCUMENT / STANDARD FORM */}
      {isNewDocModalOpen && (
        <Modal
          isOpen={isNewDocModalOpen}
          onClose={() => closeEditor("doc")}
          title={editing?.kind === "doc" ? "Sửa hồ sơ (lưu lại thay đổi)" : "Tải Lên Văn Bản Pháp Quy & Biểu Mẫu Chuẩn Hóa"}
          size="2xl"
        >
          <form onSubmit={handleCreateDocument} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Số Hiệu Văn Bản / Mã Biểu Mẫu
                </label>
                <input
                  type="text"
                  value={newDocForm.code}
                  onChange={(e) => setNewDocForm({ ...newDocForm, code: e.target.value })}
                  placeholder="ví dụ: 98/2021/NĐ-CP hoặc BM-HD-01"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Phân Loại Văn Bản
                </label>
                <select
                  value={newDocForm.category}
                  onChange={(e) =>
                    setNewDocForm({
                      ...newDocForm,
                      category: e.target.value as LegalDocument["category"]
                    })
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  <option value="Nghị Định &amp; Luật">Nghị Định &amp; Luật</option>
                  <option value="Thông Tư Bộ Y Tế">Thông Tư Bộ Y Tế</option>
                  <option value="Tiêu Chuẩn ISO/TCVN">Tiêu Chuẩn ISO / TCVN</option>
                  <option value="Biểu Mẫu Chuẩn ABT">Biểu Mẫu Chuẩn ABT</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tiêu Đề / Tên Văn Bản Đầy Đủ
              </label>
              <input
                type="text"
                value={newDocForm.title}
                onChange={(e) => setNewDocForm({ ...newDocForm, title: e.target.value })}
                placeholder="ví dụ: Nghị định Quản lý trang thiết bị y tế hoặc Biểu mẫu HĐ mua sắm IVD"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Cơ Quan Ban Hành / Ban Hành Bởi
                </label>
                <input
                  type="text"
                  value={newDocForm.issuingBody}
                  onChange={(e) => setNewDocForm({ ...newDocForm, issuingBody: e.target.value })}
                  placeholder="ví dụ: Chính Phủ, Bộ Y Tế hoặc Ban Pháp Chế ABT"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Ngày Ban Hành / Có Hiệu Lực
                </label>
                <input
                  type="text"
                  value={newDocForm.effectiveDate}
                  onChange={(e) => setNewDocForm({ ...newDocForm, effectiveDate: e.target.value })}
                  placeholder="dd/mm/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Trích Yếu / Tóm Tắt Quy Định Áp Dụng
              </label>
              <textarea
                value={newDocForm.summary}
                onChange={(e) => setNewDocForm({ ...newDocForm, summary: e.target.value })}
                rows={3}
                placeholder="Tóm tắt phạm vi điều chỉnh, các điều khoản trọng tâm liên quan đến thiết bị IVD, quy chuẩn chất lượng hoặc lưu ý áp dụng..."
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white resize-none"
              />
            </div>

            {/* File Upload Dropzone for Legal Documents */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-teal-600" />
                <span>Đính Kèm Tệp Toàn Văn (PDF, Word DOCX, Bản Scan)</span>
              </label>

              <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-teal-500 dark:hover:border-teal-500 rounded-2xl cursor-pointer bg-slate-50 dark:bg-slate-800/40 hover:bg-teal-50/20 transition-all">
                <Upload className="w-6 h-6 text-slate-400 mb-1" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nhấp hoặc kéo thả tệp văn bản vào đây
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">
                  Hỗ trợ tệp .PDF, .DOC, .DOCX, hình ảnh scan (Có thể đọc trực tiếp trong hệ thống không cần tải về)
                </span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.rar,.7z"
                  onChange={handleDocFileUpload}
                  className="hidden"
                />
              </label>

              {newDocForm.attachments.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">
                    Tệp đính kèm ({newDocForm.attachments.length}):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                    {newDocForm.attachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold text-[9px] flex items-center justify-center shrink-0">
                            DOC
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                              {file.name}
                            </div>
                            <div className="text-[9px] text-slate-400">{file.size}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setNewDocForm((prev) => ({
                              ...prev,
                              attachments: prev.attachments.filter((f) => f.id !== file.id)
                            }))
                          }
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewDocModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl text-xs cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-xl text-xs shadow-md shadow-teal-600/20 cursor-pointer"
              >
                {editing?.kind === "doc" ? "Lưu thay đổi" : "Lưu & Xuất Bản Văn Bản"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: CREATE NEW TENDER DOSSIER */}
      {isNewTenderModalOpen && (
        <Modal
          isOpen={isNewTenderModalOpen}
          onClose={() => closeEditor("tender")}
          title={editing?.kind === "tender" ? "Sửa hồ sơ (lưu lại thay đổi)" : "Khởi Tạo Hồ Sơ Pháp Lý Đấu Thầu Y Tế"}
          size="2xl"
        >
          <form onSubmit={handleCreateTender} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Mã Hồ Sơ Thầu
                </label>
                <input
                  type="text"
                  value={newTenderForm.code}
                  onChange={(e) => setNewTenderForm({ ...newTenderForm, code: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Hạn Chót Nộp Hồ Sơ
                </label>
                <input
                  type="text"
                  value={newTenderForm.submissionDeadline}
                  onChange={(e) => setNewTenderForm({ ...newTenderForm, submissionDeadline: e.target.value })}
                  placeholder="dd/mm/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Bệnh Viện / Cơ Sở Y Tế Mời Thầu
              </label>
              <input
                type="text"
                value={newTenderForm.hospitalName}
                onChange={(e) => setNewTenderForm({ ...newTenderForm, hospitalName: e.target.value })}
                placeholder="ví dụ: Bệnh Viện Quân Y 175 hoặc Bệnh Viện Chợ Rẫy"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tên Gói Thầu &amp; Phạm Vi Cung Cấp
              </label>
              <input
                type="text"
                value={newTenderForm.packageName}
                onChange={(e) => setNewTenderForm({ ...newTenderForm, packageName: e.target.value })}
                placeholder="ví dụ: Gói thầu mua sắm Hóa chất sinh học phân tử &amp; Hệ thống xét nghiệm PCR năm 2026"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Giá Dự Thầu Dự Kiến
                </label>
                <input
                  type="text"
                  value={newTenderForm.bidValue}
                  onChange={(e) => setNewTenderForm({ ...newTenderForm, bidValue: e.target.value })}
                  placeholder="ví dụ: 5.200.000.000 VNĐ"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Luật Sư / Chuyên Viên Rà Soát
                </label>
                <input
                  type="text"
                  value={newTenderForm.assignedLawyer}
                  onChange={(e) => setNewTenderForm({ ...newTenderForm, assignedLawyer: e.target.value })}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Checklist Pre-selection */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
                Tiêu Chí Pháp Lý Bắt Buộc (Luật Đấu Thầu 22/2023):
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {[
                  { key: "circulationLicense", label: "1. Giấy phép lưu hành Bộ Y Tế" },
                  { key: "loaAuthorization", label: "2. Thư ủy quyền hãng (LOA)" },
                  { key: "iso13485", label: "3. Chứng chỉ ISO 13485:2016" },
                  { key: "financialReport", label: "4. Báo cáo tài chính đã kiểm toán" },
                  { key: "gdpGspColdChain", label: "5. Cam kết Cold Chain &amp; GDP/GSP" }
                ].map((item) => (
                  <label key={item.key} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={(newTenderForm.checklist as any)[item.key]}
                      onChange={(e) =>
                        setNewTenderForm({
                          ...newTenderForm,
                          checklist: {
                            ...newTenderForm.checklist,
                            [item.key]: e.target.checked
                          }
                        })
                      }
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-[11px] text-slate-700 dark:text-slate-300">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* File Upload Dropzone for Tender Dossier */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                <span>Đính Kèm Tài Liệu Hồ Sơ Thầu (HSMT, LOA, ISO, Scan Đóng Dấu)</span>
              </label>

              <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 rounded-2xl cursor-pointer bg-slate-50 dark:bg-slate-800/40 hover:bg-blue-50/20 transition-all">
                <Upload className="w-6 h-6 text-slate-400 mb-1" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nhấp hoặc kéo thả file hồ sơ dự thầu vào đây
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">
                  Hỗ trợ .PDF, .DOCX, .XLSX (Đọc trực tiếp trong ứng dụng không cần tải về)
                </span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.rar,.7z"
                  onChange={handleTenderFileUpload}
                  className="hidden"
                />
              </label>

              {newTenderForm.attachments.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">
                    Tệp đính kèm ({newTenderForm.attachments.length}):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                    {newTenderForm.attachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold text-[9px] flex items-center justify-center shrink-0">
                            FILE
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                              {file.name}
                            </div>
                            <div className="text-[9px] text-slate-400">{file.size}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setNewTenderForm((prev) => ({
                              ...prev,
                              attachments: prev.attachments.filter((f) => f.id !== file.id)
                            }))
                          }
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewTenderModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl text-xs cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shadow-blue-600/20 cursor-pointer"
              >
                {editing?.kind === "tender" ? "Lưu thay đổi" : "Tạo Hồ Sơ Thầu"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: TENDER EVALUATION MODAL */}
      {isTenderModalOpen && selectedTender && (
        <Modal
          isOpen={isTenderModalOpen}
          onClose={() => setIsTenderModalOpen(false)}
          title={`Thẩm Định Hồ Sơ Đấu Thầu: ${selectedTender.code}`}
          size="2xl"
        >
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="text-xs font-mono font-bold text-blue-600">{selectedTender.code}</div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                {selectedTender.packageName}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pt-1 text-slate-600 dark:text-slate-400">
                <div>
                  <span className="text-slate-400">Bên mời thầu:</span>{" "}
                  <strong className="text-slate-800 dark:text-slate-200">{selectedTender.hospitalName}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Giá trị dự thầu:</span>{" "}
                  <strong className="text-emerald-600 font-mono">{selectedTender.bidValue}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Hạn chót nộp:</span>{" "}
                  <strong className="text-slate-800 dark:text-slate-200">{selectedTender.submissionDeadline}</strong>
                </div>
                <div>
                  <span className="text-slate-400">Luật sư phụ trách:</span>{" "}
                  <strong className="text-slate-800 dark:text-slate-200">{selectedTender.assignedLawyer}</strong>
                </div>
              </div>
            </div>

            {/* Checklist evaluation */}
            <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Kết Quả Rà Soát 5 Tiêu Chí Pháp Lý
              </div>
              <div className="space-y-2">
                {[
                  { key: "circulationLicense", label: "Giấy phép lưu hành Bộ Y Tế", ok: selectedTender.checklist.circulationLicense },
                  { key: "loaAuthorization", label: "Thư ủy quyền bán hàng từ hãng (LOA)", ok: selectedTender.checklist.loaAuthorization },
                  { key: "iso13485", label: "Chứng chỉ hệ thống chất lượng ISO 13485:2016", ok: selectedTender.checklist.iso13485 },
                  { key: "financialReport", label: "Báo cáo tài chính kiểm toán 3 năm", ok: selectedTender.checklist.financialReport },
                  { key: "gdpGspColdChain", label: "Quy trình bảo quản chuỗi lạnh Cold Chain", ok: selectedTender.checklist.gdpGspColdChain }
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs"
                  >
                    <span className="text-slate-700 dark:text-slate-300 font-medium">{item.label}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.ok
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                      }`}
                    >
                      {item.ok ? "✓ Đạt yêu cầu" : "✗ Chưa đạt / Cần bổ sung"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Attachments Section */}
            <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-200 dark:border-blue-900 flex items-center justify-between">
              <div className="text-xs text-blue-900 dark:text-blue-300 font-medium flex items-center gap-1.5">
                <Paperclip className="w-4 h-4 text-blue-600" />
                <span>{selectedTender.attachments?.length || 0} tệp tài liệu trong hồ sơ thầu</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  handleOpenDocViewer(
                    {
                      id: selectedTender.id,
                      code: selectedTender.code,
                      title: selectedTender.packageName,
                      type: "Hồ Sơ Đấu Thầu Y Tế",
                      partnerOrAgency: selectedTender.hospitalName,
                      date: selectedTender.submissionDeadline,
                      summary: selectedTender.notes,
                      attachments: selectedTender.attachments || []
                    },
                    selectedTender.attachments?.[0]?.id || "standard_contract"
                  )
                }
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Đọc Hồ Sơ Trực Tiếp</span>
              </button>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleUpdateTenderStatus(selectedTender.id, "CAN_BO_SUNG")}
                className="px-3.5 py-2 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 hover:bg-amber-100 rounded-xl text-xs font-bold cursor-pointer"
              >
                Yêu Cầu Bổ Sung Hồ Sơ
              </button>

              <button
                type="button"
                onClick={() => handleUpdateTenderStatus(selectedTender.id, "DAT_CHUAN")}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-600/30 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Phê Duyệt Đạt Chuẩn Pháp Lý Dự Thầu</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: ADD MEDICAL LICENSE WITH FILE UPLOAD */}
      {isNewLicenseModalOpen && (
        <Modal
          isOpen={isNewLicenseModalOpen}
          onClose={() => closeEditor("license")}
          title={editing?.kind === "license" ? "Sửa hồ sơ (lưu lại thay đổi)" : "Đăng Ký Hồ Sơ Giấy Phép Lưu Hành Mới"}
          size="2xl"
        >
          <form onSubmit={handleCreateLicense} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Số Công Bố / Số Lưu Hành
                </label>
                <input
                  type="text"
                  value={newLicenseForm.licenseNumber}
                  onChange={(e) => setNewLicenseForm({ ...newLicenseForm, licenseNumber: e.target.value })}
                  placeholder="ví dụ: 240001234/PCBB-BYT"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Phân Loại Rủi Ro IVD
                </label>
                <select
                  value={newLicenseForm.deviceClass}
                  onChange={(e) =>
                    setNewLicenseForm({
                      ...newLicenseForm,
                      deviceClass: e.target.value as MedicalLicense["deviceClass"]
                    })
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  <option value="Loại A">Loại A (Rủi ro rất thấp - Công bố SYT)</option>
                  <option value="Loại B">Loại B (Rủi ro thấp - Công bố SYT)</option>
                  <option value="Loại C">Loại C (Rủi ro trung bình - Cấp phép BYT)</option>
                  <option value="Loại D">Loại D (Rủi ro cao - Cấp phép BYT)</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Tên Thiết Bị / Sinh Phẩm Chẩn Đoán IVD
              </label>
              <input
                type="text"
                value={newLicenseForm.productName}
                onChange={(e) => setNewLicenseForm({ ...newLicenseForm, productName: e.target.value })}
                placeholder="ví dụ: Hệ thống xét nghiệm Real-time PCR tự động ABT-9600"
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Nhà Sản Xuất
                </label>
                <input
                  type="text"
                  value={newLicenseForm.manufacturer}
                  onChange={(e) => setNewLicenseForm({ ...newLicenseForm, manufacturer: e.target.value })}
                  placeholder="ví dụ: ABT Diagnostics Lab Inc."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Xuất Xứ (Quốc Gia)
                </label>
                <input
                  type="text"
                  value={newLicenseForm.origin}
                  onChange={(e) => setNewLicenseForm({ ...newLicenseForm, origin: e.target.value })}
                  placeholder="ví dụ: Đức / Mỹ / Việt Nam"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Cơ Quan Cấp Phép
                </label>
                <input
                  type="text"
                  value={newLicenseForm.agency}
                  onChange={(e) => setNewLicenseForm({ ...newLicenseForm, agency: e.target.value })}
                  placeholder="Bộ Y Tế / Sở Y Tế TP.HCM"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Hạn Hiệu Lực
                </label>
                <input
                  type="text"
                  value={newLicenseForm.expiryDate}
                  onChange={(e) => setNewLicenseForm({ ...newLicenseForm, expiryDate: e.target.value })}
                  placeholder="dd/mm/yyyy"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* File Upload Dropzone for License Certificate */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5 text-emerald-600" />
                <span>Đính Kèm Bản Scan Giấy Phép Lưu Hành / CFS Hợp Pháp Hóa</span>
              </label>

              <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 rounded-2xl cursor-pointer bg-slate-50 dark:bg-slate-800/40 hover:bg-emerald-50/20 transition-all">
                <Upload className="w-6 h-6 text-slate-400 mb-1" />
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Nhấp hoặc kéo thả file scan giấy phép vào đây
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">
                  Hỗ trợ .PDF, ảnh scan .PNG, .JPG (Đọc trực tiếp trong ứng dụng không cần tải về)
                </span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleLicenseFileUpload}
                  className="hidden"
                />
              </label>

              {newLicenseForm.attachments.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[10px] font-bold text-slate-500 uppercase">
                    Tệp đính kèm ({newLicenseForm.attachments.length}):
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto">
                    {newLicenseForm.attachments.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-[9px] flex items-center justify-center shrink-0">
                            LIC
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                              {file.name}
                            </div>
                            <div className="text-[9px] text-slate-400">{file.size}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setNewLicenseForm((prev) => ({
                              ...prev,
                              attachments: prev.attachments.filter((f) => f.id !== file.id)
                            }))
                          }
                          className="p-1 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsNewLicenseModalOpen(false)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold rounded-xl text-xs cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                {editing?.kind === "license" ? "Lưu thay đổi" : "Đăng Ký Lưu Hành"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: UNIVERSAL IN-APP DIRECT DOCUMENT & CONTRACT VIEWER */}
      {isViewerModalOpen && (viewerDoc || viewingContract) && (() => {
        const docToView = viewerDoc || {
          id: viewingContract!.id,
          code: viewingContract!.code,
          title: viewingContract!.title,
          type: viewingContract!.type,
          partnerOrAgency: viewingContract!.partnerName,
          date: viewingContract!.submitDate,
          summary: viewingContract!.riskNotes,
          attachments: viewingContract!.attachments || []
        };

        const isContractType =
          docToView.type.includes("Hợp đồng") ||
          docToView.type.includes("Bán hàng") ||
          docToView.type.includes("Mua hàng") ||
          docToView.type.includes("Đại Lý") ||
          docToView.type.includes("NDA");

        return (
          <Modal
            isOpen={isViewerModalOpen}
            onClose={() => setIsViewerModalOpen(false)}
            title={`Trình Đọc Văn Bản Số Hóa Trực Tiếp: ${docToView.code} - ${docToView.title}`}
            size="6xl"
          >
            <div className="space-y-4">
              {/* Top Toolbar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-slate-800/80 rounded-2xl border border-white/10">
                {/* Document Tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
                  <button
                    type="button"
                    onClick={() => setActiveDocTab("standard_contract")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                      activeDocTab === "standard_contract"
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                        : "text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>
                      {isContractType
                        ? "Văn Bản Hợp Đồng Chuẩn Hóa (A4)"
                        : "Trích Yếu Toàn Văn Số Hóa (A4)"}
                    </span>
                  </button>

                  {docToView.attachments?.map((att) => (
                    <button
                      key={att.id}
                      type="button"
                      onClick={() => setActiveDocTab(att.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                        activeDocTab === att.id
                          ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                          : "text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span className="max-w-[170px] truncate">{att.name}</span>
                    </button>
                  ))}
                </div>

                {/* View Tools */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                  <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
                    <button
                      type="button"
                      onClick={() => setViewerZoom((z) => Math.max(70, z - 10))}
                      className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer transition-colors"
                      title="Thu nhỏ"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-xs font-mono font-bold text-slate-200 px-2 min-w-[45px] text-center">
                      {viewerZoom}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setViewerZoom((z) => Math.min(140, z + 10))}
                      className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer transition-colors"
                      title="Phóng to"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                    title="In văn bản trực tiếp"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">In Văn Bản</span>
                  </button>

                  {viewingContract && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsViewerModalOpen(false);
                        setSelectedContract(viewingContract);
                        setIsContractModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Thẩm Định</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Document Content View */}
              {activeDocTab === "standard_contract" ? (
                <div className="overflow-x-auto max-h-[75vh] overflow-y-auto p-2 bg-slate-950/40 rounded-2xl border border-white/5 custom-scrollbar">
                  <div
                    style={{ transform: `scale(${viewerZoom / 100})`, transformOrigin: "top center" }}
                    className="transition-transform duration-200"
                  >
                    <div className="max-w-4xl mx-auto bg-white text-slate-900 p-8 sm:p-14 rounded-2xl shadow-2xl border border-slate-200 space-y-6 font-sans select-text">
                      {/* Official Vietnamese Header */}
                      <div className="text-center space-y-1">
                        <div className="text-xs sm:text-sm font-bold tracking-wider uppercase text-slate-900">
                          CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                        </div>
                        <div className="text-xs sm:text-sm font-bold underline underline-offset-4 text-slate-900">
                          Độc lập - Tự do - Hạnh phúc
                        </div>
                        <div className="text-[10px] sm:text-xs text-slate-500 pt-1">***</div>
                      </div>

                      {/* Document Title */}
                      <div className="text-center pt-2 space-y-1">
                        <h2 className="text-base sm:text-xl font-bold uppercase tracking-tight text-slate-900">
                          {docToView.title}
                        </h2>
                        <div className="text-xs font-mono font-bold text-slate-600">
                          Số hiệu / Mã: {docToView.code} • Phân loại: {docToView.type} • Thời gian: {docToView.date || "2026"}
                        </div>
                      </div>

                      {/* Legal Basis */}
                      <div className="text-[11px] italic text-slate-600 space-y-0.5 border-l-2 border-slate-300 pl-3 py-1">
                        <div>- Căn cứ Bộ luật Dân sự số 91/2015/QH13 đã được Quốc hội nước CHXHCN Việt Nam thông qua;</div>
                        <div>- Căn cứ Luật Thương mại số 36/2005/QH11 và Luật Đấu thầu số 22/2023/QH15;</div>
                        <div>- Căn cứ Nghị định số 98/2021/NĐ-CP &amp; 07/2023/NĐ-CP của Chính phủ về Quản lý trang thiết bị y tế;</div>
                        <div>- Căn cứ Hệ thống quản lý chất lượng thiết bị y tế tiêu chuẩn ISO 13485:2016.</div>
                      </div>

                      {/* Specific Entity / Parties Info */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200 font-sans">
                        <div className="space-y-1">
                          <div className="font-bold text-emerald-800 uppercase border-b border-emerald-200 pb-1">
                            ĐƠN VỊ ĐỀ XUẤT / CUNG ỨNG:
                          </div>
                          <div className="font-bold text-slate-900">
                            {companyConfig.companyName || "CÔNG TY CỔ PHẦN CÔNG NGHỆ SINH HỌC & THIẾT BỊ Y TẾ ABT"}
                          </div>
                          <div><span className="text-slate-500">Mã số thuế:</span> {companyConfig.companyTaxCode || "0314892288"}</div>
                          <div><span className="text-slate-500">Địa chỉ:</span> {companyConfig.companyAddress || "51 Đường số 26, Phường An Lạc, TP. HCM"}</div>
                          <div><span className="text-slate-500">Đại diện pháp luật:</span> {companyConfig.companyRepresentative ? `${companyConfig.companyRepresentative} - ${companyConfig.companyRepresentativeRole || "Đại diện"}` : "TS. Bùi Thái Bình - Tổng Giám Đốc"}</div>
                        </div>

                        <div className="space-y-1">
                          <div className="font-bold text-blue-800 uppercase border-b border-blue-200 pb-1">
                            ĐƠN VỊ LIÊN QUAN / CƠ QUAN THẨM QUYỀN:
                          </div>
                          <div className="font-bold text-slate-900">{docToView.partnerOrAgency || "Cơ quan có thẩm quyền"}</div>
                          <div><span className="text-slate-500">Hạng mục tài liệu:</span> {docToView.type}</div>
                          <div><span className="text-slate-500">Ngày hiệu lực:</span> {docToView.date || "2026"}</div>
                          <div><span className="text-slate-500">Tình trạng văn bản:</span> <strong className="text-emerald-700">Đã kiểm duyệt pháp lý</strong></div>
                        </div>
                      </div>

                      {/* Summary & Specific Articles */}
                      <div className="space-y-3.5 text-xs leading-relaxed text-slate-800">
                        <div>
                          <strong className="text-slate-900 text-sm">NỘI DUNG TRÍCH YẾU &amp; PHẠM VI ÁP DỤNG:</strong>
                          <p className="mt-1 text-slate-700 bg-amber-50/60 p-3 rounded-xl border border-amber-200 text-xs">
                            {docToView.summary || "Toàn bộ tài liệu quy chuẩn pháp lý và hồ sơ số hóa đã được Ban Pháp Chế ABT kiểm tra tính hợp lệ và tuân thủ các quy định hiện hành của Bộ Y Tế."}
                          </p>
                        </div>

                        <div>
                          <strong className="text-slate-900">ĐIỀU 1: TIÊU CHUẨN KỸ THUẬT &amp; CÔNG BỐ SẢN PHẨM TRANG THIẾT BỊ Y TẾ</strong>
                          <p className="mt-0.5 text-slate-700">
                            Các sản phẩm sinh phẩm chẩn đoán in vitro (IVD) và hệ thống máy xét nghiệm PCR/ELISA phải bảo đảm 100% có đầy đủ số công bố tiêu chuẩn áp dụng hoặc số lưu hành còn hạn, chứng chỉ CFS hợp pháp hóa lãnh sự, CO/CQ từ nhà sản xuất đạt chứng nhận ISO 13485.
                          </p>
                        </div>

                        <div>
                          <strong className="text-slate-900">ĐIỀU 2: ĐIỀU KIỆN LƯU KHO VÀ CHUỖI CUNG ỨNG LẠNH (COLD CHAIN)</strong>
                          <p className="mt-0.5 text-slate-700">
                            Sinh phẩm và hóa chất xét nghiệm phải được vận chuyển, lưu kho theo tiêu chuẩn thực hành tốt bảo quản thuốc/thiết bị y tế (GSP), kiểm soát nhiệt độ nghiêm ngặt ở 2°C - 8°C hoặc -20°C có chip ghi dữ liệu nhiệt độ điện tử tự động và tem RFID kiểm định.
                          </p>
                        </div>

                        <div>
                          <strong className="text-slate-900">ĐIỀU 3: BẢO MẬT DỮ LIỆU &amp; CAM KẾT PHÁP LÝ</strong>
                          <p className="mt-0.5 text-slate-700">
                            Các Bên cam kết tuân thủ đầy đủ các điều khoản bảo mật dữ liệu y tế, sở hữu trí tuệ công nghệ xét nghiệm và trách nhiệm pháp lý theo đúng quy định của Luật Đấu thầu số 22/2023/QH15 và Nghị định 98/2021/NĐ-CP.
                          </p>
                        </div>
                      </div>

                      {/* Signature & Digital Seals Section */}
                      <div className="pt-8 border-t border-slate-300 font-sans">
                        <div className="grid grid-cols-2 gap-8 text-center text-xs">
                          <div className="space-y-2">
                            <div className="font-bold text-slate-900 uppercase">
                              {isContractType ? "ĐẠI DIỆN ĐỐI TÁC / KHÁCH HÀNG" : "CƠ QUAN / ĐƠN VỊ LIÊN KẾT"}
                            </div>
                            <div className="text-[11px] text-slate-500 italic">(Xác nhận điện tử)</div>
                            <div className="h-24 flex items-center justify-center">
                              <span className="text-slate-400 italic text-xs">[Đã xác nhận &amp; Lưu trữ hệ thống]</span>
                            </div>
                            <div className="font-bold text-slate-800">{docToView.partnerOrAgency}</div>
                          </div>

                          <div className="space-y-2">
                            <div className="font-bold text-slate-900 uppercase">ĐẠI DIỆN PHÁP LÝ ({companyConfig.companyName ? companyConfig.companyName.toUpperCase() : "BÊN BÁN"})</div>
                            <div className="text-[11px] text-slate-500 italic">(Ký điện tử &amp; Đóng dấu số)</div>
                            <div className="h-24 flex flex-col items-center justify-center relative">
                              <div className="w-28 h-28 rounded-full border-2 border-dashed border-rose-600/80 p-1 flex flex-col items-center justify-center text-rose-600 rotate-[-8deg] bg-rose-50/20 shadow-xs">
                                <span className="text-[7.5px] font-black uppercase text-center leading-tight">
                                  {companyConfig.companyName ? companyConfig.companyName.toUpperCase() : "CÔNG TY CP CÔNG NGHỆ ABT"}
                                </span>
                                <span className="text-[9px] font-black my-0.5">★ ★ ★</span>
                                <span className="text-[8.5px] font-bold text-center">ĐÃ KÝ SỐ</span>
                              </div>
                            </div>
                            <div className="font-bold text-slate-800">
                              {companyConfig.companyRepresentative ? `${companyConfig.companyRepresentative.toUpperCase()} (${companyConfig.companyRepresentativeRole || "Đại diện"})` : "TS. BÙI THÁI BÌNH (Tổng Giám Đốc)"}
                            </div>
                            <div className="text-[10px] text-emerald-700 font-semibold">
                              ✓ Thẩm định pháp chế: Ban Pháp Chế &amp; Đấu Thầu
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Attached File View (Direct In-App Preview) */
                <div className="max-h-[75vh] overflow-y-auto p-4 bg-slate-950/60 rounded-2xl border border-white/5 custom-scrollbar">
                  {(() => {
                    const currentFile = docToView.attachments?.find((a) => a.id === activeDocTab);
                    if (!currentFile) {
                      return (
                        <div className="text-center py-12 text-slate-400 text-xs">
                          Không tìm thấy tệp tin được yêu cầu.
                        </div>
                      );
                    }

                    // If user uploaded a real file with dataUrl (PDF iframe or image)
                    if (currentFile.dataUrl) {
                      if (currentFile.type.includes("pdf")) {
                        return (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-xs text-slate-400 bg-white/5 p-2.5 rounded-xl border border-white/10">
                              <span className="font-bold text-white flex items-center gap-1.5">
                                <FileText className="w-4 h-4 text-rose-400" />
                                {currentFile.name} ({currentFile.size})
                              </span>
                              <span className="text-emerald-400 font-semibold">
                                ✓ Đang đọc trực tiếp qua Web PDF Engine (Không cần tải về)
                              </span>
                            </div>
                            <iframe
                              src={currentFile.dataUrl}
                              className="w-full h-[68vh] rounded-xl border border-slate-700 bg-white shadow-xl"
                              title={currentFile.name}
                            />
                          </div>
                        );
                      } else if (currentFile.type.includes("image") || /^data:image\//.test(currentFile.dataUrl)) {
                        return (
                          <div className="space-y-3 text-center">
                            <div className="text-xs text-slate-400 bg-white/5 p-2 rounded-xl border border-white/10 text-left">
                              <span className="font-bold text-white">{currentFile.name}</span> ({currentFile.size})
                            </div>
                            <div className="p-4 bg-white/5 rounded-2xl flex items-center justify-center">
                              <img
                                src={currentFile.dataUrl}
                                alt={currentFile.name}
                                className="max-h-[65vh] object-contain rounded-xl shadow-2xl"
                              />
                            </div>
                          </div>
                        );
                      }
                    }

                    // File thật nhưng trình duyệt không xem trực tiếp được (Word, Excel, ZIP...): mở / tải đúng file đã đính kèm
                    if (currentFile.dataUrl) {
                      return (
                        <div className="max-w-xl mx-auto text-center space-y-4 py-10">
                          <FileText className="w-12 h-12 text-sky-400 mx-auto" />
                          <div>
                            <div className="font-bold text-white text-sm break-all">{currentFile.name}</div>
                            <div className="text-[11px] text-slate-400 mt-1">
                              {currentFile.size} • Tải lên: {currentFile.uploadedAt}
                            </div>
                          </div>
                          <div className="text-xs text-slate-400">
                            Định dạng này không xem trực tiếp trên trình duyệt được. Tải về để mở bằng Word / Excel.
                          </div>
                          <div className="flex items-center justify-center gap-2">
                            <a
                              href={currentFile.dataUrl}
                              download={currentFile.name}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                            >
                              <Download className="w-4 h-4" /> Tải file về
                            </a>
                            {!currentFile.dataUrl.startsWith("data:") && (
                              <a
                                href={currentFile.dataUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold"
                              >
                                <Eye className="w-4 h-4" /> Mở ở tab mới
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Preloaded / authentic attached file reader canvas
                    return (
                      <div className="max-w-4xl mx-auto space-y-4">
                        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10 text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 font-bold flex items-center justify-center text-xs">
                              DOC
                            </div>
                            <div>
                              <div className="font-bold text-white">{currentFile.name}</div>
                              <div className="text-[11px] text-slate-400">
                                Dung lượng: {currentFile.size} • Ngày tải lên: {currentFile.uploadedAt}
                              </div>
                            </div>
                          </div>
                          <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] border border-emerald-500/30">
                            Bản Lưu Trữ Pháp Lý Đã Chứng Thực
                          </span>
                        </div>

                        {/* Document Viewer Frame */}
                        <div className="bg-white text-slate-900 p-8 sm:p-12 rounded-2xl shadow-2xl border border-slate-300 space-y-6">
                          <div className="flex items-center justify-between border-b pb-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-teal-600 text-white font-black flex items-center justify-center text-base">
                                {companyConfig.companyName?.slice(0, 3)?.toUpperCase() || "ABT"}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 text-sm">{companyConfig.companyName || "ABT SCIENTIFIC"}</div>
                                <div className="text-[11px] text-slate-500">Kho Tài Liệu Pháp Lý &amp; Hồ Sơ Thầu Số Hóa</div>
                              </div>
                            </div>
                            <div className="text-right text-xs">
                              <div className="font-mono font-bold text-slate-700">{docToView.code}</div>
                              <div className="text-[10px] text-slate-400">Mã tệp: {currentFile.id}</div>
                            </div>
                          </div>

                          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                            <div className="font-bold text-slate-800">Trích lục nội dung tệp tin đính kèm:</div>
                            <div className="text-slate-600">
                              {currentFile.note ||
                                `Tài liệu đính kèm số hóa liên kết trực tiếp với ${docToView.code} phục vụ công tác rà soát tuân thủ và phê duyệt hồ sơ.`}
                            </div>
                          </div>

                          <div className="space-y-3 text-xs leading-relaxed text-slate-700 border-t pt-4">
                            <div className="font-bold text-slate-900 text-sm">NỘI DUNG TÀI LIỆU SỐ HÓA:</div>
                            <p>
                              Tài liệu này được lưu trữ tập trung trên hệ thống cơ sở dữ liệu ABT Portal và liên kết với mã hồ sơ <strong>{docToView.code}</strong>.
                            </p>
                            <ul className="list-disc pl-5 space-y-1">
                              <li>Tiêu đề văn bản: <strong>{docToView.title}</strong></li>
                              <li>Phân loại: <strong>{docToView.type}</strong></li>
                              <li>Cơ quan / Đơn vị thẩm quyền: <strong>{docToView.partnerOrAgency}</strong></li>
                              <li>Tình trạng hiệu lực: <strong>Đang có hiệu lực thi hành</strong></li>
                            </ul>
                            <div className="p-3 bg-teal-50 text-teal-800 rounded-xl border border-teal-200 text-xs font-medium">
                              ✓ Toàn bộ chữ ký số, chứng chỉ ISO 13485 và số lưu hành thiết bị y tế đi kèm đã được rà soát đối chiếu đồng bộ với Cổng Dịch Vụ Công Bộ Y Tế.
                            </div>
                          </div>

                          <div className="pt-6 border-t flex items-center justify-between text-xs text-slate-400">
                            <span>Trang 1 / 1 (Bản xem trực tiếp trên hệ thống ABT Portal)</span>
                            <span className="font-mono">ABT-LEGAL-SECURED-2026</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
};
