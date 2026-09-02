import ctypes
import hashlib
import json
import os
import sqlite3
import threading
from contextlib import closing
from pathlib import Path
from uuid import uuid4
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from backend.models import Setting

ROOT = Path(os.environ.get("MANUAL_AI_HOME", str(Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ManualAI"))).resolve()


class Library:
    def __init__(self, root=ROOT):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.vector_epoch = 0
        self.vector_cache = None
        pointer = self.root / "current-library.txt"
        name = pointer.read_text(encoding="utf-8").strip() if pointer.exists() else "library"
        if not name or Path(name).name != name:
            raise RuntimeError("资料库指针无效")
        self.open(self.root / name)

    def open(self, path):
        self.path = path.resolve()
        self.path.mkdir(parents=True, exist_ok=True)
        self.blobs = self.path / "blobs"
        self.blobs.mkdir(exist_ok=True)
        self.cache = self.path / "cache"
        self.cache.mkdir(exist_ok=True)
        self.dbpath = self.path / "library.sqlite3"
        self.engine = create_engine(f"sqlite:///{self.dbpath.as_posix()}", connect_args={"check_same_thread": False, "timeout": 30})

        @event.listens_for(self.engine, "connect")
        def pragmas(conn, _):
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=30000")

        config = Config()
        config.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
        with self.engine.begin() as conn:
            config.attributes["connection"] = conn
            command.upgrade(config, "head")
        self.Session = sessionmaker(self.engine, expire_on_commit=False)
        self.invalidate()

    def switch(self, path):
        old_path = self.path
        old_engine = self.engine
        try:
            self.open(path)
            pointer = self.root / "current-library.next"
            pointer.write_text(path.name, encoding="utf-8")
            os.replace(pointer, self.root / "current-library.txt")
        except Exception:
            self.open(old_path)
            raise
        finally:
            old_engine.dispose()

    def invalidate(self):
        self.vector_epoch += 1
        self.vector_cache = None

    def put_blob(self, raw):
        digest = hashlib.sha256(raw).hexdigest()
        path = self.blobs / digest
        if not path.exists():
            temp = self.blobs / (digest + "." + str(uuid4()) + ".part")
            temp.write_bytes(raw)
            os.replace(temp, path)
        return digest

    def snapshot(self, destination):
        with closing(sqlite3.connect(self.dbpath)) as source, closing(sqlite3.connect(destination)) as target:
            source.backup(target)

    def settings(self):
        with self.Session() as db:
            s = db.get(Setting, "config")
            return dict(s.value) if s else {}


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, decrypt=False):
    if os.name != "nt":
        raise RuntimeError("此版本的密钥存储需要 Windows DPAPI")
    buffer = ctypes.create_string_buffer(data)
    incoming = DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = DataBlob()
    function = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not function(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise RuntimeError("Windows 无法读取或加密密钥，请重新配置")
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.pbData)


def read_secrets(library):
    path = library.root / "credentials.dpapi"
    return json.loads(protect(path.read_bytes(), True)) if path.exists() else {}


def save_secrets(library, secrets):
    target = library.root / "credentials.dpapi"
    temp = library.root / "credentials.next"
    temp.write_bytes(protect(json.dumps(secrets).encode()))
    os.replace(temp, target)
