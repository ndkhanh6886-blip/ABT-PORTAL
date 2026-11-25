import { describe, expect, it, vi } from "vitest";
import { askCascadeQuarantineReason } from "../qa/cascadeQuarantinePrompt";

describe("askCascadeQuarantineReason", () => {
  it("bấm Hủy thì không phong tỏa, không cảnh báo", () => {
    const warn = vi.fn();
    expect(askCascadeQuarantineReason("ST008-123456", () => null, warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("lý do quá ngắn thì không phong tỏa và báo cho người dùng", () => {
    const warn = vi.fn();
    expect(askCascadeQuarantineReason("ST008-123456", () => "  ok ", warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("nêu rõ hậu quả trong câu hỏi và trả lại lý do đã nhập", () => {
    const ask = vi.fn(() => "  Nghi ngờ pH lệch khi pha  ");
    expect(askCascadeQuarantineReason("ST008-123456", ask, vi.fn())).toBe("Nghi ngờ pH lệch khi pha");
    const msg = String((ask.mock.calls[0] as unknown[])[0]);
    expect(msg).toContain("ST008-123456");
    expect(msg).toContain("NCR");
    expect(msg).toContain("Truy xuất ngay");
  });
});
