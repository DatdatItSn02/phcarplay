// Sổ đăng ký các "panel" (khung chức năng). Muốn thêm chức năng mới vào màn hình chính:
// viết một module có { id, title, mount(container, ctx) } rồi registerPanel(...).
const panels = new Map();

export function registerPanel(def) {
  if (!def || !def.id || typeof def.mount !== 'function') throw new Error('Panel không hợp lệ');
  panels.set(def.id, def);
}

export function getPanel(id) {
  const def = panels.get(id);
  if (!def) throw new Error(`Chưa đăng ký panel "${id}"`);
  return def;
}

export const listPanels = () => [...panels.values()];
