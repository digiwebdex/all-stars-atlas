-- TripLover (TravelMaster) PRODUCTION credentials
-- Run once on the production database, then restart the API (config cache = 5 min).
--   mysql -u <user> -p <db> < backend/database/triplover-production-seed.sql
--
-- Endpoints:
--   search  : https://apiv2.triplover.com/
--   booking : https://api.triplover.com/
--
-- Instant-issue carriers (no hold, no partial payment, wallet balance required):
--   Air Arabia (G9), Salam Air (OV), IndiGo (6E), Jazeera (J9),
--   Flydubai (FZ), Flynas (XY), FitsAir (8D), AirAsia (AK/FD/D7/I5/Z2)

INSERT INTO system_settings (setting_key, setting_value)
VALUES (
  'api_triplover',
  JSON_OBJECT(
    'enabled', 'true',
    'base_url', 'https://api.triplover.com',
    'search_base_url', 'https://apiv2.triplover.com',
    'email', 'smimran.ctgbd@gmail.com',
    'password', 'VWxoYVFXSnJiSFZrUTBVOQ==',
    'currency', 'BDT'
  )
)
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
