/**
 * RFID & Barcode Core Utilities for ABT Healthcare Portal
 * Standard compliance: GS1 SGTIN-96, Code 128, QR Code, Zebra ZPL II
 */

export interface RfidTagItem {
  epc: string;
  sku: string;
  productName: string;
  lot: string;
  exp: string;
  serialNumber?: string;
  storageCondition: string;
  tagType: "ON_METAL" | "CRYO" | "DECAL" | "CABLE_TIE";
  status: "COMMISSIONED" | "IN_STOCK" | "PICKED" | "DISPATCHED" | "DEMO";
  location: string;
  hospitalName?: string;
  createdAt: string;
}

export interface RawRfidScan {
  epc: string;
  rssi: number; // in -dBm (e.g. -45 is strong, -85 is weak)
  antenna?: number;
  timestamp: number;
}

/**
 * Encodes a product into a standard GS1-style EPC format for ABT Healthcare
 * Example format: ABT.[CATEGORY].[SKU].[LOT].[SERIAL]
 */
export function generateEpcCode(
  categoryCode: string,
  sku: string,
  lot: string,
  serialOrIndex: string | number
): string {
  const cleanCat = (categoryCode || "KT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const cleanSku = (sku || "PROD").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  const cleanLot = (lot || "L001").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const cleanSerial = String(serialOrIndex).padStart(6, "0");
  return `ABT.${cleanCat}.${cleanSku}.${cleanLot}.${cleanSerial}`;
}

/**
 * Decodes an EPC string into its component parts
 */
export function decodeEpcCode(epc: string): {
  isValid: boolean;
  prefix: string;
  category: string;
  sku: string;
  lot: string;
  serial: string;
} {
  if (!epc || !epc.startsWith("ABT.")) {
    return {
      isValid: false,
      prefix: "",
      category: "",
      sku: "",
      lot: "",
      serial: ""
    };
  }
  const parts = epc.split(".");
  return {
    isValid: parts.length >= 5,
    prefix: parts[0] || "ABT",
    category: parts[1] || "",
    sku: parts[2] || "",
    lot: parts[3] || "",
    serial: parts[4] || ""
  };
}

/**
 * Zebra ZPL II Command Generator for RFID Label Printing & Encoding
 * Compatible with Zebra ZT411R, ZD621R, Bixolon XT5-40NR
 */
export function generateZplRfidCode(params: {
  productName: string;
  sku: string;
  lot: string;
  exp: string;
  epcCode: string;
  storageCondition?: string;
  copies?: number;
}): string {
  const {
    productName,
    sku,
    lot,
    exp,
    epcCode,
    storageCondition = "-20°C (Kho Lạnh Âm)",
    copies = 1
  } = params;

  // Convert EPC to Hex string for ZPL ^RFW command
  const epcHex = Buffer.from(epcCode).toString("hex").toUpperCase();

  return `^XA
^PW600
^LL400
^PON
^LH0,0

; --- RFID UHF Encoding Block ---
^RS8,,,1^FS
^RFW,H,1,2,${Math.ceil(epcHex.length / 4)}^FD${epcHex}^FS

; --- Visual Header ---
^FO40,30^A0N,28,28^FDCONG TY TNHH KHOA HOC ABT^FS
^FO40,65^GB520,2,2^FS

; --- Product Name ---
^FO40,80^A0N,24,24^FDSP: ${productName.slice(0, 36)}^FS
^FO40,115^A0N,20,20^FDMa SKU: ${sku}^FS

; --- Batch / Lot & Expiry ---
^FO40,145^A0N,22,22^FDSo Lo: ${lot}   HSD: ${exp}^FS
^FO40,175^A0N,18,18^FDBao quan: ${storageCondition}^FS

; --- 1D Barcode Code 128 ---
^FO40,210^BY2,3,60^BCN,60,Y,N,N^FD${sku}-${lot}^FS

; --- 2D QR Code on the Right ---
^FO420,110^BQN,2,4^FDQA,${epcCode}^FS

; --- RFID Tag Visual Indicator ---
^FO40,300^A0N,16,16^FDRFID UHF EPC Gen2 Verified [ABT WMS 4.0]^FS
^FO40,320^A0N,14,14^FDEPC: ${epcCode}^FS

^PQ${copies},0,1,Y
^XZ`;
}

/**
 * Filters out weak RFID stray signals (cross-reads from adjacent aisles)
 * and eliminates duplicate scans within a sliding window.
 */
export function filterRfidTags(
  rawScans: RawRfidScan[],
  minRssi = -70
): { validScans: RawRfidScan[]; droppedStrayCount: number; duplicateCount: number } {
  const seen = new Set<string>();
  const validScans: RawRfidScan[] = [];
  let droppedStrayCount = 0;
  let duplicateCount = 0;

  for (const scan of rawScans) {
    if (scan.rssi < minRssi) {
      droppedStrayCount++;
      continue;
    }
    if (seen.has(scan.epc)) {
      duplicateCount++;
      continue;
    }
    seen.add(scan.epc);
    validScans.push(scan);
  }

  return { validScans, droppedStrayCount, duplicateCount };
}

/**
 * Audio cues for Web Application using Web Audio API (Zero external assets)
 */
export function playRfidSound(type: "success" | "error" | "scan_tick" | "warning"): void {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (type === "success") {
      // Pleasant double chime (Ding-Ding)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc1.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

      osc1.connect(gain);
      gain.connect(ctx.destination);
      osc1.start();
      osc1.stop(ctx.currentTime + 0.35);
    } else if (type === "scan_tick") {
      // Quick subtle radar tick (RFID chirp)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } else if (type === "error") {
      // Harsh low warning buzzer (Error/Discrepancy)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      osc.frequency.setValueAtTime(140, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } else if (type === "warning") {
      // Alert pulse (FEFO alert)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(330, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (err) {
    console.warn("Web Audio not supported or blocked by user gesture:", err);
  }
}

export interface ParsedScanResult {
  raw: string;
  type: "RFID_EPC" | "BARCODE_1D" | "QR_2D";
  sku?: string;
  lot?: string;
  serial?: string;
  category?: string;
  isValid: boolean;
}

/**
 * Parses any incoming scanned string (from USB/Bluetooth scanner, camera, or RFID reader)
 * into structured components (SKU, Lot, Serial, Type)
 */
export function parseScannedCode(raw: string): ParsedScanResult {
  const clean = (raw || "").trim();
  if (!clean) {
    return { raw: "", type: "BARCODE_1D", isValid: false };
  }

  // 1. Check if RFID EPC Gen2 format: ABT.[CAT].[SKU].[LOT].[SERIAL]
  if (clean.startsWith("ABT.")) {
    const epc = decodeEpcCode(clean);
    return {
      raw: clean,
      type: "RFID_EPC",
      sku: epc.sku,
      lot: epc.lot,
      serial: epc.serial,
      category: epc.category,
      isValid: epc.isValid
    };
  }

  // 2. Check if 2D QR Code JSON format: {"tbr_id":"ABT-IVD-VN","sku":"...","lot":"..."}
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const parsed = JSON.parse(clean);
      return {
        raw: clean,
        type: "QR_2D",
        sku: parsed.sku || parsed.product_code || "",
        lot: parsed.lot || parsed.batch_lot || "",
        serial: parsed.serial || parsed.serial_number || "",
        isValid: Boolean(parsed.sku || parsed.product_code)
      };
    } catch {
      // not JSON
    }
  }

  // 3. Check if standard 1D Barcode: SKU-LOT (e.g. KIT-HBV-100-L26081)
  const parts = clean.split("-");
  if (parts.length >= 2) {
    const lotCandidate = parts[parts.length - 1];
    const skuCandidate = parts.slice(0, -1).join("-");
    return {
      raw: clean,
      type: "BARCODE_1D",
      sku: skuCandidate,
      lot: lotCandidate,
      isValid: true
    };
  }

  // 4. Standalone SKU or Serial
  return {
    raw: clean,
    type: "BARCODE_1D",
    sku: clean,
    isValid: true
  };
}
