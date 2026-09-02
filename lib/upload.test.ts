import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadFile, eachFile } from './upload';
class FakeXHR {
  static current: FakeXHR;
  upload: { onprogress?: (event: any) => void } = {};
  status = 202;
  responseText = '';
  timeout = 0;
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.current = this;
  }
  open = vi.fn();
  send = vi.fn();
}
afterEach(() => vi.unstubAllGlobals());
describe('independent file imports', () => {
  it('creates from an import with a stable request ID and explicit AI preference', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const options = {newManual:true, autoIdentify:false, requestId:'stable-upload'};
    const result = uploadFile(new File(['text'], 'guide.txt'), '', () => {}, false, options);
    const xhr = FakeXHR.current;
    const body = xhr.send.mock.calls[0][0] as FormData;
    expect(body.get('manual_id')).toBe('');
    expect(body.get('new_manual')).toBe('true');
    expect(body.get('auto_identify')).toBe('false');
    expect(body.get('request_id')).toBe('stable-upload');
    xhr.responseText = JSON.stringify({job_id:'parsed-job', source:{id:'source', manual_id:'new-manual'}});
    xhr.onload!();
    expect((await result).source?.manual_id).toBe('new-manual');
  });
  it('continues after a failed file and reports only that file', async () => {
    const attempted: number[] = [],
      failed: number[] = [];
    await eachFile(
      [1, 2, 3],
      async (n) => {
        attempted.push(n);
        if (n === 2) throw new Error('bad file');
      },
      (n) => failed.push(n),
    );
    expect(attempted).toEqual([1, 2, 3]);
    expect(failed).toEqual([2]);
  });
  it('reports actual transferred bytes and waits for a valid server job before success', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const progress = vi.fn(),
      finished = vi.fn();
    const pending = uploadFile(
      new File(['test'], 'test.txt'),
      'manual',
      progress,
    ).then(finished);
    const xhr = FakeXHR.current;
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 2, total: 4 });
    expect(progress).toHaveBeenLastCalledWith(50);
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 4, total: 4 });
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    xhr.responseText = JSON.stringify({
      job_id: 'job',
      source: { id: 'source' },
    });
    xhr.onload!();
    await pending;
    expect(finished).toHaveBeenCalledWith({
      job_id: 'job',
      source: { id: 'source' },
    });
  });
  it('does not turn a validation failure or malformed success response into a success', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const pending = uploadFile(
      new File(['test'], 'test.txt'),
      'manual',
      () => {},
    );
    const rejection = expect(pending).rejects.toThrow('格式');
    FakeXHR.current.status = 422;
    FakeXHR.current.responseText = JSON.stringify({ detail: '格式不支持' });
    FakeXHR.current.onload!();
    await rejection;
    const second = uploadFile(
      new File(['test'], 'test.txt'),
      'manual',
      () => {},
    );
    const rejectSecond = expect(second).rejects.toThrow('任务编号');
    FakeXHR.current.responseText = '{}';
    FakeXHR.current.onload!();
    await rejectSecond;
  });
  it('ignores unmeasurable progress and treats a duplicate as an explicit decision state', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const progress = vi.fn(),
      pending = uploadFile(new File(['test'], 'test.txt'), 'manual', progress);
    FakeXHR.current.upload.onprogress!({
      lengthComputable: false,
      loaded: 2,
      total: 0,
    });
    expect(progress).not.toHaveBeenCalled();
    FakeXHR.current.responseText = '{"duplicate":true}';
    FakeXHR.current.onload!();
    expect(await pending).toEqual({ duplicate: true });
  });
});
