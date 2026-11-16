import { describe, expect, it } from "vitest";
import { employeeCodeVariants, normalizePersonText, personNameKey } from "@/backend/services/utils";
import { dedupePersonnel, normalizeUserName } from "../EnterpriseChatModule";

describe("personnel normalization & chat deduplication", () => {
  it("normalizes NFC, strips zero-width chars, and collapses NBSP/extra whitespace", () => {
    const nfd = "L\u0061\u0302m   Duy\u00A0Anh";
    const zeroWidth = "Lâm\u200B Duy\uFEFF Anh";
    expect(normalizePersonText(nfd)).toBe("Lâm Duy Anh");
    expect(normalizePersonText(zeroWidth)).toBe("Lâm Duy Anh");
    expect(normalizeUserName(nfd)).toBe("Lâm Duy Anh");
    expect(personNameKey(nfd)).toBe(personNameKey("lâm duy anh"));
    // Tone placement equivalence (òa vs oà)
    expect(personNameKey("Nguyễn Hòa Bình")).toBe(personNameKey("Nguyễn Hoà Bình"));
  });

  it("collapses 3+ duplicate colleagues (NFC/NFD/case/whitespace) into a single chat entry and keeps online status", () => {
    const list = [
      { id: 1, username: "NV-ABT-050", employee_code: "NV-ABT-050", full_name: "La\u0302m Duy Anh", department: "R&D", presence_status: "offline" },
      { id: 2, username: "NV-TBR-050", employee_code: "NV-TBR-050", full_name: "Lâm\u00A0  Duy Anh", department: "R&D", presence_status: "online" },
      { id: 3, username: "duyanh", employee_code: "NV-ABT-TMP-1", full_name: "lâm duy\u200B anh", department: "R&D", presence_status: "away" },
      { id: 4, username: "NV-ABT-010", employee_code: "NV-ABT-010", full_name: "Nguyễn Văn Hiếu", department: "Kinh Doanh", presence_status: "online" },
    ];
    const deduped = dedupePersonnel(list);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].full_name).toBe("Lâm Duy Anh");
    expect(deduped[0].presence_status).toBe("online");
    expect(deduped[1].full_name).toBe("Nguyễn Văn Hiếu");
  });

  it("generates all employee code and username alias variants across ABT/TBR/TBRS/VIA", () => {
    expect(employeeCodeVariants("NV-ABT-016")).toEqual(
      expect.arrayContaining(["nv-abt-016", "abt016", "abt-016", "nv-abt016"])
    );
    expect(employeeCodeVariants("TBR042")).toEqual(
      expect.arrayContaining(["tbr042", "tbr-042", "nv-tbr-042", "nv-tbr042"])
    );
    expect(employeeCodeVariants("nv-via-007")).toEqual(
      expect.arrayContaining(["nv-via-007", "via007", "via-007"])
    );
  });
});
