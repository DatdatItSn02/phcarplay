// Giai đoạn 15: giao diện phía MÀN HÌNH XE của chức năng chiếu màn hình điện thoại.
//  - Hộp ghép nối: mã 6 số thật to, đồng hồ đếm ngược, 3 bước hướng dẫn (2 cách cho hai máy chung mạng).
//  - Khung chiếu (el): chiếm HẲN một bên màn hình (sát mép, cao hết màn hình, không bo góc), toàn bộ ứng dụng nghe nhạc
//    (kể cả thanh mục) dồn sang bên còn lại - giống chia đôi màn hình cho hai ứng dụng. Mặc định bản đồ nằm phía tài xế.
//    Thanh nút: Đổi bên, Vừa khung/Lấp đầy, Chỉ bản đồ, Dừng chiếu.
//    "Lấp đầy" (mặc định): đúng nửa màn hình (kéo vạch chia để đổi), hình phóng kín khung; kéo hình để chọn phần muốn xem.
//    "Vừa khung": thấy trọn màn hình điện thoại, bề rộng theo đúng tỉ lệ máy (không viền đen).
// shell.js đặt el cạnh .app (trong .screen) và nghe onLayout({ active, side, only, stacked }).
import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog } from '../../core/dialog.js';
import { showToast } from '../../core/toast.js';
import { createCastReceiver } from './castReceiver.js';
import { clampShare, coverOverflow, fitColumnWidth, fitRowHeight, formatCode, panBy } from './castProtocol.js';

const PREF_KEY = 'carweb_cast_view2';
const HINT_KEY = 'carweb_cast_pan_hint';
const SLOW_CONNECT_MS = 12000;

const unit = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5; };
function loadPrefs() {
  const d = { side: 'start', mode: 'fill', share: 0.5, panX: 0.5, panY: 0.5 };
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREF_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (raw.side === 'end') d.side = 'end';
      if (raw.mode === 'fit') d.mode = 'fit';
      d.share = clampShare(raw.share);
      d.panX = unit(raw.panX);
      d.panY = unit(raw.panY);
    }
  } catch (e) { /* dùng mặc định */ }
  return d;
}
function savePrefs(p) {
  try { window.localStorage.setItem(PREF_KEY, JSON.stringify({ side: p.side, mode: p.mode, share: p.share, panX: p.panX, panY: p.panY })); } catch (e) { /* không lưu được */ }
}

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function createCastScreen({ castApi, media, onLayout = () => {}, receiverFactory = createCastReceiver }) {
  const prefs = loadPrefs();
  let only = false;            // "Chỉ bản đồ": ẩn phần nhạc
  let frameW = 0;
  let frameH = 0;
  let dialog = null;
  let dialogTimer = null;
  let connectingSince = 0;
  let decoding = false;
  let waiting = null;          // ảnh mới nhất đang chờ giải mã (bỏ ảnh cũ nếu máy giải mã không kịp)
  let destroyed = false;

  // ----- khung chiếu -----
  const canvas = h('canvas', { class: 'cast-canvas', 'aria-label': 'Màn hình điện thoại đang chiếu' });
  const c2d = canvas.getContext('2d');
  const veilText = h('p', {});
  const veil = h('div', { class: 'cast-veil', role: 'status', hidden: true }, h('span', { class: 'cast-spin', 'aria-hidden': 'true' }), veilText);
  const stage = h('div', { class: 'cast-stage' }, canvas, veil);

  const tool = (iconName, label, onclick, cls = '') => h('button', { type: 'button', class: `cast-tool ${cls}`.trim(), 'aria-label': label, title: label, onclick }, icon(iconName, 24), h('span', { class: 'cast-tool-text' }, label));
  const swapBtn = tool('swap', 'Đổi bên', () => { prefs.side = prefs.side === 'start' ? 'end' : 'start'; savePrefs(prefs); apply(); });
  const modeBtn = tool('fitScreen', 'Lấp đầy', () => { prefs.mode = prefs.mode === 'fit' ? 'fill' : 'fit'; savePrefs(prefs); apply(); });
  const onlyBtn = tool('expand', 'Chỉ bản đồ', () => { only = !only; apply(); });
  const playBtn = tool('play', 'Phát', () => media.controller.toggle(), 'cast-play');
  const stopBtn = tool('stop', 'Dừng chiếu', () => stop(true), 'cast-stop');
  const who = h('span', { class: 'cast-who' });
  const bar = h('div', { class: 'cast-bar', role: 'toolbar', 'aria-label': 'Điều khiển chiếu màn hình' }, who, swapBtn, modeBtn, onlyBtn, playBtn, stopBtn);
  const grip = h('div', { class: 'cast-grip', role: 'separator', 'aria-label': 'Kéo để đổi độ rộng khung chiếu', tabindex: '0' });
  const el = h('section', { class: 'cast-pane', 'aria-label': 'Màn hình điện thoại', hidden: true }, stage, bar, grip);

  const setLabel = (btn, iconName, label) => {
    clear(btn);
    btn.append(icon(iconName, 24), h('span', { class: 'cast-tool-text' }, label));
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };

  const receiver = receiverFactory({
    castApi,
    onChange: render,
    onFrame: draw,
    onEnded: (by) => { showToast(by === 'sender' ? 'Điện thoại đã dừng chiếu.' : 'Đã mất kết nối với điện thoại. Hãy ghép nối lại.', 4500); },
  });

  // ----- vẽ ảnh nhận được -----
  function paint(img, w, h2) {
    if (canvas.width !== w || canvas.height !== h2) { canvas.width = w; canvas.height = h2; }
    c2d.drawImage(img, 0, 0, w, h2);
    if (!veil.hidden && receiver.snapshot().phase === 'live') veil.hidden = true;   // ảnh đầu tiên đã tới
    if (w !== frameW || h2 !== frameH) { frameW = w; frameH = h2; apply(); }
  }
  function decode(f) {
    decoding = true;
    const blob = new Blob([f.bytes], { type: 'image/jpeg' });
    const done = () => { decoding = false; if (waiting && !destroyed) { const n = waiting; waiting = null; decode(n); } };
    if (typeof window.createImageBitmap === 'function') {
      window.createImageBitmap(blob).then((bmp) => { if (!destroyed) paint(bmp, bmp.width, bmp.height); if (bmp.close) bmp.close(); }, () => {}).then(done);
      return;
    }
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { if (!destroyed) paint(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); done(); };
    img.onerror = () => { URL.revokeObjectURL(url); done(); };
    img.src = url;
  }
  function draw(f) {
    if (decoding) { waiting = f; return; }
    decode(f);
  }

  // ----- bố cục -----
  function box() {
    const p = el.parentElement;
    if (!p) return { w: 0, h: 0 };
    const cs = getComputedStyle(p);
    const px = (v) => parseFloat(v) || 0;
    // vùng thật sự dành cho nội dung (bỏ phần đệm nếu có)
    return { w: p.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight), h: p.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom) };
  }
  function apply() {
    const live = receiver.isLive();
    el.hidden = !live;
    if (!live) { only = false; onLayout({ active: false, side: prefs.side, only: false, stacked: false }); return; }
    const b = box();
    const stacked = b.h > b.w * 1.15;     // màn hình xe đặt dọc: khung chiếu nằm trên, nhạc nằm dưới
    el.dataset.mode = prefs.mode;
    el.dataset.stacked = stacked ? '1' : '0';
    let basis = '';
    if (!only) {
      const barH = bar.offsetHeight || 48;   // thanh nút nằm dưới hình: trừ ra để hình vừa khít, không viền đen
      if (prefs.mode === 'fit') basis = (stacked ? fitRowHeight(frameW, frameH, b.w, b.h - barH) + barH : fitColumnWidth(frameW, frameH, b.w, b.h - barH)) + 'px';
      else basis = Math.round((stacked ? b.h : b.w) * prefs.share) + 'px';
    }
    el.style.flex = only ? '1 1 auto' : `0 0 ${basis}`;
    canvas.style.objectPosition = prefs.mode === 'fill' ? `${Math.round(prefs.panX * 100)}% ${Math.round(prefs.panY * 100)}%` : '';
    setLabel(modeBtn, prefs.mode === 'fit' ? 'fitScreen' : 'collapse', prefs.mode === 'fit' ? 'Lấp đầy' : 'Vừa khung');
    setLabel(onlyBtn, only ? 'queue' : 'expand', only ? 'Hiện nhạc' : 'Chỉ bản đồ');
    playBtn.hidden = !only;
    grip.hidden = only || prefs.mode !== 'fill';
    onLayout({ active: true, side: prefs.side, only, stacked });
    measure();
  }
  // Sau khi trình duyệt xếp xong: khung đủ rộng thì hiện chữ trên nút; mép kéo nằm ở cạnh giáp phần nhạc.
  function measure() {
    const p = el.parentElement;
    if (!p) return;
    const r = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    el.dataset.wide = r.width >= 600 ? '2' : (r.width >= 340 ? '1' : '0');   // 2: chữ cạnh biểu tượng + tên máy, 1: chữ nhỏ dưới biểu tượng, 0: chỉ biểu tượng
    const over = overflow();
    stage.dataset.pan = over.x > 0 || over.y > 0 ? '1' : '0';
    if (stage.dataset.pan === '1') panHint();
    const stacked = el.dataset.stacked === '1';
    if (stacked) el.dataset.edge = (r.top - pr.top) <= (pr.bottom - r.bottom) ? 'bottom' : 'top';
    else el.dataset.edge = (r.left - pr.left) <= (pr.right - r.right) ? 'right' : 'left';
  }
  // "Lấp đầy": hình bị thừa bao nhiêu px mỗi chiều (kéo hình trong phạm vi đó)
  function overflow() {
    if (prefs.mode !== 'fill' || !frameW) return { x: 0, y: 0 };
    return coverOverflow(frameW, frameH, stage.clientWidth, stage.clientHeight);
  }
  let hinted = false;
  function panHint() {
    if (hinted) return;
    hinted = true;
    try { if (window.localStorage.getItem(HINT_KEY) === '1') return; window.localStorage.setItem(HINT_KEY, '1'); } catch (e) { /* vẫn nhắc một lần trong phiên này */ }
    showToast('Kéo hình để chọn phần bản đồ muốn xem. Bấm "Vừa khung" để thấy trọn màn hình điện thoại.', 7000);
  }
  // kéo hình (chỉ khi "Lấp đầy" và hình đang bị cắt)
  stage.addEventListener('pointerdown', (e) => {
    const over = overflow();
    if (!(over.x > 0 || over.y > 0) || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* trình duyệt cũ */ }
    let lastX = e.clientX;
    let lastY = e.clientY;
    stage.dataset.dragging = '1';
    const move = (ev) => {
      const o = overflow();
      prefs.panX = panBy(prefs.panX, ev.clientX - lastX, o.x);
      prefs.panY = panBy(prefs.panY, ev.clientY - lastY, o.y);
      lastX = ev.clientX;
      lastY = ev.clientY;
      canvas.style.objectPosition = `${(prefs.panX * 100).toFixed(1)}% ${(prefs.panY * 100).toFixed(1)}%`;
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      delete stage.dataset.dragging;
      savePrefs(prefs);
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });

  const onResize = () => { if (receiver.isLive()) apply(); };
  window.addEventListener('resize', onResize);

  // kéo mép khung chiếu (chỉ ở chế độ "Lấp đầy")
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* trình duyệt cũ */ }
    const move = (ev) => {
      const p = el.parentElement.getBoundingClientRect();
      const stacked = el.dataset.stacked === '1';
      const raw = stacked ? (ev.clientY - p.top) / p.height : (ev.clientX - p.left) / p.width;
      const first = el.dataset.edge === 'right' || el.dataset.edge === 'bottom';   // khung chiếu nằm trước (trái / trên)
      prefs.share = clampShare(first ? raw : 1 - raw);
      apply();
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); savePrefs(prefs); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -0.03 : (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.03 : 0);
    if (!d) return;
    e.preventDefault();
    prefs.share = clampShare(prefs.share + (el.dataset.edge === 'left' || el.dataset.edge === 'top' ? -d : d));
    savePrefs(prefs);
    apply();
  });

  const offMedia = media.onState((s) => {
    const playing = s.status === 'playing';
    setLabel(playBtn, playing ? 'pause' : 'play', playing ? 'Tạm dừng' : 'Phát');
  });

  // ----- hộp ghép nối -----
  function closeDialog() {
    clearInterval(dialogTimer);
    dialogTimer = null;
    const d = dialog;
    dialog = null;
    if (d) d.close();
  }
  function openPairDialog() {
    if (dialog) return;
    const codeEl = h('div', { class: 'cast-code', 'aria-live': 'polite' });
    const timerEl = h('p', { class: 'cast-code-timer' });
    const noticeEl = h('p', { class: 'cast-notice', role: 'status' });
    const statusEl = h('p', { class: 'cast-status', role: 'status' });
    const renewBtn = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => receiver.renew() }, 'Lấy mã mới');
    const steps = h('ol', { class: 'cast-steps' },
      h('li', {}, h('strong', {}, 'Cho hai máy chung mạng'), ' bằng 1 trong 2 cách:',
        h('div', { class: 'cast-ways' },
          h('div', { class: 'cast-way' }, icon('usb', 26), h('span', {}, h('b', {}, 'Cắm dây (Android): '), 'nối điện thoại với màn hình xe, trên điện thoại bật Cài đặt > Điểm phát sóng và chia sẻ kết nối > Chia sẻ kết nối qua USB.')),
          h('div', { class: 'cast-way' }, icon('wifi', 26), h('span', {}, h('b', {}, 'Wi-Fi: '), 'bật Điểm phát sóng Wi-Fi trên điện thoại, cho màn hình xe vào Wi-Fi đó.')))),
      h('li', {}, 'Trên điện thoại mở ứng dụng ', h('strong', {}, 'PH Car Play'), ' > Cài đặt > ', h('strong', {}, 'Chiếu lên màn hình xe'), '.'),
      h('li', {}, 'Nhập mã ở trên. Màn hình này sẽ tự chia đôi: bản đồ một bên, nhạc một bên.'));
    const body = h('div', { class: 'cast-pair' },
      noticeEl, codeEl, timerEl, statusEl, steps,
      h('p', { class: 'hint' }, 'Hiện chỉ điện thoại Android chiếu được. Hình đi thẳng giữa hai máy, không qua máy chủ.'),
      h('div', { class: 'dialog-actions' }, renewBtn));
    const paint = (s) => {
      noticeEl.textContent = s.notice || '';
      noticeEl.hidden = !s.notice;
      const showCode = s.phase === 'code';
      codeEl.hidden = !(showCode || s.phase === 'loading');
      codeEl.textContent = showCode ? formatCode(s.code) : '··· ···';
      codeEl.setAttribute('aria-label', showCode ? `Mã ghép nối: ${s.code.split('').join(' ')}` : 'Đang lấy mã');
      timerEl.hidden = !showCode;
      steps.hidden = s.phase === 'connecting';
      renewBtn.hidden = s.phase === 'loading';
      if (s.phase === 'error') statusEl.textContent = s.message;
      else if (s.phase === 'connecting') {
        const slow = connectingSince && Date.now() - connectingSince > SLOW_CONNECT_MS;
        statusEl.textContent = `${s.deviceName ? `"${s.deviceName}"` : 'Điện thoại'} đã nhập mã. Đang nối...`
          + (slow ? ' Chưa nối được: hãy kiểm tra hai máy có đang chung mạng không (cắm dây + chia sẻ kết nối qua USB, hoặc cùng Wi-Fi phát từ điện thoại).' : '');
      } else statusEl.textContent = '';
      statusEl.hidden = !statusEl.textContent;
      statusEl.classList.toggle('error', s.phase === 'error');
      if (showCode) timerEl.textContent = `Mã còn hiệu lực ${mmss(s.codeExpiresAt - Date.now())}`;
    };
    dialog = openDialog({
      title: 'Chiếu điện thoại lên màn hình này',
      className: 'cast-dialog',
      focus: 'dialog',
      content: body,
      onClose: () => {
        clearInterval(dialogTimer);
        dialogTimer = null;
        dialog = null;
        if (!receiver.isLive()) receiver.stop();   // đóng hộp khi chưa nối xong = hủy ghép nối
      },
    });
    dialog.paint = paint;
    paint(receiver.snapshot());
    dialogTimer = setInterval(() => { if (dialog) paint(receiver.snapshot()); }, 1000);
  }

  function render(s) {
    if (destroyed) return;
    if (s.phase === 'connecting') { if (!connectingSince) connectingSince = Date.now(); } else connectingSince = 0;
    if (s.phase === 'live' || s.phase === 'reconnecting') {
      closeDialog();
      who.textContent = `Đang chiếu: ${s.deviceName || 'điện thoại'}`;
      veil.hidden = s.phase !== 'reconnecting' && s.frames > 0;
      veilText.textContent = s.phase === 'reconnecting' ? 'Mất kết nối với điện thoại. Đang nối lại...' : 'Đã nối. Đang chờ hình từ điện thoại...';
    } else if (s.phase === 'off') {
      closeDialog();
      frameW = 0;
      frameH = 0;
      c2d.clearRect(0, 0, canvas.width, canvas.height);
    } else if (dialog && dialog.paint) dialog.paint(s);
    apply();
  }

  function stop(byUser) {
    receiver.stop();
    if (byUser) showToast('Đã dừng chiếu.');
  }

  return {
    el,
    /** Bấm nút "Chiếu ĐT": chưa chiếu thì mở hộp ghép nối. Trả về false nếu đang chiếu rồi. */
    open() {
      if (receiver.isLive()) return false;
      if (typeof window.RTCPeerConnection !== 'function') { showToast('Trình duyệt này chưa hỗ trợ nhận hình chiếu.', 4500); return false; }
      openPairDialog();
      if (!receiver.isActive() || receiver.snapshot().phase === 'error') receiver.open();
      return true;
    },
    stop: () => stop(false),
    isLive: () => receiver.isLive(),
    /** Đang "Chỉ bản đồ" thì hiện lại phần nhạc (nút Quay lại của ứng dụng). Trả về true nếu đã xử lý. */
    showMusic() { if (!only) return false; only = false; apply(); return true; },
    relayout: () => { if (receiver.isLive()) apply(); },
    destroy() {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      if (offMedia) offMedia();
      closeDialog();
      receiver.stop();
    },
  };
}
