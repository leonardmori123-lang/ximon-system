// An error that carries the HTTP status to send back (400 bad input, 403 not allowed, 404, 409 conflict).
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Turns text like "12" into the number 12. Throws a 400 if it is not a whole number above zero.
function parseId(text, message = 'Bad id.') {
  const id = Number.parseInt(text, 10);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, message);
  return id;
}

module.exports = { HttpError, parseId };
