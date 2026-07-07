import type { TicketCategory, TicketPriority } from '@/types/domain'

// ---------------------------------------------------------------------------
// AI ticket triage — the provider-agnostic core (Phase 4).
//
// "DISCONNECTED BY DEFAULT." This module NEVER calls an external API unless an
// ANTHROPIC_API_KEY is present in the environment. With no key set (the current,
// shipping state), classifyTicket() runs a deterministic, dependency-free heuristic
// that costs nothing and makes no network calls. Set the key (and `npm i
// @anthropic-ai/sdk`) to switch the same call site to a real Claude Haiku
// classification — see ./claude.ts. The Anthropic API is a separate, pay-per-token
// bill (its own credit balance at console.anthropic.com), independent of any
// Claude.ai / Claude Code subscription; until a key is added, it is never billed.
// ---------------------------------------------------------------------------

// Kept as local const tuples (not derived from the domain unions) so this module can
// also feed a JSON-schema `enum` for structured outputs. Mirror src/types/domain.ts.
export const TICKET_CATEGORIES = [
  'PLUMBING', 'HEATING', 'ELECTRICAL', 'CLEANING', 'APPLIANCE',
  'INTERNET', 'KEYS', 'DAMAGE', 'NOISE', 'BILLING', 'OTHER',
] as const

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const

export type TriageInput = { title: string; description: string }
export type TriageSource = 'ai' | 'heuristic'
export type TriageSuggestion = {
  category: TicketCategory
  priority: TicketPriority
  note: string
  confidence: number // 0..1
  source: TriageSource
}

/** True only when a real API key is configured — the single "is it connected?" switch. */
export function isAiTriageEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// --- Heuristic keyword tables ------------------------------------------------
// Deterministic, offline fallback. Ordered by specificity so an earlier category
// wins a tie (e.g. a "no hot water" ticket lands on HEATING, not PLUMBING). OTHER is
// implicit — it's the result when nothing matches.
const CATEGORY_KEYWORDS: Array<{ category: TicketCategory; words: string[] }> = [
  { category: 'HEATING', words: ['heat', 'heating', 'radiator', 'boiler', 'furnace', 'thermostat', 'no hot water', 'freezing', 'cold water', 'heater'] },
  { category: 'PLUMBING', words: ['leak', 'leaking', 'pipe', 'drain', 'toilet', 'faucet', 'tap', 'sink', 'clog', 'clogged', 'sewage', 'flush', 'water damage', 'burst', 'flood'] },
  { category: 'ELECTRICAL', words: ['electric', 'electrical', 'power', 'outlet', 'socket', 'breaker', 'fuse', 'wiring', 'spark', 'shock', 'no power', 'light not', 'lights not'] },
  { category: 'APPLIANCE', words: ['fridge', 'refrigerator', 'oven', 'stove', 'dishwasher', 'washer', 'dryer', 'microwave', 'appliance', 'washing machine'] },
  { category: 'INTERNET', words: ['internet', 'wifi', 'wi-fi', 'router', 'network', 'ethernet', 'broadband', 'no connection'] },
  { category: 'KEYS', words: ['key', 'keys', 'lock', 'locked out', 'lockout', 'fob', 'door won', 'access card', 'entry'] },
  { category: 'CLEANING', words: ['clean', 'dirty', 'trash', 'garbage', 'mold', 'mould', 'pest', 'roach', 'cockroach', 'mice', 'rats', 'rat', 'insect', 'bed bug', 'infestation'] },
  { category: 'NOISE', words: ['noise', 'loud', 'noisy', 'music', 'party', 'disturbance', 'shouting'] },
  { category: 'DAMAGE', words: ['broken', 'crack', 'cracked', 'damage', 'damaged', 'hole', 'shattered', 'dent', 'smashed'] },
  { category: 'BILLING', words: ['bill', 'invoice', 'rent', 'payment', 'charge', 'overcharge', 'refund', 'deposit', 'fee'] },
]

const URGENT_KEYWORDS = ['emergency', 'urgent', 'flood', 'flooding', 'gas', 'smoke', 'fire', 'burst', 'sewage', 'shock', 'no water', 'no heat', 'break-in', 'break in', 'broken in', 'injury', 'danger', 'immediately', 'asap', 'security']
const HIGH_KEYWORDS = ['no hot water', 'leak', 'leaking', 'not working', 'stopped working', "won't", 'cannot', "can't", 'locked out', 'lockout', 'mold', 'mould', 'infestation', 'no power', 'no internet', 'overflowing']
const LOW_KEYWORDS = ['cosmetic', 'minor', 'small', 'whenever', 'sometime', 'no rush', 'paint', 'squeak', 'scuff', 'slightly', 'when convenient']

function textOf(input: TriageInput): string {
  return `${input.title}\n${input.description}`.toLowerCase()
}

function firstMatch(text: string, words: string[]): string | null {
  for (const w of words) if (text.includes(w)) return w
  return null
}

/**
 * Deterministic, offline classification. Scores categories by keyword hits (first
 * table entry wins a tie), then derives priority from urgency keywords. Always returns
 * a suggestion — OTHER / NORMAL when nothing matches. Pure and side-effect-free, so it's
 * unit-testable and safe to run on every ticket at zero cost.
 */
export function suggestTriageHeuristic(input: TriageInput): TriageSuggestion {
  const text = textOf(input)

  let bestCategory: TicketCategory = 'OTHER'
  let bestHits = 0
  let matchedWord: string | null = null
  for (const { category, words } of CATEGORY_KEYWORDS) {
    const hits = words.filter((w) => text.includes(w)).length
    if (hits > bestHits) {
      bestHits = hits
      bestCategory = category
      matchedWord = firstMatch(text, words)
    }
  }

  let priority: TicketPriority = 'NORMAL'
  if (firstMatch(text, URGENT_KEYWORDS)) priority = 'URGENT'
  else if (firstMatch(text, HIGH_KEYWORDS)) priority = 'HIGH'
  else if (firstMatch(text, LOW_KEYWORDS)) priority = 'LOW'

  // Confidence tracks how much evidence the keyword pass found. Category with no hits
  // (OTHER) is low-confidence by construction.
  const confidence =
    bestHits === 0 ? 0.2 : bestHits === 1 ? 0.5 : bestHits === 2 ? 0.7 : 0.85

  const basis = matchedWord ? `keyword "${matchedWord}"` : 'no strong keyword match'
  const note = `Rule-based suggestion from ${basis}; verify before acting.`

  return { category: bestCategory, priority, note, confidence, source: 'heuristic' }
}

/**
 * Coerce an arbitrary object (heuristic output OR a model's JSON) into a valid, bounded
 * TriageSuggestion. Unknown category → OTHER, unknown priority → NORMAL, confidence
 * clamped to [0,1], note trimmed to 160 chars. Keeps a malformed model response from
 * ever producing an invalid enum that a downstream DB insert would reject.
 */
export function normalizeSuggestion(raw: unknown, source: TriageSource): TriageSuggestion {
  const obj = (raw ?? {}) as Record<string, unknown>
  const category = (TICKET_CATEGORIES as readonly string[]).includes(String(obj.category))
    ? (obj.category as TicketCategory)
    : 'OTHER'
  const priority = (TICKET_PRIORITIES as readonly string[]).includes(String(obj.priority))
    ? (obj.priority as TicketPriority)
    : 'NORMAL'
  const rawConfidence = typeof obj.confidence === 'number' ? obj.confidence : 0.5
  const confidence = Math.max(0, Math.min(1, rawConfidence))
  const note = String(obj.note ?? '').slice(0, 160) || 'No note.'
  return { category, priority, note, confidence, source }
}

/**
 * The one call site the app uses. When a key is configured, delegates to the Claude
 * Haiku classifier (lazily imported so the SDK is only loaded when connected); on ANY
 * failure — missing package, refusal, API/network error — it falls back to the offline
 * heuristic so ticket creation is never blocked or made costly by triage.
 */
export async function classifyTicket(input: TriageInput): Promise<TriageSuggestion> {
  if (isAiTriageEnabled()) {
    try {
      const { classifyWithClaude } = await import('./claude')
      return await classifyWithClaude(input)
    } catch (e) {
      console.error('[triage] Claude classification failed; using heuristic:', e)
    }
  }
  return suggestTriageHeuristic(input)
}
