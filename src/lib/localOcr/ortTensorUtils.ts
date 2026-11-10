export interface DisposableOrtTensor {
  dispose?: () => void;
}

/**
 * Deterministically disposes ONNX Runtime input/output tensors in a single pass,
 * deduplicating shared or aliased tensor references and continuing cleanup if one throws.
 */
export function disposeOrtTensors(
  outputs: Record<string, DisposableOrtTensor | null | undefined> | null | undefined,
  extraTensors: Array<DisposableOrtTensor | null | undefined> = []
): void {
  const seen = new Set<object>();

  const tryDispose = (tensor: DisposableOrtTensor | null | undefined) => {
    if (!tensor || typeof tensor !== 'object') return;
    if (seen.has(tensor)) return;
    seen.add(tensor);
    if (typeof tensor.dispose === 'function') {
      try {
        tensor.dispose();
      } catch {
        // Continue releasing remaining tensors even if one disposal fails
      }
    }
  };

  if (outputs && typeof outputs === 'object') {
    for (const tensor of Object.values(outputs)) {
      tryDispose(tensor);
    }
  }
  for (const tensor of extraTensors) {
    tryDispose(tensor);
  }
}
