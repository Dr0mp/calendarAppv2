import { newId, isoNow } from '../util.js';
import { addDays, localToUtc, todayIn } from '../../shared/rules/time.js';
import { getSetting, setSetting } from '../services/settings.js';
import sample from './sample-content.json' with { type: 'json' };

/**
 * Seed a workspace once: spaces, rooms, platforms with formats and, when
 * SEED_SAMPLE_CONTENT=1, sample events and posts dated relative to today.
 * In main the sample content belongs to the root admin; in the demo to the
 * fictitious seed users.
 * @param {import('../app.js').App} app
 * @param {import('../app.js').Workspace} ws
 */
export function seedWorkspace(app, ws) {
  const db = ws.db;
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'seeded_at'").get()) return;
  const now = isoNow();
  const tz = getSetting(db, 'tz');
  const today = todayIn(tz);

  const owners = resolveOwners(app, ws.name);
  const actor = owners.default.id;

  db.tx(() => {
    /** @type {Record<string,string>} */ const spaceIds = {};
    sample.spaces.forEach((s, i) => {
      const id = newId();
      spaceIds[s.key] = id;
      db.prepare(
        `INSERT INTO spaces (id, name, capacity_people, color, description, enabled, position, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      ).run(id, s.name, s.capacity_people, s.color, s.description, i, now, actor, now, actor);
    });
    /** @type {Record<string,string>} */ const roomIds = {};
    sample.rooms.forEach((r, i) => {
      const id = newId();
      roomIds[r.key] = id;
      db.prepare(
        `INSERT INTO rooms (id, name, room_type, capacity_guests, beds, color, notes, enabled, position, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      ).run(id, r.name, r.room_type, r.capacity_guests, r.beds, r.color, r.notes, i, now, actor, now, actor);
    });

    const { platformIds, formatIds } = seedPlatforms(db, actor);

    if (app.config.seedSampleContent || ws.name === 'demo') {
      /** @type {Record<string,string>} */ const entryIds = {};
      for (const e of sample.entries) {
        const owner = owners[e.owner] ?? owners.default;
        const id = newId();
        entryIds[e.key] = id;
        const sessions = (e.sessions ?? []).map((s) => ({ date: addDays(today, s.day), start: s.start, end: s.end }));
        const bookings = (e.room_bookings ?? []).map((b) => ({
          room_id: roomIds[b.room],
          check_in: addDays(today, b.check_in),
          check_out: addDays(today, b.check_out),
          guests: b.guests,
          guest_names: b.guest_names ?? null,
        }));
        const dates = [...sessions.map((s) => s.date), ...bookings.flatMap((b) => [b.check_in, addDays(b.check_out, -1)])].sort();
        db.prepare(
          `INSERT INTO entries (id, type, title, description, owner_id, owner_name_snapshot, space_id, price_cents, currency, price_note,
             enroll_url, cover_url, promotion_status, first_date, last_date, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, e.type, e.title, e.description ?? null, owner.id, owner.name,
          e.space ? spaceIds[e.space] : null,
          e.type === 'event' ? e.price_cents ?? null : null,
          e.type === 'event' && e.price_cents != null ? e.currency : null,
          e.type === 'event' ? e.price_note ?? null : null,
          e.type === 'event' ? e.enroll_url : null,
          e.type === 'event' ? e.cover_url : null,
          e.type === 'event' ? 'pending' : null,
          dates[0], dates[dates.length - 1], now, owner.id, now, owner.id,
        );
        for (const s of sessions) {
          db.prepare('INSERT INTO entry_sessions (id, entry_id, date, start_time, end_time, start_utc, end_utc) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            newId(), id, s.date, s.start, s.end, localToUtc(s.date, s.start, tz), localToUtc(s.date, s.end, tz),
          );
        }
        for (const b of bookings) {
          db.prepare('INSERT INTO room_bookings (id, entry_id, room_id, check_in, check_out, guests, guest_names) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            newId(), id, b.room_id, b.check_in, b.check_out, b.guests, b.guest_names,
          );
        }
      }

      for (const p of sample.posts) {
        const id = newId();
        const eventId = p.event ? entryIds[p.event] : null;
        db.prepare(
          `INSERT INTO posts (id, platform_id, format_id, publish_date, publish_time, title, caption, status, share_link, event_id,
             created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, platformIds[p.platform], formatIds[p.format], addDays(today, p.day), p.time, p.title, p.caption, p.status,
          p.share_link, eventId, now, actor, now, actor,
        );
        p.media.forEach((url, i) => {
          db.prepare('INSERT INTO post_media (post_id, position, media_id, external_url) VALUES (?, ?, NULL, ?)').run(id, i, url);
        });
        if (eventId) db.prepare("UPDATE entries SET promotion_status = 'promoted' WHERE id = ?").run(eventId);
      }
    }
    setSetting(db, 'seeded_at', now);
  });
}

/**
 * Insert the default platforms and formats. Used by the seed and by
 * "reset to defaults".
 * @param {import('../db/open.js').Db} db @param {string|null} actor
 */
export function seedPlatforms(db, actor) {
  const now = isoNow();
  /** @type {Record<string,string>} */ const platformIds = {};
  /** @type {Record<string,string>} */ const formatIds = {};
  sample.platforms.forEach((p, i) => {
    const id = newId();
    platformIds[p.slug] = id;
    db.prepare(
      `INSERT INTO platforms (id, slug, name, color, domain, icon_media_id, description, enabled, position, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?, ?, ?)`,
    ).run(id, p.slug, p.name, p.color, p.domain, p.description, i, now, actor, now, actor);
    p.formats.forEach((f, j) => {
      const fid = newId();
      formatIds[f.key] = fid;
      db.prepare(
        `INSERT INTO formats (id, platform_id, name, media_kind, ratio_w, ratio_h, width, height, file_formats, min_duration_s,
           max_duration_s, max_items, max_file_mb, caption_limit, hook_length, safe_zone, duration_note, file_size_note, hook_note,
           position, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        fid, id, f.name, f.media_kind, f.ratio_w, f.ratio_h, f.width, f.height, f.file_formats, f.min_duration_s,
        f.max_duration_s, f.max_items, f.max_file_mb, f.caption_limit, f.hook_length, f.safe_zone, f.duration_note,
        f.file_size_note, f.hook_note, j, now, actor, now, actor,
      );
    });
  });
  return { platformIds, formatIds };
}

/** @param {import('../app.js').App} app @param {'main'|'demo'} workspace */
function resolveOwners(app, workspace) {
  const db = app.authDb;
  /** @type {Record<string, {id: string, name: string}>} */ const owners = {};
  if (workspace === 'main') {
    const root = /** @type {any} */ (db.prepare('SELECT id, name FROM users WHERE is_root = 1').get());
    owners.default = root;
    return owners;
  }
  for (const s of sample.seedUsers) {
    const u = /** @type {any} */ (db.prepare('SELECT id, name FROM users WHERE username = ?').get(s.username));
    if (u) owners[s.key] = u;
  }
  owners.default = owners.anca ?? Object.values(owners)[0];
  return owners;
}
