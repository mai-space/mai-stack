import type { Embedder } from './index.js';

export class CohereEmbedder implements Embedder {
  public dimension = 1024;
  private model: string;
  private apiKey: string;

  constructor(model: string) {
    this.model = model || 'embed-english-v3.0';
    this.apiKey = process.env.COHERE_API_KEY ?? '';
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ texts, model: this.model, input_type: 'search_document' }),
    });
    if (!res.ok) throw new Error(`Cohere embed failed: ${res.status}`);
    const data = await res.json() as { embeddings: number[][] };
    return data.embeddings;
  }
}
