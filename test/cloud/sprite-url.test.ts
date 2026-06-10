import { describe, it, expect } from 'vitest';
import { parseSpriteUrlOutput } from '../../src/server/sprites.js';

describe('parseSpriteUrlOutput', () => {
  it('parses sprite url CLI output', () => {
    const out = `URL: https://my-app-bnsoz.sprites.app\nAuth: public\n`;
    expect(parseSpriteUrlOutput(out)).toBe(
      'https://my-app-bnsoz.sprites.app',
    );
  });

  it('strips trailing slash', () => {
    expect(
      parseSpriteUrlOutput('URL: https://my-app-bnsoz.sprites.app/\n'),
    ).toBe('https://my-app-bnsoz.sprites.app');
  });

  it('throws on missing URL', () => {
    expect(() => parseSpriteUrlOutput('Auth: sprite\n')).toThrow(
      /Could not parse sprite URL/,
    );
  });
});
