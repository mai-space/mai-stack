import { describe, it, expect } from 'vitest';
import { parseModel, vectorDimFor } from '../src/embeddings/index.js';

describe('parseModel', () => {
  it('splits provider:model on the first colon', () => {
    expect(parseModel('openai:text-embedding-3-small')).toEqual({ provider: 'openai', model: 'text-embedding-3-small' });
  });

  it('rejoins remaining colons into the model name', () => {
    expect(parseModel('ollama:nomic-embed-text:latest')).toEqual({ provider: 'ollama', model: 'nomic-embed-text:latest' });
  });
});

describe('vectorDimFor', () => {
  it('returns 1536 for openai models', () => {
    expect(vectorDimFor('openai:text-embedding-3-small')).toBe(1536);
  });

  it('returns 1024 for cohere models', () => {
    expect(vectorDimFor('cohere:embed-english-v3.0')).toBe(1024);
  });

  it('returns 768 for ollama nomic-embed-text (the default)', () => {
    expect(vectorDimFor('ollama:nomic-embed-text')).toBe(768);
  });

  it('returns 1024 for ollama mxbai models', () => {
    expect(vectorDimFor('ollama:mxbai-embed-large')).toBe(1024);
  });
});
