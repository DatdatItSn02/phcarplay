-- Giai đoạn 0-1: bảng lõi (người dùng, quản trị, đặt lại mật khẩu)

CREATE TABLE users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(100) NOT NULL DEFAULT '',
  password_hash CHAR(32) NOT NULL,
  salt CHAR(16) NOT NULL,
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  expires_at DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(100) NOT NULL DEFAULT '',
  password_hash CHAR(32) NOT NULL,
  salt CHAR(16) NOT NULL,
  role ENUM('master','admin') NOT NULL DEFAULT 'admin',
  status ENUM('active','blocked') NOT NULL DEFAULT 'active',
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_email (email),
  KEY idx_admins_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE password_resets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_type ENUM('user','admin') NOT NULL,
  account_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_resets_token (token_hash),
  KEY idx_resets_account (account_type, account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
