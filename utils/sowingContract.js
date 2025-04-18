const { ethers } = require("ethers");

const provider = new ethers.JsonRpcProvider("https://rpc-mainnet.taker.xyz", {
  chainId: 1125,
  name: "Taker",
  nativeCurrency: { name: "Taker", symbol: "TAKER", decimals: 18 },
});
const CONTRACT_ABI = [
  {
    constant: false,
    inputs: [],
    name: "active",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
];

async function claimRewardMining(privateKey) {
  try {
    const ethersWallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, ethersWallet);
    const gasLimit = 182832;
    const maxPriorityFeePerGas = ethers.parseUnits("0.11", "gwei");
    const maxFeePerGas = ethers.parseUnits("0.11135", "gwei");
    const tx = await contract.active({
      gasLimit,
      maxPriorityFeePerGas,
      maxFeePerGas,
      type: 2,
    });

    await tx.wait();
    return tx.hash;
  } catch (error) {
    return null;
  }
}

module.exports = { claimRewardMining };
