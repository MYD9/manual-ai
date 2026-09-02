import json
import os
import tempfile

os.environ['MANUAL_AI_HOME'] = tempfile.mkdtemp(prefix='manual-identify-bootstrap-')
os.environ['MANUAL_AI_NO_WORKER'] = '1'

import pytest
from fastapi.testclient import TestClient
from backend import main, identification
from backend.processing import Processor
from backend.storage import Library


@pytest.fixture
def client(tmp_path, monkeypatch):
    library = Library(tmp_path / 'library-data')
    monkeypatch.setattr(main, 'library', library)
    monkeypatch.setattr(main, 'processor', Processor(library))
    monkeypatch.setattr(main, 'api_config', lambda *a: ('https://example.invalid', 'fixture', 'fixture-only'))
    with TestClient(main.app) as client:
        yield client
    library.engine.dispose()


def upload(client, request_id='one', **kwargs):
    response = client.post('/api/v1/imports/file', data={'new_manual': 'true', 'request_id': request_id, **kwargs}, files={'file': ('board.txt', '星河 X100 开发板说明书。USB 接口用于连接电脑，支持串口调试。'.encode())})
    assert response.status_code == 202, response.text
    return response.json()


def prepare(client):
    imported = upload(client)
    main.processor.process(imported['job_id'], imported['source']['id'])
    mid = imported['source']['manual_id']
    job = next(j for j in client.get('/api/v1/jobs').json()['items'] if j['kind'] == 'identify')
    return mid, job['id'], imported['source']['id']


def metadata(**changes):
    return {'title':'星河 X100 开发板', 'brand':'星河', 'model':'X100', 'device':'开发板', 'description':'USB 开发板与串口调试', 'category':'嵌入式开发', 'tags':['开发板','USB'], 'reason':'正文含开发板、串口调试，与嵌入式规则匹配。', **changes}


def identify(mid, jid):
    identification.identify_manual(main.library, jid, mid, main.processor.update)


def test_new_import_atomic_idempotent_and_opt_out(client):
    bad = client.post('/api/v1/imports/file', data={'new_manual':'true'}, files={'file':('bad.exe',b'bad')})
    assert bad.status_code == 400
    assert client.get('/api/v1/entries?kind=manual').json()['items'] == []
    first = upload(client, auto_identify='false')
    repeated = upload(client, auto_identify='false')
    assert repeated['duplicate'] and first['source']['id'] == repeated['source']['id']
    assert len(client.get('/api/v1/entries?kind=manual').json()['items']) == 1
    main.processor.process(first['job_id'], first['source']['id'])
    assert not any(j['kind'] in {'identify','index'} for j in client.get('/api/v1/jobs').json()['items'])


def test_rules_revision_validation_and_settings_independence(client):
    payload = {'revision':0,'rules':[{'category':' 嵌入式开发 ','keywords':['开发板','串口','开发板']}]}
    result = client.put('/api/v1/classification-rules', json=payload)
    assert result.status_code == 200, result.text
    assert result.json()['rules'][0] == {'category':'嵌入式开发','keywords':['开发板','串口']}
    assert client.put('/api/v1/classification-rules', json=payload).status_code == 409
    assert client.put('/api/v1/classification-rules', json={'revision':1,'rules':[{'category':'','keywords':[]}]}).status_code == 422
    assert client.put('/api/v1/settings',json={'chat_base':'https://api.deepseek.com','chat_model':'fixture'}).status_code == 200
    assert client.get('/api/v1/classification-rules').json()['revision'] == 1


def test_auto_identifies_without_embeddings(client, monkeypatch):
    rules = [{'category':'嵌入式开发','keywords':['开发板','串口']}]
    client.put('/api/v1/classification-rules',json={'revision':0,'rules':rules})
    mid, jid, sid = prepare(client)
    seen = []
    def fake(library, messages):
        seen.append(json.loads(messages[-1]['content'].split('\n', 1)[1]))
        return metadata(description='<script>not HTML</script>')
    monkeypatch.setattr(identification,'chat_json',fake)
    identify(mid,jid)
    manual = client.get('/api/v1/entries/'+mid).json()
    assert manual['title'] == '星河 X100 开发板'
    assert manual['attrs']['model'] == 'X100' and manual['category'] == '嵌入式开发'
    assert '<script>' not in manual['content']
    assert seen[0]['classification_rules'] == rules and 'X100' in seen[0]['samples'][0]['text']
    assert not any(j['kind']=='index' for j in client.get('/api/v1/jobs').json()['items'])
    assert client.post('/api/v1/search',json={'q':'星河','mode':'keyword'}).json()['items']
    assert client.get('/api/v1/entries/'+sid).json()['attrs']['status'] == 'ready'


def test_manual_edits_during_identification_are_preserved(client, monkeypatch):
    mid,jid,_ = prepare(client)
    def fake(*args):
        entry = client.get('/api/v1/entries/'+mid).json()
        assert client.patch('/api/v1/entries/'+mid,json={'revision':entry['revision'],'title':'我写的标题','attrs':{'model':'X100 修订版'},'category':'我的设备'}).status_code == 200
        return metadata()
    monkeypatch.setattr(identification,'chat_json',fake)
    identify(mid,jid)
    entry = client.get('/api/v1/entries/'+mid).json()
    assert entry['title']=='我写的标题' and entry['attrs']['model']=='X100 修订版' and entry['category']=='我的设备'
    assert entry['attrs']['brand']=='星河'
    assert set(entry['attrs']['metadata_locks']) >= {'title','model','category'}


def test_single_category_override_preserves_other_fields_and_rules(client,monkeypatch):
    mid,jid,_ = prepare(client)
    client.post('/api/v1/jobs/'+jid+'/cancel')
    current = client.get('/api/v1/entries/'+mid).json()
    client.patch('/api/v1/entries/'+mid,json={'revision':current['revision'],'title':'我的开发板','category':'旧分类'})
    current = client.get('/api/v1/entries/'+mid).json()
    rules = {'revision':0,'rules':[{'category':'家电','keywords':['设备']}]}
    client.put('/api/v1/classification-rules',json=rules)
    payload = {'revision':current['revision'],'instruction':'这是开发板，请归到嵌入式开发，不要放家电','scope':'category'}
    request = client.post('/api/v1/manuals/'+mid+'/identify',json=payload)
    assert request.status_code == 202,request.text
    assert client.post('/api/v1/manuals/'+mid+'/identify',json=payload).status_code == 409
    assert client.post('/api/v1/jobs/'+jid+'/retry').status_code == 409
    monkeypatch.setattr(identification,'chat_json',lambda *a: metadata())
    identify(mid,request.json()['job_id'])
    entry = client.get('/api/v1/entries/'+mid).json()
    assert entry['category']=='嵌入式开发' and entry['title']=='我的开发板'
    assert not entry['attrs'].get('model')
    assert client.get('/api/v1/classification-rules').json()['rules'] == rules['rules']


@pytest.mark.parametrize('event',['cancel','source','rules','disable'])
def test_stale_or_cancelled_identification_does_not_apply(client,monkeypatch,event):
    mid,jid,sid = prepare(client)
    def fake(*args):
        if event == 'cancel': client.post('/api/v1/jobs/'+jid+'/cancel')
        if event == 'source':
            source = client.get('/api/v1/entries/'+sid).json()
            client.patch('/api/v1/sources/'+sid+'/text',json={'revision':source['revision'],'block':0,'text':'新型号 X200 的正文'})
        if event == 'rules': client.put('/api/v1/classification-rules',json={'revision':0,'rules':[]})
        if event == 'disable':
            manual = client.get('/api/v1/entries/'+mid).json()
            client.patch('/api/v1/entries/'+mid,json={'revision':manual['revision'],'attrs':{'ai_enabled':False}})
        return metadata()
    monkeypatch.setattr(identification,'chat_json',fake)
    with pytest.raises(ValueError):identify(mid,jid)
    assert client.get('/api/v1/entries/'+mid).json()['title']=='board'


def test_invalid_ai_result_or_failure_keeps_original(client,monkeypatch):
    mid,jid,sid = prepare(client)
    monkeypatch.setattr(identification,'chat_json',lambda *a:{'title':['bad value']})
    with pytest.raises(ValueError,match='格式无效'):identify(mid,jid)
    source = client.get('/api/v1/entries/'+sid).json()
    assert client.get('/api/v1/blobs/'+source['attrs']['hash']).status_code == 200
    assert client.get('/api/v1/entries/'+mid).json()['title']=='board'
    monkeypatch.setattr(identification,'chat_json',lambda *a:metadata(title='board',brand='',model='',device='',description=''))
    with pytest.raises(ValueError,match='空识别结果'):identify(mid,jid)
    assert client.get('/api/v1/entries/'+mid).json()['title']=='board'


def test_unknown_category_cannot_escape_rules_without_instruction(client,monkeypatch):
    client.put('/api/v1/classification-rules',json={'revision':0,'rules':[{'category':'家电','keywords':['冰箱']}]})
    mid,jid,_ = prepare(client)
    monkeypatch.setattr(identification,'chat_json',lambda *a:metadata())
    identify(mid,jid)
    assert client.get('/api/v1/entries/'+mid).json()['category']==''
