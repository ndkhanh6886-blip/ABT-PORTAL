/**
 * Short, readable description of the device behind a User-Agent header for the audit log, e.g.
 * "Chrome 131 · Windows", "Zalo · Android", "Safari 18 · iPhone (iOS 18)", "Công cụ tự động (curl/8.5.0)".
 * Lets an administrator tell sign-ins from different browsers / machines apart, and spot scripts.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  const s = String(ua || "").trim();
  if (!s) return "Không rõ thiết bị";

  // Not a browser: command-line tools, HTTP libraries, bots
  const tool = s.match(/^(curl|wget|python-requests|python-urllib|axios|node-fetch|undici|okhttp|Go-http-client|PostmanRuntime|insomnia|Java|libwww-perl|HTTPie)[/ ]?([\w.-]*)/i);
  if (tool) return `Công cụ tự động (${tool[1]}${tool[2] ? "/" + tool[2] : ""})`;
  if (/bot|crawler|spider|headless/i.test(s)) return `Công cụ tự động (${s.slice(0, 40)})`;

  const ver = (re: RegExp) => (s.match(re) || [])[1]?.split(".")[0] || "";

  let browser = "";
  if (/Zalo/i.test(s)) browser = "Zalo";
  else if (/coc_coc_browser|CocCoc/i.test(s)) browser = `Cốc Cốc ${ver(/coc_coc_browser\/([\d.]+)/i)}`.trim();
  else if (/Edg(e|A|iOS)?\//.test(s)) browser = `Edge ${ver(/Edg(?:e|A|iOS)?\/([\d.]+)/)}`.trim();
  else if (/OPR\/|Opera/.test(s)) browser = `Opera ${ver(/OPR\/([\d.]+)/)}`.trim();
  else if (/SamsungBrowser\//.test(s)) browser = `Samsung Internet ${ver(/SamsungBrowser\/([\d.]+)/)}`.trim();
  else if (/Firefox\/|FxiOS\//.test(s)) browser = `Firefox ${ver(/(?:Firefox|FxiOS)\/([\d.]+)/)}`.trim();
  else if (/CriOS\//.test(s)) browser = `Chrome ${ver(/CriOS\/([\d.]+)/)}`.trim();
  else if (/Chrome\//.test(s)) browser = `Chrome ${ver(/Chrome\/([\d.]+)/)}`.trim();
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = `Safari ${ver(/Version\/([\d.]+)/)}`.trim();
  else browser = "Trình duyệt khác";

  let os = "";
  if (/iPhone/.test(s)) os = `iPhone${ver(/OS (\d+)[_\d]* like Mac/) ? ` (iOS ${ver(/OS (\d+)[_\d]* like Mac/)})` : ""}`;
  else if (/iPad/.test(s)) os = `iPad${ver(/OS (\d+)[_\d]* like Mac/) ? ` (iPadOS ${ver(/OS (\d+)[_\d]* like Mac/)})` : ""}`;
  else if (/Android/.test(s)) os = `Android${ver(/Android ([\d.]+)/) ? " " + ver(/Android ([\d.]+)/) : ""}`;
  else if (/Windows NT/.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux/.test(s)) os = "Linux";
  else os = "HĐH khác";

  return `${browser} · ${os}`;
}
