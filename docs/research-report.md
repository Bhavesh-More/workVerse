# WorkVerse AI — Deep Research Report and Design Guidelines

**Research date:** 10 October 2026  
**Purpose:** Convert the supplied project vision and preliminary research notes into validated implementation guidance.  
**Method note:** This is a targeted evidence review using research publications, government/intergovernmental guidance, and official technical documentation. It is not a registered systematic review. Claims about WorkVerse-specific performance, educational effectiveness, fairness, latency, and costs remain hypotheses until measured in this product.

## Executive summary

WorkVerse AI is technically feasible as a student-built prototype if scope is controlled. Its value proposition comes from connecting a navigable workplace, adaptive AI character interaction, real task/event consequences, and a transparent post-simulation debrief. It should not attempt to reproduce an entire company at first.

The best-supported initial design is a **hybrid simulation**:

- Curated scenario families define the competencies, facts, available actions, objective dependencies and scoring rubric.
- An LLM drafts bounded variants and generates character dialogue.
- FastAPI applies deterministic preconditions and state transitions, persists events and snapshots, and filters what each character knows.
- PostgreSQL records scenario/session versions, messages, events, deliverables and evaluation evidence.
- A report evaluator interprets evidence against an explicit rubric; code verifies every referenced evidence ID and quotation before the report is published.
- Phaser represents the workplace but is not authoritative for task completion or evaluation.

Three uncertainties are most important. First, generated variants may be coherent yet differ in difficulty or scorable evidence. Second, LLM evaluators may make inconsistent or style-sensitive judgments. Third, a 2D spatial world may improve realism and motivation but can also add navigation friction. The project should instrument and experiment on these instead of assuming they are solved.

**MVP recommendation:** one compact office; one production-incident scenario family; a manager, teammate and client as role configurations; text interaction; three meaningful places/objects; persistent state/events; deterministic consequence rules; and a report with verified evidence. Add client discovery and code review next. Voice, fully autonomous agent swarms, vector search, multiplayer, and employer-facing candidate scores are later or out of scope until evidence supports them.

---

# Part 1 — Adaptive AI Workplace Simulation Architecture

## 1.1 Existing approaches to interactive simulation

| Approach | How it works | Strengths | Failure mode / cost | Fit for WorkVerse |
|---|---|---|---|---|
| Fixed branching dialogue | Prewritten nodes and edges | Predictable, cheap, easy to test and assess | Repetitive; can fail when user deviates from expected choices | Use for authored story beats, fallback and validation paths—not as the entire experience |
| Prompt-only roleplay | LLM receives persona and latest message | Fast to prototype; natural language variety | No durable authoritative state; invented facts; character drift; weak replay/audit | Demo stub only; insufficient as final architecture |
| Conversation history agent | LLM receives recent/full transcript | Better continuity than prompt-only | Context growth, cost, stale/irrelevant context, no guarantees about facts | Useful component within the selected architecture |
| Memory-augmented generative agent | Records experiences, retrieves memories, reflects/plans | Can produce believable behavior in open worlds | More expensive and complex; believable behavior isn't the same as correct task outcomes | Add only if long-running character continuity requires it |
| FSM/behavior tree/rule engine | Explicit states, guarded transitions, action preconditions | Deterministic, testable, explainable; easy to enforce critical invariants | Authoring effort; can feel rigid if every dialogue line is fixed | Use for authoritative state/actions and scenario terminal conditions |
| LLM planning/action selection | Model chooses a tool/action given context | Flexible; adapts to unanticipated phrasing | Invalid tools/actions, inconsistent plans, attack surface from untrusted input | Allow only constrained proposals, never direct state mutation |
| Hybrid deterministic + LLM | Rules own state and validity; model handles language and selected interpretation | Good balance of coherence, adaptability, traceability and testability | Requires clear contract between probabilistic and deterministic layers | **Recommended** |
| Multi-agent autonomous loop | Several agents plan/converse/act independently | Can model distributed perspectives and emergent behavior | More latency/tokens, coordination loops, hidden side conversations, inconsistent state | Not necessary for the first release; start with one orchestrator and role-specific prompts |

GENEVA demonstrates the use of LLMs to generate and visualize branching narrative graphs under constraints; it is relevant as a narrative-authoring precedent, not evidence that generated workplace assessments will be valid. Park et al.'s *Generative Agents* explores memory, retrieval, reflection and planning for believable social behavior; that work inspires character memory but does not prove reliability in high-consequence task simulations.

Sources: Leandro et al., “GENEVA: GENErating and Visualizing branching narratives using LLMs,” IEEE Conference on Games, 2024, https://www.microsoft.com/en-us/research/publication/geneva-generating-and-visualizing-branching-narratives-using-llms/ ; Park et al., 2023, https://arxiv.org/abs/2304.03442 .

## 1.2 Shared world state and consistency

A coherent scenario needs one authoritative state, not three independent character histories. Represent at least:

- session lifecycle and version;
- active objective and completed/pending objectives;
- available locations, objects, actions and action preconditions;
- known and hidden facts with disclosure paths;
- tasks, deliverables, dependencies and deadlines;
- incident/project status and risk flags;
- per-character knowledge, commitments and permitted communications;
- event history and evidence IDs;
- immutable scenario/rubric version references.

Use relational columns for ownership, status, timestamps, version references and foreign keys; use versioned JSONB for a flexible blueprint and current state snapshot; use append-only events for replay and audit. Updating state and appending its corresponding event should occur in one DB transaction. This is **event log + snapshot**, not full event sourcing: complete command replay should only be implemented if a clear requirement emerges.

State transitions need explicit guards. Example: `propose_rollback` does not set `incident.status=resolved`; the engine checks whether the migration compatibility prerequisite has been inspected, whether the rollback action is legal for the current state, and what event/result should follow. The LLM can explain the result but cannot bypass the precondition.

Protect against stale or duplicate writes with a `state_version`, short row-lock/optimistic update, and idempotency key (`client_turn_id`). Never hold a DB transaction open across a model API call. A page refresh must reconstruct the world from the persisted snapshot and events.

## 1.3 Multi-character coordination and memory

Use a role configuration for manager, teammate and client, containing stable identity, goals/incentives, tone guidance, allowed facts, disclosure conditions, and relevant commitments. The shared engine owns the source of truth; each character receives only a scoped view. Knowledge should move through explicit communication/disclosure events, not by implicitly sharing the whole transcript.

MVP pattern:
1. The session engine determines the relevant/active character using location, objective and events.
2. Prompt assembly retrieves that character's allowed knowledge, recent relevant messages, commitments and a compressed state summary.
3. One LLM call generates dialogue and optionally proposes a structured action/event.
4. The backend validates the proposal and commits allowed state/events.
5. Any other character's knowledge changes only if a valid information-sharing event says it should.

This simulates different perspectives without running several autonomous agents in every turn. Add direct agent-to-agent conversations only when a tested scenario requires them; all such communication must still be centrally logged and authorized.

## 1.4 Adaptive behavior and consequence modeling

The system should adapt along three distinct axes:
- **Dialogue adaptation:** follow-up questions and character tone reflect what the student actually said.
- **World adaptation:** new facts or events become available only if defined triggers or validated action results allow them.
- **Pedagogical adaptation:** hints and future scenario difficulty can adjust based on observed evidence, preferably between scenarios for the MVP.

Do not conflate these into an unbounded “AI decides everything” prompt. A candidate action protocol should identify `action_type`, target IDs, arguments and short rationale; Pydantic checks shape; the scenario rule engine checks allowlist, identity, state and preconditions; only accepted actions create events. If an action is invalid, no state change is committed.

Preserve freedom by allowing several valid strategies to reach a terminal state. Use rules for critical facts/risks and LLM narration for natural delivery. Consequences should be plausible, proportional and recoverable where pedagogically appropriate. Do not create arbitrary failure just to make the scenario dramatic.

## 1.5 Memory and long-running sessions

Start with structured session state, a short recent conversation window, and event-derived summaries. Each memory item should retain source/event ID and whether it is a verified scenario fact, character statement, or inference. Summaries must not erase commitments or risks. Use retrieval/embeddings only if regression tests demonstrate that relevant context cannot be found reliably through structured fields and SQL filters.

Store prompt version and model identifier. Exact model outputs may not be reproducible across provider updates, but immutable scenarios, persisted messages, state versions, action events, and evaluation versions make past sessions auditable.

## 1.6 Reliability, latency and failure recovery

Use explicit timeouts, bounded retries and provider error mapping. Idempotency is mandatory for state-changing turn/action endpoints. A provider timeout must not imply task completion. Partial text chunks are provisional; an assistant message and world-event frame become durable only after validated database commit. On disconnect, the client fetches current session state/transcript and queries or retries the same turn ID.

Measure non-LLM API latency and model time-to-first-token/full-turn separately. Avoid arbitrary claims that every character should respond under a fixed human-conversation threshold independent of provider/model/network. Use streamed text/pending indicators and design the prompt/response budget around an observed benchmark.

## 1.7 Architecture recommendation

The recommended system diagram and detailed boundaries are in `architecture.md`. The critical division is:
- **Deterministic:** auth/ownership, schema validation, action permissions, objective/state transitions, event sequencing, database commits, exact quote validation, known task outcomes.
- **Generative/semantic:** natural dialogue, understanding free-text intent, draft scenario details, candidate evidence interpretation and coaching language.
- **Validated bridge:** Pydantic / JSON Schema output + domain rules + provenance checks.

LangGraph can be valuable for durable graph execution, checkpoints and human-in-the-loop flows, but a small explicit state machine is easier for the first scenario. Adopt a graph framework only when a prototype spike shows simpler durability or branching than the custom state machine.

---

# Part 2 — Evidence-Based AI Assessment and Evaluation

## 2.1 What should be assessed?

Assessment criteria should be job-relevant and observable. For a junior software role, plausible competencies include diagnosis/information gathering, technical reasoning, risk management, requirements clarification, stakeholder communication, collaboration, ownership, adaptation to new evidence, prioritization, and task completion.

Dialogue alone cannot establish every competency. For example, saying “I would test rollback” is not equivalent to actually inspecting compatibility evidence or validating a recovery signal. Use messages for reasoning/communication evidence, action events for process evidence, and actual task output for correctness where possible.

Situational judgement tests (SJTs) provide related evidence: Webster et al.'s 2020 systematic review/meta-analysis of medical selection reported a pooled validity correlation of 0.32, with substantial heterogeneity (`I²=96.5%`) across studies. That literature suggests job-situation assessments may provide useful signals but also shows that validity is context-dependent. It does not validate WorkVerse or justify using its scores for hiring.

Source: Webster, Paton, Crampton & Tiffin, “Situational judgement test validity for selection: A systematic review and meta-analysis,” *Medical Education*, 2020, DOI https://doi.org/10.1111/medu.14201 .

## 2.2 Rubric design

Each rubric should include:
- criterion definition and the competency it represents;
- behavioral indicators for each level (not just adjectives such as “good”);
- critical errors and their conditions;
- evidence sources (message/action/deliverable);
- an explicit `insufficient_evidence` state;
- aggregation rule and fixed weights, if an overall score is used;
- scenario/rubric version and review date.

A useful production-incident rubric is specified in `docs/validation-matrix.md`. The initial `0–4` anchors are a proposal, not an empirically validated scale; calibrate them with domain reviewers and examples before presenting scores as reliable.

## 2.3 Evidence traceability

The evaluator should never invent IDs. Provide a bounded evidence list of persisted message/event/deliverable IDs and ask it to choose references. Backend validation then checks:
- source ID exists and belongs to the target session;
- quote matches source text exactly (or documented whitespace normalization only);
- criterion had an observable opportunity;
- the report includes explanation/recommendation;
- score and status comply with schema;
- cited evidence supports the criterion sufficiently, including counterevidence when important.

A matching quote is necessary but not sufficient: an evaluator can quote a real line and draw an unjustified conclusion. Use score anchors, counterexamples, deterministic task facts, human review, and regression tests to assess the interpretation.

## 2.4 LLM-as-a-judge versus alternatives

| Method | Use for | Main risk | WorkVerse recommendation |
|---|---|---|---|
| Deterministic checks | Completed actions, valid transitions, tests passed, required facts inspected | Can't judge nuanced communication by itself | Use whenever expected outcome is explicitly machine-verifiable |
| Single LLM with anchored rubric | Explain reasoning, assess nuanced dialogue, produce coaching | Inconsistent/style-sensitive score | MVP, paired with evidence validation and calibration |
| Multiple independent LLM judges | Spot-check high ambiguity / disagreement | Cost, correlated biases, false belief that consensus guarantees truth | Later experiment, not default |
| Human experts | Rubric development, calibration, edge cases, sampled review | Time and inter-rater variation | Essential for initial rubric review and validity study |
| Hybrid | Combine task facts, rubric model, and targeted human review | Requires process and traceability | Recommended |

Research on LLM-as-a-judge identifies systematic bias such as presentation-order sensitivity. Shi et al. studied position bias (2024); emerging work also investigates style sensitivity. These findings justify a local test set with equivalent answers expressed in different styles. Don't assume a second LLM or agent debate automatically increases reliability; evaluate agreement against human-rated cases.

Sources: Shi et al., 2024, https://arxiv.org/abs/2406.07791 ; recent preprint on judge bias mitigation, https://arxiv.org/abs/2604.23178 .

## 2.5 Reliability, validity and calibration

Reliability (consistency) and validity (whether the score measures the intended competence) are different. Test both:
- **Human agreement:** independent human reviewers score the same sessions with the same rubric; analyze criterion-level agreement and disagreement types.
- **Test-retest / paraphrase stability:** repeat evaluation on the same transcript and on semantically equivalent rephrases; inspect unexplained score drift.
- **Construct validity:** ensure criteria match observable task behaviors and separate unrelated attributes.
- **Criterion/transfer validity:** compare with performance on a new scenario or an expert-observed work sample; do not assume that a high simulator score transfers to work.
- **Calibration:** expose uncertainty/insufficient evidence and compare model confidence (if used) with observed correctness; do not invent calibration values.
- **Variant equivalence:** compare variants under controlled solution paths and human ratings before comparing score trends across them.

A small prototype can run a pilot calibration study, not a definitive professional assessment validation. Report sample sizes and limitations.

## 2.6 Fairness and language

Do not use verbosity, polished business language, jargon, accent or speed as proxies for technical skill. Separate communication competence from diagnosis/technical reasoning. Voice transcripts must be reviewable/correctable; ASR errors are system errors, not learner errors. If spoken delivery quality is eventually assessed, specify it as a separate criterion, tell users in advance, and validate it independently.

Recommended counterfactual audit: build pairs with same underlying decision but different phrasing (concise, detailed, formal, colloquial). Run the evaluator with identical context and compare criterion score differences. Investigate differences that cannot be explained by changed information. Avoid demographic inference and unnecessary collection of sensitive identity data.

## 2.7 Feedback design

Good debriefs answer:
1. What did the learner do? (evidence)
2. Why did it matter? (criterion/risk)
3. What else was observed? (counterevidence or limitation)
4. What should they try next time? (concrete alternative)
5. What practice is recommended now? (next scenario or focused exercise)

Do not expose the ideal answer before the student gets to act in an independent mode. In a coaching mode, optional hints may appear earlier but must be logged so evaluators and progress views can account for them.

## 2.8 Recommended evaluator pipeline

Freeze session and rubric -> gather candidate messages/events/deliverables -> deterministic outcome checks -> model criterion scoring on a bounded evidence set -> Pydantic validation -> source ownership and quote validation -> completeness/contradiction checks -> human-review flag if needed -> persist versioned report -> render evidence links.

Do not use hidden chain-of-thought as a product requirement. Ask for short, inspectable rationales anchored to the rubric/evidence, not private reasoning traces.

---

# Part 3 — Personalized Scenario Generation

## 3.1 Profile personalization without unsupported inference

Profile fields should inform **relevance**, not declare ability. Use target role, preferred stack, education/experience context, career goals and user-chosen skill focus. Track each fact's provenance (self-reported, extracted, user-confirmed, demonstrated by task). A user mentioning React does not prove React expertise; an LLM extracting “expert” from a resume does not verify it.

A good profile flow lets users edit extracted facts before use. Personalization should be explainable: “This scenario was selected because you chose junior backend roles and requested production-debugging practice,” not “the AI knows your weakness.”

## 3.2 Document ingestion and prompt-injection defense

Pipeline: authorized upload intent -> private object storage -> type/size/checksum verification -> parser -> structured extraction with source spans -> user confirmation -> selected facts copied into a minimal scenario context. Preserve object ID and extraction version. Don't place the full raw file into every character prompt.

Treat document content as untrusted. Uploaded resumes, job descriptions, source-code comments and READMEs may contain instructions that attempt to override model behavior. Wrap extracted material as quoted data, use strict task instructions and schemas, cap length, filter irrelevant content, and prevent the model from selecting tools or changing authorization based on document text. Never let uploads provide system prompts or credentials.

## 3.3 Generation method comparison

| Method | Control | Diversity | Cost/complexity | Best role |
|---|---|---|---|---|
| Authored templates | High | Low–medium | Authoring effort | Competency objectives, risk rules, rubric, required facts |
| Parameterized procedural generation | High for defined variables | Medium–high | Low–medium | Root cause, stakeholder style, data volume, constraints, timing |
| LLM narrative expansion | Medium | High | Inference and validation | Dialogues, briefing language, realistic details within constraints |
| Retrieval-grounded variation | Depends on source quality | Medium | Source curation/search | Reuse approved domain facts/examples, not random content |
| Constraint/planning system | High for encoded constraints | Limited by model | Higher authoring effort | Dependencies, valid paths and solvability checks for complex scenarios |
| Fully unconstrained one-shot generation | Low | High | Low initial effort; high defect risk | Avoid for published assessment instances |

GENEVA (Microsoft Research/IEEE CoG 2024) demonstrates generation and visualization of branching narratives from a high-level description and constraints. WorkVerse can borrow graph-authoring ideas, but its objectives and action validity are more operational than freeform story quality.

Source: https://www.microsoft.com/en-us/research/publication/geneva-generating-and-visualizing-branching-narratives-using-llms/ .

## 3.4 Scenario blueprint

A blueprint should include:
- schema/template/version IDs and variation seed;
- target role and difficulty metadata;
- learning objectives and observables;
- initial situation, timeline and constraints;
- locations, character IDs and interaction objects;
- facts, visibility/knowledge rules and disclosure events;
- tasks, dependencies, legal actions and pre/postconditions;
- terminal outcomes and recovery routes;
- rubric and evidence mapping;
- validator results, model/prompt/provider IDs and generation timestamp.

Generate prose and permitted parameters; keep the core objective, safety/critical-action rules and criterion definitions author-controlled. Treat blueprint versions as immutable after session launch.

## 3.5 Diversity without assessment drift

Change scenario details that create new decisions without quietly changing what is assessed. For example, production incident variants may vary root cause (config, dependency, migration), affected endpoint, customer impact, teammate availability, evidence ordering, and stakeholder urgency. Every variant must preserve relevant evidence opportunities and valid resolution paths.

Track difficulty factors explicitly (number of actors, branching dependencies, ambiguity, risk, number of evidence sources, competing priorities, urgency). Don't claim variants are equivalent because their prompt descriptions look similar. Use expert review, controlled baseline paths, outcome/effort comparison and eventually learner data to calibrate them.

## 3.6 Validation and solvability

Use a layered validator:
1. JSON/Pydantic schema validation.
2. Referential integrity and unique IDs.
3. Domain invariants and allowed enum/range checks.
4. Graph reachability and required-evidence path checks.
5. Rubric-to-objective/evidence coverage.
6. Scripted ideal/weak/adversarial path smoke tests.
7. LLM critique for missing context/contradictions as an additional signal.
8. Human review for novel/high-risk variants or validator disagreement.

An ideal-agent simulation that solves one scenario is only a heuristic; it does not prove every user will find the task understandable or fair. Retain invalid scenario samples as regression tests.

## 3.7 Difficulty calibration

For P0, use explicit selected difficulty plus simple transparent heuristics after each completed session (e.g. recommend more practice on a criterion with repeated supported gaps). Do not implement Bayesian knowledge tracing, IRT or reinforcement learning until there is sufficient labelled data and an explicit reason. These models rely on assumptions about how observations relate to latent proficiency; complex open-ended interaction makes that relationship uncertain.

Self-reported level can set a default context but should not determine a user's ceiling. Allow easy/standard/challenging selection and provide a retry/skip path. As the product gathers evidence, test whether objective indicators (validated actions, task output, hints used, evidence gathering) predict improvement on an unseen scenario.

## 3.8 Scenario-quality evaluation

Measure separately:
- structural validity (automated pass/fail);
- solvability/reachability (automated path tests and reviewer playthrough);
- competency/rubric alignment (expert ratings);
- internal consistency/character knowledge (scripted questions and human sampling);
- realism and relevance (target-user/expert ratings);
- variation/diversity (parameter coverage and qualitative assessment);
- difficulty comparability (paired baseline and human/user outcomes);
- operational cost, generation latency and rejection rate.

Compare variants with expert-authored baseline scenarios. Keep known failure cases. Do not count a high number of generated scenarios as a quality metric by itself.

---

# Part 4 — Experiential Learning and Simulation-Based Training

## 4.1 Theory and evidence

Simulation-based learning allows learners to practise complex decisions, observe consequences and reflect in a lower-risk environment. Chernikova et al.'s meta-analysis covered 145 studies in higher education and reported a positive overall effect for simulation-based learning on complex skills, with findings on scaffolding suggesting that learner prior knowledge matters. Those results support testing a practice/debrief loop, but do not establish that AI-generated workplace simulations will deliver the same effect.

Experiential learning and reflective practice suggest a cycle of experience, reflection, conceptualization and re-application. Deliberate practice suggests focused attempts with clear goals and usable feedback. Cognitive load theory warns that extraneous interactions can compete with learning. These principles imply: keep the task authentic but bounded, make objectives clear, avoid overly long navigation, debrief key decisions, and give targeted retries.

Primary reference: Chernikova et al., 2020, https://doi.org/10.3102/0034654320933544 .

## 4.2 Learning cycle design

1. **Pre-brief:** explain the role, goal, controls, stakes, available tools and evaluation categories; do not reveal the hidden solution path.
2. **Independent attempt:** let the student choose questions/actions; record objective and conversational evidence.
3. **Consequences:** reflect validated actions in the world, including plausible complications and recovery paths.
4. **Debrief:** show exact evidence, strengths, overlooked risks, score anchors and alternative approaches.
5. **Reflection:** ask the learner to identify a decision they would change and why.
6. **Focused practice:** recommend a short exercise for a target gap.
7. **Transfer attempt:** use a different scenario with the same competency rather than only replaying an identical transcript.

Separate a **practice mode** (hints available, visible objectives, coaching) from an **assessment-like practice mode** (less help, no answer hints before actions). Any hint should be logged because it changes how independent performance should be interpreted.

## 4.3 Feedback and retry

Debriefing should be immediate enough for the memory of the event to be fresh, but avoid injecting a hint during an independent challenge unless that is the chosen mode. A retry may preserve the broad task structure but change root cause, stakeholder stance, information order, or constraint. Exact replay is useful for comprehension; transfer needs a novel scenario.

Don't automatically make a scenario harder after one strong result. Performance may be affected by luck, scenario familiarity, language, or an easier variant. In the MVP, recommend a future level after multiple compatible attempts and expose the rationale.

## 4.4 Learning outcomes and transfer

Distinguish five outcomes:
- finishing the current simulation;
- a better score on the exact same scenario;
- better performance on a different scenario assessing the same competency;
- retention after a time delay;
- improved real workplace performance.

These are not interchangeable. The prototype can establish usability and collect early transfer evidence, but real workplace transfer requires a longer and more careful study with valid outcome measures and appropriate consent.

### Feasible pilot design

- Baseline: one scenario, scored with a fixed rubric.
- Intervention: practice with evidence-based debrief and a focused retry.
- Transfer: a different scenario in the same competency family, scored blind where feasible.
- Comparison: if practical, a group using a text-only scenario with the same learning objectives, or a counterbalanced crossover design.
- Measures: objective task completion, criterion-level scores, evidence gathering, number of invalid actions, time/assistance used, usability, perceived cognitive load, and qualitative reflection.
- Confounders: prior experience, scenario difficulty, model variance, language ability, hints, internet/model latency, and reviewer differences.
- Reporting: participant count, recruitment, exclusion criteria, instruments, analysis, limitations and adverse findings.

A usability study answers “can people use it?” A learning study asks “did they learn more or transfer skill?” Do not present one as the other.

## 4.5 Engagement, immersion and cognitive load

A spatial scene may increase social/contextual presence, but also create overhead: movement, camera orientation, finding rooms and managing UI. Make the map compact, use location labels and quick navigation, and open conversation/document panels beside the world. Only require movement where it conveys context or controls access to a meaningful interaction.

Validate the value of the 2D interface by comparing the same scenario with direct location/action navigation. Measure task success, time to find evidence, navigation errors, perceived usability and cognitive load. If map navigation adds effort without learning value, simplify it rather than defending “metaverse” as a goal in itself.

## 4.6 Suggested education study scope

For a student project, start with formative think-aloud usability testing on a small convenience sample, then a pilot scoring calibration study, then a transfer experiment if time and participant access permit. Small samples provide defect-finding and hypothesis generation, not a generalizable estimate of educational impact. If results will be published, check institutional ethics/research requirements, participant consent and data-retention rules in advance.

---

# Part 5 — 2D Virtual Workplace Design and Interaction

## 5.1 Why spatial interaction?

A 2D environment can give the task a place/context: a dashboard is in engineering, status conversations occur in a manager area, and client requirements are discussed in a meeting room. It can help connect information to action and give visible feedback when new events happen. But there is no cited evidence proving that a 2D workplace is better than a carefully designed chat/dashboard for this product. Treat spatial learning value as a design hypothesis.

### Alternatives

| UI | Benefits | Limitations | Use in WorkVerse |
|---|---|---|---|
| Chat-only | Simplest, accessible text history, low implementation complexity | Weak sense of place/context and task affordances | Fallback/control condition; also useful for narrow screens |
| Task dashboard with character panels | Easy navigation and visible objectives | Can feel like a web form rather than a situated workplace | Strong baseline and accessible mode |
| 2D Phaser office | Spatial context, discoverable objects, character presence, clear demonstration value | Movement friction, canvas accessibility limitations, assets/test complexity | Recommended main presentation, with quick/direct controls |
| 3D world | More spatial depth and camera freedom | Higher asset/performance complexity; little need for MVP | Not recommended absent concrete product evidence |
| Fixed branching narrative | Predictable and cheap | Limited open-ended adaptation | Authoring/validation structure behind the world, not the only user experience |

## 5.2 Compact office model

Start with three areas:

1. **Engineering workspace:** incident board/log dashboard, deployment history, teammate character, task checklist.
2. **Manager area:** status update, prioritization, escalation and commitment history.
3. **Meeting room:** client character, known impact/requirements, timeline communication and summary.

Rooms should be scenario-configurable rather than universally mandatory. A code review may emphasize engineering and task board; a client-discovery scenario may emphasize meeting space and requirements artifact.

## 5.3 Interactions and affordances

Every object should answer “what can I do here, and why does it matter?” Use contextual click targets, proximity interaction where meaningful, visible action labels, and keyboard alternatives. Interaction examples:
- inspect log artifact (reveals evidence fact if allowed);
- open deployment record (displays a structured artifact, not arbitrary model prose);
- interact with teammate (contextual conversation);
- update incident status (validated form/action);
- open task board (objective/dependency view);
- submit a deliverable (stored content or verified document reference).

The backend should receive an explicit typed intent with object/action IDs. The server verifies location/permission/preconditions and returns state delta/events. Phaser can animate the accepted action after confirmation.

## 5.4 Navigation and accessibility

Use mouse click-to-move or keyboard controls, visible location labels, current objective, quick room navigation and an accessible interaction list. Do not hide the only task behind a small sprite collision target. Avoid color-only state indication; pair color with labels/icons/text. Support keyboard focus, accessible HTML panels, text transcript and adjustable text. Voice is optional, not the only interface.

The Phaser canvas itself is not a replacement for semantic HTML. Use regular React/HTML controls for conversations, objectives, reports and file interactions. Provide reduced-motion/simple mode where practical and ensure all objectives are completable without animation timing.

WCAG 2.2 provides the current W3C accessibility standard and criteria to map into product testing: https://www.w3.org/TR/WCAG22/ .

## 5.5 Phaser 3 integration with Next.js

Next.js page/layout/server components should remain separate from the Phaser runtime. Mount Phaser inside a Client Component and load it client-only if module initialization uses browser globals. Initialize/destroy the game in lifecycle-safe code; register/unregister all event listeners to avoid duplicate handlers after navigation. Keep React and Phaser connected through a small typed event bridge rather than letting React components mutate Phaser internals directly.

Phaser scenes can organize loading/menu/game/play areas. Tilemap support can use maps exported from Tiled. For one compact office, one gameplay scene plus a UI overlay is sufficient; don't create a separate scene for every clickable object unless it helps maintainability.

Official docs:
- Next.js Server/Client components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Next.js browser-only component guidance: https://nextjs.org/docs/app/guides/single-page-applications
- Phaser scenes: https://docs.phaser.io/phaser/concepts/scenes
- Phaser 3.88.2 tilemap API: https://docs.phaser.io/api-documentation/3.88.2/class/tilemaps-tile

## 5.6 Spatial state and backend synchronization

Client coordinates only represent rendering. Send higher-level events such as `navigate_to_location`, `interact_with_object`, `inspect_artifact`, and `approach_character`. The backend derives whether the interaction is legal; it must not trust a client coordinate to assert room access or task completion. Return a state version and validated event IDs. On stale state or reconnect, fetch the current session snapshot.

## 5.7 Usability experiment

Compare two implementations of the same scenario:
- A: Phaser map with contextual object interactions and quick navigation.
- B: direct list of rooms/actions with the exact same characters, evidence, task rules and rubric.

Measure task completion, time to find required facts, invalid interactions, navigation errors, help requests, perceived usability, cognitive load and qualitative preference. Use counterbalancing to reduce order effects if participants try both. Do not conclude that the 2D version improved learning solely because participants liked it more; assess objective performance separately.

---

# Part 6 — Integrated Findings and Practical Decisions

## 6.1 Findings matrix

| Area | What is supported | WorkVerse action | Confidence / limitation |
|---|---|---|---|
| Hybrid simulation | State/permission/task correctness is easier to test in deterministic code; dialogue needs linguistic flexibility | Backend-owned state + LLM proposals/narration | Strong engineering inference; exact model quality requires testing |
| Character believability | Memory/retrieval/planning can support believable agents in sandbox research | Scoped character facts and event summaries; one model per active turn first | Promising research pattern, not workplace validity proof |
| Scenario variation | Graph/constrained generation can produce branching narrative variations | Templates + parameter generation + Pydantic/rule/reachability checks | Strong implementation rationale; difficulty comparability remains open |
| AI assessment | Rubrics and evidence can make feedback inspectable; LLM judges have biases | Anchored rubric, evidence IDs, quote checks, human calibration | Essential; validity not established until measured |
| Simulation learning | Broader simulation-based learning evidence is positive but context-specific | Brief-act-consequence-debrief-retry loop | Moderate evidence for the general method, uncertain product transfer |
| Spatial UI | Phaser can represent rooms/tilemaps; product benefit is unproven | Small map + direct navigation and accessibility alternatives | Product hypothesis to test |
| Data/security | RLS and least privilege matter; uploads and generated output are untrusted | Supabase RLS tests, API ownership checks, private object storage, schema validation | High-confidence security principle; implementation-specific tests required |
| Object storage | MinIO distribution/maintenance/licensing posture has a current risk flag | Pin/review image/distribution; keep S3 adapter replaceable | Must be rechecked at build/deployment; not legal advice |

## 6.2 Cross-disciplinary dependencies

- Scenario generation depends on the rubric: if a competency cannot be observed in a generated path, the scenario is unscorable.
- The evaluator depends on event persistence and message IDs: a transcript-only report cannot reliably assess completed tool actions.
- Character knowledge rules depend on the authoritative state model: without scoped facts, dialogue contradicts or leaks information.
- The world interface depends on the action API: every hotspot must map to a meaningful valid action.
- Learning outcomes depend on the scenario variation scheme: replay scores cannot be compared if the rubric and difficulty silently drift.
- Voice fairness depends on ASR quality and transcript correction: a recognition error must not be confused with learner reasoning.
- Data policy affects AI prompting and memory: only necessary profile/document facts should be sent to a model and stored in the session snapshot.

## 6.3 Prioritized scope

### P0
Profile intake, one validated scenario family, Phaser office with three meaningful places, role-configured characters, shared authoritative state, text interaction, event/message persistence, deterministic actions, evidence-grounded debrief, retry, ownership/security tests and documentation.

### P1
More scenario families, profile-document ingestion, task submissions, progress dashboard, optional voice, background jobs for slow processing, reviewer tools, human calibration workflow.

### P2
Multiplayer, broad autonomous world simulation, long-term semantic memory/vector DB, reinforcement learning, custom model training, extensive avatar system, production-grade untrusted code execution, high-stakes employer decisions.

## 6.4 Highest-value technical contributions

1. **Validated procedural workplace scenarios:** produce varied incidents with explicit objective/evidence coverage and valid solution paths, then evaluate how often validation catches defects.
2. **Traceable assessment pipeline:** criterion-level result references actual message/event/task evidence; quote/source validation is deterministic; ambiguous/no-evidence cases are explicit.
3. **Shared-state multi-character interaction:** role perspectives and information asymmetry are represented as data and controlled events, enabling coherent consequences without an expensive autonomous swarm.

These are plausible engineering/research contributions. Novelty claims require a further literature review; this report does not assert they are unprecedented.

## 6.5 Proposed experiments

| Priority | Research question | Method | Main measure | Decision |
|---|---|---|---|---|
| P0 | Can one generated scenario be valid and playable? | Generate sample variants, apply validators, run scripted/human playthroughs | rejection rate, unresolved objectives, discovered contradictions | tighten templates/validation |
| P0 | Are debrief claims grounded? | Generate sample reports containing known good/bad/ambiguous sessions, verify IDs/quotes and compare to expert labels | unsupported-claim rate and criterion disagreement | block release or change evaluator |
| P0 | Does state stay consistent across characters? | Hidden-fact and communication-event regression paths | count of leaks/contradictions | change state/character context design |
| P1 | Does the map help users? | Phaser vs direct room/action interface with same scenario | task success, information discovery time, navigation errors, perceived load | retain/simplify spatial UI |
| P1 | Do reports improve transfer? | Baseline scenario, feedback, unseen parallel scenario; compare scores with raters blinded when feasible | performance change on transfer scenario | change learning loop/design |
| P1 | Is scoring style-stable? | Equivalent answers with different wording/formality/length | unexplained score variance | adjust rubric/evaluator |
| P2 | Can adaptive difficulty improve outcomes? | Compare rule-based and non-adaptive scenario sequencing after data exists | unseen-scenario performance, dropout/frustration | consider more advanced skill model |

## 6.6 Open decisions register

| Decision | Default for MVP | Uncertainty/blocker |
|---|---|---|
| Exact LLM/provider/model | Configurable adapter; choose after quality/cost tests | Model IDs/prices change; verify current official price at implementation. Older prices/provider names in preliminary pasted notes are stale and should not be copied uncritically. |
| LangGraph vs custom FSM | Custom explicit state machine first | Add LangGraph only if checkpointing/branching wins in a prototype spike. |
| Streaming | POST + SSE-formatted `fetch` stream | Test selected browser/proxy and cancel/reconnect behavior. |
| Database role | Restricted runtime role if feasible; owner checks always | Verify exact Supabase pooler/role and RLS behavior. |
| MinIO distribution | Explicitly pinned reviewed image/build, local only | Current repo maintenance/source distribution/AGPL caveat must be reviewed before use. |
| Voice provider | Omit from P0 | Need latency, language, cost, transcript correction and retention decision. |
| Overall score | Omit or derive from frozen weights | Needs expert-approved weights and sufficient evidence; criterion-level feedback first. |
| Learning study | Small formative pilot before claims | Participant recruitment, sample size, ethics and a transfer outcome measure are open. |

## 6.7 Final conclusion

WorkVerse AI should be implemented as a stateful simulation product with a game-like presentation, not as a game where the AI improvises all rules. The critical vertical slice is a learner navigating to relevant workplace tools/people, taking adaptive but validated actions, and receiving feedback whose claims are traceable to the actual session.

The architecture can be built with the user's chosen pnpm/Turborepo, Next.js, Phaser 3, FastAPI and Supabase Postgres. The most important engineering work is not choosing more frameworks; it is defining stable contracts between the world, simulation engine, model, and evaluator. The most important research work is to validate scenario quality, assessment consistency, fairness, and the actual contribution of spatial interaction.

## Sources

1. Chernikova, O. et al. (2020). “Simulation-Based Learning in Higher Education: A Meta-Analysis.” *Review of Educational Research*, 90(4). https://doi.org/10.3102/0034654320933544
2. Park, J. S. et al. (2023). “Generative Agents: Interactive Simulacra of Human Behavior.” https://arxiv.org/abs/2304.03442
3. Leandro, J. J. G. et al. (2024). “GENEVA: GENErating and Visualizing branching narratives using LLMs.” IEEE Conference on Games. https://www.microsoft.com/en-us/research/publication/geneva-generating-and-visualizing-branching-narratives-using-llms/
4. Webster, E. S. et al. (2020). “Situational judgement test validity for selection: A systematic review and meta-analysis.” *Medical Education*, 54(10), 888–902. https://doi.org/10.1111/medu.14201
5. Shi, L. et al. (2024). “Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge.” https://arxiv.org/abs/2406.07791
6. Soumik, S. K. (2026 preprint). “Judging the Judges: A Systematic Evaluation of Bias Mitigation Strategies in LLM-as-a-Judge Pipelines.” https://arxiv.org/abs/2604.23178
7. Miao, F. & Holmes, W. (2023). UNESCO, “Guidance for Generative AI in Education and Research.” https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research
8. NIST (2024). *Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile*, NIST AI 600-1. https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf
9. OpenAI. “Structured Outputs.” https://developers.openai.com/api/docs/guides/structured-outputs
10. Next.js. “Server and Client Components.” https://nextjs.org/docs/app/getting-started/server-and-client-components
11. Phaser. “Scenes” and Phaser 3.88.2 Tilemap API. https://docs.phaser.io/phaser/concepts/scenes ; https://docs.phaser.io/api-documentation/3.88.2/class/tilemaps-tile
12. FastAPI. “Custom Response — HTML, Stream, File, others.” https://fastapi.tiangolo.com/advanced/custom-response/
13. Supabase. “Row Level Security”; “Securing your data”; “JSON Web Tokens.” https://supabase.com/docs/guides/database/postgres/row-level-security ; https://supabase.com/docs/guides/database/secure-data ; https://supabase.com/docs/guides/auth/jwts
14. NIST. “AI Risk Management Framework.” https://www.nist.gov/itl/ai-risk-management-framework
15. W3C. “Web Content Accessibility Guidelines (WCAG) 2.2.” https://www.w3.org/TR/WCAG22/
16. MinIO project repository and compliance notes. https://github.com/minio/minio ; https://github.com/minio/minio/blob/master/COMPLIANCE.md
