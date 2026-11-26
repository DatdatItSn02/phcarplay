import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { avatar } from '../../core/avatar.js';
import { openDialog, confirmAction } from '../../core/dialog.js';
import { showToast } from '../../core/toast.js';
import { THEME_LABELS } from '../../core/appearance.js';
import { openAccountDialog, describePlan } from '../account/accountDialog.js';
import { openSecurityDialog } from '../account/securityDialog.js';
import { createAuthApi } from '../auth/authApi.js';
import { youtubeKeySection } from './youtubeKeySection.js';

// Các bố cục chọn sẵn: hình minh họa thay cho chữ "70/30".
export const LAYOUTS = [
  { id: 'video', label: 'Video lớn', ratio: 0.7, pic: [7, 3] },
  { id: 'even', label: 'Chia đều', ratio: 0.5, pic: [5, 5] },
  { id: 'list', label: 'Danh sách lớn', ratio: 0.3, pic: [3, 7] },
  { id: 'only-video', label: 'Chỉ video', focus: 'left', pic: [10, 0] },
  { id: 'only-list', label: 'Chỉ danh sách', focus: 'right', pic: [0, 10] },
];

/** Bố cục đang dùng ứng với ô nào (để đánh dấu). snapshot: { ratio, focus } của khung chia. */
export function currentLayoutId(snapshot) {
  if (snapshot.focus === 'left') return 'only-video';
  if (snapshot.focus === 'right') return 'only-list';
  const hit = LAYOUTS.find((l) => l.ratio && Math.abs(l.ratio - snapshot.ratio) < 0.02);
  return hit ? hit.id : '';
}

function choiceGroup(label, options, getValue, onPick) {
  const group = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': label });
  function draw() {
    clear(group);
    const value = getValue();
    options.forEach((o) => group.append(h('button', {
      type: 'button', role: 'radio', class: 'choice', 'aria-checked': String(o.value === value),
      onclick: () => { onPick(o.value); draw(); },
    }, o.visual || null, h('span', {}, o.label), o.note ? h('small', {}, o.note) : null)));
  }
  draw();
  return { el: group, draw };
}

function section(title, iconName, ...body) {
  return h('section', { class: 'set-section' }, h('h3', { class: 'set-title' }, icon(iconName, 20), title), body);
}

/**
 * Cài đặt (một bảng lớn): tài khoản và key, giao diện sáng/tối, cỡ chữ, vị trí thanh điều hướng, bố cục màn hình.
 * Mọi thay đổi áp dụng ngay, không cần bấm Lưu. Cài đặt hiển thị nhớ theo từng thiết bị.
 * ctx: { session, api, appearance, split (createSplitView), canLayout, onLogin, onLogout }
 */
export function openSettings(ctx) {
  const { session, appearance } = ctx;
  const user = session.user;

  // ----- tài khoản -----
  let account;
  if (user) {
    const name = user.name || user.email;
    // Giai đoạn 14: số điện thoại đăng nhập; tài khoản cũ chưa có số thì nhắc thêm
    const phoneLine = h('span', { class: 'account-phone' });
    const paintPhone = (p) => {
      phoneLine.textContent = p ? 'SĐT: ' + p : 'Chưa có số điện thoại - thêm để đăng nhập nhanh hơn';
      phoneLine.classList.toggle('missing', !p);
    };
    paintPhone(user.phone);
    const plan = h('p', { class: 'account-plan' }, describePlan({ plan: session.plan, expires_at: user.expires_at || session.expires_at || null }));
    account = section('Tài khoản', 'person',
      h('div', { class: 'account-card' }, avatar(name), h('div', { class: 'account-text' }, h('strong', {}, name), h('span', {}, user.email), phoneLine)),
      plan,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: () => openAccountDialog({ api: ctx.api, session, onChange: (info) => { plan.textContent = describePlan(info); } }) }, icon('key'), 'Nhập key kích hoạt'),
        h('button', { type: 'button', class: 'btn', onclick: () => openSecurityDialog({ authApi: createAuthApi(ctx.api), session, onPhone: paintPhone }) }, icon('phone'), 'Số điện thoại đăng nhập'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dlg.close(); ctx.onLogout(); } }, icon('logout'), 'Đăng xuất')));
  } else {
    account = section('Tài khoản', 'person',
      h('div', { class: 'account-card' }, h('span', { class: 'avatar', style: 'background:#606060' }, icon('person', 24)),
        h('div', { class: 'account-text' }, h('strong', {}, 'Đang dùng thử'), h('span', {}, 'Playlist chỉ lưu trên thiết bị này'))),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { dlg.close(); ctx.onLogin(); } }, icon('login'), 'Đăng nhập hoặc tạo tài khoản')));
  }

  // ----- giao diện -----
  const theme = choiceGroup('Giao diện', [
    { value: 'auto', label: THEME_LABELS.auto, note: 'Theo cài đặt máy', visual: icon('autoMode', 26) },
    { value: 'light', label: THEME_LABELS.light, visual: icon('sun', 26) },
    { value: 'dark', label: THEME_LABELS.dark, visual: icon('moon', 26) },
    { value: 'time', label: THEME_LABELS.time, note: 'Tối từ 18h đến 6h', visual: icon('clock', 26) },
  ], () => appearance.get().mode, (v) => appearance.setTheme(v));

  const text = choiceGroup('Cỡ chữ', [
    { value: 'normal', label: 'Bình thường', visual: h('span', { style: 'font-size:1.125rem;font-weight:700' }, 'Aa') },
    { value: 'large', label: 'Lớn', note: 'Dễ đọc khi ngồi xa màn hình', visual: h('span', { style: 'font-size:1.5rem;font-weight:700' }, 'Aa') },
  ], () => appearance.get().text, (v) => appearance.setText(v));

  const rail = choiceGroup('Vị trí thanh điều hướng', [
    { value: 'left', label: 'Bên trái', note: 'Xe tay lái bên trái', visual: h('span', { class: 'layout-pic' }, h('i', { style: 'flex:2' }), h('i', { class: 'dim', style: 'flex:8' })) },
    { value: 'right', label: 'Bên phải', note: 'Xe tay lái bên phải', visual: h('span', { class: 'layout-pic' }, h('i', { class: 'dim', style: 'flex:8' }), h('i', { style: 'flex:2' })) },
  ], () => appearance.get().rail, (v) => appearance.setRail(v));

  let layout = null;
  if (ctx.split && ctx.canLayout) {
    const c = ctx.split.controller;
    layout = choiceGroup('Bố cục màn hình', LAYOUTS.map((l) => ({
      value: l.id,
      label: l.label,
      visual: h('span', { class: 'layout-pic' },
        l.pic[0] ? h('i', { style: `flex:${l.pic[0]}` }) : null,
        l.pic[1] ? h('i', { class: 'dim', style: `flex:${l.pic[1]}` }) : null),
    })), () => currentLayoutId(c.snapshot()), (id) => {
      const l = LAYOUTS.find((x) => x.id === id);
      if (l.focus) { c.setFocus(l.focus); return; }
      c.setFocus(null);
      c.setRatio(l.ratio);
    });
  }

  // Giai đoạn 11: xóa danh sách "bài bạn hay nghe" (chỉ đưa số lượt về 0, không xóa dữ liệu).
  const playsSection = ctx.playStats ? section('Bài bạn hay nghe', 'history',
    h('p', { class: 'hint' }, user
      ? 'Bài bạn nghe từ 2 lần trở lên được đưa lên đầu tab "Tất cả" ở Trang chủ (tối đa 20 bài). Lưu theo tài khoản của bạn.'
      : 'Bài bạn nghe từ 2 lần trở lên được đưa lên đầu tab "Tất cả" ở Trang chủ (tối đa 20 bài). Chỉ lưu trên thiết bị này.'),
    h('div', { class: 'btn-row' }, h('button', {
      type: 'button', class: 'btn btn-ghost',
      onclick: async () => {
        const ok = await confirmAction({ title: 'Xóa danh sách hay nghe?', message: 'Tab "Tất cả" sẽ chỉ còn bài gợi ý cho tới khi bạn nghe lại nhiều lần.', confirmLabel: 'Xóa danh sách', danger: true });
        if (!ok) return;
        try { await ctx.playStats.clear(); showToast('Đã xóa danh sách hay nghe.'); if (ctx.onPlaysCleared) ctx.onPlaysCleared(); } catch (e) { showToast((e && e.message) || 'Chưa xóa được.'); }
      },
    }, icon('trash'), 'Xóa danh sách hay nghe'))) : null;

  // Giai đoạn 15: phát trong nền - chỉ có trong ứng dụng Android/iOS (ctx.background do shell.js đưa vào).
  let bgSection = null;
  if (ctx.background) {
    if (ctx.background.supported) {
      const bg = choiceGroup('Phát trong nền', [
        { value: 'on', label: 'Bật', note: 'Nhạc vẫn phát khi mở ứng dụng khác hoặc tắt màn hình', visual: icon('music', 26) },
        { value: 'off', label: 'Tắt', note: 'Rời ứng dụng thì dừng, mở lại thì phát tiếp', visual: icon('pause', 26) },
      ], () => (ctx.background.get() ? 'on' : 'off'), (v) => ctx.background.set(v === 'on'));
      bgSection = section('Phát trong nền', 'music', bg.el,
        h('p', { class: 'hint' }, 'Khi máy chủ video chính hỏng, bài được phát bằng trình phát của YouTube: những bài đó vẫn dừng khi rời ứng dụng (YouTube không cho phát ở nền).'));
    } else {
      bgSection = section('Phát trong nền', 'music',
        h('p', { class: 'hint' }, 'Bản ứng dụng đang cài chưa nghe được nhạc trong nền. Hãy cài bản ứng dụng mới (từ 1.1.0).'));
    }
    bgSection.id = 'set-background';
  }

  // Giai đoạn 15 (đợt 2): chiếu màn hình điện thoại này lên màn hình xe - chỉ có trong ứng dụng Android từ bản 1.2.0.
  let castSection = null;
  if (ctx.cast) {
    const on = ctx.cast.isActive();
    castSection = section('Chiếu lên màn hình xe', 'cast',
      h('p', { class: 'hint' }, 'Hiện màn hình điện thoại này (ví dụ bản đồ) lên một bên màn hình xe, bên còn lại vẫn nghe nhạc.'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { dlg.close(); ctx.cast.open(); } }, icon('cast', 22), on ? 'Đang chiếu - xem hoặc dừng' : 'Chiếu lên màn hình xe'));
    castSection.id = 'set-cast';
  }

  const keySection = user && ctx.api ? section('Khóa YouTube API của bạn', 'key', youtubeKeySection({ api: ctx.api })) : null;
  if (keySection) keySection.id = 'set-ykey';

  const dlg = openDialog({
    title: 'Cài đặt',
    className: 'settings',
    focus: 'first',
    content: h('div', { class: 'form' },
      account,
      keySection,
      playsSection,
      castSection,
      bgSection,
      section('Giao diện', 'autoMode', theme.el),
      section('Cỡ chữ', 'textSize', text.el),
      section('Vị trí thanh điều hướng', 'swap', rail.el),
      layout ? section('Bố cục màn hình', 'dashboard', layout.el, h('p', { class: 'hint' }, 'Có thể kéo thanh giữa hai khung để chỉnh tỉ lệ. Cài đặt hiển thị được nhớ riêng trên từng thiết bị.')) : null),
  });
  // Mở từ dòng nhắc "Thêm khóa": cuộn tới mục khóa.
  if (ctx.focusKey && keySection) {
    setTimeout(() => { try { keySection.scrollIntoView({ block: 'start' }); } catch (e) { /* bỏ qua */ } }, 0);
  }
  return dlg;
}
