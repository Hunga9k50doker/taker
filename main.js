import axios from "axios";
import { ethers } from "ethers";
import fs from "fs";
import log from "./utils/logger.js";
import iniBapakBudi from "./utils/banner.js";
import ngopiBro from "./utils/contract.js";

function readWallets() {
  if (fs.existsSync("wallets.json")) {
    const data = fs.readFileSync("wallets.json");
    return JSON.parse(data);
  } else {
    log.error("No wallets found in wallets.json. Exiting...");
    process.exit(1);
  }
}

const API = "https://lightmining-api.taker.xyz/";
const axiosInstance = axios.create({
  baseURL: API,
});

const get = async (url, token) => {
  return await axiosInstance.get(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
};

const post = async (url, data, config = {}) => {
  return await axiosInstance.post(url, data, config);
};

const sleep = (s) => {
  return new Promise((resolve) => setTimeout(resolve, s * 1000));
};

async function signMessage(message, privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  try {
    const signature = await wallet.signMessage(message);
    return signature;
  } catch (error) {
    log.error("Error signing message:", error);
    return null;
  }
}

const getUser = async (token, retries = 3) => {
  try {
    const response = await get("user/getUserInfo", token);
    return response.data;
  } catch (error) {
    if (retries > 0) {
      log.error("Failed to get user data:", error.message);
      log.warn(`Retrying... (${retries - 1} attempts left)`);
      await sleep(3);
      return await getUser(token, retries - 1);
    } else {
      log.error("Failed to get user data after retries:", error.message);
      return null;
    }
  }
};
const getNonce = async (walletAddress, retries = 3) => {
  try {
    const res = await post(`wallet/generateNonce`, { walletAddress });
    return res.data;
  } catch (error) {
    if (retries > 0) {
      log.error("Failed to get nonce:", error.message);
      log.warn(`Retrying... (${retries - 1} attempts left)`);
      await sleep(3);
      return await getNonce(walletAddress, retries - 1);
    } else {
      log.error("Failed to get nonce after retries:", error.message);
      return null;
    }
  }
};

const login = async (address, message, signature, retries = 3) => {
  try {
    const res = await post(`wallet/login`, {
      address,
      invitationCode: "8WTC3",
      message,
      signature,
    });
    return res.data.data;
  } catch (error) {
    if (retries > 0) {
      log.error("Failed to login:", error.message);
      log.warn(`Retrying... (${retries - 1} attempts left)`);
      await sleep(3);
      return await login(address, message, signature, retries - 1);
    } else {
      log.error("Failed to login after retries:", error.message);
      return null;
    }
  }
};

const getMinerStatus = async (token, retries = 3) => {
  try {
    const response = await get("assignment/totalMiningTime", token);
    return response.data;
  } catch (error) {
    if (retries > 0) {
      log.error("Failed to get user mine data:", error.message);
      log.warn(`Retrying... (${retries - 1} attempts left)`);
      await sleep(3);
      return await getUser(token, retries - 1);
    } else {
      log.error("Failed to get user mine data after retries:", error.message);
      return null;
    }
  }
};

const startMine = async (token, retries = 3) => {
  try {
    const res = await post(`assignment/startMining`, {}, { headers: { Authorization: `Bearer ${token}` } });
    return res.data;
  } catch (error) {
    if (retries > 0) {
      log.error("Failed to start mining:", error.message);
      log.warn(`Retrying... (${retries - 1} attempts left)`);
      await sleep(3);
      return await startMine(token, retries - 1);
    } else {
      log.error("Failed to start mining after retries:", error.message);
      return null;
    }
  }
};

const main = async () => {
  log.info(iniBapakBudi);
  const wallets = readWallets();
  if (wallets.length === 0) {
    log.error("", "No wallets found in wallets.json file - exiting program.");
    process.exit(1);
  }

  while (true) {
    log.warn("", ` === Sever is down bot might be slow - Just be patient ===`);
    log.info(`Starting processing all wallets:`, wallets.length);

    for (const wallet of wallets) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const nonceData = await getNonce(wallet.address);
      if (!nonceData || !nonceData.data || !nonceData.data.nonce) {
        log.error(`Failed to retrieve nonce for wallet: ${wallet.address}`);
        continue;
      }

      const nonce = nonceData.data.nonce;
      const signature = await signMessage(nonce, wallet.privateKey);
      if (!signature) {
        log.error(`Failed to sign message for wallet: ${wallet.address}`);
        continue;
      }
      log.info(`Trying To Login for wallet: ${wallet.address}`);
      const loginResponse = await login(wallet.address, nonce, signature);
      if (!loginResponse || !loginResponse.token) {
        log.error(`Login failed for wallet: ${wallet.address}`);
        continue;
      } else {
        log.info(`Login successful...`);
      }

      log.info(`Trying to check user info...`);
      const userData = await getUser(loginResponse.token);
      if (userData && userData.data) {
        const { userId, twName, totalReward } = userData.data;
        log.info(`User Info:`, { userId, twName, totalReward });
        if (!twName) {
          log.error("", `This wallet (${wallet.address}) is not bound Twitter/X skipping...`);
          continue;
        }
      } else {
        log.error(`Failed to get user data for wallet: ${wallet.address}`);
      }

      log.info("Trying to check user miner status...");
      const minerStatus = await getMinerStatus(loginResponse.token);
      if (minerStatus && minerStatus.data) {
        const lastMiningTime = minerStatus.data?.lastMiningTime || 0;
        const nextMiningTime = lastMiningTime + 24 * 60 * 60;
        const nextDate = new Date(nextMiningTime * 1000);
        const dateNow = new Date();

        log.info(`Last mining time:`, new Date(lastMiningTime * 1000).toLocaleString());
        if (dateNow > nextDate) {
          log.info(`Trying to start Mining for wallet: ${wallet.address}`);
          const mineResponse = await startMine(loginResponse.token);
          log.info("Mine response:", mineResponse);
          if (mineResponse) {
            log.info(`Trying to activate mining on-chain for wallet: ${wallet.address}`);
            const isMiningSuccess = await ngopiBro(wallet.privateKey);
            if (!isMiningSuccess) {
              log.error(`Wallet already start mine today or wallet dont have taker balance`);
            }
          } else {
            log.error(`Failed to start mining for wallet: ${wallet.address}`);
          }
        } else {
          log.warn(`Mining already started, next mining time is:`, nextDate.toLocaleString());
        }
      }
    }

    log.info("All wallets processed cooling down for 1 hours before checking again...");
    await sleep(60 * 60); // 1 hour delay
  }
};

main();
