import { browserEdition, backendRequired } from './edition';
export type Entry = {
  id: string;
  kind: string;
  manual_id: string | null;
  parent_id: string | null;
  title: string;
  content: string;
  category: string;
  tags: string[];
  color: string;
  favorite: boolean;
  position: number;
  revision: number;
  deleted_at: string | null;
  updated_at: string;
  created_at: string;
  attrs: Record<string, any>;
};
export type Hit = {
  id: string;
  entry_id: string;
  manual_id: string;
  title: string;
  kind: string;
  text: string;
  locator: Record<string, any>;
  source_id: string | null;
  score: number;
};
export type Job = {
  id: string;
  source_id: string;
  title: string;
  kind: string;
  status: string;
  progress: number;
  stage: string;
  error: string;
};
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (browserEdition) return (await import('./browser-library')).browserApi<T>(path, options);
  const response = await fetch('/api/v1' + path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    let message = '服务暂时不可用';
    try {
      const e = (await response.json()) as { detail?: unknown };
      message = typeof e.detail === 'string' ? e.detail : '请检查输入内容';
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
export function post<T = any>(path: string, data: unknown = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(data) });
}
export function patch(entry: Entry, data: unknown) {
  return api<Entry>('/entries/' + entry.id, {
    method: 'PATCH',
    body: JSON.stringify({ revision: entry.revision, ...(data as object) }),
  });
}
export function strip(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}
export function date(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}
export function serviceFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (browserEdition) return Promise.reject(new Error(backendRequired));
  return fetch(input, init);
}
export async function consumeSSE(
  response: Response,
  onEvent: (event: string, data: any) => void,
) {
  if (!response.ok) {
    const body = (await response.json()) as { detail?: string };
    throw new Error(body.detail || 'AI 请求失败');
  }
  if (!response.body) throw new Error('浏览器不支持流式响应');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const part = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = part.split('\n');
        const event =
          lines
            .find((s) => s.startsWith('event:'))
            ?.slice(6)
            .trim() || 'message';
        const data = lines
          .filter((s) => s.startsWith('data:'))
          .map((s) => s.slice(5).trim())
          .join('\n');
        if (data) onEvent(event, JSON.parse(data));
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
