import type { Embedder } from './index.js';

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
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
      const data = await res.json() as { embedding: number[] };
      results.push(data.embedding);
    }
    return results;
  }
}
