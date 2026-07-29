import { useEffect, useState } from 'react';
import { checkAiAvailable } from '../api/ai';

// Probed once per tab, then shared. Every AI control checks this first so a
// deployment without an API key looks exactly like a build without the feature.
let cached: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

export function useAiAvailable(): boolean {
  const [available, setAvailable] = useState(cached ?? false);

  useEffect(() => {
    if (cached !== null) {
      setAvailable(cached);
      return;
    }
    let active = true;
    inFlight = inFlight ?? checkAiAvailable();
    void inFlight.then((result) => {
      cached = result;
      inFlight = null;
      if (active) setAvailable(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return available;
}

export default useAiAvailable;
