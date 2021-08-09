import React, { useState } from "react";
import { Button, Modal, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import { QuestionCircleTwoTone, InfoCircleTwoTone } from "@ant-design/icons";

export function MechanismButton() {
  const markdown = `
## Pool Mechanism
A depositor is committing for "commitment period" and an "initial penalty percent". **The
deposit can be withdrawn with its share of the bonuses after the commitment period**. 
#### 💰 Bonus mechanics: "Hold bonus" ⏳ & "Commit bonus" 🔏:
**Hold bonus** pool and **Commit bonus** pool for each asset 
**are populated from the penalties 🔨 for early withdrawals**. 
The penalties are split in half and added to each bonus pool.
- The share of the bonus pools is calculated from from the bonus points (**hold-points** 
  and **commit-points**) for the deposit at the time of withdrawal.
- **Hold points** are \`amount of asset\` x \`seconds held\` **at the time of withdrawal 📤**. 
  So **more tokens held for longer add more points**. **This bonus is
  not dependent on commitment or penalties**.
- **Commit points** are \`amount of asset committed to penalty\` x \`seconds committed to 
  penalty\` **at time of deposit 📥**. These points **depend only on commitment 
  time and commitment penalty**.
#### 🔨 Penalty mechanics:
- The **penalty percent is decreasing with time ⏳** from the chosen
  \`initialPenaltyPercent\` to 0 at the end of the \`commitPeriod\`. 
- **Withdrawal before commitment period is "slashed"🔪 with the penalty percent, 
  and gets NO bonus regardless of points**.
#### ✨ ERC721 NFT ✨ deposits - transferrable but immutable:
- Each deposit has a separate ERC721 tokenId with the usual transfer mechanics. So
  multiple deposits can co-exist independently for same owner and asset.
- Deposits can be on behalf of another account as beneficiary,
  so e.g. a team / DAO can deposit its tokens for its members to withdraw later.
- Only the deposit "owner"🔑 can use the withdrawal functionality, so ERC721 approvals 
  allow transfers, but not withdrawals.
#### Additional notes:
- Some ERC20 tokens may have fee-on-transfer or dynamic supply mechanisms, and for these
  kinds of tokens this pool tracks everything as "shares of initial deposits".
- **Each asset** has **one independent pool**. i.e. all accounting is separate for each asset.
- There is no pool creation process - one contract holds all pools.
`;

  return <MarkdownModalButton
    markdown={markdown}
    title={<div><InfoCircleTwoTone /> Contract rules </div>} />;
}

export function IncentivesButton() {
  const markdown = `
## Incentives allignment for longer holding 💎✊⏳.
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
        size="large"
        shape="round"
        style={{ fontSize: 20, width: "100%" }}
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
