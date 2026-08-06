-- TripLover UAT credentials seed
INSERT INTO system_settings (setting_key, setting_value)
VALUES ('api_triplover', JSON_OBJECT(
  'enabled', 'true',
  'base_url', 'https://userapi-uat.triplover.com',
  'search_base_url', 'https://searchapi-uat.triplover.com',
  'email', 'testapi@mail.com',
  'password', 'VTBkV2MySkhPVE5pTTBweldrVkJlQT09'
))
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
