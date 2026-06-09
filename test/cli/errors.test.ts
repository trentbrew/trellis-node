import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleCliError } from '../../src/cli/errors.js';

describe('handleCliError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints message and exits non-zero', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    handleCliError(new Error('Parent issue TRL-999 not found.'));

    expect(stderr).toHaveBeenCalled();
    expect(String(stderr.mock.calls[0]?.[0])).toContain('TRL-999');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits zero for commander help', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

    handleCliError({ code: 'commander.helpDisplayed' });

    expect(exit).toHaveBeenCalledWith(0);
  });
});
