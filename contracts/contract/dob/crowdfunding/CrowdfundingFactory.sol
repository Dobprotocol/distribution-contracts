// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "./CrowdfundingV1.sol";

/**
 * @title CrowdfundingFactory
 * @notice Deploys CrowdfundingV1 escrow campaigns and tracks them for
 *         discovery, mirroring DobSaleFactory. The caller becomes the campaign
 *         admin (the only address that can `activate` it).
 */
contract CrowdfundingFactory {
    address[] public campaigns;
    mapping(address => address[]) public campaignsByAdmin;

    event CrowdfundingCreated(
        address indexed campaign,
        address indexed admin,
        address indexed paymentToken,
        uint256 pricePerShare,
        uint256 softCapShares,
        uint256 hardCapShares,
        uint256 deadline
    );

    function createCampaign(
        address paymentToken,
        uint256 pricePerShare,
        uint256 softCapShares,
        uint256 hardCapShares,
        uint256 deadline
    ) external returns (address) {
        CrowdfundingV1 c = new CrowdfundingV1(
            msg.sender,
            paymentToken,
            pricePerShare,
            softCapShares,
            hardCapShares,
            deadline
        );
        campaigns.push(address(c));
        campaignsByAdmin[msg.sender].push(address(c));
        emit CrowdfundingCreated(
            address(c),
            msg.sender,
            paymentToken,
            pricePerShare,
            softCapShares,
            hardCapShares,
            deadline
        );
        return address(c);
    }

    function campaignsCount() external view returns (uint256) {
        return campaigns.length;
    }

    function getCampaignsByAdmin(address admin) external view returns (address[] memory) {
        return campaignsByAdmin[admin];
    }
}
