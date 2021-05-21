import { useEffect, useState } from "react";
import useOnBlock from "./OnBlock";
import usePoller from "./Poller";

/*
  ~ What it does? ~

  Enables you to read values from contracts and keep track of them in the local React states

  ~ How can I use? ~

  const purpose = useContractReader(readContracts,"YourContract", "purpose")

  ~ Features ~

  - Provide readContracts by loading contracts (see more on ContractLoader.js)
  - Specify the name of the contract, in this case it is "YourContract"
  - Specify the name of the variable in the contract, in this case we keep track of "purpose" variable
  - Pass an args array if the function requires
  - Pass pollTime - if no pollTime is specified, the function will update on every new block
*/

const DEBUG = true;

export default function useContractReader(contract, functionName, args, pollTime, formatter, onChange) {
  let adjustPollTime = 0;
  if (pollTime) {
    adjustPollTime = pollTime;
  } 

  args = args || [];

  const [value, setValue] = useState();
  useEffect(() => {
    if (typeof onChange === "function") {
      setTimeout(onChange.bind(this, value), 1);
    }
  }, [value, onChange]);

  const updateValue = async () => {
    try {
      let newValue;
      if (DEBUG) console.log("CALLING ", functionName, "with args", args);
      if (args && args.length > 0) {
        newValue = await contract[functionName](...args);
        if (DEBUG)
          console.log("functionName", functionName, "args", args, "RESULT:", newValue);
      } else {
        newValue = await contract[functionName]();
      }
      if (formatter && typeof formatter === "function") {
        newValue = formatter(newValue);
      }
      // console.log("GOT VALUE",newValue)
      if (newValue !== value) {
        setValue(newValue);
      }
    } catch (e) {
      console.log(e);
    }
  };

  // do once always on mount if not polling
  useEffect(() => {
    if (contract && adjustPollTime === 0) updateValue()
    // eslint-disable-next-line
  }, [contract, functionName, ...args]);

  // Only pass a provider to watch on a block if we have a contract and no PollTime
  useOnBlock(contract && adjustPollTime === 0 && contract.provider, () => {
    if (contract && adjustPollTime === 0) {
      updateValue();
    }
  });

  // Use a poller if a pollTime is provided
  usePoller(
    async () => {
      if (contract && adjustPollTime > 0) {
        if (DEBUG) console.log("polling!", functionName);
        updateValue();
      }
    },
    adjustPollTime,
    contract,
  );

  return value;
}