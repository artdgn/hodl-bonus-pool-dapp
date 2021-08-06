import React, { useState } from "react";
import {
  Button, Modal, Typography, Tooltip, Divider
} from "antd";
import ReactMarkdown from "react-markdown";
import { QuestionCircleTwoTone, InfoCircleTwoTone, 
  WarningTwoTone, DollarTwoTone } from "@ant-design/icons";


export function CommitTimeTooltip({ contractState }) {
  const minPeriodSec = contractState?.minCommitPeriod?.toNumber();
  return (
    <Tooltip title={
      <div>
        <b>Length of time before which withdrawing will only be possible with a penalty.</b>
        <ul>
          <li><b>Commit for longer to receive higher share of the bonus!</b></li>
          <li>Withdrawing with bonus will only be possible after this time.</li>
          <li>The minimum value allowed: {minPeriodSec} seconds (roughly {
            (minPeriodSec / 86400).toPrecision(2)
          } days).</li>
          <li>The maximum value allowed: four years.</li>
        </ul>
      </div>
    }>
      <InfoCircleTwoTone />
    </Tooltip>
  );
}

export function PenaltyTooltip({ contractState }) {
  return (
    <Tooltip title={
      <div>
        <b>Starting value of the penalty percent</b>.
        <ul>
          <li><b>Commit to higher penalty to receive higher share of the bonus!</b></li>
          <li><b>The penalty decreases with time from the initial value to 0. </b>
            So immediately after deposit it's roughly this initial percent,
            and just before the end of the commitment period it's roughly 0.
          </li>
          <li>The minimum value allowed: {contractState?.minInitialPenaltyPercent?.toNumber()}%.</li>
          <li>The maximum value allowed: 100%.</li>
        </ul>
      </div>
    }>
      <InfoCircleTwoTone />
    </Tooltip>);
}

export function DepositModalContent({contractState, period, penalty}) {
  return (
    <div>
      <h2>
        <DollarTwoTone twoToneColor="#52c41a" />&nbsp;
        Tip: Increasing commitment period and/or penalty percent will result higher share of bonus!
      </h2>
      <Divider />
      <h2>Chosen commitment period <CommitTimeTooltip contractState={contractState}/> : {
        contractState.secondsToCommitTimeString(period)
        }</h2>
      <h2>Chosen initial penalty <PenaltyTooltip contractState={contractState}/> : {penalty}%</h2>
      <Divider />      
      <h2>
        <WarningTwoTone twoToneColor="red" />&nbsp;
        Withdrawing without penalty before end of commitment period won't be possible!!
      </h2>
    </div>
  );
}


export function MechanismButton() {
  const markdown = `
## Pool Mechanism
A depositor is committing for "commitment period" and an "initial penalty percent" 
of his choice (within allowed ranges). **After the commitment period the
deposit can be withdrawn with its share of both of the bonus pools**. 
#### Bonus mechanics: "Hold bonus" & "Commit bonus":
The bonus share is determined from the deposit's size, initial commitment, and actual 
holding time relative to other deposits in the pool.
- The two **bonus pools are populated from the penalties for early withdrawals**,
  which are withdrawals before a deposit's commitment period is elapsed. 
  The penalties are split in half and added to both bonus pools (isolated per token): 
  **Hold bonus** pool and **Commit bonus** pool.
- The share of the bonus pools is equal to the share of the bonus points (**hold-points** 
  and **commit-points**) for the deposit at the time of withdrawal relative to the other
  deposits in the pool.
- **Hold points** are calculated as amount of token (or ETH) x seconds held. So **more tokens
  held for longer add more points** - and increase the bonus share. **This bonus is
  independent of commitment or penalties**. The points keep increasing after commitment period
  is over.
- **Commit points** are calculated as amount of token (or ETH) x seconds committed to penalty.
  These points **depend only on commitment time and commitment penalty** 
  at the time of the deposit.
#### Penalty mechanics:
- **Withdrawal before commitment period is not entitled to any part of the bonus**
  and is instead "slashed" with a penalty (that is split between the bonuses pools).
- The **penalty percent is decreasing with time** from the chosen
  initialPenaltyPercent to 0 at the end of the commitPeriod. 
#### Deposit is an NFT (transferrable but immutable):
- Each deposit has a separate ERC721 (NFT) tokenId with the usual transfer mechanics. So
  multiple deposits for same owner and asset but with different commitment
  parameters can co-exist independently.
- Deposits can be deposited for another account as beneficiary,
  so e.g. a team / DAO can deposit its tokens for its members to withdraw.
- Only the deposit "owner" can use the withdrawal functionality, so ERC721 approvals 
  allow transfers, but not the withdrawals.
#### Additional notes:
- Some ERC20 tokens may have fee-on-transfer or dynamic supply mechanisms, and for these
  kinds of tokens this pool tracks everything as "shares of initial deposits".
- **Each token** has **one independent pool**. i.e. all accounting is separate for each token.
- There is no pool creation process - one contract holds all pools.
`;

  return <MarkdownModalButton
    markdown={markdown}
    title={<div><InfoCircleTwoTone /> Contract rules </div>} />;
}

export function IncentivesButton() {
  const markdown = `
## Incentives considerations:
All incentives are aligned for longer holding.
- **Commit bonus** (future focused) - rewards committing for higher penalties and longer periods:
  - **Rewards proportionally to their risk (skin in the game)**.
  - Increases the potential bonus - making the pool more attractive.
- **Hold bonus** (past focused) - rewards holding regardless of initial commitment:
  - **Rewards depositors proportionally to their actual past opportunity cost** and reduction
  of tokens in circulation.
  - Even people who are unwilling to commit for a large penalty or period **can
  "earn" bonuses by depositing without withdrawing**.
  - Even after commitment period is over - **holding for longer increases
  the hold-bonus** share relative to future deposits.
  - More **"Whale" resistant** - new large deposits do no affect bonus share
  unless actually held in pool.
- No bonus with penalty: 
  - Incetivises finishing the commitment period.
  - Prevents early withdrawals if bonus is larger than penalty.
- Deferring bonus until withdrawal (no claiming during deposit):
  - Prevents claiming bonus too early and reducing incentive to hold.
  - Reduces bonus for other potential depositors
- Low minimal penalty / commitment period:
  - Allowing more loss-averse depositors to participate.
- Non-zero minimal penalty / commitment period:
  - Preventing no skin in the game situation.
`;

  return <MarkdownModalButton
    markdown={markdown}
    title={<div><InfoCircleTwoTone /> Incentives</div>} />;
}

export function MotivationButton() {
  const markdown = `
### 💡 The idea: "Strong 💎 hands" get a bonus from "weak 🧁 hands"'s penalties for early withdrawals.

### ❔ Why this may be a good idea:
1. **Price effects** - like "staking", but without the inflation:
    - Makes HODLing more attractive by providing a positive economic incentive 🤑. 
    - Raises the price by reducing amount in circulation 📥.
    - Builds trust in the asset by proving an amount commited to be held 💍.
1. **Social / network effects** - like "time lock", but with an incentive to participate:
    - Makes HODLing provable and shareable 🐦 .
    - Increases trust in the community's / project team's long term commitment, provides a social incentive to demonstrate "skin in the game" 🙋‍♀️ .
1. **Yield generating** - like AMMs LP or lending, but without AMM's impermanent loss and doesn't depend on borrowing demand:
    - Vs. liquidity providing in AMMs: no dependence on trading volume, no exposure to additional assets, no bleeding value to arbitrageurs (~~not-so~~""impermanent"" loss) 🩸.
    - Vs. lending: earns yield on tokens that don't have a borrowing market with high interest rates 🔄 (or any borrowing market).
1. **Volatility bonus** - market volatility causes higher bonuses:
    - Asset price "moons" 🥳 - more "weak hands" will withdraw early to take profits, increasing the bonus 💸.
    - Asset price "tanks" 😢 - more "weak hands" will withdraw early to panic-sell, increasing the bonus 💸.`;

  return <MarkdownModalButton
    markdown={markdown}
    title={<div><QuestionCircleTwoTone /> Motivation </div>} />;
}

function MarkdownModalButton({ title, markdown }) {
  const [drawerVisible, setDrawerVisible] = useState(false);

  return (
    <div>
      <Button
        onClick={() => setDrawerVisible(true)}
        size="small"
        style={{ fontSize: 12 }}
      >{title}</Button>

      <Modal
        onOk={() => setDrawerVisible(false)}
        onCancel={() => setDrawerVisible(false)}
        centered
        cancelText="Yep"
        okText="OK"
        visible={drawerVisible}>
        <Typography style={{ textAlign: "left" }}>
          <ReactMarkdown children={markdown} />
        </Typography>
      </Modal>
    </div>
  );
}
