// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

library ArrayBytes32 {

    function exists(bytes32[] storage array, bytes32 key) public view returns(bool){
        for (uint256 i_ = 0; i_ < array.length; i_++){
            if (array[i_] == key) return true;
        }
        return false;
    }

    // Function to remove an element by index
    function removeByIndex(bytes32[] storage array, uint256 index) internal {
        require(index < array.length, "Index out of bounds");

        for (uint256 i = index; i < array.length - 1; i++) {
            array[i] = array[i + 1];
        }
        array.pop();
    }

    // Function to find the index of an element in the array
    function findElementIndex(bytes32[] storage array, bytes32 element) internal view returns (uint256) {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == element) {
                return i;
            }
        }
        return array.length; // Return array length if element is not found
    }
}