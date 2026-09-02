import { describe, it, expect } from 'vitest';
import { consumeSSE } from './api';
describe('SSE transport', () => {
  it('preserves split UTF-8 and event boundaries', async () => {
    const bytes = new TextEncoder().encode(
      'event: delta\ndata: {"text":"中文"}\n\nevent: done\ndata: {"grounded":true}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    });
    const events: any[] = [];
    await consumeSSE(new Response(stream), (event, data) =>
      events.push([event, data]),
    );
    expect(events).toEqual([
      ['delta', { text: '中文' }],
      ['done', { grounded: true }],
    ]);
  });
  it('reports failed API requests rather than reading them as answers', async () => {
    await expect(
      consumeSSE(
        new Response(JSON.stringify({ detail: '密钥无效' }), { status: 401 }),
        () => {},
      ),
    ).rejects.toThrow('密钥无效');
  });
});
