import { useState, useEffect, useCallback } from "react";
import useOnBlock from "./OnBlock";

/*
  The latest block timestamp

*/

export function useBlockTimestamp(provider, address, pollTime = 0) {
  const [timestamp, setTimestamp] = useState();

  const getTimestamp = useCallback(
    async (provider) => {
      if (provider) {
        const newTimestamp = (await provider.getBlock()).timestamp;
        if (newTimestamp !== timestamp) {
          setTimestamp(newTimestamp);
        }
      }
    },
    // eslint-disable-next-line
    [provider, timestamp],
  );

  // do once always on mount
  useEffect(() => {
    if (provider) {
      getTimestamp(provider);
    }
  // eslint-disable-next-line
  }, [provider]);

  // Only pass a provider to watch on a block if there is no pollTime
  useOnBlock(pollTime === 0 && provider, () => {
    if (provider) {
      getTimestamp(provider);
    }
  });

  return timestamp;
}
