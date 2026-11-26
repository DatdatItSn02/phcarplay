import { createApi } from './core/api.js';
import { createStore } from './core/store.js';
import { createSessionWatcher } from './core/sessionWatcher.js';
import { createAuthApi } from './modules/auth/authApi.js';
import { mountAuth } from './modules/auth/authView.js';
import { mountShell } from './modules/shell/shell.js';
import { createAppearance } from './core/appearance.js';
import { createNativeBridge } from './core/nativeApp.js';
// Nhập cả module (không nhập tên lẻ) để trình duyệt còn giữ bản dialog.js cũ trong bộ nhớ đệm không làm hỏng cả trang.
import * as dialogs from './core/dialog.js';

const boot = JSON.parse(document.getElementById('boot').textContent);
// Giai đoạn 13: chạy trong ứng dụng Android/iOS (mobile/) thì nối với ứng dụng; trình duyệt thường thì không làm gì.
const nativeApp = createNativeBridge({ closeDialog: () => (typeof dialogs.closeTopDialog === 'function' ? dialogs.closeTopDialog() : false) });
nativeApp.install();
const root = document.getElementById('app');
const appearance = createAppearance();   // sáng/tối, cỡ chữ, vị trí thanh điều hướng (nhớ theo thiết bị)
const REPLACED_MSG = 'Tài khoản của bạn vừa đăng nhập trên thiết bị khác nên thiết bị này đã đăng xuất.';
const ENDED_MSG = 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.';
const api = createApi({ baseUrl: boot.apiBase, onSessionReplaced: () => handleLoggedOut(null, REPLACED_MSG) });
const authApi = createAuthApi(api);

const GUEST_KEY = 'carweb_guest';
const readGuest = () => { try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; } };
const writeGuest = (on) => { try { if (on) localStorage.setItem(GUEST_KEY, '1'); else localStorage.removeItem(GUEST_KEY); } catch (e) { /* bỏ qua */ } };

const store = createStore({ session: null, guestMode: readGuest(), notice: null });

// Máy chủ báo không còn đăng nhập ở thiết bị này (đã đăng nhập nơi khác, bị khóa, hết phiên).
function handleLoggedOut(payload, message) {
  const current = store.get().session;
  if (!current || !current.user) return;   // đã ở trạng thái đăng xuất, tránh lặp
  store.set({
    session: payload || { ...current, user: null, guest: true, plan: 'guest' },
    guestMode: false,
    notice: message,
  });
}

function resetTokenFromUrl() {
  const path = location.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/reset-password')) return null;
  return new URLSearchParams(location.search).get('token') || '';
}

// Xong việc đặt mật khẩu: bỏ token khỏi địa chỉ rồi dựng lại màn hình (lúc này là màn hình đăng nhập thật, đăng nhập xong mới vào được ứng dụng).
function finishReset() {
  history.replaceState(null, '', (boot.basePath || '') + '/');
  render();
}

let unmount = null;   // hàm dọn dẹp của khung ứng dụng đang hiển thị (dừng nhạc khi dựng lại)

function render() {
  if (unmount) { unmount(); unmount = null; }
  const { session, guestMode } = store.get();
  const token = resetTokenFromUrl();

  if (token !== null) {
    mountAuth(root, {
      authApi, appName: boot.appName, appearance, initialMode: token ? 'reset' : 'forgot', resetToken: token, notice: null,
      onResetDone: finishReset, onAuthed: () => {}, onGuest: () => {},
    });
    return;
  }
  if (session.user || guestMode) {
    unmount = mountShell(root, {
      appName: boot.appName, session, api, appearance, homeChips: boot.homeChips, hlsJs: boot.hlsJs, youtubeEmbed: boot.youtube || null, nativeApp,
      onLogin: () => { writeGuest(false); store.set({ guestMode: false }); },
      onLogout: async () => {
        await authApi.logout();
        store.set({ session: { ...(await api.init()) }, guestMode: false });
      },
    });
    return;
  }
  mountAuth(root, {
    authApi, appName: boot.appName, appearance, initialMode: 'login', notice: store.get().notice,
    onAuthed: (data) => { writeGuest(false); store.set({ session: data, guestMode: false, notice: null }); },
    onGuest: () => { writeGuest(true); store.set({ guestMode: true }); },
    onResetDone: () => {},
  });
}

async function start() {
  try {
    const session = await api.init();
    store.set({ session, notice: session.replaced ? REPLACED_MSG : null });
  } catch (err) {
    root.textContent = '';
    const box = document.createElement('div');
    box.className = 'fatal';
    const p = document.createElement('p');
    p.textContent = err.message || 'Không tải được ứng dụng.';
    const b = document.createElement('button');
    b.className = 'btn btn-primary';
    b.textContent = 'Thử lại';
    b.addEventListener('click', () => location.reload());
    box.append(p, b);
    root.append(box);
    return;
  }
  store.subscribe(render);
  render();
  createSessionWatcher({
    check: () => api.init(),
    hasUser: () => Boolean(store.get().session && store.get().session.user),
    onLoggedOut: (payload) => handleLoggedOut(payload, payload.replaced ? REPLACED_MSG : ENDED_MSG),
  }).start();
}

start();
