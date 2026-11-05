"""Summarize one JSONL run; errors/missing cases never disappear into averages."""
import argparse
from collections import Counter
import json
from pathlib import Path
from evaluation.e2e.dataset import CASES


def summarize(path, expected=None):
    if expected is None:
        manifest = Path(path).parent / "manifest.json"
        expected = json.loads(manifest.read_text())["cases"] if manifest.exists() else [c["id"] for c in CASES]
    results = []
    for line in Path(path).read_text().splitlines():
        if not line.startswith('{'):
            continue
        row = json.loads(line)
        if row.get('event') == 'result':
            results.append(row)
    if len({r['run_id'] for r in results}) > 1:
        raise ValueError('Use one run per report; concatenated runs are ambiguous')
    if len({r['case'] for r in results}) != len(results):
        raise ValueError('Duplicate case results')
    counts = Counter(r['status'] for r in results)
    print(f"{len(results)}/{len(expected)} completed; {counts['passed']} passed, {counts['failed']} failed, {counts['error']} errors")
    def value(row, name):
        item = row.get('manual', {}).get(name)
        return '-' if not item else f"{item['value']:.2f}"
    print('| Case | Status | Retrieved papers | Lineage papers | Note links | Context recall | Min faithfulness | Correctness |')
    print('|---|---|---|---|---|---|---|---|')
    for row in results:
        faithful = [s['value'] for s in row.get('faithfulness', [])]
        print('| ' + ' | '.join([row['case'], row['status'], value(row, 'retrieval_paper_recall'),
            value(row, 'lineage_paper_recall'), value(row, 'note_foundation_recall'),
            str(row.get('context_recall', {}).get('value', '-')),
            f'{min(faithful):.2f}' if faithful else '-', str(row.get('correctness', {}).get('value', '-'))]) + ' |')
        for failure in row.get('failures', []):
            print(f"  {failure}")
        if 'error' in row:
            print(f"  Error: {row['error']}")
    missing = set(expected) - {r['case'] for r in results}
    if counts["smoke_passed"] or counts["smoke_failed"]:
        print(f"Smoke checks only: {counts['smoke_passed']} passed, {counts['smoke_failed']} failed; scientific judges NOT RUN.")
    if counts["skipped"]:
        print(f"Judging skipped for {counts['skipped']} cases; these are not passes.")
    unexpected = {r["case"] for r in results} - set(expected)
    if unexpected:
        raise ValueError(f"Results outside selected manifest: {sorted(unexpected)}")
    if results and results[-1].get("budget"):
        print("Estimated spend: " + json.dumps(results[-1]["budget"]))
    if missing:
        print('Not run: ' + ', '.join(sorted(missing)))
    print(f"API calls: {sum(r['target_calls'] for r in results)} target, {sum(r['judge_calls'] for r in results)} judge")
    return 1 if missing or counts['failed'] or counts['error'] or counts['smoke_failed'] or counts['skipped'] else 0

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('report')
    raise SystemExit(summarize(parser.parse_args().report))
