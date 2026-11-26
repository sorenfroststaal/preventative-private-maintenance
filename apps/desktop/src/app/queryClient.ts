/**
 * The app's QueryClient with shared error handling: a failed load or a failed save that the
 * component does not handle itself is reported as an error toast (review D1), so a failed query
 * never just looks like an empty list.
 */
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { errorText } from "./session";

type Listener = (text: string) => void;
const listeners = new Set<Listener>();
let last = { text: "", at: 0 };

/** Shows an error message (the Shell turns it into a toast). The same text is shown once per 3 s. */
export function reportError(text: string): void {
  const now = Date.now();
  if (text === last.text && now - last.at < 3000) return;
  last = { text, at: now };
  for (const l of listeners) l(text);
}

export function onReportedError(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
    queryCache: new QueryCache({
      onError: (e) => reportError(`Kunne ikke hente data: ${errorText(e)}`),
    }),
    mutationCache: new MutationCache({
      onError: (e, _vars, _ctx, mutation) => {
        if (!mutation.options.onError) reportError(`Kunne ikke gemme: ${errorText(e)}`);
      },
    }),
  });
}
