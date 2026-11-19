import { describe, expect, it } from "vitest";
import { describeUserAgent } from "../userAgent";

describe("describeUserAgent", () => {
  it("names common desktop browsers and the OS", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")).toBe("Chrome 131 · Windows");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.80")).toBe("Edge 130 · Windows");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) coc_coc_browser/128.0.226 Chrome/122.0.0.0 Safari/537.36")).toBe("Cốc Cốc 128 · Windows");
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15")).toBe("Safari 18 · macOS");
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Firefox 132 · Linux");
  });

  it("names phones and the Zalo in-app browser", () => {
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1")).toBe("Safari 18 · iPhone (iOS 18)");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Zalo android/12100536 ZaloTheme/light")).toBe("Zalo · Android 14");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1")).toBe("Chrome 131 · iPhone (iOS 17)");
  });

  it("flags scripts and empty headers", () => {
    expect(describeUserAgent("curl/8.5.0")).toBe("Công cụ tự động (curl/8.5.0)");
    expect(describeUserAgent("python-requests/2.32.3")).toBe("Công cụ tự động (python-requests/2.32.3)");
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36")).toMatch(/^Công cụ tự động/);
    expect(describeUserAgent("")).toBe("Không rõ thiết bị");
    expect(describeUserAgent(null)).toBe("Không rõ thiết bị");
  });
});
