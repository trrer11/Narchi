// Narchi — reactive localStorage hook.
// State that persists and automatically syncs across tabs/windows,
// so multiple users (owner + architects) stay consistent in real time.

import { useCallback, useEffect, useRef, useState } from "react";
import { storage } from "./localStore";

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => storage.get(key, initial));
  const keyRef = useRef(key);
  keyRef.current = key;

  // write on change
  const update = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === "function" ? (value as (p: T) => T)(prev) : value;
        storage.set(keyRef.current, next);
        // tick so same-tab listeners detect the change
        try {
          localStorage.setItem("narchi:__tick", String(Date.now()));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    []
  );

  // sync across tabs and detect same-tab mutations via a poll tick
  useEffect(() => {
    const onChange = () => setState(storage.get(keyRef.current, initial));
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === `narchi:${keyRef.current}` || e.key === "narchi:__tick") onChange();
    };
    window.addEventListener("storage", onStorage);
    const iv = window.setInterval(onChange, 1500);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [state, update];
}
