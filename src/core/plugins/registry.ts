/**
 * Plugin Registry — Load, register, and manage plugins.
 *
 * Handles plugin lifecycle, dependency resolution, event dispatching,
 * and workspace configuration.
 *
 * @module trellis/core/plugins
 */

import type { TrellisKernel } from '../kernel/trellis-kernel.js';
import type { OntologyRegistry } from '../ontology/registry.js';
import type { QueryEngine } from '../query/engine.js';
import type {
  PluginDef,
  PluginContext,
  PluginManifest,
  EventCallback,
  EventHandler,
  WorkspaceConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

export class EventBus {
  private handlers: Map<string, Set<EventCallback>> = new Map();

  on(event: string, handler: EventCallback): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: EventCallback): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(event);
    }
  }

  async emit(event: string, data?: unknown): Promise<void> {
    // Exact match
    const exact = this.handlers.get(event);
    if (exact) {
      for (const h of exact) await h(data);
    }

    // Wildcard match (e.g. "op:*" matches "op:applied")
    for (const [pattern, handlers] of this.handlers) {
      if (pattern === event) continue; // Already handled
      if (pattern.endsWith('*') && event.startsWith(pattern.slice(0, -1))) {
        for (const h of handlers) await h(data);
      }
    }
  }

  listEvents(): string[] {
    return [...this.handlers.keys()];
  }

  clear(): void {
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Plugin Registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private plugins: Map<string, { def: PluginDef; loaded: boolean }> = new Map();
  private eventBus: EventBus = new EventBus();
  private workspaceConfig: WorkspaceConfig = {};
  private logs: Array<{ pluginId: string; message: string; timestamp: string }> = [];

  /**
   * Register a plugin definition. Does not load it yet.
   */
  register(def: PluginDef): void {
    if (this.plugins.has(def.id)) {
      throw new Error(`Plugin "${def.id}" is already registered.`);
    }
    this.plugins.set(def.id, { def, loaded: false });
  }

  /**
   * Unregister a plugin. Unloads it first if loaded.
   */
  async unregister(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) return;
    if (entry.loaded) await this.unload(id);
    this.plugins.delete(id);
  }

  /**
   * Load a plugin (call onLoad, register middleware/ontologies/rules/events).
   * Resolves dependencies first.
   */
  async load(
    id: string,
    kernel?: TrellisKernel,
    ontologyRegistry?: OntologyRegistry,
    queryEngine?: QueryEngine,
  ): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) throw new Error(`Plugin "${id}" is not registered.`);
    if (entry.loaded) return;

    // Check dependencies
    if (entry.def.dependencies) {
      for (const dep of entry.def.dependencies) {
        const depEntry = this.plugins.get(dep);
        if (!depEntry) {
          throw new Error(`Plugin "${id}" depends on "${dep}" which is not registered.`);
        }
        if (!depEntry.loaded) {
          await this.load(dep, kernel, ontologyRegistry, queryEngine);
        }
      }
    }

    // Register middleware
    if (entry.def.middleware && kernel) {
      for (const mw of entry.def.middleware) {
        kernel.addMiddleware(mw);
      }
    }

    // Register ontologies
    if (entry.def.ontologies && ontologyRegistry) {
      for (const schema of entry.def.ontologies) {
        try { ontologyRegistry.register(schema); } catch {}
      }
    }

    // Register rules
    if (entry.def.rules && queryEngine) {
      for (const rule of entry.def.rules) {
        queryEngine.addRule(rule);
      }
    }

    // Register event handlers
    if (entry.def.eventHandlers) {
      for (const eh of entry.def.eventHandlers) {
        this.eventBus.on(eh.event, eh.handler);
      }
    }

    // Build plugin context
    const ctx = this._buildContext(id);

    // Call onLoad
    if (entry.def.onLoad) {
      await entry.def.onLoad(ctx);
    }

    entry.loaded = true;
    await this.eventBus.emit('plugin:loaded', { pluginId: id });
  }

  /**
   * Unload a plugin (call onUnload, remove middleware/events).
   */
  async unload(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry || !entry.loaded) return;

    const ctx = this._buildContext(id);
    if (entry.def.onUnload) {
      await entry.def.onUnload(ctx);
    }

    // Remove event handlers
    if (entry.def.eventHandlers) {
      for (const eh of entry.def.eventHandlers) {
        this.eventBus.off(eh.event, eh.handler);
      }
    }

    entry.loaded = false;
    await this.eventBus.emit('plugin:unloaded', { pluginId: id });
  }

  /**
   * Load all registered plugins in dependency order.
   */
  async loadAll(
    kernel?: TrellisKernel,
    ontologyRegistry?: OntologyRegistry,
    queryEngine?: QueryEngine,
  ): Promise<void> {
    const order = this._resolveDependencyOrder();
    for (const id of order) {
      await this.load(id, kernel, ontologyRegistry, queryEngine);
    }
  }

  /**
   * Unload all plugins in reverse order.
   */
  async unloadAll(): Promise<void> {
    const order = this._resolveDependencyOrder().reverse();
    for (const id of order) {
      await this.unload(id);
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  get(id: string): PluginDef | undefined {
    return this.plugins.get(id)?.def;
  }

  isLoaded(id: string): boolean {
    return this.plugins.get(id)?.loaded ?? false;
  }

  list(): Array<{ def: PluginDef; loaded: boolean }> {
    return [...this.plugins.values()];
  }

  listLoaded(): PluginDef[] {
    return [...this.plugins.values()]
      .filter((e) => e.loaded)
      .map((e) => e.def);
  }

  // -------------------------------------------------------------------------
  // Event bus access
  // -------------------------------------------------------------------------

  getEventBus(): EventBus {
    return this.eventBus;
  }

  async emit(event: string, data?: unknown): Promise<void> {
    await this.eventBus.emit(event, data);
  }

  on(event: string, handler: EventCallback): void {
    this.eventBus.on(event, handler);
  }

  // -------------------------------------------------------------------------
  // Workspace config
  // -------------------------------------------------------------------------

  getWorkspaceConfig(): WorkspaceConfig {
    return this.workspaceConfig;
  }

  setWorkspaceConfig(config: WorkspaceConfig): void {
    this.workspaceConfig = config;
  }

  getConfigValue(key: string): unknown {
    return this.workspaceConfig.settings?.[key];
  }

  setConfigValue(key: string, value: unknown): void {
    if (!this.workspaceConfig.settings) this.workspaceConfig.settings = {};
    this.workspaceConfig.settings[key] = value;
  }

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  getLogs(pluginId?: string): typeof this.logs {
    if (pluginId) return this.logs.filter((l) => l.pluginId === pluginId);
    return [...this.logs];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _buildContext(pluginId: string): PluginContext {
    return {
      pluginId,
      on: (event, handler) => this.eventBus.on(event, handler),
      emit: (event, data) => { this.eventBus.emit(event, data); },
      getConfig: (key) => this.getConfigValue(key),
      log: (message) => {
        this.logs.push({ pluginId, message, timestamp: new Date().toISOString() });
      },
    };
  }

  private _resolveDependencyOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string, stack: Set<string>) => {
      if (visited.has(id)) return;
      if (stack.has(id)) throw new Error(`Circular dependency detected: ${[...stack, id].join(' → ')}`);

      stack.add(id);
      const entry = this.plugins.get(id);
      if (entry?.def.dependencies) {
        for (const dep of entry.def.dependencies) {
          visit(dep, stack);
        }
      }
      stack.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of this.plugins.keys()) {
      visit(id, new Set());
    }

    return order;
  }
}
