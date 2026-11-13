// Giai đoạn 10.2: quy tắc nhắc thêm khóa YouTube API riêng (không làm phiền).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyHintPolicy, SNOOZE_DAYS } from '../../public/assets/js/modules/browser/keyHint.js';

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m };
}

test('nhắc thêm khóa: tối đa 1 lần mỗi ngày; nhớ qua lần mở web sau (localStorage)', () => {
  let t = new Date(2026, 10, 5, 9, 0).getTime();
  const storage = memStorage();
  const p = createKeyHintPolicy({ storage, now: () => t });
  assert.equal(p.canShow(), true);
  p.markShown();
  assert.equal(p.canShow(), false, 'cùng ngày không nhắc lại');
  t += 10 * 3600000;   // 19h cùng ngày
  assert.equal(createKeyHintPolicy({ storage, now: () => t }).canShow(), false, 'mở lại web cùng ngày cũng không nhắc');
  t = new Date(2026, 10, 6, 7, 0).getTime();
  assert.equal(createKeyHintPolicy({ storage, now: () => t }).canShow(), true, 'hôm sau nhắc lại được');
});

test('nhắc thêm khóa: bấm "Để sau" thì ' + SNOOZE_DAYS + ' ngày không nhắc; trình duyệt không cho lưu thì vẫn chạy', () => {
  let t = new Date(2026, 10, 5, 9, 0).getTime();
  const p = createKeyHintPolicy({ storage: memStorage(), now: () => t });
  p.snooze();
  t += 6 * 86400000;
  assert.equal(p.canShow(), false);
  t += 86400000 + 1000;
  assert.equal(p.canShow(), true);

  const broken = { getItem() { throw new Error('cấm'); }, setItem() { throw new Error('cấm'); } };
  const q = createKeyHintPolicy({ storage: broken, now: () => t });
  assert.equal(q.canShow(), true);
  q.markShown();
  assert.equal(q.canShow(), false, 'vẫn nhớ trong phiên');
});
