import React from "react";

// ISO/IEC 15417 Code 128 bar/space width patterns (indices 0..106)
const CODE128_PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]!);
}

/** Encodes ASCII printable text into Code-128 Subset B bar coordinates (1 module = 1 unit). */
function encodeCode128B(rawValue: string): { bars: { x: number; w: number }[]; totalWidth: number; text: string } {
  const clean = (rawValue || "").replace(/[^\x20-\x7e]/g, "?");
  const text = clean || "-";
  const codes: number[] = [104]; // START_B
  let checksum = 104;

  for (let i = 0; i < text.length; i++) {
    const code = Math.max(0, Math.min(94, text.charCodeAt(i) - 32));
    codes.push(code);
    checksum += code * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106); // STOP

  const quietZone = 10;
  let x = quietZone;
  const bars: { x: number; w: number }[] = [];
  for (const sym of codes) {
    const pattern = CODE128_PATTERNS[sym] ?? CODE128_PATTERNS[0];
    for (let i = 0; i < pattern.length; i++) {
      const w = Number(pattern[i]);
      if (i % 2 === 0) bars.push({ x, w });
      x += w;
    }
  }
  return { bars, totalWidth: x + quietZone, text };
}

/** Generates standalone inline SVG markup for a scannable Code-128B barcode (used in HTML print windows). */
export function barcode128SvgMarkup(value: string, height = 32): string {
  if (!value || !String(value).trim()) return "";
  const { bars, totalWidth, text } = encodeCode128B(String(value).trim());
  const h = Math.max(16, Math.round(height));
  const rects = bars.map((b) => `<rect x="${b.x}" y="0" width="${b.w}" height="${h}" />`).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${h}" width="${Math.min(260, Math.max(110, totalWidth))}" height="${h}" role="img" aria-label="Code 128 barcode ${escapeXml(text)}" style="display:inline-block;background:#fff;padding:2px 4px;border:1px solid #cbd5e1;border-radius:3px">` +
    `<g fill="#0f172a">${rects}</g>` +
    `</svg>`
  );
}

/** React component rendering a crisp SVG Code-128B barcode for UI screens and printable views. */
export function Barcode128({
  value,
  height = 30,
  className = "",
  showText = false,
}: {
  value: string | null | undefined;
  height?: number;
  className?: string;
  showText?: boolean;
}) {
  if (!value || !String(value).trim()) return null;
  const trimmed = String(value).trim();
  const { bars, totalWidth, text } = encodeCode128B(trimmed);
  const h = Math.max(16, Math.round(height));

  return React.createElement(
    "span",
    { className: `inline-flex flex-col items-center bg-white border border-slate-300 rounded px-1.5 py-1 ${className}`.trim() },
    React.createElement(
      "svg",
      {
        viewBox: `0 0 ${totalWidth} ${h}`,
        width: Math.min(240, Math.max(100, totalWidth)),
        height: h,
        role: "img",
        "aria-label": `Barcode ${text}`,
        className: "block",
      },
      React.createElement(
        "g",
        { fill: "#0f172a" },
        bars.map((b, idx) => React.createElement("rect", { key: idx, x: b.x, y: 0, width: b.w, height: h }))
      )
    ),
    showText
      ? React.createElement("span", { className: "font-mono text-[10px] leading-tight text-slate-800 tracking-wider mt-0.5" }, text)
      : null
  );
}
