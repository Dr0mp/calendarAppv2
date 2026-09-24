import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captionLength, captionState, checkItem, checkList, formatForRatio, kindOfUrl, maxItems, scheduleBlockers, worst } from '../../shared/rules/media-rules.js';
import { PlatformInput, PostInput, FormatInput } from '../../shared/schemas/social.js';

/** @type {any} */
const reel = { media_kind: 'video', ratio_w: 9, ratio_h: 16, width: 1080, height: 1920, min_duration_s: 3, max_duration_s: 90, max_file_mb: 100, caption_limit: 100, hook_length: 20 };
/** @type {any} */
const carousel = { media_kind: 'carousel', ratio_w: 4, ratio_h: 5, width: 1080, height: 1350, caption_limit: 2200, max_items: 3 };

const codes = (/** @type {any} */ r) => r.checks.map((/** @type {any} */ c) => `${c.level}:${c.code}`);

test('a matching video passes', () => {
  assert.deepEqual(checkItem(reel, { kind: 'video', width: 1080, height: 1920, duration_s: 30, bytes: 5e6 }), { level: 'ok', checks: [] });
});

test('wrong kind, duration and size are errors; ratio and resolution are warnings', () => {
  assert.deepEqual(codes(checkItem(reel, { kind: 'image', width: 1080, height: 1920 })), ['error:kind_mismatch']);
  assert.deepEqual(codes(checkItem(reel, { kind: 'video', width: 1920, height: 1080, duration_s: 2 })), ['warning:ratio_off', 'warning:resolution_low', 'error:too_short']);
  assert.deepEqual(codes(checkItem(reel, { kind: 'video', width: 720, height: 1280, duration_s: 91, bytes: 101 * 1024 * 1024 })), ['warning:resolution_low', 'error:too_long', 'error:file_too_big']);
  assert.equal(checkItem(reel, { kind: 'video', width: 720, height: 1280 }).level, 'warning');
  // ±3 % ratio tolerance.
  assert.deepEqual(codes(checkItem(carousel, { kind: 'image', width: 1120, height: 1380 })), []);
  assert.deepEqual(codes(checkItem(carousel, { kind: 'image', width: 1350, height: 1350 })), ['warning:ratio_off']);
  // Carousels take images and videos; unknown metadata is not reported.
  assert.deepEqual(codes(checkItem(carousel, { kind: 'video' })), []);
  assert.deepEqual(codes(checkItem(reel, {})), []);
});

test('item counts', () => {
  assert.equal(maxItems(reel), 1);
  assert.equal(maxItems(carousel), 3);
  assert.equal(maxItems({ ...carousel, max_items: null }), 20);
  assert.deepEqual(checkList(reel, 1), []);
  assert.equal(checkList(reel, 2)[0].code, 'too_many_items');
  assert.equal(checkList(carousel, 4)[0].params?.max, 3);
});

test('caption counter: hook and limit, counted in characters', () => {
  assert.equal(captionLength('ăîșț🙂'), 5);
  assert.equal(captionState(reel, 'a'.repeat(20)).level, 'ok');
  assert.equal(captionState(reel, 'a'.repeat(21)).level, 'hook');
  assert.equal(captionState(reel, 'a'.repeat(101)).level, 'over');
  assert.equal(captionState({ ...reel, hook_length: null }, 'a'.repeat(50)).level, 'ok');
});

test('schedule blockers collect errors only', () => {
  const b = scheduleBlockers(reel, [{ kind: 'image' }, { kind: 'video', width: 10, height: 10 }], 'x'.repeat(101));
  assert.deepEqual(b.map((x) => x.code), ['too_many_items', 'kind_mismatch', 'caption_too_long']);
  assert.equal(b[1].params?.index, 0);
  assert.deepEqual(scheduleBlockers(reel, [{ kind: 'video', width: 10, height: 10 }], ''), []);
});

test('helpers', () => {
  assert.equal(kindOfUrl('https://x.test/a.MP4?x=1'), 'video');
  assert.equal(kindOfUrl('https://x.test/a.jpg'), 'image');
  assert.equal(worst(['ok', 'warning']), 'warning');
  assert.equal(worst([]), 'ok');
  const fs = [{ id: 'v', ...reel }, { id: 'l', media_kind: 'image', ratio_w: 16, ratio_h: 9, width: 1, height: 1, caption_limit: 1 }];
  assert.equal(formatForRatio(fs, 1920, 1080)?.id, 'l');
  assert.equal(formatForRatio(fs, 1000, 1000)?.id, 'v');
});

test('schemas', () => {
  assert.equal(PlatformInput.parse({ name: 'X', color: '#aabbcc', domain: 'HTTPS://www.Example.com/path' }).domain, 'example.com');
  assert.equal(PlatformInput.parse({ name: 'X', color: '#aabbcc', domain: '' }).domain, null);
  assert.equal(PlatformInput.safeParse({ name: 'X', color: '#aabbcc', domain: 'no spaces.com' }).success, false);
  const base = { platform_id: '01900000-0000-7000-8000-000000000000', format_id: '01900000-0000-7000-8000-000000000001', publish_date: '2026-10-01', publish_time: '10:00', title: 'T', status: 'draft' };
  assert.equal(PostInput.parse({ ...base, share_link: '\\\\srv\\share\\dir' }).share_link, '\\\\srv\\share\\dir');
  assert.equal(PostInput.parse({ ...base, share_link: 'http://drive.test/x' }).share_link, 'http://drive.test/x');
  assert.equal(PostInput.safeParse({ ...base, share_link: 'ftp://x' }).success, false);
  assert.equal(PostInput.safeParse({ ...base, media: [{ url: 'http://insecure.test/a.jpg' }] }).success, false);
  const f = { name: 'F', media_kind: 'video', ratio_w: 9, ratio_h: 16, width: 1080, height: 1920, caption_limit: 100 };
  assert.equal(FormatInput.safeParse({ ...f, min_duration_s: 10, max_duration_s: 5 }).success, false);
  assert.equal(FormatInput.safeParse(f).success, true);
});
