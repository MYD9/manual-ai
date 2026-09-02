import { browserEdition } from './edition';
import { tokens } from './motion';
export type ImportResult = {
  job_id?: string;
  source?: { id: string; manual_id?: string | null };
  duplicate?: boolean;
};
/** Upload progress describes transferred bytes only; parsing is a separate server job. */
export function uploadFile(
  file: File,
  manualId: string,
  onProgress: (percent: number) => void,
  allowDuplicate = false,
  options?: { newManual: boolean; autoIdentify: boolean; requestId: string },
): Promise<ImportResult> {
  if (browserEdition) return import('./browser-library').then(m => m.importBrowserText(file, manualId, onProgress, allowDuplicate, options));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/imports/file');
    xhr.timeout = tokens.timing.uploadTimeout;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress(Math.min(100, (event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let result: ImportResult & { detail?: unknown };
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error('服务返回了无法识别的响应。请检查处理记录后重试。'));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            typeof result.detail === 'string'
              ? result.detail
              : '文件未能接收，请检查格式和大小后重试。',
          ),
        );
        return;
      }
      if (!result.duplicate && !result.job_id) {
        reject(new Error('未收到导入任务编号，请检查处理记录后重试。'));
        return;
      }
      onProgress(100);
      resolve(result);
    };
    xhr.onerror = () =>
      reject(
        new Error(
          '连接中断。请确认本地服务已启动，在处理记录中核对后重试；相同文件会被识别。',
        ),
      );
    xhr.ontimeout = () =>
      reject(new Error('上传等待超时。请先检查处理记录，再重试此文件。'));
    xhr.onabort = () => reject(new Error('上传已取消，可以重新选择文件。'));
    const body = new FormData();
    body.append('file', file);
    body.append('manual_id', manualId);
    body.append('allow_duplicate', String(allowDuplicate));
    if (options) {
      body.append('new_manual', String(options.newManual));
      body.append('auto_identify', String(options.autoIdentify));
      body.append('request_id', options.requestId);
    }
    xhr.send(body);
  });
}
/** Each failure is local to its file; later files are still attempted. */
export async function eachFile<T>(
  items: T[],
  run: (item: T) => Promise<void>,
  fail: (item: T, error: Error) => void,
) {
  for (const item of items) {
    try {
      await run(item);
    } catch (error) {
      fail(item, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
