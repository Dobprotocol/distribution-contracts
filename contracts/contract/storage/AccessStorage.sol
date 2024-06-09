// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

import "../../interface/StorageInterface.sol";

//types imports
import "../../types/KeyPrefix.sol";

abstract contract AccessStorage {

    StorageInterface internal _S;
    string internal _nameSpace;

    modifier canInteract(){
        require(_S.isUser(address(this)), "USER_ROLE_NOT_GRANTED");
        _;
    }

    constructor(address _storage, string memory _name) {
        _S = StorageInterface(_storage);
        _nameSpace = _name;
    }

    function _sKey(
        string memory _string
    ) internal view returns(bytes32){
        return keccak256(abi.encodePacked(_nameSpace, _string));
    }

    function _spKey(
        string memory _string,
        KeyPrefix _prefix
    ) internal view returns(bytes32){
        return keccak256(abi.encodePacked(_nameSpace, _string, _prefix));
    }
    
    function _pKey(
        KeyPrefix _prefix
    ) internal view returns(bytes32){
        return keccak256(abi.encodePacked(_nameSpace, _prefix));
    }

    function _ptKey(
        KeyPrefix _prefix, 
        address _token
    ) internal view returns(bytes32){
        return keccak256(abi.encodePacked(_nameSpace, _prefix, _token));
    }

    function _ptuKey(
        KeyPrefix _prefix,
        address _token,
        address _user
    ) internal view returns(bytes32){
        return keccak256(abi.encodePacked(_nameSpace, _prefix, _token, _user));
    }

    function _puKey(
        KeyPrefix _prefix,
        uint256 _value
    ) internal view returns(bytes32){
        return keccak256(abi.encodePacked(_nameSpace, _prefix, _value));
    }


}