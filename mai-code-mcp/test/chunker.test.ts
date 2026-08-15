import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkWorkspace } from '../src/chunker.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mai-code-mcp-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('chunkWorkspace', () => {
  it('chunks a small file into a single chunk with correct line bounds', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    writeFileSync(join(dir, 'small.ts'), lines.join('\n'));

    const chunks = chunkWorkspace(dir);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].file_path).toBe('small.ts');
    expect(chunks[0].line_start).toBe(1);
    expect(chunks[0].line_end).toBe(10);
    expect(chunks[0].content).toBe(lines.join('\n'));
  });

  it('splits a large file into overlapping 50-line chunks', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
    writeFileSync(join(dir, 'big.ts'), lines.join('\n'));

    const chunks = chunkWorkspace(dir);
    expect(chunks).toHaveLength(3);
    expect(chunks.map(c => [c.line_start, c.line_end])).toEqual([[1, 50], [41, 90], [81, 120]]);
  });

  it('excludes node_modules, .git, dist, and other excluded directories', () => {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'lib.js'), 'module.exports = {};');
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'out.js'), 'console.log(1);');
    writeFileSync(join(dir, 'app.ts'), 'export const x = 1;');

    const chunks = chunkWorkspace(dir);
    const paths = chunks.map(c => c.file_path);
    expect(paths).toEqual(['app.ts']);
  });

  it('excludes binary/asset file extensions', () => {
    writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dir, 'archive.zip'), Buffer.from([0x50, 0x4b]));
    writeFileSync(join(dir, 'app.ts'), 'export const x = 1;');

    const chunks = chunkWorkspace(dir);
    expect(chunks.map(c => c.file_path)).toEqual(['app.ts']);
  });

  it('skips chunks that are entirely whitespace', () => {
    writeFileSync(join(dir, 'blank.ts'), '\n\n\n\n');
    const chunks = chunkWorkspace(dir);
    expect(chunks).toHaveLength(0);
  });

  it('skips files larger than the 200KB cap', () => {
    writeFileSync(join(dir, 'huge.ts'), 'x'.repeat(250 * 1024));
    writeFileSync(join(dir, 'small.ts'), 'const x = 1;');

    const chunks = chunkWorkspace(dir);
    expect(chunks.map(c => c.file_path)).toEqual(['small.ts']);
  });

  it('returns an empty array for a nonexistent workspace path', () => {
    expect(chunkWorkspace(join(dir, 'does-not-exist'))).toEqual([]);
  });
});
