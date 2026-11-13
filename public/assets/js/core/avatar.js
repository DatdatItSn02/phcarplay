import { h } from './dom.js';

// Ảnh đại diện bằng chữ cái đầu (như YouTube khi chưa có ảnh): màu cố định theo tên để mỗi người/kênh một màu.
const COLORS = ['#c2185b', '#7b1fa2', '#512da8', '#1976d2', '#0277bd', '#00796b', '#2e7d32', '#ef6c00', '#d84315', '#5d4037', '#455a64'];

export function avatarColor(name) {
  const s = String(name || '');
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 100003;
  return COLORS[n % COLORS.length];
}

export function initial(name) {
  const s = String(name || '').trim();
  return s ? Array.from(s)[0] : '?';
}

export function avatar(name, cls = '') {
  return h('span', { class: `avatar ${cls}`.trim(), 'aria-hidden': 'true', style: `background:${avatarColor(name)}` }, initial(name));
}
