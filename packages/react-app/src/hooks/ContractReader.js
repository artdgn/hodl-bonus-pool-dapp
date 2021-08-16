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

export default function useContractReader(contracts, functionName, args, pollTime, onChange, onError) {
  let adjustPollTime = 0;
  if (pollTime) {
    adjustPollTime = pollTime;
  }

  const [value, setValue] = useState();
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (typeof onChange === "function") {
      setTimeout(onChange.bind(this, value), 1);
    }
  }, [value, onChange]);

  const updateValue = async () => {
    try {
      let newValue;
      if (args && args.length > 0) {
        newValue = await contract[functionName](...args);
        setTried(true);
      } else {
        newValue = await contract[functionName]();
        setTried(true);
      }
      // console.log("GOT VALUE",newValue)
      if (newValue !== value) {
        setValue(newValue);
      }
    } catch (e) {
      console.log(e);
      if (typeof onError === "function") onError()
    }
  };

  // Only pass a provider to watch on a block if we have a contract and no PollTime
  useOnBlock(contract && adjustPollTime === 0 && contract.provider, () => {
    if (contract && adjustPollTime === 0) {
      updateValue();
    };
  });

  // Use a poller if a pollTime is provided
  usePoller(
    async () => {
      if (contracts && contracts[contractName] && adjustPollTime > 0) {
        if (DEBUG) console.log("polling!", contractName, functionName);
        updateValue();
      }
    },
    adjustPollTime,
    contracts && contracts[contractName],
  );

  if (tried === false && contract) {
    updateValue();
  }

  return value;
}
