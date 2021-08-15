/* eslint-disable jsx-a11y/accessible-emoji */

import { useState, useEffect } from "react";
import { notification} from "antd";
import { formatUnits } from "@ethersproject/units";
import { ethers } from "ethers";
import { useContractReader, useBlockTimestamp } from "../hooks";


export class HodlPoolV3StateHooks {

  constructor(contract, address, tokenAddress, provider) {
    this.contract = contract;
    this.address = contract?.address;
    this.tokenAddress = tokenAddress;
    this.WETHAddress = useContractReader(contract, "WETH", [], 86400 * 1000);
    this.minInitialPenaltyPercent = useContractReader(
      contract, "minInitialPenaltyPercent", [], 86400 * 1000);
    this.minCommitPeriod = useContractReader(
        contract, "minCommitPeriod", [], 86400 * 1000);
    this.blockTimestamp = useBlockTimestamp(provider);
    
    // all deposits view
    this.depositsOfOwner = useContractReader(
      address && contract, "depositsOfOwner", [address]);
    this.allTokenIds = this.depositsOfOwner?.tokenIds;
    this.depositParams = this.allTokenIds && Object.fromEntries(this.allTokenIds?.map(
      (v, ind) => [this.allTokenIds[ind], this.depositsOfOwner?.accountDeposits[ind]]));
    
    // filter only chosen asset
    this.poolTokenIds = this.allTokenIds && this.allTokenIds.filter(
      (tokenId) => this.depositParams[tokenId]?.asset === tokenAddress);
    
    // pool details view
    this.poolDetails = useContractReader(
      tokenAddress && contract, "poolDetails", [tokenAddress]);
    this.depositsSum = this.poolDetails && this.poolDetails[0]; 
    this.holdBonusesSum = this.poolDetails && this.poolDetails[1]; 
    this.commitBonusesSum = this.poolDetails && this.poolDetails[2]; 
    this.totalHoldPoints = this.poolDetails && this.poolDetails[3]; 
    this.totalCommitPoints = this.poolDetails && this.poolDetails[4]; 
    this.bonusesPool = this.holdBonusesSum?.add(this.commitBonusesSum);
  }

  getDepositDetails(tokenId) {
    const depositDetails = useContractReader(
      tokenId && this.contract, "depositDetails", [tokenId]);
    
    // basic details
    const details = {
      depositDetails: depositDetails,
      tokenId: tokenId,
      balance: depositDetails && depositDetails[2],
      timeLeft: depositDetails && depositDetails[3], 
      penalty: depositDetails && depositDetails[4], 
      holdBonus: depositDetails && depositDetails[5], 
      commitBonus: depositDetails && depositDetails[6], 
      holdPoints: depositDetails && depositDetails[7], 
      commitPoints: depositDetails && depositDetails[8], 
      initialPenaltyPercent: depositDetails && depositDetails[9], 
      currentPenaltyPercent: depositDetails && depositDetails[10], 
      commitPeriod: depositDetails && depositDetails[11],
    }

    // add derived data
    details.bonus = details.holdBonus?.add(details.commitBonus)

    // time convenience variables
    details.commitString = this.secondsToCommitTimeString(details.commitPeriod);
    details.timeLeftString = this.secondsToCommitTimeString(details.timeLeft);
    // withdrawal convenience variables
    details.withdrawWithPenalty = details.balance && details.penalty?.gt(0) ?
      parseFloat(details.balance.sub(details.penalty).toString()) : 0;
    details.withdrawWithBonus = details.bonus && details.balance && details.penalty?.eq(0) ?
      parseFloat(details.balance.add(details.bonus).toString()) : 0;
    return details;
  }

  depositDatetime(tokenId) {
    return this?.depositParams && this?.depositParams[tokenId]?.time ?
      (new Date(this?.depositParams[tokenId]?.time * 1000)) : null;
  }

  pointsToTokenDays(val, decimals) {
    return val && decimals && parseFloat(formatUnits(val.div(86400), decimals));
  }

  bigNumberSecondsToDays(sec, precision = 2) {
    return (parseFloat((sec || "0").toString()) / 86400).toPrecision(precision)
  }
  
  secondsToCommitTimeString(sec) {
    return `${(sec || "").toString()}s or ${this.bigNumberSecondsToDays(sec)} days`;
  }
}


export class ERC20StateHooks {

  constructor(contract, userAddress, spenderAddress, setLoading, setError) {
    const [prevAddress, setPrevAddress] = useState()
    const [failed, setFailed] = useState(false);

    this.contract = contract;
    this.address = contract?.address;

    const onFail = () => {
      setFailed(this.address);
      setLoading(true);
    }
    const onChange = () => {
      setFailed(false);
      setLoading(false);
    }

    this.symbol = useContractReader(
      contract, "symbol", [], 86400 * 1000, onChange, onFail);
    this.decimals = useContractReader(
      contract, "decimals", [], 86400 * 1000, null, onFail);
    this.name = useContractReader(
      contract, "name", [], 86400 * 1000, null, onFail);
    this.balance = useContractReader(
      contract, "balanceOf", [userAddress], 0, null, onFail);
    this.allowance = useContractReader(
      contract, "allowance", [userAddress, spenderAddress], 0, null, onFail);

    // notify of failure
    useEffect(() => {
      if (this.address && failed) {
        notification.error({
          message: 'Failed to read ERC20 contract',
          description: `${failed} is not a valid ERC20 contract address`,
        });
        setError(`${failed} is not a valid ERC20 contract address, select another token.`);
      }
      setPrevAddress(this.address);
    }, [failed, this.address])

    // notify of address change
    useEffect(() => {
      if (this.address && prevAddress && prevAddress !== this.address) {
        setLoading(false);
        setError("");
        notification.success({
          message: 'Switched token contract',
          description: `From ${prevAddress} to ${this.address}`,
        });
      }
    }, [this.address, prevAddress])
  }
}

export function useERC20ContractAtAddress(address, provider) {
  const [contract, setContract] = useState();

  useEffect(() => {
    let isMounted = true;

    const erc20Abi = [
      "function balanceOf(address owner) view returns (uint256)",
      "function symbol() view returns (string)",
      "function name() view returns (string)",
      "function decimals() view returns (uint8)",
      "function approve(address _spender, uint256 _value) public returns (bool success)",
      "function allowance(address _owner, address _spender) public view returns (uint256 remaining)"
    ];

    const readContract = async () => {
      if (isMounted) {
        if (address && provider) {
          const contract = new ethers.Contract(address, erc20Abi, provider, provider.getSigner());
          setContract(contract);
        } else {
          setContract(null);
        }
      };
    }

    readContract();
    
    return () => { isMounted = false };
  }, [address, provider]);

  return contract;
}