// Động cơ phát: nhận thông tin luồng từ máy chủ và phát bằng MỘT phần tử <video> duy nhất (giữ nguyên khi đổi bài,
// để sau này cửa sổ nổi PiP không bị đóng giữa các bài). Thử lần lượt: HLS -> mp4 có tiếng -> chỉ âm thanh.

// Danh sách nguồn thử theo thứ tự ưu tiên.
export function chooseSources(info, caps = {}) {
  const out = [];
  const maxHeight = caps.maxHeight || 720;
  const canPlay = caps.canPlay || (() => true);

  if (info.hls && caps.nativeHls) out.push({ kind: 'native-hls', url: info.hls });
  else if (info.hls && caps.hlsJs) out.push({ kind: 'hls', url: info.hls });

  const all = (info.sources || []).filter((s) => canPlay(s.mime));
  const fit = all.filter((s) => !s.height || s.height <= maxHeight);
  const files = fit.length ? fit : all.slice(-1);   // nếu mọi luồng đều quá nét thì lấy luồng thấp nhất
  files.forEach((s) => out.push({ kind: 'file', url: s.url, mime: s.mime }));

  (info.audio || []).filter((a) => canPlay(a.mime)).forEach((a) => out.push({ kind: 'audio', url: a.url, mime: a.mime }));
  return out;
}

export const DEFAULT_HLS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.17/hls.min.js';

// Nạp hls.js khi cần (trình duyệt không tự phát được HLS). Trả null nếu không nạp được.
// src, integrity do máy chủ gửi trong boot.hlsJs: file trong website (assets/vendor) hoặc CDN, kèm mã kiểm tra toàn vẹn (SRI) nếu có.
export function createHlsLoader(src, integrity) {
  const url = src || DEFAULT_HLS_SRC;
  let promise = null;
  return function loadHls() {
    if (typeof window !== 'undefined' && window.Hls) return Promise.resolve(window.Hls);
    if (!promise) {
      promise = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        if (integrity) {   // trình duyệt chỉ chạy file nếu đúng từng byte như mã băm (CDN bị chiếm cũng không chèn được mã)
          s.integrity = integrity;
          s.crossOrigin = 'anonymous';
        }
        s.onload = () => resolve(window.Hls || null);
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return promise;
  };
}

export function createEngine({ video, loadHls = () => Promise.resolve(null), maxHeight = 720, attachTimeoutMs = 15000, onFatal = () => {} }) {
  let hls = null;
  let attempts = [];
  let attemptIndex = -1;
  let token = 0;
  let ready = false;   // true khi đã có một nguồn đang phát được (chỉ khi đó mới xử lý lỗi giữa chừng)

  function destroyHls() {
    if (hls) { try { hls.destroy(); } catch (e) { /* bỏ qua */ } hls = null; }
  }

  async function getCaps(needHls) {
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
    let hlsJs = false;
    if (needHls && !nativeHls) {   // chỉ nạp hls.js khi video này thật sự có luồng HLS
      const Hls = await loadHls();
      hlsJs = Boolean(Hls && Hls.isSupported && Hls.isSupported());
    }
    return { nativeHls, hlsJs, maxHeight, canPlay: (mime) => !mime || video.canPlayType(String(mime).split(';')[0]) !== '' };
  }

  // Gắn một nguồn vào video và đợi đến khi đọc được thông tin (hoặc lỗi).
  function attach(source) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onReady);
        video.removeEventListener('error', onError);
        err ? reject(err) : resolve();
      };
      const onReady = () => finish();
      const onError = () => finish(new Error('Lỗi tải nguồn phát'));
      const timer = setTimeout(() => finish(new Error('Hết thời gian chờ nguồn phát')), attachTimeoutMs);
      video.addEventListener('loadedmetadata', onReady);
      video.addEventListener('error', onError);
      destroyHls();
      if (source.kind === 'hls') {
        loadHls().then((Hls) => {
          hls = new Hls({ enableWorker: true });
          hls.on(Hls.Events.ERROR, (_e, data) => { if (data && data.fatal) finish(new Error('Lỗi HLS')); });
          hls.loadSource(source.url);
          hls.attachMedia(video);
        }).catch((e) => finish(e));
      } else {
        video.src = source.url;
        video.load();
      }
    });
  }

  async function tryNext(myToken) {
    ready = false;
    while (attemptIndex + 1 < attempts.length) {
      attemptIndex += 1;
      if (myToken !== token) return false;
      try {
        await attach(attempts[attemptIndex]);
        ready = myToken === token;
        return ready;
      } catch (e) { /* thử nguồn kế tiếp */ }
    }
    return false;
  }

  // Lỗi khi đang phát (ví dụ địa chỉ luồng hết hạn): thử nguồn kế tiếp, hết thì báo lỗi nặng.
  video.addEventListener('error', () => {
    if (!ready) return;   // đang trong lúc thử nguồn thì vòng thử nguồn tự xử lý, không chạy chồng
    const myToken = token;
    const resumeAt = video.currentTime || 0;
    tryNext(myToken).then((ok) => {
      if (ok) { try { video.currentTime = resumeAt; } catch (e) { /* bỏ qua */ } video.play().catch(() => {}); }
      else if (myToken === token) onFatal();
    });
  });

  return {
    // Trả true nếu đã gắn được một nguồn phát.
    async load(info) {
      token += 1;
      ready = false;
      const myToken = token;
      destroyHls();
      attempts = chooseSources(info, await getCaps(Boolean(info.hls)));
      attemptIndex = -1;
      if (myToken !== token) return false;
      return tryNext(myToken);
    },
    destroy() { token += 1; ready = false; destroyHls(); video.pause(); video.removeAttribute('src'); video.load(); },
    play: () => video.play(),
    pause: () => video.pause(),
    isPaused: () => video.paused,
    attempts: () => attempts.slice(),
  };
}
