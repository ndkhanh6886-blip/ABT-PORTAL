-- 0045_tech_transfer_dossier_and_templates.sql
-- Upgrade Technology Transfer Packages (ISO 13485 §7.3.8 Design Transfer):
-- Customizable dossier templates, per-package dossier checklist items,
-- multi-file attachments, QC release criteria & process/cold-chain metadata.

INSERT INTO core.sequence_definition (sequence_key, name, pattern)
VALUES ('RD_TRANSFER_TEMPLATE', 'Mẫu hồ sơ chuyển giao công nghệ', 'TTT-{NNN}')
ON CONFLICT (sequence_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS rd.transfer_template (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  domain      text NOT NULL CHECK (domain IN ('KIT', 'OLIGO', 'DEVICE', 'SOFTWARE', 'OTHER')),
  description text,
  is_default  boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version     integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  integer,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  integer
);

CREATE TABLE IF NOT EXISTS rd.transfer_template_item (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  template_id  uuid NOT NULL REFERENCES rd.transfer_template(id) ON DELETE CASCADE,
  seq          integer NOT NULL CHECK (seq > 0),
  section_code text NOT NULL,
  section_name text NOT NULL,
  doc_code     text NOT NULL,
  item_name    text NOT NULL,
  guidance     text,
  is_required  boolean NOT NULL DEFAULT true,
  UNIQUE (template_id, seq)
);

ALTER TABLE rd.tech_transfer_package
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES rd.transfer_template(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qc_release_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS transfer_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS rd.tech_transfer_item (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  package_id       uuid NOT NULL REFERENCES rd.tech_transfer_package(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES rd.transfer_template_item(id) ON DELETE SET NULL,
  seq              integer NOT NULL CHECK (seq > 0),
  section_code     text NOT NULL DEFAULT 'GENERAL',
  section_name     text NOT NULL DEFAULT 'Hồ sơ chuyển giao',
  doc_code         text NOT NULL DEFAULT 'DOC',
  item_name        text NOT NULL,
  guidance         text,
  is_required      boolean NOT NULL DEFAULT true,
  doc_ref_code     text,
  notes            text,
  status           text NOT NULL DEFAULT 'MISSING' CHECK (status IN ('MISSING', 'SUBMITTED', 'VERIFIED', 'WAIVED')),
  verified_by      integer REFERENCES core.user_profile(user_id),
  verified_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       integer
);
CREATE INDEX IF NOT EXISTS idx_rd_tt_item_pkg ON rd.tech_transfer_item (package_id, seq);

CREATE TABLE IF NOT EXISTS rd.tech_transfer_file (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  package_id    uuid NOT NULL REFERENCES rd.tech_transfer_package(id) ON DELETE CASCADE,
  item_id       uuid REFERENCES rd.tech_transfer_item(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES core.attachment(id),
  doc_label     text,
  uploaded_by   integer REFERENCES core.user_profile(user_id),
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rd_tt_file_pkg ON rd.tech_transfer_file (package_id, item_id);

-- Seed 3 standard industry templates
INSERT INTO rd.transfer_template (code, name, domain, description, is_default, status, created_by, updated_by)
VALUES
  (
    'TT-IVD-PCR-STD',
    'Bộ Hồ sơ Chuẩn Chuyển giao Kit Chẩn đoán Phân tử (PCR / Tách chiết IVD — ISO 13485)',
    'KIT',
    'Bộ hồ sơ 8 phần (15 hạng mục) chuẩn chuyển giao thiết kế & sản xuất Kit chẩn đoán phân tử IVD theo ISO 13485 §7.3.8, CLSI và EN ISO 23640.',
    true,
    'ACTIVE',
    1,
    1
  ),
  (
    'TT-OLIGO-STD',
    'Bộ Hồ sơ Chuẩn Chuyển giao Quy trình Tổng hợp Oligo & Probe',
    'OLIGO',
    'Bộ hồ sơ 6 hạng mục chuyển giao quy trình tổng hợp, tinh sạch HPLC/PAGE, kiểm nghiệm OD260/LC-MS và chia liều Oligonucleotide.',
    true,
    'ACTIVE',
    1,
    1
  ),
  (
    'TT-DEVICE-STD',
    'Bộ Hồ sơ Chuẩn Chuyển giao Thiết bị & Phần mềm Y sinh (DMR / DHR / IEC 62304)',
    'DEVICE',
    'Bộ hồ sơ 6 hạng mục chuyển giao hồ sơ thiết kế gốc DMR, bản vẽ CAD/PCB, BOM 4 trạm, Firmware/SaMD, FQC an toàn điện-nhiệt và đào tạo FSE.',
    true,
    'ACTIVE',
    1,
    1
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO rd.transfer_template_item (template_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required)
SELECT t.id, v.seq, v.section_code, v.section_name, v.doc_code, v.item_name, v.guidance, v.is_required
FROM rd.transfer_template t
JOIN (
  VALUES
    (1, '1_PRODUCT_TPP', '1. Định danh Sản phẩm, TPP & Quản lý Rủi ro', 'TPP_FINAL', 'Hồ sơ Đặc tính Mục tiêu Sản phẩm chốt cuối (Final TPP & Intended Use)', 'Mục đích sử dụng, nền mẫu bệnh phẩm, hệ máy Real-time PCR tương thích, kênh huỳnh quang (FAM/HEX/ROX/Cy5), quy cách đóng gói (Thường, Chia sẵn .D.IC, Kit Demo)', true),
    (2, '1_PRODUCT_TPP', '1. Định danh Sản phẩm, TPP & Quản lý Rủi ro', 'RISK_PFMEA', 'Báo cáo Quản lý Rủi ro Thiết kế & Quy trình Sản xuất (ISO 14971 & Process FMEA)', 'Phân tích mối nguy sai lệch pha chế, nhiễm chéo amplicon/RNase, mất hoạt tính enzyme và các điểm kiểm soát tới hạn (CCP)', true),
    (3, '2_BOM_RAW_MAT', '2. Công thức Gốc, Định mức BOM & Tiêu chuẩn Nguyên vật liệu', 'MASTER_FORMULATION', 'Công thức Pha chế Gốc & Bảng tính Nồng độ Cuối (Master Formulation Sheet)', 'Nồng độ gốc & nồng độ cuối của Enzyme Polymerase/RT, dNTPs/dUTP-UNG, Đệm phản ứng, Mg2+, chất ổn định đông khô/lạnh sâu và dung sai pha chế cho phép', true),
    (4, '2_BOM_RAW_MAT', '2. Công thức Gốc, Định mức BOM & Tiêu chuẩn Nguyên vật liệu', 'OLIGO_PRIMER_PROBE_SPEC', 'Hồ sơ Trình tự Mồi / Mẫu dò / Chứng nội (Oligo & IC Specification)', 'Mã trình tự Primer/Probe, biến đổi đầu 5''/3'' (Reporter/Quencher), phương pháp tinh sạch bắt buộc (HPLC/PAGE), hàm lượng OD/nmol và tiêu chuẩn nhận lô Oligo đầu vào', true),
    (5, '2_BOM_RAW_MAT', '2. Công thức Gốc, Định mức BOM & Tiêu chuẩn Nguyên vật liệu', 'BOM_ASL_IQC_SPEC', 'Định mức BOM Đa cấp (Thường / Chia sẵn .D.IC / Demo) & Danh mục NCC được duyệt (ASL + IQC NVL)', 'Định mức chi tiết từng hộp/ống, tỷ lệ hao hụt chiết rót, vật tư tiêu hao quang học cấp kèm và tiêu chuẩn kiểm nghiệm IQC nguyên vật liệu đầu vào', true),
    (6, '3_PROCESS_BMR', '3. Quy trình Công nghệ, SOP Sản xuất & Hồ sơ Lô Gốc (DMR/BMR)', 'MASTER_BMR_SOP', 'Quy trình Sản xuất Gốc & Hồ sơ Lô Điện tử Mẫu (Master BMR / SOP Pha chế – Chia liều)', 'Phân luồng phòng sạch 1 chiều (Pre-PCR / Mastermix / Positive Control), điều kiện nhiệt độ-độ ẩm, trình tự phối trộn, tốc độ khuấy/ly tâm, thể tích chiết rót & quy trình khử nhiễm UV/hóa chất', true),
    (7, '3_PROCESS_BMR', '3. Quy trình Công nghệ, SOP Sản xuất & Hồ sơ Lô Gốc (DMR/BMR)', 'EQUIP_CLEANROOM_QUAL', 'Danh mục Thiết bị Sản xuất, Hiệu chuẩn & Điều kiện Phòng sạch / ATSH', 'Danh mục tủ ATSH/PCR Cabinet, máy chia liều tự động, pipette chuẩn, tủ âm sâu và yêu cầu thẩm định IQ/OQ/PQ thiết bị', true),
    (8, '4_QC_RELEASE', '4. Tiêu chuẩn Kiểm nghiệm QA/QC & Bộ Mẫu chuẩn Tham chiếu', 'QC_RELEASE_TCCS', 'Tiêu chuẩn Cơ sở (TCCS) & Quy trình Kiểm nghiệm Bán thành phẩm / Thành phẩm (IPQC / FQC & Mẫu COA)', 'Ngưỡng Ct chứng dương (PC), Ct chứng nội (IC), chứng âm (NTC) không khuếch đại, độ đồng đều thể tích, pH, ngoại quan và biểu mẫu COA xuất xưởng', true),
    (9, '4_QC_RELEASE', '4. Tiêu chuẩn Kiểm nghiệm QA/QC & Bộ Mẫu chuẩn Tham chiếu', 'QC_REF_PANEL_HANDOVER', 'Biên bản Bàn giao Bộ Mẫu chuẩn Tham chiếu QC (Reference Panel / Working Standard)', 'Bàn giao mẫu chuẩn định lượng/định tính đã chuẩn độ, sơ đồ pha loãng bậc 10, điều kiện bảo quản -80°C/-20°C và quy trình tái chuẩn định kỳ cho phòng QA/QC', true),
    (10, '5_ANALYTICAL_CLINICAL', '5. Báo cáo Thẩm định Hiệu năng Phân tích & Lâm sàng', 'ANALYTICAL_VAL_REPORT', 'Báo cáo Thẩm định Hiệu năng Phân tích (LoB/LoD95%, Độ lặp lại, Độ tuyến tính, Độ đặc hiệu & Nhiễu)', 'Hồ sơ thực nghiệm theo CLSI EP17/EP05/EP07: giới hạn phát hiện LoD 95% (Probit), CV% nội lô & liên lô, hiệu suất khuếch đại R2, phản ứng chéo và chất gây nhiễu nội/ngoại sinh', true),
    (11, '5_ANALYTICAL_CLINICAL', '5. Báo cáo Thẩm định Hiệu năng Phân tích & Lâm sàng', 'CLINICAL_EVAL_REPORT', 'Báo cáo Đánh giá Hiệu năng Lâm sàng / So sánh Phương pháp Tham chiếu', 'Kết quả đánh giá độ nhạy lâm sàng (PPA), độ đặc hiệu lâm sàng (NPA), chỉ số Kappa trên tập mẫu thực tế và biên bản nghiệm thu hội đồng khoa học', true),
    (12, '6_STABILITY_COLDCHAIN', '6. Nghiên cứu Độ ổn định & Chuỗi lạnh Bảo quản – Vận chuyển', 'STABILITY_ISO23640', 'Hồ sơ Nghiên cứu Độ ổn định & Mô phỏng Vận chuyển Chuỗi lạnh (EN ISO 23640 / CLSI EP25)', 'Kết quả độ ổn định tăng tốc, đề cương & dữ liệu độ ổn định thời gian thực (Real-time), độ ổn định sau mở nắp (In-use), số chu kỳ rã đông tối đa (Freeze-Thaw) và thẩm định đóng gói đá khô/gel lạnh', true),
    (13, '7_LABEL_IFU', '7. Nhãn, Bao bì, UDI & Bộ 4 Tài liệu Hướng dẫn Sử dụng (IFU)', 'ARTWORK_LABEL_UDI', 'Thiết kế Artwork Nhãn Hộp ngoài, Nhãn Ống thành phần & Mã định danh UDI/GS1', 'File thiết kế nhãn chuẩn ISO 18113 / Nghị định 98, quy cách dán nhãn từng ống màu nắp, sơ đồ đóng hộp và mã vạch UDI', true),
    (14, '7_LABEL_IFU', '7. Nhãn, Bao bì, UDI & Bộ 4 Tài liệu Hướng dẫn Sử dụng (IFU)', 'IFU_MSDS_PACKAGE', 'Bộ Tài liệu Hướng dẫn Sử dụng (4 Phiên bản IFU Kit PCR) & Phiếu An toàn Hóa chất (MSDS/SDS)', 'Đính kèm đủ các bản HDSD áp dụng: (1) Không chia sẵn – Không IC, (2) Không chia sẵn – Sẵn IC, (3) Chia sẵn – Không IC, (4) Chia sẵn – Sẵn IC, kèm phiếu SDS thành phần nguy hại', true),
    (15, '8_TRAINING_PILOT', '8. Đào tạo Chuyển giao & Thẩm định 03 Lô Pilot (PQ)', 'TRAINING_PILOT_PQ', 'Biên bản Đào tạo Chuyển giao Nhân sự SX/QC & Đề cương / Báo cáo 03 Lô Pilot (Process Validation)', 'Danh sách nhân sự Sản xuất & QC đạt sát hạch thực hành và đề cương/kết quả thẩm định độ đồng nhất 03 lô Pilot liên tiếp tại xưởng', false)
) AS v(seq, section_code, section_name, doc_code, item_name, guidance, is_required)
ON t.code = 'TT-IVD-PCR-STD'
ON CONFLICT (template_id, seq) DO NOTHING;

INSERT INTO rd.transfer_template_item (template_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required)
SELECT t.id, v.seq, v.section_code, v.section_name, v.doc_code, v.item_name, v.guidance, v.is_required
FROM rd.transfer_template t
JOIN (
  VALUES
    (1, '1_SYNTHESIS', '1. Thông số Tổng hợp Oligo', 'OLIGO_SYNTH_PARAM', 'Thông số Chu trình Máy Tổng hợp & Hạt CPG / Amidite', 'Thang tổng hợp (nmol/µmol), trình tự 5''→3'', biến đổi dye/quencher, mã Amidite & cột CPG tương thích', true),
    (2, '2_CLEAVAGE', '2. Cắt mạch & Khử bảo vệ', 'OLIGO_CLEAVE_DEPROT', 'Quy trình Cắt khỏi cột & Khử nhóm bảo vệ (Cleavage & Deprotection)', 'Nồng độ NH4OH/AMA, nhiệt độ & thời gian ủ, điều kiện trung hòa và cô đặc chân không', true),
    (3, '3_PURIFICATION', '3. Tinh sạch HPLC / PAGE / Desalt', 'OLIGO_PURIF_SOP', 'Quy trình Tinh sạch RP-HPLC / PAGE / Cột Desalt', 'Hệ dung môi pha động, cột C18, bước sóng phát hiện 260nm/fluorescein và ngưỡng thu phân đoạn', true),
    (4, '4_QC_SPEC', '4. Kiểm nghiệm QC & COA', 'OLIGO_QC_MS_OD', 'Tiêu chuẩn Kiểm nghiệm Độ tinh khiết, OD260, Khối phổ LC-MS & Mẫu COA', 'Sai số khối lượng phân tử (±0.1% MW), % độ tinh khiết HPLC tối thiểu, định lượng OD/nmol và mẫu COA', true),
    (5, '5_FORMULATION', '5. Đông khô & Chia liều', 'OLIGO_LYO_DISPENSE', 'Quy trình Chia ống, Đông khô & Đóng gói Tem nhãn Oligo', 'Thể tích hoàn nguyên, thông số đông khô, quy cách tem mã vạch từng ống và điều kiện bảo quản -20°C', true),
    (6, '6_PILOT_TRAIN', '6. Đào tạo & Mẻ Pilot', 'OLIGO_PILOT_TRAIN', 'Biên bản Đào tạo Vận hành & Kết quả 03 Mẻ Pilot Oligo', 'Hồ sơ đối chiếu kết quả thực nghiệm R&D vs Xưởng Oligo (hiệu suất coupling, tỷ lệ thu hồi, Ct chức năng)', false)
) AS v(seq, section_code, section_name, doc_code, item_name, guidance, is_required)
ON t.code = 'TT-OLIGO-STD'
ON CONFLICT (template_id, seq) DO NOTHING;

INSERT INTO rd.transfer_template_item (template_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required)
SELECT t.id, v.seq, v.section_code, v.section_name, v.doc_code, v.item_name, v.guidance, v.is_required
FROM rd.transfer_template t
JOIN (
  VALUES
    (1, '1_DMR_CAD', '1. Hồ sơ Thiết kế Gốc DMR & CAD/PCB', 'DEV_DMR_CAD_PCB', 'Bản vẽ Cơ khí 2D/3D (STEP/DXF), Sơ đồ Mạch PCB (Gerber/Schematic)', 'Bộ bản vẽ phát hành kèm dung sai kích thước IQC chi tiết gia công và danh mục vật liệu vỏ máy/linh kiện', true),
    (2, '2_STATION_BOM', '2. BOM 4 Trạm & Nhà cung cấp Gia công', 'DEV_STATION_BOM_ASL', 'Cấu trúc BOM 4 Trạm Lắp ráp (BUY / SUBCONTRACT) & Danh mục NCC Gia công', 'Định mức chi tiết theo từng trạm Cơ khí – Điện tử – Firmware – Hoàn thiện, mã bản vẽ và tiêu chí đánh giá NCC', true),
    (3, '3_SW_FIRMWARE', '3. Gói Phần mềm / Firmware IEC 62304', 'DEV_FW_SW_CHECKSUM', 'Bản phát hành Firmware / Phần mềm, Mã nguồn Commit & Checksum SHA-256', 'Gói nhị phân chính thức, ma trận truy xuất SRS, danh sách SOUP và quy trình nạp firmware trên dây chuyền', true),
    (4, '4_ASSEMBLY_BURNIN', '4. SOP Lắp ráp, Hiệu chuẩn & Burn-in 48h', 'DEV_ASSY_BURNIN_SOP', 'Quy trình Lắp ráp 4 Trạm, Hiệu chuẩn Quang/Nhiệt & Chạy Lão hóa (Burn-in)', 'Bảng kiểm thông số nhiệt độ khối Block/quang học, kịch bản kiểm tra độ trôi và tiêu chí đạt sau Burn-in', true),
    (5, '5_FQC_DHR', '5. Quy trình FQC & Biểu mẫu DHR', 'DEV_FQC_DHR_TEMPLATE', 'Tiêu chuẩn Kiểm tra Xuất xưởng FQC (An toàn điện / Hiệu năng) & Biểu mẫu DHR', 'Bảng kiểm FQC từng số Serial, kiểm tra cách điện/rò dòng và biểu mẫu Hồ sơ Lịch sử Thiết bị (DHR)', true),
    (6, '6_IFU_FSE', '6. HDSD, Bảo trì & Đào tạo FSE', 'DEV_IFU_FSE_TRAIN', 'Tài liệu HDSD Thiết bị, Sổ tay Bảo trì Dự phòng & Đào tạo Kỹ sư FSE/Xưởng', 'Hướng dẫn lắp đặt IQ/OQ tại bệnh viện, bảng mã lỗi troubleshooting và biên bản chuyển giao cho Xưởng/FSE', false)
) AS v(seq, section_code, section_name, doc_code, item_name, guidance, is_required)
ON t.code = 'TT-DEVICE-STD'
ON CONFLICT (template_id, seq) DO NOTHING;

-- Backfill existing tech transfer packages so they inherit the matching standard dossier checklist
UPDATE rd.tech_transfer_package tt
   SET template_id = t.id
  FROM rd.transfer_template t
 WHERE tt.template_id IS NULL
   AND t.code = CASE
     WHEN tt.target_domain = 'OLIGO' THEN 'TT-OLIGO-STD'
     WHEN tt.target_domain IN ('DEVICE', 'SOFTWARE') THEN 'TT-DEVICE-STD'
     ELSE 'TT-IVD-PCR-STD'
   END;

INSERT INTO rd.tech_transfer_item (
  package_id, template_item_id, seq, section_code, section_name, doc_code, item_name, guidance, is_required, status
)
SELECT
  tt.id,
  ti.id,
  ti.seq,
  ti.section_code,
  ti.section_name,
  ti.doc_code,
  ti.item_name,
  ti.guidance,
  ti.is_required,
  CASE
    WHEN tt.status IN ('ACCEPTED', 'COMPLETED') THEN 'VERIFIED'
    WHEN tt.status = 'SUBMITTED' THEN 'SUBMITTED'
    ELSE 'MISSING'
  END
FROM rd.tech_transfer_package tt
JOIN rd.transfer_template_item ti ON ti.template_id = tt.template_id
WHERE NOT EXISTS (SELECT 1 FROM rd.tech_transfer_item x WHERE x.package_id = tt.id);
