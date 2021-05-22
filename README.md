[Token Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L5) \
[Staking Rewards Deployer Params](https://github.com/ribbon-finance/token/blob/18883f75335af47844f64c13744bdcf95445f6db/params.js#L16)


Testing Contracts

* `npx hardhat test`

Deploying Ribbon token to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* `npx hardhat run scripts/deploy.js --network mainnet`

Deploying Ribbon staking rewards to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* `npx hardhat run scripts/deploy-stakingrewards.js --network mainnet`

Deploying Merkle Airdrop to Mainnet ([reference](https://hardhat.org/tutorial/deploying-to-a-live-network.html))

* add mainnet url / accounts in hardhat.config.js
* add owner address to params.js under AIRDROP_PARAMS object
* add token address to params.js under AIRDROP_PARAMS object
* add merkle root to params.js under AIRDROP_PARAMS object
  * `node scripts/generate-recipients-json.js -b <BLOCKNUM> -f <FILEPATH>` 
      * ex: `node scripts/generate-recipients-json.js -b 12378107 -f airdrop.json`
      * This will generate the address -> balance mapping of all relevant users 
        from hegic, opyn, charm, primitive, ribbon strangle, ribbon theta vault
      * _NOTE:_ this will take a few minutes (~10m) the first time around, but afterwards will be quicker as 
        block info is cached
  * `npx ts-node scripts/generate-merkle-root.ts -i <FILEPATH> -n <NEW_FILEPATH>` where FILEPATH is path from above step. 
      * This will give you the **merkle root** itself for the params.js file 
         and full details for the merkle proof is written to NEW_FILEPATH
  * To verify the merkle root from previous step is correct:
    * `npx ts-node scripts/verify-merkle-root.ts -i <FILEPATH>` where FILEPATH is NEW_FILEPATH from above step. 
       *  This will give you the **merkle root** itself for the params.js file 
          and full details for the merkle proof is written to NEW_FILEPATH
* add days until unlock for owner to params.js under AIRDROP_PARAMS object
* `npx hardhat run scripts/deploy-merkle-distributor.js --network mainnet`

Airdrop Recipient Reward Methodology:

* 4M $RBN split equally between:
    * **only current** HEGIC LPs (ETH & WBTC pools)
    * PRIMITIVE LPs
    * OPYN, CHARM option writers of options that expire in 2021
    * _NOTE:_ cumulative LP position or option collateral must be **at least** $50 with current prices
* 500K $RBN split equally between:
    * ribbon strangle buyers
    * _NOTE:_ cumulative strangle premium must be **at least** $50 with current prices
* 10.5M $RBN split equally between:
    * ETH/WBTC CAll/PUT depositors
    * _NOTE:_ cumulative deposit value across all vaults must be **at least** $100 with current prices
* 10M $RBN split among current depositors _pro rata_ after being normalized with Box Cox transformation between:
    * ETH/WBTC CAll/PUT depositors
    * _NOTE:_ cumulative deposit value across all vaults must be **at least** $100 with current prices
* 4M $RBN split equally between the Discord users that sent more than 5 messages, and selected the Ribbon Hat option ([see hat.txt](https://github.com/ribbon-finance/token/blob/main/discord-users/hat.txt))
* 1M $RBN split equally between the Discord users that sent more than 5 messages, and selected the small airdrop option ([see non-hat.txt](https://github.com/ribbon-finance/token/blob/main/discord-users/non-hat.txt))
