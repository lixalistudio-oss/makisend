import type { StatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  constructor(
    public readonly statusCode: StatusCode,
    message: string,
    /** Stable, machine-readable reason sent next to the message (`{ error, code }`). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export type EncryptionKeyErrorCode = "ENCRYPTION_KEY_MISSING" | "ENCRYPTION_KEY_INVALID";

/**
 * The Worker's encryption keys are missing or malformed: nothing that touches the database can
 * run. `variables` names the offending secrets (never their values) so the dashboard can send the
 * owner to the page explaining how to generate a key.
 */
export class EncryptionKeyError extends AppError {
  constructor(
    public readonly code: EncryptionKeyErrorCode,
    public readonly variables: string[],
    message: string,
  ) {
    super(500, message, code);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad Request") {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not Found") {
    super(404, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}
