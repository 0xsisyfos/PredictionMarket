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

    // Hardcoded API3 proxy address for Ethereum/USD price feed
    address public constant priceFeedAddress = 0xa47Fd122b11CdD7aad7c3e8B740FB91D83Ce43D1;

    constructor() {
        priceFeed = IProxy(priceFeedAddress);
    }

    // The betting period now lasts for only 24 hours
    modifier onlyDuringBettingPeriod() {
        require(block.timestamp < startTime + 24 hours, "Betting period over");
        _;
    }

    function startBettingPeriod() external {
        startTime = block.timestamp;
        startPrice = getLatestPrice();
    }

    function placeBet(BetDirection _direction) external payable onlyDuringBettingPeriod {
        require(msg.value > 0, "You must bet some ETH");
        bets.push(Bet(msg.sender, _direction, msg.value, false));
        emit BetPlaced(msg.sender, _direction, msg.value);
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
