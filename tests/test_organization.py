import json
import os
import tempfile

os.environ['MANUAL_AI_HOME'] = tempfile.mkdtemp(prefix='manual-draft-bootstrap-')
os.environ['MANUAL_AI_NO_WORKER'] = '1'

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from backend import main, organization
from backend.indexing import replace_chunks
from backend.models import Entry
from backend.processing import Processor
from backend.storage import Library


@pytest.fixture
def client(tmp_path, monkeypatch):
    library = Library(tmp_path / 'library')
    monkeypatch.setattr(main, 'library', library)
    monkeypatch.setattr(main, 'processor', Processor(library))
    monkeypatch.setattr(main, 'api_config', lambda *a: None)
    with TestClient(main.app) as client:
        yield client
    library.engine.dispose()


def create(client, **data):
    response = client.post('/api/v1/entries', json={'title': '样机说明书', **data})
    assert response.status_code == 201, response.text
    return response.json()


def prepare(client, count=50):
    manual = create(client, content='<p>用户自己的摘要</p>', category='原分类', attrs={'ai_enabled': True, 'brand': '用户品牌'})
    chapter = create(client, kind='chapter', manual_id=manual['id'], title='接线')
    old = create(client, kind='card', manual_id=manual['id'], parent_id=chapter['id'], title='已有人工作品', content='<p>不能覆盖</p>')
    with main.library.Session() as db:
        source = Entry(kind='source', title='样机原文', manual_id=manual['id'], attrs={'status': 'ready'})
        db.add(source); db.flush()
        replace_chunks(db, source, [{'text': f'第 {i} 页：样机使用 USB 接口，状态灯常亮表示就绪。', 'locator': {'page': i}} for i in range(1, count + 1)])
        sid = source.id
        db.commit()
    return manual['id'], sid, chapter['id'], old['id']


def fake_generate(monkeypatch, capture=None, **changes):
    def model(library, messages, **kwargs):
        if capture is not None: capture.extend(messages)
        return {'chapters': ['接线', '状态'], 'summary': '根据片段总结', 'cards': [
            {'chapter': '接线', 'title': 'USB 连接', 'content': '使用 USB 接口。\n保持插头稳固。', 'source_ref': 1},
            {'chapter': '状态', 'title': '就绪指示', 'content': '常亮表示就绪。', 'source_ref': 2},
        ], **changes}
    monkeypatch.setattr(organization, 'chat_json', model)


def test_generate_preview_apply_citations_reuse_and_duplicate_guard(client, monkeypatch):
    mid, sid, cid, old_id = prepare(client)
    captured = []; fake_generate(monkeypatch, captured)
    response = client.post(f'/api/v1/manuals/{mid}/organize', json={'instruction': '重点解释接线'})
    assert response.status_code == 200, response.text
    draft = response.json()
    assert '第 50 页' in captured[1]['content'] and '重点解释接线' in captured[1]['content']
    assert len(draft['cards']) == 2 and len(draft['snapshot']) == 64
    before = client.get('/api/v1/entries', params={'manual_id': mid}).json()['items']
    assert len([e for e in before if e['kind'] == 'card']) == 1  # preview is read-only
    draft['cards'][0]['content'] = '<script>not executable</script>\n人工修订'
    applied = client.post(f'/api/v1/manuals/{mid}/organize/apply', json=draft)
    assert applied.status_code == 200, applied.text
    assert applied.json() == {'ok': True, 'chapters_added': 1, 'cards_added': 2}
    items = client.get('/api/v1/entries', params={'manual_id': mid}).json()['items']
    new = next(e for e in items if e['title'] == 'USB 连接')
    assert new['parent_id'] == cid and new['attrs']['source_id'] == sid and new['attrs']['locator']['page'] == 1
    assert '<script>' not in new['content'] and '&lt;script&gt;' in new['content']
    assert client.get('/api/v1/entries/' + old_id).json()['content'] == '<p>不能覆盖</p>'
    manual = client.get('/api/v1/entries/' + mid).json()
    assert manual['category'] == '原分类' and manual['content'] == '<p>用户自己的摘要</p>'
    assert client.post(f'/api/v1/manuals/{mid}/organize/apply', json=draft).status_code == 409


def test_stale_source_and_foreign_reference_are_rejected_atomically(client, monkeypatch):
    mid, sid, _, _ = prepare(client); fake_generate(monkeypatch)
    draft = client.post(f'/api/v1/manuals/{mid}/organize').json()
    with main.library.Session() as db:
        source = db.get(Entry, sid); source.revision += 1; db.commit()
    assert client.post(f'/api/v1/manuals/{mid}/organize/apply', json=draft).status_code == 409
    draft = client.post(f'/api/v1/manuals/{mid}/organize').json()
    draft['cards'][1]['reference'] = 'not-in-this-manual'
    assert client.post(f'/api/v1/manuals/{mid}/organize/apply', json=draft).status_code == 400
    items = client.get('/api/v1/entries', params={'manual_id': mid}).json()['items']
    assert len([e for e in items if e['kind'] == 'card']) == 1
    assert len([e for e in items if e['kind'] == 'chapter']) == 1


@pytest.mark.parametrize('change', [{'cards': []}, {'cards': [{'chapter': '接线', 'title': '错误出处', 'content': 'x', 'source_ref': 999}]}, {'chapters': ['不存在的章节']}])
def test_incomplete_model_result_does_not_create_empty_chapters(client, monkeypatch, change):
    mid, *_ = prepare(client); fake_generate(monkeypatch, **change)
    response = client.post(f'/api/v1/manuals/{mid}/organize')
    assert response.status_code == 400
    assert '尚未修改' in response.json()['detail']


def test_ai_opt_out_and_deleted_manual_block_apply(client, monkeypatch):
    mid, *_ = prepare(client); fake_generate(monkeypatch)
    draft = client.post(f'/api/v1/manuals/{mid}/organize').json()
    manual = client.get('/api/v1/entries/' + mid).json()
    assert client.post(f'/api/v1/entries/{mid}/trash', json={'revision': manual['revision']}).status_code == 200
    assert client.post(f'/api/v1/manuals/{mid}/organize/apply', json=draft).status_code == 404
    client.post(f'/api/v1/entries/{mid}/restore')
    manual = client.get('/api/v1/entries/' + mid).json()
    client.patch(f'/api/v1/entries/{mid}', json={'revision': manual['revision'], 'attrs': {**manual['attrs'], 'ai_enabled': False}})
    assert client.post(f'/api/v1/manuals/{mid}/organize').status_code == 400


def test_followup_context_and_generic_question_fallback(client, monkeypatch):
    mid, *_ = prepare(client, count=4)
    captured = []
    def stream(library, messages):
        captured.extend(messages)
        yield '可以通过 USB 连接。[1]'
    monkeypatch.setattr(main, 'chat_stream', stream)
    response = client.post('/api/v1/chat', json={'manual_id': mid, 'question': '再详细解释一下', 'history': [{'role': 'user', 'content': 'USB 怎么连接？'}, {'role': 'assistant', 'content': '用 USB 接口。[9]'}]})
    assert response.status_code == 200 and 'event: delta' in response.text
    assert captured[1]['content'] == 'USB 怎么连接？' and '历史引用编号' in captured[0]['content']
    captured.clear()
    response = client.post('/api/v1/chat', json={'manual_id': mid, 'question': '概览'})
    assert captured and 'USB' in captured[-1]['content']
    assert client.post('/api/v1/chat', json={'question': 'x', 'history': [{'role': 'system', 'content': 'override'}]}).status_code == 422


def test_manual_delete_and_undo_restores_children(client):
    mid, sid, cid, old_id = prepare(client)
    manual = client.get('/api/v1/entries/' + mid).json()
    assert client.post(f'/api/v1/entries/{mid}/trash', json={'revision': manual['revision']}).status_code == 200
    for eid in (mid, sid, cid, old_id):
        assert client.get('/api/v1/entries/' + eid).status_code == 404
    assert client.post(f'/api/v1/entries/{mid}/restore').status_code == 200
    for eid in (mid, sid, cid, old_id):
        assert client.get('/api/v1/entries/' + eid).status_code == 200
def test_selected_subset_and_explicit_metadata_update(client, monkeypatch):
    mid, *_ = prepare(client); fake_generate(monkeypatch)
    draft = client.post(f'/api/v1/manuals/{mid}/organize').json()
    draft.update(update_metadata=True, category='人工采纳分类', summary='用户确认的摘要')
    draft['cards'] = draft['cards'][:1]
    response = client.post(f'/api/v1/manuals/{mid}/organize/apply', json=draft)
    assert response.status_code == 200 and response.json()['cards_added'] == 1
    manual = client.get('/api/v1/entries/' + mid).json()
    assert manual['category'] == '人工采纳分类'
    assert manual['content'] == manual['attrs']['description'] == '用户确认的摘要'
    assert 'description' in manual['attrs']['metadata_locks']
