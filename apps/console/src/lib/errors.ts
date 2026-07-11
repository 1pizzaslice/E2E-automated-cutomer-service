import { ApiClientError } from "@support/api-client";

/** A human-facing message for a failed API call in a data view. */
export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403) {
      return "You do not have access to this resource.";
    }
    if (error.status === 404) {
      return "Not found — it may have been resolved already.";
    }
    if (error.status === 409) {
      return "This changed since you loaded it. Refresh and try again.";
    }
    return error.message;
  }

  return "Something went wrong talking to the API.";
}
