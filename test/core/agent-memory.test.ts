/**
 * Tests for the Agent Memory Plugin — graph-persisted conversations and messages.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { TrellisKernel } from '../../src/core/kernel/trellis-kernel.js';
import { BetterSqliteKernelBackend } from '../../src/core/persist/better-sqlite-backend.js';
import { PluginRegistry } from '../../src/core/plugins/registry.js';
import { OntologyRegistry } from '../../src/core/ontology/registry.js';
import { createAgentMemoryPlugin } from '../../src/plugins/agent-memory/plugin.js';
import { GraphContextManager } from '../../src/plugins/agent-memory/graph-context-manager.js';

describe('Agent Memory Plugin', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let pluginRegistry: PluginRegistry;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-memory-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();

    pluginRegistry = new PluginRegistry();
    const plugin = createAgentMemoryPlugin();
    pluginRegistry.register(plugin);
    await pluginRegistry.load(
      'trellis:agent-memory',
      kernel,
      new OntologyRegistry(),
    );
  });

  afterEach(() => {
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  it('should register the plugin successfully', () => {
    expect(pluginRegistry.isLoaded('trellis:agent-memory')).toBe(true);
  });

  it('should have the agent memory ontology', () => {
    const plugin = pluginRegistry.get('trellis:agent-memory');
    expect(plugin).toBeDefined();
    expect(plugin!.ontologies).toHaveLength(1);
    expect(plugin!.ontologies![0].id).toBe('trellis:agent-memory');
  });
});

describe('GraphContextManager', () => {
  let tmpDir: string;
  let kernel: TrellisKernel;
  let ctx: GraphContextManager;

  const waitMessages = async (count: number) => {
    for (let i = 0; i < 150; i++) {
      await ctx.awaitPersistence();
      const messages = kernel.listEntities('Message');
      const convId = ctx.getConversationId();
      const hasLinks =
        messages.length >= count &&
        (!convId ||
          kernel.getStore().getLinksByEntityAndAttribute(convId, 'hasMessage')
            .length >= count);
      if (hasLinks) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await ctx.awaitPersistence();
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-gcm-'));
    kernel = new TrellisKernel({
      backend: new BetterSqliteKernelBackend(join(tmpDir, 'kernel.db')),
      agentId: 'test-agent',
    });
    kernel.boot();
    ctx = new GraphContextManager(kernel);
  });

  afterEach(async () => {
    await ctx.awaitPersistence();
    kernel.close();
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {}
  });

  // -------------------------------------------------------------------------
  // Conversation lifecycle
  // -------------------------------------------------------------------------

  it('should create a conversation entity', async () => {
    const id = await ctx.createConversation({ title: 'Test Chat' });

    expect(id).toMatch(/^conversation:/);
    expect(ctx.getConversationId()).toBe(id);

    const entity = kernel.getEntity(id);
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('Conversation');
    const title = entity!.facts.find((f) => f.a === 'title')?.v;
    expect(title).toBe('Test Chat');
  });

  it('should create a conversation with agent and model metadata', async () => {
    const id = await ctx.createConversation({
      title: 'Design Review',
      agentId: 'agent:trellis',
      model: 'claude-opus-4-6',
      createdBy: 'user:trent',
    });

    const entity = kernel.getEntity(id);
    expect(entity).not.toBeNull();
    const get = (a: string) => entity!.facts.find((f) => f.a === a)?.v;
    expect(get('agentId')).toBe('agent:trellis');
    expect(get('model')).toBe('claude-opus-4-6');
    expect(get('createdBy')).toBe('user:trent');
  });

  it('should archive a conversation', async () => {
    await ctx.createConversation({ title: 'Temp Chat' });
    const id = ctx.getConversationId()!;

    await ctx.archiveConversation();

    expect(ctx.getConversationId()).toBeNull();
    const entity = kernel.getEntity(id);
    const status = entity!.facts.find((f) => f.a === 'status')?.v;
    expect(status).toBe('archived');
  });

  // -------------------------------------------------------------------------
  // Message persistence
  // -------------------------------------------------------------------------

  it('should persist messages as graph entities', async () => {
    await ctx.createConversation({ title: 'Test' });

    ctx.addMessage({ role: 'system', content: 'You are helpful.' });
    ctx.addMessage({ role: 'user', content: 'Hello!' });

    // Wait for async persistence
    await waitMessages(2);

    // Verify messages are in the graph
    const messages = kernel.listEntities('Message');
    expect(messages.length).toBe(2);

    const systemMsg = messages.find((m) =>
      m.facts.some((f) => f.a === 'role' && f.v === 'system'),
    );
    expect(systemMsg).toBeDefined();
    const content = systemMsg!.facts.find((f) => f.a === 'content')?.v;
    expect(content).toBe('You are helpful.');
  });

  it('should return messages from getHistory()', async () => {
    await ctx.createConversation({ title: 'Test' });

    ctx.addMessage({ role: 'user', content: 'What is 2+2?' });
    ctx.addMessage({ role: 'assistant', content: '4' });

    const history = ctx.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('What is 2+2?');
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toBe('4');
  });

  it('should persist tool messages with name and tool_call_id', async () => {
    await ctx.createConversation({ title: 'Tool Test' });

    ctx.addMessage({
      role: 'tool',
      content: '{"result": 42}',
      name: 'calculator',
      tool_call_id: 'call_abc123',
    });

    // Wait for persistence
    await new Promise((r) => setTimeout(r, 50));

    const messages = kernel.listEntities('Message');
    expect(messages).toHaveLength(1);
    const msg = messages[0];
    const get = (a: string) => msg.facts.find((f) => f.a === a)?.v;
    expect(get('role')).toBe('tool');
    expect(get('name')).toBe('calculator');
    expect(get('toolCallId')).toBe('call_abc123');
  });

  it('should link messages to their conversation', async () => {
    const convId = await ctx.createConversation({ title: 'Linked Test' });

    ctx.addMessage({ role: 'user', content: 'Hi' });
    ctx.addMessage({ role: 'assistant', content: 'Hello!' });

    // Wait for persistence
    await waitMessages(2);

    const store = kernel.getStore();
    const links = store.getLinksByEntityAndAttribute(convId, 'hasMessage');
    expect(links.length).toBe(2);
  });

  it('should throw when adding a message without an active conversation', () => {
    expect(() => {
      ctx.addMessage({ role: 'user', content: 'Orphan message' });
    }).toThrow('No active conversation');
  });

  // -------------------------------------------------------------------------
  // Resume conversation
  // -------------------------------------------------------------------------

  it('should resume an existing conversation and load messages', async () => {
    // Create and populate a conversation
    const convId = await ctx.createConversation({ title: 'Resumable' });
    ctx.addMessage({ role: 'system', content: 'You are a bot.' });
    ctx.addMessage({ role: 'user', content: 'Remember me?' });
    ctx.addMessage({ role: 'assistant', content: 'Of course!' });

    // Wait for persistence
    await waitMessages(3);

    // Create a fresh context manager and resume
    const ctx2 = new GraphContextManager(kernel);
    await ctx2.resumeConversation(convId);

    expect(ctx2.getConversationId()).toBe(convId);
    const history = ctx2.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].role).toBe('system');
    expect(history[1].role).toBe('user');
    expect(history[2].role).toBe('assistant');
    expect(history[2].content).toBe('Of course!');
  });

  it('should throw when resuming a non-existent conversation', async () => {
    await expect(ctx.resumeConversation('conversation:fake')).rejects.toThrow(
      'not found',
    );
  });

  // -------------------------------------------------------------------------
  // Pruning
  // -------------------------------------------------------------------------

  it('should prune oldest non-system messages when over token budget', async () => {
    await ctx.createConversation({ title: 'Prune Test' });

    ctx.addMessage({ role: 'system', content: 'System prompt' });
    // Add several messages to exceed budget
    for (let i = 0; i < 10; i++) {
      ctx.addMessage({ role: 'user', content: 'A'.repeat(200) }); // ~50 tokens each
    }

    expect(ctx.getHistory()).toHaveLength(11); // 1 system + 10 user

    // Prune to ~200 tokens budget
    await ctx.prune(200);

    const history = ctx.getHistory();
    // System message should be preserved
    expect(history[0].role).toBe('system');
    // Some user messages should be archived
    expect(history.length).toBeLessThan(11);
    expect(history.length).toBeGreaterThan(0);
  });

  it('should mark pruned messages as archived in the graph', async () => {
    await ctx.createConversation({ title: 'Archive Test' });

    ctx.addMessage({ role: 'user', content: 'A'.repeat(400) }); // ~100 tokens
    ctx.addMessage({ role: 'user', content: 'B'.repeat(400) }); // ~100 tokens
    ctx.addMessage({ role: 'user', content: 'C'.repeat(400) }); // ~100 tokens

    // Wait for persistence
    await new Promise((r) => setTimeout(r, 50));

    // Prune to 150 tokens — should archive at least the first message
    await ctx.prune(150);

    // Wait for archive persistence
    await new Promise((r) => setTimeout(r, 50));

    // Check that archived messages have status='archived' in graph
    const allMessages = kernel.listEntities('Message');
    const archived = allMessages.filter((m) =>
      m.facts.some((f) => f.a === 'status' && f.v === 'archived'),
    );
    expect(archived.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  it('should list conversations', async () => {
    await ctx.createConversation({ title: 'Chat 1' });
    ctx.addMessage({ role: 'user', content: 'Hello' });

    // Wait for persistence
    await waitMessages(1);

    const ctx2 = new GraphContextManager(kernel);
    await ctx2.createConversation({ title: 'Chat 2' });

    const all = ctx2.listConversations();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.title).sort()).toEqual(['Chat 1', 'Chat 2']);
  });

  it('should filter conversations by status', async () => {
    await ctx.createConversation({ title: 'Active Chat' });
    const archivedCtx = new GraphContextManager(kernel);
    await archivedCtx.createConversation({ title: 'Old Chat' });
    await archivedCtx.archiveConversation();

    const active = ctx.listConversations('active');
    expect(active).toHaveLength(1);
    expect(active[0].title).toBe('Active Chat');
  });

  it('should report message and token counts', async () => {
    await ctx.createConversation({ title: 'Count Test' });

    ctx.addMessage({ role: 'user', content: 'Hello world' }); // ~2.75 tokens
    ctx.addMessage({ role: 'assistant', content: 'Hi there!' }); // ~2.25 tokens

    expect(ctx.getMessageCount()).toBe(2);
    expect(ctx.getTotalTokenCount()).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Token calculation
  // -------------------------------------------------------------------------

  it('should estimate token count from content length', () => {
    const count = ctx.calculateTokenCount({
      role: 'user',
      content: 'Hello world!',
    });
    // "Hello world!" = 12 chars / 4 ≈ 3 tokens
    expect(count).toBe(3);
  });

  it('should handle null content in token count', () => {
    const count = ctx.calculateTokenCount({ role: 'assistant', content: null });
    expect(count).toBe(0);
  });
});
