-- ============================================================
-- SOTO commission reset (keeps markups intact)
-- Zeroes the SOTO scope discount/commission fields and disables
-- the explicit SOTO commission flag. Per-airline SOTO markups
-- (e.g. BDT 500 fixed markup) are PRESERVED.
-- Run: mysql -u root seventrip < backend/database/soto-commission-reset.sql
-- ============================================================

UPDATE system_settings
SET setting_value = JSON_SET(
      COALESCE(NULLIF(setting_value, ''), '{}'),
      '$.FLIGHT_SOTO',
      JSON_MERGE_PATCH(
        COALESCE(JSON_EXTRACT(setting_value, '$.FLIGHT_SOTO'), JSON_OBJECT()),
        JSON_OBJECT(
          'fareSummaryDiscount', 0,
          'baseFareDiscount', 0,
          'sotoCommissionEnabled', false
        )
      )
    ),
    updated_at = NOW()
WHERE setting_key = 'markup_config';

SELECT JSON_EXTRACT(setting_value, '$.FLIGHT_SOTO') AS soto_config
FROM system_settings WHERE setting_key = 'markup_config';
