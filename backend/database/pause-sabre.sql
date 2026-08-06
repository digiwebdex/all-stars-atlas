-- Pause Sabre GDS (credentials rejected by Sabre prod) and keep TripLover active.
-- Run: mysql -u root seventrip < backend/database/pause-sabre.sql
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('provider_pause', JSON_OBJECT('sabre', true))
ON DUPLICATE KEY UPDATE
  setting_value = JSON_SET(COALESCE(setting_value, JSON_OBJECT()), '$.sabre', true);

SELECT setting_value AS provider_pause FROM system_settings WHERE setting_key = 'provider_pause';
