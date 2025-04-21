// SPDX-License-Identifier: BSL-1.0
pragma solidity >=0.8.0 <0.9.0;

library ArrayBytes32 {
    function exists(
        bytes32[] storage array,
        bytes32 key
    ) public view returns (bool) {
        for (uint256 i_ = 0; i_ < array.length; i_++) {
            if (array[i_] == key) return true;
        }
        return false;
    }

    // Function to remove an element by index
    // this will just move the last element and place it
    // in the position of the deleted index, then delete the last entry
    function removeByIndex(bytes32[] storage array, uint256 index) internal {
        require(index < array.length, "Index out of bounds");
        array[index] = array[array.length - 1];
        array.pop();
    }

    function removeMultipleIndixes(bytes32[] storage array, uint256[] memory indexes) internal {
        require(indexes[indexes.length-1] < array.length, "Index out of bounds");

        // Remove elements at the given indices
        for (uint256 i = 0; i < indexes.length; i++) {
            uint256 indexToRemove = indexes[i];
            require(indexToRemove < array.length, "Index out of bounds");

            if (indexToRemove != array.length - 1) {
                array[indexToRemove] = array[array.length - 1];
            }
            array.pop();
        }
    }

    // Function to find the index of an element in the array
    function findElementIndex(
        bytes32[] storage array,
        bytes32 element
    ) internal view returns (uint256) {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == element) {
                return i;
            }
        }
        return array.length; // Return array length if element is not found
    }

    
}
