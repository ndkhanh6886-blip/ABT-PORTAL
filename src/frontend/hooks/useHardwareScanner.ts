"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { parseScannedCode, ParsedScanResult } from "@/backend/services/rfidUtils";

export interface HardwareScannerState {
  isListening: boolean;
  lastScannedCode: string | null;
  lastParsedResult: ParsedScanResult | null;
  lastScanTime: number | null;
  scanCount: number;
  connectionMode: "LIVE_HARDWARE" | "SIMULATION";
  bluetoothDeviceName: string | null;
  serialPortName: string | null;
}

export interface UseHardwareScannerOptions {
  enabled?: boolean;
  maxKeyIntervalMs?: number; // threshold to differentiate between human typing and hardware gun
  minCodeLength?: number;
  onScan?: (result: ParsedScanResult, rawCode: string) => void;
}

export function useHardwareScanner(options: UseHardwareScannerOptions = {}) {
  const {
    enabled = true,
    maxKeyIntervalMs = 50,
    minCodeLength = 3,
    onScan
  } = options;

  const [state, setState] = useState<HardwareScannerState>({
    isListening: enabled,
    lastScannedCode: null,
    lastParsedResult: null,
    lastScanTime: null,
    scanCount: 0,
    connectionMode: "LIVE_HARDWARE",
    bluetoothDeviceName: null,
    serialPortName: null
  });

  const bufferRef = useRef<{ char: string; time: number }[]>([]);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const processBuffer = useCallback(() => {
    const buffer = bufferRef.current;
    bufferRef.current = [];

    if (buffer.length < minCodeLength) return;

    // Check keystroke intervals
    let isFast = true;
    for (let i = 1; i < buffer.length; i++) {
      const interval = buffer[i].time - buffer[i - 1].time;
      if (interval > maxKeyIntervalMs) {
        isFast = false;
        break;
      }
    }

    const fullString = buffer.map((b) => b.char).join("");

    // If it arrived fast OR if it matches standard EPC/Barcode pattern
    const isEpc = fullString.startsWith("TBR.");
    const isBarcode = fullString.includes("-") || fullString.length >= 6;

    if (isFast || isEpc || isBarcode) {
      const parsed = parseScannedCode(fullString);

      setState((prev) => ({
        ...prev,
        lastScannedCode: fullString,
        lastParsedResult: parsed,
        lastScanTime: Date.now(),
        scanCount: prev.scanCount + 1
      }));

      if (onScan) {
        onScan(parsed, fullString);
      }
    }
  }, [maxKeyIntervalMs, minCodeLength, onScan]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in a form textarea or regular text input unless it's fast keystrokes
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      
      // If Enter key is pressed, evaluate buffer
      if (e.key === "Enter" || e.key === "Tab") {
        if (bufferRef.current.length >= minCodeLength) {
          // Prevent form submit if it's a hardware barcode scan
          if (isInput) {
            e.preventDefault();
          }
          processBuffer();
        }
        return;
      }

      // Only capture printable single characters
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const now = Date.now();

        // Clear buffer if there was a long pause (> 120ms) between characters
        if (bufferRef.current.length > 0) {
          const lastTime = bufferRef.current[bufferRef.current.length - 1].time;
          if (now - lastTime > 120) {
            bufferRef.current = [];
          }
        }

        bufferRef.current.push({ char: e.key, time: now });

        // Reset inactivity timer
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          // If scanner does not send Enter, process after 80ms silence
          if (bufferRef.current.length >= minCodeLength) {
            processBuffer();
          }
        }, 90);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, minCodeLength, processBuffer]);

  // Connect Web Bluetooth
  const connectBluetooth = useCallback(async () => {
    if (typeof navigator === "undefined" || !(navigator as any).bluetooth) {
      alert("Trình duyệt này không hỗ trợ Web Bluetooth API. Vui lòng sử dụng Google Chrome hoặc Microsoft Edge.");
      return;
    }
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["battery_service", "0000ffe0-0000-1000-8000-00805f9b34fb"]
      });
      setState((prev) => ({
        ...prev,
        bluetoothDeviceName: device.name || "Máy quét Bluetooth",
        connectionMode: "LIVE_HARDWARE"
      }));
    } catch (err: any) {
      if (err.name !== "NotFoundError") {
        console.warn("Bluetooth connection error:", err);
      }
    }
  }, []);

  // Connect Web Serial
  const connectSerial = useCallback(async () => {
    if (typeof navigator === "undefined" || !(navigator as any).serial) {
      alert("Trình duyệt này không hỗ trợ Web Serial API. Vui lòng sử dụng Google Chrome hoặc Microsoft Edge.");
      return;
    }
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });
      setState((prev) => ({
        ...prev,
        serialPortName: "Cổng COM (Serial 9600 bps)",
        connectionMode: "LIVE_HARDWARE"
      }));
    } catch (err: any) {
      if (err.name !== "NotFoundError") {
        console.warn("Serial connection error:", err);
      }
    }
  }, []);

  // Toggle mode
  const setConnectionMode = useCallback((mode: "LIVE_HARDWARE" | "SIMULATION") => {
    setState((prev) => ({ ...prev, connectionMode: mode }));
  }, []);

  // Simulate a manual scan
  const triggerManualScan = useCallback((code: string) => {
    const parsed = parseScannedCode(code);
    setState((prev) => ({
      ...prev,
      lastScannedCode: code,
      lastParsedResult: parsed,
      lastScanTime: Date.now(),
      scanCount: prev.scanCount + 1
    }));
    if (onScan) {
      onScan(parsed, code);
    }
  }, [onScan]);

  return {
    ...state,
    connectBluetooth,
    connectSerial,
    setConnectionMode,
    triggerManualScan
  };
}
