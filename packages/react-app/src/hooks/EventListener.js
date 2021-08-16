import { useEffect, useState } from "react";

/*
  ~ What it does? ~

  Enables you to keep track of events

  ~ How can I use? ~

  const setPurposeEvents = useEventListener(readContracts, "YourContract", "SetPurpose", localProvider, 1);

  ~ Features ~

  - Provide readContracts by loading contracts (see more on ContractLoader.js)
  - Specify the name of the contract, in this case it is "YourContract"
  - Specify the name of the event in the contract, in this case we keep track of "SetPurpose" event
  - Specify the provider
*/

export default function useEventListener(contract, eventName, provider, startBlock, filterArgs) {
  const [updates, setUpdates] = useState([]);

  filterArgs = filterArgs || [];

  useEffect(() => {
    // https://stackoverflow.com/questions/53949393/cant-perform-a-react-state-update-on-an-unmounted-component
    let isMounted = true;

    if (typeof provider !== "undefined" && typeof startBlock !== "undefined") {
      // if you want to read _all_ events from your contracts, set this to the block number it is deployed
      provider.resetEventsBlock(startBlock);
    }
    if (contract) {
      try {
        const eventFilter = contract.filters[eventName](...filterArgs);
        contract.on(eventFilter, (...args) => {
          let blockNumber = args[args.length - 1].blockNumber
          let newMessage = Object.assign({ blockNumber, eventName }, args.pop().args)
          if (isMounted) setUpdates(messages => [...new Set([newMessage, ...messages])]);
        });
        return () => {
          isMounted = false;
          contract.removeListener(eventName);
        };
      } catch (e) {
        console.log(e);
      }

      return () => { isMounted = false };
    }
  // eslint-disable-next-line
  }, [provider, startBlock, contract, eventName, ...filterArgs]);

  return updates;
}
