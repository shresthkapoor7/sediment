"""Manual local runner. Planning is offline; live execution requires explicit caps."""
import argparse
import asyncio
from datetime import datetime, timezone
import fcntl
import hashlib
import io
from contextlib import redirect_stdout
from importlib.metadata import version, PackageNotFoundError
import json
import os
from pathlib import Path
import subprocess
import uuid
from unittest.mock import patch

from evaluation.e2e.budget import Budget, PRICING_VERSION
from evaluation.e2e.capture import Capture
from evaluation.e2e.dataset import CASES, DATASET_SHA256, TOPICS
from evaluation.e2e.metrics import JUDGE_MODEL, Judges, manual_metrics
from evaluation.e2e.regressions import REGRESSIONS, run_regression

ROOT = Path(__file__).resolve().parents[2]
SMOKE = {"transformer_standard", "rag_deep", "resnet_expand", "fista_clarify",
         "admm_selected_seed", "compressed_sensing_standard"}


def fingerprint():
    digest = hashlib.sha256()
    for base in (ROOT / "app", ROOT / "evaluation"):
        for p in sorted(base.rglob("*")):
            if p.suffix in {".py", ".json", ".txt"} and "__pycache__" not in p.parts:
                digest.update(str(p.relative_to(ROOT)).encode())
                digest.update(p.read_bytes())
    try:
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        revision = "unknown"
    packages = {}
    for package in ("anthropic", "openai", "ragas", "instructor"):
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = "not installed"
    digest.update((ROOT / "requirements.txt").read_bytes())
    return {"revision": revision, "source_sha256": digest.hexdigest(), "packages": packages}


def read_results(path, event="result"):
    rows = {}
    raw = Path(path).read_text()
    lines = raw.splitlines()
    for i, line in enumerate(lines):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            if i == len(lines) - 1 and not raw.endswith("\n"):  # Interrupted last write; never discard earlier corruption.
                break
            raise
        if row.get("event") == event:
            if row["case"] in rows:
                raise ValueError("Duplicate result case")
            rows[row["case"]] = row
    return rows


def select_cases(args):
    catalog = CASES + REGRESSIONS
    selected = REGRESSIONS if args.profile == "regressions" else [c for c in catalog if args.profile == "full" or c["id"] in SMOKE]
    if args.cases:
        names = set(args.cases.split(","))
        unknown = names - {c["id"] for c in catalog}
        if unknown:
            raise ValueError(f"Unknown cases: {sorted(unknown)}")
        selected = [c for c in catalog if c["id"] in names]
    return selected


async def judge_case(case, source, budget, cache_dir, emit, skip_invalid):
    record = {"case": case["id"], "topic": case["topic"], "workflow": case["workflow"],
              "dataset_sha256": DATASET_SHA256, "judge_model": JUDGE_MODEL,
              "source_run_id": source.get("run_id"), "target_model": source.get("target_model"),
              "status": "error", "failures": [], "target_calls": 0, "target_usage": [], "openalex_calls": 0}
    judges = None
    try:
        if not source:
            record.update(status="skipped", judge_status="missing_generation")
            return
        if source.get("error"):
            record["error"] = source["error"]
        if case["topic"] is None:
            record.update(status=source["status"], judge_status="functional_only",
                          failures=source.get("failures", []))
            return
        if "graph" not in source or source.get("target_errors"):
            record.update(status="skipped", judge_status="generation_error",
                          failures=source.get("target_errors", []) + source.get("failures", []))
            return
        capture = Capture.from_snapshot(source)
        graph, topic = source["graph"], TOPICS[case["topic"]]
        record["graph"] = graph
        record["manual"], record["failures"] = manual_metrics(topic, case["workflow"], graph, capture)
        invalid = not graph.get("papers") or any(f in record["failures"] for f in
            ("wrong or missing seed", "unresolved search", "requested trace mode fell back"))
        if skip_invalid and invalid:
            record.update(status="skipped", judge_status="invalid_generation")
            return
        from openai import AsyncOpenAI
        async with AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=120, max_retries=0) as client:
            judges = Judges(client, budget=budget, cache_dir=cache_dir)
            record["failures"].extend(await judges.score(case, topic, graph, capture, record))
        record["status"] = "failed" if record["failures"] else "passed"
    except Exception as exc:
        record["error"] = {"phase": "judge", "type": type(exc).__name__}
    finally:
        emit("result", **record, judge_calls=judges.calls if judges else 0,
             judge_usage=judges.usage if judges else [], judge_steps=judges.steps if judges else [])


async def execute(args, directory, manifest, cases, sources):
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    required = "OPENAI_API_KEY" if args.command == "judge" else "ANTHROPIC_API_KEY"
    if not os.environ.get(required):
        raise ValueError(f"Set {required} before live execution")
    budget = Budget(manifest["limits"], directory / "budget.json")
    result_path = directory / "results.jsonl"
    # Never append after an interrupted fragment: retain it separately for diagnosis.
    if result_path.exists():
        raw = result_path.read_bytes()
        if raw and not raw.endswith(b"\n"):
            try:
                json.loads(raw.rsplit(b"\n", 1)[-1])
            except json.JSONDecodeError:
                (directory / "interrupted-tail.txt").write_bytes(raw.rsplit(b"\n", 1)[-1])
                result_path.write_bytes(raw[:raw.rfind(b"\n") + 1])
            else:
                result_path.write_bytes(raw + b"\n")
    done = read_results(result_path) if result_path.exists() else {}
    candidates = read_results(result_path, "candidate") if result_path.exists() else {}

    def emit(event, **fields):
        row = {**fields, "event": event, "run_id": manifest["run_id"],
               "budget": budget.summary()}
        with result_path.open("a") as output:
            output.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            output.flush()
            os.fsync(output.fileno())
        if event == "result":
            print(f"{row['case']}: {row['status']} | {json.dumps(budget.summary())}", flush=True)

    for case in cases:
        if case["id"] in done:
            continue
        if args.command == "generate" and case["id"] in candidates:
            candidate = candidates[case["id"]]
            capture = Capture.from_snapshot(candidate)
            scores, failures = manual_metrics(TOPICS[case["topic"]], case["workflow"], candidate["graph"], capture)
            failures.extend(capture.errors)
            candidate.update(manual=scores, failures=failures, judge_calls=0, judge_status="not_run",
                             status="smoke_failed" if failures else "smoke_passed")
            candidate.pop("event", None)
            emit("result", **candidate)
            continue
        if budget.blocked:
            break
        if args.command == "judge":
            await judge_case(case, sources.get(case["id"], {}), budget, None if args.fresh_judges else args.source / "judge-cache", emit, args.skip_invalid)
        else:
            from evaluation.e2e import test_suite
            capture = None
            test = test_suite.EndToEndEvals("runTest")
            test.budget, test.mode = budget, "generate"
            with patch.object(test_suite, "emit", emit):
                try:
                    await test.asyncSetUp()
                    if case["topic"] is None:
                        capture = Capture(test.stack, test.target, 21, budget=budget)
                        record = await asyncio.wait_for(run_regression(test.api, case), 360)
                        record["failures"].extend(capture.errors)
                        emit("result", case=case["id"], topic=None, workflow=case["workflow"],
                             dataset_sha256=DATASET_SHA256, **record, **capture.snapshot(),
                             status="smoke_failed" if record["failures"] else "smoke_passed",
                             judge_status="functional_only", judge_calls=0)
                    else:
                        await test.evaluate_case(case)
                except Exception as exc:
                    # evaluate_case persists its own result even on failure; setup does not.
                    if not result_path.exists() or case["id"] not in read_results(result_path):
                        snapshot = capture.snapshot() if capture else {"target_calls": 0}
                        emit("result", case=case["id"], status="error", judge_calls=0, **snapshot,
                             failures=[], dataset_sha256=DATASET_SHA256,
                             error={"phase": "application" if capture else "setup", "type": type(exc).__name__})
                finally:
                    await cleanup(test)
    budget.save()
    from evaluation.e2e.report import summarize
    if not result_path.exists():
        return 1
    with redirect_stdout(io.StringIO()) as output:
        status = summarize(result_path, expected=[c["id"] for c in cases])
    (directory / "report.md").write_text(output.getvalue())
    print(output.getvalue())
    return status


async def cleanup(test):
    # IsolatedAsyncioTestCase's synchronous cleanup driver cannot run inside this loop.
    import inspect
    while test._cleanups:
        function, args, kwargs = test._cleanups.pop()
        result = function(*args, **kwargs)
        if inspect.isawaitable(result):
            await result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["generate", "judge"])
    parser.add_argument("--profile", choices=["full", "smoke", "regressions"], default="full")
    parser.add_argument("--cases", help="Comma-separated case IDs (overrides profile)")
    parser.add_argument("--source", type=Path, help="Generation run directory for judging")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--resume", type=Path, help="Continue missing cases; keeps the original spend ledger")
    parser.add_argument("--max-openai-usd", type=float, default=0)
    parser.add_argument("--max-anthropic-usd", type=float, default=0)
    parser.add_argument("--skip-invalid", action="store_true", help="Skip judging wrong-seed/unresolved/fallback graphs")
    parser.add_argument("--fresh-judges", action="store_true", help="Bypass saved successful judge responses")
    parser.add_argument("--live", action="store_true", help="Actually call providers; omitted means offline plan only")
    args = parser.parse_args(argv)
    cases = select_cases(args)
    sources = {}
    source_hash = None
    if args.command == "judge":
        if not args.source:
            parser.error("judge requires --source GENERATION_RUN_DIRECTORY")
        sources = read_results(args.source / "results.jsonl")
        if any(s.get("dataset_sha256") != DATASET_SHA256 for s in sources.values()):
            parser.error("Source dataset differs from current evaluation dataset")
        source_manifest = args.source / "manifest.json"
        if source_manifest.exists():
            source_config = json.loads(source_manifest.read_text())
            if source_config.get("command") != "generate":
                parser.error("--source must be a generation run, not a judge run")
            if not args.cases and args.profile == "full":
                expected = set(source_config["cases"])
                cases = [c for c in cases if c["id"] in expected]
        elif not args.cases:
            parser.error("Source has no manifest; explicitly select --cases for legacy artifacts")
        source_hash = hashlib.sha256((args.source / "results.jsonl").read_bytes()).hexdigest()
    if not cases:
        parser.error("No selected cases")
    limits = {"openai": args.max_openai_usd, "anthropic": args.max_anthropic_usd}
    Budget(limits)  # Validate even for offline planning.
    from dotenv import dotenv_values
    target_model = os.environ.get("LLM_MODEL") or dotenv_values(ROOT / ".env").get("LLM_MODEL") or "claude-haiku-5-5"
    config = {"target_model": target_model if args.command == "generate" else None, "command": args.command, "cases": [c["id"] for c in cases], "limits": limits,
              "dataset_sha256": DATASET_SHA256, "source_hash": source_hash,
              "skip_invalid": args.skip_invalid, "fresh_judges": args.fresh_judges, "pricing_version": PRICING_VERSION}
    print(json.dumps(config, indent=2))
    if not args.live:
        print("Plan only. No provider calls or run files created. Add --live with an explicit provider cap to execute.")
        return 0
    provider = "openai" if args.command == "judge" else "anthropic"
    if limits[provider] <= 0:
        parser.error(f"Live {args.command} requires a positive --max-{provider}-usd")
    if args.resume and args.out:
        parser.error("Use --out or --resume, not both")
    directory = args.resume or args.out or ROOT / "logs" / "evals" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8])
    if not args.resume:
        directory.mkdir(parents=True, exist_ok=False)
    with (directory / ".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.resume:
            manifest = json.loads((directory / "manifest.json").read_text())
            if any(manifest.get(k) != v for k, v in config.items()):
                parser.error("Resume settings must match the original run")
            if manifest["provenance"]["source_sha256"] != fingerprint()["source_sha256"]:
                parser.error("Code changed: create a new run instead of mixing revisions")
        else:
            manifest = {**config, "run_id": uuid.uuid4().hex, "provenance": fingerprint()}
            (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
        print(f"Saving to {directory}", flush=True)
        return asyncio.run(execute(args, directory, manifest, cases, sources))


if __name__ == "__main__":
    raise SystemExit(main())
