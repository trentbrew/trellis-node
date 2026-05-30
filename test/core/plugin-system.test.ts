/**
 * Tests for the Plugin System — registry, event bus, lifecycle, workspace config.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry, EventBus } from '../../src/core/plugins/registry.js';
import type { PluginDef } from '../../src/core/plugins/types.js';

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should emit and receive events', async () => {
    const received: unknown[] = [];
    bus.on('test', (data) => { received.push(data); });
    await bus.emit('test', { foo: 'bar' });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ foo: 'bar' });
  });

  it('should support wildcard handlers', async () => {
    const received: string[] = [];
    bus.on('op:*', (data) => { received.push(data as string); });
    await bus.emit('op:applied', 'a');
    await bus.emit('op:deleted', 'b');
    await bus.emit('entity:created', 'c'); // Should NOT match
    expect(received).toEqual(['a', 'b']);
  });

  it('should remove handlers with off', async () => {
    const received: unknown[] = [];
    const handler = (data: unknown) => { received.push(data); };
    bus.on('test', handler);
    await bus.emit('test', 1);
    bus.off('test', handler);
    await bus.emit('test', 2);
    expect(received).toEqual([1]);
  });

  it('should list registered events', () => {
    bus.on('a', () => {});
    bus.on('b', () => {});
    expect(bus.listEvents().sort()).toEqual(['a', 'b']);
  });

  it('should clear all handlers', async () => {
    const received: unknown[] = [];
    bus.on('test', (d) => { received.push(d); });
    bus.clear();
    await bus.emit('test', 'after-clear');
    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// PluginRegistry
// ---------------------------------------------------------------------------

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  function makePlugin(id: string, overrides?: Partial<PluginDef>): PluginDef {
    return {
      id,
      name: id,
      version: '1.0.0',
      ...overrides,
    };
  }

  it('should register a plugin', () => {
    registry.register(makePlugin('test:a'));
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('test:a')).toBeDefined();
  });

  it('should reject duplicate registration', () => {
    registry.register(makePlugin('test:a'));
    expect(() => registry.register(makePlugin('test:a'))).toThrow('already registered');
  });

  it('should load and unload a plugin', async () => {
    const loadLog: string[] = [];
    registry.register(makePlugin('test:a', {
      onLoad: (ctx) => { loadLog.push(`loaded:${ctx.pluginId}`); },
      onUnload: (ctx) => { loadLog.push(`unloaded:${ctx.pluginId}`); },
    }));

    await registry.load('test:a');
    expect(registry.isLoaded('test:a')).toBe(true);
    expect(loadLog).toEqual(['loaded:test:a']);

    await registry.unload('test:a');
    expect(registry.isLoaded('test:a')).toBe(false);
    expect(loadLog).toEqual(['loaded:test:a', 'unloaded:test:a']);
  });

  it('should resolve dependencies on load', async () => {
    const order: string[] = [];
    registry.register(makePlugin('test:base', {
      onLoad: () => { order.push('base'); },
    }));
    registry.register(makePlugin('test:child', {
      dependencies: ['test:base'],
      onLoad: () => { order.push('child'); },
    }));

    await registry.load('test:child');
    expect(order).toEqual(['base', 'child']);
    expect(registry.isLoaded('test:base')).toBe(true);
    expect(registry.isLoaded('test:child')).toBe(true);
  });

  it('should throw on missing dependency', async () => {
    registry.register(makePlugin('test:orphan', {
      dependencies: ['test:nonexistent'],
    }));
    await expect(registry.load('test:orphan')).rejects.toThrow('not registered');
  });

  it('should detect circular dependencies', () => {
    registry.register(makePlugin('test:a', { dependencies: ['test:b'] }));
    registry.register(makePlugin('test:b', { dependencies: ['test:a'] }));
    expect(registry.loadAll()).rejects.toThrow('Circular');
  });

  it('should register event handlers from plugins', async () => {
    const received: unknown[] = [];
    registry.register(makePlugin('test:events', {
      eventHandlers: [
        { event: 'entity:created', handler: (d) => { received.push(d); } },
      ],
    }));

    await registry.load('test:events');
    await registry.emit('entity:created', { id: 'proj:1' });
    expect(received).toHaveLength(1);
  });

  it('should remove event handlers on unload', async () => {
    const received: unknown[] = [];
    registry.register(makePlugin('test:events', {
      eventHandlers: [
        { event: 'test', handler: (d) => { received.push(d); } },
      ],
    }));

    await registry.load('test:events');
    await registry.emit('test', 1);
    await registry.unload('test:events');
    await registry.emit('test', 2);
    expect(received).toEqual([1]);
  });

  it('should emit plugin lifecycle events', async () => {
    const events: string[] = [];
    registry.on('plugin:loaded', (d: any) => { events.push(`loaded:${d.pluginId}`); });
    registry.on('plugin:unloaded', (d: any) => { events.push(`unloaded:${d.pluginId}`); });

    registry.register(makePlugin('test:lifecycle'));
    await registry.load('test:lifecycle');
    await registry.unload('test:lifecycle');

    expect(events).toEqual(['loaded:test:lifecycle', 'unloaded:test:lifecycle']);
  });

  it('should loadAll and unloadAll in order', async () => {
    const order: string[] = [];
    registry.register(makePlugin('test:a', {
      onLoad: () => { order.push('load:a'); },
      onUnload: () => { order.push('unload:a'); },
    }));
    registry.register(makePlugin('test:b', {
      dependencies: ['test:a'],
      onLoad: () => { order.push('load:b'); },
      onUnload: () => { order.push('unload:b'); },
    }));

    await registry.loadAll();
    expect(order).toEqual(['load:a', 'load:b']);

    await registry.unloadAll();
    expect(order).toEqual(['load:a', 'load:b', 'unload:b', 'unload:a']);
  });

  it('should list loaded plugins', async () => {
    registry.register(makePlugin('test:a'));
    registry.register(makePlugin('test:b'));
    await registry.load('test:a');

    const loaded = registry.listLoaded();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test:a');
  });

  it('should unregister a plugin', async () => {
    registry.register(makePlugin('test:a'));
    await registry.load('test:a');
    await registry.unregister('test:a');
    expect(registry.list()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Workspace Config
// ---------------------------------------------------------------------------

describe('Workspace Config', () => {
  it('should get and set config values', () => {
    const registry = new PluginRegistry();
    registry.setConfigValue('foo', 'bar');
    expect(registry.getConfigValue('foo')).toBe('bar');
  });

  it('should set full workspace config', () => {
    const registry = new PluginRegistry();
    registry.setWorkspaceConfig({
      ontologies: ['trellis:project'],
      plugins: ['test:a'],
      snapshotThreshold: 50,
    });
    const cfg = registry.getWorkspaceConfig();
    expect(cfg.ontologies).toEqual(['trellis:project']);
    expect(cfg.snapshotThreshold).toBe(50);
  });

  it('should provide config to plugins via context', async () => {
    const registry = new PluginRegistry();
    registry.setConfigValue('apiKey', 'secret123');

    let receivedKey: unknown;
    registry.register({
      id: 'test:config',
      name: 'Config Test',
      version: '1.0.0',
      onLoad: (ctx) => {
        receivedKey = ctx.getConfig('apiKey');
      },
    });

    await registry.load('test:config');
    expect(receivedKey).toBe('secret123');
  });
});

// ---------------------------------------------------------------------------
// Plugin Logging
// ---------------------------------------------------------------------------

describe('Plugin Logging', () => {
  it('should capture plugin logs', async () => {
    const registry = new PluginRegistry();
    registry.register({
      id: 'test:logger',
      name: 'Logger',
      version: '1.0.0',
      onLoad: (ctx) => {
        ctx.log('Plugin loaded successfully');
        ctx.log('Initializing...');
      },
    });

    await registry.load('test:logger');
    const logs = registry.getLogs('test:logger');
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe('Plugin loaded successfully');
  });
});
