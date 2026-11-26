import { h } from '../../core/dom.js';
import { createSplitController } from '../../core/splitController.js';
import { observeSize } from '../../core/observeSize.js';

/**
 * Khung chia đôi màn hình: hai khung và một thanh kéo ở giữa (không có tiêu đề khung để dành chỗ cho video).
 * left / right: { id, title, el }.  Trả về { el, controller, applyLayout, onChange, destroy }.
 * Phóng to một khung ("Chỉ video", "Chỉ danh sách") bằng controller.setFocus('left' | 'right' | null).
 */
export function createSplitView({ left, right, layout, draggable = true, onCommit }) {
  const labels = { left: left.title, right: right.title };
  const listeners = [];

  const pane = (def, side) => h('section', { class: `pane pane-${side}`, 'aria-label': def.title }, h('div', { class: 'pane-body' }, def.el));
  const leftPane = pane(left, 'left');
  const rightPane = pane(right, 'right');
  const divider = h('div', { class: 'divider', role: 'separator', 'aria-label': 'Kéo để đổi tỉ lệ hai khung',
    'aria-valuemin': '10', 'aria-valuemax': '90', tabindex: draggable ? '0' : '-1' });
  const root = h('div', { class: 'split', 'data-orientation': 'horizontal' }, leftPane, divider, rightPane);
  if (!draggable) root.classList.add('locked');

  function render(s) {
    root.dataset.orientation = s.orientation;
    root.dataset.focus = s.focus || '';
    root.style.setProperty('--ratio', String(s.ratio));
    divider.setAttribute('aria-orientation', s.orientation === 'horizontal' ? 'vertical' : 'horizontal');
    divider.setAttribute('aria-valuenow', String(Math.round(s.ratio * 100)));
    listeners.slice().forEach((fn) => fn(s));
  }

  const controller = createSplitController({ layout, onUpdate: render, onCommit });

  // Theo dõi kích thước để tự đổi giữa chia ngang và chia dọc.
  const stopSize = observeSize(root, (w, hgt) => controller.setSize(w, hgt));

  if (draggable) {
    const offsetOf = (e) => {
      const rect = root.getBoundingClientRect();
      return root.dataset.orientation === 'horizontal' ? e.clientX - rect.left : e.clientY - rect.top;
    };
    divider.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      divider.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
      e.preventDefault();
    });
    divider.addEventListener('pointermove', (e) => {
      if (root.classList.contains('dragging')) controller.dragTo(offsetOf(e));
    });
    const stop = () => {
      if (!root.classList.contains('dragging')) return;
      root.classList.remove('dragging');
      controller.commit();
    };
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
    divider.addEventListener('dblclick', () => controller.reset());
    divider.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const keys = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step };
      if (Object.prototype.hasOwnProperty.call(keys, e.key)) { e.preventDefault(); controller.nudge(keys[e.key]); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); controller.reset(); }
    });
  }

  return {
    el: root,
    controller,
    labels,
    applyLayout: (l) => controller.setLayout(l),
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    destroy: stopSize,
  };
}
