#!/usr/bin/env bash
# PH Car Play - phần chạy TRÊN MÁY CHỦ (alwaysdata) khi tự cập nhật website (giai đoạn 17).
# GitHub (deploy/ci-deploy.sh) chép mã mới vào ~/phcarplay-deploy/releases/<bản>/ rồi gọi file này qua SSH.
#
#   server.sh check    --release DIR --site-url URL [--site-dir DIR]   chỉ kiểm tra, KHÔNG đổi gì
#   server.sh deploy   --release DIR --site-url URL [--site-dir DIR] [--revision SHA]
#   server.sh rollback --site-dir DIR --backup FILE                    trả mã về bản sao lưu (database giữ nguyên)
#
# Khi cập nhật: sao lưu mã đang chạy -> (nếu có migration mới) sao lưu database rồi chạy migration -> chép mã mới.
# Không bao giờ đụng tới: .env, storage/ (chỉ tạo thư mục còn thiếu), public/assets/vendor/, các file khác ở thư mục gốc.
# Không xóa file nào của website: file cũ không còn trong mã nguồn cứ để nguyên (vô hại), để khỏi xóa nhầm file bạn
# tự đặt lên máy chủ (vd. file xác minh của Google trong public/).
# Migration lỗi thì dừng trước khi chép mã: website vẫn chạy mã cũ.
# Dòng cuối luôn là KET_QUA=... để GitHub đọc.
set -euo pipefail

DEPLOY_HOME="${PHCARPLAY_DEPLOY_HOME:-$HOME/phcarplay-deploy}"
BACKUP_DIR="${PHCARPLAY_BACKUP_DIR:-$HOME/phcarplay-backups}"
MANAGED_DIRS="app bin config database public routes"
KEEP_RELEASES=3
KEEP_CODE_BACKUPS=5
KEEP_DB_BACKUPS=10
PHP_BIN="${PHP_BIN:-php}"

ACTION="${1:-}"
shift || true
RELEASE=""; SITE_URL=""; SITE_DIR=""; REVISION=""; BACKUP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE="${2:-}"; shift 2 ;;
    --site-url) SITE_URL="${2:-}"; shift 2 ;;
    --site-dir) SITE_DIR="${2:-}"; shift 2 ;;
    --revision) REVISION="${2:-}"; shift 2 ;;
    --backup) BACKUP="${2:-}"; shift 2 ;;
    *) echo "Tham số lạ: $1"; echo "KET_QUA=LOI"; exit 2 ;;
  esac
done

fail() { echo "LỖI: $*"; echo "KET_QUA=LOI"; exit 1; }
say() { echo "$*"; }

# Phần máy chủ (host) của một địa chỉ: https://ABC.alwaysdata.net/xyz -> abc.alwaysdata.net
url_host() { printf '%s' "$1" | sed -E 's#^[A-Za-z]+://##; s#[/?\#].*$##; s#:[0-9]+$##' | tr 'A-Z' 'a-z'; }

# APP_URL trong .env của một thư mục website (chỉ đọc đúng dòng này, không in gì khác của .env)
env_app_url() {
  local v
  v="$(grep -E '^[[:space:]]*APP_URL[[:space:]]*=' "$1/.env" 2>/dev/null | tail -n 1 | sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]+$//')" || true
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

looks_like_site() { [ -f "$1/app/bootstrap.php" ] && [ -f "$1/public/index.php" ] && [ -f "$1/.env" ]; }

find_site_dir() {
  local want host cand dir found=() all=()
  want="$(url_host "$SITE_URL")"
  while IFS= read -r cand; do
    dir="$(dirname "$(dirname "$cand")")"
    case "$dir" in "$DEPLOY_HOME"*|"$BACKUP_DIR"*) continue ;; esac
    looks_like_site "$dir" || continue
    all+=("$dir")
    host="$(url_host "$(env_app_url "$dir")")"
    [ -n "$want" ] && [ "$host" = "$want" ] && found+=("$dir")
  done < <(find "$HOME" -maxdepth 5 -path '*/app/bootstrap.php' -type f 2>/dev/null | sort)
  if [ "${#found[@]}" -eq 1 ]; then printf '%s' "${found[0]}"; return 0; fi
  if [ "${#found[@]}" -gt 1 ]; then
    { say "Có nhiều thư mục website cùng APP_URL ($want):"; printf '  %s\n' "${found[@]}"
      say "Hãy chọn một bằng cách ghi SITE_DIR=<thư mục> vào file deploy/site.conf."; } >&2
    return 1
  fi
  {
    say "Không tìm thấy thư mục website nào có APP_URL trỏ tới $want trong .env."
    if [ "${#all[@]}" -gt 0 ]; then
      say "Các thư mục giống website PH Car Play tìm thấy:"
      for dir in "${all[@]}"; do say "  $dir (APP_URL trỏ tới: $(url_host "$(env_app_url "$dir")"))"; done
    fi
  } >&2
  return 1
}

# ---------- trả về bản sao lưu ----------
if [ "$ACTION" = "rollback" ]; then
  [ -n "$SITE_DIR" ] && looks_like_site "$SITE_DIR" || fail "Thư mục website không hợp lệ: $SITE_DIR"
  [ -f "$BACKUP" ] || fail "Không thấy bản sao lưu mã: $BACKUP"
  tar xzf "$BACKUP" -C "$SITE_DIR" || fail "Không giải nén được $BACKUP"
  say "Đã trả mã website về bản sao lưu $(basename "$BACKUP") (database giữ nguyên)."
  echo "KET_QUA=DA_TRA_VE"
  exit 0
fi

[ "$ACTION" = "check" ] || [ "$ACTION" = "deploy" ] || { echo "Dùng: server.sh check|deploy|rollback ..."; echo "KET_QUA=LOI"; exit 2; }
case "$RELEASE" in /*|'') ;; *) RELEASE="$HOME/$RELEASE" ;; esac   # đường dẫn tương đối: tính từ thư mục nhà
[ -n "$RELEASE" ] && [ -f "$RELEASE/app/bootstrap.php" ] && [ -f "$RELEASE/bin/migrate.php" ] || fail "Bản mã mới không đầy đủ: $RELEASE"
RELEASE="$(cd "$RELEASE" && pwd -P)"
command -v "$PHP_BIN" >/dev/null 2>&1 || fail "Máy chủ không có lệnh php"
say "PHP trên máy chủ: $("$PHP_BIN" -r 'echo PHP_VERSION;')"

# ---------- tìm và kiểm tra thư mục website ----------
if [ -n "$SITE_DIR" ]; then
  SITE_DIR="${SITE_DIR/#\~/$HOME}"
  looks_like_site "$SITE_DIR" || fail "Thư mục $SITE_DIR không giống website PH Car Play (cần có app/bootstrap.php, public/index.php và .env)."
else
  SITE_DIR="$(find_site_dir)" || fail "Chưa xác định được thư mục website trên máy chủ."
fi
SITE_DIR="$(cd "$SITE_DIR" && pwd -P)"
say "Thư mục website: $SITE_DIR"
echo "SITE_DIR=$SITE_DIR"
[ -w "$SITE_DIR" ] || fail "Không có quyền ghi vào $SITE_DIR"

# ---------- khóa: không cho hai lần cập nhật chạy cùng lúc ----------
mkdir -p "$DEPLOY_HOME"
LOCK="$DEPLOY_HOME/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null || true; mkdir "$LOCK" 2>/dev/null || fail "Một lần cập nhật khác đang chạy."
  else fail "Một lần cập nhật khác đang chạy (khóa $LOCK). Thử lại sau vài phút."; fi
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

# ---------- dọn bớt bản cũ (kể cả bản của những lần chạy lỗi); bản đang dùng luôn là mới nhất ----------
prune() { # prune <thư mục> <mẫu tên> <giữ lại>   (rm -r không đi theo liên kết .env/storage trong bản cũ)
  local n=0 f
  while IFS= read -r f; do n=$((n + 1)); [ "$n" -le "$3" ] || rm -rf -- "$f"; done < <(ls -1dt "$1"/$2 2>/dev/null || true)
}
prune "$DEPLOY_HOME/releases" '*' "$KEEP_RELEASES"

# ---------- chuẩn bị bản mới: dùng .env và storage của website để chạy lệnh PHP ----------
STORAGE_HTACCESS="$DEPLOY_HOME/storage.htaccess"
if [ -f "$RELEASE/storage/.htaccess" ] && [ ! -L "$RELEASE/storage" ]; then cp "$RELEASE/storage/.htaccess" "$STORAGE_HTACCESS"; fi
[ -d "$SITE_DIR/storage" ] || fail "Website thiếu thư mục storage/: $SITE_DIR/storage"
rm -rf "$RELEASE/storage"; ln -s "$SITE_DIR/storage" "$RELEASE/storage"
rm -f "$RELEASE/.env"; ln -s "$SITE_DIR/.env" "$RELEASE/.env"

# ---------- migration còn thiếu ----------
if ! PENDING_RAW="$("$PHP_BIN" "$RELEASE/bin/migrate.php" --pending 2>&1)"; then
  printf '%s\n' "$PENDING_RAW" | tail -n 5
  fail "Không đọc được database bằng .env của website (sai DB_HOST/DB_NAME/DB_USER/DB_PASS?)."
fi
PENDING="$(printf '%s\n' "$PENDING_RAW" | grep -E '\.sql$' || true)"
PENDING_COUNT="$(printf '%s' "$PENDING" | grep -c . || true)"
if [ "$PENDING_COUNT" -gt 0 ]; then say "Database cần cập nhật ($PENDING_COUNT): $(printf '%s' "$PENDING" | tr '\n' ' ')"; else say "Database đã đủ, không có migration mới."; fi
echo "MIGRATIONS=$PENDING_COUNT"

# ---------- file mã sẽ thay đổi ----------
HAVE_RSYNC=0; command -v rsync >/dev/null 2>&1 && [ -z "${PHCARPLAY_NO_RSYNC:-}" ] && HAVE_RSYNC=1
RSYNC_EXCLUDES=(--exclude=/assets/vendor/ --exclude=.DS_Store)
CHANGES="$DEPLOY_HOME/changes.txt"; : > "$CHANGES"
for d in $MANAGED_DIRS; do
  [ -d "$RELEASE/$d" ] || continue
  if [ "$HAVE_RSYNC" = 1 ]; then
    ex=(); [ "$d" = "public" ] && ex=("${RSYNC_EXCLUDES[@]}")
    rsync -ani --checksum ${ex[@]+"${ex[@]}"} "$RELEASE/$d/" "$SITE_DIR/$d/" | grep -vE '^\.|^cd' | sed -E "s#^([^ ]+) +#\1 $d/#" >> "$CHANGES" || true
  else
    # không có rsync: so từng file (chỉ file thêm mới hoặc khác nội dung)
    ( cd "$RELEASE" && find "$d" -type f ! -path 'public/assets/vendor/*' ) | while IFS= read -r f; do
      cmp -s "$RELEASE/$f" "$SITE_DIR/$f" 2>/dev/null || echo ">f $f"
    done >> "$CHANGES"
  fi
done
if ! cmp -s "$RELEASE/.htaccess" "$SITE_DIR/.htaccess" 2>/dev/null; then echo ">f .htaccess" >> "$CHANGES"; fi
CHANGED_COUNT="$(grep -c . "$CHANGES" || true)"
say "File mã thêm mới hoặc thay đổi: $CHANGED_COUNT"
head -n 60 "$CHANGES" | sed 's/^/  /'
[ "$CHANGED_COUNT" -gt 60 ] && say "  ... và $((CHANGED_COUNT - 60)) file khác"
echo "FILES=$CHANGED_COUNT"

if [ "$ACTION" = "check" ]; then
  say "Chế độ kiểm tra: KHÔNG thay đổi gì trên máy chủ."
  echo "KET_QUA=DA_KIEM_TRA"
  exit 0
fi

if [ "$CHANGED_COUNT" -eq 0 ] && [ "$PENDING_COUNT" -eq 0 ]; then
  say "Website đã là bản mới nhất, không cần cập nhật."
  echo "KET_QUA=KHONG_DOI"
  exit 0
fi

# ---------- thư mục storage còn thiếu (không bao giờ xóa gì trong storage) ----------
for d in cache logs mail sessions; do mkdir -p "$SITE_DIR/storage/$d"; done
if [ -f "$STORAGE_HTACCESS" ] && [ ! -f "$SITE_DIR/storage/.htaccess" ]; then cp "$STORAGE_HTACCESS" "$SITE_DIR/storage/.htaccess"; fi

# ---------- sao lưu mã đang chạy ----------
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
CODE_BACKUP="$BACKUP_DIR/code-$STAMP.tgz"
INCLUDE=(); for d in $MANAGED_DIRS .htaccess; do [ -e "$SITE_DIR/$d" ] && INCLUDE+=("$d"); done
( umask 077; tar czf "$CODE_BACKUP" -C "$SITE_DIR" --exclude='./public/assets/vendor' --exclude='public/assets/vendor' "${INCLUDE[@]}" ) || fail "Không sao lưu được mã đang chạy."
say "Đã sao lưu mã đang chạy: $CODE_BACKUP"
echo "BACKUP=$CODE_BACKUP"

# ---------- database: sao lưu rồi chạy migration ----------
if [ "$PENDING_COUNT" -gt 0 ]; then
  DB_BACKUP="$BACKUP_DIR/db-$STAMP.sql.gz"
  "$PHP_BIN" "$RELEASE/bin/backup-db.php" --out="$DB_BACKUP" || fail "Không sao lưu được database nên chưa cập nhật gì (website vẫn chạy bản cũ)."
  if ! "$PHP_BIN" "$RELEASE/bin/migrate.php"; then
    fail "Cập nhật database bị lỗi nên chưa chép mã mới (website vẫn chạy mã cũ). Bản sao lưu database: $DB_BACKUP"
  fi
fi

# ---------- chép mã mới ----------
# Bản mã ghi vào một file PHP đi cùng mã: /api/health chỉ báo bản mới khi PHP đã thật sự nạp mã mới
# (PHP có thể giữ mã cũ trong bộ nhớ đệm vài giây sau khi chép).
if printf '%s' "$REVISION" | grep -qE '^[0-9a-f]{7,40}$'; then
  printf "<?php\n// Do deploy/server.sh tạo khi tự cập nhật. Không sửa tay.\nreturn '%s';\n" "$REVISION" > "$RELEASE/app/deploy_revision.php"
fi
for d in $MANAGED_DIRS; do
  [ -d "$RELEASE/$d" ] || continue
  mkdir -p "$SITE_DIR/$d"
  if [ "$HAVE_RSYNC" = 1 ]; then
    ex=(); [ "$d" = "public" ] && ex=("${RSYNC_EXCLUDES[@]}")
    rsync -a --checksum --delay-updates ${ex[@]+"${ex[@]}"} "$RELEASE/$d/" "$SITE_DIR/$d/" || fail "Chép mã mới bị lỗi ở thư mục $d. Bản sao lưu: $CODE_BACKUP"
  else
    ( cd "$RELEASE" && find "$d" -type f ! -path 'public/assets/vendor/*' ) | while IFS= read -r f; do
      mkdir -p "$SITE_DIR/$(dirname "$f")" && cp -p "$RELEASE/$f" "$SITE_DIR/$f.new-deploy" && mv -f "$SITE_DIR/$f.new-deploy" "$SITE_DIR/$f"
    done || fail "Chép mã mới bị lỗi ở thư mục $d. Bản sao lưu: $CODE_BACKUP"
  fi
done
cp "$RELEASE/.htaccess" "$SITE_DIR/.htaccess.new" && mv -f "$SITE_DIR/.htaccess.new" "$SITE_DIR/.htaccess"
printf 'revision=%s\ndeployed_at=%s\n' "${REVISION:-?}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SITE_DIR/storage/deploy-revision.txt"
say "Đã chép mã mới vào $SITE_DIR"

# ---------- dọn bớt bản sao lưu cũ ----------
prune "$BACKUP_DIR" 'code-*.tgz' "$KEEP_CODE_BACKUPS"
prune "$BACKUP_DIR" 'db-*.sql.gz' "$KEEP_DB_BACKUPS"

echo "KET_QUA=DA_CAP_NHAT"
