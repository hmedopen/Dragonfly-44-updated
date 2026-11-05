/**
 * Focus Registry for Zero-Focus-Loss Character Injection
 * Preserves the active translation textarea reference across virtual keyboard clicks.
 */

class FocusRegistry {
  private activeTextarea: HTMLTextAreaElement | null = null;

  public register(el: HTMLTextAreaElement | null) {
    if (el) {
      this.activeTextarea = el;
    }
  }

  public unregister(el: HTMLTextAreaElement) {
    if (this.activeTextarea === el) {
      this.activeTextarea = null;
    }
  }

  public getActiveElement(): HTMLTextAreaElement | null {
    if (this.activeTextarea && document.body.contains(this.activeTextarea)) {
      return this.activeTextarea;
    }
    const docActive = document.activeElement;
    if (docActive instanceof HTMLTextAreaElement) {
      this.activeTextarea = docActive;
      return docActive;
    }
    return null;
  }

  public insertCharacter(char: string): boolean {
    const el = this.getActiveElement();
    if (!el) return false;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const text = el.value;

    const updated = text.substring(0, start) + char + text.substring(end);
    const newPos = start + char.length;

    // React controlled textarea update
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(el, updated);
    } else {
      el.value = updated;
    }

    el.selectionStart = newPos;
    el.selectionEnd = newPos;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  public backspace(): boolean {
    const el = this.getActiveElement();
    if (!el) return false;

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const text = el.value;

    let updated: string;
    let newPos: number;

    if (start === end) {
      if (start === 0) return true;
      updated = text.substring(0, start - 1) + text.substring(end);
      newPos = start - 1;
    } else {
      updated = text.substring(0, start) + text.substring(end);
      newPos = start;
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(el, updated);
    } else {
      el.value = updated;
    }

    el.selectionStart = newPos;
    el.selectionEnd = newPos;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}

export const focusRegistry = new FocusRegistry();
