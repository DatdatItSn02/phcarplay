import { createApi } from '../core/api.js';
import { createStore } from '../core/store.js';
import { createSessionWatcher } from '../core/sessionWatcher.js';
import { createAppearance } from '../core/appearance.js';
import { createAdminApi } from './adminApi.js';
import { mountAdminAuth } from './authView.js';
import { mountForcedPassword } from './forcedPasswordView.js';
import { mountAdminShell } from './shell.js';

const boot = JSON.parse(document.getElementById('boot').textContent);
const root = document.getElementById('app');
const base = boot.basePath || '';
const ENDED_MSG = 'Phiên đăng nhập quản trị đã kết thúc (hết hạn, mật khẩu đã đổi hoặc tài khoản bị khóa). Vui lòng đăng nhập lại.';

const appearance = createAppearance();   // sáng/tối dùng chung với trang người dùng (nhớ theo thiết bị)
const api = createApi({ baseUrl: boot.apiBase });
const adminApi = createAdminApi(api, {
  onUnauthorized: () => handleLoggedOut(ENDED_MSG),
  onPasswordChangeRequired: () => { refreshSession(); },
});
const store = createStore({ session: null, notice: null });

// Máy chủ báo không còn đăng nhập (hết phiên, bị khóa, mật khẩu đổi ở nơi khác).
function handleLoggedOut(message) {
  const current = store.get().session;
  if (!current || !current.admin) return;
  store.set({ session: { ...current, admin: null }, notice: message });
}

async function refreshSession() {
  try {
    const session = await adminApi.me();
    store.set({ session });
  } catch (e) {
    /* mất mạng: giữ nguyên, lần sau thử lại */
  }
}

function resetTokenFromUrl() {
  const path = location.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/admin/reset-password')) return null;
  return new URLSearchParams(location.search).get('token') || '';
}

// Xong việc đặt mật khẩu: bỏ token khỏi địa chỉ rồi dựng lại màn hình (lúc này là màn hình đăng nhập thật).
function finishReset() {
  history.replaceState(null, '', base + '/admin');
  render();
}

async function logout() {
  try { await adminApi.logout(); } catch (e) { /* phiên đã mất cũng không sao */ }
  history.replaceState(null, '', base + '/admin');
  await refreshSession();
  store.set({ notice: null });
}

let unmount = null;

function render() {
  if (unmount) { unmount(); unmount = null; }
  const { session, notice } = store.get();
  const token = resetTokenFromUrl();

  if (token !== null) {
    mountAdminAuth(root, {
      adminApi, appName: boot.appName, appearance, initialMode: token ? 'reset' : 'forgot', resetToken: token, notice: null,
      onResetDone: finishReset, onAuthed: () => {},
    });
    return;
  }
  const admin = session.admin;
  if (!admin) {
    mountAdminAuth(root, {
      adminApi, appName: boot.appName, appearance, initialMode: 'login', notice,
      onAuthed: (data) => store.set({ session: data, notice: null }),
      onResetDone: () => {},
    });
    return;
  }
  if (admin.must_change_password) {
    mountForcedPassword(root, {
      appName: boot.appName, appearance, admin, adminApi, onLogout: logout,
      onChanged: (payload) => store.set({ session: payload }),
    });
    return;
  }
  unmount = mountAdminShell(root, {
    appName: boot.appName, appearance, admin, adminApi, basePath: base, onLogout: logout,
    onProfileChanged: (view) => store.set({ session: { ...store.get().session, admin: view } }),
    onPasswordChanged: (payload) => store.set({ session: payload }),
  });
}

async function start() {
  try {
    const session = await adminApi.me();
    store.set({ session });
  } catch (err) {
    root.textContent = '';
    const box = document.createElement('div');
    box.className = 'fatal';
    const p = document.createElement('p');
    p.textContent = err.message || 'Không tải được trang quản trị.';
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
  // Hỏi máy chủ định kỳ để biết tài khoản có bị khóa/đổi mật khẩu ở nơi khác không (sessionWatcher đọc trường "user").
  createSessionWatcher({
    check: async () => { const d = await adminApi.me(); return { user: d.admin }; },
    hasUser: () => Boolean(store.get().session && store.get().session.admin),
    onLoggedOut: () => handleLoggedOut(ENDED_MSG),
  }).start();
}

start();
