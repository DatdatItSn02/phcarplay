// Giai đoạn 15 -> 17: hộp "Chia sẻ màn hình lên xe" trên ĐIỆN THOẠI (trong ứng dụng Android).
//  - Đã ghép đôi: danh sách màn hình xe (dùng gần nhất ở trên), bấm tên xe là chia sẻ ngay (Android hỏi "Bắt đầu"),
//    nút "Quên" để bỏ ghép đôi.
//  - Chưa ghép đôi, hoặc bấm "Thêm màn hình xe": nhập mã 6 số đang hiện trên màn hình xe (chỉ lần đầu), xong là nhớ luôn.
//  - Đang nối / đang chiếu: trạng thái + nút Hủy / Dừng chiếu.
// Đóng hộp không làm dừng chiếu; mở lại bằng nút "Chia sẻ" hoặc Cài đặt để xem trạng thái hoặc dừng.
import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog, confirmAction } from '../../core/dialog.js';
import { cleanCode } from './castProtocol.js';

const BUSY_PHASES = ['joining', 'permission', 'sharing', 'connecting'];

/** Dòng trạng thái lúc đang nối (theo bước và màn hình xe đang chia sẻ tới). */
export function busyText(s) {
  const car = s.target && s.target.name ? `"${s.target.name}"` : 'màn hình xe';
  if (s.phase === 'joining') return 'Đang kiểm tra mã...';
  if (s.phase === 'permission') return 'Android đang hỏi quyền ghi màn hình. Hãy chọn "Bắt đầu" (hoặc "Toàn bộ màn hình" > "Bắt đầu").';
  if (s.phase === 'sharing') return `Đang gửi lời mời tới ${car}...`;
  if (s.phase === 'connecting') {
    if (s.via === 'share' && !s.picked) return `Đang chờ ${car} nhận. Màn hình xe cần đang mở PH Car Play.`;
    return `Đang nối với ${car}...`;
  }
  return '';
}

/** "27/11/2026" từ chuỗi ngày giờ của máy chủ ("2026-11-27 08:30:00"). */
export function shortDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * sender: castSender.js   subscribe(fn) -> hủy theo dõi trạng thái
 * loadPairs(): Promise<[{ id, name, created_at, last_used_at }]> (màn hình xe đã ghép đôi)   forget(pair): Promise
 * initialPairs: danh sách đã tải sẵn (bấm nút "Chia sẻ" vừa tải) - null thì tự tải.
 */
export function openCastSenderDialog({ sender, subscribe, loadPairs = null, forget = null, initialPairs = null }) {
  let pairs = Array.isArray(initialPairs) ? initialPairs : null;
  let loadError = '';
  let adding = false;          // đang xem ô nhập mã dù đã có màn hình xe ghép đôi
  let lastPhase = sender.snapshot().phase;

  const input = h('input', { id: 'cast-code', class: 'input cast-code-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '7', placeholder: '000 000', 'aria-label': 'Mã 6 số trên màn hình xe' });
  input.addEventListener('input', () => {
    const c = cleanCode(input.value);
    input.value = c.length > 3 ? c.slice(0, 3) + ' ' + c.slice(3) : c;
  });
  const status = h('p', { class: 'cast-status', role: 'status' });
  const goBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, icon('cast', 22), 'Kết nối');
  const backBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { adding = false; paint(sender.snapshot()); } }, 'Quay lại danh sách');
  const form = h('form', { class: 'form cast-join', novalidate: true, onsubmit: (e) => { e.preventDefault(); sender.start(input.value); } },
    h('p', { class: 'dialog-text' }, 'Lần đầu: trên màn hình xe bấm ', h('strong', {}, 'Chiếu ĐT'), ' để lấy mã 6 số, rồi nhập vào đây. ',
      'Lần sau chỉ cần bấm ', h('strong', {}, 'Chia sẻ'), ', không phải nhập mã.'),
    input, goBtn,
    h('p', { class: 'hint' }, 'Hai máy cần chung mạng: cắm dây vào xe và bật "Chia sẻ kết nối qua USB", hoặc cho màn hình xe dùng Wi-Fi phát từ điện thoại này.'),
    backBtn);

  // danh sách màn hình xe đã ghép đôi
  const list = h('ul', { class: 'cast-pairs', 'aria-label': 'Màn hình xe đã ghép đôi' });
  const addBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { adding = true; paint(sender.snapshot()); input.focus(); } }, icon('plus', 22), 'Thêm màn hình xe khác (nhập mã)');
  const pick = h('div', { class: 'cast-pick' },
    h('p', { class: 'dialog-text' }, 'Bấm vào màn hình xe để chia sẻ. Android sẽ hỏi quyền ghi màn hình: chọn ', h('strong', {}, '"Bắt đầu"'), '.'),
    list, addBtn);
  const loading = h('p', { class: 'cast-loading' }, 'Đang tải danh sách màn hình xe...');

  // đang nối
  const busyText1 = h('p', { class: 'cast-busy-text', role: 'status' });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => sender.stop() }, 'Hủy');
  const busy = h('div', { class: 'cast-busy' }, h('span', { class: 'cast-busy-icon', 'aria-hidden': 'true' }, icon('cast', 30)), busyText1, cancelBtn);

  // đang chiếu
  const liveText = h('p', { class: 'cast-live-title' });
  const stopBtn = h('button', { type: 'button', class: 'btn btn-danger', onclick: () => sender.stop() }, icon('stop', 22), 'Dừng chiếu');
  const live = h('div', { class: 'cast-live' },
    liveText,
    h('ul', { class: 'cast-tips' },
      h('li', {}, 'Bây giờ hãy mở ', h('strong', {}, 'bản đồ'), ' trên điện thoại: màn hình xe sẽ hiện đúng những gì điện thoại đang hiện.'),
      h('li', {}, 'Giữ điện thoại sáng màn hình. Tin nhắn và thông báo hiện trên điện thoại cũng sẽ hiện trên màn hình xe.'),
      h('li', {}, 'Dừng chiếu: bấm nút dưới đây, hoặc nút "Dừng chiếu" trong thông báo của ứng dụng.')),
    stopBtn);

  async function askForget(p) {
    if (!forget) return;
    const ok = await confirmAction({ title: 'Quên màn hình xe này?', message: `Lần sau muốn chiếu lên "${p.name}" phải nhập mã lại.`, confirmLabel: 'Quên', danger: true });
    if (!ok) return;
    try {
      await forget(p);
      pairs = (pairs || []).filter((x) => x.id !== p.id);
      loadError = '';
    } catch (e) {
      loadError = (e && e.message) || 'Không quên được. Kiểm tra mạng rồi thử lại.';
    }
    paint(sender.snapshot());
  }

  function drawList() {
    clear(list);
    (pairs || []).forEach((p) => {
      const when = shortDate(p.created_at);
      list.append(h('li', { class: 'cast-pair-row' },
        h('button', { type: 'button', class: 'cast-pair-go', onclick: () => sender.share(p), 'aria-label': `Chia sẻ màn hình lên ${p.name}` },
          icon('cast', 26),
          h('span', { class: 'cast-pair-text' }, h('span', { class: 'cast-pair-name' }, p.name), when ? h('span', { class: 'cast-pair-sub' }, `Ghép đôi ngày ${when}`) : null)),
        h('button', { type: 'button', class: 'btn btn-ghost cast-pair-forget', onclick: () => askForget(p), 'aria-label': `Quên ${p.name}` }, 'Quên')));
    });
  }

  async function reload() {
    if (!loadPairs) { pairs = []; return; }
    try {
      pairs = await loadPairs();
      loadError = '';
    } catch (e) {
      if (pairs === null) pairs = [];
      loadError = (e && e.message) || 'Không tải được danh sách màn hình xe.';
    }
    paint(sender.snapshot());
  }

  function paint(s) {
    const isLive = s.phase === 'live' || s.phase === 'reconnecting';
    const isBusy = BUSY_PHASES.indexOf(s.phase) >= 0;
    const idle = !isLive && !isBusy;
    const havePairs = Array.isArray(pairs) && pairs.length > 0;
    live.hidden = !isLive;
    busy.hidden = !isBusy;
    loading.hidden = !(idle && pairs === null);
    pick.hidden = !(idle && havePairs && !adding);
    form.hidden = !(idle && pairs !== null && (!havePairs || adding));
    backBtn.hidden = !havePairs;
    if (!pick.hidden) drawList();
    busyText1.textContent = busyText(s);
    cancelBtn.hidden = s.phase === 'joining';
    status.textContent = s.phase === 'error' ? s.message : (idle ? loadError : '');
    status.hidden = !status.textContent;
    status.classList.toggle('error', Boolean(status.textContent));
    liveText.textContent = s.phase === 'reconnecting' ? 'Mất kết nối với màn hình xe. Đang nối lại...'
      : `Đang chiếu lên ${s.target && s.target.name ? `"${s.target.name}"` : 'màn hình xe'}`;
    // vừa xong một lượt: tải lại danh sách (có thể vừa ghép đôi thêm xe). Chiếu xong thì về danh sách; nhập sai mã /
    // từ chối quyền thì giữ ô nhập mã để thử lại.
    if (idle && lastPhase !== s.phase && lastPhase !== 'idle' && lastPhase !== 'error') {
      if (lastPhase === 'live' || lastPhase === 'reconnecting') adding = false;
      if (lastPhase !== 'joining') reload();
    }
    lastPhase = s.phase;
  }

  const off = subscribe(paint);
  paint(sender.snapshot());
  if (pairs === null) reload();
  const dlg = openDialog({
    title: 'Chia sẻ màn hình lên xe',
    className: 'cast-dialog',
    focus: 'dialog',
    content: h('div', { class: 'cast-send' }, status, loading, pick, form, busy, live),
    onClose: off,
  });
  // đưa con trỏ vào chỗ cần bấm: ô nhập mã (lần đầu) hoặc màn hình xe dùng gần nhất
  if (!form.hidden) input.focus();
  else if (!pick.hidden) { const first = list.querySelector('.cast-pair-go'); if (first) first.focus(); }
  return dlg;
}
