const MAX_QUESTION_LENGTH = 500;

export type QuestionParseResult =
  | { ok: true; question: string }
  | { ok: false; error: string };

/** A request body is an outside source, like everything else we validate. */
export function parseAskBody(body: unknown): QuestionParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "body must be a JSON object" };
  }

  if (!("question" in body)) {
    return { ok: false, error: "body must contain a 'question' field" };
  }

  const { question } = body;

  if (typeof question !== "string") {
    return { ok: false, error: "'question' must be a string" };
  }

  const trimmed = question.trim();

  if (trimmed === "") {
    return { ok: false, error: "'question' must not be empty" };
  }

  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return {
      ok: false,
      error: `'question' must be at most ${MAX_QUESTION_LENGTH} characters`,
    };
  }

  return { ok: true, question: trimmed };
}