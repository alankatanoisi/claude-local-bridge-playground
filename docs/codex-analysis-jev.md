Yes—I could access the page and its supporting documentation. **I think Jev is worth a small experiment in our lab, particularly for repetitive classification and routing. The “System 1” approach fits high-throughput automation better than it fits open-ended coding.**

My strongest interest is in this question: **Can a cheap, fast judgment reliably tell our software when it can proceed with a simple workflow and when it needs Claude’s deeper reasoning?** If it can, that could be useful without making the runner’s core more complicated.

This is a documentation-and-source evaluation, not a performance test: I read TypeSafe’s current documentation and inspected our local runner and Starlark host code. I haven’t made any Jev model calls.

**What Jev actually does**

A classifier takes some information and assigns it to a category. For example: “Does this test failure look like a missing dependency, a network failure, or a failed assertion?”

Jev generalizes that idea into three kinds of question:

| Question type | Plain-English meaning | Example for our experiments |
|---|---|---|
| **Choice** | Pick from options we provide. | “Which known workflow fits this request?” |
| **Score** | Evaluate against levels we define. | “How relevant is this passage to the research question?” |
| **Noul** | Estimate the probability that a statement is true. | “Does this source passage support this claim?” |

We supply the material to evaluate—the **state**—and explicit questions. It returns structured values that software can use directly. Several questions can be evaluated against the same state in one request. [TypeSafe introduction](https://docs.typesafe.ai/introduction)

That makes “System 1” a useful analogy: quick, bounded judgments. I would treat it as a description of the intended workload, rather than evidence of human-like intuition. TypeSafe explicitly says Jev does not write code, generate prose, or replace the model inside a coding agent. [Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents)

**Why this could matter for our project**

Consider an illustrative job: inspect 10,000 short records and send the relevant ones for detailed analysis.

Giving every record to a reasoning model means repeatedly paying for a capability most records may not need. A different design is:

```text
Incoming record
      │
      ▼
Ordinary code checks what can be checked exactly
      │
      ▼
Jev makes a narrow judgment
      │
      ├── Clear, routine case → predefined workflow
      │
      └── Uncertain or complex case → Claude analysis
```

The software still owns the workflow. Jev supplies one judgment inside it.

That is the part I find compelling: **high automation can come from making many small decisions well, with explicit handling of uncertainty.** It doesn’t require one model to improvise the entire process.

Here is how I would rank possible uses for us:

| Use | My assessment | Reason |
|---|---|---|
| Rank retrieved files or passages before deeper analysis | **Strong first candidate** | Narrow judgments, easy to compare against human labels, and mistakes can initially affect ordering rather than exclude evidence. |
| Classify large batches of documents or requests | **Strong fit** | Repetition and predefined categories suit this interface. |
| Route work among a small set of known workflows | **Promising** | Could save reasoning calls when the request clearly matches a routine path. Needs an “uncertain/other” outcome. |
| Check whether a worker’s claim is supported by a supplied passage | **Interesting second experiment** | Could flag suspicious claims, but it would remain a fallible checker. |
| Plan a complicated repository change or diagnose a subtle concurrency bug | **Poor fit** | Requires connecting facts and reasoning through consequences. |
| Decide whether a shell command or file write is permitted | **I would keep this in ordinary code** | Classification confidence should not grant authority. |

TypeSafe also demonstrates a related pattern: a smaller model extracts information, Jev checks individual fields, and a stronger reasoning model handles flagged cases. That is a useful experimental design, although their worked example does not establish that it will work equally well on our tasks. [Extraction cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade)

**The confidence claim needs careful interpretation**

This is the most important qualification in the documentation.

For Choice and Score, Jev’s `confidence` is calculated from how concentrated the probability distribution is. It is **not a separate, independent check that the answer is correct**. Consequently, `confidence: 0.95` should not automatically be read as “this decision has a 95% chance of being right.” [Confidence documentation](https://docs.typesafe.ai/confidence)

TypeSafe says it trains for **calibration**: across many predictions, events assigned an 80% probability should occur about 80% of the time. That is a valuable property if it holds on our workload; it is a property of groups of predictions, not a guarantee about one answer. [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer)

For our purposes, the decisive measurement would be:

> Among the cases we let proceed automatically, how many were wrong—and how much work did we avoid?

A classifier that handles 70% of cases with very few errors could be more useful than one that handles 99% while quietly making costly mistakes. We would choose the threshold from measured results, rather than copying a confidence cutoff from an example.

**The speed and cost look attractive, but there are practical limits**

The current model page lists `jev-1.13.0` at **$0.042 per million input tokens**, with free output tokens. Tokens are the small pieces into which a model divides text. At that rate, 10,000 evaluations averaging 2,000 total input tokens each would cost approximately **$0.84 for Jev**, excluding any subsequent Claude work. That is illustrative arithmetic, not a measured workload estimate.

The published limits are **1,200 requests per minute** and **250,000 tokens per second**, and TypeSafe says these limits can change. Multiple questions sharing one state can improve efficiency, but requests per minute still matter for separate records. [Current models, pricing, and limits](https://docs.typesafe.ai/models)

I would not translate the homepage’s large speedup figures into an expected runner speedup. They are vendor claims for particular workflows. If Jev only adds a classification step and we still make all the original Claude calls, we have added work. The benefit comes when it avoids expensive calls, reduces their input, or improves which work gets attention. [TypeSafe homepage](https://typesafe.ai/)

Their limitations page is refreshingly specific: Jev struggles with counting, precise numerical reasoning, date comparisons, indirect questions, and large amounts of irrelevant context. It also acknowledges that adversarial text can steer classifications, and that separately asked questions do not necessarily produce logically consistent probabilities. Those limitations argue for compact inputs and narrow questions, with arithmetic and consistency checks handled by code. [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)

**Where I would put it in our architecture**

Our current [runner model client](/Users/alanman/Developer/claude-local-bridge-playground/src/runner/model-client.js:1) speaks the Anthropic Messages format to the local bridge. Jev has a different interface, so using it would require a separate client connection.

The more natural experiment is alongside our orchestration work. The Starlark host already has a [worker registry](/Users/alanman/Developer/claude-local-bridge-playground/starlark-host/src/worker-registry.js:1) where host-controlled code selects providers and models. That provides a useful architectural starting point, although Jev’s question-and-answer contract would need deliberate integration; it is not automatically interchangeable with our existing workers.

I would begin with a small optional classification stage. Our existing [permission checks](/Users/alanman/Developer/claude-local-bridge-playground/src/runner/permissions.js:1) would continue to determine which actions are allowed.

**My suggested first experiment is relevance ranking in shadow mode**—meaning Jev records what it would recommend while the existing workflow continues normally.

Use a few hundred representative question/passage pairs, including ambiguous and misleading examples. Compare Jev with simple keyword rules and a lightweight model baseline. Measure:

- How often relevant material gets ranked too low.
- How often confident answers are wrong.
- How much work could be handled automatically at each threshold.
- Actual total cost and response time, including retries and fallback analysis.

Only after that would I let it affect ordering; excluding material altogether would need stronger evidence.

**My verdict: the architecture is highly relevant to our research, and Jev is a plausible tool for testing it.** The interesting opportunity is a runner that uses ordinary code for exact checks, a fast decision model for repeated judgments, and deeper reasoning where it earns its cost. I would prioritize that experiment over trying to make Jev the runner’s general thinking engine.

For the record: I inspected `/Users/alanman/Developer/claude-local-bridge-playground` on `main`; the working tree was clean and the remote matched the intended playground. No files changed. I checked live documentation and local source; I did not pull, run the test suite, or benchmark Jev because this was a read-only evaluation. The main unresolved question is its measured accuracy and confidence behavior on our own tasks.

