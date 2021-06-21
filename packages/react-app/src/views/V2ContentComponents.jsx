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


export function RulesButton() {
  const markdown = `
## Pool Rules
- Each token has one independent pool. i.e. all accounting is separate for each token.
- There is no pool creation process - one contract holds all pools.
- Depositor commits for a "commitment period", after which the deposit 
can be withdrawn with any bonus share.
- The bonus pool share is equal to the share of the deposit from all deposits
at the time of withdrawal. E.g. if when you withdraw, the bonus pool is 2 Token, 
total deposits are 10 Token, and your deposit is 1 Token - you get 
0.2 Token ( = 2 * (1 / 10)) as bonus.
- Bonus pool is collected from penalties paid by early withdrawals 
(withdrawals before the commitment period).
- Withdrawal before commitment period does not get any bonus. 
Instead, it is "slashed" with a penalty (that is added to the bonus pool).  
- The penalty percent is decreasing linearly with time from 
"initialPenaltyPercent" to 0 (for the duration of the commitPeriod). 
E.g. if initialPenaltyPercent was 10%, and you withdraw after half the 
commitment period, you get 5% penalty and withdraw 95% of the initial deposit.
- Any additional deposits are added to current deposit, and "reset" the
  commitment period required to wait.
- ERC20 tokens may have fee-on-transfer or dynamic supply mechanisms, and for these
kinds of tokens this pool tracks everything as "shares of initial deposits".`;

  return <MarkdownModalButton
    markdown={markdown}
    title={<div><InfoCircleTwoTone /> Rules</div>} />;
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
        size="large"
        style={{ fontSize: 16 }}
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
