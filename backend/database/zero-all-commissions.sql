-- Zero ALL commissions/markups. Everything is configured from Admin → Markup & Revenue.
-- Run: mysql -u root --force seventrip < backend/database/zero-all-commissions.sql

UPDATE system_settings
SET setting_value = JSON_OBJECT(
      'FLIGHT',       JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0, 'baseFareMarkup', 0, 'baseFareFixed', 0, 'baseFareDiscount', 0),
      'FLIGHT_DOM',   JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0, 'baseFareMarkup', 0, 'baseFareFixed', 0, 'baseFareDiscount', 0),
      'FLIGHT_INT',   JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0, 'baseFareMarkup', 0, 'baseFareFixed', 0, 'baseFareDiscount', 0),
      'FLIGHT_SOTO',  JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0, 'baseFareMarkup', 0, 'baseFareFixed', 0, 'baseFareDiscount', 0, 'sotoCommissionEnabled', false),
      'HOTEL',        JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0),
      'CAR',          JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0),
      'VISA',         JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0),
      'TOUR-PACKAGE', JSON_OBJECT('fareSummaryDiscount', 0, 'fareSummaryAitVat', 0)
    ),
    updated_at = NOW()
WHERE setting_key = 'markup_config';

-- Remove every per-airline override so nothing is inherited
UPDATE system_settings
SET setting_value = JSON_OBJECT('FLIGHT_DOM', JSON_OBJECT(), 'FLIGHT_INT', JSON_OBJECT(), 'FLIGHT_SOTO', JSON_OBJECT()),
    updated_at = NOW()
WHERE setting_key = 'airline_markup_config';

-- Remove per-user commission overrides (admin re-adds as needed)
DELETE FROM user_commission_overrides;

SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('markup_config','airline_markup_config');
