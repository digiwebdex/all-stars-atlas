-- ============================================================
-- Zero out ALL commission / markup defaults.
-- Everything is configured from Admin → Markup & Revenue afterwards.
-- Run: mysql -u root seventrip < backend/database/zero-commission-migration.sql
-- ============================================================

UPDATE system_settings
SET setting_value = JSON_OBJECT(
      'FLIGHT_DOM',   JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0, 'baseFareMarkup', 0, 'baseFareFixed', 0),
      'FLIGHT_INT',   JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0, 'baseFareMarkup', 0, 'baseFareFixed', 0),
      'FLIGHT_SOTO',  JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0, 'baseFareMarkup', 0, 'baseFareFixed', 0),
      'HOTEL',        JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0),
      'CAR',          JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0),
      'VISA',         JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0),
      'TOUR-PACKAGE', JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0)
    ),
    updated_at = NOW()
WHERE setting_key = 'markup_config';

-- Clear all per-airline overrides (admin re-adds only the airlines they want)
UPDATE system_settings
SET setting_value = JSON_OBJECT(
      'FLIGHT_DOM',  JSON_OBJECT(),
      'FLIGHT_INT',  JSON_OBJECT(),
      'FLIGHT_SOTO', JSON_OBJECT()
    ),
    updated_at = NOW()
WHERE setting_key = 'airline_markup_config';

-- Clear per-user commission overrides
DELETE FROM user_commission_overrides;

SELECT setting_key, setting_value FROM system_settings
WHERE setting_key IN ('markup_config', 'airline_markup_config');
