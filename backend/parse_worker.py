"""One isolated import process. Cancellation and checkpoints live in SQLite."""
import json
import os
import sys
from pathlib import Path
from backend.models import Entry
from backend.processing import Processor, parse_source
from backend.storage import Library


def run():
    sid, jid, output = sys.argv[1:]
    library = Library()
    processor = Processor(library)
    with library.Session() as db:
        source = db.get(Entry, sid)
        if not source or source.deleted_at:
            raise ValueError("资料已删除")
    blocks, attrs = parse_source(library, source, lambda n, stage: processor.update(jid, n, stage))
    path = Path(output)
    temp = path.with_suffix('.next')
    temp.write_text(json.dumps({"blocks": blocks, "attrs": attrs}, ensure_ascii=False), encoding='utf-8')
    os.replace(temp, path)
    library.engine.dispose()


if __name__ == '__main__':
    try:
        run()
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError) else '解析失败，请检查文件是否正常或组件是否完整'
        Path(sys.argv[3] + '.error').write_text(message[:300], encoding='utf-8')
        raise SystemExit(1)
