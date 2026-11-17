-- Starting values. Safe to run more than once (INSERT OR IGNORE skips rows that already exist).
-- Money is stored in whole centavos (PHP 20,000.00 = 2000000).
-- The values below are the bracketed figures in the Ximon proposal. Change them in the
-- Setting table once the client confirms them; no code change is needed.

INSERT OR IGNORE INTO Setting (SettingKey, SettingValue, Description) VALUES
  ('quotation_threshold_centavos', '2000000', 'Below this: 1-2 quotations. At or above, or new supplier or special item: at least 3 (proposal default PHP 20,000)'),
  ('cash_buy_limit_centavos', '200000', 'Largest small cash buy (proposal default PHP 2,000)'),
  ('receipt_photo_hours', '24', 'Hours allowed to upload the receipt photo for a cash buy (proposal default 24)'),
  ('reorder_review_months', '3', 'How often reorder points are reviewed (proposal default: every quarter)');

-- Sample project from the client's BOQ (aircon repair, drain pump). Budget PHP 4,500.00 for the pump's material cost.
INSERT OR IGNORE INTO Project (Code, Name, MaterialBudgetCentavos)
VALUES ('ADC-RECEPTION', 'ADC Reception Area, aircon repair works', 450000);
