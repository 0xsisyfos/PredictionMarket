
# Building a dApp on Linea

In this guide, we’ll build a decentralized application (dApp) on Linea, an Ethereum Layer 2 solution using zero-knowledge proofs. We’ll create a simple prediction market. By the end, you will learn:

- The fundamentals of zkEVMs and Linea
- How to build a prediction market dApp using an oracle like API3
- How to deploy Solidity smart-contracts on Linea Sepolia using Atlas.
- **Bonus**: How to build a front-end using MetaMask for your dApp

### You will need:

- Basic knowledge of Solidity
- Sepolia ETH on Linea Sepolia Testnet. If you have an Infura acccount, get some [here](https://www.infura.io/faucet/linea)
- [MetaMask](https://metamask.io/) browser extension installed
- (Optional) Basic Knowledge of JavaScript/HTML and [Node.js](https://nodejs.org/en/download/package-manager) or [Python](https://www.python.org/downloads/macos/) installed

## Primer on zkEVMs

zkEVMs (Zero-Knowledge Ethereum Virtual Machines) are scaling solutions that aim to improve Ethereum's transaction speed and reduce costs. They do so by moving the computation and execution of EVM transactions off-chain while verifying their validity on-chain using zero-knowledge proofs. Read more about their powerful properties on [Vitalik's blog](https://vitalik.eth.limo/general/2021/01/05/rollup.html).

We can distinguish at least four types of zkEVMs by the trade-offs they make between optimizing for performance (speed and cost) or compatibility with the EVM. See the chart below from Vitalik's blog.

<div align="center">
  <a href="https://vitalik.eth.limo/general/2022/08/04/zkevm.html">
    <img src="https://vitalik.eth.limo/images/zkevm/chart.png" alt="Types of zkEVM from by Vitalik" width="50%">
  </a>
</div>

For this guide, we will build on Linea. It is a Type 2 zkEVM, which means developers can write, test, compile, deploy, and verify smart contracts using traditional Ethereum tooling (e.g., Hardhat, Foundry, Remix, or Atlas). There are minor differences, which you can find in the [Linea Docs](https://docs.linea.build/developers/quickstart/ethereum-differences).

## Creating a prediction market in Solidity

A prediction market is a type of decentralized application where users can bet on the likelihood of future events. When enough people participate, they can be considered as “social epistemic tools,” in so far that prices in these markets reflect the consensus on the likelihood of specific outcomes, such as election results.

<div align="center">
  <a href="https://x.com/VitalikButerin/status/1827640377060233716?ref_src=twsrc%5Etfw">
    <img src="https://i.postimg.cc/VvdYk8KY/Screenshot-2024-09-08-at-12-43-36.png" alt="Screenshot-2024-09-08-at-12-43-36.png" width="50%">
  </a>
</div>

We will build a simple prediction market for the price of Ethereum in Solidity. To retrieve the price of Ethereum, we will use an oracle (API3), which allows the blockchain network to get information about the real world - in our case - ETH price in USD.

### 1. Open/Close Betting Period

The contract allows users to bet on whether Ethereum’s price will go up or down in the next 24h. It uses the modifier `OnlyDuringBettingPeriod()` and functions `startBettingPeriod()` and `closeBettingPeriod()` to control when to open/close the ETH prediction market and to only allow bets during that time.

    modifier onlyDuringBettingPeriod() {
        require(block.timestamp < startTime + 5 minutes, "Betting period over");
        _;
    }

    function startBettingPeriod() external {
        startTime = block.timestamp;
        startPrice = getLatestPrice();
    }

    function closeBettingPeriod() external {
        require(block.timestamp >= startTime + 5 minutes, "Betting period not over");
        endPrice = getLatestPrice();

        bool priceIncreased = endPrice > startPrice;
        emit BetResult(priceIncreased, endPrice);

        distributeWinnings(priceIncreased);
    }

### 2. Fetching Ethereum Price
 
 The price feed is obtained using API3, an oracle that provides real-world data to blockchain networks. The `getLatestPrice()` function retrieves the latest ETH/USD price from API3's price feed. You can find different oracles on the [Linea docs](https://docs.linea.build/developers/tooling/oracles).

    function getLatestPrice() public view returns (int224) {
        (int224 price,) = priceFeed.read();
        require(price > 0, "Failed to retrieve price");
        return price;
    }

### 3. Placing Bets

Users can place bets on whether the Ethereum price will go up or down during the betting period. The contract records each bet with its direction (up or down) and amount wagered.

    function placeBet(BetDirection _direction) external payable onlyDuringBettingPeriod {
        require(msg.value > 0, "You must bet some ETH");
        bets.push(Bet(msg.sender, _direction, msg.value, false));
        emit BetPlaced(msg.sender, _direction, msg.value);
    }

### 4. Distributing Winnings

After the betting period closes, the contract determines which bets were correct and allocates the winnings. It checks whether the bet direction matches the outcome (up or down) and whether the bet has already been claimed. If a user’s bet matches the result, they receive twice the amount wagered. Winners can withdraw their earnings after the betting period. The contract checks the user’s balance of winnings and transfers the amount to them.

    function distributeWinnings(bool priceIncreased) internal {
        for (uint256 i = 0; i < bets.length; i++) {
            Bet storage bet = bets[i];
            if (
                !bet.claimed
                    && (
                        priceIncreased && bet.direction == BetDirection.Up
                            || !priceIncreased && bet.direction == BetDirection.Down
                    )
            ) {
                pendingWithdrawals[bet.better] += bet.amount * 2;
            }
            bet.claimed = true;
        }
    }

    function withdrawWinnings() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No winnings to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        payable(msg.sender).transfer(amount);
    }

    receive() external payable {}

### Full-code:

    // SPDX-License-Identifier: MIT
    pragma solidity ^0.8.0;

    import "@api3/contracts/api3-server-v1/proxies/interfaces/IProxy.sol";

    contract EthereumPriceBetting {
        IProxy internal priceFeed;

        enum BetDirection {
            Up,
            Down
        }

        struct Bet {
            address better;
            BetDirection direction;
            uint256 amount;
            bool claimed;
        }

        uint256 public startTime;
        int224 public startPrice;
        int224 public endPrice;

        Bet[] public bets;
        mapping(address => uint256) public pendingWithdrawals;

        event BetPlaced(address indexed better, BetDirection direction, uint256 amount);
        event BetResult(bool priceIncreased, int224 endPrice);

        // API3 proxy address for Ethereum/USD price feed
        address public constant priceFeedAddress = 0xa47Fd122b11CdD7aad7c3e8B740FB91D83Ce43D1;

        constructor() {
            priceFeed = IProxy(priceFeedAddress);
        }

        // The betting period now lasts for only 5 minutes (300 seconds)
        modifier onlyDuringBettingPeriod() {
            require(block.timestamp < startTime + 24 hours, "Betting period over");
            _;
        }

        function startBettingPeriod() external {
            startTime = block.timestamp;
            startPrice = getLatestPrice();
        }

        function closeBettingPeriod() external {
            require(block.timestamp >= startTime + 24 hours, "Betting period not over");
            endPrice = getLatestPrice();

            bool priceIncreased = endPrice > startPrice;
            emit BetResult(priceIncreased, endPrice);

            distributeWinnings(priceIncreased);
        }

        function getLatestPrice() public view returns (int224) {
            (int224 price,) = priceFeed.read(); // Using API3's `read()` function
            require(price > 0, "Failed to retrieve price");
            return price;
        }

        function placeBet(BetDirection _direction) external payable onlyDuringBettingPeriod {
            require(msg.value > 0, "You must bet some ETH");
            bets.push(Bet(msg.sender, _direction, msg.value, false));
            emit BetPlaced(msg.sender, _direction, msg.value);
        }

        function distributeWinnings(bool priceIncreased) internal {
            for (uint256 i = 0; i < bets.length; i++) {
                Bet storage bet = bets[i];
                if (
                    !bet.claimed
                        && (
                            priceIncreased && bet.direction == BetDirection.Up
                                || !priceIncreased && bet.direction == BetDirection.Down
                        )
                ) {
                    pendingWithdrawals[bet.better] += bet.amount * 2;
                }
                bet.claimed = true;
            }
        }

        function withdrawWinnings() external {
            uint256 amount = pendingWithdrawals[msg.sender];
            require(amount > 0, "No winnings to withdraw");
            pendingWithdrawals[msg.sender] = 0;
            payable(msg.sender).transfer(amount);
        }

        receive() external payable {}
    }

## Deploying on Linea Sepolia testnet

To deploy this contract, we will use Atlas, which is a recent user-friendly IDE. Follow these steps:

1. Go to [https://app.atlaszk.com/ide](https://app.atlaszk.com/ide)
2. In the **Contracts** section, create a new Solidity file called `EthereumPriceBetting.sol` and paste the full code.
3. Select “Linea Sepolia” as the network, connect your MetaMask wallet, and switch to the Linea Sepolia Testnet when prompted.
4. Click on **Deploy**. Confirm the transaction in MetaMask to deploy the contract.

[![Screenshot-2024-09-08-at-12-34-17.png](https://i.postimg.cc/mrTDQKds/Screenshot-2024-09-08-at-12-34-17.png)](https://postimg.cc/gxBmptFS)

Once deployed, you will see the contract details (address, ABI, bytecode) in the **Deployed Contracts** section. You can now interact with the contract to open/close the betting period, place bets, and withdraw winnings.

Congratulations, you have just deployed your very first dApp on Linea Sepolia Testnet!

## (Optional) Building a front-end

 We can build a front-end that connects to a MetaMask wallet to interact with the dApp. The `index.html` provided in this repo contains a simple interface with buttons, `style.css` a basic CSS styling, and `App.js`a JavaScript code (with ethers.js) to manage the logic between the interface, the MetaMask wallet, and Linea Sepolia Testnet (see below).

### A. Key functions

`App.js` handles the key functions to manage MetaMask wallet connection/disconnection and network switching to **Linea Sepolia**. It imports **ethers.js** for interacting with the Ethereum blockchain.

**1. loadContractAbi**

This function loads the ABI (Application Binary Interface) of the deployed contract, which is necessary for interacting with the contract on the Ethereum network.

```javascript
async function loadContractAbi() {
    try {
        const response = await fetch('contract_abi.json');
        return await response.json();
    } catch (error) {
        updateTransactionStatus('Failed to load contract ABI. Please refresh the page.');
    }
}
```

**2. connectMetaMask**

This function connects the dApp to the MetaMask wallet, initializes the provider, signer, and manages network switching.

```javascript
async function connectMetaMask() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            provider = new ethers.providers.Web3Provider(window.ethereum);
            signer = provider.getSigner();
            await signer.getAddress();

            updateTransactionStatus('Connected to MetaMask!');
            updateConnectButton('Disconnect Wallet', disconnectWallet);

            // Check network and switch if needed
            const networkId = await window.ethereum.request({ method: 'eth_chainId' });
            if (networkId !== lineaSepoliaChainId) {
                await switchToLineaSepolia();
            } else {
                await initializeContract();
            }
        } catch (error) {
            updateTransactionStatus(`Failed to connect to MetaMask: ${error.message}`);
        }
    } else {
        updateTransactionStatus('MetaMask is not installed. Please install it to use this dApp.');
    }
}

```
**3. switchToLineaSepolia**

This function switches the wallet's network to Linea Sepolia


```javascript

async function switchToLineaSepolia() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: lineaSepoliaChainId }]
        });
        updateTransactionStatus('Switched to Linea Sepolia network.');

        // Reconnect the wallet if necessary
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
            await initializeContract();
        } else {
            await connectMetaMask();
        }
    } catch (switchError) {
        if (switchError.code === 4902) { // Chain not added
            await addLineaSepoliaNetwork();
        } else {
            updateTransactionStatus('Failed to switch to Linea Sepolia. Please switch manually in MetaMask.');
        }
    }
}


```
### B. Testing the front-end locally

Once you have deployed the dApp using Atlas:
- In the `App.js` file replace `CONTRACT_ADDRESS` with your freshly deployed dApp address
- Create a JSON file named `contract_abi.json` in the same directory as your `index.html`file

Note: in Atlas you can find both the contract address and ABI in the **Deployed Contracts** menu.

### Using Node.js
You can serve the HTML file locally using Node.js with the http-server or express module.

1. First, install http-server globally: ```npm install -g http-server```

2. Navigate to the directory where your index.html file is located: ```cd /path/to/your/directory```

3. Run the server:
```http-server```
4. Open a browser and go to http://localhost:8080 to view your app.

### Using Python
You can use Python's built-in http.server to serve the HTML file.

1. Navigate to the directory where your index.html file is located: ```cd /path/to/your/directory```

2. Start a simple HTTP server, for Python 3: ```python3 -m http.server 8000```

3. Open http://localhost:8000 in your browser to view your app.

You  can now play around the dApp, while using an intuitive front-end.

[![temp-Imagep-HMMUk.avif](https://i.postimg.cc/cLxkS0m2/temp-Imagep-HMMUk.avif)](https://postimg.cc/hfY18FN1)



