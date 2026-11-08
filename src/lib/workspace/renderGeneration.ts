/**
 * Folio Script: System #6 — Settings, Workspace & Quality Benchmark Engine
 * Asynchronous Rendering Generation Guard
 * 
 * Prevents race conditions and stale asynchronous scan/review results
 * from rendering over newer pages or active selections.
 */

export interface ActiveGenerationToken {
  pageId: string;
  generation: number;
  timestamp: number;
}

export class RenderGenerationManager {
  private activeToken: ActiveGenerationToken | null = null;
  private currentGeneration = 0;
  private staleRejectionsCount = 0;

  /**
   * Called whenever the user or system switches the active page.
   * Increments generation and creates a new immutable token.
   */
  startNewGeneration(pageId: string): ActiveGenerationToken {
    this.currentGeneration++;
    this.activeToken = {
      pageId,
      generation: this.currentGeneration,
      timestamp: Date.now(),
    };
    return { ...this.activeToken };
  }

  /**
   * Checks whether an asynchronous result is still fresh and matches the active page.
   */
  isFresh(pageId: string, generation: number): boolean {
    if (!this.activeToken) return false;
    const match = this.activeToken.pageId === pageId && this.activeToken.generation === generation;
    if (!match) {
      this.staleRejectionsCount++;
    }
    return match;
  }

  getActiveToken(): ActiveGenerationToken | null {
    return this.activeToken ? { ...this.activeToken } : null;
  }

  getStaleRejectionsCount(): number {
    return this.staleRejectionsCount;
  }

  reset() {
    this.activeToken = null;
    this.currentGeneration = 0;
    this.staleRejectionsCount = 0;
  }
}

export const renderGenerationManager = new RenderGenerationManager();
