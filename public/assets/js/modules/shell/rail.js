import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { avatar } from '../../core/avatar.js';

/**
 * Thanh điều hướng dọc phía tài xế (màn hình dọc/điện thoại thì nằm ngang ở dưới):
 * các mục chính, nút đổi sáng/tối và nút Cài đặt (có ảnh đại diện khi đã đăng nhập).
 * items: [{ id, label, icon }]   onSelect(id)   appearance   user   onSettings()
 * onCast(): có thì thêm nút "Chiếu ĐT" (giai đoạn 15: chiếu màn hình điện thoại lên màn hình này; ẩn trên điện thoại).
 */
export function createRail({ items, onSelect, appearance, user, onSettings, onCast = null }) {
  const buttons = {};
  items.forEach((it) => {
    buttons[it.id] = h('button', { type: 'button', class: 'rail-item', 'data-id': it.id, onclick: () => onSelect(it.id) }, icon(it.icon, 28), h('span', {}, it.label));
  });

  const themeBtn = h('button', { type: 'button', class: 'rail-item rail-theme', onclick: () => appearance.toggleTheme() });
  const drawTheme = (v) => {
    const dark = v.theme === 'dark';
    clear(themeBtn);
    themeBtn.append(icon(dark ? 'moon' : 'sun', 28), h('span', {}, dark ? 'Tối' : 'Sáng'));
    themeBtn.setAttribute('aria-label', `Giao diện ${dark ? 'tối' : 'sáng'}. Bấm để đổi sang ${dark ? 'sáng' : 'tối'}`);
    themeBtn.title = `Đổi sang giao diện ${dark ? 'sáng' : 'tối'}`;
  };
  drawTheme(appearance.get());
  const offTheme = appearance.onChange(drawTheme);

  const name = user ? (user.name || user.email) : '';
  const settingsBtn = h('button', { type: 'button', class: 'rail-item rail-settings', 'aria-haspopup': 'dialog', onclick: onSettings,
    'aria-label': user ? `Cài đặt và tài khoản (${name})` : 'Cài đặt và đăng nhập', title: 'Cài đặt' },
    user ? avatar(name) : icon('settings', 28), h('span', {}, 'Cài đặt'));

  const castBtn = onCast ? h('button', { type: 'button', class: 'rail-item rail-cast', 'aria-pressed': 'false', title: 'Chiếu màn hình điện thoại lên màn hình này', onclick: onCast },
    icon('cast', 28), h('span', {}, 'Chiếu ĐT')) : null;

  const el = h('nav', { class: 'rail', 'aria-label': 'Điều hướng chính' },
    h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('car', 24)),
    items.map((it) => buttons[it.id]),
    h('span', { class: 'rail-spacer' }),
    castBtn,
    themeBtn,
    settingsBtn);

  return {
    el,
    setActive(id) {
      Object.keys(buttons).forEach((k) => {
        if (k === id) buttons[k].setAttribute('aria-current', 'page'); else buttons[k].removeAttribute('aria-current');
      });
    },
    setCasting(on) { if (castBtn) castBtn.setAttribute('aria-pressed', String(on === true)); },
    destroy: offTheme,
  };
}
