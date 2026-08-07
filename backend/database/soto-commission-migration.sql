-- ============================================================
-- SOTO commission fix
-- Ensures the FLIGHT_SOTO scope exists in markup_config with
-- 0% discount (no commission) so it never inherits the
-- Domestic/International 6.30% default.
-- Run: mysql -u root seventrip < backend/database/soto-commission-migration.sql
-- ============================================================

UPDATE system_settings
SET setting_value = JSON_SET(
      COALESCE(NULLIF(setting_value, ''), '{}'),
      '$.FLIGHT_SOTO',
      JSON_MERGE_PATCH(
        COALESCE(JSON_EXTRACT(setting_value, '$.FLIGHT_SOTO'), JSON_OBJECT()),
        JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0)
      )
    ),
    updated_at = NOW()
WHERE setting_key = 'markup_config';

-- Clear per-airline SOTO overrides so the scope defaults apply
UPDATE system_settings
SET setting_value = JSON_SET(
      COALESCE(NULLIF(setting_value, ''), '{}'),
      '$.FLIGHT_SOTO',
      JSON_OBJECT()
    ),
    updated_at = NOW()
WHERE setting_key = 'airline_markup_config';

SELECT setting_key, setting_value FROM system_settings
WHERE setting_key IN ('markup_config', 'airline_markup_config');
