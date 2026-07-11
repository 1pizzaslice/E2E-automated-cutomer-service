/** A scrollable, pretty-printed JSON value — used for the arbitrary-shaped
 * evidence payloads (retrieved context, guardrails, tool I/O). */
export function JsonBlock({ value }: { readonly value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>;
}
