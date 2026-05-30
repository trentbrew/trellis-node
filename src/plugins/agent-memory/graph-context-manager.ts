/**
 * Graph Context Manager — Persists conversation history as entities in the Trellis graph.
 *
 * Implements the ContextManager interface but backs every message with a
 * kernel entity, making conversations queryable via EQL-S and persistent
 * across sessions and devices.
 *
 * @module trellis/plugins/agent-memory
 */

import type { LLMMessage } from '../../llm/types.js';
import type { ContextManager } from '../../context/types.js';
import type { TrellisKernel } from '../../core/kernel/trellis-kernel.js';
import type { Atom } from '../../core/store/eav-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationOptions {
  title: string;
  agentId?: string;
  model?: string;
  createdBy?: string;
}

interface MessageRecord {
  entityId: string;
  message: LLMMessage;
  timestamp: string;
  status: 'active' | 'archived';
}

// ---------------------------------------------------------------------------
// Global counter for unique IDs across instances
// ---------------------------------------------------------------------------

let globalIdCounter = 0;

// ---------------------------------------------------------------------------
// Graph Context Manager
// ---------------------------------------------------------------------------

export class GraphContextManager implements ContextManager {
  private kernel: TrellisKernel;
  private conversationId: string | null = null;
  private messageCounter = 0;

  /**
   * In-memory cache of active messages for fast getHistory() reads.
   * Always kept in sync with the graph via addMessage/prune/resume.
   */
  private cache: MessageRecord[] = [];

  /** In-flight graph writes from fire-and-forget addMessage/prune calls. */
  private pendingWrites = new Set<Promise<void>>();

  constructor(kernel: TrellisKernel) {
    this.kernel = kernel;
  }

  // -------------------------------------------------------------------------
  // Conversation lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a new conversation entity and set it as the active context.
   * Returns the conversation entity ID.
   */
  async createConversation(opts: ConversationOptions): Promise<string> {
    const id = `conversation:${Date.now()}:${++globalIdCounter}`;
    const attrs: Record<string, Atom> = {
      title: opts.title,
      status: 'active',
    };
    if (opts.agentId) attrs.agentId = opts.agentId;
    if (opts.model) attrs.model = opts.model;
    if (opts.createdBy) attrs.createdBy = opts.createdBy;

    await this.kernel.createEntity(id, 'Conversation', attrs);
    this.conversationId = id;
    this.cache = [];
    this.messageCounter = 0;
    return id;
  }

  /**
   * Resume an existing conversation by loading its messages from the graph.
   */
  async resumeConversation(conversationId: string): Promise<void> {
    const entity = this.kernel.getEntity(conversationId);
    if (!entity || entity.type !== 'Conversation') {
      throw new Error(`Conversation "${conversationId}" not found.`);
    }

    this.conversationId = conversationId;
    this.cache = this._loadMessagesFromGraph(conversationId);
    this.messageCounter = this.cache.length;
  }

  /**
   * Get the active conversation ID, or null if none is set.
   */
  getConversationId(): string | null {
    return this.conversationId;
  }

  /**
   * Archive the active conversation and clear local state.
   */
  async archiveConversation(): Promise<void> {
    if (!this.conversationId) return;
    await this.kernel.updateEntity(this.conversationId, { status: 'archived' });
    this.conversationId = null;
    this.cache = [];
  }

  // -------------------------------------------------------------------------
  // ContextManager implementation
  // -------------------------------------------------------------------------

  addMessage(message: LLMMessage): void {
    if (!this.conversationId) {
      throw new Error('GraphContextManager: No active conversation. Call createConversation() first.');
    }

    const timestamp = new Date().toISOString();
    const entityId = `message:${this.conversationId.replace('conversation:', '')}:${++globalIdCounter}`;

    const attrs: Record<string, Atom> = {
      role: message.role,
      timestamp,
      status: 'active',
    };
    if (message.content != null) attrs.content = message.content;
    if (message.name) attrs.name = message.name;
    if (message.tool_call_id) attrs.toolCallId = message.tool_call_id;

    const tokenCount = this.calculateTokenCount(message);
    attrs.tokenCount = tokenCount;

    // Fire-and-forget: persist to graph asynchronously.
    // The cache is updated synchronously so getHistory() is always fast.
    const write = this.kernel
      .createEntity(entityId, 'Message', attrs, [
        { attribute: 'hasMessage', targetEntityId: entityId },
      ])
      .then(() => {
        // Link from conversation to message
        return this.kernel.addLink(this.conversationId!, 'hasMessage', entityId);
      })
      .catch((err) => {
        console.error(`GraphContextManager: Failed to persist message ${entityId}:`, err);
      })
      .then(() => undefined);
    this.trackWrite(write);

    this.cache.push({
      entityId,
      message,
      timestamp,
      status: 'active',
    });
  }

  getHistory(): LLMMessage[] {
    return this.cache
      .filter((r) => r.status === 'active')
      .map((r) => r.message);
  }

  async prune(targetTokenCount: number): Promise<void> {
    // Calculate total tokens in active messages
    let totalTokens = 0;
    const active = this.cache.filter((r) => r.status === 'active');

    for (const record of active) {
      totalTokens += this.calculateTokenCount(record.message);
    }

    if (totalTokens <= targetTokenCount) return;

    // Archive oldest non-system messages until under budget.
    // System messages are preserved to maintain conversation context.
    for (const record of active) {
      if (totalTokens <= targetTokenCount) break;
      if (record.message.role === 'system') continue;

      record.status = 'archived';
      totalTokens -= this.calculateTokenCount(record.message);

      // Persist the archive status to graph
      const write = this.kernel
        .updateEntity(record.entityId, { status: 'archived' })
        .catch((err) => {
          console.error(`GraphContextManager: Failed to archive message ${record.entityId}:`, err);
        })
        .then(() => undefined);
      this.trackWrite(write);
    }
  }

  async summarize(): Promise<string> {
    // Future: use LLM to summarize archived messages
    const archived = this.cache.filter((r) => r.status === 'archived');
    if (archived.length === 0) return '';
    return `[${archived.length} earlier messages archived]`;
  }

  async injectRagContext(query: string, limit?: number): Promise<void> {
    // Future: integrate with src/embeddings/ for semantic search over conversation history
  }

  calculateTokenCount(message: LLMMessage): number {
    return (message.content?.length ?? 0) / 4; // rough estimate (4 chars/token)
  }

  // -------------------------------------------------------------------------
  // Graph queries
  // -------------------------------------------------------------------------

  /**
   * List all conversations, optionally filtered by status.
   */
  listConversations(status?: 'active' | 'archived'): Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
    messageCount: number;
  }> {
    const entities = this.kernel.listEntities('Conversation', status ? { status } : undefined);
    return entities.map((e) => {
      const get = (a: string) => e.facts.find((f) => f.a === a)?.v;
      const messageLinks = this.kernel.getStore().getLinksByEntityAndAttribute(e.id, 'hasMessage');
      return {
        id: e.id,
        title: String(get('title') ?? 'Untitled'),
        status: String(get('status') ?? 'active'),
        createdAt: String(get('createdAt') ?? ''),
        messageCount: messageLinks.length,
      };
    });
  }

  /**
   * Get the total message count for the active conversation.
   */
  getMessageCount(): number {
    return this.cache.filter((r) => r.status === 'active').length;
  }

  /**
   * Get the total estimated token count for the active conversation.
   */
  getTotalTokenCount(): number {
    return this.cache
      .filter((r) => r.status === 'active')
      .reduce((sum, r) => sum + this.calculateTokenCount(r.message), 0);
  }

  /** Wait for in-flight graph writes (tests and graceful shutdown). */
  async awaitPersistence(): Promise<void> {
    while (this.pendingWrites.size > 0) {
      await Promise.all([...this.pendingWrites]);
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private trackWrite(write: Promise<void>): void {
    this.pendingWrites.add(write);
    write.finally(() => {
      this.pendingWrites.delete(write);
    });
  }

  /**
   * Load messages from the graph for a given conversation, sorted by timestamp.
   */
  private _loadMessagesFromGraph(conversationId: string): MessageRecord[] {
    const store = this.kernel.getStore();
    const messageLinks = store.getLinksByEntityAndAttribute(conversationId, 'hasMessage');

    const records: MessageRecord[] = [];

    for (const link of messageLinks) {
      const entity = this.kernel.getEntity(link.e2);
      if (!entity || entity.type !== 'Message') continue;

      const get = (a: string) => entity.facts.find((f) => f.a === a)?.v;

      const message: LLMMessage = {
        role: get('role') as LLMMessage['role'],
        content: (get('content') as string) ?? null,
      };
      const name = get('name') as string | undefined;
      if (name) message.name = name;
      const toolCallId = get('toolCallId') as string | undefined;
      if (toolCallId) message.tool_call_id = toolCallId;

      records.push({
        entityId: entity.id,
        message,
        timestamp: String(get('timestamp') ?? ''),
        status: (get('status') as 'active' | 'archived') ?? 'active',
      });
    }

    // Sort by timestamp ascending
    records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return records;
  }
}
