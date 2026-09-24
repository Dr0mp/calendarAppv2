/** An error with a stable `code` that the client translates. */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} [message]
   * @param {Record<string, unknown>} [details]
   */
  constructor(status, code, message = code, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code = 'validation_error', details, message = 'Validation failed') =>
  new ApiError(400, code, message, details);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Not signed in');
export const forbidden = (code = 'forbidden') => new ApiError(403, code, 'Not allowed');
export const notFound = (code = 'not_found') => new ApiError(404, code, 'Not found');
export const conflict = (code, details, message = code) => new ApiError(409, code, message, details);
export const tooMany = (retryAfterS) =>
  new ApiError(429, 'rate_limited', 'Too many requests', retryAfterS ? { retryAfter: retryAfterS } : undefined);

/**
 * Convert a Zod error into `details.fields` ({path: code}).
 * @param {import('zod').ZodError} err
 */
export function zodDetails(err) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (fields[key]) continue;
    // Prefer our custom message codes (set in shared schemas) over zod's English text.
    fields[key] = /^[a-z_]+$/.test(issue.message) ? issue.message : issue.code;
  }
  return { fields };
}

/**
 * Parse `data` with `schema`, throwing a 400 ApiError on failure.
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} data
 * @returns {T}
 */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('validation_error', zodDetails(r.error));
  return r.data;
}
