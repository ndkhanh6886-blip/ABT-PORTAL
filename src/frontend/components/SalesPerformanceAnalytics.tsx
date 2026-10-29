import React, { useState, useMemo } from "react";
import {
  Calendar,
  User,
  Plus,
  Download,
  BarChart3,
  PieChart,
  Table,
  TrendingUp,
  DollarSign,
  CreditCard,
  Percent,
  Building2,
  Package,
  Layers,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileSpreadsheet,
  ChevronRight,
  Award,
  Users,
  Target,
  Search,
  Filter,
  Edit3,
  ArrowRight,
  Check,
  X,
  Flame,
  ShieldAlert,
  AlertCircle,
  Eye
} from "lucide-react";
import { cn } from "@/backend/services/utils";
import * as XLSX from "xlsx";
import { todayVN } from "@/backend/services/dates";

export interface SalesPerformanceAnalyticsProps {
  salesPersonnel: any[];
  visibleSalesPersonnel?: any[];
  customers: any[];
  factoryOrders: any[];
  deliverySlips: any[];
  retailLogs13b: any[];
  customerHistory: any[];
  allDeliveredOrders: any[];
  salesTargets: any[];
  specializedPlans: any[];
  quotations: any[];
  contracts: any[];
  salesNvkdCustomers?: any[];
  biolabProducts?: any[];
  isManagerOrAdmin: boolean;
  isViewerDirector: boolean;
  loggedInStaff: any;
  onOpenTargetModal: (repId?: string) => void;
}

// Benchmark transactions (Clean slate: empty by default for real-world operations)
const BENCHMARK_TRANSACTIONS: any[] = [];

export const SalesPerformanceAnalytics: React.FC<SalesPerformanceAnalyticsProps> = ({
  salesPersonnel,
  visibleSalesPersonnel = [],
  customers,
  factoryOrders,
  deliverySlips,
  retailLogs13b,
  customerHistory,
  allDeliveredOrders,
  salesTargets,
  specializedPlans,
  quotations,
  contracts,
  salesNvkdCustomers = [],
  biolabProducts = [],
  isManagerOrAdmin,
  isViewerDirector,
  loggedInStaff,
  onOpenTargetModal
}) => {
  // Filter States
  const [periodType, setPeriodType] = useState<"month" | "quarter" | "year" | "all">("month");
  const [periodValue, setPeriodValue] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedRepId, setSelectedRepId] = useState<string>("all");

  // Analysis Dimension & Metric & Chart Type States
  const [analysisDimension, setAnalysisDimension] = useState<
    "employee" | "customer" | "customer_group" | "debt" | "product" | "category" | "trend" | "target"
  >("target");

  const [activeMetric, setActiveMetric] = useState<
    "revenue_gross" | "revenue_net" | "vat" | "discount" | "collected" | "debt" | "debt_rate" | "quantity"
  >("revenue_gross");

  const [chartView, setChartView] = useState<"vertical_bar" | "horizontal_bar" | "donut" | "line_trend" | "pivot_table">("vertical_bar");

  // KPI Evaluation Dashboard Filter & Search States
  const [kpiFilter, setKpiFilter] = useState<"all" | "assigned" | "unassigned" | "completed" | "at_risk">("all");
  const [kpiSearchTerm, setKpiSearchTerm] = useState("");
  const [kpiViewMode, setKpiViewMode] = useState<"table_and_chart" | "table_only" | "chart_only">("table_and_chart");

  // Robust date normalization helper
  const parseNormalizedDate = (dateVal: any): { year: number; month: number; dateStr: string } | null => {
    if (!dateVal) return null;
    const str = String(dateVal).trim();
    if (str.includes("T")) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return { year: d.getFullYear(), month: d.getMonth() + 1, dateStr: str.slice(0, 10) };
      }
    }
    // Check YYYY-MM-DD
    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      return { year: parseInt(isoMatch[1], 10), month: parseInt(isoMatch[2], 10), dateStr: str };
    }
    // Check DD/MM/YYYY
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      return { year: parseInt(slashMatch[3], 10), month: parseInt(slashMatch[2], 10), dateStr: `${slashMatch[3]}-${String(slashMatch[2]).padStart(2, "0")}-${String(slashMatch[1]).padStart(2, "0")}` };
    }
    return null;
  };

  // Date filtering logic
  const matchPeriod = (dateVal: any) => {
    if (periodType === "all") return true;
    const parsed = parseNormalizedDate(dateVal);
    if (!parsed) return false;

    if (periodType === "month") {
      const [filterYear, filterMonth] = periodValue.split("-").map(Number);
      return parsed.year === filterYear && parsed.month === filterMonth;
    } else if (periodType === "quarter") {
      const [yearStr, qStr] = periodValue.split("-Q");
      const year = parseInt(yearStr, 10);
      const q = parseInt(qStr, 10);
      if (parsed.year !== year) return false;
      if (q === 1) return [1, 2, 3].includes(parsed.month);
      if (q === 2) return [4, 5, 6].includes(parsed.month);
      if (q === 3) return [7, 8, 9].includes(parsed.month);
      if (q === 4) return [10, 11, 12].includes(parsed.month);
      return false;
    } else if (periodType === "year") {
      const filterYear = parseInt(periodValue, 10);
      return parsed.year === filterYear;
    }
    return false;
  };

  // Merge Live transactions with Benchmark dataset
  const unifiedTransactions = useMemo(() => {
    const list: any[] = [...BENCHMARK_TRANSACTIONS];

    // 1. Ingest all delivered orders
    if (Array.isArray(allDeliveredOrders)) {
      allDeliveredOrders.forEach(ord => {
        if (!list.some(item => item.order_code === ord.order_code)) {
          // ord.total_amount is the grand total (gross, after VAT/discount)
          const total_amount = Number(ord.total_amount) || 0;
          // Extract pre-VAT subtotal and VAT amount based on 8% standard
          const subtotal = Math.round(total_amount / 1.08);
          const vat_amount = total_amount - subtotal;
          const vat_rate = 8;
          
          // Actual payment tracking from order status / payment fields
          const isPaid = ord.paymentStatus === "PAID" || ord.debt_status === "PAID" || ord.payment_status === "PAID";
          const paid_amount = isPaid ? total_amount : (Number(ord.amount_paid ?? ord.paid_amount) || 0);
          const debt_amount = Math.max(0, total_amount - paid_amount);

          list.push({
            order_code: ord.order_code,
            date: ord.deliveredAt ? String(ord.deliveredAt).slice(0, 10) : (ord.deliveryDate || todayVN()),
            customer_code: ord.customer_code || ord.customerId || "KH-CUSTOM",
            customer_name: ord.customer_name || ord.customerName || "Khách hàng ABT",
            customer_group: ord.customer_group || ord.customerGroup || "Khách hàng doanh nghiệp",
            sales_rep_id: ord.sales_rep_id || ord.salesRepId || "UNASSIGNED",
            sales_rep_name: ord.sales_rep_name || ord.salesRepName || "Chưa gán NVKD",
            items: ord.items || [],
            subtotal,
            discount_rate: Number(ord.discount_rate) || 0,
            discount_amount: Number(ord.discount_amount) || 0,
            vat_rate,
            vat_amount,
            total_amount,
            paid_amount,
            debt_amount,
            debt_status: debt_amount === 0 ? "PAID" : "PARTIAL",
            invoice_no: ord.invoiceNo || ""
          });
        }
      });
    }

    // 2. Ingest Retail Logs 13B
    if (Array.isArray(retailLogs13b)) {
      retailLogs13b.forEach(log => {
        const total_amount = Number(log.total) || 0;
        const subtotal = Math.round(total_amount / 1.08);
        const vat_amount = total_amount - subtotal;
        list.push({
          order_code: log.id || `RET-${log.date}`,
          date: log.date || todayVN(),
          customer_code: "KH-RETAIL",
          customer_name: log.customerName || "Khách lẻ Kho 13B",
          customer_group: "Trung tâm Xét nghiệm Lab",
          sales_rep_id: log.salesRepId || "KD-RETAIL",
          sales_rep_name: log.salesRepName || "Tổ bán lẻ 13B",
          items: log.items || [],
          subtotal,
          discount_rate: 0,
          discount_amount: 0,
          vat_rate: 8,
          vat_amount,
          total_amount,
          paid_amount: total_amount,
          debt_amount: 0,
          debt_status: "PAID",
          invoice_no: ""
        });
      });
    }

    return list;
  }, [allDeliveredOrders, retailLogs13b]);

  // Filtered transactions based on Period and Sales Rep
  const filteredTransactions = useMemo(() => {
    return unifiedTransactions.filter(tx => {
      const matchP = matchPeriod(tx.date);
      const matchR = selectedRepId === "all" || tx.sales_rep_id === selectedRepId || tx.sales_rep_name === selectedRepId;
      return matchP && matchR;
    });
  }, [unifiedTransactions, periodType, periodValue, selectedRepId]);

  // Aggregated KPI Metrics
  const summaryKpis = useMemo(() => {
    let preVat = 0;
    let postVat = 0;
    let discount = 0;
    let collected = 0;
    let debt = 0;
    let totalQty = 0;

    filteredTransactions.forEach(tx => {
      preVat += tx.subtotal || 0;
      postVat += tx.total_amount || 0;
      discount += tx.discount_amount || 0;
      collected += tx.paid_amount || 0;
      debt += tx.debt_amount || 0;
      (tx.items || []).forEach((it: any) => {
        totalQty += Number(it.quantity) || 0;
      });
    });

    const collectionRate = postVat > 0 ? Math.round((collected / postVat) * 100) : 100;

    // Target KPI calculation
    const defaultMonthlyTarget = 0;
    const currentRepTargets = salesTargets.filter(t => {
      if (selectedRepId !== "all" && t.salesRepId !== selectedRepId) return false;
      if (periodType === "month") return t.month === periodValue;
      if (periodType === "quarter") {
        const [yearStr, qStr] = periodValue.split("-Q");
        const qNum = parseInt(qStr, 10);
        const qMonthsMap: Record<number, string[]> = {
          1: ["01", "02", "03"],
          2: ["04", "05", "06"],
          3: ["07", "08", "09"],
          4: ["10", "11", "12"]
        };
        const validMonths = (qMonthsMap[qNum] || []).map(m => `${yearStr}-${m}`);
        return validMonths.includes(t.month);
      }
      if (periodType === "year") return (t.month || "").startsWith(periodValue);
      return true;
    });

    const repMultiplier = selectedRepId === "all" ? Math.max(1, (visibleSalesPersonnel.length || salesPersonnel.length || 5)) : 1;
    const periodMultiplier = periodType === "quarter" ? 3 : periodType === "year" ? 12 : 1;
    const benchmarkTarget = defaultMonthlyTarget * repMultiplier * periodMultiplier;

    const targetAmount = currentRepTargets.length > 0 
      ? currentRepTargets.reduce((acc, t) => acc + (t.targetAmount || 0), 0)
      : 0;

    const completionRate = targetAmount > 0 ? Math.round((postVat / targetAmount) * 100) : 0;

    return {
      preVat,
      postVat,
      discount,
      collected,
      debt,
      collectionRate,
      targetAmount,
      completionRate,
      totalQty,
      orderCount: filteredTransactions.length
    };
  }, [filteredTransactions, salesTargets, selectedRepId, periodType, periodValue, visibleSalesPersonnel, salesPersonnel]);

  // Format currency helper
  const fmtCurrency = (n: number) => new Intl.NumberFormat("vi-VN").format(Math.round(n || 0)) + "đ";

  // Helper to get target amount for specific rep in current period
  const getRepTargetForPeriod = (repId: string, repName?: string): number => {
    const matched = salesTargets.filter(t => {
      const matchId = t.salesRepId === repId || (repName && t.salesRepName === repName);
      if (!matchId) return false;
      if (periodType === "month") return t.month === periodValue;
      if (periodType === "quarter") {
        const [yearStr, qStr] = periodValue.split("-Q");
        const qNum = parseInt(qStr, 10);
        const qMonthsMap: Record<number, string[]> = {
          1: ["01", "02", "03"],
          2: ["04", "05", "06"],
          3: ["07", "08", "09"],
          4: ["10", "11", "12"]
        };
        const validMonths = (qMonthsMap[qNum] || []).map(m => `${yearStr}-${m}`);
        return validMonths.includes(t.month) || t.month === periodValue;
      }
      if (periodType === "year") return (t.month || "").startsWith(periodValue) || t.month === periodValue;
      return true;
    });
    return matched.reduce((acc, t) => acc + (Number(t.targetAmount) || 0), 0);
  };

  // Comprehensive Personnel Target Tracking & KPI Evaluation Model
  const repEvaluations = useMemo(() => {
    const staffList = (visibleSalesPersonnel && visibleSalesPersonnel.length > 0) ? visibleSalesPersonnel : salesPersonnel;
    
    // Calculate days passed in current month for pace analysis
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const monthPacePct = periodType === "month" ? Math.round((currentDay / daysInMonth) * 100) : 50;

    return staffList.map((rep, idx) => {
      const repId = rep.employee_id || rep.id || rep.employee_code || `REP-${idx}`;
      const repName = rep.full_name || rep.name || repId;
      const targetAmount = getRepTargetForPeriod(repId, repName);

      // Find rep transactions in period
      const repTxs = filteredTransactions.filter(tx => 
        tx.sales_rep_id === repId || 
        tx.seller_id === repId || 
        (tx.sales_rep_name && tx.sales_rep_name.toLowerCase() === repName.toLowerCase()) || 
        (tx.seller_name && tx.seller_name.toLowerCase() === repName.toLowerCase())
      );

      const preVat = repTxs.reduce((sum, tx) => sum + (tx.subtotal || 0), 0);
      const postVat = repTxs.reduce((sum, tx) => sum + (tx.total_amount || 0), 0);
      const collected = repTxs.reduce((sum, tx) => sum + (tx.paid_amount || 0), 0);
      const debt = repTxs.reduce((sum, tx) => sum + (tx.debt_amount || 0), 0);
      const orderCount = repTxs.length;
      const collectionRate = postVat > 0 ? Math.round((collected / postVat) * 100) : 100;
      
      const completionRate = targetAmount > 0 ? Math.round((postVat / targetAmount) * 100) : 0;
      const gap = postVat - targetAmount;

      // Evaluation Rating
      let rating: "EXCELLENT" | "ON_TRACK" | "NEEDS_EFFORT" | "AT_RISK" | "NO_SALES" | "NO_TARGET" = "NO_TARGET";
      let ratingLabel = "Chưa giao chỉ tiêu";
      let ratingColor = "bg-slate-800 text-slate-400 border-slate-700";

      if (targetAmount === 0) {
        rating = "NO_TARGET";
        ratingLabel = "Chưa giao chỉ tiêu";
        ratingColor = "bg-slate-800/80 text-slate-400 border-slate-700";
      } else if (completionRate >= 100) {
        rating = "EXCELLENT";
        ratingLabel = "Xuất sắc (Về đích)";
        ratingColor = "bg-emerald-950/80 text-emerald-400 border-emerald-800/80";
      } else if (completionRate >= 75 || (completionRate >= monthPacePct && completionRate > 30)) {
        rating = "ON_TRACK";
        ratingLabel = "Bám sát tiến độ";
        ratingColor = "bg-indigo-950/80 text-indigo-400 border-indigo-800/80";
      } else if (completionRate >= 30) {
        rating = "NEEDS_EFFORT";
        ratingLabel = "Cần tăng tốc";
        ratingColor = "bg-amber-950/80 text-amber-400 border-amber-800/80";
      } else if (postVat > 0) {
        rating = "AT_RISK";
        ratingLabel = "Chậm tiến độ (Cảnh báo)";
        ratingColor = "bg-rose-950/80 text-rose-400 border-rose-800/80";
      } else {
        rating = "NO_SALES";
        ratingLabel = "Chưa có doanh số";
        ratingColor = "bg-amber-950/40 text-amber-500/80 border-amber-800/40";
      }

      return {
        id: repId,
        repId,
        name: repName,
        department: rep.department || "Phòng Kinh Doanh",
        position: rep.position || "NVKD",
        email: rep.email || "",
        phone: rep.phone || "",
        targetAmount,
        preVat,
        postVat,
        collected,
        debt,
        orderCount,
        collectionRate,
        completionRate,
        gap,
        rating,
        ratingLabel,
        ratingColor,
        monthPacePct
      };
    });
  }, [visibleSalesPersonnel, salesPersonnel, salesTargets, filteredTransactions, periodType, periodValue]);

  // Filtered Evaluations for Tab Search & Filter chips
  const filteredEvaluations = useMemo(() => {
    return repEvaluations.filter(rep => {
      // Filter chips
      if (kpiFilter === "assigned" && rep.targetAmount === 0) return false;
      if (kpiFilter === "unassigned" && rep.targetAmount > 0) return false;
      if (kpiFilter === "completed" && rep.completionRate < 100) return false;
      if (kpiFilter === "at_risk" && (rep.completionRate >= 50 || rep.targetAmount === 0)) return false;

      // Search term
      if (kpiSearchTerm.trim()) {
        const term = kpiSearchTerm.toLowerCase().trim();
        const matchName = rep.name.toLowerCase().includes(term);
        const matchId = rep.repId.toLowerCase().includes(term);
        const matchDept = rep.department.toLowerCase().includes(term);
        if (!matchName && !matchId && !matchDept) return false;
      }

      return true;
    });
  }, [repEvaluations, kpiFilter, kpiSearchTerm]);

  // Derived Team Aggregates
  const teamTotalTarget = useMemo(() => repEvaluations.reduce((sum, r) => sum + r.targetAmount, 0), [repEvaluations]);
  const teamTotalPreVat = useMemo(() => repEvaluations.reduce((sum, r) => sum + r.preVat, 0), [repEvaluations]);
  const teamTotalPostVat = useMemo(() => repEvaluations.reduce((sum, r) => sum + r.postVat, 0), [repEvaluations]);
  const teamTotalCollected = useMemo(() => repEvaluations.reduce((sum, r) => sum + r.collected, 0), [repEvaluations]);
  const teamTotalOrders = useMemo(() => repEvaluations.reduce((sum, r) => sum + r.orderCount, 0), [repEvaluations]);
  const teamCompletion = teamTotalTarget > 0 ? Math.round((teamTotalPostVat / teamTotalTarget) * 100) : 0;
  
  const assignedCount = useMemo(() => repEvaluations.filter(r => r.targetAmount > 0).length, [repEvaluations]);
  const unassignedCount = useMemo(() => repEvaluations.filter(r => r.targetAmount === 0).length, [repEvaluations]);
  const completedCount = useMemo(() => repEvaluations.filter(r => r.targetAmount > 0 && r.completionRate >= 100).length, [repEvaluations]);
  const onTrackCount = useMemo(() => repEvaluations.filter(r => r.targetAmount > 0 && r.completionRate >= 70 && r.completionRate < 100).length, [repEvaluations]);
  const inProgressCount = useMemo(() => repEvaluations.filter(r => r.targetAmount > 0 && r.completionRate >= 30 && r.completionRate < 70).length, [repEvaluations]);
  const atRiskCount = useMemo(() => repEvaluations.filter(r => r.targetAmount > 0 && r.completionRate < 30).length, [repEvaluations]);

  const monthPacePct = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    return periodType === "month" ? Math.round((currentDay / daysInMonth) * 100) : 50;
  }, [periodType]);

  // Dimension-based data aggregation for charts
  const aggregatedData = useMemo(() => {
    const map: Record<string, {
      id: string;
      label: string;
      subLabel?: string;
      category?: string;
      orderCount: number;
      revenue_net: number;
      vat: number;
      revenue_gross: number;
      discount: number;
      collected: number;
      debt: number;
      debt_rate: number;
      quantity: number;
      target: number;
      completion: number;
    }> = {};
    const categoryOrderSets: Record<string, Set<string>> = {};

    // For target evaluation dimension, initialize all personnel from staffList first
    if (analysisDimension === "target") {
      const staffList = (visibleSalesPersonnel && visibleSalesPersonnel.length > 0) ? visibleSalesPersonnel : salesPersonnel;
      staffList.forEach((p, idx) => {
        const repId = p.employee_id || p.id || p.employee_code || `REP-${idx}`;
        const repName = p.full_name || p.name || repId;
        const targetAmount = getRepTargetForPeriod(repId, repName);
        map[repId] = {
          id: repId,
          label: repName,
          subLabel: repId,
          category: p.department || p.position || "Mục tiêu KPI",
          orderCount: 0,
          revenue_net: 0,
          vat: 0,
          revenue_gross: 0,
          discount: 0,
          collected: 0,
          debt: 0,
          debt_rate: 100,
          quantity: 0,
          target: targetAmount,
          completion: 0
        };
      });
    }

    filteredTransactions.forEach(tx => {
      let key = "";
      let label = "";
      let subLabel = "";
      let category = "";

      if (analysisDimension === "employee") {
        key = tx.sales_rep_id || tx.sales_rep_name || "Khác";
        label = tx.sales_rep_name || tx.sales_rep_id;
        subLabel = tx.sales_rep_id;
        category = "Phòng Kinh Doanh";
      } else if (analysisDimension === "customer") {
        key = tx.customer_code || tx.customer_name;
        label = tx.customer_name;
        subLabel = tx.customer_code;
        category = tx.customer_group || "Khách hàng";
      } else if (analysisDimension === "customer_group") {
        key = tx.customer_group || "Nhóm chung";
        label = key;
        category = "Phân khúc khách hàng";
      } else if (analysisDimension === "debt") {
        key = tx.customer_code || tx.customer_name;
        label = tx.customer_name;
        subLabel = tx.sales_rep_name ? `Sale: ${tx.sales_rep_name}` : "";
        category = tx.customer_group || "Công nợ";
      } else if (analysisDimension === "category") {
        (tx.items || []).forEach((it: any) => {
          const cat = it.category || "Khác";
          if (!map[cat]) {
            map[cat] = {
              id: cat,
              label: cat,
              category: "Danh mục",
              orderCount: 0,
              revenue_net: 0,
              vat: 0,
              revenue_gross: 0,
              discount: 0,
              collected: 0,
              debt: 0,
              debt_rate: 100,
              quantity: 0,
              target: 0,
              completion: 0
            };
            categoryOrderSets[cat] = new Set();
          }
          const itemAmt = (Number(it.quantity) || 0) * Number(it.unitPrice || it.price || 0);
          const itemVat = Math.round(itemAmt * 0.08);
          const itemGross = itemAmt + itemVat;
          const isTxPaid = tx.debt_status === "PAID" || (tx.paid_amount >= tx.total_amount && tx.total_amount > 0);
          const paymentRatio = tx.total_amount > 0 ? Math.min(1, Math.max(0, (tx.paid_amount || 0) / tx.total_amount)) : (isTxPaid ? 1 : 0);
          const itemCollected = Math.round(itemGross * paymentRatio);
          const itemDebt = Math.max(0, itemGross - itemCollected);

          categoryOrderSets[cat].add(tx.order_code);
          map[cat].orderCount = categoryOrderSets[cat].size;
          map[cat].revenue_net += itemAmt;
          map[cat].vat += itemVat;
          map[cat].revenue_gross += itemGross;
          map[cat].collected += itemCollected;
          map[cat].debt += itemDebt;
          map[cat].quantity += Number(it.quantity) || 0;
        });
        return;
      } else if (analysisDimension === "product") {
        (tx.items || []).forEach((it: any) => {
          const pCode = it.productCode || "SP-GEN";
          const pName = it.productName || pCode;
          if (!map[pCode]) {
            map[pCode] = {
              id: pCode,
              label: `${pCode} - ${pName}`,
              subLabel: pCode,
              category: it.category || "Sản phẩm",
              orderCount: 0,
              revenue_net: 0,
              vat: 0,
              revenue_gross: 0,
              discount: 0,
              collected: 0,
              debt: 0,
              debt_rate: 100,
              quantity: 0,
              target: 0,
              completion: 0
            };
          }
          const itemAmt = (Number(it.quantity) || 0) * Number(it.unitPrice || it.price || 0);
          const itemVat = Math.round(itemAmt * 0.08);
          const itemGross = itemAmt + itemVat;
          const isTxPaid = tx.debt_status === "PAID" || (tx.paid_amount >= tx.total_amount && tx.total_amount > 0);
          const paymentRatio = tx.total_amount > 0 ? Math.min(1, Math.max(0, (tx.paid_amount || 0) / tx.total_amount)) : (isTxPaid ? 1 : 0);
          const itemCollected = Math.round(itemGross * paymentRatio);
          const itemDebt = Math.max(0, itemGross - itemCollected);

          map[pCode].orderCount += 1;
          map[pCode].revenue_net += itemAmt;
          map[pCode].vat += itemVat;
          map[pCode].revenue_gross += itemGross;
          map[pCode].collected += itemCollected;
          map[pCode].debt += itemDebt;
          map[pCode].quantity += Number(it.quantity) || 0;
        });
        return;
      } else if (analysisDimension === "trend") {
        const p = parseNormalizedDate(tx.date);
        key = p ? `${p.year}-${String(p.month).padStart(2, "0")}` : "Khác";
        label = p ? `Tháng ${p.month}/${p.year}` : key;
        category = "Dòng thời gian";
      } else if (analysisDimension === "target") {
        const repId = tx.sales_rep_id || tx.seller_id;
        const repName = tx.sales_rep_name || tx.seller_name;
        const existingKey = Object.keys(map).find(k => k === repId || map[k].label === repName);
        key = existingKey || repId || "REP";
        label = repName || tx.sales_rep_name || "Nhân viên";
        subLabel = key;
        category = "Mục tiêu KPI";
      }

      if (!map[key]) {
        // Individual target
        const repTarget = getRepTargetForPeriod(key, label);
        map[key] = {
          id: key,
          label,
          subLabel,
          category,
          orderCount: 0,
          revenue_net: 0,
          vat: 0,
          revenue_gross: 0,
          discount: 0,
          collected: 0,
          debt: 0,
          debt_rate: 100,
          quantity: 0,
          target: repTarget,
          completion: 0
        };
      }

      map[key].orderCount += 1;
      map[key].revenue_net += tx.subtotal || 0;
      map[key].vat += tx.vat_amount || 0;
      map[key].revenue_gross += tx.total_amount || 0;
      map[key].discount += tx.discount_amount || 0;
      map[key].collected += tx.paid_amount || 0;
      map[key].debt += tx.debt_amount || 0;
      (tx.items || []).forEach((it: any) => {
        map[key].quantity += Number(it.quantity) || 0;
      });
    });

    // Post calculate rates
    const res = Object.values(map).map(item => {
      const debt_rate = item.revenue_gross > 0 ? Math.round((item.collected / item.revenue_gross) * 100) : 100;
      const completion = item.target > 0 ? Math.round((item.revenue_gross / item.target) * 100) : 0;
      return {
        ...item,
        debt_rate,
        completion
      };
    });

    // Sorting by active metric
    return res.sort((a, b) => {
      if (activeMetric === "debt_rate") return b.debt_rate - a.debt_rate;
      if (activeMetric === "debt") return b.debt - a.debt;
      if (activeMetric === "collected") return b.collected - a.collected;
      if (activeMetric === "discount") return b.discount - a.discount;
      if (activeMetric === "revenue_net") return b.revenue_net - a.revenue_net;
      if (activeMetric === "vat") return b.vat - a.vat;
      if (activeMetric === "quantity") return b.quantity - a.quantity;
      return b.revenue_gross - a.revenue_gross;
    });
  }, [filteredTransactions, analysisDimension, activeMetric, salesTargets, visibleSalesPersonnel, salesPersonnel, periodType, periodValue]);

  // Export Dedicated Personnel Target & KPI Evaluation Report
  const handleExportKpiExcel = () => {
    try {
      const rows = repEvaluations.map((r, idx) => ({
        "STT": idx + 1,
        "Mã Nhân Viên": r.repId,
        "Họ Và Tên": r.name,
        "Phòng Ban": r.department,
        "Chức Vụ": r.position,
        "Chỉ Tiêu Được Giao (VNĐ)": r.targetAmount,
        "Doanh Số Trước VAT (VNĐ)": r.preVat,
        "Doanh Số Sau VAT (VNĐ)": r.postVat,
        "Số Đơn Hàng": r.orderCount,
        "Thực Thu Dòng Tiền (VNĐ)": r.collected,
        "Công Nợ Chưa Thu (VNĐ)": r.debt,
        "Tỷ Lệ Thu Hồi Nợ (%)": `${r.collectionRate}%`,
        "Chênh Lệch / Khoảng Cách (VNĐ)": r.gap,
        "Tỷ Lệ Đạt KPI (%)": `${r.completionRate}%`,
        "Xếp Loại Đánh Giá": r.ratingLabel,
        "Chu Kỳ": periodType === "all" ? "Toàn bộ" : periodValue
      }));

      rows.push({
        "STT": "" as any,
        "Mã Nhân Viên": "",
        "Họ Và Tên": "TỔNG CỘNG TOÀN CÔNG TY",
        "Phòng Ban": "",
        "Chức Vụ": "",
        "Chỉ Tiêu Được Giao (VNĐ)": teamTotalTarget,
        "Doanh Số Trước VAT (VNĐ)": teamTotalPreVat,
        "Doanh Số Sau VAT (VNĐ)": teamTotalPostVat,
        "Số Đơn Hàng": teamTotalOrders,
        "Thực Thu Dòng Tiền (VNĐ)": teamTotalCollected,
        "Công Nợ Chưa Thu (VNĐ)": teamTotalPostVat - teamTotalCollected,
        "Tỷ Lệ Thu Hồi Nợ (%)": "",
        "Chênh Lệch / Khoảng Cách (VNĐ)": teamTotalPostVat - teamTotalTarget,
        "Tỷ Lệ Đạt KPI (%)": `${teamCompletion}%`,
        "Xếp Loại Đánh Giá": "",
        "Chu Kỳ": ""
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "DanhGiaChiTieuKPI");
      XLSX.writeFile(workbook, `BaoCao_DanhGia_ChiTieu_NhanVien_${periodValue || "ToanBo"}.xlsx`);
    } catch (err) {
      console.error("Export KPI Excel failed:", err);
    }
  };

  // Export Comprehensive Excel Report
  const handleExportAnalyticsExcel = () => {
    try {
      if (analysisDimension === "target") {
        handleExportKpiExcel();
        return;
      }
      const rows = aggregatedData.map((d, idx) => ({
        "STT": idx + 1,
        "Đối Tượng / Phân Loại": d.label,
        "Mã / Phụ Trách": d.subLabel || "—",
        "Phân Nhóm": d.category || "—",
        "Số Đơn Hàng": d.orderCount,
        "Doanh Số Trước VAT (VNĐ)": d.revenue_net,
        "Tiền Thuế VAT (VNĐ)": d.vat,
        "Doanh Số Sau VAT (VNĐ)": d.revenue_gross,
        "Chiết Khấu (VNĐ)": d.discount,
        "Thực Thu / Đã Thanh Toán (VNĐ)": d.collected,
        "Công Nợ Tồn Đọng (VNĐ)": d.debt,
        "Tỉ Lệ Thu Hồi Công Nợ (%)": `${d.debt_rate}%`,
        "Sản Lượng (Kit/Cái)": d.quantity,
        "Chỉ Tiêu KPI (VNĐ)": d.target,
        "Tỷ Lệ Đạt KPI (%)": `${d.completion}%`
      }));

      // Append Total Row
      rows.push({
        "STT": "" as any,
        "Đối Tượng / Phân Loại": "TỔNG CỘNG HỆ THỐNG",
        "Mã / Phụ Trách": "",
        "Phân Nhóm": "",
        "Số Đơn Hàng": summaryKpis.orderCount,
        "Doanh Số Trước VAT (VNĐ)": summaryKpis.preVat,
        "Tiền Thuế VAT (VNĐ)": summaryKpis.postVat - summaryKpis.preVat,
        "Doanh Số Sau VAT (VNĐ)": summaryKpis.postVat,
        "Chiết Khấu (VNĐ)": summaryKpis.discount,
        "Thực Thu / Đã Thanh Toán (VNĐ)": summaryKpis.collected,
        "Công Nợ Tồn Đọng (VNĐ)": summaryKpis.debt,
        "Tỉ Lệ Thu Hồi Công Nợ (%)": `${summaryKpis.collectionRate}%`,
        "Sản Lượng (Kit/Cái)": summaryKpis.totalQty,
        "Chỉ Tiêu KPI (VNĐ)": summaryKpis.targetAmount,
        "Tỷ Lệ Đạt KPI (%)": `${summaryKpis.completionRate}%`
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Bao_Cao_Phan_Tich");
      XLSX.writeFile(wb, `Bao_Cao_Doanh_So_Cong_No_${periodValue}_${todayVN()}.xlsx`);
    } catch (err) {
      console.error(err);
      alert("Lỗi xuất file Excel phân tích");
    }
  };

  // Helper for metric value
  const getMetricValue = (d: any) => {
    if (activeMetric === "revenue_net") return d.revenue_net;
    if (activeMetric === "vat") return d.vat;
    if (activeMetric === "discount") return d.discount;
    if (activeMetric === "collected") return d.collected;
    if (activeMetric === "debt") return d.debt;
    if (activeMetric === "debt_rate") return d.debt_rate;
    if (activeMetric === "quantity") return d.quantity;
    return d.revenue_gross;
  };

  const getMetricUnit = () => {
    if (activeMetric === "debt_rate") return "%";
    if (activeMetric === "quantity") return " Kit/Cái";
    return "đ";
  };

  const formatMetricDisplay = (val: number) => {
    if (activeMetric === "debt_rate") return `${val}%`;
    if (activeMetric === "quantity") return `${new Intl.NumberFormat("vi-VN").format(val)} Kit`;
    return fmtCurrency(val);
  };

  const maxChartVal = Math.max(...aggregatedData.map(d => getMetricValue(d))) || 1;

  // Distinct palette colors for donut chart & items
  const PALETTE = [
    "#0ea5e9", // Indigo
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#0ea5e9", // Sky
    "#a855f7", // Purple
    "#f43f5e", // Rose
    "#14b8a6", // Teal
    "#0ea5e9"  // Orange
  ];

  return (
    <div className="space-y-6">
      {/* 1. Header Filter Bar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-200 font-mono tracking-wider uppercase">
              PHÂN TÍCH HIỆU SUẤT DOANH SỐ, TÀI CHÍNH & CÔNG NỢ ĐA CHIỀU
            </h2>
            <span className="text-[10px] bg-indigo-950/80 text-indigo-400 px-2.5 py-0.5 rounded-full border border-indigo-800/60 font-bold font-mono">
              {filteredTransactions.length} giao dịch đối soát
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Đo lường đa chiều: Doanh số trước/sau VAT, Thuế VAT, Chiết khấu, Dòng tiền thực thu, Công nợ và Tỷ lệ thu hồi nợ theo từng Sale, Khách hàng & Nhóm phân khúc.
          </p>
        </div>

        {/* Global Filter Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Cycle type */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
            <span className="text-[10px] text-slate-500 font-bold uppercase">Chu kỳ:</span>
            <select
              value={periodType}
              onChange={(e) => {
                const t = e.target.value as any;
                setPeriodType(t);
                if (t === "month") setPeriodValue("2026-08");
                else if (t === "quarter") setPeriodValue("2026-Q3");
                else if (t === "year") setPeriodValue("2026");
                else setPeriodValue("all");
              }}
              className="bg-transparent text-white font-bold cursor-pointer outline-none border-none focus:ring-0"
            >
              <option value="month" className="bg-slate-950 text-white font-bold">Tháng</option>
              <option value="quarter" className="bg-slate-950 text-white font-bold">Quý</option>
              <option value="year" className="bg-slate-950 text-white font-bold">Năm</option>
              <option value="all" className="bg-slate-950 text-white font-bold">Toàn bộ thời gian</option>
            </select>
          </div>

          {/* Specific period */}
          {periodType !== "all" && (
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <select
                value={periodValue}
                onChange={(e) => setPeriodValue(e.target.value)}
                className="bg-transparent text-white font-bold cursor-pointer outline-none border-none focus:ring-0"
              >
                {periodType === "month" && (
                  <>
                    <option value="2026-01" className="bg-slate-950 text-white">Tháng 1 / 2026</option>
                    <option value="2026-02" className="bg-slate-950 text-white">Tháng 2 / 2026</option>
                    <option value="2026-03" className="bg-slate-950 text-white">Tháng 3 / 2026</option>
                    <option value="2026-04" className="bg-slate-950 text-white">Tháng 4 / 2026</option>
                    <option value="2026-05" className="bg-slate-950 text-white">Tháng 5 / 2026</option>
                    <option value="2026-06" className="bg-slate-950 text-white">Tháng 6 / 2026</option>
                    <option value="2026-07" className="bg-slate-950 text-white">Tháng 7 / 2026</option>
                    <option value="2026-08" className="bg-slate-950 text-white">Tháng 8 / 2026</option>
                    <option value="2026-09" className="bg-slate-950 text-white">Tháng 9 / 2026</option>
                    <option value="2026-10" className="bg-slate-950 text-white">Tháng 10 / 2026</option>
                    <option value="2026-11" className="bg-slate-950 text-white">Tháng 11 / 2026</option>
                    <option value="2026-12" className="bg-slate-950 text-white">Tháng 12 / 2026</option>
                  </>
                )}
                {periodType === "quarter" && (
                  <>
                    <option value="2026-Q1" className="bg-slate-950 text-white">Quý 1 / 2026</option>
                    <option value="2026-Q2" className="bg-slate-950 text-white">Quý 2 / 2026</option>
                    <option value="2026-Q3" className="bg-slate-950 text-white">Quý 3 / 2026</option>
                    <option value="2026-Q4" className="bg-slate-950 text-white">Quý 4 / 2026</option>
                  </>
                )}
                {periodType === "year" && (
                  <>
                    <option value="2026" className="bg-slate-950 text-white">Năm 2026</option>
                    <option value="2027" className="bg-slate-950 text-white">Năm 2027</option>
                    <option value="2028" className="bg-slate-950 text-white">Năm 2028</option>
                  </>
                )}
              </select>
            </div>
          )}

          {/* Sales rep filter */}
          {isManagerOrAdmin && (
            <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
              <User className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[10px] text-slate-500 font-bold uppercase">Sale:</span>
              <select
                value={selectedRepId}
                onChange={(e) => setSelectedRepId(e.target.value)}
                className="bg-transparent text-white font-bold cursor-pointer outline-none border-none focus:ring-0 max-w-[150px]"
              >
                <option value="all" className="bg-slate-950 text-slate-300 font-bold">
                  -- Tất cả nhân viên ({salesPersonnel.length}) --
                </option>
                {salesPersonnel.map(p => (
                  <option key={p.employee_id} value={p.employee_id} className="bg-slate-950 text-white font-bold">
                    {p.full_name} ({p.employee_code || p.employee_id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Export Excel Button */}
          <button
            onClick={handleExportAnalyticsExcel}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow-sm shadow-emerald-950/40 cursor-pointer"
            title="Tải bảng phân tích đa chiều dưới định dạng Excel (.xlsx)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Xuất Excel</span>
          </button>

          {/* Target assignment modal button */}
          {isManagerOrAdmin && (
            <button
              onClick={() => onOpenTargetModal()}
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Giao Chỉ Tiêu</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Executive Financial & Sales KPI Cards (6 Pillars) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {/* 1. Pre-VAT Revenue */}
        <div className="bg-slate-900/50 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-4 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
            <span>Trước VAT (Thuần)</span>
            <DollarSign className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-lg font-black font-mono text-white mt-1.5">
            {fmtCurrency(summaryKpis.preVat)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Tiền hàng gốc</span>
            <span className="font-mono text-sky-400 font-bold">{summaryKpis.orderCount} đơn</span>
          </div>
        </div>

        {/* 2. Gross Revenue (Post-VAT) */}
        <div className="bg-slate-900/50 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-4 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
            <span>Sau VAT (Hóa đơn)</span>
            <Building2 className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-lg font-black font-mono text-indigo-400 mt-1.5">
            {fmtCurrency(summaryKpis.postVat)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Thuế VAT:</span>
            <span className="font-mono text-slate-300 font-semibold">{fmtCurrency(summaryKpis.postVat - summaryKpis.preVat)}</span>
          </div>
        </div>

        {/* 3. Discounts */}
        <div className="bg-slate-900/50 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-4 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
            <span>Chiết Khấu</span>
            <Percent className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg font-black font-mono text-amber-400 mt-1.5">
            {fmtCurrency(summaryKpis.discount)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Tỷ lệ CK BQ:</span>
            <span className="font-mono text-amber-300 font-bold">
              {summaryKpis.preVat > 0 ? (summaryKpis.discount / summaryKpis.preVat * 100).toFixed(1) : 0}%
            </span>
          </div>
        </div>

        {/* 4. Collected (Cash flow) */}
        <div className="bg-slate-900/50 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-4 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
            <span>Thực Thu (Đã Thu)</span>
            <CreditCard className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-black font-mono text-emerald-400 mt-1.5">
            {fmtCurrency(summaryKpis.collected)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Dòng tiền vào</span>
            <span className="font-mono text-emerald-300 font-bold">{summaryKpis.collectionRate}%</span>
          </div>
        </div>

        {/* 5. Outstanding Debt */}
        <div className="bg-slate-900/50 border border-slate-800 hover:border-rose-500/50 rounded-2xl p-4 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
            <span>Công Nợ Còn Lại</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-lg font-black font-mono text-rose-400 mt-1.5">
            {fmtCurrency(summaryKpis.debt)}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Chưa thu hồi</span>
            <span className="font-mono text-rose-300 font-bold">{100 - summaryKpis.collectionRate}%</span>
          </div>
        </div>

        {/* 6. Target Completion */}
        <div className="bg-slate-900/50 border border-slate-800 hover:border-purple-500/50 rounded-2xl p-4 transition-all">
          <div className="flex items-center justify-between text-slate-400 text-[10px] uppercase font-bold tracking-wider">
            <span>Tỷ Lệ Đạt KPI</span>
            <Award className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-lg font-black font-mono text-purple-400 mt-1.5">
            {summaryKpis.completionRate}%
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div
              className={cn(
                "h-full transition-all duration-700",
                summaryKpis.completionRate >= 100 ? "bg-emerald-500" : summaryKpis.completionRate >= 60 ? "bg-indigo-500" : "bg-amber-500"
              )}
              style={{ width: `${Math.min(100, Math.max(5, summaryKpis.completionRate))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 3. Main Dashboard Body: 2 Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Dimension Tabs + Metric Switcher + Chart Type Switcher + Dynamic Visualizations */}
        <div className="lg:col-span-2 space-y-4">
          {/* Dimension Selector Tabs */}
          <div className="flex flex-wrap gap-1 bg-slate-950 p-1.5 border border-slate-800 rounded-2xl">
            <button
              onClick={() => setAnalysisDimension("employee")}
              className={cn(
                "flex-1 min-w-[110px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "employee" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Theo Sale</span>
            </button>
            <button
              onClick={() => setAnalysisDimension("customer")}
              className={cn(
                "flex-1 min-w-[120px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "customer" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Theo Khách Hàng</span>
            </button>
            <button
              onClick={() => setAnalysisDimension("customer_group")}
              className={cn(
                "flex-1 min-w-[130px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "customer_group" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Nhóm Khách Hàng</span>
            </button>
            <button
              onClick={() => setAnalysisDimension("debt")}
              className={cn(
                "flex-1 min-w-[130px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "debt" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Công Nợ & Thu Hồi</span>
            </button>
            <button
              onClick={() => setAnalysisDimension("product")}
              className={cn(
                "flex-1 min-w-[110px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "product" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Theo Mã Hàng</span>
            </button>
            <button
              onClick={() => setAnalysisDimension("category")}
              className={cn(
                "flex-1 min-w-[110px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "category" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Nhóm Sản Phẩm</span>
            </button>
            <button
              onClick={() => setAnalysisDimension("trend")}
              className={cn(
                "flex-1 min-w-[110px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "trend" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
              )}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Theo Thời Gian</span>
            </button>
            <button
              onClick={() => setAnalysisDimension("target")}
              className={cn(
                "flex-1 min-w-[170px] text-xs font-bold py-2 px-3 rounded-xl transition-all text-center flex items-center justify-center gap-1.5",
                analysisDimension === "target"
                  ? "bg-gradient-to-r from-amber-500 to-indigo-600 text-white shadow-md shadow-indigo-950/50"
                  : "text-amber-400 hover:text-amber-300 hover:bg-slate-900 border border-amber-500/30"
              )}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Theo Dõi & Đánh Giá Chỉ Tiêu</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20 text-white font-mono font-bold">
                {visibleSalesPersonnel.length || salesPersonnel.length}
              </span>
            </button>
          </div>

          {/* Metric Selector Pills & Chart Type Switcher (only for other dimensions) */}
          {analysisDimension !== "target" && (
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-slate-900/60 p-2.5 rounded-2xl border border-slate-800">
            {/* Metric Pills */}
            <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1 hidden sm:inline">
                Chỉ số:
              </span>
              <button
                onClick={() => setActiveMetric("revenue_gross")}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                  activeMetric === "revenue_gross" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white bg-slate-950/60"
                )}
              >
                Sau VAT
              </button>
              <button
                onClick={() => setActiveMetric("revenue_net")}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                  activeMetric === "revenue_net" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white bg-slate-950/60"
                )}
              >
                Trước VAT
              </button>
              <button
                onClick={() => setActiveMetric("discount")}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                  activeMetric === "discount" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white bg-slate-950/60"
                )}
              >
                Chiết Khấu
              </button>
              <button
                onClick={() => setActiveMetric("collected")}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                  activeMetric === "collected" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white bg-slate-950/60"
                )}
              >
                Thực Thu
              </button>
              <button
                onClick={() => setActiveMetric("debt")}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                  activeMetric === "debt" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white bg-slate-950/60"
                )}
              >
                Công Nợ
              </button>
              <button
                onClick={() => setActiveMetric("debt_rate")}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                  activeMetric === "debt_rate" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white bg-slate-950/60"
                )}
              >
                Tỷ Lệ Thu Hồi (%)
              </button>
              <button
                onClick={() => setActiveMetric("quantity")}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all whitespace-nowrap",
                  activeMetric === "quantity" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white bg-slate-950/60"
                )}
              >
                Sản Lượng
              </button>
            </div>

            {/* Chart Type Switcher Icons */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0 self-end md:self-auto">
              <button
                onClick={() => setChartView("vertical_bar")}
                className={cn(
                  "p-1.5 rounded-lg text-xs transition-all cursor-pointer",
                  chartView === "vertical_bar" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                )}
                title="Biểu đồ Cột dọc"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setChartView("horizontal_bar")}
                className={cn(
                  "p-1.5 rounded-lg text-xs transition-all cursor-pointer rotate-90",
                  chartView === "horizontal_bar" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                )}
                title="Biểu đồ Cột ngang (Xếp hạng)"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setChartView("donut")}
                className={cn(
                  "p-1.5 rounded-lg text-xs transition-all cursor-pointer",
                  chartView === "donut" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                )}
                title="Biểu đồ Tròn / Donut (Cơ cấu %)"
              >
                <PieChart className="w-4 h-4" />
              </button>
              <button
                onClick={() => setChartView("line_trend")}
                className={cn(
                  "p-1.5 rounded-lg text-xs transition-all cursor-pointer",
                  chartView === "line_trend" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                )}
                title="Biểu đồ Đường xu hướng"
              >
                <TrendingUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => setChartView("pivot_table")}
                className={cn(
                  "p-1.5 rounded-lg text-xs transition-all cursor-pointer",
                  chartView === "pivot_table" ? "bg-indigo-600 text-white shadow" : "text-slate-400 hover:text-white"
                )}
                title="Bảng Phân Tích Ma Trận Pivot"
              >
                <Table className="w-4 h-4" />
              </button>
            </div>
          </div>
          )}

          {/* DYNAMIC KPI BOARD / CHART RENDER AREA */}
          {analysisDimension === "target" ? (
            /* DEDICATED PERSONNEL TARGET TRACKING & EVALUATION BOARD */
            <div className="space-y-5">
              {/* 1. Header Bar with Metrics & Actions */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-white font-mono tracking-wider uppercase flex items-center gap-2">
                      <Target className="w-4 h-4 text-amber-400" />
                      <span>BẢNG THEO DÕI & ĐÁNH GIÁ CHỈ TIÊU TOÀN BỘ NHÂN VIÊN</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Giám sát tiến độ hoàn thành doanh số, tỷ lệ đạt KPI, chênh lệch về đích và xếp loại của{" "}
                      <strong className="text-amber-400 font-bold">{repEvaluations.length} nhân sự kinh doanh</strong> trong kỳ {periodType === "all" ? "Toàn bộ" : periodValue}.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                    <button
                      onClick={handleExportKpiExcel}
                      className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow-sm cursor-pointer"
                      title="Xuất bảng đánh giá chỉ tiêu của toàn bộ nhân viên ra file Excel (.xlsx)"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Xuất Báo Cáo KPI</span>
                    </button>
                    {isManagerOrAdmin && (
                      <button
                        onClick={() => onOpenTargetModal()}
                        className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition-all shadow-sm cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Giao Chỉ Tiêu</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 4 Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Card 1: Team Total Target */}
                  <div className="bg-slate-950/70 border border-amber-500/20 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-amber-400">
                      <span>Tổng Chỉ Tiêu Giao</span>
                      <Target className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="text-lg font-black font-mono text-white mt-1">
                      {fmtCurrency(teamTotalTarget)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                      <span>Đã phân bổ cho:</span>
                      <span className="font-mono text-amber-400 font-bold">{assignedCount} / {repEvaluations.length} nhân sự</span>
                    </div>
                  </div>

                  {/* Card 2: Team Total Actual */}
                  <div className="bg-slate-950/70 border border-indigo-500/20 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                      <span>Doanh Số Thực Đạt</span>
                      <DollarSign className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div className="text-lg font-black font-mono text-indigo-400 mt-1">
                      {fmtCurrency(teamTotalPostVat)}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                      <span>Trước VAT: {fmtCurrency(teamTotalPreVat)}</span>
                      <span className="font-mono text-indigo-300 font-bold">{teamTotalOrders} đơn</span>
                    </div>
                  </div>

                  {/* Card 3: Team Completion Rate */}
                  <div className="bg-slate-950/70 border border-emerald-500/20 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                      <span>Tỷ Lệ Đạt KPI Đội</span>
                      <Award className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-lg font-black font-mono text-emerald-400 mt-1 flex items-baseline justify-between">
                      <span>{teamCompletion}%</span>
                      <span className="text-[11px] font-mono text-slate-400 font-normal">
                        {teamTotalPostVat >= teamTotalTarget && teamTotalTarget > 0 ? (
                          <span className="text-emerald-400 font-bold">+{fmtCurrency(teamTotalPostVat - teamTotalTarget)}</span>
                        ) : (
                          <span className="text-rose-400 font-bold">{fmtCurrency(teamTotalPostVat - teamTotalTarget)}</span>
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden mt-2">
                      <div
                        className={cn(
                          "h-full transition-all duration-500",
                          teamCompletion >= 100 ? "bg-emerald-500" : teamCompletion >= 60 ? "bg-indigo-500" : "bg-amber-500"
                        )}
                        style={{ width: `${Math.min(100, Math.max(3, teamCompletion))}%` }}
                      />
                    </div>
                  </div>

                  {/* Card 4: Status breakdown & Month Pace */}
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <span>Tình Trạng Về Đích</span>
                      <Flame className="w-4 h-4 text-amber-500" />
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-1.5 text-xs font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 font-bold" title="Đã về đích (>=100%)">
                        {completedCount} đạt
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-400 border border-indigo-800/60 font-bold" title="Bám sát tiến độ (>=70%)">
                        {onTrackCount} tốt
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800/60 font-bold" title="Cần tăng tốc (30-69%)">
                        {inProgressCount} nỗ lực
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/60 font-bold" title="Chậm / Chưa có doanh số">
                        {atRiskCount} cảnh báo
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-2 flex items-center justify-between">
                      <span>Nhịp độ ngày trong tháng:</span>
                      <span className="text-slate-300 font-bold font-mono">{monthPacePct}% chu kỳ</span>
                    </div>
                  </div>
                </div>

                {/* Filter chips & Search Bar & View Mode Toggle */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  {/* Filter chips */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setKpiFilter("all")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        kpiFilter === "all" ? "bg-indigo-600 text-white shadow-xs" : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
                      )}
                    >
                      Tất cả ({repEvaluations.length})
                    </button>
                    <button
                      onClick={() => setKpiFilter("assigned")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        kpiFilter === "assigned" ? "bg-amber-600 text-white shadow-xs" : "bg-slate-950 text-slate-400 hover:text-amber-300 border border-slate-800"
                      )}
                    >
                      Đã có chỉ tiêu ({assignedCount})
                    </button>
                    <button
                      onClick={() => setKpiFilter("unassigned")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        kpiFilter === "unassigned" ? "bg-slate-700 text-white shadow-xs" : "bg-slate-950 text-slate-400 hover:text-white border border-slate-800"
                      )}
                    >
                      Chưa giao ({unassignedCount})
                    </button>
                    <button
                      onClick={() => setKpiFilter("completed")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        kpiFilter === "completed" ? "bg-emerald-600 text-white shadow-xs" : "bg-slate-950 text-slate-400 hover:text-emerald-300 border border-slate-800"
                      )}
                    >
                      Đã về đích ({completedCount})
                    </button>
                    <button
                      onClick={() => setKpiFilter("at_risk")}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer",
                        kpiFilter === "at_risk" ? "bg-rose-600 text-white shadow-xs" : "bg-slate-950 text-slate-400 hover:text-rose-300 border border-slate-800"
                      )}
                    >
                      Cần bứt phá ({atRiskCount})
                    </button>
                  </div>

                  {/* Search and View Mode */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:w-48">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Tìm nhân viên / mã..."
                        value={kpiSearchTerm}
                        onChange={(e) => setKpiSearchTerm(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="flex items-center bg-slate-950 p-0.5 border border-slate-800 rounded-xl shrink-0">
                      <button
                        onClick={() => setKpiViewMode("table_and_chart")}
                        className={cn(
                          "px-2 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer",
                          kpiViewMode === "table_and_chart" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                        )}
                        title="Xem cả biểu đồ và bảng dữ liệu"
                      >
                        Tất cả
                      </button>
                      <button
                        onClick={() => setKpiViewMode("table_only")}
                        className={cn(
                          "px-2 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer",
                          kpiViewMode === "table_only" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                        )}
                        title="Chỉ xem bảng dữ liệu chi tiết"
                      >
                        Bảng
                      </button>
                      <button
                        onClick={() => setKpiViewMode("chart_only")}
                        className={cn(
                          "px-2 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer",
                          kpiViewMode === "chart_only" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                        )}
                        title="Chỉ xem biểu đồ so sánh trực quan"
                      >
                        Biểu đồ
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Visual Comparative Chart (Target vs Actual) */}
              {(kpiViewMode === "table_and_chart" || kpiViewMode === "chart_only") && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-400 font-mono tracking-wider uppercase">
                        BIỂU ĐỒ SO SÁNH CHỈ TIÊU VS THỰC ĐẠT THEO NHÂN VIÊN
                      </h4>
                      <p className="text-[10px] text-slate-400">
                        Cột vàng hổ phách: Mục tiêu được giao · Cột tím xanh: Doanh số thực tế sau VAT
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-bold bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                        <span className="text-amber-300">Chỉ Tiêu</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                        <span className="text-indigo-300">Thực Đạt</span>
                      </div>
                    </div>
                  </div>

                  {/* Horizontal Bars Comparison */}
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {filteredEvaluations.map((rep) => {
                      const maxVal = Math.max(1, ...repEvaluations.map(r => Math.max(r.targetAmount, r.postVat)));
                      const targetWidth = Math.max(2, Math.round((rep.targetAmount / maxVal) * 100));
                      const actualWidth = Math.max(2, Math.round((rep.postVat / maxVal) * 100));

                      return (
                        <div key={rep.id} className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-bold text-[10px] flex items-center justify-center shrink-0">
                                {rep.name.slice(0, 1).toUpperCase()}
                              </div>
                              <span className="font-bold text-white">{rep.name}</span>
                              <span className="text-[10px] text-slate-400 font-mono">({rep.repId})</span>
                              <span className={cn("text-[10px] px-2 py-0.2 rounded-full border font-bold", rep.ratingColor)}>
                                {rep.ratingLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 font-mono text-xs">
                              <span className="text-amber-400 font-semibold" title="Chỉ tiêu">
                                Mục tiêu: {fmtCurrency(rep.targetAmount)}
                              </span>
                              <span className="text-indigo-400 font-bold" title="Thực đạt">
                                Đạt: {fmtCurrency(rep.postVat)}
                              </span>
                              <span className={cn(
                                "font-bold px-1.5 py-0.5 rounded text-[11px]",
                                rep.completionRate >= 100 ? "bg-emerald-950 text-emerald-400" : "bg-slate-800 text-slate-300"
                              )}>
                                {rep.completionRate}%
                              </span>
                            </div>
                          </div>

                          {/* Dual progress bars */}
                          <div className="space-y-1 pt-1">
                            {/* Target bar */}
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-amber-400/80 font-mono w-14 shrink-0">Chỉ tiêu:</span>
                              <div className="flex-1 bg-slate-900 h-2 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-400/80 rounded-full transition-all duration-500"
                                  style={{ width: `${targetWidth}%` }}
                                />
                              </div>
                            </div>
                            {/* Actual bar */}
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] text-indigo-400 font-mono w-14 shrink-0">Thực đạt:</span>
                              <div className="flex-1 bg-slate-900 h-2 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    rep.completionRate >= 100 ? "bg-emerald-500" : "bg-indigo-500"
                                  )}
                                  style={{ width: `${actualWidth}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. Comprehensive Personnel Target Evaluation Table */}
              {(kpiViewMode === "table_and_chart" || kpiViewMode === "table_only") && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div>
                      <h4 className="text-xs font-bold text-indigo-400 font-mono tracking-wider uppercase">
                        BẢNG ĐÁNH GIÁ CHỈ TIÊU CHI TIẾT CỦA TOÀN BỘ NHÂN VIÊN
                      </h4>
                      <p className="text-[10px] text-slate-400">
                        Hiển thị đầy đủ {filteredEvaluations.length} nhân sự · Đánh giá mức độ hoàn thành và chênh lệch doanh số
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-950/80 text-slate-400 font-mono text-[10px] uppercase tracking-wider border-b border-slate-800">
                          <th className="p-3">STT</th>
                          <th className="p-3 min-w-[180px]">Nhân Viên Kinh Doanh</th>
                          <th className="p-3 text-right min-w-[130px]">Chỉ Tiêu (VNĐ)</th>
                          <th className="p-3 text-right min-w-[130px]">Trước VAT (Thuần)</th>
                          <th className="p-3 text-right min-w-[140px]">Sau VAT (Hóa đơn)</th>
                          <th className="p-3 text-right min-w-[130px]">Thực Thu Dòng Tiền</th>
                          <th className="p-3 text-right min-w-[130px]">Khoảng Cách Về Đích</th>
                          <th className="p-3 text-center min-w-[140px]">Tỷ Lệ Đạt KPI</th>
                          <th className="p-3 text-center min-w-[130px]">Đánh Giá Xếp Loại</th>
                          <th className="p-3 text-center min-w-[100px]">Thao Tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filteredEvaluations.map((rep, idx) => (
                          <tr key={rep.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="p-3 font-mono text-slate-500 font-semibold">{idx + 1}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                                  {rep.name.slice(0, 1).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-bold text-white hover:text-indigo-400 transition-colors">
                                    {rep.name}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                                    <span>{rep.repId}</span>
                                    <span>•</span>
                                    <span>{rep.position || "NVKD"}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            {/* Target Column */}
                            <td className="p-3 text-right font-mono font-bold">
                              {rep.targetAmount > 0 ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <span className="text-amber-400">{fmtCurrency(rep.targetAmount)}</span>
                                  {isManagerOrAdmin && (
                                    <button
                                      onClick={() => onOpenTargetModal(rep.repId)}
                                      className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                                      title="Chỉnh sửa chỉ tiêu cho nhân viên này"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  <span className="text-[10px] text-slate-500 italic">Chưa giao</span>
                                  {isManagerOrAdmin && (
                                    <button
                                      onClick={() => onOpenTargetModal(rep.repId)}
                                      className="px-2 py-0.5 rounded-md bg-indigo-600/80 hover:bg-indigo-600 text-white text-[10px] font-bold transition-colors cursor-pointer"
                                    >
                                      + Giao
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                            {/* Pre-VAT Revenue */}
                            <td className="p-3 text-right font-mono text-slate-300 font-semibold">
                              {fmtCurrency(rep.preVat)}
                            </td>
                            {/* Post-VAT Revenue */}
                            <td className="p-3 text-right font-mono font-bold text-indigo-400">
                              <div>{fmtCurrency(rep.postVat)}</div>
                              <div className="text-[9px] text-slate-500 font-normal">{rep.orderCount} đơn hàng</div>
                            </td>
                            {/* Collected */}
                            <td className="p-3 text-right font-mono">
                              <div className="text-emerald-400 font-semibold">{fmtCurrency(rep.collected)}</div>
                              <div className="text-[9px] text-slate-500">Thu hồi: {rep.collectionRate}%</div>
                            </td>
                            {/* Gap */}
                            <td className="p-3 text-right font-mono font-bold">
                              {rep.targetAmount > 0 ? (
                                rep.gap >= 0 ? (
                                  <span className="text-emerald-400">+{fmtCurrency(rep.gap)}</span>
                                ) : (
                                  <span className="text-amber-400">{fmtCurrency(rep.gap)}</span>
                                )
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            {/* KPI Completion % */}
                            <td className="p-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className={cn(
                                  "font-mono font-black text-xs",
                                  rep.completionRate >= 100 ? "text-emerald-400" : rep.completionRate >= 70 ? "text-indigo-400" : rep.completionRate >= 30 ? "text-amber-400" : "text-slate-400"
                                )}>
                                  {rep.completionRate}%
                                </span>
                                <div className="w-20 bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-800">
                                  <div
                                    className={cn(
                                      "h-full transition-all duration-500",
                                      rep.completionRate >= 100 ? "bg-emerald-500" : rep.completionRate >= 70 ? "bg-indigo-500" : rep.completionRate >= 30 ? "bg-amber-500" : "bg-rose-500"
                                    )}
                                    style={{ width: `${Math.min(100, Math.max(3, rep.completionRate))}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            {/* Rating */}
                            <td className="p-3 text-center">
                              <span className={cn("inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border", rep.ratingColor)}>
                                {rep.ratingLabel}
                              </span>
                            </td>
                            {/* Action */}
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {isManagerOrAdmin && (
                                  <button
                                    onClick={() => onOpenTargetModal(rep.repId)}
                                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-bold transition-all cursor-pointer"
                                    title="Gán hoặc điều chỉnh chỉ tiêu cho nhân sự này"
                                  >
                                    {rep.targetAmount > 0 ? "Sửa" : "Giao"}
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setSelectedRepId(rep.repId);
                                    setAnalysisDimension("employee");
                                  }}
                                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
                                  title="Xem phân tích chi tiết của nhân viên này"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Summary Table Footer */}
                      <tfoot>
                        <tr className="bg-slate-950 font-mono font-bold text-xs border-t-2 border-slate-800 text-slate-200">
                          <td colSpan={2} className="p-3 text-white uppercase tracking-wider">
                            TỔNG CỘNG TOÀN CÔNG TY ({repEvaluations.length} nhân sự)
                          </td>
                          <td className="p-3 text-right text-amber-400">{fmtCurrency(teamTotalTarget)}</td>
                          <td className="p-3 text-right text-slate-300">{fmtCurrency(teamTotalPreVat)}</td>
                          <td className="p-3 text-right text-indigo-400">{fmtCurrency(teamTotalPostVat)}</td>
                          <td className="p-3 text-right text-emerald-400">{fmtCurrency(teamTotalCollected)}</td>
                          <td className="p-3 text-right text-amber-300">
                            {teamTotalPostVat >= teamTotalTarget && teamTotalTarget > 0 ? (
                              <span className="text-emerald-400">+{fmtCurrency(teamTotalPostVat - teamTotalTarget)}</span>
                            ) : (
                              <span className="text-rose-400">{fmtCurrency(teamTotalPostVat - teamTotalTarget)}</span>
                            )}
                          </td>
                          <td className="p-3 text-center text-emerald-400">{teamCompletion}%</td>
                          <td className="p-3 text-center text-slate-400">{completedCount}/{repEvaluations.length} về đích</td>
                          <td className="p-3"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* DYNAMIC CHART RENDER AREA */
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-5">
            {/* Chart Subtitle & Active Dimension Summary */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
              <div>
                <h3 className="text-xs font-bold text-indigo-400 font-mono tracking-wider uppercase flex items-center gap-2">
                  <span>
                    PHÂN TÍCH {activeMetric.toUpperCase()} THEO {analysisDimension.toUpperCase()}
                  </span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    ({chartView === "vertical_bar" ? "Biểu đồ Cột dọc" : chartView === "horizontal_bar" ? "Biểu đồ Cột ngang" : chartView === "donut" ? "Biểu đồ Donut" : chartView === "line_trend" ? "Biểu đồ Đường" : "Bảng Pivot đa chiều"})
                  </span>
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Dữ liệu phát sinh trong kỳ: <span className="text-white font-semibold">{periodType === "all" ? "Toàn bộ" : periodValue}</span> • Phạm vi: <span className="text-indigo-300 font-semibold">{selectedRepId === "all" ? "Toàn công ty" : selectedRepId}</span>
                </p>
              </div>

              {/* Dynamic Legend */}
              <div className="flex items-center gap-3 text-[10px] font-bold bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500" />
                  <span className="text-slate-300">
                    {activeMetric === "debt" ? "Công Nợ Tồn" : activeMetric === "collected" ? "Thực Thu" : activeMetric === "discount" ? "Chiết Khấu" : "Giá Trị"}
                  </span>
                </div>
                {analysisDimension === "debt" && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
                    <span className="text-emerald-300">Đã Thu</span>
                  </div>
                )}
              </div>
            </div>

            {/* Empty state check */}
            {aggregatedData.length === 0 ? (
              <div className="text-center py-16 text-slate-500 italic text-xs space-y-2">
                <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto opacity-60" />
                <p>Không có dữ liệu giao dịch phát sinh trong kỳ lọc được chọn.</p>
                <p className="text-[10px] text-slate-600">Hệ thống đang ở trạng thái sạch. Hãy tạo đơn hàng hoặc xuất kho thực tế để ghi nhận số liệu phân tích.</p>
              </div>
            ) : (
              <>
                {/* VIEW 1: VERTICAL BAR CHART */}
                {chartView === "vertical_bar" && (
                  <div className="space-y-4">
                    <div className="flex items-end h-64 pt-8 pb-3 border-b border-slate-800 overflow-x-auto px-2 gap-3 justify-around">
                      {aggregatedData.map((item, idx) => {
                        const val = getMetricValue(item);
                        const height = Math.max(8, Math.round((val / maxChartVal) * 190));
                        const color = PALETTE[idx % PALETTE.length];

                        return (
                          <div key={item.id} className="flex flex-col items-center group min-w-[55px] flex-1 px-1">
                            {/* Hover Tooltip */}
                            <div className="text-[9px] font-mono text-center hidden group-hover:block transition-all mb-2 whitespace-nowrap bg-slate-950 p-2 rounded-xl border border-slate-800 shadow-2xl z-20">
                              <div className="text-white font-bold mb-0.5">{item.label}</div>
                              <div className="text-indigo-400 font-bold">
                                {formatMetricDisplay(val)}
                              </div>
                              <div className="text-slate-400 text-[8px]">
                                Đã thu: {fmtCurrency(item.collected)} • Nợ: {fmtCurrency(item.debt)}
                              </div>
                              <div className="text-emerald-400 text-[8px] font-bold">
                                Tỷ lệ thu hồi: {item.debt_rate}%
                              </div>
                            </div>

                            {/* Bar Column(s) */}
                            <div className="flex items-end gap-1.5">
                              {/* Actual Value Bar */}
                              <div
                                className="w-6 sm:w-8 rounded-t-lg transition-all duration-500 shadow-md group-hover:brightness-125 cursor-pointer relative"
                                style={{
                                  height: `${height}px`,
                                  background: `linear-gradient(to top, #0369a1, ${color})`
                                }}
                              />
                            </div>

                            {/* Label */}
                            <span className="text-[10px] text-slate-300 mt-2 font-bold text-center block truncate max-w-[70px]">
                              {item.label.split(" ").slice(-2).join(" ")}
                            </span>
                            <span className="text-[9px] font-mono text-slate-500">
                              {activeMetric === "debt_rate" ? `${val}%` : formatMetricDisplay(val)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* VIEW 2: HORIZONTAL BAR CHART (RANKING) */}
                {chartView === "horizontal_bar" && (
                  <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                    {aggregatedData.map((item, idx) => {
                      const val = getMetricValue(item);
                      const pct = Math.round((val / maxChartVal) * 100);
                      const color = PALETTE[idx % PALETTE.length];

                      return (
                        <div key={item.id} className="space-y-1.5 bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-1">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-bold font-mono text-[10px] flex items-center justify-center">
                                {idx + 1}
                              </span>
                              <span className="font-bold text-slate-200">
                                {item.label}
                              </span>
                              {item.subLabel && (
                                <span className="text-[10px] text-slate-500 font-mono">
                                  ({item.subLabel})
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 font-mono">
                              <span className="text-slate-400 text-[10px]">
                                Đã thu: <strong className="text-emerald-400">{fmtCurrency(item.collected)}</strong>
                              </span>
                              <span className="text-slate-400 text-[10px]">
                                Nợ: <strong className="text-rose-400">{fmtCurrency(item.debt)}</strong>
                              </span>
                              <span className="font-bold text-white text-xs">
                                {formatMetricDisplay(val)}
                              </span>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-slate-950 h-3 rounded-full border border-slate-800 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                  width: `${Math.max(4, pct)}%`,
                                  background: `linear-gradient(to right, #0369a1, ${color})`
                                }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono w-10 text-right">{pct}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* VIEW 3: DONUT / PIE CHART */}
                {chartView === "donut" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                    {/* SVG Donut */}
                    <div className="flex justify-center relative py-4">
                      {(() => {
                        const totalVal = aggregatedData.reduce((sum, d) => sum + getMetricValue(d), 0) || 1;
                        let accumulatedPercent = 0;
                        const size = 200;
                        const strokeWidth = 32;
                        const radius = (size - strokeWidth) / 2;
                        const circumference = 2 * Math.PI * radius;

                        return (
                          <div className="relative">
                            <svg width={size} height={size} className="transform -rotate-90">
                              {aggregatedData.map((d, idx) => {
                                const val = getMetricValue(d);
                                const sliceRatio = val / totalVal;
                                const strokeDasharray = `${sliceRatio * circumference} ${circumference}`;
                                const strokeDashoffset = -accumulatedPercent * circumference;
                                accumulatedPercent += sliceRatio;
                                const color = PALETTE[idx % PALETTE.length];

                                return (
                                  <circle
                                    key={d.id}
                                    cx={size / 2}
                                    cy={size / 2}
                                    r={radius}
                                    fill="transparent"
                                    stroke={color}
                                    strokeWidth={strokeWidth}
                                    strokeDasharray={strokeDasharray}
                                    strokeDashoffset={strokeDashoffset}
                                    className="hover:opacity-85 transition-opacity cursor-pointer"
                                  />
                                );
                              })}
                            </svg>
                            {/* Donut Center Hole */}
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                              <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider">Tổng {activeMetric.toUpperCase()}</span>
                              <span className="text-sm font-black font-mono text-white mt-0.5">
                                {formatMetricDisplay(totalVal)}
                              </span>
                              <span className="text-[9px] text-indigo-400 font-bold font-mono">100% Thị phần</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Breakdown Legend List */}
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                      {aggregatedData.map((d, idx) => {
                        const val = getMetricValue(d);
                        const totalVal = aggregatedData.reduce((sum, item) => sum + getMetricValue(item), 0) || 1;
                        const pct = Math.round((val / totalVal) * 100);
                        const color = PALETTE[idx % PALETTE.length];

                        return (
                          <div key={d.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-slate-850 text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <span className="font-bold text-slate-300 truncate max-w-[140px]">{d.label}</span>
                            </div>
                            <div className="text-right font-mono">
                              <span className="text-white font-bold">{formatMetricDisplay(val)}</span>
                              <span className="text-[10px] text-slate-500 ml-1.5">({pct}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* VIEW 4: LINE & AREA TREND CHART */}
                {chartView === "line_trend" && (
                  <div className="space-y-4">
                    {(() => {
                      const points = aggregatedData.slice(0, 12);
                      const maxVal = Math.max(...points.map(p => Math.max(p.revenue_gross, p.collected, p.debt))) || 1;
                      const width = 600;
                      const height = 200;
                      const stepX = width / Math.max(1, points.length - 1);

                      const getCoords = (val: number, idx: number) => {
                        const x = idx * stepX;
                        const y = height - (val / maxVal) * (height - 30);
                        return { x, y };
                      };

                      // Generate SVG path for Gross Revenue
                      const grossPath = points.map((p, idx) => {
                        const { x, y } = getCoords(p.revenue_gross, idx);
                        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
                      }).join(" ");

                      // Generate SVG path for Collected
                      const collectedPath = points.map((p, idx) => {
                        const { x, y } = getCoords(p.collected, idx);
                        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
                      }).join(" ");

                      return (
                        <div className="space-y-3">
                          <div className="overflow-x-auto">
                            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56 overflow-visible">
                              {/* Grid lines */}
                              <line x1="0" y1={height} x2={width} y2={height} stroke="#334155" strokeWidth="1" />
                              <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#1e293b" strokeDasharray="4" strokeWidth="1" />

                              {/* Gross Revenue Line (Indigo) */}
                              <path d={grossPath} fill="none" stroke="#0ea5e9" strokeWidth="3" />
                              {/* Collected Line (Emerald) */}
                              <path d={collectedPath} fill="none" stroke="#10b981" strokeWidth="2.5" strokeDasharray="3 3" />

                              {/* Points */}
                              {points.map((p, idx) => {
                                const { x, y } = getCoords(p.revenue_gross, idx);
                                return (
                                  <g key={idx}>
                                    <circle cx={x} cy={y} r="5" fill="#0ea5e9" stroke="#0f172a" strokeWidth="2" className="cursor-pointer" />
                                    <text x={x} y={y - 10} fill="#94a3b8" fontSize="9" textAnchor="middle" fontFamily="monospace">
                                      {Math.round(p.revenue_gross / 1000000)}Tr
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          </div>

                          {/* Legend & X-Axis labels */}
                          <div className="flex justify-between text-[10px] font-mono text-slate-400 px-1 border-t border-slate-800 pt-2">
                            {points.map((p, idx) => (
                              <span key={idx} className="truncate max-w-[60px] text-center">{p.label}</span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* VIEW 5: MULTI-DIMENSIONAL PIVOT TABLE */}
                {chartView === "pivot_table" && (
                  <div className="overflow-x-auto max-h-[460px] border border-slate-800 rounded-2xl">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-950 text-slate-400 font-mono text-[10px] uppercase tracking-wider sticky top-0 z-10 border-b border-slate-800">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">Đối Tượng Phân Tích</th>
                          <th className="p-3">Phân Khúc</th>
                          <th className="p-3 text-right">Trước VAT</th>
                          <th className="p-3 text-right">Chiết Khấu</th>
                          <th className="p-3 text-right">Sau VAT</th>
                          <th className="p-3 text-right">Đã Thu</th>
                          <th className="p-3 text-right">Còn Nợ</th>
                          <th className="p-3 text-center">Thu Hồi (%)</th>
                          <th className="p-3 text-center">% KPI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850">
                        {aggregatedData.map((d, idx) => (
                          <tr key={d.id} className="hover:bg-slate-850/40 transition-colors">
                            <td className="p-3 text-slate-500 font-mono text-[11px]">{idx + 1}</td>
                            <td className="p-3">
                              <span className="font-bold text-white block">{d.label}</span>
                              {d.subLabel && <span className="text-[10px] text-slate-500 font-mono">{d.subLabel}</span>}
                            </td>
                            <td className="p-3 text-slate-400 text-[11px]">{d.category || "—"}</td>
                            <td className="p-3 text-right font-mono text-slate-300">{fmtCurrency(d.revenue_net)}</td>
                            <td className="p-3 text-right font-mono text-amber-400">{fmtCurrency(d.discount)}</td>
                            <td className="p-3 text-right font-mono font-bold text-indigo-400">{fmtCurrency(d.revenue_gross)}</td>
                            <td className="p-3 text-right font-mono font-bold text-emerald-400">{fmtCurrency(d.collected)}</td>
                            <td className="p-3 text-right font-mono font-bold text-rose-400">{fmtCurrency(d.debt)}</td>
                            <td className="p-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className={cn(
                                  "font-mono font-bold text-[10px] px-2 py-0.5 rounded-full",
                                  d.debt_rate >= 90 ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                  : d.debt_rate >= 60 ? "bg-amber-950 text-amber-300 border border-amber-800"
                                  : "bg-rose-950 text-rose-300 border border-rose-800"
                                )}>
                                  {d.debt_rate}%
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-center font-mono font-bold text-purple-400">
                              {d.completion}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Summary Total Row */}
                      <tfoot className="bg-slate-950/90 font-mono font-bold text-xs border-t-2 border-slate-700 sticky bottom-0">
                        <tr>
                          <td colSpan={3} className="p-3 text-white">TỔNG CỘNG HỆ THỐNG</td>
                          <td className="p-3 text-right text-slate-200">{fmtCurrency(summaryKpis.preVat)}</td>
                          <td className="p-3 text-right text-amber-400">{fmtCurrency(summaryKpis.discount)}</td>
                          <td className="p-3 text-right text-indigo-400 font-black">{fmtCurrency(summaryKpis.postVat)}</td>
                          <td className="p-3 text-right text-emerald-400 font-black">{fmtCurrency(summaryKpis.collected)}</td>
                          <td className="p-3 text-right text-rose-400 font-black">{fmtCurrency(summaryKpis.debt)}</td>
                          <td className="p-3 text-center text-emerald-400">{summaryKpis.collectionRate}%</td>
                          <td className="p-3 text-center text-purple-400">{summaryKpis.completionRate}%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
          )}
        </div>

        {/* Right Column (1 Col): Leaderboard + Debt Risk Radar + Sales Funnel */}
        <div className="lg:col-span-1 space-y-6">
          {/* Leaderboard */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-xs font-bold text-indigo-400 font-mono tracking-wider uppercase">
                {analysisDimension === "target" ? "XẾP HẠNG TIẾN ĐỘ CHỈ TIÊU KPI" : "BẢNG XẾP HẠNG DOANH SỐ & THU HỒI"}
              </h3>
              <Award className="w-4 h-4 text-amber-400" />
            </div>

            {(() => {
              // Group by sales personnel
              const repRankings = salesPersonnel.map(rep => {
                const repTxs = filteredTransactions.filter(tx => tx.sales_rep_id === rep.employee_id || tx.sales_rep_name === rep.full_name);
                const total = repTxs.reduce((sum, tx) => sum + (tx.total_amount || 0), 0);
                const collected = repTxs.reduce((sum, tx) => sum + (tx.paid_amount || 0), 0);
                const debt = repTxs.reduce((sum, tx) => sum + (tx.debt_amount || 0), 0);
                const collectionRate = total > 0 ? Math.round((collected / total) * 100) : 100;
                const repTarget = getRepTargetForPeriod(rep.employee_id, rep.full_name);
                const completion = repTarget > 0 ? Math.round((total / repTarget) * 100) : 0;

                return {
                  id: rep.employee_id,
                  name: rep.full_name,
                  total,
                  collected,
                  debt,
                  collectionRate,
                  target: repTarget,
                  completion
                };
              });

              const hasAnyRevenue = repRankings.some(r => r.total > 0);
              const hasAnyTarget = repRankings.some(r => r.target > 0);

              if (!hasAnyRevenue && !hasAnyTarget) {
                return (
                  <div className="text-center py-6 text-slate-500 italic text-xs space-y-1">
                    <p>Chưa có chỉ tiêu hoặc doanh số phát sinh trong kỳ để xếp hạng.</p>
                    <p className="text-[10px] text-slate-600">Hãy giao chỉ tiêu cho nhân viên để bắt đầu theo dõi xếp hạng KPI.</p>
                  </div>
                );
              }

              const sortedRankings = [...repRankings].sort((a, b) => {
                if (analysisDimension === "target") {
                  if (b.completion !== a.completion) return b.completion - a.completion;
                  if (b.total !== a.total) return b.total - a.total;
                  return b.target - a.target;
                }
                return b.total - a.total;
              });

              const displayRankings = hasAnyRevenue
                ? sortedRankings.filter(r => r.total > 0 || (analysisDimension === "target" && r.target > 0))
                : sortedRankings.filter(r => r.target > 0);

              return (
                <div className="space-y-2.5">
                  {displayRankings.map((rank, idx) => (
                    <div key={rank.id} className="bg-slate-950/60 p-3 rounded-xl border border-slate-850 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold font-mono",
                            idx === 0 && "bg-amber-400 text-slate-950",
                            idx === 1 && "bg-slate-300 text-slate-950",
                            idx === 2 && "bg-amber-700 text-white",
                            idx > 2 && "bg-slate-800 text-slate-400"
                          )}>
                            {idx + 1}
                          </span>
                          <div>
                            <span className="text-xs font-bold text-white block">{rank.name}</span>
                            <span className="text-[9px] text-slate-400 font-mono">
                              Mục tiêu: <span className="text-amber-400 font-semibold">{fmtCurrency(rank.target)}</span> • KPI: <strong className={rank.completion >= 100 ? "text-emerald-400 font-bold" : "text-purple-400"}>{rank.completion}%</strong>
                            </span>
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          <span className="text-xs font-bold text-emerald-400 block">{fmtCurrency(rank.total)}</span>
                          <span className="text-[9px] text-slate-400">
                            {rank.total >= rank.target && rank.target > 0 ? (
                              <span className="text-emerald-400 font-bold">Về đích</span>
                            ) : (
                              <span>Thu hồi: <strong className="text-indigo-400">{rank.collectionRate}%</strong></span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Mini bar */}
                      <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            rank.completion >= 100 ? "bg-emerald-500" : rank.completion >= 60 ? "bg-indigo-500" : "bg-amber-500"
                          )}
                          style={{ width: `${Math.min(100, Math.max(5, rank.completion || rank.collectionRate))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Sales Conversion Funnel */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-indigo-400 font-mono tracking-wider uppercase">
              PHỄU BÁN HÀNG & THU HỒI DÒNG TIỀN
            </h3>

            {(() => {
              const totalQuotes = quotations.length;
              const totalContracts = contracts.length;
              const totalOrders = filteredTransactions.length;
              const paidOrders = filteredTransactions.filter(t => t.debt_amount === 0).length;

              return (
                <div className="space-y-3 text-center text-xs">
                  <div className="w-full bg-indigo-950/80 border border-indigo-800/80 p-2.5 rounded-xl">
                    <span className="text-[10px] font-bold text-indigo-300 block">1. Báo Giá Đã Gửi</span>
                    <strong className="text-white text-sm font-mono">{totalQuotes} báo giá</strong>
                  </div>

                  <div className="w-[85%] mx-auto bg-indigo-900/80 border border-indigo-750 p-2 rounded-xl">
                    <span className="text-[10px] font-bold text-indigo-250 block">2. Hợp Đồng Đã Ký</span>
                    <strong className="text-white text-xs font-mono">{totalContracts} hợp đồng</strong>
                  </div>

                  <div className="w-[70%] mx-auto bg-indigo-800/80 border border-indigo-700 p-2 rounded-xl">
                    <span className="text-[10px] font-bold text-indigo-200 block">3. Đơn Hàng Giao Thành Công</span>
                    <strong className="text-white text-xs font-mono">{totalOrders} đơn giao</strong>
                  </div>

                  <div className="w-[55%] mx-auto bg-emerald-600/90 border border-emerald-500 p-2 rounded-xl">
                    <span className="text-[10px] font-bold text-emerald-200 block">4. Đã Thu Hồi Đủ Tiền</span>
                    <strong className="text-white text-xs font-mono">{paidOrders} đơn xong</strong>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
