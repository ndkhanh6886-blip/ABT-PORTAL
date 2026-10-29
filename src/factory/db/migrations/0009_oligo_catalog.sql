-- Oligo: catalogue of bases, inline-modified bases and terminal / internal modifications used by the
-- sequence analyser (docs/nha-may/01 §11 `modification`). Values are the effective parameters of the
-- former OligoFlow (its defaults with its MW / ε260 overrides applied), so calculated MW, ε260,
-- nmol/OD, µg/OD and Tm stay identical (Q7). They are configuration: edited later in the app, audited.

CREATE SCHEMA IF NOT EXISTS oligo;

CREATE TABLE oligo.modification (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  -- BASE: A C G T U I; LNA "+A"; OME "mA"; F2 "fA"; METHYL "5mC"; DYE / QUENCHER / MODIFIER / SPACER: "/CODE/"
  kind            text NOT NULL CHECK (kind IN ('BASE', 'LNA', 'OME', 'F2', 'METHYL', 'DYE', 'QUENCHER', 'MODIFIER', 'SPACER')),
  base_letter     char(1) CHECK (base_letter IN ('A', 'C', 'G', 'T', 'U', 'I')),
  -- BASE: counted as a nucleotide in length, GC, nearest-neighbour ε260 and Tm; MOD: adds its own ε260 only
  nn_role         text NOT NULL CHECK (nn_role IN ('BASE', 'MOD')),
  mw              numeric(10,3),              -- contribution to MW (g/mol)
  mw_delta        numeric(10,3),              -- or: base MW (with the RNA correction) + delta
  ext_coeff_260   numeric(12,1) NOT NULL DEFAULT 0,
  aliases         text[] NOT NULL DEFAULT '{}',
  position_type   text NOT NULL DEFAULT 'ANY' CHECK (position_type IN ('ANY', '5PRIME', '3PRIME', 'INTERNAL')),
  amidite_item_id uuid REFERENCES master.item (id),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  version         integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      integer,
  CHECK ((mw IS NULL) <> (mw_delta IS NULL)),
  CHECK (kind IN ('DYE', 'QUENCHER', 'MODIFIER', 'SPACER') OR base_letter IS NOT NULL)
);
CREATE INDEX modification_aliases ON oligo.modification USING gin (aliases);

INSERT INTO oligo.modification (code, name, kind, base_letter, nn_role, mw, mw_delta, ext_coeff_260, position_type, aliases) VALUES
  ('A', 'Adenine', 'BASE', 'A', 'BASE', 313.21, NULL, 15400, 'ANY', '{}'),
  ('C', 'Cytosine', 'BASE', 'C', 'BASE', 289.18, NULL, 7300, 'ANY', '{}'),
  ('G', 'Guanine', 'BASE', 'G', 'BASE', 329.21, NULL, 11700, 'ANY', '{}'),
  ('T', 'Thymine', 'BASE', 'T', 'BASE', 304.20, NULL, 8800, 'ANY', '{}'),
  ('U', 'Uracil', 'BASE', 'U', 'BASE', 306.17, NULL, 0, 'ANY', '{}'),
  ('I', 'Inosine', 'BASE', 'I', 'BASE', 308.95, NULL, 0, 'ANY', '{}'),
  ('+A', 'LNA Adenine', 'LNA', 'A', 'BASE', 341.21, NULL, 15400, 'ANY', '{}'),
  ('+C', 'LNA Cytosine', 'LNA', 'C', 'BASE', 317.18, NULL, 7300, 'ANY', '{}'),
  ('+G', 'LNA Guanine', 'LNA', 'G', 'BASE', 357.21, NULL, 11700, 'ANY', '{}'),
  ('+T', 'LNA Thymine', 'LNA', 'T', 'BASE', 332.20, NULL, 8800, 'ANY', '{}'),
  ('+U', 'LNA Uracil', 'LNA', 'U', 'BASE', 318.20, NULL, 8800, 'ANY', '{}'),
  ('MA', '2''-OMe Adenine', 'OME', 'A', 'BASE', 343.24, NULL, 15400, 'ANY', '{}'),
  ('MC', '2''-OMe Cytosine', 'OME', 'C', 'BASE', 319.21, NULL, 7300, 'ANY', '{}'),
  ('MG', '2''-OMe Guanine', 'OME', 'G', 'BASE', 359.24, NULL, 11700, 'ANY', '{}'),
  ('MT', '2''-OMe Thymine', 'OME', 'T', 'BASE', 334.23, NULL, 8800, 'ANY', '{}'),
  ('MU', '2''-OMe Uracil', 'OME', 'U', 'BASE', 320.20, NULL, 8800, 'ANY', '{}'),
  ('FA', '2''-Fluoro Adenine', 'F2', 'A', 'BASE', NULL, 17.99, 0, 'ANY', '{}'),
  ('FC', '2''-Fluoro Cytosine', 'F2', 'C', 'BASE', NULL, 17.99, 0, 'ANY', '{}'),
  ('FG', '2''-Fluoro Guanine', 'F2', 'G', 'BASE', NULL, 17.99, 0, 'ANY', '{}'),
  ('FT', '2''-Fluoro Thymine', 'F2', 'T', 'BASE', NULL, 17.99, 0, 'ANY', '{}'),
  ('FU', '2''-Fluoro Uracil', 'F2', 'U', 'BASE', NULL, 17.99, 0, 'ANY', '{}'),
  -- OligoFlow counted 5-Methyl-dC as a modification (own ε260, outside length / GC / Tm); kept for identical results
  ('5MC', '5-Methyl-dC', 'METHYL', 'C', 'MOD', 303.20, NULL, 7300, 'ANY', '{5MEDC,5-ME-DC,5-MEDC,5METHYLDC}'),
  ('FAM', '6-Carboxyfluorescein (FAM)', 'DYE', NULL, 'MOD', 537.50, NULL, 21000, 'ANY', '{5FAM,3FAM,6-FAM,5-FAM,56-FAM,36-FAM,6FAM,5(6)-FAM}'),
  ('HEX', 'HEX', 'DYE', NULL, 'MOD', 744.10, NULL, 31580, 'ANY', '{5HEX,3HEX,5-HEX,6-HEX,6HEX,56-HEX}'),
  ('TET', 'TET', 'DYE', NULL, 'MOD', 675.20, NULL, 16250, 'ANY', '{5TET,3TET,5-TET}'),
  ('JOE', 'JOE', 'DYE', NULL, 'MOD', 637.00, NULL, 12000, 'ANY', '{5JOE,3JOE}'),
  ('VIC', 'VIC', 'DYE', NULL, 'MOD', 677.00, NULL, 16000, 'ANY', '{5VIC,3VIC}'),
  ('ROX', 'ROX', 'DYE', NULL, 'MOD', 643.00, NULL, 22500, 'ANY', '{5ROX,3ROX}'),
  ('TAMRA', 'TAMRA', 'DYE', NULL, 'MOD', 1008.90, NULL, 31980, 'ANY', '{5TAMRA,3TAMRA,5-TAMRA,3-TAMRA}'),
  ('TXR', 'Texas Red', 'DYE', NULL, 'MOD', 881.00, NULL, 14400, 'ANY', '{5TEXRD-XN,3TEXRD-XN,TEXRD-XN,TEXASRED,TEXAS-RED,TEXARED,5TXR,3TXR,5-TXR,3-TXR}'),
  ('CY3', 'Cyanine 3', 'DYE', NULL, 'MOD', 506.60, NULL, 4900, 'ANY', '{5CY3,3CY3,5-CY3,3-CY3}'),
  ('CY5', 'Cyanine 5', 'DYE', NULL, 'MOD', 532.60, NULL, 10000, 'ANY', '{5CY5,3CY5,5-CY5,3-CY5}'),
  ('CY5.5', 'Cyanine 5.5', 'DYE', NULL, 'MOD', 1128.00, NULL, 10000, 'ANY', '{5CY5.5,3CY5.5,5-CY5.5,3-CY5.5}'),
  ('CY7', 'Cyanine 7', 'DYE', NULL, 'MOD', 648.80, NULL, 199000, 'ANY', '{5CY7,3CY7,5-CY7,3-CY7}'),
  ('AF488', 'Alexa Fluor 488', 'DYE', NULL, 'MOD', 643.00, NULL, 10000, 'ANY', '{ALEXA488}'),
  ('ALEXA594', 'Alexa Fluor 594', 'DYE', NULL, 'MOD', 820.00, NULL, 14000, 'ANY', '{AF594}'),
  ('BHQ0', 'Black Hole Quencher 0', 'QUENCHER', NULL, 'MOD', 700.00, NULL, 21400, '3PRIME', '{3BHQ0,3BHQ_0,BHQ_0,BHQ-0}'),
  ('BHQ1', 'Black Hole Quencher 1', 'QUENCHER', NULL, 'MOD', 491.50, NULL, 8000, '3PRIME', '{3BHQ_1,5BHQ_1,BHQ_1,3BHQ1,5BHQ1,3-BHQ1,5-BHQ1,BHQ-1,3-BHQ-1}'),
  ('BHQ2', 'Black Hole Quencher 2', 'QUENCHER', NULL, 'MOD', 556.50, NULL, 8000, '3PRIME', '{3BHQ_2,5BHQ_2,BHQ_2,3BHQ2,5BHQ2,3-BHQ2,5-BHQ2,BHQ-2,3-BHQ-2}'),
  ('BHQ3', 'Black Hole Quencher 3', 'QUENCHER', NULL, 'MOD', 890.00, NULL, 21400, '3PRIME', '{3BHQ_3,5BHQ_3,BHQ_3,3BHQ3,5BHQ3,3-BHQ3,5-BHQ3,BHQ-3,3-BHQ-3}'),
  ('DABCYL', 'DABCYL', 'QUENCHER', NULL, 'MOD', 423.50, NULL, 32000, 'ANY', '{5DABCYL,3DABCYL}'),
  ('MGB', 'Minor Groove Binder (MGB-NFQ)', 'QUENCHER', NULL, 'MOD', 973.00, NULL, 0, '3PRIME', '{3MGB,5MGB,3-MGB,5-MGB,MGBNFQ,MGB-NFQ,MGB_NFQ}'),
  ('BIOTIN', 'Biotin', 'MODIFIER', NULL, 'MOD', 482.00, NULL, 0, 'ANY', '{5BIOTIN,3BIOTIN,5-BIOTIN,3-BIOTIN,BIOTIN-TEG,BIOTINTEG}'),
  ('NH2', 'Amino modifier C6', 'MODIFIER', NULL, 'MOD', 179.21, NULL, 0, 'ANY', '{5AMINO,3AMINO,5-AMINO,3-AMINO,AMINO-C6,AMINOC6,5-NH2,3-NH2,5NH2,3NH2}'),
  ('PHOS', 'Phosphate', 'MODIFIER', NULL, 'MOD', 79.98, NULL, 0, 'ANY', '{5PHOS,3PHOS,5-PHOS,3-PHOS,PHOSPHORYLATION}'),
  ('THIOL', 'Thiol modifier C6', 'MODIFIER', NULL, 'MOD', 297.40, NULL, 0, 'ANY', '{5THIOL,3THIOL,5-THIOL,3-THIOL,THIOL-C6,THIOLC6}'),
  ('INVDT', 'Inverted dT', 'MODIFIER', NULL, 'MOD', 304.20, NULL, 8700, '3PRIME', '{3INVDT,3-INVDT,INVERTED-DT}'),
  ('C3', 'C3 Spacer', 'SPACER', NULL, 'MOD', 138.10, NULL, 0, 'ANY', '{SPACER,SPC3,C3-SPACER}'),
  ('C6', 'C6 Spacer', 'SPACER', NULL, 'MOD', 180.20, NULL, 0, 'ANY', '{SPC6}');
