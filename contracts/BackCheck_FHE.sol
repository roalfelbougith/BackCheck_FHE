pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BackCheck_FHE is ZamaEthereumConfig {
    struct BackgroundCheck {
        string candidateId;
        euint32 encryptedCrimeStatus;
        euint32 encryptedCreditScore;
        uint256 employerId;
        uint256 timestamp;
        bool result;
        bool isVerified;
    }

    mapping(string => BackgroundCheck) public checks;
    string[] public checkIds;

    event CheckCreated(string indexed checkId, address indexed requester);
    event CheckCompleted(string indexed checkId, bool result);

    constructor() ZamaEthereumConfig() {}

    function requestCheck(
        string calldata checkId,
        string calldata candidateId,
        externalEuint32 encryptedCrimeStatus,
        externalEuint32 encryptedCreditScore,
        bytes calldata crimeProof,
        bytes calldata creditProof,
        uint256 employerId
    ) external {
        require(bytes(checks[checkId].candidateId).length == 0, "Check already exists");

        euint32 crimeStatus = FHE.fromExternal(encryptedCrimeStatus, crimeProof);
        euint32 creditScore = FHE.fromExternal(encryptedCreditScore, creditProof);

        require(FHE.isInitialized(crimeStatus), "Invalid crime status");
        require(FHE.isInitialized(creditScore), "Invalid credit score");

        checks[checkId] = BackgroundCheck({
            candidateId: candidateId,
            encryptedCrimeStatus: crimeStatus,
            encryptedCreditScore: creditScore,
            employerId: employerId,
            timestamp: block.timestamp,
            result: false,
            isVerified: false
        });

        FHE.allowThis(checks[checkId].encryptedCrimeStatus);
        FHE.allowThis(checks[checkId].encryptedCreditScore);

        checkIds.push(checkId);
        emit CheckCreated(checkId, msg.sender);
    }

    function processCheck(
        string calldata checkId,
        bytes memory crimeProof,
        bytes memory creditProof
    ) external {
        require(bytes(checks[checkId].candidateId).length > 0, "Check does not exist");
        require(!checks[checkId].isVerified, "Check already processed");

        euint32 crimeStatus = checks[checkId].encryptedCrimeStatus;
        euint32 creditScore = checks[checkId].encryptedCreditScore;

        uint32 clearCrimeStatus = FHE.decrypt(crimeStatus, crimeProof);
        uint32 clearCreditScore = FHE.decrypt(creditScore, creditProof);

        bool passed = (clearCrimeStatus == 0 && clearCreditScore >= 600);
        checks[checkId].result = passed;
        checks[checkId].isVerified = true;

        emit CheckCompleted(checkId, passed);
    }

    function getCheckResult(string calldata checkId) external view returns (bool) {
        require(bytes(checks[checkId].candidateId).length > 0, "Check does not exist");
        require(checks[checkId].isVerified, "Check not processed");
        return checks[checkId].result;
    }

    function getCheckDetails(string calldata checkId) external view returns (
        string memory candidateId,
        uint256 employerId,
        uint256 timestamp,
        bool isVerified
    ) {
        require(bytes(checks[checkId].candidateId).length > 0, "Check does not exist");
        BackgroundCheck storage check = checks[checkId];
        return (check.candidateId, check.employerId, check.timestamp, check.isVerified);
    }

    function getAllCheckIds() external view returns (string[] memory) {
        return checkIds;
    }

    function verifyCrimeStatus(
        string calldata checkId,
        bytes memory proof
    ) external view returns (uint32) {
        require(bytes(checks[checkId].candidateId).length > 0, "Check does not exist");
        return FHE.decrypt(checks[checkId].encryptedCrimeStatus, proof);
    }

    function verifyCreditScore(
        string calldata checkId,
        bytes memory proof
    ) external view returns (uint32) {
        require(bytes(checks[checkId].candidateId).length > 0, "Check does not exist");
        return FHE.decrypt(checks[checkId].encryptedCreditScore, proof);
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


