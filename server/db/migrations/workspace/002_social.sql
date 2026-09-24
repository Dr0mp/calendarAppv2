-- Fetched favicons are stored as media separately from uploaded icons, so an
-- uploaded icon always wins and removing it falls back to the favicon.
ALTER TABLE platforms ADD COLUMN favicon_media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
CREATE INDEX posts_by_platform ON posts(platform_id, publish_date);
