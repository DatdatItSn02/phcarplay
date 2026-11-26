// Giai đoạn 11: "bài bạn hay nghe" (đếm lượt, lưu trên thiết bị cho khách, gộp vào tab "Tất cả").
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalPlayStats, createPlayStats, createPlayCounter, mergeHome, LIMIT } from '../../public/assets/js/modules/youtube/playStats.js';

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m };
}
const it = (id, extra = {}) => Object.assign({ id, title: 'Bài ' + id, uploader: 'Kênh', duration: 200 }, extra);
const ID = (n) => ('v' + String(n).padStart(10, '0'));

test('đếm lượt: 1 lượt khi nghe từ 30 giây; bài dưới 1 phút: quá nửa bài; mỗi lần phát chỉ tính 1 lần; phát lại là lượt mới', () => {
  let cur = it('aaaaaaaaaaa'); let t = 0; let d = 200;
  const counted = [];
  const c = createPlayCounter({ getCurrent: () => cur, getTime: () => t, getDuration: () => d, onCount: (x) => counted.push(x.id) });
  t = 29; c.tick();
  assert.deepEqual(counted, [], 'chưa đủ 30 giây');
  t = 30; c.tick(); t = 100; c.tick();
  assert.deepEqual(counted, ['aaaaaaaaaaa'], 'chỉ tính 1 lần cho một lần phát');
  cur = it('bbbbbbbbbbb'); d = 40; t = 19; c.tick();
  assert.equal(counted.length, 1);
  t = 20; c.tick();
  assert.deepEqual(counted, ['aaaaaaaaaaa', 'bbbbbbbbbbb'], 'bài 40 giây: nghe 20 giây là tính');
  c.reset(); t = 25; c.tick();
  assert.equal(counted.length, 3, 'phát lại cùng bài là một lượt mới');
  cur = it('ccccccccccc'); d = NaN; t = 29; c.tick();
  assert.equal(counted.length, 3, 'chưa biết thời lượng: cần 30 giây');
  cur = null; c.tick();
});

test('hay nghe trên thiết bị (khách): từ 2 lượt, nhiều lượt trước, tối đa 20, quá 60 ngày thì rơi, ẩn/xóa = về 0 lượt', async () => {
  let now = Date.UTC(2026, 10, 5);
  const storage = memStorage();
  const s = createLocalPlayStats({ storage, now: () => now });
  await s.record(it('aaaaaaaaaaa'));
  assert.deepEqual(await s.top(), [], '1 lượt chưa đủ');
  await s.record(it('aaaaaaaaaaa'));
  for (let i = 0; i < 3; i++) { now += 1000; await s.record(it('bbbbbbbbbbb')); }
  const top = await s.top();
  assert.deepEqual(top.map((x) => [x.id, x.plays]), [['bbbbbbbbbbb', 3], ['aaaaaaaaaaa', 2]]);
  assert.equal(top[0].thumbnail, 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg');
  assert.equal((await createLocalPlayStats({ storage, now: () => now }).top()).length, 2, 'nhớ qua lần mở web sau');
  await s.hide('bbbbbbbbbbb');
  assert.deepEqual((await s.top()).map((x) => x.id), ['aaaaaaaaaaa']);
  await s.clear();
  assert.deepEqual(await s.top(), []);
  for (let i = 0; i < 25; i++) { await s.record(it(ID(i))); await s.record(it(ID(i))); }
  assert.equal((await s.top()).length, LIMIT);
  now += 61 * 86400000;
  assert.deepEqual(await s.top(), [], 'quá 60 ngày');
  await s.record({ id: 'sai' });
  const broken = createLocalPlayStats({ storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } } });
  await broken.record(it('aaaaaaaaaaa')); await broken.record(it('aaaaaaaaaaa'));
  assert.equal((await broken.top()).length, 1, 'trình duyệt không cho lưu: vẫn nhớ trong phiên');
});

test('hay nghe: đã đăng nhập thì gửi lên máy chủ, khách thì lưu trên thiết bị; lỗi mạng khi ghi lượt thì bỏ qua', async () => {
  const calls = [];
  let user = true;
  const api = {
    post: async (p, b) => { calls.push(['POST', p, b]); if (p === '/user/plays' && b.id === 'ddddddddddd') throw new Error('mạng'); return {}; },
    get: async (p) => { calls.push(['GET', p]); return { items: [it('xxxxxxxxxxx', { plays: 4 })] }; },
  };
  const s = createPlayStats({ api, hasUser: () => user, storage: memStorage() });
  await s.record(it('aaaaaaaaaaa', { thumbnail: 'javascript:x' }));
  assert.deepEqual(calls[0], ['POST', '/user/plays', { id: 'aaaaaaaaaaa', title: 'Bài aaaaaaaaaaa', uploader: 'Kênh', duration: 200 }], 'không gửi đường dẫn ảnh');
  await s.record(it('ddddddddddd'));   // không ném lỗi
  assert.equal((await s.top())[0].id, 'xxxxxxxxxxx');
  await s.hide('xxxxxxxxxxx');
  await s.clear();
  assert.deepEqual(calls.slice(-2).map((c) => c[1]), ['/user/plays/xxxxxxxxxxx/hide', '/user/plays/clear']);
  user = false;
  const n = calls.length;
  await s.record(it('bbbbbbbbbbb')); await s.record(it('bbbbbbbbbbb'));
  assert.equal(calls.length, n, 'khách: không gọi máy chủ');
  assert.equal((await s.top())[0].id, 'bbbbbbbbbbb');
});

test('tab "Tất cả": bài hay nghe trước (có dấu), thiếu thì thêm bài gợi ý cho đủ 20, không trùng', () => {
  const top = [it('aaaaaaaaaaa', { plays: 5 }), it('bbbbbbbbbbb', { plays: 2 })];
  const trend = [it('ccccccccccc'), it('aaaaaaaaaaa')].concat(Array.from({ length: 30 }, (_, i) => it(ID(i))));
  const out = mergeHome(top, trend, 20);
  assert.equal(out.length, 20);
  assert.deepEqual(out.slice(0, 3).map((x) => x.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  assert.deepEqual(out.slice(0, 3).map((x) => Boolean(x.frequent)), [true, true, false]);
  assert.equal(new Set(out.map((x) => x.id)).size, 20, 'không trùng');
  assert.equal(mergeHome(Array.from({ length: 25 }, (_, i) => it(ID(i))), trend, 20).filter((x) => x.frequent).length, 20, 'đủ 20 bài hay nghe thì không thêm gợi ý');
  assert.equal(mergeHome([], [it('ccccccccccc')], 20).length, 1, 'gợi ý ít hơn 20 thì hiện bấy nhiêu');
});
