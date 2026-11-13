import { pickMix } from './mix.js';

/**
 * Điều phối phát nhạc/video: hàng đợi, lấy luồng từ máy chủ, phát, tự chuyển bài, và chế độ "Mix"
 * (hết hàng đợi thì tự chọn bài liên quan để phát tiếp, giống Mix của YouTube).
 * engine: { load(info) -> Promise<bool>, play(), pause(), isPaused() } (thẻ video của website hoặc trình phát YouTube, xem media.js)
 */
export function createPlayerController({ youtube, queue, engine, getTime = () => 0, setTime = () => {}, notify = () => {}, onState = () => {}, rand = Math.random, maxSkips = 3 }) {
  // repeat (chế độ phát, một nút bấm đổi vòng): 'off' (lần lượt) | 'all' (lặp tất cả) | 'one' (lặp 1 bài) | 'shuffle' (trộn bài:
  // phát NGẪU NHIÊN các bài trong hàng đợi, KHÔNG sắp xếp lại hàng đợi, mỗi bài một lần mỗi lượt; hết lượt thì trộn lượt mới).
  // autoMix (Tự phát) chỉ có tác dụng ở chế độ Lần lượt ('off'); lặp hay trộn bài thì không tự tìm bài.
  // userPaused: lần dừng gần nhất là do người dùng bấm (nút, phím nhạc) - khác với trình duyệt/hệ điều hành tự dừng (giai đoạn 13).
  const state = { status: 'idle', current: null, info: null, autoMix: true, repeat: 'off', needsGesture: false, message: '', userPaused: false };
  let loadToken = 0;
  let skips = 0;
  let shuffleDone = new Set();   // trộn bài: các bài đã phát trong lượt này
  let shuffleBack = [];          // trộn bài: các bài đã phát theo thứ tự (cho nút "Bài trước")
  const mixAllowed = () => state.autoMix && state.repeat === 'off';

  const emit = () => onState({ ...state });
  const snapshot = () => ({ ...state });

  async function fail(token, message) {
    if (token !== loadToken) return false;
    if (state.repeat === 'shuffle' && state.current) shuffleDone.add(state.current.id);   // trộn bài: không chọn lại bài lỗi
    state.status = 'error';
    state.message = message;
    emit();
    skips += 1;
    if (skips <= maxSkips) {
      notify(`${message} Đang chuyển sang bài khác...`);
      return next();
    }
    skips = 0;
    notify(message);
    return false;
  }

  // Điền tên bài/kênh khi mới biết (bài "placeholder": video mặc định chỉ có mã).
  function fillMeta(id, meta) {
    const updated = queue.updateMeta(id, Object.assign({}, meta, { placeholder: false }));
    if (updated && state.current && state.current.id === id) { state.current = updated; emit(); }
  }

  async function playCurrent(autoplay = true) {
    const item = queue.snapshot().current;
    if (!item) { state.status = 'idle'; emit(); return false; }
    loadToken += 1;
    const token = loadToken;
    Object.assign(state, { status: 'loading', current: item, message: '', needsGesture: false, userPaused: false });
    emit();

    let info;
    try {
      info = await youtube.stream(item.id);
    } catch (e) {
      return fail(token, (e && e.message) || 'Không lấy được video.');
    }
    if (token !== loadToken) return false;
    state.info = info;
    if (item.placeholder && info && info.title) fillMeta(item.id, { title: info.title, uploader: info.uploader || '', duration: info.duration || 0 });
    const ok = await engine.load(info);
    if (token !== loadToken) return false;
    if (!ok) return fail(token, 'Không phát được video này.');

    queue.markPlayed(item.id);
    if (state.repeat === 'shuffle' && !shuffleDone.has(item.id)) { shuffleDone.add(item.id); shuffleBack.push(item.id); }
    if (autoplay) {
      try {
        await engine.play();
        state.status = 'playing';
        skips = 0;
      } catch (e) {
        if (e && e.name === 'NotAllowedError') { state.needsGesture = true; state.status = 'paused'; }   // trình duyệt chặn tự phát: chờ người dùng bấm
        else if (e && e.name === 'PlayPending') { state.status = 'paused'; skips = 0; }   // trình phát YouTube chưa chạy (quảng cáo, mạng chậm): không báo lỗi, chờ sự kiện phát
        else return fail(token, 'Không phát được video này.');
      }
    } else {
      state.status = 'paused';
    }
    emit();
    return true;
  }

  // Bài kế tiếp từ gợi ý liên quan của bài đang phát; nếu hết thì tìm theo tên bài; cuối cùng là danh sách nhạc mặc định.
  async function findMix() {
    const history = queue.snapshot().history;
    const cur = state.current;
    const opts = { history, exclude: cur ? [cur.id] : [], rand };
    let pick = pickMix(state.info ? state.info.related : [], opts);
    if (pick) return pick;
    try {
      if (cur) pick = pickMix((await youtube.search(cur.title)).items, opts);
      if (pick) return pick;
    } catch (e) { /* thử cách tiếp theo */ }
    try {
      return pickMix((await youtube.trending()).items, opts);
    } catch (e) {
      return null;
    }
  }

  // Sang bài kế (hết bài, bỏ qua bài lỗi, bấm "Bài kế tiếp").
  // Lặp toàn bộ: hết hàng đợi thì quay về bài đầu. Tự phát chỉ tìm bài mới khi KHÔNG lặp và đã hết hàng đợi.
  // Bắt đầu lượt trộn mới: bài đang phát tính là đã phát.
  function resetShuffle() {
    shuffleDone = new Set();
    shuffleBack = [];
    const cur = queue.snapshot().current;
    if (cur) { shuffleDone.add(cur.id); shuffleBack.push(cur.id); }
  }
  function setRepeat(mode) {
    const m = mode === 'all' || mode === 'one' || mode === 'shuffle' ? mode : 'off';
    if (m === 'shuffle' && state.repeat !== 'shuffle') resetShuffle();
    state.repeat = m;
    emit();
  }

  // Trộn bài: chọn ngẫu nhiên một bài CHƯA phát trong lượt này (hàng đợi giữ nguyên thứ tự). Hết bài thì trả -1.
  function pickShuffle() {
    const s = queue.snapshot();
    const left = [];
    s.items.forEach((it, i) => { if (i !== s.index && !shuffleDone.has(it.id)) left.push(i); });
    return left.length ? left[Math.floor(rand() * left.length)] : -1;
  }

  async function next() {
    if (state.repeat === 'shuffle') {
      let i = pickShuffle();
      // Hết một lượt (mọi bài đã phát): trộn lại lượt mới và phát tiếp, không dừng (bài vừa phát không bị chọn lại ngay).
      if (i < 0 && queue.snapshot().items.length > 1) { resetShuffle(); i = pickShuffle(); }
      if (i >= 0) { queue.jump(i); return playCurrent(); }
    } else {
      if (queue.hasNext()) { queue.next(); return playCurrent(); }
      if (state.repeat === 'all' && queue.snapshot().items.length) { queue.restart(); return playCurrent(); }
    }
    if (!mixAllowed()) {
      state.status = 'ended';
      emit();
      return false;
    }
    const item = await findMix();
    if (!item) {
      state.status = 'ended';
      state.message = 'Đã hết bài để phát.';
      emit();
      return false;
    }
    queue.appendAndSelect(item);
    return playCurrent();
  }

  return {
    snapshot,
    setAutoMix(on) { state.autoMix = Boolean(on); emit(); },
    setRepeat,
    // Nút chế độ phát: Lần lượt -> Lặp tất cả -> Lặp 1 bài -> Trộn bài -> Lần lượt.
    cycleRepeat() {
      const order = ['off', 'all', 'one', 'shuffle'];
      setRepeat(order[(order.indexOf(state.repeat) + 1) % order.length]);
      return state.repeat;
    },
    autoMixActive: () => mixAllowed(),

    // Thay hàng đợi bằng danh sách mới và phát từ vị trí start.
    async playList(items, start = 0, autoplay = true) {
      skips = 0;
      queue.setItems(items, start);
      if (state.repeat === 'shuffle') resetShuffle();   // hàng đợi mới: lượt trộn mới
      return playCurrent(autoplay);
    },
    // Phát ngay một bài (chèn sau bài đang phát, giữ nguyên phần còn lại của hàng đợi).
    async playNow(item) {
      skips = 0;
      queue.playNow(item);
      return playCurrent();
    },
    async playIndex(i) {
      skips = 0;
      if (!queue.jump(i)) return false;
      return playCurrent();
    },
    enqueue(item) { return queue.add(item); },
    next: () => { skips = 0; return next(); },
    async prev() {
      const s = queue.snapshot();
      if (state.repeat === 'shuffle') {   // trộn bài: "Bài trước" quay lại bài vừa phát trước đó
        if (getTime() > 3 || shuffleBack.length < 2) { setTime(0); return true; }
        shuffleBack.pop();
        const back = shuffleBack[shuffleBack.length - 1];
        const i = s.items.findIndex((it) => it.id === back);
        if (i < 0) { setTime(0); return true; }
        queue.jump(i);
        return playCurrent();
      }
      if (getTime() > 3 || (s.index <= 0 && !(state.repeat === 'all' && s.items.length > 1))) { setTime(0); return true; }
      if (s.index <= 0) queue.last(); else queue.prev();   // lặp toàn bộ: bài đầu bấm "Bài trước" thì về bài cuối
      return playCurrent();
    },
    // Phát/dừng. Dùng cho nút bấm và cả khi người dùng chạm lần đầu để vượt chặn tự phát.
    async toggle() {
      if (!state.current) return false;
      if (engine.isPaused()) {
        try { await engine.play(); state.status = 'playing'; state.needsGesture = false; state.userPaused = false; } catch (e) { return false; }
      } else {
        engine.pause();
        state.status = 'paused';
        state.userPaused = true;
      }
      emit();
      return true;
    },
    // Đồng bộ trạng thái từ sự kiện của thẻ video (người dùng bấm điều khiển hệ thống, tai nghe...).
    syncPlaying(isPlaying) {
      if (state.status === 'loading' || state.status === 'error') return;
      state.status = isPlaying ? 'playing' : 'paused';
      if (isPlaying) { state.needsGesture = false; state.userPaused = false; }
      emit();
    },
    // Hết một bài: Lặp 1 bài thì phát lại chính bài đó (tính là một lượt nghe mới).
    handleEnded() {
      skips = 0;
      if (state.repeat === 'one' && queue.snapshot().current) return playCurrent();
      return next();
    },
    // Trình phát YouTube báo tên bài thật (chỉ dùng cho bài chưa biết tên).
    updateMeta(id, meta) {
      const cur = state.current;
      if (!cur || cur.id !== id || !cur.placeholder || !meta || !meta.title) return;
      fillMeta(id, { title: meta.title, uploader: meta.uploader || '' });
    },
    handleFatal(message) { return fail(loadToken, message || 'Mất kết nối với luồng phát.'); },
  };
}
