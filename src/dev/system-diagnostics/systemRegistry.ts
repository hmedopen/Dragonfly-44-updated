import type { SubsystemId, SubsystemInspector } from './types';

export class SystemRegistry {
  private readonly inspectors = new Map<SubsystemId, SubsystemInspector>();

  public register(inspector: SubsystemInspector): void {
    if (!inspector || !inspector.id) {
      throw new Error('SubsystemInspector must define a non-empty id.');
    }
    this.inspectors.set(inspector.id, inspector);
  }

  public unregister(id: SubsystemId): boolean {
    return this.inspectors.delete(id);
  }

  public get(id: SubsystemId): SubsystemInspector | undefined {
    return this.inspectors.get(id);
  }

  public has(id: SubsystemId): boolean {
    return this.inspectors.has(id);
  }

  public list(): SubsystemInspector[] {
    return Array.from(this.inspectors.values());
  }

  public clear(): void {
    this.inspectors.clear();
  }
}
