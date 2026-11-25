"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Calls `onChange` whenever the floor changes.
 *
 * Listens to the Server-Sent Events stream; if it cannot be opened, or keeps
 * failing, falls back to polling /revision every three seconds so a board
 * behind a hostile proxy still updates.
 */
export function useLiveRevision(onChange: () => void) {
  const [polling, setPolling] = useState(false);
  const last = useRef<string | undefined>(undefined);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);

  // Only touches refs, so one stable function serves every effect below.
  const [seen] = useState(() => (rev: string) => {
    if (rev !== last.current) {
      // The first value is the baseline; the board has just loaded anyway.
      const first = last.current === undefined;
      last.current = rev;
      if (!first) cb.current();
    }
  });

  useEffect(() => {
    let failures = 0;
    const es = new EventSource("/api/staff/live/stream");
    es.addEventListener("rev", (e) => {
      failures = 0;
      seen((e as MessageEvent<string>).data);
    });
    es.onerror = () => {
      // EventSource retries by itself; give up on it after repeated failures.
      if (++failures >= 3) {
        es.close();
        setPolling(true);
      }
    };
    return () => es.close();
  }, [seen]);

  const { data } = useSWR<{ rev: string | number }>(
    polling ? "/api/staff/live/revision" : null,
    fetcher,
    { refreshInterval: 3000 },
  );
  useEffect(() => {
    if (data?.rev !== undefined) seen(String(data.rev));
  }, [data, seen]);
}
