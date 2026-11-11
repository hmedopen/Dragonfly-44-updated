export interface FloatingWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampFloatingGeometry(
  geom: FloatingWindowGeometry,
  viewportWidth: number,
  viewportHeight: number,
  minWidth: number,
  minHeight: number
): FloatingWindowGeometry {
  const safeVw = Math.max(320, viewportWidth);
  const safeVh = Math.max(240, viewportHeight);
  const maxW = Math.max(260, safeVw - 24);
  const maxH = Math.max(180, safeVh - 24);
  const effectiveMinW = Math.min(minWidth, maxW);
  const effectiveMinH = Math.min(minHeight, maxH);

  const width = Math.round(Math.min(maxW, Math.max(effectiveMinW, geom.width)));
  const height = Math.round(Math.min(maxH, Math.max(effectiveMinH, geom.height)));
  const maxX = Math.max(12, safeVw - width - 12);
  const maxY = Math.max(12, safeVh - Math.min(height, safeVh - 24) - 12);
  const x = Math.round(Math.max(12, Math.min(maxX, geom.x)));
  const y = Math.round(Math.max(12, Math.min(maxY, geom.y)));

  return { x, y, width, height };
}

export function loadFloatingGeometry(
  storageKey: string,
  defaultGeometry: FloatingWindowGeometry,
  minWidth: number,
  minHeight: number
): FloatingWindowGeometry {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 820;

  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed?.x === 'number' &&
        typeof parsed?.y === 'number' &&
        typeof parsed?.width === 'number' &&
        typeof parsed?.height === 'number'
      ) {
        return clampFloatingGeometry(parsed, vw, vh, minWidth, minHeight);
      }
    }
  } catch {
    // Fallback to clamped defaults
  }

  return clampFloatingGeometry(defaultGeometry, vw, vh, minWidth, minHeight);
}
