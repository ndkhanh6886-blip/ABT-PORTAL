-- NCR disposition workflow (docs/nha-may/02 §4.3): USE_AS_IS (concession) needs QA and then the board.

ALTER TABLE qms.ncr DROP CONSTRAINT ncr_status_check;
ALTER TABLE qms.ncr ADD CONSTRAINT ncr_status_check
  CHECK (status IN ('OPEN', 'DISPOSITION_PROPOSED', 'PENDING_BOD', 'APPROVED', 'CLOSED'));
ALTER TABLE qms.ncr
  ADD COLUMN proposed_by integer,
  ADD COLUMN proposal_note text,
  ADD COLUMN closed_by integer;
