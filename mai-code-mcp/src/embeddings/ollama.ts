import type { Embedder } from './index.js';

// ~2048-token model window; 2000 chars stays under it even for token-dense
// content (verified: 2500 chars of "a," 500s, 2000 succeeds).
const MAX_EMBED_CHARS = 2000;

export class OllamaEmbedder implements Embedder {
  public dimension: number;
  private model: string;
  private baseUrl: string;

  constructor(model: string) {
    this.model = model || 'nomic-embed-text';
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    // nomic-embed-text = 768, mxbai-embed-large = 1024
    this.dimension = model.includes('mxbai') ? 1024 : 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      // nomic-embed-text caps at ~2048 tokens; truncate so long-line chunks
      // (minified JS, big arrays) don't 500 with "input exceeds context length".
      const prompt = text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt }),
      });
      if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
      const data = await res.json() as { embedding: number[] };
      results.push(data.embedding);
    }
    return results;
  }
}
