"""No-network harness verification, NOT scientific evaluation results.

Runs all 30 scenarios through the real FastAPI app, OpenAlex parsing, Anthropic
client boundary and real Ragas/Instructor/OpenAI SDK with synthetic responses.
"""
import asyncio
import contextlib
from copy import deepcopy
import io
import json
import logging
import os
import re
import socket
from types import SimpleNamespace
from unittest.mock import patch

# Override before importing app or loading .env. Network is also physically blocked.
os.environ.update(RUN_E2E_EVALS="1", RAGAS_DO_NOT_TRACK="true", ANTHROPIC_API_KEY="offline",
                  OPENAI_API_KEY="offline", ACTOR_KEY_SECRET="offline",
                  OPENALEX_API_KEY="offline", SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="")
import httpx
import openai
from evaluation.e2e.capture import json_after, stage_contexts
from evaluation.e2e.dataset import CASES, TOPICS, normalize_title, paper
from evaluation.e2e.test_suite import EndToEndEvals

state = {}


class Block(SimpleNamespace):
    def model_dump(self, **kwargs):
        return vars(self)


def prepare(case, fault=None):
    topic = TOPICS[case['topic']]
    catalog = deepcopy(topic['papers'])
    for index, p in enumerate(catalog):
        p['id'] = f'W{100 + index}'
    by_alias = {p['openalexId']: p for p in catalog}
    ids = [by_alias[topic['seed']]['id'], *[p['id'] for p in catalog[1:-1]]]
    state.clear()
    state.update(case=case, topic=topic, catalog=catalog, ids=ids,
                 deep_step=0, recall_step=0, nli_step=0, fault=fault, by_alias=by_alias)


def raw_work(p):
    abstract_index = {}
    for index, word in enumerate(p['abstract'].split()):
        abstract_index.setdefault(word, []).append(index)
    refs = [x['id'] for x in state['catalog'][1:]] if p['id'] == state['ids'][0] else []
    return dict(id='https://openalex.org/' + p['id'], display_name=p['title'],
                publication_year=p['year'], abstract_inverted_index=abstract_index,
                cited_by_count=1000, referenced_works=['https://openalex.org/' + r for r in refs])


async def provider_get(session, url, params):
    """Fake HTTP payloads, preserving real provider normalization and selection."""
    catalog = state['catalog']
    if '/works/W' in url:
        return raw_work(next(p for p in catalog if p['id'] == url.rsplit('/', 1)[-1]))
    query = params.get('filter', '')
    if query.startswith('openalex:'):
        ids = query.split(':', 1)[1].split('|')
        results = [p for p in catalog if p['id'] in ids]
    else:
        search = query.split(':', 1)[-1].strip('"')
        seed = catalog[0]
        if normalize_title(search) in {normalize_title(state['case']['query']), normalize_title(seed['title']), normalize_title(state['topic']['concept'])}:
            results = [seed, catalog[-1]]
        else:
            words = set(re.findall(r'\w+', search.lower()))
            results = [p for p in catalog if words & set(re.findall(r'\w+', p['title'].lower()))]
    return {'results': [raw_work(p) for p in results[:int(params.get('per-page', 20))]]}


def notes():
    foundations = [state['by_alias'][alias] for alias in state['topic']['required']]
    return dict(text=' '.join(p['abstract'] for p in foundations), kind='insight', color='green',
                paperIds=state['ids'], relation='insight')


async def target_create(self, **kwargs):
    prompt = kwargs['messages'][-1]['content']
    if state['fault'] == 'target_error' and isinstance(prompt, str) and 'writing canvas notes' in prompt:
        raise RuntimeError('Synthetic provider failure')
    if kwargs.get('tools'):
        step = state['deep_step']
        if step == 0:
            name, data = 'search_openalex_papers', {'query': state['case']['query']}
        elif step == 1:
            name, data = 'get_openalex_references', {'paperId': state['ids'][0]}
        else:
            name, data = 'finish_deep_trace', dict(seedPaperId=state['ids'][0],
                papers=[{'paperId': p['id'], 'summary': p['abstract']} for p in state['catalog'][:-1]],
                edges=[{'parentPaperId': pid, 'childPaperId': state['ids'][0]} for pid in state['ids'][1:]],
                notes=[notes()])
        state['deep_step'] += 1
        content = [Block(type='tool_use', id=f'offline-{step}', name=name, input=data)]
    else:
        if 'Choose the single best seed' in prompt:
            candidates = json_after(prompt, 'Candidates:\n')
            data = dict(index=next(p['index'] for p in candidates if p['title'] == state['catalog'][0]['title']), confidence='high', reason='Synthetic offline choice')
        elif 'candidate ancestor papers' in prompt:
            candidates = json_after(prompt, 'Candidates:\n')
            wanted = state['ids'][1:]
            if state['fault'] == 'missing_foundation':
                missing = state['by_alias'][state['topic']['required'][0]]['id']
                wanted = [pid for pid in wanted if pid != missing]
            data = [dict(index=p['index'], summary=p['detail']) for p in candidates if p['openalexId'] in wanted]
        elif 'writing canvas notes' in prompt:
            data = {'notes': [notes()]}
        elif 'You help users of a research paper lineage explorer' in prompt:
            data = dict(needs_clarification=False, refined_query=state['catalog'][0]['title'])
        else:
            raise AssertionError('Unexpected target prompt')
        content = [Block(type='text', text=json.dumps(data))]
    return SimpleNamespace(content=content, usage=Block(input_tokens=0, output_tokens=0))


async def judge_http(request):
    payload = json.loads(request.content)
    assert payload['model'] == 'gpt-6-astra' and payload['store'] is False
    assert payload['max_completion_tokens'] == 4096 and 'max_tokens' not in payload
    assert str(request.url) == 'https://api.openai.com/v1/chat/completions'
    serialized = json.dumps(payload)
    reason = 'Synthetic offline verdict; not a scientific judgment'
    if 'StatementGeneratorOutput' in serialized:
        answer = {'statements': ['Claim one.', 'Claim two.']}
    elif 'NLIStatementOutput' in serialized:
        # Good summaries must not mask unsupported notes in a pooled average.
        low_notes = state['fault'] == 'faithfulness' and state['nli_step'] == 1
        answer = {'statements': [dict(statement='Claim one.', reason=reason, verdict=1),
                                dict(statement='Claim two.', reason=reason, verdict=0 if low_notes else 1)]}
        state['nli_step'] += 1
        if state['fault'] == 'omitted_claim':
            answer['statements'].pop()
    elif 'ContextRecallOutput' in serialized:
        attributed = 0 if state['fault'] == 'context_recall' and state['recall_step'] == 0 else 1
        answer = {'classifications': [dict(statement='Synthetic reference fact.', reason=reason, attributed=attributed)]}
        state['recall_step'] += 1
    elif 'RubricScoreOutput' in serialized:
        answer = dict(score=2 if state['fault'] == 'correctness' else 5, feedback=reason)
    else:
        raise AssertionError('Unexpected judge schema')
    return httpx.Response(200, json=dict(id='offline', object='chat.completion', created=0,
        model='gpt-6-astra', choices=[dict(index=0, finish_reason='stop', message=dict(role='assistant', content=json.dumps(answer)))],
        usage=dict(prompt_tokens=1, completion_tokens=1, total_tokens=2)))


original_init = openai.AsyncOpenAI.__init__

def offline_openai(self, *args, **kwargs):
    kwargs['http_client'] = httpx.AsyncClient(transport=httpx.MockTransport(judge_http))
    original_init(self, *args, **kwargs)


async def run_case(case, fault=None):
    prepare(case, fault)
    test = EndToEndEvals('runTest')
    error = None
    with contextlib.redirect_stdout(io.StringIO()) as output:
        try:
            await test.asyncSetUp()
            if fault == 'reversed_edge':
                original_request = test.request_graph
                async def reversed_edge(*args):
                    graph = await original_request(*args)
                    edge = graph['edges'][0]
                    edge['parentOpenalexId'], edge['childOpenalexId'] = edge['childOpenalexId'], edge['parentOpenalexId']
                    return graph
                test.request_graph = reversed_edge
            await test.evaluate_case(case)
        except Exception as exc:
            error = exc
        finally:
            while test._cleanups:
                fn, args, kwargs = test._cleanups.pop()
                result = fn(*args, **kwargs)
                if hasattr(result, '__await__'):
                    await result
    rows = [json.loads(line) for line in output.getvalue().splitlines() if line.startswith('{')]
    final = next((r for r in rows if r['event'] == 'result'), None)
    if not fault:
        if error:
            raise error
        assert final['status'] == 'passed'
        # Stages record raw requests before mutation and contain exactly the inputs
        # production sent, while gold appears only in correctness/reference fields.
        for metric in final['faithfulness']:
            assert metric['contexts'] and metric['steps']
        assert len(final['context_recall']['facts']) == 3
        assert final['judge_calls'] in (6, 8)
    else:
        assert error is not None, f'{fault} incorrectly passed'
        expected = {'faithfulness': 'faithfulness/', 'context_recall': 'context_recall=',
                    'correctness': 'scientific_correctness=', 'missing_foundation': 'lineage_paper_recall',
                    'reversed_edge': 'unverified direct-citation edges',
                    'omitted_claim': 'omitted/changed claims', 'target_error': 'hidden by application fallback'}
        assert expected[fault] in str(error), (fault, str(error))
    return final


def check_context_isolation():
    stage = {'name': 'trace_lineage_agentic', 'requests': [{'messages': [
        {'role': 'user', 'content': '<selected_seed>{"title":"Selected evidence"}</selected_seed>'},
        {'role': 'assistant', 'content': 'Assistant hallucination CANARY'},
        {'role': 'user', 'content': [
            {'type': 'tool_result', 'is_error': True, 'content': 'Error CANARY'},
            {'type': 'tool_result', 'content': '<untrusted_openalex_tool_result>{"status":"completed","papers":[{"title":"Retrieved evidence"}]}</untrusted_openalex_tool_result>'}]}]}]}
    contexts = stage_contexts(stage)
    assert len(contexts) == 2 and 'CANARY' not in ''.join(contexts)
    try:
        stage_contexts({'name': 'rank_references', 'requests': [{'messages': [{'content': 'Changed prompt'}]}]})
    except ValueError:
        pass
    else:
        raise AssertionError('Prompt drift silently passed')


async def main():
    from evaluation.e2e.report import summarize
    import tempfile
    rows = []
    for case in CASES:
        rows.append(await run_case(case))
    for fault in ('faithfulness', 'context_recall', 'correctness', 'missing_foundation',
                  'reversed_edge', 'omitted_claim', 'target_error'):
        await run_case(CASES[0], fault)
    check_context_isolation()
    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, 'offline.jsonl')
        with open(path, 'w') as output:
            for row in rows:
                output.write(json.dumps(row) + '\n')
        with contextlib.redirect_stdout(io.StringIO()):
            assert summarize(path) == 0
        with open(path, 'w') as output:
            output.write(json.dumps(rows[0]) + '\n')
        with contextlib.redirect_stdout(io.StringIO()):
            assert summarize(path) == 1, 'A partial run must not report overall success'
    print('Passed: all 30 API scenarios; seven failure controls; context isolation and report checks. No live API calls. Synthetic scores are not app-quality results.')


if __name__ == '__main__':
    logging.disable(logging.CRITICAL)
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
         patch('app.services.openalex._get', provider_get), \
         patch('anthropic.resources.messages.AsyncMessages.create', target_create), \
         patch.object(openai.AsyncOpenAI, '__init__', offline_openai):
        asyncio.run(main())
