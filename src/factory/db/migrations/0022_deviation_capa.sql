-- Operational incidents (as OligoFlow's "Sự cố chất lượng"): a deviation gets a title, the step and the person
-- involved, and a CAPA record — root cause, corrective and preventive actions with an owner and a due date.
ALTER TABLE qms.deviation
  ADD COLUMN title             text,
  ADD COLUMN root_cause        text,
  ADD COLUMN corrective_action text,
  ADD COLUMN preventive_action text,
  ADD COLUMN action_owner      text,
  ADD COLUMN action_due        date,
  ADD COLUMN closed_at         timestamptz,
  ADD CONSTRAINT capa_before_action_defined CHECK (status NOT IN ('ACTION_DEFINED') OR (root_cause IS NOT NULL AND corrective_action IS NOT NULL));
CREATE INDEX ON qms.deviation (entity_type, entity_id);
CREATE INDEX ON qms.deviation (status, created_at);
