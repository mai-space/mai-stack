import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { shellQuote } from '../src/proc.js';

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes safely', () => {
    expect(shellQuote("it's a test")).toBe("'it'\\''s a test'");
  });

  it('neutralizes shell metacharacters when actually executed', () => {
    const dangerous = '$(rm -rf /); echo pwned; `id`';
    const output = execSync(`echo ${shellQuote(dangerous)}`).toString().trim();
    expect(output).toBe(dangerous);
  });
});
