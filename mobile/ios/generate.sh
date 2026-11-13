#!/bin/sh
# Sinh dự án Xcode cho vỏ ứng dụng iOS từ ../config/app.json.
# Cần máy Mac có Xcode và XcodeGen (cài bằng: brew install xcodegen). Chạy lại mỗi khi sửa app.json.
set -eu
cd "$(dirname "$0")"
CFG=../config/app.json
if [ ! -f "$CFG" ]; then
  echo "LỖI: không thấy $CFG"; exit 1
fi
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "LỖI: chưa có XcodeGen. Cài bằng lệnh: brew install xcodegen"; exit 1
fi

# Đọc app.json: python3 (có sẵn khi đã cài Xcode), nếu không có thì dùng plutil + PlistBuddy của macOS.
read_cfg() {
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import json' >/dev/null 2>&1; then
    python3 -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for k in ("appName", "appId", "versionName", "versionCode", "webUrl"):
    v = d.get(k, "")
    print(("" if v is None else str(v)).replace("\n", " ").strip())
' "$CFG"
  else
    TMP=$(mktemp "${TMPDIR:-/tmp}/phcarplay.XXXXXX")
    if ! plutil -convert xml1 -o "$TMP" "$CFG"; then rm -f "$TMP"; return 1; fi
    for k in appName appId versionName versionCode webUrl; do
      /usr/libexec/PlistBuddy -c "Print :$k" "$TMP" 2>/dev/null || echo ""
    done
    rm -f "$TMP"
  fi
}
if ! VALUES=$(read_cfg 2>/dev/null); then
  echo "LỖI: $CFG sai cú pháp JSON (thiếu dấu phẩy, dấu ngoặc kép, hoặc thừa dấu phẩy cuối?)"; exit 1
fi
line() { printf '%s\n' "$VALUES" | sed -n "$1p"; }
APP_NAME=$(line 1)
APP_ID=$(line 2)
VERSION=$(line 3)
BUILD=$(line 4)
URL=$(line 5)

if ! printf '%s' "$APP_ID" | grep -Eq '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$'; then
  echo "LỖI: appId \"$APP_ID\" không hợp lệ: chỉ dùng chữ thường không dấu, chữ số và dấu chấm, ví dụ com.tencuaban.carplay"; exit 1
fi
case "$APP_NAME" in
  ""|*[\$\&\<\>\"\'\\/]*)
    echo "LỖI: appName \"$APP_NAME\" không hợp lệ (không để trống, không dùng các ký tự \$ & < > \" ' \\ /)"; exit 1;;
esac
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+(\.[0-9]+){0,2}$'; then
  echo "LỖI: versionName \"$VERSION\" không hợp lệ: dạng số như 1.0.0 (tối đa 3 số)"; exit 1
fi
if ! printf '%s' "$BUILD" | grep -Eq '^[1-9][0-9]{0,8}$'; then
  echo "LỖI: versionCode \"$BUILD\" không hợp lệ: số nguyên từ 1 trở lên"; exit 1
fi
case "$URL" in
  *.example*|"") echo "CHÚ Ý: webUrl trong $CFG chưa phải địa chỉ website thật ($URL). Ứng dụng sẽ báo \"Chưa cài địa chỉ website\".";;
esac

cat > Config.xcconfig <<XCCONFIG
// Sinh tự động bởi generate.sh từ ../config/app.json - đừng sửa tay.
APP_BUNDLE_ID = $APP_ID
APP_DISPLAY_NAME = $APP_NAME
APP_VERSION = $VERSION
APP_BUILD = $BUILD
XCCONFIG

xcodegen generate --spec project.yml
echo ""
echo "Xong. Mở PHCarPlay.xcodeproj bằng Xcode (lệnh: open PHCarPlay.xcodeproj)."
