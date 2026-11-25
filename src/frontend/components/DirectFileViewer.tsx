"use client";

import React, { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Eye, FileSpreadsheet, FileText, Loader2 } from "lucide-react";

export interface DirectFileViewerProps {
  url: string;
  name: string;
  mimeType?: string;
  sizeLabel?: string;
  uploadedAtLabel?: string;
  zoom?: number;
}

type ParsedBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; align?: "left" | "center" | "right" | "justify" }
  | { kind: "paragraph"; text: string; bold?: boolean; italic?: boolean; align?: "left" | "center" | "right" | "justify"; isList?: boolean }
  | { kind: "table"; rows: string[][] };

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Minimal pure-JS ZIP entries extractor using browser DecompressionStream("deflate-raw")
 * so .docx (OpenXML ZIP) can be parsed and rendered directly in the browser without external dependencies.
 */
async function extractZipFileText(buf: ArrayBuffer, targetEntryName: string): Promise<string | null> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  // Find End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minEocd = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder("utf-8");

  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries && ptr + 46 <= bytes.length; idx++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const fileNameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const entryName = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + fileNameLen));
    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (entryName.toLowerCase() !== targetEntryName.toLowerCase()) continue;

    if (localHeaderOffset + 30 > bytes.length || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      return null;
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedSlice = bytes.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      return decoder.decode(compressedSlice);
    }
    if (compressionMethod === 8 && typeof DecompressionStream !== "undefined") {
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      writer.write(compressedSlice);
      writer.close();
      const decompressedBuf = await new Response(ds.readable).arrayBuffer();
      return decoder.decode(decompressedBuf);
    }
    return null;
  }
  return null;
}

function parseDocxParagraphXml(pXml: string): {
  text: string;
  bold: boolean;
  italic: boolean;
  align?: "left" | "center" | "right" | "justify";
  headingLevel?: 1 | 2 | 3;
  isList?: boolean;
} {
  const alignMatch = /<w:jc\s+w:val="([^"]+)"/i.exec(pXml);
  let align: "left" | "center" | "right" | "justify" | undefined;
  if (alignMatch) {
    const v = alignMatch[1].toLowerCase();
    if (v === "center") align = "center";
    else if (v === "right" || v === "end") align = "right";
    else if (v === "both" || v === "distribute") align = "justify";
  }

  const styleMatch = /<w:pStyle\s+w:val="([^"]+)"/i.exec(pXml);
  let headingLevel: 1 | 2 | 3 | undefined;
  if (styleMatch) {
    const st = styleMatch[1].toLowerCase();
    if (st.includes("heading1") || st === "1" || st.includes("title")) headingLevel = 1;
    else if (st.includes("heading2") || st === "2" || st.includes("subtitle")) headingLevel = 2;
    else if (st.includes("heading3") || st === "3") headingLevel = 3;
  }

  const isList = /<w:numPr[\s>]/i.test(pXml);
  const pPrBold = /<w:pPr[\s\S]*?<w:b(?:\s|\/|>)/i.test(pXml);

  // Extract runs and tabs/linebreaks
  const tokenRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/gi;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(pXml)) !== null) {
    if (m[0].toLowerCase().startsWith("<w:tab")) {
      parts.push("\t");
    } else if (m[0].toLowerCase().startsWith("<w:br")) {
      parts.push("\n");
    } else if (m[1] !== undefined) {
      parts.push(decodeXmlEntities(m[1]));
    }
  }
  const text = parts.join("").trim();
  const hasRunBold = /<w:rPr[\s\S]*?<w:b(?:\s|\/|>)/i.test(pXml) && !/<w:b\s+w:val="(?:false|0)"/i.test(pXml);
  const hasRunItalic = /<w:rPr[\s\S]*?<w:i(?:\s|\/|>)/i.test(pXml) && !/<w:i\s+w:val="(?:false|0)"/i.test(pXml);

  return {
    text,
    bold: pPrBold || (hasRunBold && text.length < 180),
    italic: hasRunItalic && text.length < 220,
    align,
    headingLevel,
    isList,
  };
}

function parseDocxDocumentXml(xml: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const bodyMatch = /<w:body[^>]*>([\s\S]*?)<\/w:body>/i.exec(xml);
  const bodyXml = bodyMatch ? bodyMatch[1] : xml;

  // Match top-level tables <w:tbl>...</w:tbl> or paragraphs <w:p ...>...</w:p>
  const topBlockRegex = /<w:tbl[\s>][\s\S]*?<\/w:tbl>|<w:p(?:\s+[^>]*)?>[\s\S]*?<\/w:p>/gi;
  let m: RegExpExecArray | null;
  while ((m = topBlockRegex.exec(bodyXml)) !== null) {
    const chunk = m[0];
    if (chunk.toLowerCase().startsWith("<w:tbl")) {
      const rows: string[][] = [];
      const trRegex = /<w:tr(?:\s+[^>]*)?>([\s\S]*?)<\/w:tr>/gi;
      let trMatch: RegExpExecArray | null;
      while ((trMatch = trRegex.exec(chunk)) !== null) {
        const rowCells: string[] = [];
        const tcRegex = /<w:tc(?:\s+[^>]*)?>([\s\S]*?)<\/w:tc>/gi;
        let tcMatch: RegExpExecArray | null;
        while ((tcMatch = tcRegex.exec(trMatch[1])) !== null) {
          const cellParas: string[] = [];
          const pRegex = /<w:p(?:\s+[^>]*)?>([\s\S]*?)<\/w:p>/gi;
          let pMatch: RegExpExecArray | null;
          while ((pMatch = pRegex.exec(tcMatch[1])) !== null) {
            const parsedP = parseDocxParagraphXml(pMatch[0]);
            if (parsedP.text) cellParas.push(parsedP.text);
          }
          rowCells.push(cellParas.join("\n"));
        }
        if (rowCells.some((c) => c.trim() !== "")) {
          rows.push(rowCells);
        }
      }
      if (rows.length > 0) {
        blocks.push({ kind: "table", rows });
      }
    } else {
      const parsed = parseDocxParagraphXml(chunk);
      if (!parsed.text) continue;
      if (parsed.headingLevel) {
        blocks.push({
          kind: "heading",
          level: parsed.headingLevel,
          text: parsed.text,
          align: parsed.align,
        });
      } else if (
        /^(?:CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM|HỢP ĐỒNG|PHỤ LỤC|BIÊN BẢN|QUYẾT ĐỊNH|THÔNG BÁO)/i.test(parsed.text) &&
        parsed.text.length < 140
      ) {
        blocks.push({
          kind: "heading",
          level: 2,
          text: parsed.text,
          align: parsed.align || "center",
        });
      } else {
        blocks.push({
          kind: "paragraph",
          text: parsed.text,
          bold: parsed.bold || /^(?:ĐIỀU\s+\d+|CHƯƠNG\s+[IVX\d]+|BÊN\s+[AB]|ĐẠI DIỆN\s+BÊN)/i.test(parsed.text),
          italic: parsed.italic,
          align: parsed.align,
          isList: parsed.isList,
        });
      }
    }
  }
  return blocks;
}

/**
 * Fallback text extractor for legacy binary .doc (Word 97-2003) files
 */
function extractLegacyDocBlocks(buf: ArrayBuffer): ParsedBlock[] {
  const bytes = new Uint8Array(buf);
  // Try UTF-16LE runs and ASCII/UTF-8 runs
  const chunks: string[] = [];
  const utf16Decoder = new TextDecoder("utf-16le", { fatal: false });
  const raw16 = utf16Decoder.decode(bytes);
  const lines16 = raw16
    .split(/[\r\n]+/)
    .map((l) => l.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, "").trim())
    .filter((l) => l.length >= 6 && /[\p{L}]{3,}/u.test(l));
  if (lines16.length >= 5) {
    chunks.push(...lines16);
  } else {
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const lines8 = utf8
      .split(/[\r\n]+/)
      .map((l) => l.replace(/[^\x20-\x7E\u00A0-\u1EF9]/g, "").trim())
      .filter((l) => l.length >= 8 && /[a-zA-ZÀ-ỹ]{3,}/.test(l));
    chunks.push(...lines8);
  }
  return chunks.slice(0, 400).map((t) => ({
    kind: "paragraph",
    text: t,
    bold: /^(?:ĐIỀU\s+\d+|HỢP ĐỒNG|BÊN\s+[AB])/i.test(t),
  }));
}

export const DirectFileViewer: React.FC<DirectFileViewerProps> = ({
  url,
  name,
  mimeType = "",
  sizeLabel,
  uploadedAtLabel,
  zoom = 100,
}) => {
  const lowerName = (name || "").toLowerCase();
  const lowerMime = (mimeType || "").toLowerCase();
  const lowerUrl = (url || "").toLowerCase();

  const isPdf =
    lowerName.endsWith(".pdf") ||
    lowerMime.includes("pdf") ||
    lowerUrl.includes("application/pdf") ||
    lowerUrl.includes(".pdf");
  const isImage =
    lowerMime.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(lowerName) ||
    lowerUrl.startsWith("data:image/");
  const isDocx =
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc") ||
    lowerMime.includes("wordprocessingml") ||
    lowerMime.includes("msword");
  const isSpreadsheet =
    /\.(xlsx|xls|csv)$/i.test(lowerName) ||
    lowerMime.includes("spreadsheetml") ||
    lowerMime.includes("ms-excel") ||
    lowerMime.includes("text/csv");
  const isText =
    /\.(txt|log|json|xml|md|rtf)$/i.test(lowerName) ||
    lowerMime.startsWith("text/plain") ||
    lowerMime.includes("application/json");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [docxBlocks, setDocxBlocks] = useState<ParsedBlock[] | null>(null);
  const [sheets, setSheets] = useState<{ name: string; rows: string[][] }[] | null>(null);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;
    setErrorMsg(null);
    setDocxBlocks(null);
    setSheets(null);
    setTextContent(null);
    setPdfBlobUrl(null);

    if (!url) return;

    // 1. Base64 PDF -> convert to Blob URL so Chrome/Edge PDF viewer never blocks large data: URLs
    if (isPdf && url.startsWith("data:")) {
      try {
        const b64 = url.split(",")[1] || "";
        const bin = window.atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        revokedUrl = URL.createObjectURL(blob);
        setPdfBlobUrl(revokedUrl);
      } catch {
        setPdfBlobUrl(null);
      }
      return () => {
        if (revokedUrl) URL.revokeObjectURL(revokedUrl);
      };
    }

    // 2. DOCX / DOC / XLSX / XLS / CSV / TXT -> fetch ArrayBuffer and render directly in-app
    if (isDocx || isSpreadsheet || isText) {
      setLoading(true);
      (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Không tải được dữ liệu tệp (HTTP ${res.status})`);
          }
          const buf = await res.arrayBuffer();
          if (cancelled) return;

          if (isDocx) {
            const xml = await extractZipFileText(buf, "word/document.xml");
            if (xml) {
              const blocks = parseDocxDocumentXml(xml);
              if (!cancelled) {
                setDocxBlocks(blocks);
              }
            } else {
              // Legacy .doc fallback
              const legacyBlocks = extractLegacyDocBlocks(buf);
              if (!cancelled) {
                if (legacyBlocks.length > 0) {
                  setDocxBlocks(legacyBlocks);
                } else {
                  setErrorMsg("Tệp Word định dạng nhị phân cũ (.doc) không chứa lớp văn bản XML chuẩn.");
                }
              }
            }
          } else if (isSpreadsheet) {
            const wb = XLSX.read(buf, { type: "array" });
            const parsedSheets: { name: string; rows: string[][] }[] = [];
            for (const sName of wb.SheetNames) {
              const ws = wb.Sheets[sName];
              const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
              const cleanRows = aoa
                .map((r) => (Array.isArray(r) ? r.map((cell) => String(cell ?? "")) : []))
                .filter((r) => r.some((c) => c.trim() !== ""))
                .slice(0, 300);
              parsedSheets.push({ name: sName, rows: cleanRows });
            }
            if (!cancelled) {
              setSheets(parsedSheets);
              setActiveSheetIdx(0);
            }
          } else if (isText) {
            const txt = new TextDecoder("utf-8", { fatal: false }).decode(buf);
            if (!cancelled) {
              setTextContent(txt.slice(0, 200_000));
            }
          }
        } catch (err: any) {
          if (!cancelled) {
            setErrorMsg(err?.message || "Không thể đọc nội dung tệp trực tiếp.");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [url, name, isPdf, isDocx, isSpreadsheet, isText]);

  // A. PDF Direct Viewer
  if (isPdf) {
    const srcUrl = pdfBlobUrl || url;
    return (
      <div className="space-y-3 w-full">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-white/5 p-2.5 rounded-xl border border-white/10">
          <span className="font-bold text-white flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-rose-400" />
            <span>{name}</span>
            {sizeLabel ? <span className="text-slate-400 font-normal">({sizeLabel})</span> : null}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-emerald-400 font-semibold">
              ✓ Đang đọc trực tiếp qua Web PDF Engine
            </span>
            <a
              href={url}
              download={name}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            >
              <Download className="w-3.5 h-3.5" /> Tải về
            </a>
          </div>
        </div>
        <iframe
          src={srcUrl}
          className="w-full h-[70vh] rounded-xl border border-slate-700 bg-white shadow-xl"
          title={name}
        />
      </div>
    );
  }

  // B. Image Direct Viewer
  if (isImage) {
    return (
      <div className="space-y-3 text-center w-full">
        <div className="flex items-center justify-between text-xs text-slate-300 bg-white/5 p-2.5 rounded-xl border border-white/10 text-left">
          <div>
            <span className="font-bold text-white">{name}</span>{" "}
            {sizeLabel ? <span className="text-slate-400">({sizeLabel})</span> : null}
          </div>
          <a
            href={url}
            download={name}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
          >
            <Download className="w-3.5 h-3.5" /> Tải ảnh về
          </a>
        </div>
        <div className="p-4 bg-white/5 rounded-2xl flex items-center justify-center overflow-auto">
          <img
            src={url}
            alt={name}
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            className="max-h-[68vh] object-contain rounded-xl shadow-2xl transition-transform"
          />
        </div>
      </div>
    );
  }

  // C. Loading State for DOCX / XLSX / TXT
  if (loading) {
    return (
      <div className="py-16 text-center space-y-3 text-slate-300">
        <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
        <div className="text-xs font-bold">Đang giải mã và dựng trang đọc trực tiếp cho tệp &ldquo;{name}&rdquo;...</div>
      </div>
    );
  }

  // D. Direct Word (.docx / .doc) Reader Canvas
  if (isDocx && docxBlocks && docxBlocks.length > 0) {
    return (
      <div className="space-y-3 w-full">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-white/5 p-2.5 rounded-xl border border-white/10">
          <span className="font-bold text-white flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-sky-400" />
            <span>{name}</span>
            {sizeLabel ? <span className="text-slate-400 font-normal">({sizeLabel})</span> : null}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-emerald-400 font-semibold">
              ✓ Đang đọc trực tiếp toàn văn tài liệu Word (Không cần tải về)
            </span>
            <a
              href={url}
              download={name}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            >
              <Download className="w-3.5 h-3.5" /> Tải bản gốc .DOCX
            </a>
          </div>
        </div>

        <div className="overflow-x-auto p-2">
          <div
            style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}
            className="transition-transform duration-200"
          >
            <div className="max-w-4xl mx-auto bg-white text-slate-900 p-8 sm:p-14 rounded-2xl shadow-2xl border border-slate-200 space-y-3.5 font-sans select-text">
              {docxBlocks.map((b, i) => {
                if (b.kind === "heading") {
                  const alignCls =
                    b.align === "center"
                      ? "text-center"
                      : b.align === "right"
                        ? "text-right"
                        : "text-left";
                  const sizeCls =
                    b.level === 1
                      ? "text-lg sm:text-xl font-bold text-slate-900 pt-2"
                      : b.level === 2
                        ? "text-base sm:text-lg font-bold text-slate-900 pt-1.5"
                        : "text-sm font-bold text-slate-800 pt-1";
                  return (
                    <div key={i} className={`${alignCls} ${sizeCls}`}>
                      {b.text}
                    </div>
                  );
                }
                if (b.kind === "table") {
                  return (
                    <div key={i} className="overflow-x-auto my-3">
                      <table className="w-full border-collapse border border-slate-300 text-xs">
                        <tbody>
                          {b.rows.map((row, rIdx) => (
                            <tr key={rIdx} className={rIdx === 0 ? "bg-slate-100 font-semibold" : "even:bg-slate-50/50"}>
                              {row.map((cell, cIdx) => (
                                <td
                                  key={cIdx}
                                  className="border border-slate-300 px-3 py-2 align-top whitespace-pre-line text-slate-800"
                                >
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }
                const alignCls =
                  b.align === "center"
                    ? "text-center"
                    : b.align === "right"
                      ? "text-right"
                      : b.align === "justify"
                        ? "text-justify"
                        : "text-left";
                return (
                  <p
                    key={i}
                    className={`text-xs sm:text-[13px] leading-relaxed text-slate-800 whitespace-pre-line ${alignCls} ${
                      b.bold ? "font-bold text-slate-900" : ""
                    } ${b.italic ? "italic" : ""} ${b.isList ? "pl-5 relative before:content-['•'] before:absolute before:left-1.5 before:text-slate-500" : ""}`}
                  >
                    {b.text}
                  </p>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // E. Direct Excel / CSV (.xlsx / .xls / .csv) Reader Canvas
  if (isSpreadsheet && sheets && sheets.length > 0) {
    const currentSheet = sheets[activeSheetIdx] || sheets[0];
    return (
      <div className="space-y-3 w-full">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-white/5 p-2.5 rounded-xl border border-white/10">
          <span className="font-bold text-white flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>{name}</span>
            {sizeLabel ? <span className="text-slate-400 font-normal">({sizeLabel})</span> : null}
          </span>
          <div className="flex items-center gap-2">
            {sheets.length > 1 && (
              <div className="flex items-center gap-1">
                {sheets.map((s, idx) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setActiveSheetIdx(idx)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                      idx === activeSheetIdx
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <a
              href={url}
              download={name}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            >
              <Download className="w-3.5 h-3.5" /> Tải bảng tính
            </a>
          </div>
        </div>

        <div className="overflow-auto max-h-[68vh] bg-white text-slate-900 rounded-2xl border border-slate-300 shadow-xl">
          {currentSheet.rows.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">Sheet này không có dữ liệu.</div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <tbody>
                {currentSheet.rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    className={
                      rIdx === 0
                        ? "bg-slate-100 font-bold text-slate-900 sticky top-0 shadow-2xs"
                        : "border-t border-slate-200 hover:bg-sky-50/50"
                    }
                  >
                    <td className="px-2 py-1.5 bg-slate-50 text-slate-400 font-mono text-[10px] border-r border-slate-200 text-center select-none">
                      {rIdx + 1}
                    </td>
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5 border-r border-slate-200 whitespace-pre-wrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // F. Direct Plain Text / XML / JSON Reader
  if (isText && textContent !== null) {
    return (
      <div className="space-y-3 w-full">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 bg-white/5 p-2.5 rounded-xl border border-white/10">
          <span className="font-bold text-white flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-sky-400" />
            <span>{name}</span>
          </span>
          <a
            href={url}
            download={name}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
          >
            <Download className="w-3.5 h-3.5" /> Tải về
          </a>
        </div>
        <pre className="p-6 bg-white text-slate-900 rounded-2xl border border-slate-300 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-[68vh]">
          {textContent}
        </pre>
      </div>
    );
  }

  // G. Fallback download card for archives (.zip, .rar, .7z) or unsupported binary formats
  return (
    <div className="max-w-xl mx-auto text-center space-y-4 py-10">
      <FileText className="w-12 h-12 text-sky-400 mx-auto" />
      <div>
        <div className="font-bold text-white text-sm break-all">{name}</div>
        {(sizeLabel || uploadedAtLabel) && (
          <div className="text-[11px] text-slate-400 mt-1">
            {[sizeLabel, uploadedAtLabel ? `Tải lên: ${uploadedAtLabel}` : ""].filter(Boolean).join(" • ")}
          </div>
        )}
      </div>
      <div className="text-xs text-slate-400">
        {errorMsg || "Định dạng tệp đóng gói này cần tải về máy tính để giải nén / mở bằng phần mềm chuyên dụng."}
      </div>
      <div className="flex items-center justify-center gap-2">
        <a
          href={url}
          download={name}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
        >
          <Download className="w-4 h-4" /> Tải file về
        </a>
        {!url.startsWith("data:") && (
          <a
            href={url}
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
};
