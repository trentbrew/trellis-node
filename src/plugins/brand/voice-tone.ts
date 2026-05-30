/**
 * Voice & Tone — Converts brand voice/tone config into json-render catalog prompt rules.
 *
 * These rules are passed as `customRules` to `catalog.prompt()`, injecting
 * communication constraints into the AI system prompt alongside component schemas.
 *
 * @module trellis/plugins/brand
 */

export interface VoiceToneConfig {
  /** Personality traits: ["professional", "warm", "concise"] */
  traits?: string[];
  /** Vocabulary swaps: { "click": "select", "delete": "remove" } */
  preferred?: Record<string, string>;
  /** Words to never use: ["synergy", "leverage", "disrupt"] */
  avoided?: string[];
  /** Example phrases that embody the tone */
  examples?: string[];
}

/**
 * Build an array of rule strings from a voice/tone config.
 * Returns empty array if config is undefined or empty.
 */
export function buildVoiceToneRules(config: VoiceToneConfig | undefined | null): string[] {
  if (!config) return [];

  const rules: string[] = [];

  if (config.traits && config.traits.length > 0) {
    rules.push(`Voice: Be ${config.traits.join(', ')}.`);
  }

  if (config.preferred && Object.keys(config.preferred).length > 0) {
    const swaps = Object.entries(config.preferred)
      .map(([from, to]) => `"${from}" → "${to}"`)
      .join(', ');
    rules.push(`Preferred vocabulary: ${swaps}.`);
  }

  if (config.avoided && config.avoided.length > 0) {
    rules.push(`Never use these words: ${config.avoided.join(', ')}.`);
  }

  if (config.examples && config.examples.length > 0) {
    rules.push(`Tone examples: ${config.examples.map((e) => `"${e}"`).join('; ')}.`);
  }

  return rules;
}
