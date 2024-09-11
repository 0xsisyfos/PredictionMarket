const contractAddress = 'CONTRACT_ADDRESS';
const lineaSepoliaChainId = '0xe705';
let provider, signer, contract;

async function loadContractAbi() {
    try {
        const response = await fetch('contract_abi.json');
        return await response.json();
    } catch (error) {
        updateTransactionStatus('Failed to load contract ABI. Please refresh the page.');
    }
}

async function connectMetaMask() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            provider = new ethers.providers.Web3Provider(window.ethereum);
            signer = provider.getSigner();
            await signer.getAddress();

            updateTransactionStatus('Connected to MetaMask!');
            document.getElementById('connectButton').innerText = 'Disconnect Wallet';
            document.getElementById('connectButton').removeEventListener('click', connectMetaMask);
            document.getElementById('connectButton').addEventListener('click', disconnectWallet);

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


function disconnectWallet() {
provider = null;
signer = null;
contract = null;
document.getElementById('connectButton').innerText = 'Connect MetaMask';
document.getElementById('connectButton').removeEventListener('click', disconnectWallet);
document.getElementById('connectButton').addEventListener('click', connectMetaMask);
updateTransactionStatus('Disconnected from MetaMask.');
updateNetworkStatus();
document.getElementById('latestPrice').innerText = 'Latest Price: Not Connected';
document.getElementById('bettingStatus').innerText = 'Betting Status: Not Connected';
updateBettingButtons(false, false);
}

function updateConnectButton(text, clickHandler) {
    const connectButton = document.getElementById('connectButton');
    connectButton.innerText = text;
    connectButton.onclick = clickHandler;
}

async function switchToLineaSepolia() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: lineaSepoliaChainId }]
        });
        updateTransactionStatus('Switched to Linea Sepolia network.');

        // Check if the wallet is still connected and reconnect if necessary
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
            await initializeContract();
        } else {
            await connectMetaMask(); // Reconnect the wallet
        }
    } catch (switchError) {
        if (switchError.code === 4902) {
            try {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                        chainId: lineaSepoliaChainId,
                        chainName: 'Linea Sepolia',
                        nativeCurrency: { name: 'Linea Ether', symbol: 'ETH', decimals: 18 },
                        rpcUrls: ['https://linea-sepolia.infura.io/v3/'],
                        blockExplorerUrls: ['https://sepolia.lineascan.build/']
                    }]
                });
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: lineaSepoliaChainId }]
                });
                updateTransactionStatus('Added and switched to Linea Sepolia network.');

                // Check if the wallet is still connected and reconnect if necessary
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    await initializeContract();
                } else {
                    await connectMetaMask(); // Reconnect the wallet
                }
            } catch (addError) {
                updateTransactionStatus('Failed to add Linea Sepolia network. Please add it manually to your MetaMask.');
            }
        } else {
            updateTransactionStatus('Failed to switch to Linea Sepolia. Please switch manually in MetaMask.');
        }
    }
}



async function initializeContract() {
    try {
        const abi = await loadContractAbi();
        contract = new ethers.Contract(contractAddress, abi, signer);
        await updateNetworkStatus();
        await fetchLatestPrice();
        await loadBetHistory();
        await fetchBettingStatus();
    } catch (error) {
        updateTransactionStatus(`Failed to initialize contract: ${error.message}`);
    }
}

async function updateNetworkStatus() {
    const networkId = await window.ethereum.request({ method: 'eth_chainId' });
    const networkName = networkId === lineaSepoliaChainId ? 'Linea Sepolia' : 'Unknown Network';
    document.getElementById('networkStatus').innerText = `Network: ${networkName}`;
}

async function sendTransaction(txPromise, successMessage) {
    try {
        updateTransactionStatus('Preparing transaction...');
        const gasLimit = 300000;
        const txOptions = { gasLimit };
        updateTransactionStatus('Sending transaction...');
        const tx = await txPromise(txOptions);
        updateTransactionStatus('Transaction sent. Waiting for confirmation...');
        const receipt = await tx.wait();
        updateTransactionStatus(`${successMessage} Transaction hash: ${receipt.transactionHash}`);
        return receipt;
    } catch (error) {
        updateTransactionStatus(`Transaction failed: ${error.message}`);
        throw error;
    }
}

function updateTransactionStatus(message) {
    document.getElementById('transactionStatus').innerText = message;
}

async function openBetting() {
    try {
        const receipt = await sendTransaction((options) => contract.startBettingPeriod(options), 'Betting period opened!');
        if (receipt.status === 1) {
            document.getElementById('bettingStatus').innerText = 'Betting Status: Open';
            await fetchBettingStatus();
        } else {
            updateTransactionStatus('Failed to open betting after confirmation.');
        }
    } catch (error) {
        updateTransactionStatus(`Failed to open betting period: ${error.message}`);
    }
}

async function closeBetting() {
    try {
        const receipt = await sendTransaction((options) => contract.closeBettingPeriod(options), 'Betting period closed!');
        if (receipt.status === 1) {
            document.getElementById('bettingStatus').innerText = 'Betting Status: Closed';
            await fetchBettingStatus();
            updateTransactionStatus('Betting has been successfully closed.');
        } else {
            updateTransactionStatus('Failed to close betting after confirmation.');
        }
    } catch (error) {
        updateTransactionStatus(`Failed to close betting period: ${error.message}`);
    }
}

async function placeBet(direction) {
    const betAmountEth = document.getElementById('betAmount').value;
    if (!betAmountEth) {
        updateTransactionStatus('Please enter a bet amount.');
        return;
    }
    const betAmountWei = ethers.utils.parseEther(betAmountEth);
    try {
        const receipt = await sendTransaction(
            (options) => contract.placeBet(direction, { ...options, value: betAmountWei }),
            'Bet placed successfully!'
        );
        if (receipt.status === 1) {
            const address = await signer.getAddress();
            const timestamp = await getBlockTimestamp(receipt.blockNumber);
            const time = new Date(timestamp * 1000).toLocaleString();
            addBetToTable(direction === 1 ? 'UP' : 'DOWN', betAmountEth, time, address);
        } else {
            updateTransactionStatus('Transaction failed after confirmation.');
        }
    } catch (error) {
        updateTransactionStatus(`Failed to place bet: ${error.message}`);
    }
}

async function loadBetHistory() {
    try {
        const bettingStartTime = await contract.startTime();
        if (!bettingStartTime || bettingStartTime.toString() === "0") {
            updateTransactionStatus('No betting period found.');
            return;
        }
        const filter = contract.filters.BetPlaced();
        const events = await contract.queryFilter(filter);
        const tableBody = document.getElementById('betsTable').getElementsByTagName('tbody')[0];
        tableBody.innerHTML = '';
        for (const event of events) {
            const timestamp = await getBlockTimestamp(event.blockNumber);
            if (timestamp >= bettingStartTime) {
                const { direction, amount, better } = event.args;
                const time = new Date(timestamp * 1000).toLocaleString();
                const amountEth = ethers.utils.formatEther(amount);
                addBetToTable(direction === 1 ? 'UP' : 'DOWN', amountEth, time, better);
            }
        }
    } catch (error) {
        console.error("Error fetching bet history:", error);
        updateTransactionStatus("Failed to load bet history.");
    }
}

function addBetToTable(direction, amount, time, address) {
    const table = document.getElementById('betsTable').getElementsByTagName('tbody')[0];
    const row = table.insertRow();
    row.insertCell(0).innerText = direction;
    row.insertCell(1).innerText = amount;
    row.insertCell(2).innerText = time;
    row.insertCell(3).innerText = address;
}

async function getBlockTimestamp(blockNumber) {
    try {
        const block = await provider.getBlock(blockNumber);
        return block.timestamp;
    } catch (error) {
        console.error('Error fetching block timestamp:', error);
    }
}

async function withdrawWinnings() {
    await sendTransaction((options) => contract.withdrawWinnings(options), 'Winnings withdrawn!');
}

async function fetchLatestPrice() {
    try {
        if (contract) {
            const latestPrice = await contract.getLatestPrice();
            const priceInUSD = ethers.utils.formatUnits(latestPrice, 8);
            const adjustedPrice = parseFloat(priceInUSD) / 1e10;
            const formattedPrice = adjustedPrice.toFixed(2);
            document.getElementById('latestPrice').innerText = `Latest Price: $${formattedPrice}`;
        } else {
            document.getElementById('latestPrice').innerText = 'Connect to MetaMask to see the latest price';
        }
    } catch (error) {
        document.getElementById('latestPrice').innerText = 'Failed to fetch latest price';
    }
}

function updateBettingButtons(isOpen, canClose) {
    document.getElementById('placeBetUp').disabled = !isOpen;
    document.getElementById('placeBetDown').disabled = !isOpen;
    document.getElementById('openBettingButton').disabled = isOpen;
    document.getElementById('closeBettingButton').disabled = !canClose;
}

async function fetchBettingStatus() {
    try {
        const bettingDuration = 86400;
        const startTime = await contract.startTime();
        const endPrice = await contract.endPrice();

        if (!startTime || startTime.toString() === "0") {
            document.getElementById('bettingStatus').innerText = 'Betting Status: Closed';
            updateBettingButtons(false, false);
            return;
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const timeLimit = parseInt(startTime) + bettingDuration;

        if (currentTime < timeLimit) {
            document.getElementById('bettingStatus').innerText = 'Betting Status: Open';
            updateBettingButtons(true, true);
        } else if (endPrice.toString() === "0" && currentTime >= timeLimit) {
            document.getElementById('bettingStatus').innerText = 'Bets can be closed';
            updateBettingButtons(false, true);
        } else {
            document.getElementById('bettingStatus').innerText = 'Betting Status: Closed';
            updateBettingButtons(false, false);
        }
    } catch (error) {
        document.getElementById('bettingStatus').innerText = 'Failed to fetch betting status';
        console.error('Error fetching betting status:', error.message || error);
    }
}

function initializeApp() {
    document.getElementById('connectButton').addEventListener('click', connectMetaMask);
    document.getElementById('openBettingButton').addEventListener('click', openBetting);
    document.getElementById('closeBettingButton').addEventListener('click', closeBetting);
    document.getElementById('placeBetUp').addEventListener('click', () => placeBet(1));
    document.getElementById('placeBetDown').addEventListener('click', () => placeBet(0));
    document.getElementById('withdrawButton').addEventListener('click', withdrawWinnings);

    if (window.ethereum) {
        window.ethereum.on('chainChanged', () => {
            updateNetworkStatus();
            window.location.reload();
        });
    }

    document.getElementById('bettingStatus').innerText = 'Betting Status: Pending';
}

window.addEventListener('load', initializeApp);
setInterval(fetchLatestPrice, 10000);
