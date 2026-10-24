export type WorldAction = {
  id: string;
  label: string;
  description: string;
  action_type: string;
  kind: string;
  location_id: string | null;
  target_id: string | null;
  risk_level: string;
  requires_text: boolean;
  available: boolean;
  ready: boolean;
  locked_reason: string | null;
};

export type CharacterProfile = {
  years: number;
  personality: string;
  traits: string[];
  power: string;
  weakness: string;
  stats: Record<string, number>;
  portrait: string;
  gender?: "male" | "female";
  /** What this colleague expects from the learner (shown next to the chat). */
  needs?: string;
  knows: string;
};

export type WorldCharacter = {
  id: string;
  name: string;
  role: string;
  sprite: string;
  location_id: string;
  greeting: string;
  profile?: CharacterProfile | null;
  questions?: { q: string; fact: string | null }[];
};

export type WorldObject = {
  id: string;
  label: string;
  location_id: string;
  marker: string;
};

export type WorldLocation = {
  id: string;
  name: string;
  kind: string;
  description: string;
};

export type WorldView = {
  locations: WorldLocation[];
  characters: WorldCharacter[];
  objects: WorldObject[];
  actions: WorldAction[];
};

export type Objective = {
  id: string;
  label: string;
  status: string;
  required: boolean;
};

export type KnownFact = { id: string; label: string; detail: string };

export type CompletionStatus = {
  ready: boolean;
  required_objectives: string[];
  completed_objectives: string[];
  missing_objectives: string[];
  missing_actions: string[];
};

export type NavigationTarget = {
  objective_id: string;
  objective_label: string;
  action_id: string | null;
  action_label: string | null;
  target_type: "character" | "object" | "location" | "none";
  target_id: string | null;
  location_id: string | null;
  ready: boolean;
  reason: string | null;
};

export type SessionView = {
  id: string;
  status: string;
  state_version: number;
  current_location_id: string;
  active_character_id: string | null;
  phase: string;
  objectives: Objective[];
  tasks: Record<string, string>;
  facts_known: KnownFact[];
  incident: Record<string, unknown>;
  available_locations: string[];
  world: WorldView;
  navigation: NavigationTarget | null;
  completion: CompletionStatus;
  completed: boolean;
};

export type Prebrief = {
  title: string;
  role: string;
  difficulty: string;
  estimated_minutes: number;
  briefing: string;
  objectives: string[];
  competency_goals: string[];
  controls: string[];
  incident?: Record<string, unknown>;
  people?: { id: string; name: string; role: string; location: string; knows_about: boolean; knows?: string | null; profile?: CharacterProfile | null }[];
  assessed?: { id: string; name: string; description: string; great: string }[];
  tips?: string[];
};

export type ScenarioInstance = {
  scenario_instance_id: string;
  template_id: string;
  scenario_version: number;
  status: string;
  prebrief: Prebrief;
  world: WorldView;
  validation_summary?: Record<string, unknown>;
};

export type ScenarioTemplate = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  categories: string[];
  target_roles: string[];
  supported_modes: string[];
  estimated_minutes: number;
  difficulty_options: string[];
  story?: string;
  you_will?: string[];
  track?: string;
  track_label?: string;
  /** Incident type this card shows; sent back when starting so the session matches. */
  incident?: string;
  people?: { role: string; knows: string }[];
  skills?: string[];
  report?: string;
};

export type SuggestedAction = {
  id: string;
  label: string;
  action_type: string;
  confidence: string;
};

export type TurnResponse = {
  turn_id: string;
  duplicate: boolean;
  state_version: number;
  assistant_message_id: string;
  character_id: string;
  message: string;
  suggested_actions: SuggestedAction[];
  newly_discovered_facts: string[];
  session: SessionView;
};

export type ActionResponse = {
  accepted: boolean;
  duplicate: boolean;
  state_version: number;
  state_delta: Record<string, unknown>;
  events: { id: string; type: string }[];
  session: SessionView;
};

export type TranscriptMessage = {
  id: string;
  session_id: string;
  sequence_number: number;
  speaker_type: "learner" | "character" | "system";
  character_id: string | null;
  content: string;
  modality: string;
  status: string;
  created_at: string | null;
};

export type EvidenceRef = {
  source_type: "message" | "event" | "deliverable";
  source_id: string;
  quote: string | null;
  interpretation: string;
};

export type EvaluationItem = {
  criterion_id: string;
  criterion_name: string;
  status: "scored" | "insufficient_evidence" | "needs_review";
  score: number | null;
  score_max: number;
  explanation: string;
  recommendation: string;
  counterevidence: unknown[];
  evidence: EvidenceRef[];
};

export type LedgerCheck = {
  id: string;
  label: string;
  passed: boolean;
  source_type: "message" | "event" | "deliverable" | null;
  source_id: string | null;
  detail: string;
};

export type ConversationTurn = {
  message_id: string;
  character_id: string | null;
  words: number;
  question: boolean;
  long: boolean;
  modality: string;
};

export type ConversationStats = {
  turns: ConversationTurn[];
  people: {
    character_id: string;
    name: string;
    learner_words: number;
    npc_words: number;
    learner_turns: number;
    npc_turns: number;
  }[];
  learner_turns: number;
  questions: number;
  question_ratio: number;
  avg_words: number;
  median_words: number;
  long_turns: number;
  npc_avg_words: number;
  long_turn_words: number;
};

export type Coaching = { message_id: string; original: string; better: string; why: string };

export type SayNextTime = { check: string; to: string; say: string };

export type SimEvent = {
  id: string;
  sequence_number: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string | null;
};

export type Evaluation = {
  id: string;
  findings: string[];
  ledger: Record<string, LedgerCheck[]>;
  conversation: ConversationStats | null;
  coaching: Coaching[];
  say_next_time: SayNextTime[];
  session_id: string;
  status: string;
  rubric_version: string;
  evaluator_version: string;
  evaluator_model: string | null;
  overall_score: number | null;
  score_scale: { minimum: number; maximum: number; interpretation: string };
  summary: string;
  limitations: string[];
  validation_warnings: string[];
  items: EvaluationItem[];
  created_at: string | null;
};

export type Profile = {
  id: string;
  email?: string | null;
  display_name: string | null;
  education_summary: string | null;
  experience_summary: string | null;
  target_role: string | null;
  career_goals: string[];
  preferred_stack: string[];
  experience_level: string | null;
  created_at: string;
  updated_at: string;
  skills: ProfileSkill[];
};

export type ProfileSkill = {
  id: string;
  name: string;
  level_self_reported: string | null;
  provenance: string;
};

export type SessionSummary = {
  id: string;
  status: string;
  mode: string;
  difficulty: string;
  title: string;
  state_version: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type ProgressResponse = {
  sessions: { id: string; status: string; difficulty: string; created_at: string }[];
  evaluations: {
    session_id: string;
    overall_score: number | null;
    rubric_version: string;
    difficulty: string;
    completed_at: string;
  }[];
};

export type VoiceNpc = { id: string; name: string; role: string };

export type VoiceSessionStart = {
  voice_session_id: string;
  status: string;
  connection_type: string;
  conversation_token: string;
  context_grant: string | null;
  grant_expires_at: number | null;
  npc: VoiceNpc;
  greeting: string;
};

export type VoiceSessionView = {
  id: string;
  status: string;
  npc_id: string;
  created_at: string | null;
  ended_at: string | null;
  transcript: {
    id: string;
    sequence_number: number;
    speaker: "learner" | "npc";
    text: string;
    created_at: string | null;
  }[];
};

export type VoiceTranscriptEntry = {
  id: string;
  speaker: "user" | "npc";
  text: string;
  status: "partial" | "final";
};

export type CompetencyTrend = {
  criterion_id: string;
  criterion_name: string;
  attempts: number;
  average_score: number | null;
  score_max: number;
  rubric_version: string;
  sufficient_data: boolean;
};
