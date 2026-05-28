import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

export interface Chunk {
  file_path: string;
  line_start: number;
  line_end: number;
  content: string;
}

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'vendor', 'var', '.ddev', '.idea', 'typo3-docs']);
const EXCLUDED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3', '.zip', '.tar', '.gz', '.lock', '.bin', '.webp']);
const MAX_FILE_BYTES = 200 * 1024; // 200KB
const CHUNK_LINES = 50;
const OVERLAP_LINES = 10;

function walkDir(dir: string, baseDir: string, files: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      walkDir(full, baseDir, files);
    } else if (stat.isFile()) {
      const ext = path.extname(entry).toLowerCase();
      if (!EXCLUDED_EXTS.has(ext) && stat.size < MAX_FILE_BYTES) {
        files.push(path.relative(baseDir, full));
      }
    }
  }
  return files;
}

export function chunkWorkspace(workspacePath: string): Chunk[] {
  const files = walkDir(workspacePath, workspacePath);
  const chunks: Chunk[] = [];

  for (const relPath of files) {
    const fullPath = path.join(workspacePath, relPath);
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let start = 0; start < lines.length; start += CHUNK_LINES - OVERLAP_LINES) {
      const end = Math.min(start + CHUNK_LINES, lines.length);
      const chunkLines = lines.slice(start, end);
      if (chunkLines.join('').trim().length === 0) continue;
      chunks.push({ file_path: relPath, line_start: start + 1, line_end: end, content: chunkLines.join('\n') });
      if (end === lines.length) break;
    }
  }
  return chunks;
}
