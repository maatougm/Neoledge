/**
 * @file json-schema.ts — minimal JSON Schema builders for tool params.
 * Hand-rolled rather than zod because the schemas go directly on the
 * wire to OpenAI/Z.AI/Gemini's function-calling APIs. Keeping the
 * vocabulary small keeps the LLM's task schema simple.
 */

export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: Array<string | number | boolean>
  default?: unknown
  additionalProperties?: boolean
  // For string types with a constrained length:
  minLength?: number
  maxLength?: number
  // For numbers / arrays:
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

export function obj(
  properties: Record<string, JsonSchema>,
  options: { required?: string[]; description?: string; additionalProperties?: boolean } = {},
): JsonSchema {
  return {
    type: 'object',
    properties,
    required: options.required ?? [],
    additionalProperties: options.additionalProperties ?? false,
    ...(options.description ? { description: options.description } : {}),
  }
}

export function arr(items: JsonSchema, options: { description?: string; maxItems?: number } = {}): JsonSchema {
  return {
    type: 'array',
    items,
    ...(options.description ? { description: options.description } : {}),
    ...(options.maxItems ? { maxItems: options.maxItems } : {}),
  }
}

export function str(options: { description?: string; enum?: string[]; maxLength?: number } = {}): JsonSchema {
  return {
    type: 'string',
    ...(options.description ? { description: options.description } : {}),
    ...(options.enum ? { enum: options.enum } : {}),
    ...(options.maxLength ? { maxLength: options.maxLength } : {}),
  }
}

export function num(options: { description?: string; minimum?: number; maximum?: number } = {}): JsonSchema {
  return {
    type: 'number',
    ...(options.description ? { description: options.description } : {}),
    ...(options.minimum !== undefined ? { minimum: options.minimum } : {}),
    ...(options.maximum !== undefined ? { maximum: options.maximum } : {}),
  }
}

export function int(options: { description?: string; minimum?: number; maximum?: number } = {}): JsonSchema {
  return { ...num(options), type: 'integer' }
}

export function bool(description?: string): JsonSchema {
  return { type: 'boolean', ...(description ? { description } : {}) }
}

/**
 * Best-effort runtime validation: walks the schema and checks the value
 * has every required key with a value of roughly the right shape. This is
 * NOT a full JSON Schema validator — the provider already validates tool
 * arguments before they reach us. We just guard against the model
 * returning {} on a forced emit, so we can throw a clear error.
 */
export function validateAgainst(schema: JsonSchema, value: unknown): { ok: true } | { ok: false; reason: string } {
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, reason: 'expected object' }
    }
    const obj = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in obj)) return { ok: false, reason: `missing required key "${key}"` }
    }
    return { ok: true }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return { ok: false, reason: 'expected array' }
    return { ok: true }
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return { ok: false, reason: 'expected string' }
    return { ok: true }
  }
  return { ok: true }
}
