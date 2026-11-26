// Giai đoạn 12: hàng đợi khi mở web và ghi nhớ chế độ phát.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStartQueue } from '../../public/assets/js/modules/youtube/startQueue.js';
import { createPlaybackPrefs, sanitizePlayback } from '../../public/assets/js/modules/youtube/playbackPrefs.js';

const s = (id) => ({ id, title: 'Bài ' + id, uploader: 'K', duration: 100, thumbnail: 't' });
const pl = (lists) => ({
  list: async () => lists.map((l) => ({ id: l.id, count: l.items.length })),
  get: async (id) => { const l = lists.find((x) => x.id === id); if (l.broken) throw new Error('x'); return { items: l.items }; },
});

test('mở web: bài hay nghe -> bài trong playlist (gần nhất trước); không trùng; không tự tìm bài; có bài thì KHÔNG thêm video mặc định', async () => {
  const q = await buildStartQueue({
    playStats: { top: async () => [s('h1'), s('h2')] },
    playlists: pl([{ id: 1, items: [s('p1'), s('h1'), s('p2')] }, { id: 2, items: [] }, { id: 3, items: [s('p3')] }]),
    defaultVideo: 'dddddddddd1',
  });
  assert.deepEqual(q.map((x) => x.id), ['h1', 'h2', 'p1', 'p2', 'p3']);
});

test('mở web: chưa có bài hay nghe và chưa có bài trong playlist thì hàng đợi chỉ có video mặc định; tối đa 100 bài', async () => {
  const q1 = await buildStartQueue({ playStats: { top: async () => [] }, playlists: pl([{ id: 1, items: [] }]), defaultVideo: 'dddddddddd1' });
  assert.deepEqual(q1.map((x) => x.id), ['dddddddddd1']);
  assert.equal(q1[0].placeholder, true);
  const many = Array.from({ length: 150 }, (_, i) => s('p' + i));
  const q2 = await buildStartQueue({ playStats: null, playlists: pl([{ id: 1, items: many }]), defaultVideo: 'dddddddddd1' });
  assert.equal(q2.length, 100);
  assert.ok(!q2.some((x) => x.id === 'dddddddddd1'));
});

test('mở web: phần nào lỗi thì bỏ qua phần đó; không có gì và không đặt video mặc định -> hàng đợi trống', async () => {
  const q = await buildStartQueue({
    playStats: { top: async () => { throw new Error('mạng'); } },
    playlists: pl([{ id: 1, broken: true, items: [] , count: 1 }, { id: 2, items: [s('p2')] }]),
  });
  assert.deepEqual(q.map((x) => x.id), ['p2']);
  assert.deepEqual(await buildStartQueue({ playStats: { top: async () => [] }, playlists: pl([]) }), []);
});

test('nhớ chế độ phát: lưu trên thiết bị; đã đăng nhập thì đồng bộ tài khoản (gom lần gửi); dữ liệu bậy thì về mặc định', async () => {
  assert.deepEqual(sanitizePlayback({ repeat: 'xx', shuffle: 'true', autoMix: 0 }), { repeat: 'off', autoMix: true });
  assert.deepEqual(sanitizePlayback({ repeat: 'off', shuffle: true, autoMix: false }), { repeat: 'shuffle', autoMix: false }, 'bản cũ lưu shuffle riêng');
  assert.deepEqual(sanitizePlayback({ repeat: 'shuffle' }), { repeat: 'shuffle', autoMix: true });
  const m = {};
  const storage = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } };
  const puts = [];
  let user = false;
  let pending = null;
  const timers = { setTimeout: (fn) => { pending = fn; return 1; }, clearTimeout: () => { pending = null; } };
  const api = { put: async (p, b) => { puts.push(b); }, get: async () => ({ playback: { repeat: 'one', shuffle: true, autoMix: false } }) };
  const p = createPlaybackPrefs({ api, hasUser: () => user, storage, timers });
  assert.deepEqual(p.loadLocal(), { repeat: 'off', autoMix: true });
  p.save({ repeat: 'all', autoMix: true });
  assert.deepEqual(p.loadLocal().repeat, 'all');
  assert.equal(pending, null, 'khách: không gửi lên máy chủ');
  user = true;
  p.save({ repeat: 'one', autoMix: true });
  p.save({ repeat: 'shuffle', autoMix: true });
  pending();
  assert.deepEqual(puts, [{ playback: { repeat: 'shuffle', autoMix: true } }], 'gom thành một lần gửi');
  assert.deepEqual(await p.loadRemote(), { repeat: 'one', autoMix: false });
  assert.equal(p.loadLocal().autoMix, false, 'bản trên tài khoản ghi đè thiết bị');
});
