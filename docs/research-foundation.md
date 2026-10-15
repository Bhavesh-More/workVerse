# WorkVerse AI — Research Foundation and Decision Log

**Research cutoff:** 2026-10-10  
**Purpose:** Explain what informed the product and engineering recommendations, distinguish evidence from inference, and flag claims that require local validation. This is a practical research memo, not a systematic review or a claim that WorkVerse AI is educationally validated.

## 1. Executive synthesis

WorkVerse AI combines five ideas: simulation-based learning, generative characters, personalized scenario generation, evidence-grounded performance assessment, and a navigable 2D interface. Each idea has relevant prior work, but the exact combination—profile-personalized software-workplace scenarios inside a 2D office with auditable AI evaluation—should be treated as a product hypothesis to test, not a scientifically established intervention.

Recommended initial design:

1. Use one compact 2D workplace and one end-to-end scenario before expanding the world.
2. Use validated scenario families with constrained variation rather than fully unconstrained one-shot generation.
3. Use a deterministic, backend-owned state machine and event log, while using an LLM for language understanding, character dialogue, and rubric interpretation.
4. Use explicit, pre-authored scoring anchors. Treat LLM scores as formative feedback until calibration against human raters demonstrates acceptable agreement.
5. Save message IDs, event IDs, task outputs, scenario/rubric versions, and evaluator version so reports can be traced and reproduced.
6. Test whether the 2D environment materially improves task orientation, engagement, or transfer compared with direct room navigation/chat. Do not assume immersion automatically improves learning.
7. Keep user files private and treat the text extracted from them as untrusted data, not as model instructions.

## 2. Research Area A — Simulation-based learning

### What the research supports

Chernikova et al. (2020) conducted a meta-analysis of 145 empirical studies on simulation-based learning in higher education and reported a large positive overall effect on complex-skill learning (Hedges' g = 0.85, standard error 0.08, confidence interval 0.69–1.02). The authors also reported that technology and scaffolding mattered, and that learners with different prior knowledge may benefit from different support. This is useful evidence for the broad strategy of guided practice in complex situations. It is not an effect-size forecast for WorkVerse: included domains, interventions, and outcome measures differ from AI-generated software workplace simulations.

Source: Olga Chernikova et al., “Simulation-Based Learning in Higher Education: A Meta-Analysis,” *Review of Educational Research* 90(4), 2020. DOI: https://doi.org/10.3102/0034654320933544

UNESCO's guidance on generative AI in education emphasizes a human-centred approach, data privacy, age appropriateness, and pedagogical validation. That supports treating the AI as a practice facilitator rather than an unquestioned authority, and communicating the limits of automated scores.

Source: Fengchun Miao and Wayne Holmes, UNESCO, “Guidance for Generative AI in Education and Research,” 2023, updated web page 2026: https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research

### Implication

Use the loop **brief -> independent attempt -> consequence -> debrief -> reflection -> new attempt**. Do not show the preferred solution before the learner acts unless the selected learning mode explicitly enables coaching. At the debrief, ask the learner to reflect on a key decision before revealing a suggested alternative. During future attempts, vary scenario particulars while preserving the competency objective.

### Still unknown

Research on simulation-based learning does not establish that a Phaser-based map itself improves workplace competence. Evaluate whether movement and rooms help learners discover information or simply add time and cognitive load. Also measure transfer to a new scenario, not only improved scores on the exact scenario already practised.

## 3. Research Area B — Generative agents and shared state

### What the research supports

Park et al. (2023) introduced *Generative Agents: Interactive Simulacra of Human Behavior*. Their architecture gives agents a memory stream, retrieval, reflection, and planning, and demonstrated believable individual and emergent social behavior in a sandbox environment. It offers useful patterns for role-specific memory and character continuity. The authors' environment and evaluation are not a direct validation of workplace competencies; realistic-looking behavior is not equivalent to reliable task execution or fair assessment.

Source: Joon Sung Park et al., “Generative Agents: Interactive Simulacra of Human Behavior,” 2023. https://arxiv.org/abs/2304.03442

### Engineering inference for WorkVerse

The product needs strict correctness for objectives, actions, state transitions, access permissions, and evidence IDs. Those should be deterministic. Character tone, follow-up questions, and explanations benefit from an LLM. A hybrid design is therefore a better risk match than either a rigid dialogue tree or unconstrained agents.

For an MVP, use a single turn orchestrator and a shared state object. At each turn, select the character from the location/objective/event, construct a prompt using only that character's permitted knowledge, and ask the model for a response plus an optional structured proposal. Validate proposals against an allowlist and preconditions. Only then commit events. The “manager,” “client,” and “teammate” can be separate character configurations without requiring separate autonomous agents running in parallel.

### Why not start with a fully autonomous multi-agent team?

It increases token usage, latency, error surfaces, coordination work, and test complexity. It can introduce invisible off-screen conversations and inconsistent facts. Multi-agent planning may later help with scenario design or evaluator cross-checking, but it should be justified by a concrete failing test or feature rather than chosen for novelty.

## 4. Research Area C — Scenario generation and validity

### Supported principle

Generative models increase the range of scenarios that can be drafted, but generation does not guarantee correctness, fairness, solvability, or assessment equivalence. These properties need explicit constraints and evaluation. The exact success rate of any validator cannot be claimed before testing it on WorkVerse examples.

### Recommended pipeline

- Choose an authored, versioned family tied to one or more competencies.
- Generate only constrained parameters and narrative details.
- Validate schema, unique IDs, references, rubric alignment, valid actions, and required facts.
- Validate graph reachability: at least one allowed action sequence must reach a valid terminal outcome, and required evidence must be discoverable.
- Test a small set of expected, weak, and adversarial user paths.
- Record a seed, blueprint version, model ID, validator version, and validation results.
- Escalate novel or failed variants to human review; do not publish them automatically.

An LLM asked to “check” its own generation is one useful critique layer, but not a proof. Rule checks, property tests, scripted path tests, and domain review provide different forms of assurance. A simulated ideal agent solving a scenario is evidence of possible solvability, not evidence that all users will find it fair or understandable.

### Comparability

If the same rubric is used across variants, vary details that preserve the underlying decision requirements. Record difficulty parameters such as number of stakeholders, information ambiguity, dependency count, time pressure, and risk severity. Use paired tests and expert ratings to check whether one variation is systematically easier. Do not compare total scores from different rubric versions without calibration.

## 5. Research Area D — LLM-as-a-judge and fairness

LLM-based judges are useful for semantic interpretation, but they can show position, style, prompt, and model-specific biases. Shi et al. (2024) studied position bias in LLM-as-a-judge systems and showed that judge preferences can vary systematically with presentation order. Subsequent research continues to explore broader judge reliability and style sensitivity. These papers do not quantify WorkVerse's own bias; they motivate a local audit suite.

Source: Lin Shi et al., “Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge,” 2024. https://arxiv.org/abs/2406.07791

A 2026 preprint, “Judging the Judges: A Systematic Evaluation of Bias Mitigation Strategies in LLM-as-a-Judge Pipelines,” reports style bias across tested model families and benchmarks. As a recent preprint, it should be treated as emerging evidence, not universal settled fact. It reinforces testing equivalent answers expressed concisely, formally, colloquially, or with wording changes.

Source: https://arxiv.org/abs/2604.23178

### Recommended evaluation controls

- Define each criterion in observable terms and anchor every score level with behaviors.
- Score content and communication style separately when both matter.
- Score objective outputs deterministically where possible.
- Ask the LLM to cite only known evidence IDs and include counterevidence or “insufficient evidence.”
- Programmatically verify IDs, session ownership, and quote text.
- Use exact stored quotes and do not let the evaluator manufacture evidence.
- Compare judge outputs with independent human ratings on a deliberately varied sample.
- Run counterfactual paraphrase tests to identify style sensitivity.
- Log model/version/rubric version and periodically re-run a fixed regression set after prompt/model changes.
- Present feedback as formative practice, not employment selection or a validated measure of employability.

Source on structured model output: OpenAI, “Structured Outputs,” https://developers.openai.com/api/docs/guides/structured-outputs. Schema-constrained outputs reduce format errors, but they do not validate whether a score is substantively correct.

## 6. Research Area E — Technical platform decisions

### Next.js and Phaser

Next.js App Router supports composition of Server Components and Client Components. Browser-specific features such as event handlers, `window`, audio, and Phaser belong in Client Components; if a library requires browser globals during module initialization, load it only on the client. Next.js documents that `NEXT_PUBLIC_*` values are inlined into the browser bundle, so do not store server secrets in those variables.

Sources:
- Next.js, “Server and Client Components”: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js, “Single-Page Applications” / browser-only component guidance: https://nextjs.org/docs/app/guides/single-page-applications

Phaser has a scene system and tilemap APIs suitable for splitting the office into scenes or rooms and importing maps created with tools such as Tiled. This supports the selected architecture; it does not require a room per scene. Start with one office scene and functionally meaningful hotspots unless room-loading needs become real.

Sources:
- Phaser, “Scenes”: https://docs.phaser.io/phaser/concepts/scenes
- Phaser 3.88.2 Tilemap API: https://docs.phaser.io/api-documentation/3.88.2/class/tilemaps-tile

### Supabase / PostgreSQL security

Supabase recommends enabling RLS on exposed tables and having explicit policies for each operation. The `auth.uid()` helper is useful when the request carries a Supabase-authenticated user context. Supabase also warns that service-role/secret keys bypass RLS and must never be exposed in frontend code. A direct Postgres connection from FastAPI has a separate authorization boundary: do not assume RLS magically protects code paths executed through a privileged database role. Test the actual production connection role and always enforce session/document ownership in the API service layer.

Sources:
- Supabase, “Row Level Security”: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase, “Securing your data”: https://supabase.com/docs/guides/database/secure-data
- Supabase, “JSON Web Tokens”: https://supabase.com/docs/guides/auth/jwts

### FastAPI streaming

FastAPI supports custom streaming responses. For text roleplay, a POST request consumed with `fetch` and an SSE-formatted response is a practical MVP choice when streaming a response to one user turn. A native `EventSource` client is GET-oriented; don't assume it can post the user's message. Use WebSockets when the product needs true bidirectional audio/interruptions or synchronized multi-user state—not just because the world is interactive.

Source: FastAPI, “Custom Response — HTML, Stream, File, others”: https://fastapi.tiangolo.com/advanced/custom-response/

### Structured generation / orchestration

Use Pydantic models and, when the chosen model API supports it, JSON-schema-constrained outputs for blueprint proposals, candidate action proposals, and evaluation reports. Domain validators must still check whether references exist and actions are legal.

Source: OpenAI, “Structured Outputs”: https://developers.openai.com/api/docs/guides/structured-outputs

LangGraph persistence provides checkpointing for durable graph execution and memory stores for longer-lived information. That is useful if WorkVerse develops complex interruption/resume workflows. For a first one-scenario MVP, a small explicit Python state machine plus Postgres is easier to inspect and test. Adopt LangGraph if a spike demonstrates simpler checkpoint/resume or branching behavior than the custom service.

Source: LangGraph, “Persistence”: https://langchain-ai.github.io/langgraph/concepts/durable_execution/

## 7. Storage decision: MinIO requires an explicit review

The current `minio/minio` GitHub repository states that the repository is no longer maintained, that the community edition is source-only, and that MinIO server is distributed under AGPLv3; its compliance notes explicitly advise users to validate licensing obligations. This changes the usual assumption that local MinIO is a simple maintained, prebuilt Docker image choice. Do not copy an old `minio/minio:latest` example without review.

Sources:
- MinIO repository: https://github.com/minio/minio
- MinIO compliance notes: https://github.com/minio/minio/blob/master/COMPLIANCE.md
- MinIO releases: https://github.com/minio/minio/releases

### Product response

Preserve an S3-compatible adapter interface and use private object storage. Use MinIO only with a reviewed/pinned distribution and a clear license decision. The included Docker Compose example deliberately requires `MINIO_IMAGE` to be configured; it does not silently select an unpinned floating image. If building the community source yourself, pin the source commit/tag and retain the build steps. Before any public/commercial deployment, review AGPL obligations with someone qualified to do so and evaluate maintained/managed alternatives. This is a practical risk flag, not legal advice.

## 8. AI risk and data governance

NIST's Generative AI Profile recommends considering risks across the AI lifecycle, including risks unique to generative systems. For WorkVerse, the most relevant practical controls are input provenance, untrusted-file boundaries, model-output validation, traceability, evaluator calibration, privacy/retention controls, incident handling, and transparency about limitations.

Source: NIST, *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile*, NIST AI 600-1, 2024: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf

Apply a simple threat model:
- **Prompt injection in documents:** mark extracted content as quoted source material, not instructions; use extraction schemas and minimize context.
- **Cross-user leakage:** verify ownership before loading transcripts/files; never let user-controlled IDs stand in for authorization.
- **Hallucinated scenario facts:** blueprint validator requires evidence sources for objectives and character knowledge.
- **Fabricated evaluation quotes:** validate stable message/event IDs and quote substrings programmatically.
- **Overconfident scores:** include insufficient evidence and report limitations; calibrate against human judgment.
- **Sensitive data overcollection:** collect only profile fields needed for personalization, support deletion, and do not keep raw audio by default.

## 9. Proposed research/validation programme

These are initial experiments for a student prototype, not claims that the product has already passed them.

| Experiment | Question | Method | Decision informed |
|---|---|---|---|
| Spatial vs direct navigation | Does the 2D workplace help or slow the task? | Have a small pilot use the same scenario in (A) spatial interface and (B) direct room/action navigation; measure task success, time, errors, perceived usability and cognitive load. | Keep, simplify, or reduce movement requirements. |
| Scenario validity | How often do generated variants contain defects? | Generate a bounded batch; run schema, reachability, rubric, and scripted-path checks; human-review a sample and every failed validator case. | Adjust constraints and human-review policy. |
| Character consistency | Do characters preserve knowledge boundaries? | Regression prompts across multi-character paths; test questions about private facts before/after authorized disclosure. | Change prompt builder/knowledge model. |
| Evaluation traceability | Are reports fully supported? | Run crafted sessions with known decisions; assert every quote ID exists and each criterion has evidence or insufficient status. | Block release if validator bypasses. |
| Human agreement | Does the LLM evaluator agree with trained reviewers? | Two independent human reviewers score a sample using the same rubric; compare AI/human scores, criterion-level agreement, and disagreement examples. | Calibrate rubric/model; do not claim validity until results support it. |
| Style invariance | Is the same reasoning scored differently due to phrasing? | Paraphrase a fixed set of good/weak answers across concise/formal/colloquial forms; measure score spread. | Improve anchors and evaluator prompts. |
| Learning transfer | Does feedback improve a different scenario? | Baseline on scenario A, feedback/practice, then unseen parallel scenario B; compare rubric performance and have raters blinded to condition if possible. | Decide whether to invest in progress/adaptive sequence. |
| Storage threat tests | Can one user access another's files? | Attempt cross-user presigned-url creation, object-key substitution, expired URLs and oversized uploads. | Fix before enabling uploads. |

A small pilot can uncover severe usability and security defects, but it will not prove general learning effectiveness or employment prediction. For credible learning claims, predefine hypotheses and measures, recruit an appropriate participant sample, and report sample size, limitations, and confounders.

## 10. Source quality and claims ledger

| Source | Type | What it supports | Limitations |
|---|---|---|---|
| Chernikova et al. (2020), DOI above | Peer-reviewed meta-analysis | Broad evidence for simulation-based learning and scaffolding in higher education | Not specific to AI workplace roleplay or Phaser. |
| Park et al. (2023), arXiv:2304.03442 | Peer-reviewed HCI conference paper / arXiv paper | Memory/retrieval/planning architecture for believable generative agents | Small-town sandbox behavior is not equivalent to workplace-assessment validity. |
| Shi et al. (2024), arXiv:2406.07791 | Preprint | Position bias can affect LLM-as-judge comparisons | Benchmarks differ from open-ended competency scoring. |
| “Judging the Judges…” (2026), arXiv:2604.23178 | Recent preprint | Emerging evidence and methods around style bias in LLM judging | Needs replication; do not universalize its quantified result. |
| UNESCO (2023, page updated 2026) | Intergovernmental guidance | Human-centred educational GenAI, privacy and validation principles | Guidance, not a controlled effectiveness study. |
| NIST AI RMF / GenAI Profile (2024) | Government risk framework | Lifecycle risk governance for generative AI | A framework, not a product-specific certification. |
| Next.js, Phaser, FastAPI, Supabase docs | Official technical documentation | Framework capabilities and documented security/implementation behavior | Documentation establishes APIs, not that the resulting product is correct. |
| MinIO GitHub repository and compliance notes | Project-maintainer statements | Current project maintenance/distribution/licensing caution | Re-check at implementation/deployment time; license interpretation needs qualified review. |

## 11. Research conclusions

The best supported engineering approach is a hybrid: versioned scenario blueprints, deterministic state/actions, role-conditioned generated dialogue, strict evidence persistence, and rubric-bound evaluation. The largest uncertainty is not whether a 2D canvas and LLM can be connected; it is whether generated scenarios are consistently valid, whether reports reliably assess the intended competencies, and whether the spatial interaction adds learning value over a simpler UI. Build instrumentation and small experiments early so those questions can be answered with evidence rather than assumptions.
