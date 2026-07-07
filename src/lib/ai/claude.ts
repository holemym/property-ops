import type { TriageInput, TriageSuggestion } from './triage'
import { TICKET_CATEGORIES, TICKET_PRIORITIES, normalizeSuggestion } from './triage'

// ---------------------------------------------------------------------------
// The Claude-backed classifier. This module is imported LAZILY by triage.ts and only
// when ANTHROPIC_API_KEY is set — so `@anthropic-ai/sdk` is an OPTIONAL dependency that
// need not be installed (and the app builds) while triage runs disconnected. To turn it
// on: `npm i @anthropic-ai/sdk`, set ANTHROPIC_API_KEY, and (optionally) pick a model
// via ANTHROPIC_TRIAGE_MODEL. Haiku 4.5 is the default — cheapest model, ~$0.001/ticket,
// and this is a textbook classification task.
// ---------------------------------------------------------------------------

const TRIAGE_MODEL = process.env.ANTHROPIC_TRIAGE_MODEL ?? 'claude-haiku-4-5'

const SYSTEM = [
  'You triage maintenance tickets for a property-management platform.',
  'Read the ticket and classify it. Choose the single best category and a priority.',
  `Valid categories: ${TICKET_CATEGORIES.join(', ')}.`,
  `Valid priorities: ${TICKET_PRIORITIES.join(', ')} (URGENT = safety/flood/gas/no-heat/no-water,`,
  'HIGH = major function lost, NORMAL = routine, LOW = cosmetic/minor).',
  'Also write a one-sentence note (<= 160 chars) explaining the classification.',
  'Return a confidence between 0 and 1.',
].join(' ')

// JSON Schema for structured outputs — guarantees the response is valid JSON in exactly
// this shape (Haiku 4.5 supports structured outputs). additionalProperties:false + all
// fields required, per the structured-outputs constraints.
const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: [...TICKET_CATEGORIES] },
    priority: { type: 'string', enum: [...TICKET_PRIORITIES] },
    note: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['category', 'priority', 'note', 'confidence'],
  additionalProperties: false,
}

type TextBlock = { type: string; text?: string }

/**
 * Classify a ticket with Claude Haiku via the Anthropic SDK. Throws on a missing key,
 * a refusal, or an unparseable response — the caller (classifyTicket) catches and falls
 * back to the offline heuristic, so a triage failure never blocks ticket creation.
 */
export async function classifyWithClaude(input: TriageInput): Promise<TriageSuggestion> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  // turbopackIgnore/webpackIgnore keep the bundler from resolving the SDK at build time,
  // so `@anthropic-ai/sdk` can stay an OPTIONAL, uninstalled dependency while triage runs
  // disconnected. The import is left as a runtime call: if the package is absent it throws
  // here and the caller falls back to the heuristic. Install it only when connecting.
  // The `: string` specifier keeps TypeScript from resolving the module (it types the
  // import as `any`), and the ignore comments keep the bundler from resolving it — both
  // are needed so the uninstalled SDK doesn't break `next build` or the type check.
  const pkg: string = '@anthropic-ai/sdk'
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pkg)
  const Anthropic = mod.default
  const client = new Anthropic({ apiKey })

  const msg = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [
      { role: 'user', content: `Title: ${input.title}\n\nDescription: ${input.description}` },
    ],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })

  if (msg.stop_reason === 'refusal') throw new Error('classification refused by model')
  const text = (msg.content as TextBlock[]).find((b) => b.type === 'text')?.text
  if (!text) throw new Error('no classification text in response')

  return normalizeSuggestion(JSON.parse(text), 'ai')
}
