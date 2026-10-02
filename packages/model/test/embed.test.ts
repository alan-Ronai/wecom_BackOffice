import { describe, it, expect } from 'vitest';
import { OllamaModel } from '../src/ollama.js';

/**
 * Wave 6 (X1). `embedBatch` is what makes a reindex after an embedder change finish in minutes
 * rather than hours, and `showModel` is how `POST /admin/ai/models/test` proves a tag exists
 * and reports the width it returns before an admin selects a tier.
 *
 * A fetch stub rather than `fixtures/ollama-stub.ts`: that stub is an http server scripted for
 * the chat path, and these three routes only need their request bodies inspected.
 */
const fetchStub = (routes: Record<string, (body: Record<string, unknown>) => unknown>) =>
  (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    const h = routes[path];
    if (!h) return new Response('nf', { status: 404 });
    return new Response(JSON.stringify(h(body)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

describe('OllamaModel embeddings (wave 6)', () => {
  it('embedBatch returns one vector per input from /api/embed', async () => {
    let calls = 0;
    const m = new OllamaModel({
      url: 'http://x',
      model: 'm',
      embedModel: 'bge-m3',
      fetchImpl: fetchStub({
        '/api/embed': (b) => {
          calls++;
          return { embeddings: (b.input as string[]).map((_, i) => [i, i]) };
        },
      }),
    });
    expect(await m.embedBatch(['a', 'b', 'c'])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(calls).toBe(1);
    // Empty input is not a round trip.
    expect(await m.embedBatch([])).toEqual([]);
    expect(calls).toBe(1);
  });

  it('falls back to per-text embed when the server answers a single vector', async () => {
    let single = 0;
    const m = new OllamaModel({
      url: 'http://x',
      model: 'm',
      embedModel: 'e',
      fetchImpl: fetchStub({
        '/api/embed': () => ({ embeddings: [[9]] }),
        '/api/embeddings': () => {
          single++;
          return { embedding: [7] };
        },
      }),
    });
    expect(await m.embedBatch(['a', 'b'])).toEqual([[7], [7]]);
    expect(single).toBe(2);
  });

  it('showModel reads family, size, quantization and embedding length', async () => {
    const m = new OllamaModel({
      url: 'http://x',
      model: 'm',
      fetchImpl: fetchStub({
        '/api/show': () => ({
          details: { family: 'bert', parameter_size: '567M', quantization_level: 'F16' },
          model_info: { 'bert.embedding_length': 1024 },
        }),
      }),
    });
    expect(await m.showModel('bge-m3')).toEqual({
      family: 'bert',
      parameterSize: '567M',
      quantization: 'F16',
      embeddingLength: 1024,
    });
  });

  it('showModel and listTags answer null/[] instead of throwing when the daemon is down', async () => {
    const m = new OllamaModel({ url: 'http://x', model: 'm', fetchImpl: fetchStub({}) });
    expect(await m.showModel('nope')).toBeNull();
    expect(await m.listTags()).toEqual([]);
  });

  it('listTags reports the local tags with their sizes', async () => {
    const m = new OllamaModel({
      url: 'http://x',
      model: 'm',
      fetchImpl: fetchStub({
        '/api/tags': () => ({ models: [{ name: 'bge-m3:latest', size: 1200 }, { size: 1 }] }),
      }),
    });
    expect(await m.listTags()).toEqual([{ name: 'bge-m3:latest', size: 1200 }]);
  });
});
