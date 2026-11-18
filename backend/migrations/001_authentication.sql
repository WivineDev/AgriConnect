CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti_hash CHAR(64) NOT NULL,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (jti_hash),
  KEY idx_revoked_tokens_expiry (expires_at),
  CONSTRAINT fk_revoked_tokens_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
