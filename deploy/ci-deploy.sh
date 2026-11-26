#!/usr/bin/env bash
# PH Car Play - phần chạy trên máy của GITHUB khi tự cập nhật website lên alwaysdata (giai đoạn 17).
# Gọi từ .github/workflows/deploy-alwaysdata.yml. Thử tay (trên máy có ssh, git, curl):
#   SSH_KEY="$(cat khoa-rieng)" SSH_HOST=ssh-ten.alwaysdata.net SSH_USER=ten SITE_URL=https://ten.alwaysdata.net \
#   MODE=check bash deploy/ci-deploy.sh
#
# Biến môi trường:
#   SSH_KEY     khóa riêng (nội dung file, gồm dòng BEGIN/END). Trống -> bỏ qua, không báo lỗi (chưa cài đặt xong).
#   SSH_HOST, SSH_PORT (22), SSH_USER, SITE_URL (địa chỉ website, để kiểm tra sau khi cập nhật)
#   MODE        deploy (cập nhật thật) | check (chỉ kiểm tra, không đổi gì)
#   SITE_DIR    thư mục website trên máy chủ; trống -> đọc deploy/site.conf, không có thì máy chủ tự dò theo APP_URL
# Lần đầu (chưa có deploy/known_hosts) luôn chỉ kiểm tra và in khóa nhận dạng của máy chủ để ghim lại.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
MODE="${MODE:-deploy}"
SSH_PORT="${SSH_PORT:-22}"
SITE_URL="${SITE_URL%/}"
REMOTE_HOME_DIR='phcarplay-deploy'          # tương đối với thư mục nhà trên máy chủ
REV="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

note() { echo "$*"; }
summary() { echo "$*" >> "$SUMMARY"; }
die() { echo "::error::$*"; summary "**Lỗi:** $*"; exit 1; }

[ "$MODE" = "deploy" ] || [ "$MODE" = "check" ] || die "MODE phải là deploy hoặc check (đang là: $MODE)"

if [ -z "${SSH_KEY:-}" ]; then
  echo "::notice::Chưa có khóa ALWAYSDATA_SSH_KEY trong GitHub (Settings > Secrets and variables > Actions) nên bỏ qua bước cập nhật website."
  summary "Bỏ qua: chưa cài khóa ALWAYSDATA_SSH_KEY."
  exit 0
fi
[ -n "${SSH_HOST:-}" ] && [ -n "${SSH_USER:-}" ] && [ -n "$SITE_URL" ] || die "Thiếu SSH_HOST, SSH_USER hoặc SITE_URL."

if [ -z "${SITE_DIR:-}" ] && [ -f deploy/site.conf ]; then
  SITE_DIR="$(grep -E '^SITE_DIR=' deploy/site.conf | tail -n 1 | cut -d= -f2- | tr -d '\r')"
fi
SITE_DIR="${SITE_DIR:-}"

WORK="$(mktemp -d)"
cleanup() {
  if [ -S "$WORK/cm" ]; then ssh -o ControlPath="$WORK/cm" -O exit "$SSH_USER@$SSH_HOST" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# ---------- khóa riêng: chấp nhận nội dung file (có thể lẫn \r, khoảng trắng cuối dòng) hoặc dạng base64 một dòng ----------
KEY="$WORK/key"
printf '%s\n' "$SSH_KEY" | tr -d '\r' | sed -E 's/[[:space:]]+$//' | sed '/^$/d' > "$KEY"
if ! grep -q 'BEGIN' "$KEY"; then
  tr -d '[:space:]' < "$KEY" | base64 -d > "$KEY.dec" 2>/dev/null && mv "$KEY.dec" "$KEY" || true
fi
chmod 600 "$KEY"
ssh-keygen -y -f "$KEY" > /dev/null 2>&1 || die "Khóa ALWAYSDATA_SSH_KEY không đúng định dạng. Hãy chép lại đủ từ dòng -----BEGIN OPENSSH PRIVATE KEY----- đến hết dòng -----END OPENSSH PRIVATE KEY----- rồi dán lại vào GitHub."

# ---------- nhận dạng máy chủ: dùng khóa đã ghim; lần đầu thì lấy về, in ra và chỉ kiểm tra ----------
KH="$WORK/known_hosts"
FIRST=0
if [ -s deploy/known_hosts ]; then
  cp deploy/known_hosts "$KH"
else
  FIRST=1
  ssh-keyscan -p "$SSH_PORT" -T 20 "$SSH_HOST" 2>/dev/null | grep -v '^#' > "$KH" || true
  [ -s "$KH" ] || die "Không liên lạc được máy chủ SSH $SSH_HOST:$SSH_PORT."
  note "Lần đầu kết nối: khóa nhận dạng của máy chủ (ghim vào deploy/known_hosts):"
  cat "$KH"
  ssh-keygen -l -f "$KH" || true
  if [ "$MODE" = "deploy" ]; then MODE=check; note "Lần đầu nên chỉ KIỂM TRA, chưa thay đổi gì trên máy chủ."; fi
fi

SSH_OPTS=(-i "$KEY" -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes -o PasswordAuthentication=no
  -o UserKnownHostsFile="$KH" -o StrictHostKeyChecking=yes -o ConnectTimeout=20 -o ServerAliveInterval=15
  -o ControlMaster=auto -o ControlPath="$WORK/cm" -o ControlPersist=600)
remote() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }

# Chỉ thử đăng nhập MỘT lần: alwaysdata chặn địa chỉ IP sau khoảng mười lần đăng nhập hỏng.
if ! OUT="$(remote 'echo OK' 2>&1)" || [ "$OUT" != "OK" ]; then
  echo "$OUT" | tail -n 3
  die "Không đăng nhập được $SSH_USER@$SSH_HOST bằng khóa ALWAYSDATA_SSH_KEY. Kiểm tra: đã bật SSH cho người dùng $SSH_USER trên alwaysdata; dòng lệnh tạo khóa đã chạy xong; khóa dán vào GitHub là khóa mới nhất (chạy lại lệnh thì khóa cũ hết tác dụng)."
fi
note "Đã đăng nhập máy chủ $SSH_HOST bằng người dùng $SSH_USER."

# ---------- gói mã cần chạy trên máy chủ (chỉ file có trong git: không bao giờ có .env) ----------
PKG="$WORK/release.tgz"
git archive --format=tar HEAD app bin config database deploy public routes storage .htaccess | gzip -9 > "$PKG"
REL="$(date -u +%Y%m%d-%H%M%S)-${REV:0:10}"
note "Gói mã $(du -k "$PKG" | cut -f1) KB, bản $REV"
remote "set -e; mkdir -p ~/$REMOTE_HOME_DIR/releases/$REL; tar xzf - -C ~/$REMOTE_HOME_DIR/releases/$REL" < "$PKG" || die "Không chép được mã lên máy chủ."

health() { # in "OK <bản mã>" nếu website trả lời /api/health với database hoạt động, ngược lại in tên lỗi
  local body rev
  body="$(curl -fsS --max-time 20 "$SITE_URL/api/health" 2>/dev/null)" || { echo "KHONG_TRA_LOI"; return 0; }
  if printf '%s' "$body" | grep -q '"database":true' && printf '%s' "$body" | grep -q '"status":"ok"'; then
    rev="$(printf '%s' "$body" | grep -oE '"revision":"[0-9a-f]+"' | cut -d'"' -f4 || true)"
    echo "OK ${rev:-?}"
  else echo "LOI_DATABASE"; fi
}
pages_ok() { # trang chủ và trang quản trị mở được
  local code
  for p in "/" "/admin"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE_URL$p" || echo 000)"
    [ "$code" = "200" ] || { echo "Trang $p trả mã $code"; return 1; }
  done
}
PRE="$(health)"
note "Website trước khi cập nhật: $PRE"
PRE_OK=0; case "$PRE" in OK*) PRE_OK=1 ;; esac

# Đường dẫn tương đối: lệnh SSH luôn bắt đầu ở thư mục nhà trên máy chủ.
ARGS=(--release "$REMOTE_HOME_DIR/releases/$REL" --site-url "$SITE_URL" --revision "$REV")
[ -n "$SITE_DIR" ] && ARGS+=(--site-dir "$SITE_DIR")
QUOTED=""; for a in "${ARGS[@]}"; do QUOTED+=" $(printf '%q' "$a")"; done
set +e
SERVER_OUT="$(remote "bash ~/$REMOTE_HOME_DIR/releases/$REL/deploy/server.sh $MODE$QUOTED" 2>&1)"
SERVER_RC=$?
set -e
echo "$SERVER_OUT"
field() { printf '%s\n' "$SERVER_OUT" | grep -E "^$1=" | tail -n 1 | cut -d= -f2- || true; }
RESULT="$(field KET_QUA)"
FOUND_DIR="$(field SITE_DIR)"
BACKUP="$(field BACKUP)"

summary "### Cập nhật website ($MODE)"
summary "- Bản mã: \`$REV\`"
[ -n "$FOUND_DIR" ] && summary "- Thư mục website: \`$FOUND_DIR\`"
summary "- Kết quả trên máy chủ: **${RESULT:-không rõ}**"
if [ "$FIRST" = 1 ]; then
  summary "- Lần đầu: đã lấy khóa nhận dạng máy chủ, cần ghim vào \`deploy/known_hosts\` trước khi cập nhật thật."
  summary '```'; summary "$(cat "$KH")"; summary '```'
fi

[ "$SERVER_RC" -eq 0 ] && [ -n "$RESULT" ] && [ "$RESULT" != "LOI" ] || die "Máy chủ báo lỗi (xem các dòng LỖI ở trên). Website vẫn chạy bản cũ trừ khi có ghi khác."

if [ "$MODE" = "check" ] || [ "$RESULT" = "KHONG_DOI" ]; then
  note "Xong (không thay đổi gì trên website)."
  exit 0
fi

# ---------- kiểm tra website sau khi cập nhật; hỏng thì tự trả về bản cũ ----------
# PHP trên máy chủ có thể còn chạy mã cũ trong bộ nhớ đệm vài giây (opcache): đợi tới khi /api/health báo đúng
# bản mã mới BA lần liên tiếp (cách nhau vài giây, để chắc mọi file đã nạp lại). Website lỗi hai lần liền thì coi
# là hỏng. Đợi quá lâu mà website vẫn chạy tốt (chưa thấy bản mới) thì chỉ cảnh báo.
WANT="${REV:0:12}"
POST=""; FAILS=0; GOOD=0; CONFIRMED=0
for i in $(seq 1 "${HEALTH_TRIES:-24}"); do
  sleep "${HEALTH_WAIT:-5}"
  POST="$(health)"
  case "$POST" in
    "OK $WANT") FAILS=0; GOOD=$((GOOD + 1)); [ "$GOOD" -ge 3 ] && { CONFIRMED=1; break; } ;;
    OK*) FAILS=0; GOOD=0 ;;
    *) GOOD=0; FAILS=$((FAILS + 1)); [ "$FAILS" -ge 2 ] && break ;;
  esac
done
case "$POST" in OK*) POST_OK=1 ;; *) POST_OK=0 ;; esac
if [ "$POST_OK" = 1 ] && pages_ok; then
  if [ "$CONFIRMED" = 1 ]; then
    note "Website sau khi cập nhật: OK, đang chạy bản $WANT"
    summary "- Kiểm tra website sau khi cập nhật: **OK** (đang chạy bản \`$WANT\`)"
  else
    echo "::warning::Website vẫn chạy tốt nhưng chưa xác nhận được bản mã mới ($POST). Có thể PHP trên máy chủ giữ mã cũ lâu hơn bình thường; thử tải lại trang sau ít phút."
    summary "- Website chạy tốt nhưng **chưa xác nhận** được bản mã mới ($POST)."
  fi
  exit 0
fi
note "Website sau khi cập nhật: ${POST} (trước đó: $PRE)"
if [ "$PRE_OK" = 1 ] && [ -n "$BACKUP" ] && [ -n "$FOUND_DIR" ]; then
  note "Đang trả mã về bản trước..."
  remote "bash ~/$REMOTE_HOME_DIR/releases/$REL/deploy/server.sh rollback --site-dir $(printf '%q' "$FOUND_DIR") --backup $(printf '%q' "$BACKUP")" || true
  sleep "${HEALTH_WAIT:-5}"
  AFTER="$(health)"
  summary "- Website lỗi sau khi cập nhật nên đã trả mã về bản trước (database giữ nguyên). Kiểm tra lại: **$AFTER**"
  die "Website lỗi sau khi cập nhật ($POST). Đã trả mã về bản trước; kiểm tra lại: $AFTER."
fi
die "Website không chạy sau khi cập nhật ($POST). Trước khi cập nhật website cũng đã không chạy ($PRE) nên không trả về bản cũ."
