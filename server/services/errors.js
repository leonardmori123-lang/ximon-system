// An error that carries the HTTP status to send back (400 bad input, 403 not allowed, 404, 409 conflict).
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
