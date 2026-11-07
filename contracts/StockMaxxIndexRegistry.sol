// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title StockMaxxIndexRegistry
 * @author MAXXAGENT — built for Base Stocks Maxxing Season (Nov 5 – Dec 5, 2026)
 * @notice Non-custodial onchain registry of tokenized-stock index strategies on Base.
 *
 * What it does:
 *  - Anyone can publish an index: up to 10 allowlisted Coinbase B20 stocks with weights summing to 100%.
 *  - Only the index creator can update its weights (each update is versioned and can carry a research hash).
 *  - Followers buy an index by swapping USDC into its constituents from their own wallet (offchain routing);
 *    this contract never holds, moves, or charges any funds.
 *
 * What it deliberately does NOT do:
 *  - No deposits, no custody, no fees, no payable functions, no token transfers.
 */
contract StockMaxxIndexRegistry {
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_CONSTITUENTS = 10;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_TICKER_LENGTH = 16;

    struct Index {
        string name;
        string ticker;
        address creator;
        uint64 createdAt;
        uint64 updatedAt;
        uint32 version;
        address[] tokens;
        uint16[] weightsBps;
    }

    address public owner;
    mapping(address => bool) public isAllowedToken;

    uint256 public indexCount;
    mapping(uint256 => Index) private _indexes;
    mapping(address => uint256[]) private _creatorIndexes;

    event IndexCreated(
        uint256 indexed indexId,
        address indexed creator,
        string name,
        string ticker,
        address[] tokens,
        uint16[] weightsBps
    );
    event IndexWeightsUpdated(
        uint256 indexed indexId,
        address indexed creator,
        uint32 version,
        uint16[] weightsBps,
        bytes32 researchHash
    );
    event AllowedTokenSet(address indexed token, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotIndexCreator();
    error InvalidIndex();
    error InvalidName();
    error InvalidTicker();
    error InvalidConstituentCount();
    error LengthMismatch();
    error TokenNotAllowed(address token);
    error DuplicateToken(address token);
    error ZeroWeight();
    error WeightsMustSumTo10000();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address[] memory allowedTokens) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        for (uint256 i = 0; i < allowedTokens.length; i++) {
            _setAllowedToken(allowedTokens[i], true);
        }
    }

    // ------------------------------------------------------------------
    //                           INDEX LIFECYCLE
    // ------------------------------------------------------------------

    function createIndex(
        string calldata name,
        string calldata ticker,
        address[] calldata tokens,
        uint16[] calldata weightsBps
    ) external returns (uint256 indexId) {
        uint256 nameLen = bytes(name).length;
        if (nameLen == 0 || nameLen > MAX_NAME_LENGTH) revert InvalidName();
        uint256 tickerLen = bytes(ticker).length;
        if (tickerLen == 0 || tickerLen > MAX_TICKER_LENGTH) revert InvalidTicker();
        _validateConstituents(tokens, weightsBps);

        indexId = indexCount++;
        Index storage idx = _indexes[indexId];
        idx.name = name;
        idx.ticker = ticker;
        idx.creator = msg.sender;
        idx.createdAt = uint64(block.timestamp);
        idx.updatedAt = uint64(block.timestamp);
        idx.version = 1;
        for (uint256 i = 0; i < tokens.length; i++) {
            idx.tokens.push(tokens[i]);
            idx.weightsBps.push(weightsBps[i]);
        }
        _creatorIndexes[msg.sender].push(indexId);

        emit IndexCreated(indexId, msg.sender, name, ticker, tokens, weightsBps);
    }

    /// @notice Creator-only reweighting of an existing index (constituents stay the same).
    function updateWeights(uint256 indexId, uint16[] calldata weightsBps, bytes32 researchHash) external {
        if (indexId >= indexCount) revert InvalidIndex();
        Index storage idx = _indexes[indexId];
        if (msg.sender != idx.creator) revert NotIndexCreator();
        uint256 len = idx.tokens.length;
        if (weightsBps.length != len) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < len; i++) {
            if (weightsBps[i] == 0) revert ZeroWeight();
            total += weightsBps[i];
            idx.weightsBps[i] = weightsBps[i];
        }
        if (total != BPS_DENOMINATOR) revert WeightsMustSumTo10000();

        idx.updatedAt = uint64(block.timestamp);
        idx.version += 1;
        emit IndexWeightsUpdated(indexId, msg.sender, idx.version, weightsBps, researchHash);
    }

    // ------------------------------------------------------------------
    //                                VIEWS
    // ------------------------------------------------------------------

    function getIndex(uint256 indexId)
        external
        view
        returns (
            string memory name,
            string memory ticker,
            address creator,
            uint64 createdAt,
            uint64 updatedAt,
            uint32 version,
            address[] memory tokens,
            uint16[] memory weightsBps
        )
    {
        if (indexId >= indexCount) revert InvalidIndex();
        Index storage idx = _indexes[indexId];
        return (idx.name, idx.ticker, idx.creator, idx.createdAt, idx.updatedAt, idx.version, idx.tokens, idx.weightsBps);
    }

    function getCreatorIndexes(address creator) external view returns (uint256[] memory) {
        return _creatorIndexes[creator];
    }

    // ------------------------------------------------------------------
    //                         ADMIN (allowlist only)
    // ------------------------------------------------------------------

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        _setAllowedToken(token, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ------------------------------------------------------------------
    //                              INTERNAL
    // ------------------------------------------------------------------

    function _setAllowedToken(address token, bool allowed) internal {
        if (token == address(0)) revert ZeroAddress();
        isAllowedToken[token] = allowed;
        emit AllowedTokenSet(token, allowed);
    }

    function _validateConstituents(address[] calldata tokens, uint16[] calldata weightsBps) internal view {
        uint256 len = tokens.length;
        if (len == 0 || len > MAX_CONSTITUENTS) revert InvalidConstituentCount();
        if (weightsBps.length != len) revert LengthMismatch();

        uint256 total;
        for (uint256 i = 0; i < len; i++) {
            address t = tokens[i];
            if (!isAllowedToken[t]) revert TokenNotAllowed(t);
            for (uint256 j = 0; j < i; j++) {
                if (tokens[j] == t) revert DuplicateToken(t);
            }
            if (weightsBps[i] == 0) revert ZeroWeight();
            total += weightsBps[i];
        }
        if (total != BPS_DENOMINATOR) revert WeightsMustSumTo10000();
    }
}
