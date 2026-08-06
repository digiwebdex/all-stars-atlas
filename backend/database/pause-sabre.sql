-- Pause every flight GDS except the new TripLover API.
-- Run: mysql -u root seventrip < backend/database/pause-sabre.sql
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('provider_pause', JSON_OBJECT(
  'sabre', true,
  'galileo', true,
  'ndc_gateway', true,
  'lcc', true,
  'bdfare', true,
  'flyhub', true,
  'triplover', false,
  'tti_astra', false
))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

SELECT setting_value AS provider_pause FROM system_settings WHERE setting_key = 'provider_pause';
