import type { OllamaEmbedder } from './ollama.js';
import type { OpenAIEmbedder } from './openai.js';
import type { CohereEmbedder } from './cohere.js';

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
  dimension: number;
}

export function parseModel(modelStr: string): { provider: string; model: string } {
  const [provider, ...rest] = modelStr.split(':');
  return { provider, model: rest.join(':') };
}

export function vectorDimFor(modelStr: string): number {
  const { provider, model } = parseModel(modelStr);
  if (provider === 'openai') return 1536;
  if (provider === 'cohere') return 1024;
  // ollama: nomic-embed-text = 768, mxbai-embed-large = 1024
  if (model.includes('mxbai')) return 1024;
  return 768; // default for ollama nomic-embed-text
}

export async function createEmbedder(modelStr: string): Promise<Embedder> {
  const { provider, model } = parseModel(modelStr);
  if (provider === 'openai') {
    const { OpenAIEmbedder } = await import('./openai.js');
    return new OpenAIEmbedder(model);
  }
  if (provider === 'cohere') {
    const { CohereEmbedder } = await import('./cohere.js');
    return new CohereEmbedder(model);
  }
  // Default: ollama
  const { OllamaEmbedder } = await import('./ollama.js');
  return new OllamaEmbedder(model);
}
