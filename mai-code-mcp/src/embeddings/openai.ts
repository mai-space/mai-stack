import OpenAI from 'openai';
import type { Embedder } from './index.js';

export class OpenAIEmbedder implements Embedder {
  public dimension = 1536;
  private client: OpenAI;
  private model: string;

  constructor(model: string) {
    this.model = model || 'text-embedding-3-small';
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: this.model, input: texts });
    return res.data.map((d) => d.embedding);
  }
}
