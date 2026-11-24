// Custom HTTP error class and parameter parsing helpers.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Parses a positive integer ID or throws a 400 error.
function parseId(text, message = 'Bad id.') {
  const id = Number.parseInt(text, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, message);
  }
  return id;
}

module.exports = { HttpError, parseId };
