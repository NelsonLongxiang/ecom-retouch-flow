CREATE TABLE observations (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
  required ANY NOT NULL CHECK(typeof(required) = 'integer' AND required IN (0, 1)),
  verdict TEXT CHECK(verdict IS NULL OR verdict IN ('PASS', 'FAIL', 'UNKNOWN'))
) STRICT;
