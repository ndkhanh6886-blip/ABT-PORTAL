/**
 * Shows a print document (built from data such as customer / product names) in a new window
 * without letting it run scripts.
 *
 * The old code wrote the HTML straight into a same-origin popup: a customer name containing
 * <script> would have run with the employee's portal session. Here the popup only holds a small
 * toolbar written by us, and the document itself is rendered in an iframe sandboxed WITHOUT
 * `allow-scripts` (scripts inside it, including injected ones, never run).
 *
 * Toolbar: print, portrait / landscape page, close (also Esc).
 */
export function writeSafePrintDocument(
  win: Window,
  html: string,
  opts: { autoPrint?: boolean; title?: string; orientation?: "portrait" | "landscape" } = {}
) {
  const autoPrint = opts.autoPrint !== false;
  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>In tài liệu</title>
<style>
  html, body { margin: 0; height: 100%; background: #e2e8f0; }
  .bar { position: fixed; top: 10px; right: 14px; z-index: 10; display: flex; gap: 8px; }
  .bar button { font: 600 13px system-ui, sans-serif; padding: 8px 14px; border-radius: 10px; border: 0; cursor: pointer; background: #0284c7; color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
  .bar button.secondary { background: #fff; color: #334155; }
  iframe { border: 0; width: 100%; height: 100%; background: #fff; display: block; }
  @media print { .bar { display: none; } }
</style></head><body><div class="bar">
  <button id="tbr-orient-btn" class="secondary" type="button" title="Đổi khổ giấy dọc / ngang"></button>
  <button id="tbr-print-btn" type="button">🖨 In tài liệu</button>
  <button id="tbr-close-btn" class="secondary" type="button" title="Đóng (Esc)">✕ Đóng</button>
</div></body></html>`);
  doc.close();
  if (opts.title) doc.title = opts.title;

  const frame = doc.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.setAttribute("title", "Tài liệu in");
  frame.srcdoc = html;
  doc.body.appendChild(frame);

  let orientation: "portrait" | "landscape" = opts.orientation || "portrait";
  const orientBtn = doc.getElementById("tbr-orient-btn");
  const applyOrientation = () => {
    if (orientBtn) orientBtn.textContent = orientation === "portrait" ? "📄 Khổ dọc" : "📄 Khổ ngang";
    try {
      const fd = frame.contentDocument;
      if (!fd || !fd.head) return;
      let st = fd.getElementById("tbr-orientation") as HTMLStyleElement | null;
      if (!st) {
        st = fd.createElement("style");
        st.id = "tbr-orientation";
        fd.head.appendChild(st);
      }
      // last @page rule wins over the size declared by the document itself
      st.textContent = `@page { size: A4 ${orientation}; }`;
    } catch {}
  };
  applyOrientation();
  if (orientBtn) orientBtn.addEventListener("click", () => {
    orientation = orientation === "portrait" ? "landscape" : "portrait";
    applyOrientation();
  });

  const printFrame = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      win.print();
    }
  };
  const btn = doc.getElementById("tbr-print-btn");
  if (btn) btn.addEventListener("click", printFrame);
  const closeBtn = doc.getElementById("tbr-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => win.close());
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") win.close(); };
  doc.addEventListener("keydown", onKey);
  frame.addEventListener("load", () => {
    try {
      const innerTitle = frame.contentDocument?.title;
      if (innerTitle && !opts.title) doc.title = innerTitle;
      frame.contentDocument?.addEventListener("keydown", onKey);
    } catch {}
    applyOrientation();
    if (autoPrint) setTimeout(printFrame, 400);
  });
  win.focus();
}
