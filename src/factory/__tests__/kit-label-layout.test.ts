import { describe, expect, it } from "vitest";
import { buildDefaultLabelBundle, normalizeLabelBundle } from "@/frontend/factory/kit/KitLabelStudio";

describe("KitLabelStudio layout & legacy migration", () => {
  it("places middle label rows compactly without colliding with bottom ISO symbols or QR", () => {
    const bundle = buildDefaultLabelBundle(
      {
        storage: "Nhiệt độ phòng (15-25 °C)",
        tccsCode: "TCCS AEP-01:2026/ABT",
      },
      false,
      "Tách chiết DNA/RNA"
    );

    const pos = bundle.outer_box.positions_json;

    // Logo matches real /logo-abt.png landscape proportions (~1.89:1)
    expect(pos.logo.width_mm).toBeGreaterThanOrEqual(16);
    expect(pos.logo.height_mm).toBeGreaterThanOrEqual(8);

    // NSX & HSD sit side-by-side in the middle band instead of stretching vertically
    expect(pos.mfg_date.y).toBe(pos.exp_date.y);
    expect(pos.exp_date.x).toBeGreaterThan(pos.mfg_date.x + 25);

    // Middle text stays compact and ends well above bottom ISO symbols (>= 8mm below extra_text y)
    expect(pos.symbol_ivd.y - pos.extra_text.y).toBeGreaterThanOrEqual(8);
    expect(pos.symbol_temp.y - pos.extra_text.y).toBeGreaterThanOrEqual(8);

    // Right edge of middle band does not encroach on QR code
    expect(pos.qr_code.x).toBeGreaterThanOrEqual(79);

    // Manufacturer sits on bottom-left well clear of symbol_ivd
    expect(pos.symbol_ivd.x - pos.manufacturer.x).toBeGreaterThanOrEqual(45);
  });

  it("auto-upgrades legacy colliding outer_box and sub_box default positions while preserving custom layouts", () => {
    const legacySaved = {
      outer_box: {
        name: "Nhãn Hộp Ngoài Thành Phẩm (100×50mm)",
        width_mm: 100,
        height_mm: 50,
        font_size_pt: 8,
        qr_size_mm: 15,
        labels_per_row: 1,
        label_gap_mm: 2,
        vertical_gap_mm: 2,
        barcode_type: "QR_2D" as const,
        extra_text: "TCCS AEP-01:2026/ABT · ISO 13485:2016",
        display_fields: [
          "logo",
          "product_name",
          "product_code",
          "specification",
          "storage",
          "lot_number",
          "mfg_date",
          "exp_date",
          "manufacturer",
          "extra_text",
          "qr_code",
          "symbol_ivd",
          "symbol_temp",
        ],
        positions_json: {
          lot_number: { x: 3.5, y: 15 },
          mfg_date: { x: 3.5, y: 20 },
          exp_date: { x: 3.5, y: 25 },
          storage: { x: 3.5, y: 30 },
          extra_text: { x: 3.5, y: 35 },
          symbol_ivd: { x: 46, y: 36, size_mm: 6.5 },
        },
      },
      sub_box: {
        positions_json: {
          lot_number: { x: 3, y: 14.5 },
          exp_date: { x: 3, y: 19.5 },
          storage: { x: 3, y: 24.5 },
          symbol_ivd: { x: 46, y: 30, size_mm: 6 },
        },
      },
    };

    const migrated = normalizeLabelBundle(legacySaved, { tccsCode: "TCCS AEP-01:2026/ABT" }, false, "Tách chiết");
    expect(migrated.outer_box.positions_json.mfg_date.y).toBe(migrated.outer_box.positions_json.exp_date.y);
    expect(migrated.outer_box.positions_json.symbol_ivd.y - migrated.outer_box.positions_json.extra_text.y).toBeGreaterThanOrEqual(8);
    expect(migrated.sub_box.positions_json.symbol_ivd.x).toBeGreaterThanOrEqual(50);

    // Genuinely customized user layout must NOT be overwritten
    const customSaved = {
      outer_box: {
        positions_json: {
          lot_number: { x: 10, y: 18 },
          mfg_date: { x: 10, y: 23 },
          exp_date: { x: 10, y: 28 },
          storage: { x: 10, y: 33 },
          extra_text: { x: 10, y: 38 },
        },
      },
    };
    const keptCustom = normalizeLabelBundle(customSaved, {}, false, "PCR Kit");
    expect(keptCustom.outer_box.positions_json.lot_number).toEqual({ x: 10, y: 18 });
    expect(keptCustom.outer_box.positions_json.extra_text).toEqual({ x: 10, y: 38 });
  });
});
