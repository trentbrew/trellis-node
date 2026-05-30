/**
 * File Watcher
 *
 * Monitors a directory for filesystem changes and emits FileChangeEvents.
 * Uses Bun's built-in fs.watch for zero-dependency file monitoring.
 */

export { FileWatcher } from './fs-watcher.js';
export { Ingestion } from './ingestion.js';
