CREATE TABLE feed_tokens (
  who TEXT PRIMARY KEY CHECK (who IN ('a', 'b')),
  hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  fetched_at TEXT CHECK (fetched_at IS NULL OR fetched_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
);
