/**
 * @file agent-errors.ts — typed errors emitted by the agent runtime.
 * Callers usually catch AgentEmitMissedError to gracefully fall back
 * to single-shot generation; the others are bugs or runaway-cost
 * conditions that should bubble up.
 */

/** The agent reached `maxIterations` without producing the terminal emit tool call. */
export class AgentEmitMissedError extends Error {
  constructor(message = 'Agent loop exited without an emit-tool call') {
    super(message)
    this.name = 'AgentEmitMissedError'
  }
}

// AgentToolFailureError removed in cleanup — the agent runtime surfaces
// tool errors to the model via a JSON `{error}` reply (see openai-compatible-
// tool-loop.ts), it doesn't throw. Restore from git if a thrown-error path
// is added in the future.

/** Wall-clock cap exceeded across the whole loop (vs per-call AbortSignal). */
export class AgentLoopTimeoutError extends Error {
  constructor(public readonly elapsedMs: number, public readonly limitMs: number) {
    super(`Agent loop exceeded ${limitMs}ms (elapsed=${elapsedMs}ms)`)
    this.name = 'AgentLoopTimeoutError'
  }
}

/** Tool call args failed minimal pre-flight validation (missing required keys). */
export class AgentToolValidationError extends Error {
  constructor(public readonly toolName: string, public readonly reason: string) {
    super(`Tool "${toolName}" arg validation failed: ${reason}`)
    this.name = 'AgentToolValidationError'
  }
}
