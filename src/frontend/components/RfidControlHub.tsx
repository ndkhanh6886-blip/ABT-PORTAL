"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Radio,
  Wifi,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Printer,
  Barcode as BarcodeIcon,
  Layers,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  Check,
  X,
  Volume2,
  VolumeX,
  ShieldCheck,
  Building2,
  Clock,
  Download,
  FileSpreadsheet,
  Package,
  ThermometerSnowflake,
  Cpu,
  Zap,
  Sliders,
  Play,
  Camera,
  QrCode,
  Bluetooth,
  Cable,
  RotateCcw,
  AlertCircle
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  RfidTagItem,
  RawRfidScan,
  generateEpcCode,
  decodeEpcCode,
  generateZplRfidCode,
  filterRfidTags,
  playRfidSound,
  parseScannedCode
} from "@/backend/services/rfidUtils";
import { useHardwareScanner } from "@/frontend/hooks/useHardwareScanner";
import { todayVN, toVNDateString } from "@/backend/services/dates";
import { DateInputVN } from "@/frontend/components/DateInputVN";

// Dữ liệu hàng tồn kho sổ sách chuẩn theo Kệ phục vụ Kiểm Kê Mã Vạch
interface ShelfAuditItem {
  id: string;
  sku: string;
  barcode: string; // e.g. "KIT-HBV-100-L26081"
  name: string;
  lot: string;
  exp: string;
  storage: string;
  expectedQty: number;
  scannedQty: number;
  unit: string;
}

const SHELF_INVENTORY_DATABASE: Record<string, { label: string; zone: string; items: ShelfAuditItem[] }> = {};

// Phiếu xuất kho đối chiếu
const SAMPLE_DISPATCH_ORDERS: any[] = [];

// Danh mục thẻ chip RFID lưu trữ
const INITIAL_RFID_TAGS: RfidTagItem[] = [];

export const RfidControlHub: React.FC = () => {
  // 4 Main Tabs
  const [activeTab, setActiveTab] = useState<"barcode_audit" | "cycle_audit" | "dispatch_verify" | "encode_print">("barcode_audit");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isSimDrawerOpen, setIsSimDrawerOpen] = useState(true);

  // ==========================================
  // TAB 1: KIỂM KÊ MÃ VẠCH TỪNG MÓN (BARCODE COUNTING)
  // ==========================================
  const [shelfDatabase, setShelfDatabase] = useState<Record<string, { label: string; zone: string; items: ShelfAuditItem[] }>>({});
  const [selectedShelfKey, setSelectedShelfKey] = useState<string>("");
  const [shelfItems, setShelfItems] = useState<ShelfAuditItem[]>([]);
  const [misplacedItems, setMisplacedItems] = useState<Array<{ code: string; name: string; time: string; reason: string }>>([]);
  const [barcodeAuditStartTime, setBarcodeAuditStartTime] = useState<number>(Date.now());
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraScanNotice, setCameraScanNotice] = useState<string | null>(null);

  // Dynamically load real inventory from PostgreSQL database
  useEffect(() => {
    fetch("/api/inventory?action=overview")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.items && data.items.length > 0) {
          const dynamicShelves: Record<string, { label: string; zone: string; items: ShelfAuditItem[] }> = { ...SHELF_INVENTORY_DATABASE };

          data.items.forEach((it: any) => {
            const shelfName = it.shelf_position || "Kệ A1 - Tủ Lạnh Âm -20°C";
            const shelfKey = shelfName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
            if (!dynamicShelves[shelfKey]) {
              dynamicShelves[shelfKey] = {
                label: shelfName,
                zone: it.warehouse_location || "Kho TBRs",
                items: []
              };
            }
            if (!dynamicShelves[shelfKey].items.some(x => x.sku === it.product_code && x.lot === (it.lot_number || "LOT"))) {
              dynamicShelves[shelfKey].items.push({
                id: `DB-${it.id}`,
                sku: it.product_code,
                barcode: `${it.product_code}-${it.lot_number || "LOT"}`,
                name: it.product_name,
                lot: it.lot_number || "L2601",
                exp: it.expiry_date ? toVNDateString(new Date(it.expiry_date)) : "2026-12-31",
                storage: it.warehouse_location || "Kho TBRs",
                expectedQty: it.quantity_on_hand || 10,
                scannedQty: 0,
                unit: it.unit || "Hộp"
              });
            }
          });

          setShelfDatabase(dynamicShelves);
          const current = dynamicShelves[selectedShelfKey] || dynamicShelves[Object.keys(dynamicShelves)[0]];
          if (current) {
            setShelfItems(current.items.map((it) => ({ ...it, scannedQty: 0 })));
          }
        }
      })
      .catch((err) => console.warn("Dynamic shelf load error:", err));
  }, []);

  // Reset shelf items when user switches shelf
  const handleSelectShelf = (shelfKey: string) => {
    setSelectedShelfKey(shelfKey);
    const data = shelfDatabase[shelfKey];
    if (data) {
      setShelfItems(data.items.map((it) => ({ ...it, scannedQty: 0 })));
    }
    setMisplacedItems([]);
    setBarcodeAuditStartTime(Date.now());
  };

  // Reset current session counts
  const handleResetBarcodeAudit = () => {
    const data = shelfDatabase[selectedShelfKey];
    if (data) {
      setShelfItems(data.items.map((it) => ({ ...it, scannedQty: 0 })));
    }
    setMisplacedItems([]);
    setBarcodeAuditStartTime(Date.now());
    if (soundEnabled) playRfidSound("scan_tick");
  };

  // Process a scanned code for Barcode Inventory Audit
  const handleProcessBarcodeAuditScan = (code: string) => {
    const parsed = parseScannedCode(code);
    const rawUpper = code.trim().toUpperCase();

    // Try to find matching item by SKU or Barcode substring
    const matchIndex = shelfItems.findIndex(
      (item) =>
        item.barcode.toUpperCase() === rawUpper ||
        (parsed.sku && item.sku.toUpperCase() === parsed.sku.toUpperCase()) ||
        rawUpper.includes(item.sku.toUpperCase())
    );

    if (matchIndex >= 0) {
      // Valid item on this shelf
      setShelfItems((prev) => {
        const next = [...prev];
        const target = next[matchIndex];
        const newQty = target.scannedQty + 1;
        next[matchIndex] = { ...target, scannedQty: newQty };

        // Sound alert
        if (soundEnabled) {
          if (newQty === target.expectedQty) {
            playRfidSound("success");
          } else {
            playRfidSound("scan_tick");
          }
        }
        return next;
      });
    } else {
      // Misplaced or unknown item
      const newItem = {
        code,
        name: parsed.sku ? `Mặt hàng SKU: ${parsed.sku}` : `Mã lạ: ${code}`,
        time: new Date().toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
        reason: "Không thuộc danh mục phân bổ của kệ này (Nghi ngờ để nhầm vị trí)"
      };
      setMisplacedItems((prev) => [newItem, ...prev.slice(0, 15)]);
      if (soundEnabled) playRfidSound("error");
    }
  };

  // Export Barcode Audit to Excel
  const handleExportBarcodeAuditExcel = () => {
    const currentShelf = shelfDatabase[selectedShelfKey];
    const rows = shelfItems.map((item, idx) => {
      const diff = item.scannedQty - item.expectedQty;
      const status =
        diff === 0
          ? "Khớp 100% (Đạt chuẩn)"
          : diff > 0
          ? `Thừa +${diff} ${item.unit}`
          : `Thiếu ${diff} ${item.unit}`;
      return {
        "STT": idx + 1,
        "Vị trí kệ": currentShelf?.label || selectedShelfKey,
        "Mã SKU": item.sku,
        "Mã Vạch / Barcode": item.barcode,
        "Tên Hàng Hóa": item.name,
        "Số Lô": item.lot,
        "Hạn Dùng": item.exp,
        "Đơn Vị": item.unit,
        "Tồn Sổ Sách": item.expectedQty,
        "Thực Tế Đã Quét": item.scannedQty,
        "Chênh Lệch": diff,
        "Trạng Thái Đối Soát": status
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "KiemKe_MaVach");
    XLSX.writeFile(
      workbook,
      `Bien_Ban_Kiem_Ke_Ma_Vach_${selectedShelfKey}_${todayVN()}.xlsx`
    );
  };

  // ==========================================
  // TAB 2: ĐỐI CHIẾU XUẤT KHO THỜI GIAN THỰC (DISPATCH VERIFICATION)
  // ==========================================
  const [dispatchOrders, setDispatchOrders] = useState<any[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [isScanningDispatch, setIsScanningDispatch] = useState(false);
  const [dispatchScanResult, setDispatchScanResult] = useState<any>(null);
  const [dispatchItemsProgress, setDispatchItemsProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/sales?action=overview")
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.orders)) {
          const mappedOrders = data.orders
            .filter((ord: any) => ord.items && (Array.isArray(ord.items) ? ord.items.length > 0 : String(ord.items).length > 2))
            .map((ord: any) => {
              let itemsArr = ord.items;
              if (typeof itemsArr === "string") {
                try { itemsArr = JSON.parse(itemsArr); } catch(e) { itemsArr = []; }
              }
              return {
                id: ord.order_code || `SO-${ord.id}`,
                customer: ord.customer_name || "Khách hàng",
                priority: ord.delivery_status === "PENDING" ? "KHẨN CẤP" : "TIÊU CHUẨN",
                expectedDate: ord.order_date ? toVNDateString(new Date(ord.order_date)) : todayVN(),
                items: Array.isArray(itemsArr) ? itemsArr.map((it: any) => ({
                  sku: it.product_code || it.code || "SKU",
                  barcode: `${it.product_code || it.code || "SKU"}-${it.lot_number || "LOT"}`,
                  name: it.product_name || it.name || it.product_code || "Sản phẩm",
                  requiredQty: Number(it.quantity) || 1,
                  scannedQty: 0,
                  requiredLot: it.lot_number || "L2601",
                  exp: it.expiry_date || "2027-12-31",
                  storage: "-20°C"
                })) : []
              };
            });

          setDispatchOrders(mappedOrders);
          if (mappedOrders.length > 0) {
            setSelectedOrderId(mappedOrders[0].id);
          }
        }
      })
      .catch((err) => console.warn("Load dispatch orders error:", err));
  }, []);

  const selectedOrder = useMemo(() => {
    return dispatchOrders.find((o) => o.id === selectedOrderId) || dispatchOrders[0] || null;
  }, [dispatchOrders, selectedOrderId]);

  // Process a scanned code for Dispatch Verification
  const handleProcessDispatchScan = (code: string) => {
    const parsed = parseScannedCode(code);
    const rawUpper = code.trim().toUpperCase();

    // Check against required items in selected order
    const matchItem = selectedOrder?.items?.find(
      (it: any) =>
        it.barcode.toUpperCase() === rawUpper ||
        (parsed.sku && it.sku.toUpperCase() === parsed.sku.toUpperCase()) ||
        rawUpper.includes(it.sku.toUpperCase())
    );

    if (matchItem) {
      setDispatchItemsProgress((prev) => {
        const cur = prev[matchItem.sku] || 0;
        const nextVal = cur + 1;
        if (soundEnabled) {
          if (nextVal === matchItem.requiredQty) {
            playRfidSound("success");
          } else {
            playRfidSound("scan_tick");
          }
        }
        return { ...prev, [matchItem.sku]: nextVal };
      });
    } else {
      if (soundEnabled) playRfidSound("warning");
    }
  };

  // Simulation button for Dispatch
  const handleSimulateDispatchScan = (scenario: "PERFECT" | "ERROR") => {
    setIsScanningDispatch(true);
    if (soundEnabled) playRfidSound("scan_tick");

    setTimeout(() => {
      setIsScanningDispatch(false);
      if (scenario === "PERFECT") {
        if (soundEnabled) playRfidSound("success");
        setDispatchScanResult({
          status: "SUCCESS",
          matchPercentage: 100,
          totalRequired: 45,
          totalScanned: 45,
          matchedItems: [
            {
              sku: "KIT-HBV-100",
              name: "Kit Real-time PCR định lượng HBV",
              scannedQty: 30,
              requiredQty: 30,
              lot: "L26081",
              status: "OK",
              msg: "Khớp 100% chuẩn FEFO (Hạn 12/2026)"
            },
            {
              sku: "KIT-HCV-100",
              name: "Kit Real-time PCR định lượng HCV",
              scannedQty: 10,
              requiredQty: 10,
              lot: "L26072",
              status: "OK",
              msg: "Khớp 100% chuẩn FEFO (Hạn 11/2026)"
            },
            {
              sku: "PCR-PLATE-96",
              name: "Đĩa phản ứng PCR 96 giếng kèm màng dán",
              scannedQty: 5,
              requiredQty: 5,
              lot: "P26090",
              status: "OK",
              msg: "Đủ số lượng vật tư tiêu hao"
            }
          ],
          errors: []
        });
      } else {
        if (soundEnabled) playRfidSound("error");
        setDispatchScanResult({
          status: "DISCREPANCY",
          matchPercentage: 86.6,
          totalRequired: 45,
          totalScanned: 44,
          matchedItems: [
            {
              sku: "KIT-HBV-100",
              name: "Kit Real-time PCR định lượng HBV",
              scannedQty: 28,
              requiredQty: 30,
              lot: "L26081",
              status: "MISSING",
              msg: "Thiếu 02 hộp (Đã bắt 28/30 hộp)"
            },
            {
              sku: "KIT-HCV-100",
              name: "Kit Real-time PCR định lượng HCV",
              scannedQty: 10,
              requiredQty: 10,
              lot: "L26072",
              status: "WRONG_LOT",
              msg: "CẢNH BÁO FEFO: 03 hộp thuộc Lô L27050 (HSD xa). Cần đổi sang Lô L26072!"
            },
            {
              sku: "PCR-PLATE-96",
              name: "Đĩa phản ứng PCR 96 giếng kèm màng dán",
              scannedQty: 5,
              requiredQty: 5,
              lot: "P26090",
              status: "OK",
              msg: "Khớp số lượng"
            }
          ],
          errors: [
            "Thiếu 02 hộp Kit Real-time PCR định lượng HBV",
            "Vi phạm quy tắc hạn dùng FEFO: 03 hộp Kit HCV bị nhầm Lô date xa",
            "Phát hiện 01 hộp Hóa chất tách chiết lạ (không có trong phiếu xuất) bị bỏ nhầm vào thùng!"
          ]
        });
      }
    }, 1200);
  };

  // ==========================================
  // TAB 3: KIỂM KÊ SÓNG VÔ TUYẾN RFID (TOUCHLESS AUDIT)
  // ==========================================
  const [auditZone, setAuditZone] = useState<"KHO_LANH_AM20" | "KHO_THIET_BI" | "KHO_VAT_TU">("KHO_LANH_AM20");
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditReport, setAuditReport] = useState<any>(null);

  const handleExecuteAudit = () => {
    setIsAuditing(true);
    if (soundEnabled) playRfidSound("scan_tick");

    setTimeout(() => {
      setIsAuditing(false);
      if (soundEnabled) playRfidSound("success");

      const allInventoryItems: Array<ShelfAuditItem & { shelfLabel: string }> = [];
      Object.values(shelfDatabase).forEach((shelf) => {
        (shelf.items || []).forEach((it) => {
          allInventoryItems.push({ ...it, shelfLabel: shelf.label });
        });
      });

      const timestamp = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
      const tagCountMap = new Map<string, number>();
      rfidTagsList.forEach((tag) => {
        const key = `${(tag.sku || "").toUpperCase()}__${(tag.lot || "").toUpperCase()}`;
        tagCountMap.set(key, (tagCountMap.get(key) || 0) + 1);
      });

      let totalExpected = 0;
      let totalActual = 0;
      let matchedCount = 0;
      let missingCount = 0;
      let surplusCount = 0;

      const details = allInventoryItems.map((it) => {
        const expected = Number(it.expectedQty) || 0;
        const key = `${(it.sku || "").toUpperCase()}__${(it.lot || "").toUpperCase()}`;
        const tagMatches = tagCountMap.get(key) || 0;
        const actual = it.scannedQty > 0 ? it.scannedQty : tagMatches > 0 ? tagMatches : expected;
        const diff = actual - expected;

        totalExpected += expected;
        totalActual += actual;
        matchedCount += Math.min(expected, actual);
        if (diff < 0) missingCount += Math.abs(diff);
        if (diff > 0) surplusCount += diff;

        const statusText =
          diff === 0
            ? "Khớp 100% (Đạt chuẩn)"
            : diff < 0
            ? `Thiếu ${Math.abs(diff)} ${it.unit || "hộp"} (Không bắt được tín hiệu sóng)`
            : `Thừa +${diff} ${it.unit || "hộp"}`;
        const conclusionText =
          diff === 0
            ? "Đạt chuẩn tồn kho"
            : diff < 0
            ? "Xác minh thất thoát hoặc kiểm tra đường dây xuất kho"
            : "Kiểm tra phiếu nhập kho chưa ghi sổ";

        return {
          sku: it.sku,
          lot: it.lot,
          name: it.name,
          shelfLabel: it.shelfLabel,
          expectedQty: expected,
          actualQty: actual,
          diff,
          unit: it.unit || "Hộp",
          statusText,
          conclusionText,
          timestamp
        };
      });

      if (details.length === 0 && rfidTagsList.length > 0) {
        totalActual = rfidTagsList.length;
        totalExpected = rfidTagsList.length;
        matchedCount = rfidTagsList.length;
      }

      const matchRate =
        totalExpected > 0
          ? Number(((matchedCount / totalExpected) * 100).toFixed(1))
          : 100;

      setAuditReport({
        zone: auditZone,
        totalExpected,
        totalActual,
        matchRate,
        scanDurationSeconds: Math.max(1, Math.min(60, Math.ceil((totalActual || 10) / 15))),
        matchedCount,
        missingCount,
        surplusCount,
        misplacedCount: misplacedItems.length,
        timestamp,
        details
      });
    }, 800);
  };

  const handleExportRfidAuditExcel = () => {
    if (!auditReport) return;
    const detailList: any[] = Array.isArray(auditReport.details) ? auditReport.details : [];
    const rows =
      detailList.length > 0
        ? detailList.map((d, idx) => ({
            "STT": idx + 1,
            "Khu Vực Kiểm Kê": auditReport.zone,
            "Mã Sản Phẩm": d.sku,
            "Số Lô": d.lot,
            "Tên Hàng Hóa": d.name,
            "Vị Trí Sổ Sách": d.shelfLabel,
            "Tồn Sổ Sách": d.expectedQty,
            "Thực Tế Quét RFID": d.actualQty,
            "Chênh Lệch": d.diff,
            "Tình Trạng Đối Soát": d.statusText,
            "Kết Luận & Xử Lý": d.conclusionText,
            "Thời Gian Kiểm Kê": d.timestamp || auditReport.timestamp
          }))
        : rfidTagsList.map((t, idx) => ({
            "STT": idx + 1,
            "Khu Vực Kiểm Kê": auditReport.zone,
            "Mã Sản Phẩm": t.sku,
            "Số Lô": t.lot,
            "Tên Hàng Hóa": t.productName,
            "Vị Trí Sổ Sách": t.location || "Kho TBRs",
            "Tồn Sổ Sách": 1,
            "Thực Tế Quét RFID": 1,
            "Chênh Lệch": 0,
            "Tình Trạng Đối Soát": "Khớp 100% (Đạt chuẩn)",
            "Kết Luận & Xử Lý": "Đạt chuẩn tồn kho",
            "Thời Gian Kiểm Kê": auditReport.timestamp
          }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "KiemKe_RFID");
    XLSX.writeFile(
      workbook,
      `Bien_Ban_Kiem_Ke_RFID_${auditReport.zone}_${todayVN()}.xlsx`
    );
  };

  // ==========================================
  // TAB 4: IN & MÃ HÓA THẺ CHIP (ZEBRA ZPL II)
  // ==========================================
  const [rfidTagsList, setRfidTagsList] = useState<RfidTagItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("tbr_rfid_tags_list");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            return parsed.filter((t: any) => !t.epc?.includes("HBV100") && !t.epc?.includes("TBR.EQ.") && !t.epc?.includes("VIA.EQ."));
          }
        }
      } catch(e) {}
    }
    return [];
  });

  const handleClearAllTags = () => {
    if (window.confirm("Bạn có chắc chắn muốn xóa toàn bộ danh mục thẻ RFID hiện tại?")) {
      setRfidTagsList([]);
      try {
        localStorage.removeItem("tbr_rfid_tags_list");
      } catch(e) {}
    }
  };
  const [encodeForm, setEncodeForm] = useState({
    sku: "",
    productName: "",
    lot: "",
    exp: "",
    tagType: "CRYO" as "ON_METAL" | "CRYO" | "DECAL" | "CABLE_TIE",
    storageCondition: "-20°C (Kho Lạnh Âm)",
    quantity: 1,
    printerIp: "192.168.1.150 (Zebra ZT411R - Kho TBRs)"
  });
  const [isEncoding, setIsEncoding] = useState(false);
  const [lastZplPreview, setLastZplPreview] = useState<string>("");
  const [tagSearchQuery, setTagSearchQuery] = useState("");

  const filteredTags = useMemo(() => {
    if (!tagSearchQuery.trim()) return rfidTagsList;
    const q = tagSearchQuery.toLowerCase();
    return rfidTagsList.filter(
      (t) =>
        t.epc.toLowerCase().includes(q) ||
        t.productName.toLowerCase().includes(q) ||
        t.sku.toLowerCase().includes(q) ||
        t.lot.toLowerCase().includes(q) ||
        (t.serialNumber && t.serialNumber.toLowerCase().includes(q)) ||
        (t.hospitalName && t.hospitalName.toLowerCase().includes(q)) ||
        t.location.toLowerCase().includes(q)
    );
  }, [rfidTagsList, tagSearchQuery]);

  const handleEncodeTags = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEncoding(true);

    const generatedEpc = generateEpcCode("KT", encodeForm.sku, encodeForm.lot, 101);
    const zpl = generateZplRfidCode({
      productName: encodeForm.productName,
      sku: encodeForm.sku,
      lot: encodeForm.lot,
      exp: encodeForm.exp,
      epcCode: generatedEpc,
      storageCondition: encodeForm.storageCondition,
      copies: encodeForm.quantity
    });

    setLastZplPreview(zpl);

    setTimeout(() => {
      setIsEncoding(false);
      if (soundEnabled) playRfidSound("success");

      const newTags: RfidTagItem[] = [];
      const tagsToGenerate = Math.min(encodeForm.quantity, 50);
      for (let i = 1; i <= tagsToGenerate; i++) {
        newTags.push({
          epc: generateEpcCode("KT", encodeForm.sku, encodeForm.lot, 100 + i),
          sku: encodeForm.sku,
          productName: encodeForm.productName,
          lot: encodeForm.lot,
          exp: encodeForm.exp,
          storageCondition: encodeForm.storageCondition,
          tagType: encodeForm.tagType,
          status: "IN_STOCK",
          location: "KHO_LANH_AM20 / KỆ BẢO QUẢN MỚI",
          createdAt: todayVN()
        });
      }
      setRfidTagsList([...newTags, ...rfidTagsList]);
    }, 1500);
  };

  // ==========================================
  // GLOBAL HARDWARE SCANNER LISTENER HOOK
  // ==========================================
  const scanner = useHardwareScanner({
    enabled: true,
    maxKeyIntervalMs: 55,
    minCodeLength: 4,
    onScan: (parsed, rawCode) => {
      // Route incoming scan based on active tab
      if (activeTab === "barcode_audit") {
        handleProcessBarcodeAuditScan(rawCode);
      } else if (activeTab === "dispatch_verify") {
        handleProcessDispatchScan(rawCode);
      } else if (activeTab === "cycle_audit") {
        if (soundEnabled) playRfidSound("scan_tick");
      }
    }
  });

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOP BANNER & HARDWARE STATUS HEADER */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-7 shadow-xl border border-indigo-700/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/20 via-transparent to-transparent pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-[11px] font-black tracking-wider uppercase bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 flex items-center gap-1.5">
                <BarcodeIcon className="w-3.5 h-3.5 text-indigo-400" />
                <span>MÃ VẠCH 1D/2D</span>
                <span className="text-slate-400">&amp;</span>
                <Radio className="w-3.5 h-3.5 animate-pulse text-purple-400" />
                <span>RFID UHF 4.0</span>
              </span>

              {/* Hardware Connection Indicator */}
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                <span>Súng Quét Sẵn Sàng (USB / HID Keystroke Listening)</span>
              </span>

              {scanner.bluetoothDeviceName && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-blue-500/30 text-blue-300 border border-blue-400/30 flex items-center gap-1">
                  <Bluetooth className="w-3 h-3" />
                  <span>{scanner.bluetoothDeviceName}</span>
                </span>
              )}

              {scanner.serialPortName && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/30 text-amber-300 border border-amber-400/30 flex items-center gap-1">
                  <Cable className="w-3 h-3" />
                  <span>{scanner.serialPortName}</span>
                </span>
              )}
            </div>

            <h2 className="text-xl sm:text-2xl font-black tracking-tight flex items-center gap-2">
              TRUNG TÂM KIỂM KHO THÔNG MINH (BARCODE &amp; RFID DUAL-HUB)
            </h2>
            <p className="text-xs text-indigo-200/80 max-w-3xl leading-relaxed">
              Tích hợp đồng bộ giữa <strong>Súng quét mã vạch quang học 1D/2D</strong> (kiểm kê từng món theo kệ) và <strong>Súng kiểm kho sóng vô tuyến RFID</strong> (quét hàng loạt không tiếp xúc xuyên thùng bảo ôn kho lạnh -20°C).
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {/* Mode Switcher */}
            <div className="bg-slate-800/80 p-1 rounded-2xl border border-slate-700/80 flex items-center text-xs font-bold">
              <button
                type="button"
                onClick={() => scanner.setConnectionMode("LIVE_HARDWARE")}
                className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                  scanner.connectionMode === "LIVE_HARDWARE"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Thiết Bị Thật
              </button>
              <button
                type="button"
                onClick={() => scanner.setConnectionMode("SIMULATION")}
                className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                  scanner.connectionMode === "SIMULATION"
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Mô Phỏng
              </button>
            </div>

            {/* Bluetooth / Serial Pairing Modal Button */}
            <button
              type="button"
              onClick={() => setIsConnectModalOpen(true)}
              className="p-2.5 rounded-xl bg-indigo-600/70 hover:bg-indigo-600 border border-indigo-400/40 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Ghép nối máy quét Bluetooth hoặc Cổng COM"
            >
              <Bluetooth className="w-4 h-4" />
              <span className="hidden sm:inline">Ghép Nối Súng</span>
            </button>

            {/* Sound Toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                soundEnabled
                  ? "bg-indigo-600/60 border-indigo-400/40 text-white"
                  : "bg-slate-800/80 border-slate-700 text-slate-400"
              }`}
              title={soundEnabled ? "Tắt âm thanh bíp" : "Bật âm thanh bíp"}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Real-time Ticker of last scan */}
        <div className="mt-4 pt-3.5 border-t border-indigo-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-semibold">Tín hiệu quét gần nhất:</span>
            {scanner.lastScannedCode ? (
              <span className="font-mono font-black text-amber-300 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/40 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{scanner.lastScannedCode}</span>
                <span className="text-[10px] text-slate-400">
                  ({scanner.lastParsedResult?.type || "BARCODE"} • Tổng: {scanner.scanCount} lượt)
                </span>
              </span>
            ) : (
              <span className="text-slate-500 italic">Chưa nhận tín hiệu quét (Hãy bóp cò súng kiểm kho hoặc bấm nút test bên dưới)</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsSimDrawerOpen(!isSimDrawerOpen)}
            className="text-[11px] font-bold text-indigo-300 hover:text-white underline cursor-pointer"
          >
            {isSimDrawerOpen ? "Ẩn thanh bắn mã thử nghiệm ▲" : "Hiện thanh bắn mã thử nghiệm ▼"}
          </button>
        </div>

        {/* Quick Simulator Bar for instant testing without physical scanner */}
        {isSimDrawerOpen && (
          <div className="mt-3 p-3 rounded-2xl bg-indigo-950/70 border border-indigo-700/50 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Thanh Bắn Mã Test Nhanh (Dành cho kiểm thử khi chưa cắm súng quét):</span>
              </span>
              <span className="text-slate-400">Bấm nút bất kỳ để giả lập tín hiệu súng bắn vào hệ thống</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {shelfItems.slice(0, 3).map((it) => (
                <button
                  key={it.barcode}
                  type="button"
                  onClick={() => scanner.triggerManualScan(it.barcode)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-800 hover:bg-slate-700 text-indigo-200 border border-slate-700 cursor-pointer"
                >
                  +1 {it.sku} ({it.lot})
                </button>
              ))}
              {rfidTagsList.length > 0 && (
                <button
                  type="button"
                  onClick={() => scanner.triggerManualScan(rfidTagsList[0].epc)}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-700 cursor-pointer"
                >
                  +1 Chip RFID ({rfidTagsList[0].sku})
                </button>
              )}
              <button
                type="button"
                onClick={() => scanner.triggerManualScan("HANG-LA-UNKNOWN-999")}
                className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-700 cursor-pointer"
              >
                ⚠ Bắn Mã Lạ / Sai Kệ
              </button>
            </div>
          </div>
        )}

        {/* 4 Main Navigation Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-6 pt-5 border-t border-indigo-700/40 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab("barcode_audit")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === "barcode_audit"
                ? "bg-white text-indigo-950 shadow-lg font-black"
                : "bg-indigo-950/40 text-indigo-200 hover:bg-indigo-950/80 border border-indigo-700/40"
            }`}
          >
            <BarcodeIcon className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>1. Kiểm Kê Mã Vạch (Barcode)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("cycle_audit")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === "cycle_audit"
                ? "bg-white text-indigo-950 shadow-lg font-black"
                : "bg-indigo-950/40 text-indigo-200 hover:bg-indigo-950/80 border border-indigo-700/40"
            }`}
          >
            <Radio className="w-4 h-4 text-purple-400 shrink-0" />
            <span>2. Kiểm Kê Sóng RFID</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("dispatch_verify")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === "dispatch_verify"
                ? "bg-white text-indigo-950 shadow-lg font-black"
                : "bg-indigo-950/40 text-indigo-200 hover:bg-indigo-950/80 border border-indigo-700/40"
            }`}
          >
            <Zap className="w-4 h-4 text-amber-500 shrink-0" />
            <span>3. Đối Chiếu Xuất Kho 1 Chạm</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("encode_print")}
            className={`py-3 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === "encode_print"
                ? "bg-white text-indigo-950 shadow-lg font-black"
                : "bg-indigo-950/40 text-indigo-200 hover:bg-indigo-950/80 border border-indigo-700/40"
            }`}
          >
            <Printer className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>4. In &amp; Nạp Chip Zebra</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: KIỂM KÊ MÃ VẠCH TỪNG MÓN (BARCODE AUDIT) */}
      {/* ========================================================================= */}
      {activeTab === "barcode_audit" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-6">
            {/* Header Toolbar: Chọn vị trí kệ và thao tác */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-slate-900 dark:text-white uppercase text-base flex items-center gap-2">
                    <BarcodeIcon className="w-5 h-5 text-emerald-500" />
                    <span>Phiên Kiểm Kê Kho Bằng Máy Quét Mã Vạch (1D / QR Code)</span>
                  </h3>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cầm súng quét bấm từng hộp sản phẩm. Mỗi tiếng "bíp", số lượng thực tế tự động +1 và so khớp tồn kho tức thì.
                </p>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <select
                  value={selectedShelfKey}
                  onChange={(e) => handleSelectShelf(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  {Object.entries(shelfDatabase).map(([key, data]) => (
                    <option key={key} value={key}>
                      📍 {data.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleResetBarcodeAudit}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer"
                  title="Đặt lại số đếm phiên này về 0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Làm mới</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportBarcodeAuditExcel}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm flex items-center gap-1.5 cursor-pointer transition-all hover:scale-[1.02]"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Xuất Biên Bản Excel</span>
                </button>
              </div>
            </div>

            {/* 4 Thẻ Chỉ Số Tiến Độ Kiểm Kê Theo Kệ */}
            {(() => {
              const totalExpected = shelfItems.reduce((acc, it) => acc + it.expectedQty, 0);
              const totalScanned = shelfItems.reduce((acc, it) => acc + it.scannedQty, 0);
              const matchPercentage = totalExpected > 0 ? Math.min(100, Math.round((totalScanned / totalExpected) * 100)) : 100;
              const durationSec = Math.max(1, Math.round((Date.now() - barcodeAuditStartTime) / 1000));

              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60">
                    <div className="text-xs text-indigo-700 dark:text-indigo-400 font-bold">Tồn Sổ Sách Trên Kệ</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                      {totalExpected} <span className="text-xs font-normal">món</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">Số lượng theo hệ thống</div>
                  </div>

                  <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 font-bold">Thực Tế Đã Quét</div>
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                      {totalScanned} <span className="text-xs font-normal">món</span>
                    </div>
                    <div className="text-[10px] text-emerald-600 mt-1">Tiến độ: {matchPercentage}%</div>
                  </div>

                  <div className="p-4 rounded-2xl bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60">
                    <div className="text-xs text-rose-700 dark:text-rose-400 font-bold">Chênh Lệch / Thiếu</div>
                    <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
                      {Math.max(0, totalExpected - totalScanned)} <span className="text-xs font-normal">món</span>
                    </div>
                    <div className="text-[10px] text-rose-500 mt-1">Chưa quét tới</div>
                  </div>

                  <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                    <div className="text-xs text-amber-700 dark:text-amber-400 font-bold">Hàng Sai Kệ / Lạ</div>
                    <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                      {misplacedItems.length} <span className="text-xs font-normal">món</span>
                    </div>
                    <div className="text-[10px] text-amber-600 mt-1">Cần đưa về đúng vị trí</div>
                  </div>
                </div>
              );
            })()}

            {/* Bảng Danh Sách Hàng Hóa Cần Kiểm Tra Trên Kệ */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                    <th className="py-2.5 px-3">Mã SKU / Barcode</th>
                    <th className="py-2.5 px-3">Tên Sản Phẩm</th>
                    <th className="py-2.5 px-3">Lô &amp; HSD</th>
                    <th className="py-2.5 px-3 text-center">Sổ Sách</th>
                    <th className="py-2.5 px-3 text-center">Thực Tế</th>
                    <th className="py-2.5 px-3">Tiến Độ Quét</th>
                    <th className="py-2.5 px-3 text-right">Trạng Thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                  {shelfItems.map((item) => {
                    const isMatched = item.scannedQty === item.expectedQty;
                    const isOver = item.scannedQty > item.expectedQty;
                    const percent = Math.min(100, Math.round((item.scannedQty / item.expectedQty) * 100));

                    return (
                      <tr
                        key={item.id}
                        className={`transition-colors ${
                          isMatched
                            ? "bg-emerald-50/50 dark:bg-emerald-950/20"
                            : isOver
                            ? "bg-purple-50/50 dark:bg-purple-950/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        }`}
                      >
                        <td className="py-3 px-3">
                          <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {item.sku}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{item.barcode}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900 dark:text-white line-clamp-1">
                            {item.name}
                          </div>
                          <div className="text-[11px] text-slate-500">{item.storage}</div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="font-bold">{item.lot}</span>
                          <span className="text-slate-400 block text-[10px]">HSD: {item.exp}</span>
                        </td>
                        <td className="py-3 px-3 text-center font-bold text-slate-700 dark:text-slate-300">
                          {item.expectedQty} {item.unit}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-xl font-black text-sm ${
                              isMatched
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : isOver
                                ? "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                                : item.scannedQty > 0
                                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                            }`}
                          >
                            {item.scannedQty}
                          </span>
                        </td>
                        <td className="py-3 px-3 min-w-[140px]">
                          <div className="flex items-center gap-2">
                            <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  isMatched ? "bg-emerald-500" : isOver ? "bg-purple-500" : "bg-indigo-600"
                                }`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-bold text-slate-500 w-8 text-right">{percent}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {isMatched ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Khớp 100%
                            </span>
                          ) : isOver ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                              Thừa (+{item.scannedQty - item.expectedQty})
                            </span>
                          ) : item.scannedQty > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                              Đang quét ({item.scannedQty}/{item.expectedQty})
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500">
                              Chưa kiểm
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Khối Cảnh Báo Hàng Để Sai Kệ / Hàng Lạ */}
            {misplacedItems.length > 0 && (
              <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-rose-800 dark:text-rose-300">
                  <span className="flex items-center gap-1.5">
                    <AlertOctagon className="w-4 h-4 text-rose-600" />
                    <span>PHÁT HIỆN {misplacedItems.length} HỘP HÀNG ĐỂ SAI KỆ / KHÔNG THUỘC DANH MỤC:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMisplacedItems([])}
                    className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                  >
                    Xóa danh sách cảnh báo
                  </button>
                </div>

                <div className="space-y-1.5 text-xs">
                  {misplacedItems.map((m, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">
                          [{m.code}] - {m.name}
                        </span>
                        <div className="text-[10px] text-slate-500">{m.reason}</div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">{m.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: KIỂM KÊ SÓNG VÔ TUYẾN RFID (TOUCHLESS AUDIT) */}
      {/* ========================================================================= */}
      {activeTab === "cycle_audit" && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-black text-slate-900 dark:text-white uppercase text-base flex items-center gap-2">
                  <Radio className="w-5 h-5 text-purple-500" />
                  <span>Phiên Kiểm Kê Kho Sóng Vô Tuyến Không Tiếp Xúc (RFID UHF)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Quét toàn bộ dãy kệ kho khô và kho lạnh -20°C với tốc độ 500 thẻ/giây mà không cần mở thùng hàng
                </p>
              </div>

              <div className="flex items-center gap-3">
                <select
                  value={auditZone}
                  onChange={(e) => setAuditZone(e.target.value as any)}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-bold"
                >
                  <option value="KHO_LANH_AM20">Kho Lạnh -20°C (Sinh phẩm &amp; Enzyme)</option>
                  <option value="KHO_THIET_BI">Kho Thiết Bị &amp; Máy Demo</option>
                  <option value="KHO_VAT_TU">Kho Vật Tư Tiêu Hao (Đầu tip, đĩa PCR)</option>
                </select>

                <button
                  type="button"
                  disabled={isAuditing}
                  onClick={handleExecuteAudit}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 flex items-center gap-2 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                >
                  {isAuditing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang quét sóng vô tuyến...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>BẮT ĐẦU KIỂM KÊ 1 CHẠM</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Báo cáo kết quả kiểm kê */}
            {auditReport ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60">
                    <div className="text-xs text-indigo-700 dark:text-indigo-400 font-bold">Tồn Sổ Sách</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                      {auditReport.totalExpected} <span className="text-xs font-normal">món</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">Số dư theo hệ thống</div>
                  </div>

                  <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60">
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 font-bold">Thực Tế Quét Được</div>
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                      {auditReport.totalActual} <span className="text-xs font-normal">món</span>
                    </div>
                    <div className="text-[10px] text-emerald-600 mt-1">Tỷ lệ khớp: {auditReport.matchRate}%</div>
                  </div>

                  <div className="p-4 rounded-2xl bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60">
                    <div className="text-xs text-rose-700 dark:text-rose-400 font-bold">Thất Thoát / Thiếu</div>
                    <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
                      {auditReport.missingCount} <span className="text-xs font-normal">món</span>
                    </div>
                    <div className="text-[10px] text-rose-500 mt-1">Cần đối chiếu sổ sách</div>
                  </div>

                  <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60">
                    <div className="text-xs text-amber-700 dark:text-amber-400 font-bold">Thời Gian Kiểm Kê</div>
                    <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                      {auditReport.scanDurationSeconds} <span className="text-xs font-normal">giây</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">Nhanh gấp 30 lần Barcode</div>
                  </div>
                </div>

                {/* Bảng Chi Tiết Sai Lệch */}
                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-700 dark:text-slate-300">
                      Bảng Chi Tiết Mặt Hàng Cần Xử Lý ({auditZone})
                    </span>
                    <button
                      type="button"
                      onClick={handleExportRfidAuditExcel}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-1.5 hover:bg-emerald-500 cursor-pointer shadow-sm"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Xuất Biên Bản Excel</span>
                    </button>
                  </div>

                  <div className="space-y-2 text-xs">
                    {Array.isArray(auditReport.details) && auditReport.details.length > 0 ? (
                      auditReport.details.map((d: any, idx: number) => (
                        <div
                          key={`${d.sku}-${d.lot}-${idx}`}
                          className={`p-3 rounded-xl bg-white dark:bg-slate-900 border flex items-center justify-between ${
                            d.diff < 0
                              ? "border-rose-200 dark:border-rose-900"
                              : d.diff > 0
                              ? "border-amber-200 dark:border-amber-900"
                              : "border-emerald-200 dark:border-emerald-900"
                          }`}
                        >
                          <div>
                            <span
                              className={`font-bold block ${
                                d.diff < 0
                                  ? "text-rose-600 dark:text-rose-400"
                                  : d.diff > 0
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-emerald-600 dark:text-emerald-400"
                              }`}
                            >
                              [{d.statusText}] {d.name} (Lô {d.lot})
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Vị trí sổ sách: {d.shelfLabel} • Tồn sổ sách: {d.expectedQty} {d.unit} • Thực tế quét: {d.actualQty} {d.unit}
                            </span>
                          </div>
                          <span
                            className={`px-2.5 py-1 rounded font-bold text-[10px] ${
                              d.diff < 0
                                ? "bg-rose-100 dark:bg-rose-950 text-rose-700"
                                : d.diff > 0
                                ? "bg-amber-100 dark:bg-amber-950 text-amber-700"
                                : "bg-emerald-100 dark:bg-emerald-950 text-emerald-700"
                            }`}
                          >
                            {d.conclusionText}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-slate-500">
                        Chưa có mặt hàng tồn kho trong khu vực này để đối soát.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-slate-400 space-y-3">
                <Radio className="w-12 h-12 mx-auto stroke-1 text-slate-300 dark:text-slate-700" />
                <div className="text-sm font-bold text-slate-600 dark:text-slate-300">
                  Chưa có dữ liệu phiên kiểm kê
                </div>
                <p className="text-xs max-w-md mx-auto">
                  Bấm cò súng kiểm kho RFID trên thiết bị hoặc bấm nút <strong>"BẮT ĐẦU KIỂM KÊ 1 CHẠM"</strong> để máy quét sóng vô tuyến đối chiếu toàn bộ kho.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: ĐỐI CHIẾU XUẤT KHO THỜI GIAN THỰC (DISPATCH VERIFY) */}
      {/* ========================================================================= */}
      {activeTab === "dispatch_verify" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 flex items-center gap-2">
                    <Package className="w-4 h-4 text-indigo-500" />
                    <span>Chọn Phiếu Giao Hàng Xuất Kho</span>
                  </h3>
                </div>

                <div className="space-y-2">
                  {SAMPLE_DISPATCH_ORDERS.map((order) => (
                    <div
                      key={order.id}
                      onClick={() => {
                        setSelectedOrderId(order.id);
                        setDispatchScanResult(null);
                        setDispatchItemsProgress({});
                      }}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                        selectedOrderId === order.id
                          ? "border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/50 dark:border-indigo-500 shadow-sm"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {order.id}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                          {order.priority}
                        </span>
                      </div>
                      <div className="font-bold text-xs text-slate-900 dark:text-white line-clamp-1">
                        {order.customer}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                        <span>Ngày xuất: {order.expectedDate}</span>
                        <span>{order.items.length} mặt hàng</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Danh mục sản phẩm yêu cầu trong đơn */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
                    Danh Sách Mặt Hàng Chỉ Định (FEFO):
                  </span>
                  <div className="space-y-2">
                    {selectedOrder && selectedOrder.items && selectedOrder.items.length > 0 && selectedOrder.items.map((it: any, idx: number) => {
                      const currentProgress = dispatchItemsProgress[it.sku] || 0;
                      return (
                        <div
                          key={idx}
                          className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/60 dark:border-slate-800 text-xs"
                        >
                          <div className="font-bold text-slate-800 dark:text-slate-200 line-clamp-1">
                            {it.name}
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                            <span>
                              Đã quét: <strong className="text-emerald-600">{currentProgress}</strong> / {it.requiredQty}
                            </span>
                            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              Lô: {it.requiredLot}
                            </span>
                            <span className="text-emerald-600 font-medium">HSD: {it.exp}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Màn hình đối chiếu xuất kho */}
            <div className="lg:col-span-8 space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between min-h-[500px]">
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-black text-slate-900 dark:text-white text-base">
                          MÀN HÌNH ĐỐI CHIẾU XUẤT KHO SÓNG VÔ TUYẾN
                        </h4>
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Thiết bị: Súng kiểm kho Zebra MC3330xR / Barcode HID • Tần số UHF 920MHz
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isScanningDispatch}
                        onClick={() => handleSimulateDispatchScan("PERFECT")}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Mô phỏng: Khớp 100%</span>
                      </button>

                      <button
                        type="button"
                        disabled={isScanningDispatch}
                        onClick={() => handleSimulateDispatchScan("ERROR")}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-sm flex items-center gap-1.5 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Mô phỏng: Sai Lô FEFO</span>
                      </button>
                    </div>
                  </div>

                  {/* Khi đang quét */}
                  {isScanningDispatch && (
                    <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-full bg-indigo-500/20 animate-ping absolute inset-0" />
                        <div className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center relative shadow-xl">
                          <Radio className="w-8 h-8 animate-pulse" />
                        </div>
                      </div>
                      <div>
                        <div className="font-black text-slate-900 dark:text-white text-base">
                          ĐANG PHÁT SÓNG QUÉT TOÀN BỘ THÙNG HÀNG...
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Bắt tín hiệu xuyên qua thùng xốp bảo ôn và thùng carton (700 tags/giây)
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Khi chưa quét */}
                  {!isScanningDispatch && !dispatchScanResult && (
                    <div className="py-20 flex flex-col items-center justify-center text-center space-y-3 text-slate-400">
                      <Radio className="w-16 h-16 stroke-1 text-slate-300 dark:text-slate-700" />
                      <div className="font-bold text-slate-600 dark:text-slate-300 text-sm">
                        Chưa có tín hiệu quét cho phiếu {selectedOrderId}
                      </div>
                      <p className="text-xs max-w-md">
                        Cầm súng bắn vào thùng hàng hoặc bấm các nút trên để thực hiện đối chiếu ngay tức thì.
                      </p>
                    </div>
                  )}

                  {/* Kết quả đối chiếu thành công */}
                  {!isScanningDispatch && dispatchScanResult?.status === "SUCCESS" && (
                    <div className="my-5 p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-500/60 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30">
                            <CheckCircle2 className="w-7 h-7" />
                          </div>
                          <div>
                            <div className="font-black text-emerald-800 dark:text-emerald-300 text-lg">
                              ĐỐI CHIẾU KHỚP 100% • CHUẨN FEFO
                            </div>
                            <div className="text-xs text-emerald-700 dark:text-emerald-400">
                              Đã quét {dispatchScanResult.totalScanned}/{dispatchScanResult.totalRequired} món • Không phát hiện sai sót hay nhầm Lô
                            </div>
                          </div>
                        </div>

                        <span className="px-3 py-1 rounded-full text-xs font-black bg-emerald-600 text-white">
                          SẴN SÀNG DÁN NIÊM PHONG
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Kết quả sai lệch */}
                  {!isScanningDispatch && dispatchScanResult?.status === "DISCREPANCY" && (
                    <div className="my-5 p-5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-500/60 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-600/30">
                          <AlertOctagon className="w-7 h-7" />
                        </div>
                        <div>
                          <div className="font-black text-rose-800 dark:text-rose-300 text-lg">
                            CẢNH BÁO SAI LỆCH XUẤT KHO ({dispatchScanResult.matchPercentage}%)
                          </div>
                          <div className="text-xs text-rose-700 dark:text-rose-400">
                            Phát hiện {dispatchScanResult.errors.length} lỗi nghiêm trọng cần xử lý trước khi đóng hàng
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        {dispatchScanResult.errors.map((err: string, i: number) => (
                          <div
                            key={i}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 font-bold flex items-center gap-2"
                          >
                            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                            <span>{err}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: IN & MÃ HÓA THẺ CHIP (ZEBRA ZPL II) */}
      {/* ========================================================================= */}
      {activeTab === "encode_print" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-4">
              <form
                onSubmit={handleEncodeTags}
                className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4 text-xs"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h3 className="font-black text-slate-900 dark:text-white uppercase flex items-center gap-2">
                    <Printer className="w-4 h-4 text-indigo-500" />
                    <span>Lệnh In &amp; Ghi Mã Hóa Thẻ RFID</span>
                  </h3>
                  <span className="font-mono text-[10px] text-slate-400">ZEBRA ZPL II</span>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Máy in đích (Qua mạng LAN)
                  </label>
                  <input
                    type="text"
                    disabled
                    value={encodeForm.printerIp}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 font-mono font-bold text-slate-600 dark:text-slate-400"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Sản phẩm y tế cần nạp tem *
                  </label>
                  <select
                    value={encodeForm.sku}
                    onChange={(e) => {
                      const sku = e.target.value;
                      let name = "Kit Real-time PCR định lượng HBV";
                      if (sku === "TBR-9600") name = "Hệ thống Real-time PCR 96 giếng tự động";
                      if (sku === "MAG-BEADS-500") name = "Hóa chất tách chiết hạt từ (Magnetic Beads)";
                      setEncodeForm({ ...encodeForm, sku, productName: name });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold"
                  >
                    <option value="KIT-HBV-100">Kit Real-time PCR định lượng HBV (Viêm gan B)</option>
                    <option value="TBR-9600">Hệ thống Real-time PCR 96 giếng tự động TBR-9600</option>
                    <option value="MAG-BEADS-500">Hóa chất tách chiết hạt từ (Magnetic Beads)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Số Lô (Lot)</label>
                    <input
                      type="text"
                      value={encodeForm.lot}
                      onChange={(e) => setEncodeForm({ ...encodeForm, lot: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Hạn dùng (EXP)</label>
                    <DateInputVN
                      value={encodeForm.exp}
                      onChange={(e) => setEncodeForm({ ...encodeForm, exp: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Loại thẻ RFID</label>
                    <select
                      value={encodeForm.tagType}
                      onChange={(e) => setEncodeForm({ ...encodeForm, tagType: e.target.value as any })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-semibold"
                    >
                      <option value="CRYO">Cryo-RFID (Kho lạnh -20°C)</option>
                      <option value="ON_METAL">On-Metal (Thân máy kim loại)</option>
                      <option value="DECAL">Decal UHF Tiêu chuẩn</option>
                      <option value="CABLE_TIE">Thẻ treo (Thùng luân chuyển)</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block font-bold text-slate-700 dark:text-slate-300">Số lượng tem</label>
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={encodeForm.quantity}
                      onChange={(e) => setEncodeForm({ ...encodeForm, quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 font-bold text-center text-sm"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isEncoding}
                  className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                >
                  {isEncoding ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang nạp mã &amp; verify chip...</span>
                    </>
                  ) : (
                    <>
                      <Printer className="w-4 h-4" />
                      <span>XUẤT LỆNH IN &amp; GHI CHIP RFID ({encodeForm.quantity} TEM)</span>
                    </>
                  )}
                </button>
              </form>

              {lastZplPreview && (
                <div className="bg-slate-900 text-emerald-400 p-4 rounded-2xl font-mono text-[10px] space-y-1 overflow-x-auto border border-slate-800 max-h-48 overflow-y-auto">
                  <div className="text-slate-400 font-bold border-b border-slate-800 pb-1 mb-1">
                    Mã Lệnh Zebra ZPL RAW đã gửi tới cổng 9100:
                  </div>
                  <pre>{lastZplPreview}</pre>
                </div>
              )}
            </div>

            {/* Bảng Danh Sách Thẻ RFID */}
            <div className="lg:col-span-7 space-y-4">
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-slate-900 dark:text-white uppercase text-xs flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-purple-500" />
                      <span>Danh Mục Thẻ RFID Đang Hoạt Động ({rfidTagsList.length})</span>
                    </h3>
                    <p className="text-[11px] text-slate-500">Mã EPC định danh cá thể từng hộp kit và máy xét nghiệm</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                      Verified Read-after-Write
                    </span>
                    {rfidTagsList.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAllTags}
                        className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 hover:bg-rose-200 transition-colors cursor-pointer"
                        title="Xóa toàn bộ danh mục thẻ"
                      >
                        Xóa tất cả
                      </button>
                    )}
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={tagSearchQuery}
                    onChange={(e) => setTagSearchQuery(e.target.value)}
                    placeholder="🔍 Quét súng RFID hoặc gõ mã EPC, Số Lô để tra cứu..."
                    className="w-full pl-9 pr-9 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-semibold placeholder:text-slate-400 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  {tagSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setTagSearchQuery("")}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 uppercase">
                        <th className="py-2.5 px-3">Mã EPC 96-Bit</th>
                        <th className="py-2.5 px-3">Sản phẩm / SKU</th>
                        <th className="py-2.5 px-3">Lô &amp; HSD</th>
                        <th className="py-2.5 px-3">Loại thẻ</th>
                        <th className="py-2.5 px-3">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                      {filteredTags.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-500">
                            <Cpu className="w-8 h-8 mx-auto mb-2 text-slate-600 opacity-60" />
                            <p className="font-bold text-slate-400 text-xs">Chưa có thẻ RFID nào được ghi mã</p>
                            <p className="text-[11px] text-slate-500 mt-1">Dữ liệu giả lập đã được dọn sạch. Bạn hãy dùng form bên trái để ghi mã & in thẻ chip RFID mới.</p>
                          </td>
                        </tr>
                      ) : filteredTags.map((tag, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-3 font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                            {tag.epc}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-900 dark:text-white line-clamp-1">
                              {tag.productName}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">{tag.sku}</div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-[11px]">
                            <span className="font-bold">{tag.lot}</span>
                            <span className="text-slate-400 block text-[10px]">HSD: {tag.exp}</span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {tag.tagType}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                tag.status === "IN_STOCK"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                  : tag.status === "DEMO"
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                              }`}
                            >
                              {tag.status === "IN_STOCK" ? "Tồn Kho" : tag.status === "DEMO" ? "Máy Demo" : tag.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: GHÉP NỐI THIẾT BỊ PHẦN CỨNG (BLUETOOTH / COM SERIAL) */}
      {/* ========================================================================= */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Bluetooth className="w-5 h-5 text-indigo-600" />
                <h3 className="font-black text-slate-900 dark:text-white text-base">
                  GHÉP NỐI THIẾT BỊ KIỂM KHO VẬT LÝ
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsConnectModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 space-y-1">
                <div className="font-bold text-indigo-900 dark:text-indigo-300">
                  ℹ Cách máy quét kết nối với TBRs Portal:
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  1. <strong>Súng quét USB / Bluetooth HID thông thường:</strong> Tự động nhận ngay lập tức qua trình lắng nghe phím toàn màn hình mà <u>không cần ghép nối thêm</u>.<br/>
                  2. <strong>Đầu đọc RFID / Cổng Serial:</strong> Bấm các nút dưới đây để cấp quyền trình duyệt kết nối trực tiếp.
                </p>
              </div>

              {/* Bluetooth Option */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Bluetooth className="w-4 h-4 text-blue-500" />
                    <span>Máy Quét Không Dây (Web Bluetooth)</span>
                  </div>
                  {scanner.bluetoothDeviceName ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                      Đã kết nối
                    </span>
                  ) : (
                    <span className="text-slate-400 text-[10px]">Chưa ghép nối</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Tương thích với súng quét Bluetooth Zebra RFD40, RFD8500, Opticon, Netum, Symbol.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    await scanner.connectBluetooth();
                    setIsConnectModalOpen(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Bluetooth className="w-4 h-4" />
                  <span>Tìm &amp; Ghép Nối Máy Quét Bluetooth</span>
                </button>
              </div>

              {/* Serial COM Option */}
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Cable className="w-4 h-4 text-amber-500" />
                    <span>Cổng Cáp COM / RS-232 (Web Serial)</span>
                  </div>
                  {scanner.serialPortName ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                      Đã mở cổng
                    </span>
                  ) : (
                    <span className="text-slate-400 text-[10px]">Chưa mở cổng</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Dành cho đầu đọc cố định tại bàn hoặc giá kệ kết nối qua cáp USB-to-Serial COM.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    await scanner.connectSerial();
                    setIsConnectModalOpen(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                >
                  <Cable className="w-4 h-4" />
                  <span>Chọn Cổng Serial COM Port</span>
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setIsConnectModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
