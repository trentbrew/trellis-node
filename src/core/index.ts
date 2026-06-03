/**
 * TrellisVCS Core — EAV Store, Kernel, Persistence, Middleware
 *
 * Inlined from trellis-core for single-package publish.
 * Consumers: `import { EAVStore, Fact, TrellisKernel } from 'trellis/core'`
 *
 * @module trellis/core
 */

// EAV Store
export { EAVStore, flatten, jsonEntityFacts } from './store/eav-store.js';

export type {
  Atom,
  EntityRef,
  Fact,
  Link,
  CatalogEntry,
  QueryTraceEntry,
  QueryResult,
} from './store/eav-store.js';

// Kernel persistence types
export type {
  KernelOp,
  KernelOpKind,
  KernelBackend,
} from './persist/backend.js';

// Kernel middleware types
export type {
  KernelMiddleware,
  MiddlewareContext,
  OpMiddlewareNext,
} from './kernel/middleware.js';

// SQLite backend
export { SqliteKernelBackend } from './persist/sqlite-backend.js';

// Pure-WASM SQLite backend (sql.js) for Node-without-Bun / WebContainer / browser
export { SqlJsKernelBackend } from './persist/sqljs-backend.js';
export type { SqlJsKernelBackendOptions } from './persist/sqljs-backend.js';

// Runtime-selecting backend factory
export { createKernelBackend } from './persist/factory.js';
export type { CreateKernelBackendOptions } from './persist/factory.js';

// Query engine
export {
  QueryEngine,
  parseQuery,
  parseRule,
  parseSimple,
  DatalogRuntime,
} from './query/index.js';
export type {
  Query,
  Pattern,
  FactPattern,
  LinkPattern,
  Term,
  Variable,
  Literal,
  Filter,
  FilterOp,
  Aggregate,
  OrderBy,
  Bindings,
  DatalogRule,
} from './query/index.js';

// Ontology system
export {
  OntologyRegistry,
  validateEntity,
  validateStore,
  createValidationMiddleware,
} from './ontology/index.js';
export {
  projectOntology,
  teamOntology,
  agentOntology,
  builtinOntologies,
} from './ontology/index.js';
export type {
  AttrType,
  AttributeDef,
  RelationDef,
  EntityDef,
  OntologySchema,
  ValidationError,
  ValidationResult,
} from './ontology/index.js';

// Agent system
export { AgentHarness } from './agents/index.js';
export type {
  AgentDef,
  ToolDef,
  ToolHandler,
  ToolResult,
  AgentRun,
  DecisionTrace,
  RunStatus,
  AgentHarnessConfig,
} from './agents/index.js';

// Plugin system
export { PluginRegistry, EventBus } from './plugins/index.js';
export type {
  PluginDef,
  PluginContext,
  PluginManifest,
  EventCallback,
  EventHandler,
  WellKnownEvent,
  WorkspaceConfig,
} from './plugins/index.js';

// Expression evaluation (ontology formula fields)
export { ExprEvaluator, evalExpr } from './computation/index.js';
export type { EvalContext } from './computation/index.js';

// Kernel middleware boot helpers
export { attachStandardMiddleware, buildOntologyIndex } from './kernel/boot-middleware.js';
export { createLogicMiddleware } from './kernel/logic-middleware.js';
export type { LogicMiddlewareConfig } from './kernel/logic-middleware.js';

// TrellisKernel — generic graph kernel
export { TrellisKernel } from './kernel/trellis-kernel.js';
export type {
  KernelConfig,
  MutateResult,
  EntityRecord,
} from './kernel/trellis-kernel.js';
