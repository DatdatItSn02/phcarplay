// Giai đoạn 7: nạp hls.js đúng nguồn máy chủ gửi, kèm kiểm tra toàn vẹn (SRI) khi có.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHlsLoader, DEFAULT_HLS_SRC } from '../../public/assets/js/modules/youtube/playerEngine.js';

function fakeDom() {
  const added = [];
  globalThis.window = {};
  globalThis.document = {
    createElement: (tag) => ({ tag }),
    head: { appendChild: (el) => { added.push(el); } },
  };
  return added;
}

test('createHlsLoader: không có cấu hình thì dùng CDN mặc định, không đặt integrity', async () => {
  const added = fakeDom();
  const load = createHlsLoader();
  const p = load();
  assert.equal(added.length, 1);
  assert.equal(added[0].tag, 'script');
  assert.equal(added[0].src, DEFAULT_HLS_SRC);
  assert.equal(added[0].integrity, undefined);
  assert.equal(added[0].crossOrigin, undefined);
  window.Hls = function Hls() {};
  added[0].onload();
  assert.equal(await p, window.Hls);
  assert.equal(await load(), window.Hls, 'đã có window.Hls thì không nạp lại');
  assert.equal(added.length, 1);
});

test('createHlsLoader: dùng đúng nguồn máy chủ gửi (file trong website hoặc CDN kèm SRI)', async () => {
  let added = fakeDom();
  createHlsLoader('/carweb/assets/vendor/hls.min.js', '')();
  assert.equal(added[0].src, '/carweb/assets/vendor/hls.min.js');
  assert.equal(added[0].integrity, undefined);

  added = fakeDom();
  const p = createHlsLoader('https://cdn.example.com/hls.min.js', 'sha384-abc')();
  assert.equal(added[0].integrity, 'sha384-abc', 'có SRI: trình duyệt từ chối file bị tráo');
  assert.equal(added[0].crossOrigin, 'anonymous', 'SRI với file khác nguồn gốc cần crossorigin');
  added[0].onerror();
  assert.equal(await p, null, 'nạp lỗi (hoặc sai mã SRI) thì trả null để trình phát dùng nguồn mp4');
});

test('createHlsLoader: chỉ nạp một lần dù gọi nhiều lần trong lúc đang tải', async () => {
  const added = fakeDom();
  const load = createHlsLoader('https://cdn.example.com/hls.min.js');
  const a = load();
  const b = load();
  assert.equal(added.length, 1);
  window.Hls = function Hls() {};
  added[0].onload();
  assert.equal(await a, await b);
});
