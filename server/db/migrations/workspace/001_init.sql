-- main.db / demo.db: one complete dataset per workspace.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  original_name TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER, height INTEGER, duration_s REAL, codec TEXT,
  path TEXT NOT NULL,
  thumb_path TEXT,
  thumb_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX media_sha ON media(sha256);

CREATE TABLE media_owners (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (media_id, user_id)
);
CREATE INDEX media_owners_by_user ON media_owners(user_id);

CREATE TABLE spaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, capacity_people INTEGER CHECK (capacity_people IS NULL OR capacity_people >= 0),
  color TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), position INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, room_type TEXT, capacity_guests INTEGER NOT NULL DEFAULT 2 CHECK (capacity_guests >= 1),
  beds TEXT, color TEXT NOT NULL, notes TEXT, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), position INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE series (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  rule TEXT NOT NULL,                       -- JSON {freq, interval, weekdays[], count|until}
  exceptions TEXT NOT NULL DEFAULT '[]',    -- JSON array of skipped dates
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('event','blocked','room_only')),
  title TEXT NOT NULL, description TEXT,
  owner_id TEXT NOT NULL, owner_name_snapshot TEXT NOT NULL,
  space_id TEXT REFERENCES spaces(id),
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  currency TEXT CHECK (currency IN ('RON','EUR')),
  price_note TEXT,
  enroll_url TEXT,
  cover_media_id TEXT REFERENCES media(id),
  cover_url TEXT,
  promotion_status TEXT CHECK (promotion_status IN ('pending','promoted','skipped')),
  series_id TEXT REFERENCES series(id) ON DELETE SET NULL,
  occurrence_index INTEGER,
  allow_overlap INTEGER NOT NULL DEFAULT 0 CHECK (allow_overlap IN (0,1)),
  first_date TEXT NOT NULL, last_date TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE INDEX entries_range ON entries(first_date, last_date);
CREATE INDEX entries_by_owner ON entries(owner_id);
CREATE INDEX entries_by_series ON entries(series_id);
CREATE INDEX entries_by_space ON entries(space_id);

CREATE TABLE entry_sessions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  date TEXT NOT NULL, start_time TEXT NOT NULL,
  end_time TEXT NOT NULL CHECK (end_time > start_time AND end_time <= '24:00'),
  start_utc TEXT NOT NULL, end_utc TEXT NOT NULL
);
CREATE INDEX sessions_by_date ON entry_sessions(date);
CREATE INDEX sessions_by_entry ON entry_sessions(entry_id);

CREATE TABLE room_bookings (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL CHECK (check_out > check_in),
  guests INTEGER NOT NULL DEFAULT 1 CHECK (guests >= 1),
  guest_names TEXT
);
CREATE INDEX bookings_by_room ON room_bookings(room_id, check_in, check_out);
CREATE INDEX bookings_by_entry ON room_bookings(entry_id);

CREATE TABLE platforms (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, domain TEXT,
  icon_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  description TEXT, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), position INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);

CREATE TABLE formats (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('video','image','carousel')),
  ratio_w INTEGER NOT NULL CHECK (ratio_w > 0), ratio_h INTEGER NOT NULL CHECK (ratio_h > 0),
  width INTEGER NOT NULL, height INTEGER NOT NULL,
  file_formats TEXT,
  min_duration_s INTEGER, max_duration_s INTEGER, max_items INTEGER, max_file_mb INTEGER,
  caption_limit INTEGER NOT NULL DEFAULT 2200, hook_length INTEGER,
  safe_zone TEXT, duration_note TEXT, file_size_note TEXT, hook_note TEXT,
  position INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE INDEX formats_by_platform ON formats(platform_id);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  format_id TEXT NOT NULL REFERENCES formats(id) ON DELETE RESTRICT,
  publish_date TEXT NOT NULL, publish_time TEXT NOT NULL,
  title TEXT NOT NULL, caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft','scheduled','published')),
  share_link TEXT,
  event_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE INDEX posts_by_date ON posts(publish_date);
CREATE INDEX posts_by_event ON posts(event_id);

CREATE TABLE post_media (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  media_id TEXT REFERENCES media(id),
  external_url TEXT,
  PRIMARY KEY (post_id, position),
  CHECK ((media_id IS NULL) <> (external_url IS NULL))
);
CREATE INDEX post_media_by_media ON post_media(media_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT
);
CREATE INDEX audit_by_entity ON audit_log(entity, entity_id);
