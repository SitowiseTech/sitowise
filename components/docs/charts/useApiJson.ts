"use client";

import {useEffect, useState} from "react";

/**
 * One GET against the public API, for the charts in the docs.
 *
 * These pages are read by people who may be looking at the API before it has
 * ever returned a row, so a failed or empty response is a normal outcome and
 * gets reported as "no data", never as a crashed component. The error envelope
 * is `{ error: string }`, as documented on /docs/api/errors.
 */

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  /** Human readable; safe to render. Null while the request is in flight. */
  error: string | null;
};

const IDLE: ApiState<never> = {data: null, loading: false, error: null};

export function useApiJson<T>(url: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>(IDLE);

  useEffect(() => {
    if (!url) {
      setState(IDLE);
      return;
    }

    const controller = new AbortController();
    setState({data: null, loading: true, error: null});

    fetch(url, {signal: controller.signal, headers: {accept: "application/json"}})
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body && typeof body === "object" && "error" in body
              ? String((body as {error: unknown}).error)
              : `Request failed with status ${response.status}`;
          throw new Error(message);
        }
        return body as T;
      })
      .then((data) => setState({data, loading: false, error: null}))
      .catch((err: unknown) => {
        // An aborted request is a navigation, not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Request failed",
        });
      });

    return () => controller.abort();
  }, [url]);

  return state;
}
