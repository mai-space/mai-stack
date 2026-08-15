import { describe, it, expect } from 'vitest';
import { parseToolResult } from '../src/mcpBridge.js';

describe('parseToolResult', () => {
  it('parses the JSON payload out of a standard MCP tool text response', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ task: { id: 't1' }, reason: undefined }) }] };
    expect(parseToolResult(result)).toEqual({ task: { id: 't1' } });
  });

  it('falls back to the raw text when it is not valid JSON', () => {
    const result = { content: [{ type: 'text', text: 'not json' }] };
    expect(parseToolResult(result)).toBe('not json');
  });

  it('falls back to the raw result when there is no text content block', () => {
    const result = { content: [] };
    expect(parseToolResult(result)).toEqual(result);
  });

  it('picks the text block out of multiple content blocks', () => {
    const result = { content: [{ type: 'image', data: 'xyz' }, { type: 'text', text: '{"ok":true}' }] };
    expect(parseToolResult(result)).toEqual({ ok: true });
  });
});
