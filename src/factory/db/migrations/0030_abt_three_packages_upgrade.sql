-- Phase 6: ABT Biolab Portal 3-Package Business Logic & Operational Upgrade
-- Package 1: Kit Production (molecularkit-mes): Smart 3-mode BOM Explosion (Standard, Aliquoted .D.IC, Demo Kit),
--            QC Retention flags, BOM Line Substitutes, Lot Splitting, EBR pH auto-extraction & Bilingual COA.
-- Package 2: Oligo Synthesis (oligoflow_portal, Column-only): Customer Modification Aliases, Mid-sequence 5'/3' cleanup,
--            Billing Scale vs Synthesis Scale, Multi-tube formulation (tubes_detail) & Batch-linked MFG Date.
-- Package 3: Device Engineering (rd-innovation-hub/tech): Equipment Specs & Standard/Optional Accessories,
--            Station BOM with BUY/SUBCONTRACT & LOT/BULK tracking + CAD Drawing code, Mechanical IQC Instrument/Dimension check,
--            Order-level BOM Kitting Slip & Handover Checklist.

-- ============================================================================
-- 0. MASTER UOM NORMALIZATION (Ensure uppercase/standard aliases exist)
-- ============================================================================
INSERT INTO master.uom (code, name, dimension) VALUES
  ('EA',   'Cái (Each)',     'COUNT'),
  ('KIT',  'Bộ Kit',         'COUNT'),
  ('TEST', 'Phản ứng (Test)','COUNT')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 1. PACKAGE 1: KIT PRODUCTION (molecularkit-mes UPGRADE)
-- ============================================================================
ALTER TABLE kit.bom_line
  ADD COLUMN IF NOT EXISTS qty_per_base_aliquoted numeric(18,6) CHECK (qty_per_base_aliquoted IS NULL OR qty_per_base_aliquoted > 0),
  ADD COLUMN IF NOT EXISTS is_mix_component boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_demo_fixed_component boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_in_qc_retention boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bundle_parent_code text;

CREATE TABLE IF NOT EXISTS kit.bom_line_substitute (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  bom_line_id        uuid NOT NULL REFERENCES kit.bom_line (id) ON DELETE CASCADE,
  substitute_item_id uuid NOT NULL REFERENCES master.item (id),
  priority           integer NOT NULL DEFAULT 1 CHECK (priority > 0),
  conversion_factor  numeric(18,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0),
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         integer,
  UNIQUE (bom_line_id, substitute_item_id)
);
CREATE INDEX IF NOT EXISTS idx_kit_bom_sub_line ON kit.bom_line_substitute (bom_line_id, priority);

ALTER TABLE kit.production_order
  ADD COLUMN IF NOT EXISTS order_mode text NOT NULL DEFAULT 'STANDARD'
    CHECK (order_mode IN ('STANDARD', 'ALIQUOTED', 'DEMO')),
  ADD COLUMN IF NOT EXISTS is_aliquoted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_specification text,
  ADD COLUMN IF NOT EXISTS qc_retention_qty numeric(18,6) NOT NULL DEFAULT 0 CHECK (qc_retention_qty >= 0),
  ADD COLUMN IF NOT EXISTS no_retention boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_ph numeric(5,2);

CREATE TABLE IF NOT EXISTS kit.lot_split (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  production_order_id uuid NOT NULL REFERENCES kit.production_order (id) ON DELETE CASCADE,
  source_lot_id       uuid NOT NULL REFERENCES inv.lot (id),
  child_lot_id        uuid NOT NULL REFERENCES inv.lot (id),
  qty                 numeric(18,6) NOT NULL CHECK (qty > 0),
  uom                 text NOT NULL,
  reason              text,
  created_by          integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kit_lot_split_order ON kit.lot_split (production_order_id);

-- ============================================================================
-- 2. PACKAGE 2: OLIGO SYNTHESIS (oligoflow_portal COLUMN-ONLY UPGRADE)
-- ============================================================================
INSERT INTO oligo.scale (code, label, synth_nmol, od_min, od_max, sort_order) VALUES
  ('25NMOL', '25 nmol', 25, NULL, NULL, 5),
  ('50NMOL', '50 nmol', 50, NULL, NULL, 8)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE oligo.oligo_sequence
  ADD COLUMN IF NOT EXISTS synthesis_scale_code text REFERENCES oligo.scale (code);

ALTER TABLE oligo.post_process
  ADD COLUMN IF NOT EXISTS synthesis_scale_code text REFERENCES oligo.scale (code),
  ADD COLUMN IF NOT EXISTS tubes_detail jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mfg_date date;

-- Enrich oligo.modification aliases with real customer Excel aliases from ABT OligoFlow
UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['56-FAM', '6-FAM', '5FAM', '6FAM', 'FAM-5']))
 WHERE code = 'FAM';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['5HEX', 'HEX-5']))
 WHERE code = 'HEX';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['5VIC', 'VIC-5']))
 WHERE code = 'VIC';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['5ROX', '5TEXRD-XN', 'TEXRED', 'TEXAS-RED', 'TEXASRED']))
 WHERE code = 'ROX';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['5CY5', 'CY5-5', '3CY5']))
 WHERE code = 'CY5';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['5CY3', 'CY3-5', '3CY3']))
 WHERE code = 'CY3';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['3BHQ_1', '3BHQ-1', 'BHQ-1', 'BHQ_1', '3BHQ1']))
 WHERE code = 'BHQ1';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['3BHQ_2', '3BHQ-2', 'BHQ-2', 'BHQ_2', '3BHQ2']))
 WHERE code = 'BHQ2';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['3BHQ_3', '3BHQ-3', 'BHQ-3', 'BHQ_3', '3BHQ3']))
 WHERE code = 'BHQ3';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['MGBNFQ', 'MGB-NFQ', '3MGBNFQ', '3MGB-NFQ', 'MGB_NFQ']))
 WHERE code = 'MGB';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['5BIOSG', 'BIOTIN-TEG', '5BIOTIN', '3BIOTIN', 'BIO']))
 WHERE code = 'BIOTIN';

UPDATE oligo.modification
   SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || ARRAY['5PHOS', '3PHOS', 'PHO', 'P', 'PHOSPHATE']))
 WHERE code = 'PHOS';

-- ============================================================================
-- 3. PACKAGE 3: DEVICE ENGINEERING (rd-innovation-hub/tech UPGRADE)
-- ============================================================================
ALTER TABLE device.device_model
  ADD COLUMN IF NOT EXISTS specs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accessories_standard jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accessories_optional jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE device.model_bom_line
  ADD COLUMN IF NOT EXISTS tracking_type text NOT NULL DEFAULT 'LOT'
    CHECK (tracking_type IN ('SERIAL', 'LOT', 'BULK')),
  ADD COLUMN IF NOT EXISTS drawing_code text;

ALTER TABLE device.subcontract_line
  ADD COLUMN IF NOT EXISTS measuring_instrument text,
  ADD COLUMN IF NOT EXISTS nominal_spec text,
  ADD COLUMN IF NOT EXISTS measured_value text,
  ADD COLUMN IF NOT EXISTS sample_qty numeric(18,6) NOT NULL DEFAULT 0 CHECK (sample_qty >= 0);

ALTER TABLE device.device_unit
  ADD COLUMN IF NOT EXISTS handover_accessories jsonb NOT NULL DEFAULT '[]'::jsonb;
