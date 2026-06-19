-- ============================================================
-- B2B Agency Registration Migration
-- Adds agency_profiles table for B2B agent signup.
-- Run: mysql seventrip < backend/database/agency-registration-migration.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS agency_profiles (
  user_id CHAR(36) PRIMARY KEY,
  agency_name VARCHAR(200) NOT NULL,
  mocat_license VARCHAR(120) NULL,
  country VARCHAR(80) DEFAULT 'Bangladesh',
  city VARCHAR(120) NULL,
  address TEXT NULL,
  postal_code VARCHAR(20) NULL,
  owner_first_name VARCHAR(100) NOT NULL,
  owner_last_name VARCHAR(100) NULL,
  owner_email VARCHAR(200) NOT NULL,
  owner_mobile VARCHAR(40) NOT NULL,
  verification_status ENUM('pending','approved','rejected') DEFAULT 'pending',
  rejection_reason TEXT NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_agency_status (verification_status),
  INDEX idx_agency_name (agency_name)
);
