import hashlib
import json
from types import SimpleNamespace
from uuid import uuid4

import httpx
import numpy as np
import pytest
from sqlalchemy import select

from backend import processing, providers
from backend.models import Chunk, Entry, Job, Setting, Vector
from backend.storage import Library


@pytest.fixture
def embedding_transport(monkeypatch):
    original_client = httpx.Client

    def install(handler, model="text-embedding-v4"):
        monkeypatch.setattr(providers, "api_config", lambda *_: ("https://example.invalid/v1", model, uuid4().hex))
        monkeypatch.setattr(providers.httpx, "Client", lambda **kwargs: original_client(
            **kwargs, transport=httpx.MockTransport(handler)))

    return install


@pytest.mark.parametrize("model,expected_sizes", [
    ("text-embedding-v4", [10, 10, 1]),
    ("text-embedding-v3", [10, 10, 1]),
    ("another-embedding-model", [16, 5]),
])
def test_provider_batches_preserve_order_and_request_floats(embedding_transport, model, expected_sizes):
    sizes = []

    def handle(request):
        payload = json.loads(request.content)
        assert request.url.path == "/v1/embeddings"
        assert payload["model"] == model
        assert payload["encoding_format"] == "float"
        sizes.append(len(payload["input"]))
        # Provider order is not guaranteed; indices restart for every request.
        return httpx.Response(200, json={"data": [
            {"index": i, "embedding": [float(text), 1.0]}
            for i, text in reversed(list(enumerate(payload["input"])))
        ]})

    embedding_transport(handle, model)
    assert providers.embeddings(None, [str(i) for i in range(21)]) == [[float(i), 1.0] for i in range(21)]
    assert sizes == expected_sizes


@pytest.mark.parametrize("data", [
    [{"index": 1, "embedding": [1.0]}],
    [{"index": 0, "embedding": "base64-not-floats"}],
    [{"index": 0, "embedding": []}],
    [{"index": 0, "embedding": [0.0, 0.0]}],
    [{"index": 0, "embedding": [True, 1.0]}],
    [{"index": 0, "embedding": ["1.0"]}],
])
def test_provider_rejects_unusable_embeddings(embedding_transport, data):
    embedding_transport(lambda _: httpx.Response(200, json={"data": data}))
    with pytest.raises(ValueError, match="向量"):
        providers.embeddings(None, ["测试"])


def test_provider_rejects_dimension_change_between_batches(embedding_transport):
    def handle(request):
        batch = json.loads(request.content)["input"]
        return httpx.Response(200, json={"data": [
            {"index": i, "embedding": [1.0] * (2 if len(batch) == 10 else 3)}
            for i in range(len(batch))
        ]})

    embedding_transport(handle)
    with pytest.raises(ValueError, match="维度不一致"):
        providers.embeddings(None, ["测试"] * 11)


@pytest.mark.parametrize("status,body,expected", [
    (401, '{"error":"upstream-private-detail"}', "拒绝访问"),
    (429, '{"error":"upstream-private-detail"}', "限流"),
    (200, 'not-json-upstream-private-detail', "格式不兼容"),
])
def test_provider_errors_are_actionable_and_sanitized(embedding_transport, status, body, expected):
    embedding_transport(lambda _: httpx.Response(status, text=body))
    with pytest.raises(ValueError, match=expected) as exc:
        providers.embeddings(None, ["测试"])
    assert "upstream-private-detail" not in str(exc.value)


@pytest.fixture
def index_library(tmp_path):
    library = Library(tmp_path / "library-test")
    config = {"embedding_base": "https://example.invalid/v1", "embedding_model": "text-embedding-v4"}
    with library.Session() as db:
        db.add(Setting(key="config", value=config))
        manual = Entry(kind="manual", title="虚构设备", attrs={"ai_enabled": True})
        db.add(manual)
        db.flush()
        source = Entry(kind="source", manual_id=manual.id, title="虚构原文")
        db.add(source)
        db.flush()
        for i in range(21):
            text = f"测试资料片段 {i}"
            db.add(Chunk(id=uuid4().hex, entry_id=source.id, manual_id=manual.id, text=text,
                         digest=hashlib.sha256(text.encode()).hexdigest(), locator={"page": i + 1}))
        job = Job(source_id=manual.id, kind="index")
        db.add(job)
        db.commit()
    yield SimpleNamespace(library=library, manual_id=manual.id, job_id=job.id, config=config)
    library.engine.dispose()


def test_index_saves_batches_and_resumes_after_failure(index_library, monkeypatch):
    state = index_library
    sizes = []

    def interrupted(_library, texts):
        sizes.append(len(texts))
        if len(sizes) == 2:
            raise ValueError("服务限流")
        return [[3.0, 4.0] for _ in texts]

    monkeypatch.setattr(processing, "embeddings", interrupted)
    worker = processing.Processor(state.library)
    with pytest.raises(ValueError, match="限流"):
        worker.index(state.job_id, state.manual_id)
    with state.library.Session() as db:
        assert len(db.scalars(select(Vector)).all()) == 10

    def resumed(_library, texts):
        sizes.append(len(texts))
        return [[3.0, 4.0] for _ in texts]

    monkeypatch.setattr(processing, "embeddings", resumed)
    worker.index(state.job_id, state.manual_id)
    assert sizes == [10, 10, 10, 1]
    with state.library.Session() as db:
        vectors = db.scalars(select(Vector)).all()
        assert len(vectors) == 21
        assert all(v.space == providers.space_for(state.config) for v in vectors)
        assert all(np.isclose(np.linalg.norm(np.frombuffer(v.value, dtype=np.float32)), 1) for v in vectors)
    worker.index(state.job_id, state.manual_id)
    assert sizes == [10, 10, 10, 1]  # Unchanged documents incur no embedding requests.


def test_index_does_not_store_results_after_model_change(index_library, monkeypatch):
    state = index_library

    def change_model(_library, texts):
        with state.library.Session() as db:
            db.get(Setting, "config").value = {**state.config, "embedding_model": "another-model"}
            db.commit()
        return [[1.0, 2.0] for _ in texts]

    monkeypatch.setattr(processing, "embeddings", change_model)
    with pytest.raises(ValueError, match="设置已变更"):
        processing.Processor(state.library).index(state.job_id, state.manual_id)
    with state.library.Session() as db:
        assert not db.scalars(select(Vector)).all()
