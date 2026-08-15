import { describe, it, expect } from 'vitest';
import { getAdapterFactory } from '../src/invoke.js';

const EXPECTED_TYPES = [
  'claude-cli',
  'codex-cli',
  'cursor-agent',
  'opencode-agent',
  'anthropic-api',
  'openai-api',
  'opencode-go-api',
  'opencode-zen-api',
];

describe('getAdapterFactory', () => {
  it('returns a working factory for every shipped adapter type', () => {
    for (const type of EXPECTED_TYPES) {
      const factory = getAdapterFactory(type);
      const adapter = factory();
      expect(adapter.family === 'cli' || adapter.family === 'api').toBe(true);
      expect(typeof adapter.prepare).toBe('function');
      expect(typeof adapter.invoke).toBe('function');
      expect(typeof adapter.dispose).toBe('function');
    }
  });

  it('creates a fresh instance on every call (no shared state across concurrent runs)', () => {
    const a = getAdapterFactory('claude-cli')();
    const b = getAdapterFactory('claude-cli')();
    expect(a).not.toBe(b);
  });

  it('throws a helpful error for an unknown type', () => {
    expect(() => getAdapterFactory('nonexistent-type')).toThrow(/no managed-agent adapter/);
  });

  it('throws a specific message for antigravity-cli, pointing at the pending spike', () => {
    expect(() => getAdapterFactory('antigravity-cli')).toThrow(/spike/);
  });
});
