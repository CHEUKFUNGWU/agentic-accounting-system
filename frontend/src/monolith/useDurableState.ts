import { useEffect, useRef, useState, type SetStateAction } from 'react';

// Keep editable cells responsive while their revisions are serialized by App.
// Reconcile to the server after the save queue drains, including on failure.
export function useDurableState<T>(saved: T, onSave: (value: T) => void, saving: boolean) {
  const [value, setValue] = useState(saved);
  const current = useRef(saved);
  useEffect(() => {
    if (!saving) {
      current.current = saved;
      setValue(saved);
    }
  }, [saved, saving]);
  const update = (change: SetStateAction<T>) => {
    const next = typeof change === 'function' ? (change as (previous: T) => T)(current.current) : change;
    current.current = next;
    setValue(next);
    onSave(next);
  };
  return [value, update] as const;
}
