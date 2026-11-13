import { h, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { avatar } from '../../core/avatar.js';
import { formatDuration, formatViews } from '../../core/format.js';
import { observeSize } from '../../core/observeSize.js';
import { showToast } from '../../core/toast.js';
import { openPlaylistPicker } from '../youtube/playlistPicker.js';
import { openActionSheet } from '../../core/dialog.js';

const MIN_STAGE_REM = 8;      // khung video không nhỏ hơn mức này (rem)
const SEEK_STEP = 10;          // chạm đúp hai bên video: tua 10 giây
const DOUBLE_TAP_MS = 320;
// Giai đoạn 14: điện thoại (màn hình hẹp hơn 600px) dùng giao diện gọn: chỉ tên bài 1 dòng, thanh tua và 3 nút lớn;
// các nút phụ gom vào nút "⋯".
const PHONE_QUERY = '(max-width: 599px)';

// Khung trình phát kiểu YouTube cho màn hình xe: video, tên bài, kênh, thanh tua đỏ, nút điều khiển lớn,
// chạm 1 lần vào video để phát/dừng, chạm đúp bên trái/phải để tua lùi/tới 10 giây,
// cửa sổ nổi (PiP), toàn màn hình và "Chỉ video" (phóng to khung trình phát).
// ctx.layout: { focus(), setFocus(side|null), onChange(fn) } do khung ứng dụng cung cấp.
export const playerPanel = {
  id: 'player',
  title: 'Trình phát',
  mount(container, ctx) {
    const { media, layout } = ctx;
    const { video, controller, pip, fullscreen } = media;
    // surface: currentTime/duration/paused/sự kiện của nguồn đang phát (thẻ video hoặc trình phát YouTube)
    const surface = media.surface || video;
    const root = h('div', { class: 'player' });

    // ----- lớp phủ: cần chạm để phát, đang ở cửa sổ nổi, lỗi -----
    const overlayText = h('p', { class: 'overlay-text' });
    const overlayBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => controller.toggle() }, icon('play', 28), 'Bấm để phát');
    const pipBackBtn = h('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => pip.exit() }, icon('pip', 28), 'Đưa về đây');
    const overlay = h('div', { class: 'stage-overlay' }, overlayText, overlayBtn, pipBackBtn);

    // ----- nút cửa sổ nổi, chỉ hiện video, toàn màn hình: nằm NGOÀI khung video (cạnh tên bài) để không che video -----
    const pipBtn = h('button', { type: 'button', class: 'stage-btn', 'aria-label': 'Cửa sổ nổi', title: 'Cửa sổ nổi', 'aria-pressed': 'false', onclick: onPip }, icon('pip', 22));
    const theaterBtn = h('button', { type: 'button', class: 'stage-btn stage-theater', 'aria-label': 'Chỉ hiện video', title: 'Chỉ hiện video', onclick: () => layout.setFocus(layout.focus() === 'left' ? null : 'left') }, icon('expand', 20));
    const fsBtn = h('button', { type: 'button', class: 'stage-btn', 'aria-label': 'Toàn màn hình', title: 'Toàn màn hình', onclick: onFullscreen }, icon('fullscreen', 24));
    // Trình duyệt chặn tự phát có tiếng -> video đang phát tắt tiếng; nút này (và mọi lần chạm vào website) bật tiếng lại.
    const soundBtn = h('button', { type: 'button', class: 'stage-btn sound-btn', 'aria-label': 'Bật tiếng', title: 'Bật tiếng', hidden: '', onclick: () => { if (media.sound) media.sound.unmute(); } }, icon('volumeOff', 22), h('span', {}, 'Bật tiếng'));
    const tools = h('div', { class: 'stage-tools' }, soundBtn, pipBtn, theaterBtn, fsBtn);

    // ----- chạm vào video -----
    const flashCenter = h('div', { class: 'stage-flash center', 'aria-hidden': 'true' });
    const flashLeft = h('div', { class: 'stage-flash left', 'aria-hidden': 'true' }, icon('rewind', 36), h('span', {}, `${SEEK_STEP} giây`));
    const flashRight = h('div', { class: 'stage-flash right', 'aria-hidden': 'true' }, icon('forward', 36), h('span', {}, `${SEEK_STEP} giây`));
    const tap = h('div', { class: 'stage-tap', 'aria-hidden': 'true' });
    const stage = h('div', { class: 'stage' }, video, media.embedHost || null, tap, h('div', { class: 'stage-busy', 'aria-hidden': 'true' }), flashCenter, flashLeft, flashRight, overlay);
    const pipHint = h('p', { class: 'pip-hint' });

    function flash(el) {
      el.classList.remove('show');
      void el.offsetWidth;          // chạy lại hiệu ứng
      el.classList.add('show');
    }
    function seekBy(delta) {
      const dur = Number.isFinite(surface.duration) ? surface.duration : Infinity;
      try { surface.currentTime = Math.max(0, Math.min(dur, (surface.currentTime || 0) + delta)); } catch (e) { /* chưa có nguồn phát */ }
      flash(delta < 0 ? flashLeft : flashRight);
    }
    let tapTimer = null;
    let lastTap = 0;
    let lastSide = '';
    tap.addEventListener('click', (e) => {
      if (!controller.snapshot().current) return;
      const rect = stage.getBoundingClientRect();
      const x = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
      const side = x < 0.35 ? 'left' : (x > 0.65 ? 'right' : 'center');
      const now = Date.now();
      if (tapTimer && now - lastTap < DOUBLE_TAP_MS && side === lastSide && side !== 'center') {
        clearTimeout(tapTimer);
        seekBy(side === 'left' ? -SEEK_STEP : SEEK_STEP);
        lastTap = now;
        tapTimer = setTimeout(() => { tapTimer = null; }, DOUBLE_TAP_MS);   // chạm tiếp nhanh thì tua tiếp
        return;
      }
      lastTap = now;
      lastSide = side;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(async () => {
        tapTimer = null;
        const wasPlaying = !surface.paused;
        if (await controller.toggle()) {
          clear(flashCenter);
          flashCenter.append(icon(wasPlaying ? 'pause' : 'play', 40));
          flash(flashCenter);
        }
      }, DOUBLE_TAP_MS);
    });

    async function onPip() {
      const p = pip.snapshot();
      if (!p.active && p.reason) { showToast(p.reason); return; }   // chưa nổi được: nói rõ lý do (màn hình cảm ứng không có tooltip)
      const r = await pip.toggle();
      if (!r.ok && r.message) showToast(r.message);
    }
    async function onFullscreen() {
      const r = await fullscreen.toggle();
      if (!r.ok && r.message) showToast(r.message);
    }

    // ----- tên bài, kênh -----
    const title = h('h2', { class: 'now-title' }, 'Chưa có bài nào');
    const channel = h('div', { class: 'now-channel' });
    function drawChannel(cur) {
      clear(channel);
      if (!cur) { channel.append(h('span', {}, 'Hãy chọn video ở Trang chủ hoặc Tìm kiếm.')); return; }
      const views = formatViews(cur.views);
      channel.append(avatar(cur.uploader || cur.title), h('b', {}, cur.uploader || 'Không rõ kênh'));
      if (views) channel.append(h('span', { class: 'now-views' }, `· ${views}`));   // append(null) của DOM sẽ in ra chữ "null"
    }

    // ----- thanh tua -----
    const seek = h('input', { type: 'range', class: 'seek', min: '0', max: '0', step: '1', value: '0', 'aria-label': 'Tua video' });
    const curTime = h('span', {}, '0:00');
    const durTime = h('span', {}, '0:00');
    let seeking = false;
    const paint = () => {
      const max = Number(seek.max) || 0;
      seek.style.setProperty('--pct', `${max > 0 ? (Number(seek.value) / max) * 100 : 0}%`);
    };
    seek.addEventListener('input', () => { seeking = true; curTime.textContent = formatDuration(seek.value); paint(); });
    seek.addEventListener('change', () => { try { surface.currentTime = Number(seek.value); } catch (e) { /* bỏ qua */ } seeking = false; });
    function updateTime() {
      const cur = controller.snapshot().current;
      const sd = surface.duration;
      const dur = Number.isFinite(sd) && sd > 0 ? sd : (cur ? cur.duration : 0);
      seek.max = String(Math.floor(dur || 0));
      durTime.textContent = formatDuration(dur);
      if (!seeking) {
        const t = surface.currentTime || 0;
        seek.value = String(Math.floor(t));
        curTime.textContent = formatDuration(t);
        seek.setAttribute('aria-valuetext', `${formatDuration(t)} trên ${formatDuration(dur)}`);
      }
      paint();
    }
    ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied'].forEach((ev) => surface.addEventListener(ev, updateTime));
    // Đang phát bằng trình phát YouTube: bỏ lớp chạm của website để bấm được nút của YouTube (bỏ qua quảng cáo...)
    const sourceTag = h('span', { class: 'now-source', hidden: true }, 'Trình phát YouTube');
    function renderMode() {
      const embedOn = Boolean(media.mode) && media.mode() === 'embed';
      stage.classList.toggle('is-embed', embedOn);
      sourceTag.hidden = !embedOn;
      updateTime();
      renderTools();
    }
    if (media.onMode) media.onMode(renderMode);

    // ----- nút điều khiển -----
    const playBtn = h('button', { type: 'button', class: 'ctl ctl-main', 'aria-label': 'Phát', onclick: () => controller.toggle() });
    const prevBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Bài trước', title: 'Bài trước', onclick: () => controller.prev() }, icon('prev', 30));
    const nextBtn = h('button', { type: 'button', class: 'ctl', 'aria-label': 'Bài kế tiếp', title: 'Bài kế tiếp', onclick: () => controller.next() }, icon('next', 30));
    const MIX_LOCKED = 'Tự phát chỉ dùng được ở chế độ Lần lượt.';
    const mixBtn = h('button', { type: 'button', class: 'pill', 'aria-pressed': 'true', title: 'Hết hàng đợi thì tự chọn bài tương tự để phát tiếp',
      onclick: () => {
        const st = controller.snapshot();
        if (st.repeat !== 'off') { showToast(MIX_LOCKED); return; }   // lặp / trộn bài: Tự phát không dùng được
        controller.setAutoMix(!st.autoMix);
      } }, icon('mix', 22), h('span', { class: 'pill-label' }, 'Tự phát'));
    const saveBtn = h('button', { type: 'button', class: 'pill', title: 'Lưu bài đang phát vào playlist', onclick: () => {
      const cur = controller.snapshot().current;
      if (cur) openPlaylistPicker({ store: media.playlists, items: [cur] });
    } }, icon('playlistAdd', 22), h('span', { class: 'pill-label' }, 'Lưu'));
    mixBtn.setAttribute('aria-label', 'Tự phát');
    // Giai đoạn 12: nút chế độ phát (bấm để đổi vòng: Lần lượt -> Lặp tất cả -> Lặp 1 bài -> Trộn bài).
    const REPEAT = {
      off: { icon: 'queue', label: 'Lần lượt', aria: 'Chế độ phát: lần lượt', toast: 'Phát lần lượt theo hàng đợi.' },
      all: { icon: 'repeat', label: 'Lặp tất cả', aria: 'Chế độ phát: lặp tất cả', toast: 'Lặp tất cả hàng đợi. Tự phát tạm tắt.' },
      one: { icon: 'repeatOne', label: 'Lặp 1 bài', aria: 'Chế độ phát: lặp 1 bài', toast: 'Lặp lại bài đang phát. Tự phát tạm tắt.' },
      shuffle: { icon: 'shuffle', label: 'Trộn bài', aria: 'Chế độ phát: trộn bài', toast: 'Trộn bài: phát ngẫu nhiên các bài trong hàng đợi. Tự phát tạm tắt.' },
    };
    const repeatLabel = h('span', { class: 'pill-label' });
    const repeatBtn = h('button', { type: 'button', class: 'pill pill-repeat', 'aria-pressed': 'false', onclick: () => showToast(REPEAT[controller.cycleRepeat()].toast) }, repeatLabel);
    let repeatDrawn = '';
    let onPillsChange = null;   // gán sau khi dựng hàng nút (đo lại xem còn đủ chỗ cho chữ không)
    function drawRepeat(mode) {
      if (mode === repeatDrawn) return;
      repeatDrawn = mode;
      const r = REPEAT[mode] || REPEAT.off;
      while (repeatBtn.firstChild && repeatBtn.firstChild !== repeatLabel) repeatBtn.removeChild(repeatBtn.firstChild);
      repeatBtn.insertBefore(icon(r.icon, 22), repeatLabel);
      repeatLabel.textContent = r.label;
      repeatBtn.setAttribute('aria-label', r.aria);
      repeatBtn.title = r.aria;
      repeatBtn.setAttribute('aria-pressed', String(mode !== 'off'));
      if (onPillsChange) onPillsChange();
    }
    saveBtn.setAttribute('aria-label', 'Lưu vào playlist');

    // Giai đoạn 12.2: thanh âm lượng ngay dưới hàng nút điều khiển (nút loa: tắt/bật tiếng).
    const volBtn = h('button', { type: 'button', class: 'ctl ctl-vol', onclick: () => media.volume.toggleMute() });
    const volSlider = h('input', { type: 'range', class: 'vol', min: '0', max: '100', step: '1', 'aria-label': 'Âm lượng' });
    const volText = h('span', { class: 'vol-text', 'aria-hidden': 'true' });
    volSlider.addEventListener('input', () => media.volume.set(Number(volSlider.value) / 100));
    const volRow = h('div', { class: 'volrow' }, volBtn, volSlider, volText);
    let volIcon = '';
    function drawVolume(v) {
      const silent = v.muted || v.level === 0;
      const pct = Math.round(v.level * 100);
      const name = silent ? 'volumeOff' : (pct < 50 ? 'volumeDown' : 'volumeUp');
      if (name !== volIcon) { volIcon = name; clear(volBtn); volBtn.append(icon(name, 26)); }
      volBtn.setAttribute('aria-label', silent ? 'Bật tiếng' : 'Tắt tiếng');
      volBtn.title = volBtn.getAttribute('aria-label');
      volBtn.setAttribute('aria-pressed', String(silent));
      if (document.activeElement !== volSlider || Number(volSlider.value) !== (silent ? 0 : pct)) volSlider.value = String(silent ? 0 : pct);
      volSlider.style.setProperty('--pct', `${silent ? 0 : pct}%`);
      volSlider.setAttribute('aria-valuetext', silent ? 'Đã tắt tiếng' : `${pct}%`);
      volText.textContent = silent ? 'Tắt tiếng' : `${pct}%`;
    }

    let lastStatus = '';
    function render(s) {
      const cur = s.current;
      title.textContent = cur ? cur.title : 'Chưa có bài nào';
      drawChannel(cur);
      if (cur && cur.thumbnail) video.poster = cur.thumbnail;
      const playing = s.status === 'playing';
      if (playing !== (lastStatus === 'playing') || !playBtn.firstChild) {
        clear(playBtn);
        playBtn.append(icon(playing ? 'pause' : 'play', 40));
      }
      lastStatus = s.status;
      playBtn.setAttribute('aria-label', playing ? 'Tạm dừng' : 'Phát');
      playBtn.title = playBtn.getAttribute('aria-label');
      // Tự phát chỉ bật được ở chế độ Lần lượt: lặp / trộn bài thì nút tắt và mờ (bấm thì báo lý do).
      const locked = s.repeat !== 'off';
      mixBtn.setAttribute('aria-pressed', String(s.autoMix && !locked));
      mixBtn.setAttribute('aria-disabled', String(locked));
      mixBtn.classList.toggle('is-idle', locked);
      mixBtn.title = locked ? MIX_LOCKED : 'Hết hàng đợi thì tự chọn bài tương tự để phát tiếp';
      drawRepeat(s.repeat || 'off');
      saveBtn.disabled = !cur;
      prevBtn.disabled = !cur;
      nextBtn.disabled = !cur;

      const p = pip.snapshot();
      let text = '';
      if (p.active) {
        // Video đang ở cửa sổ nổi: khung này chỉ báo trạng thái và cho đưa video về lại đây.
        text = s.status === 'error' ? (s.message || 'Không phát được video này.') : 'Đang phát ở cửa sổ nổi.';
      } else if (s.needsGesture) text = 'Trình duyệt cần bạn bấm một lần để bắt đầu phát.';
      else if (s.status === 'error') text = s.message || 'Không phát được video này.';
      else if (s.status === 'ended') text = s.message || 'Đã hết bài.';
      else if (s.status === 'idle') text = 'Chưa có bài để phát.';
      overlayText.textContent = text;
      overlayBtn.hidden = p.active || !s.needsGesture;
      pipBackBtn.hidden = !p.active;
      overlay.classList.toggle('on', Boolean(text) && (p.active || s.status !== 'playing'));
      stage.setAttribute('aria-busy', String(s.status === 'loading'));
      updateTime();
    }

    function renderTools() {
      const p = pip.snapshot();
      const f = fullscreen.snapshot();
      const embedOn = Boolean(media.mode) && media.mode() === 'embed';
      // Trình phát YouTube: không có cửa sổ nổi; toàn màn hình dùng nút có sẵn của YouTube (có nút thoát) nên ẩn hai nút này.
      pipBtn.hidden = embedOn || !(p.supported && p.allowed);   // không hỗ trợ hoặc không có quyền thì ẩn hẳn, kèm gợi ý bên dưới
      pipBtn.setAttribute('aria-pressed', String(p.active));
      pipBtn.setAttribute('aria-disabled', String(!p.ready));
      fsBtn.hidden = embedOn || !f.supported;
      const hint = embedOn ? '' : p.hint;
      pipHint.textContent = hint;
      pipHint.hidden = !hint;
      root.classList.toggle('with-hint', Boolean(hint));
    }

    function renderLayout() {
      const on = layout.focus() === 'left';
      clear(theaterBtn);
      theaterBtn.append(icon(on ? 'collapse' : 'expand', 20));
      theaterBtn.setAttribute('aria-label', on ? 'Hiện lại danh sách' : 'Chỉ hiện video');
      theaterBtn.title = theaterBtn.getAttribute('aria-label');
      theaterBtn.setAttribute('aria-pressed', String(on));
    }

    media.onState(render);
    pip.onChange(() => { render(controller.snapshot()); renderTools(); });
    fullscreen.onChange(renderTools);
    if (media.sound) media.sound.onChange((on) => { soundBtn.hidden = !on; });
    if (media.volume) { media.volume.onChange(drawVolume); drawVolume(media.volume.get()); }
    layout.onChange(renderLayout);
    render(controller.snapshot());
    renderTools();
    renderLayout();
    renderMode();

    // ----- nút "⋯" (chỉ hiện trên điện thoại): Tự phát, chế độ phát, Lưu, Chỉ hiện video, toàn màn hình, cửa sổ nổi -----
    function openMore() {
      const st = controller.snapshot();
      const r = REPEAT[st.repeat] || REPEAT.off;
      const p = pip.snapshot();
      const f = fullscreen.snapshot();
      const embedOn = Boolean(media.mode) && media.mode() === 'embed';
      const theater = layout.focus() === 'left';
      openActionSheet({
        title: 'Tùy chọn phát',
        actions: [
          { icon: 'mix', label: st.repeat !== 'off' ? 'Tự phát: tạm tắt' : (st.autoMix ? 'Tự phát: Bật' : 'Tự phát: Tắt'),
            onClick: () => mixBtn.click() },
          { icon: r.icon, label: `Chế độ phát: ${r.label}`, onClick: () => repeatBtn.click() },
          { icon: 'playlistAdd', label: 'Lưu vào playlist', disabled: !st.current, onClick: () => saveBtn.click() },
          { icon: theater ? 'collapse' : 'expand', label: theater ? 'Hiện lại danh sách' : 'Chỉ hiện video', onClick: () => theaterBtn.click() },
          (!embedOn && f.supported) ? { icon: 'fullscreen', label: 'Toàn màn hình', onClick: onFullscreen } : null,
          (!embedOn && p.supported && p.allowed) ? { icon: 'pip', label: p.active ? 'Đưa video về đây' : 'Cửa sổ nổi', onClick: onPip } : null,
        ],
      });
    }
    const moreBtn = h('button', { type: 'button', class: 'ctl ctl-more', 'aria-label': 'Thêm tùy chọn phát', title: 'Thêm tùy chọn', onclick: openMore }, icon('more', 26));
    const pillGroup = h('div', { class: 'pill-group' }, mixBtn, repeatBtn);
    const sideRight = h('div', { class: 'ctl-side ctl-right' }, saveBtn, moreBtn);

    root.append(
      stage,
      h('div', { class: 'now-row' }, h('div', { class: 'now' }, title, channel, sourceTag), tools),
      h('div', { class: 'seekbox' }, seek, h('div', { class: 'time' }, curTime, durTime)),
      // Lưới 3 cột (trái và phải rộng bằng nhau) nên bộ 3 nút ⏮ ▶ ⏭ luôn nằm đúng giữa.
      h('div', { class: 'ctlrow' }, h('div', { class: 'ctl-side ctl-left' }, pillGroup), h('div', { class: 'ctl-group' }, prevBtn, playBtn, nextBtn), sideRight),
      media.volume ? volRow : null,
      pipHint);
    container.append(root);
    // Co khung video cho vừa chỗ còn lại, để tên bài, thanh tua và nút điều khiển luôn thấy đủ, không phải cuộn
    // (màn xe thấp như 1024x600, màn hình dọc, chế độ chỉ hiện video). Quá thấp thì giữ cỡ tối thiểu và cho cuộn.
    let fitFrame = 0;
    function fitStage() {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = parseFloat(getComputedStyle(root).rowGap) || 0;
      const measure = () => {
        let rest = 0;
        let n = 0;
        Array.prototype.forEach.call(root.children, (c) => {
          if (c === stage) { n++; return; }
          if (c.offsetHeight > 0) { rest += c.offsetHeight; n++; }
        });
        return root.clientHeight - rest - gap * Math.max(n - 1, 0);
      };
      // Thanh âm lượng: khung quá thấp (điện thoại dọc) thì ẩn để video và nút điều khiển không phải cuộn
      // (điện thoại có nút âm lượng riêng). Màn xe 1024x600 vẫn đủ chỗ.
      // Điện thoại: không có thanh âm lượng (dùng nút âm lượng của máy).
      volRow.hidden = root.hasAttribute('data-phone');
      let room = measure();
      if (room < MIN_STAGE_REM * rem) { volRow.hidden = true; room = measure(); }
      stage.style.maxHeight = `${Math.floor(Math.max(room, MIN_STAGE_REM * rem))}px`;
    }
    const scheduleFit = () => {
      if (fitFrame) return;
      fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitStage(); });
    };
    media.onState(scheduleFit);
    // Nút dạng viên (Tự phát, chế độ phát, Lưu) chỉ còn biểu tượng khi hai bên bộ 3 nút không đủ chỗ cho cả chữ.
    function fitPills() {
      root.dataset.size = 'm';
      const over = (el) => el.scrollWidth > el.clientWidth + 1;
      if (over(pillGroup.parentNode) || over(sideRight)) root.dataset.size = 's';
    }
    onPillsChange = fitPills;
    const phoneMq = window.matchMedia ? window.matchMedia(PHONE_QUERY) : null;
    function applyPhone() {
      if (phoneMq && phoneMq.matches) root.setAttribute('data-phone', ''); else root.removeAttribute('data-phone');
      fitPills();
      scheduleFit();
    }
    if (phoneMq) {
      if (phoneMq.addEventListener) phoneMq.addEventListener('change', applyPhone); else if (phoneMq.addListener) phoneMq.addListener(applyPhone);
    }
    applyPhone();
    const stopSize = observeSize(root, () => { fitPills(); scheduleFit(); });
    return { destroy: () => {
      stopSize(); clearTimeout(tapTimer); if (fitFrame) cancelAnimationFrame(fitFrame);
      if (phoneMq) { if (phoneMq.removeEventListener) phoneMq.removeEventListener('change', applyPhone); else if (phoneMq.removeListener) phoneMq.removeListener(applyPhone); }
    } };
  },
};
