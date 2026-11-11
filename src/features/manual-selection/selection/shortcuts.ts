export function shouldHandleWorkspaceShortcut(e: {
  isComposing?: boolean;
  keyCode?: number;
  target?: EventTarget | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}, activeElement?: Element | null): boolean {
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  const isEditingElement = (el: unknown): boolean => {
    if (!el || typeof el !== 'object') return false;
    const htmlEl = el as { tagName?: string; isContentEditable?: boolean; getAttribute?: (k: string) => string | null };
    const tag = typeof htmlEl.tagName === 'string' ? htmlEl.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (htmlEl.isContentEditable) return true;
    if (typeof htmlEl.getAttribute === 'function' && htmlEl.getAttribute('contenteditable') === 'true') {
      return true;
    }
    return false;
  };

  if (isEditingElement(e.target)) return false;
  const active = activeElement !== undefined ? activeElement : typeof document !== 'undefined' ? document.activeElement : null;
  if (isEditingElement(active)) return false;
  return true;
}
