import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Enables Node 24's native test/smoke runner to resolve Vite extensionless `.ts` imports
// in existing repository modules (e.g., src/lib/readingOrder.ts -> ./coordinateTransforms).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith('file:')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const candidateTs = path.resolve(parentDir, `${specifier}.ts`);
      if (fs.existsSync(candidateTs)) {
        return {
          url: pathToFileURL(candidateTs).href,
          shortCircuit: true,
        };
      }
    }
    return nextResolve(specifier, context);
  },
});
