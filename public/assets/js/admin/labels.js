// Tên hiển thị của các hành động trong nhật ký. Hành động lạ (thêm sau này) thì hiện nguyên mã.
const ACTIONS = {
  'admin.login': 'Đăng nhập quản trị',
  'admin.login_failed': 'Đăng nhập quản trị sai mật khẩu',
  'admin.login_locked': 'Tạm chặn đăng nhập quản trị (sai nhiều lần)',
  'admin.login_failed_many': 'Đăng nhập quản trị sai nhiều lần liên tiếp',
  'admin.create': 'Tạo quản trị viên',
  'admin.update': 'Sửa quản trị viên',
  'admin.password_set': 'Đặt mật khẩu tạm cho quản trị viên',
  'admin.password_change': 'Quản trị viên đổi mật khẩu',
  'admin.password_forgot': 'Quản trị viên yêu cầu đặt lại mật khẩu',
  'admin.password_reset': 'Quản trị viên đặt lại mật khẩu',
  'admin.delete': 'Xóa quản trị viên',
  'user.update': 'Sửa người dùng',
  'user.extend': 'Gia hạn người dùng',
  'user.password_set': 'Đặt mật khẩu người dùng',
  'user.reset_sent': 'Gửi thư đặt lại mật khẩu',
  'user.logout_device': 'Đăng xuất thiết bị người dùng',
  'user.delete': 'Xóa người dùng',
  'key.create': 'Tạo key',
  'key.revoke': 'Thu hồi key',
  'key.delete': 'Xóa key',
  'key.bulk_revoke': 'Thu hồi nhiều key',
  'key.bulk_delete': 'Xóa nhiều key',
  'playlist.delete': 'Xóa playlist',
  'mail.test': 'Gửi thư thử',
};

export function actionLabel(action) {
  return Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : action;
}

const TARGETS = { admin: 'Quản trị viên', user: 'Người dùng', key: 'Key', playlist: 'Playlist', mail: 'Gửi email' };

export function targetLabel(type, id) {
  if (!type) return '';
  const name = Object.prototype.hasOwnProperty.call(TARGETS, type) ? TARGETS[type] : type;
  return id ? `${name} #${id}` : name;
}
