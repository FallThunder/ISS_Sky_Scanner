"""Unit tests for the Cloud Function changes (no GCP credentials needed)."""
import json
from unittest import mock

import flask

from conftest import ERROR_ENTRY, VALID_ENTRY, fake_db, load_function

VALID_ENTRY_2 = {**VALID_ENTRY, 'timestamp': '2026-10-25T05:25:00+00:00', 'latitude': 5.0}


def test_time_range_dedupes_preferring_valid():
    utils, _ = load_function('iss_api_query_time_range')
    db, q = fake_db([ERROR_ENTRY, dict(ERROR_ENTRY), VALID_ENTRY_2, {**ERROR_ENTRY, 'timestamp': VALID_ENTRY_2['timestamp']}])
    with mock.patch.object(utils.firestore, 'Client', return_value=db):
        res = utils.query_time_range(30)
    assert [r['timestamp'] for r in res] == [ERROR_ENTRY['timestamp'], VALID_ENTRY_2['timestamp']], res
    assert res[0]['isEmpty'] and not res[1]['isEmpty']
    # Valid entry arriving after an error entry for the same slot wins
    db, q = fake_db([ERROR_ENTRY, VALID_ENTRY])
    with mock.patch.object(utils.firestore, 'Client', return_value=db):
        res = utils.query_time_range(30)
    assert len(res) == 1 and res[0]['latitude'] == 10.0
    # Bounds use +00:00 format to match stored strings
    bounds = [c.args[2] for c in q.where.call_args_list]
    assert all(b.endswith('+00:00') for b in bounds), bounds


def test_loc_history_valid_only():
    utils, main = load_function('iss_api_query_loc_history')
    db, q = fake_db([ERROR_ENTRY, dict(ERROR_ENTRY), VALID_ENTRY, VALID_ENTRY_2])
    with mock.patch.object(utils.firestore, 'Client', return_value=db):
        res = utils.query_location_history(limit=1, valid_only=True)
    assert res == [VALID_ENTRY], res
    q.limit.assert_called_with(utils.VALID_ONLY_SCAN_LIMIT)
    db, q = fake_db([ERROR_ENTRY, VALID_ENTRY])
    with mock.patch.object(utils.firestore, 'Client', return_value=db):
        assert utils.query_location_history(limit=1) == [ERROR_ENTRY]
    # HTTP param plumbing
    app = flask.Flask('t')
    with app.test_request_context('/?limit=1&valid_only=true'):
        with mock.patch.object(main, 'query_location_history', return_value=[VALID_ENTRY]) as qlh:
            main.iss_api_query_loc_history(flask.request)
        assert qlh.call_args.kwargs['valid_only'] is True


def test_bff_web_skips_error_entry_and_encodes_location():
    utils, main = load_function('iss_api_bff_web')
    session = mock.MagicMock()
    loc_resp = mock.MagicMock(); loc_resp.json.return_value = {'status': 'success', 'locations': [dict(VALID_ENTRY, location='A & B')]}
    fact_resp = mock.MagicMock(); fact_resp.json.return_value = {'fact': 'F'}
    session.get.side_effect = [loc_resp, fact_resp]
    with mock.patch.object(utils, '_get_session', return_value=session), \
         mock.patch.object(utils, 'get_id_token', return_value='t'):
        res = utils.get_iss_location_with_fact()
    assert res['fun_fact'] == 'F' and res['latitude'] == 10.0
    assert session.get.call_args_list[0].kwargs['params'] == {'limit': 1, 'valid_only': 'true'}
    assert session.get.call_args_list[1].kwargs['params'] == {'location': 'A & B'}
    # Old query_loc_history (ignores valid_only) returning an error entry -> None
    loc_resp.json.return_value = {'status': 'success', 'locations': [ERROR_ENTRY]}
    session.get.side_effect = [loc_resp]
    with mock.patch.object(utils, '_get_session', return_value=session), \
         mock.patch.object(utils, 'get_id_token', return_value='t'):
        assert utils.get_iss_location_with_fact() is None


def test_bff_esp_fact_failure_is_non_fatal():
    utils, _ = load_function('iss_api_bff_esp')
    loc_resp = mock.MagicMock(); loc_resp.json.return_value = {'status': 'success', 'locations': [dict(VALID_ENTRY)]}
    with mock.patch.object(utils, 'get_id_token', return_value='t'), \
         mock.patch.object(utils.requests, 'get', side_effect=[loc_resp, Exception('boom')]) as g:
        res = utils.get_iss_location_with_fact()
    assert res['fun_fact'] == 'Fun fact coming soon!'
    assert g.call_args_list[0].kwargs['params']['valid_only'] == 'true'


def test_assistant_parse_and_request():
    utils, main = load_function('iss_api_query_assistant')
    assert utils.parse_model_json('```json\n{"a": 1}\n```') == {'a': 1}
    assert utils.parse_model_json('{"message": "json is fun"}') == {'message': 'json is fun'}
    client = mock.MagicMock()
    client.models.generate_content.return_value = mock.MagicMock(text='{"x":1}')
    with mock.patch.object(utils, 'get_genai_client', return_value=client):
        assert utils.query_gemini('where is the ISS') == '{"x":1}'
    kw = client.models.generate_content.call_args.kwargs
    assert kw['model'] == 'gemini-3.5-flash-lite' and kw['contents'] == 'where is the ISS'
    assert kw['config'].response_mime_type == 'application/json'
    assert kw['config'].system_instruction == utils.SYSTEM_PROMPT
    # thinking config rejected -> retried without it
    from google.genai import errors
    client.models.generate_content.side_effect = [
        errors.ClientError(400, {'error': {'message': 'bad thinking', 'status': 'INVALID_ARGUMENT'}}),
        mock.MagicMock(text='{"y":2}')]
    with mock.patch.object(utils, 'get_genai_client', return_value=client):
        assert utils.query_gemini('q') == '{"y":2}'
    assert client.models.generate_content.call_args.kwargs['config'].thinking_config is None
    # Vertex client, not an API key
    with mock.patch.object(utils.genai, 'Client') as C:
        utils._genai_client = None
        utils.get_genai_client()
    assert C.call_args.kwargs['vertexai'] is True and 'api_key' not in C.call_args.kwargs


def test_assistant_end_to_end_db_query():
    utils, main = load_function('iss_api_query_assistant')
    app = flask.Flask('t')
    answer = json.dumps({
        'message': 'Let me check', 'action': 'query_db',
        'data': {'collection': 'iss_loc_history', 'limit': 1, 'order_by': 'timestamp', 'order_direction': 'DESCENDING'}})
    db_resp = mock.MagicMock(status_code=200)
    db_resp.json.return_value = {'status': 'success', 'locations': [VALID_ENTRY]}
    with app.test_request_context('/', method='POST', json={'query': 'Where is the ISS?'}):
        with mock.patch.object(main, 'query_gemini', return_value=answer), \
             mock.patch.object(utils.google.auth, 'default', return_value=(mock.MagicMock(), 'p')), \
             mock.patch.object(utils.google.oauth2.id_token, 'fetch_id_token', return_value='t'), \
             mock.patch.object(utils.requests, 'get', return_value=db_resp) as get:
            body, status, _ = main.iss_api_query_assistant(flask.request)
    assert status == 200
    inner = utils.parse_model_json(body.get_json()['response'])
    assert '10.0000°N' in inner['message'], inner
    assert get.call_args.kwargs['params']['valid_only'] == 'true'


def test_loc_fact_genai():
    utils, main = load_function('iss_api_get_loc_fact')
    client = mock.MagicMock()
    client.models.generate_content.return_value = mock.MagicMock(text=' Fact! ')
    with mock.patch.object(utils, 'get_genai_client', return_value=client), \
         mock.patch.object(utils, 'get_location_fact_prompt', return_value='Fact about {location}'):
        fact, err = utils.generate_location_fun_fact('Paris')
    assert fact == 'Fact!' and err is None
    kw = client.models.generate_content.call_args.kwargs
    assert kw['model'] == 'gemini-3.5-flash-lite' and kw['contents'] == 'Fact about Paris'
    assert kw['config'].thinking_config.thinking_level.name == 'LOW'
    # 400 on thinking -> retry without thinking config
    from google.genai import errors
    client.models.generate_content.side_effect = [
        errors.ClientError(400, {'error': {'message': 'bad thinking', 'status': 'INVALID_ARGUMENT'}}),
        mock.MagicMock(text='Fact2')]
    with mock.patch.object(utils, 'get_genai_client', return_value=client), \
         mock.patch.object(utils, 'get_location_fact_prompt', return_value='{location}'):
        fact, err = utils.generate_location_fun_fact('Paris')
    assert fact == 'Fact2' and err is None
    # Empty response -> fallback text + error info
    client.models.generate_content.side_effect = None
    client.models.generate_content.return_value = mock.MagicMock(text=None, candidates=[])
    with mock.patch.object(utils, 'get_genai_client', return_value=client), \
         mock.patch.object(utils, 'get_location_fact_prompt', return_value='{location}'):
        fact, err = utils.generate_location_fun_fact('Paris')
    assert 'coming soon' in fact and err
    # Real client construction works with the configured settings
    with mock.patch.object(utils.genai, 'Client') as C:
        utils._genai_client = None
        utils.get_genai_client()
    assert C.call_args.kwargs['vertexai'] is True and C.call_args.kwargs['location'] == 'global'


def test_store_realtime_no_duplicate_error_entries():
    utils, _ = load_function('iss_api_store_realtime_loc')
    with mock.patch.object(utils, 'get_id_token', return_value='t'), \
         mock.patch.object(utils.requests, 'get', side_effect=utils.requests.exceptions.ReadTimeout('slow')) as g, \
         mock.patch.object(utils, 'store_error_entry') as store_err:
        res = utils.store_iss_location()
    assert res.get('error')
    assert store_err.call_count == 1, store_err.call_count
    assert g.call_args.kwargs['timeout'] == 25
