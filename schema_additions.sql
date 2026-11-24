-- Run ONCE in MySQL Workbench / TiDB (database: fvd). New tables + one new column.
ALTER TABLE users ADD COLUMN display_name VARCHAR(60) NULL;

CREATE TABLE sessions (
  token_hash  CHAR(64)   NOT NULL PRIMARY KEY,
  user_id     INT        NOT NULL,
  pending_2fa TINYINT(1) NOT NULL DEFAULT 0,
  tries       INT        NOT NULL DEFAULT 0,
  created_at  DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sess_user (user_id)
);

CREATE TABLE analysis_frames (
  analysis_id BIGINT NOT NULL,
  frame_no    INT    NOT NULL,
  video_frame INT    NOT NULL,
  time_sec    FLOAT  NOT NULL,
  probability FLOAT  NULL,
  jpeg        MEDIUMBLOB NULL,
  PRIMARY KEY (analysis_id, frame_no),
  CONSTRAINT fk_fr_an FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);
