import { describe, expect, it } from "vitest";
import {
  accessorySetsForProduct,
  findAccessorySet,
  isAccessorySetValidForProduct,
  isExtractionAccessoryProduct,
} from "../extractionAccessories";
import { hasKitSpec, kitSpecOf, parseKitSpecFromText, withPackagingNote } from "../packagingForm";

describe("Mã phụ kit tách chiết máy", () => {
  it("nhận biết mã chính và liệt kê đúng các mã phụ theo nhóm", () => {
    expect(isExtractionAccessoryProduct("HI-002")).toBe(true);
    expect(isExtractionAccessoryProduct("hm-001.a")).toBe(true);
    expect(isExtractionAccessoryProduct("SQ-100")).toBe(false);

    const hiA = accessorySetsForProduct("HI-002.A").map((s) => s.variant);
    expect(hiA).toEqual(["B", "T", "R", "B32", "T32", "R32"]);
    const hiB = accessorySetsForProduct("HI-612.NB").map((s) => s.variant);
    expect(hiB).toEqual(["KF", "B96", "T96", "KF6", "B6", "T48", "T6.2"]);
    // HI-002 (không hậu tố) dùng cả hai nhóm
    expect(accessorySetsForProduct("HI-002")).toHaveLength(13);
    // HM-001.A không dùng mã phụ của nhóm .B
    expect(accessorySetsForProduct("HM-001.A").some((s) => s.variant === "K96")).toBe(false);
  });

  it("bộ vật tư của mã phụ đúng bảng quy định, B6 của HI khác B6 của HM", () => {
    expect(findAccessorySet("HI.A:B")?.items.map((i) => i.code)).toEqual(["DPA", "TCBI32"]);
    expect(findAccessorySet("HI.B:KF")?.items.map((i) => i.code)).toEqual(["DPK", "SPKF", "TCKF96"]);
    expect(findAccessorySet("HI.B:B6")?.items.map((i) => i.code)).toEqual(["TSBIA", "TCBI96"]);
    expect(findAccessorySet("HM.A:B6")?.items.map((i) => i.code)).toEqual(["TSBIA", "TCBI32"]);
    expect(findAccessorySet("HM.B:K6")?.items.map((i) => i.code)).toEqual(["TSBIA", "TCKF96"]);
    expect(isAccessorySetValidForProduct("HI-002.A", "HI.A:B32")).toBe(true);
    expect(isAccessorySetValidForProduct("HI-002.A", "HI.B:KF")).toBe(false);
    expect(isAccessorySetValidForProduct("HM-007", "HM.B:B6")).toBe(true);
    expect(isAccessorySetValidForProduct("HM-007", "HM.A:B6")).toBe(true);
  });

  it("mã phụ đi theo thẻ ghi chú qua SO → PR → PO → Đơn nội bộ và đọc lại được", () => {
    const notes = withPackagingNote("Giao gấp", { accessorySet: "HI.A:B32" });
    expect(notes).toBe("[Mã phụ: HI.A:B32] Giao gấp");
    expect(parseKitSpecFromText(notes).accessorySet).toBe("HI.A:B32");
    expect(kitSpecOf({ notes }).accessorySet).toBe("HI.A:B32");
    expect(kitSpecOf({ accessorySet: "hm.b:k96" }).accessorySet).toBe("HM.B:K96");
    expect(hasKitSpec(kitSpecOf({ notes }))).toBe(true);
    // sửa mã phụ không nhân đôi thẻ, giữ ghi chú người dùng
    const again = withPackagingNote(notes, { accessorySet: "HI.A:T" });
    expect(again).toBe("[Mã phụ: HI.A:T] Giao gấp");
    // bỏ mã phụ thì bỏ thẻ
    expect(withPackagingNote(again, null)).toBe("Giao gấp");
  });

  it("kit PCR vẫn giữ nguyên thẻ [Dạng: ...] và có thể kèm mã phụ", () => {
    const n = withPackagingNote("", { packagingForm: "PREALIQUOT", icForm: "IC", tubeType: "T02" });
    expect(n).toBe("[Dạng: Chia sẵn · Sẵn IC · chia vào tube T02]");
    const n2 = withPackagingNote(n, { packagingForm: "PREALIQUOT", icForm: "IC", tubeType: "T02", accessorySet: "HI.A:B" });
    expect(n2).toBe("[Dạng: Chia sẵn · Sẵn IC · chia vào tube T02] [Mã phụ: HI.A:B]");
    const spec = kitSpecOf({ notes: n2 });
    expect(spec.packagingForm).toBe("PREALIQUOT");
    expect(spec.accessorySet).toBe("HI.A:B");
  });
});
