"""Gold is for evaluation only: never inject it into application retrieval/prompts."""
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
AI_PATH = ROOT / "lineage_reference.json"
MATH_PATH = ROOT / "ragas_math/cases.json"
MANIFEST = Path(__file__).with_name("cases.json")
AI = json.loads(AI_PATH.read_text())
MATH = json.loads(MATH_PATH.read_text())
TOPICS = {}
for name, topic in AI["topics"].items():
    papers = {p["openalexId"]: p for p in AI["papers"]}
    TOPICS[name] = dict(topic, id=name, papers=[papers[i] for i in
                        [topic["seed"], *topic["ancestors"], topic["distractor"]]],
                        evidence=topic["facts"], reference="Explain the distinct contributions and transitions: "
                        + " ".join(topic["facts"]))
for topic in MATH["topics"]:
    TOPICS[topic["id"]] = topic

# Three atomic, independently sourced facts per topic. Keep a fixed denominator:
# ContextRecall is called once per fact, so the judge cannot silently omit a fact.
FACTS = {
    "transformer": ["The Transformer uses attention without recurrent layers.",
                    "Sequence to Sequence Learning with Neural Networks uses an LSTM encoder-decoder.",
                    "Neural Machine Translation by Jointly Learning to Align and Translate learns soft alignment."],
    "rag": ["RAG combines a dense retriever and a sequence generator.",
            "Dense Passage Retrieval uses a dual encoder for passage retrieval.",
            "BART is pretrained by reconstructing corrupted text."],
    "resnet": ["ResNet uses residual functions with identity shortcuts.",
               "VGG uses small 3 by 3 convolution filters.",
               "Highway Networks uses learned gates to control information flow."],
    "fista": ["FISTA has an O(1/k^2) convex objective-error bound.",
              "Nesterov's 1983 method accelerates smooth convex optimization.",
              "An Iterative Thresholding Algorithm for Linear Inverse Problems with a Sparsity Constraint uses iterative thresholding for sparse inverse problems."],
    "admm": ["The distributed optimization ADMM paper reviews earlier ADMM methods.",
             "Gabay and Mercier developed an early alternating-direction multiplier method.",
             "Eckstein and Bertsekas relate Douglas-Rachford splitting to proximal point methods."],
    "compressed_sensing": ["Robust Uncertainty Principles recovers sufficiently sparse signals from random incomplete Fourier samples using l1 minimization.",
                           "Atomic Decomposition by Basis Pursuit uses l1 minimization for sparse decompositions.",
                           "Uncertainty Principles and Ideal Atomic Decomposition connects uncertainty principles with sparse atomic decomposition."],
}
CASES = json.loads(MANIFEST.read_text())["cases"]
WORKFLOWS = ("standard", "deep", "clarify", "selected_seed", "expand")
assert len(CASES) == len({c['id'] for c in CASES}) == 30
assert {(c['topic'], c['workflow']) for c in CASES} == {
    (t, w) for t in TOPICS for w in WORKFLOWS}
DATASET_SHA256 = hashlib.sha256(b"".join(p.read_bytes() for p in
    (AI_PATH, MATH_PATH, MANIFEST, Path(__file__)))).hexdigest()


def normalize_title(value):
    value = unicodedata.normalize("NFKD", value).casefold()
    return re.sub(r"[^a-z0-9]", "", value)


def paper(topic, alias):
    return next(p for p in topic["papers"] if p["openalexId"] == alias)


def matches(actual, expected):
    """Exact normalized titles; punctuation/year differences don't lower recall."""
    return normalize_title(actual.get("title", "")) in {
        normalize_title(t) for t in [expected["title"], *expected.get("title_aliases", [])]}


def gold_contexts(topic):
    return [f"{p['title']} ({p['year']}): {p['abstract']} Source: {p['source']} "
            f"{p.get('source_locator', '')}" for p in topic["papers"]] + topic["evidence"]
