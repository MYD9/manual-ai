"""Start/stop only this project's local service; never search for or kill by process name."""
import ctypes
import json
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
RUNTIME = PROJECT / 'runtime'
RUNTIME.mkdir(exist_ok=True)
STATE = RUNTIME / 'server.json'
URL = 'http://127.0.0.1:8765'


def health():
    try:
        with urllib.request.urlopen(URL + '/api/v1/health', timeout=2) as response:
            return json.load(response)
    except Exception:
        return None


def start():
    if not (PROJECT / 'dist/client/index.html').exists():
        raise RuntimeError('请先运行 npm run build，生成网页。')
    current = health()
    if current and current.get('status') == 'ok':
        webbrowser.open(URL)
        print('Manual AI 已在运行：' + URL)
        return
    pointer = RUNTIME / 'data-root.txt'
    data_root = os.environ.get('MANUAL_AI_HOME') or (pointer.read_text(encoding='utf-8').strip() if pointer.exists() else str(Path.home() / 'AppData/Local/ManualAI'))
    pointer.write_text(data_root, encoding='utf-8')
    env = {**os.environ, 'MANUAL_AI_HOME': data_root, 'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}
    log = open(RUNTIME / 'server.log', 'ab')
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8765'], cwd=PROJECT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    log.close()
    STATE.write_text(json.dumps({'pid': process.pid, 'python': sys.executable, 'project': str(PROJECT), 'started': time.time()}), encoding='utf-8')
    for _ in range(60):
        if process.poll() is not None:
            raise RuntimeError('服务启动失败，请查看 runtime/server.log。端口可能被占用。')
        if health():
            webbrowser.open(URL)
            print('Manual AI 已启动：' + URL)
            return
        time.sleep(1)
    raise RuntimeError('启动超时，请查看 runtime/server.log。')


def stop():
    if not STATE.exists():
        print('没有本项目启动的后台服务记录。')
        return
    state = json.loads(STATE.read_text(encoding='utf-8'))
    if state.get('project') != str(PROJECT):
        raise RuntimeError('启动记录不属于当前项目，停止操作已取消。')
    import psutil
    try:
        process = psutil.Process(state['pid'])
        command = process.cmdline()
        if 'backend.main:app' not in command or Path(process.cwd()).resolve() != PROJECT or abs(process.create_time() - state['started']) > 15:
            raise RuntimeError('进程身份已变化，不会停止其他程序。')
        children = process.children(recursive=True)
        for child in children:
            child.terminate()
        process.terminate()
        psutil.wait_procs([process, *children], timeout=8)
    except psutil.NoSuchProcess:
        pass
    STATE.unlink()  # Single exact generated PID record, never project data.
    print('Manual AI 已停止。未完成的导入会在下次启动时恢复。')


if __name__ == '__main__':
    try:
        stop() if len(sys.argv) > 1 and sys.argv[1] == 'stop' else start()
    except Exception as exc:
        print(str(exc))
        raise SystemExit(1)
