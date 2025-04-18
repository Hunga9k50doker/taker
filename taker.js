const fs = require("fs");
const path = require("path");
const axios = require("axios");
const colors = require("colors");
const { HttpsProxyAgent } = require("https-proxy-agent");
const readline = require("readline");
const user_agents = require("./config/userAgents.js");
const settings = require("./config/config.js");
const { sleep, loadData, getRandomNumber, saveToken, isTokenExpired, saveJson, updateEnv, decodeJWT, getRandomElement } = require("./utils/utils.js");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { checkBaseUrl } = require("./utils/checkAPI.js");
const { headers, headersSowing } = require("./core/header.js");
const { showBanner } = require("./core/banner.js");
const localStorage = require("./localStorage.json");
const { v4: uuidv4 } = require("uuid");
const { Wallet, ethers } = require("ethers");
const { solveCaptcha } = require("./utils/captcha.js");
const { activateMining } = require("./utils/contract.js");
class ClientAPI {
  constructor(itemData, accountIndex, proxy, baseURL) {
    this.headers = headers;
    this.baseURL = baseURL;
    this.baseURL_v2 = settings.BASE_URL_V2;

    this.itemData = itemData;
    this.accountIndex = accountIndex;
    this.proxy = proxy;
    this.proxyPrams = null;
    this.proxyIP = null;
    this.session_name = null;
    this.session_user_agents = this.#load_session_data();
    this.token = null;
    this.localStorage = localStorage;
    // this.provider = new ethers.JsonRpcProvider({
    //   url: "https://rpc-mainnet.taker.xyz/",

    // });
    this.wallet = new ethers.Wallet(this.itemData.privateKey);
  }

  #load_session_data() {
    try {
      const filePath = path.join(process.cwd(), "session_user_agents.json");
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        return {};
      } else {
        throw error;
      }
    }
  }

  #get_random_user_agent() {
    const randomIndex = Math.floor(Math.random() * user_agents.length);
    return user_agents[randomIndex];
  }

  #get_user_agent() {
    if (this.session_user_agents[this.session_name]) {
      return this.session_user_agents[this.session_name];
    }

    console.log(`[Tài khoản ${this.accountIndex + 1}] Tạo user agent...`.blue);
    const newUserAgent = this.#get_random_user_agent();
    this.session_user_agents[this.session_name] = newUserAgent;
    this.#save_session_data(this.session_user_agents);
    return newUserAgent;
  }

  #save_session_data(session_user_agents) {
    const filePath = path.join(process.cwd(), "session_user_agents.json");
    fs.writeFileSync(filePath, JSON.stringify(session_user_agents, null, 2));
  }

  #get_platform(userAgent) {
    const platformPatterns = [
      { pattern: /iPhone/i, platform: "ios" },
      { pattern: /Android/i, platform: "android" },
      { pattern: /iPad/i, platform: "ios" },
    ];

    for (const { pattern, platform } of platformPatterns) {
      if (pattern.test(userAgent)) {
        return platform;
      }
    }

    return "Unknown";
  }

  #set_headers() {
    const platform = this.#get_platform(this.#get_user_agent());
    this.headers["sec-ch-ua"] = `Not)A;Brand";v="99", "${platform} WebView";v="127", "Chromium";v="127`;
    this.headers["sec-ch-ua-platform"] = platform;
    this.headers["User-Agent"] = this.#get_user_agent();
  }

  createUserAgent() {
    try {
      this.session_name = this.wallet.address;
      this.#get_user_agent();
    } catch (error) {
      this.log(`Can't create user agent: ${error.message}`, "error");
      return;
    }
  }

  async log(msg, type = "info") {
    const accountPrefix = `[Account ${this.accountIndex + 1}][${this.wallet.address}]`;
    let ipPrefix = "[Local IP]";
    if (settings.USE_PROXY) {
      ipPrefix = this.proxyIP ? `[${this.proxyIP}]` : "[Unknown IP]";
    }
    let logMessage = "";

    switch (type) {
      case "success":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.green;
        break;
      case "error":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.red;
        break;
      case "warning":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.yellow;
        break;
      case "custom":
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.magenta;
        break;
      default:
        logMessage = `${accountPrefix}${ipPrefix} ${msg}`.blue;
    }
    console.log(logMessage);
  }

  async checkProxyIP() {
    try {
      const proxyAgent = new HttpsProxyAgent(this.proxy);

      const response = await axios.get("https://api.ipify.org?format=json", { httpsAgent: proxyAgent });
      if (response.status === 200) {
        this.proxyIP = response.data.ip;
        const prs = this.proxy.replace("http://", "").replace("@", ":").split(":");
        this.proxyPrams = {
          username: prs[0],
          password: prs[1],
          host: prs[2],
          port: prs[3],
        };
        return response.data.ip;
      } else {
        throw new Error(`Cannot check proxy IP. Status code: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Error checking proxy IP: ${error.message}`);
    }
  }

  async makeRequest(
    url,
    method,
    data = {},
    options = {
      retries: 2,
      isAuth: false,
      extraHeaders: {},
      refreshToken: null,
    }
  ) {
    const { retries, isAuth, extraHeaders, refreshToken } = options;

    const headers = {
      ...this.headers,
      ...extraHeaders,
    };

    if (!isAuth && this.token) {
      headers["authorization"] = `Bearer ${this.token}`;
    }

    let proxyAgent = null;
    if (settings.USE_PROXY) {
      proxyAgent = new HttpsProxyAgent(this.proxy);
    }
    let currRetries = 0,
      errorMessage = null,
      errorStatus = 0;

    do {
      try {
        const response = await axios({
          method,
          url,
          headers,
          timeout: 120000,
          ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {}),
          ...(method.toLowerCase() != "get" ? { data } : {}),
        });
        if (response?.data?.data?.code >= 400 || response?.data?.code >= 400) {
          return { success: false, data: response.data, status: response?.data?.data?.code >= 400 || response?.data?.code >= 400, error: response.data?.msg || "unknow" };
        }
        if (response?.data?.data) return { status: response.status, success: true, data: response.data.data, error: null };
        return { success: true, data: response.data, status: response.status, error: null };
      } catch (error) {
        errorStatus = error.status;
        errorMessage = error?.response?.data?.message ? error?.response?.data : error.message;
        this.log(`Request failed: ${url} | Status: ${error.status} | ${JSON.stringify(errorMessage || {})}...`, "warning");

        if (error.status == 401) {
          this.log(`Unauthorized: ${url} | trying get new token...`);
          this.token = await this.getValidToken(true);
          return await this.makeRequest(url, method, data, options);
        }
        if (error.status == 400) {
          this.log(`Invalid request for ${url}, maybe have new update from server | contact: https://t.me/airdrophuntersieutoc to get new update!`, "error");
          return { success: false, status: error.status, error: errorMessage, data: null };
        }
        if (error.status == 429) {
          this.log(`Rate limit ${JSON.stringify(errorMessage)}, waiting 60s to retries`, "warning");
          await sleep(60);
        }
        if (currRetries > retries) {
          return { status: error.status, success: false, error: errorMessage, data: null };
        }
        currRetries++;
        await sleep(5);
      }
    } while (currRetries <= retries);
    return { status: errorStatus, success: false, error: errorMessage, data: null };
  }
  async auth() {
    const result = await this.getNonce();
    if (!result.success) {
      this.log("Can't get nonce", "error");
      return { success: false };
    }
    const nonce = result.data.nonce;
    const signedMessage = await this.wallet.signMessage(nonce);
    const payload = {
      address: this.itemData.address,
      invitationCode: settings.REF_CODE,
      message: nonce,
      signature: signedMessage,
    };
    return this.makeRequest(`${this.baseURL}/wallet/login`, "post", payload, { isAuth: true });
  }

  async getUserData() {
    return this.makeRequest(`${this.baseURL}/user/getUserInfo`, "get");
  }

  async getBalance() {
    return this.makeRequest(`${this.baseURL}/points`, "get");
  }

  async getNonce() {
    return this.makeRequest(`${this.baseURL}/wallet/generateNonce`, "post", { walletAddress: this.itemData.address }, { isAuth: true });
  }

  async getMinerStatus() {
    return this.makeRequest(`${this.baseURL}/assignment/totalMiningTime`, "get");
  }

  async startMine() {
    return this.makeRequest(`${this.baseURL}/assignment/startMining`, "post", null);
  }

  async getTasks() {
    return this.makeRequest(`${this.baseURL}/assignment/list`, "post");
  }

  async completeTask(payload) {
    return this.makeRequest(`${this.baseURL}/assignment/do`, "post", payload);
  }

  async handleMining(userData) {
    const lastMiningTime = userData?.lastMiningTime || 0;
    const nextMiningTime = lastMiningTime + 24 * 60 * 60;
    const nextDate = new Date(nextMiningTime * 1000);
    const dateNow = new Date();

    // console.log(userData, lastMiningTime);
    if (dateNow > nextDate) {
      this.log(`Starting mining...`, "info");
      const result = await this.startMine();

      const isMiningSuccess = await activateMining(this.itemData.privateKey);
      if (!isMiningSuccess) {
        this.log(`Mining failed: ${JSON.stringify(result.error || {})}`, "error");
      }

      this.log(`Mining started successfully: https://explorer.taker.xyz/${isMiningSuccess}`, "success");
      return;
    } else {
      this.log(`Last mining time: ${new Date(lastMiningTime * 1000).toLocaleString()}`, "warning");
    }
  }

  async handleTasks(userData) {
    const twId = userData?.twId;
    const tasks = await this.getTasks();
    if (!tasks.success) {
      this.log("Can't get tasks", "error");
      return;
    }
    if (tasks.data?.length == 0) {
      this.log("No tasks available", "warning");
      return;
    }
    const taskAvaliable = tasks.data.filter((item) => !item.done && !settings.SKIP_TASKS.includes(item.assignmentId));

    let token = await solveCaptcha();
    if (!token) {
      this.log("Captcha failed", "error");
      return;
    }
    for (const task of taskAvaliable) {
      const { assignmentId, title } = task;
      const timeSleep = getRandomNumber(settings.DELAY_TASK[0], settings.DELAY_TASK[1]);
      this.log(`Starting task ${assignmentId} | ${title} | Delay ${timeSleep}s...`, "info");
      await sleep(timeSleep);
      const payload = {
        assignmentId,
        verifyResp: token,
      };
      const result = await this.completeTask(payload);
      if (result.success) {
        this.log(`Task ${assignmentId} | ${title} completed successfully | ${JSON.stringify(result.data)}`, "success");
      } else {
        if (result.error == "Captcha not solved") {
        }
        this.log(`Task ${assignmentId} | ${title} failed: ${JSON.stringify(result.error || {})}`, "error");
      }
    }
  }
  async getValidToken(isNew = false) {
    const existingToken = this.token;
    const { isExpired: isExp, expirationDate } = isTokenExpired(existingToken);

    this.log(`Access token status: ${isExp ? "Expired".yellow : "Valid".green} | Acess token exp: ${expirationDate}`);
    if (existingToken && !isNew && !isExp) {
      this.log("Using valid token", "success");
      return existingToken;
    }

    this.log("No found token or experied, logining......", "warning");
    const loginRes = await this.auth();
    if (!loginRes?.success) return null;
    const newToken = loginRes.data;
    if (newToken?.token) {
      await saveJson(this.session_name, JSON.stringify(newToken), "localStorage.json");
      return newToken.token;
    }
    this.log("Can't get new token...", "warning");
    return null;
  }

  convertMilliseconds(ms) {
    const seconds = ms / 1000;
    const hours = Math.floor(seconds / 3600);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;

    return `${days} days ${remainingHours} hours`;
  }

  async handleSyncData() {
    let userData = { success: false, data: null },
      retries = 0;
    do {
      userData = await this.getUserData();
      if (userData?.success) break;
      retries++;
    } while (retries < 2);
    const minerStatus = await this.getMinerStatus();
    if (userData.success) {
      let { totalMiningTime, lastMiningTime } = minerStatus.data;

      const { totalReward, twName, invitationCode, twId } = userData.data;
      userData.data["lastMiningTime"] = lastMiningTime;
      this.log(
        `Ref code: ${invitationCode} | Twitter: ${twName || twId || "Not set"} | Total mining time: ${this.convertMilliseconds(totalMiningTime)} | Last mining: ${new Date(
          lastMiningTime * 1000
        ).toLocaleString()} | Points: ${totalReward ? Number(totalReward).toFixed(2) : 0} | `,
        "custom"
      );
    } else {
      return this.log("Can't sync new data...skipping", "warning");
    }
    return userData;
  }

  async runAccount() {
    const accountIndex = this.accountIndex;
    this.session_name = this.wallet.address;
    this.token = JSON.parse(this.localStorage[this.session_name] || "{}")?.token || null;
    this.#set_headers();
    if (settings.USE_PROXY) {
      try {
        this.proxyIP = await this.checkProxyIP();
      } catch (error) {
        this.log(`Cannot check proxy IP: ${error.message}`, "warning");
        return;
      }
      const timesleep = getRandomNumber(settings.DELAY_START_BOT[0], settings.DELAY_START_BOT[1]);
      console.log(`=========Tài khoản ${accountIndex + 1} | ${this.proxyIP} | Bắt đầu sau ${timesleep} giây...`.green);
      await sleep(timesleep);
    }

    const token = await this.getValidToken();
    if (!token) return;
    this.token = token;
    const userData = await this.handleSyncData();
    if (userData.success) {
      if (userData.data?.twId) {
        if (settings.AUTO_TASK) {
          await this.handleTasks(userData.data);
          await sleep(1);
        }
        await this.handleMining(userData.data);
      } else {
        this.log("This wallet is not bound Twitter/X skipping...", "warning");
        return;
      }
    } else {
      return this.log("Can't get use info...skipping", "error");
    }
  }
}

async function runWorker(workerData) {
  const { itemData, accountIndex, proxy, hasIDAPI } = workerData;
  const to = new ClientAPI(itemData, accountIndex, proxy, hasIDAPI);
  try {
    await Promise.race([to.runAccount(), new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 24 * 60 * 60 * 1000))]);
    parentPort.postMessage({
      accountIndex,
    });
  } catch (error) {
    parentPort.postMessage({ accountIndex, error: error.message });
  } finally {
    if (!isMainThread) {
      parentPort.postMessage("taskComplete");
    }
  }
}

async function main() {
  console.clear();
  showBanner();
  const privateKeys = loadData("privateKeys.txt");
  const proxies = loadData("proxy.txt");
  const data = privateKeys.map((item) => (item.startsWith("0x") ? item : `0x${item}`));
  if (data.length == 0 || (data.length > proxies.length && settings.USE_PROXY)) {
    console.log("Số lượng proxy và data phải bằng nhau.".red);
    console.log(`Data: ${data.length}`);
    console.log(`Proxy: ${proxies.length}`);
    process.exit(1);
  }
  if (!settings.USE_PROXY) {
    console.log(`You are running bot without proxies!!!`.yellow);
  }
  let maxThreads = settings.USE_PROXY ? settings.MAX_THEADS : settings.MAX_THEADS_NO_PROXY;

  const { endpoint, message } = await checkBaseUrl();
  if (!endpoint) return console.log(`Không thể tìm thấy ID API, thử lại sau!`.red);
  console.log(`${message}`.yellow);

  const itemDatas = data
    .map((val, index) => {
      const prvk = val.startsWith("0x") ? val : `0x${val}`;
      let wallet = new ethers.Wallet(prvk);
      const item = {
        index,
        privateKey: prvk,
        address: wallet.address,
      };
      new ClientAPI(item, index, proxies[index], endpoint).createUserAgent();
      return item;
    })
    .filter((i) => i !== null);

  process.on("SIGINT", async () => {
    console.log("Stopping...".yellow);
    // stopInterVal();
    await sleep(1);
    process.exit();
  });

  await sleep(1);
  while (true) {
    let currentIndex = 0;
    const errors = [];
    while (currentIndex < data.length) {
      const workerPromises = [];
      const batchSize = Math.min(maxThreads, data.length - currentIndex);
      for (let i = 0; i < batchSize; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            hasIDAPI: endpoint,
            itemData: itemDatas[currentIndex],
            accountIndex: currentIndex,
            proxy: proxies[currentIndex % proxies.length],
          },
        });

        workerPromises.push(
          new Promise((resolve) => {
            worker.on("message", (message) => {
              if (message === "taskComplete") {
                worker.terminate();
              }
              if (settings.ENABLE_DEBUG) {
                console.log(message);
              }
              resolve();
            });
            worker.on("error", (error) => {
              console.log(`Lỗi worker cho tài khoản ${currentIndex}: ${error.message}`);
              worker.terminate();
              resolve();
            });
            worker.on("exit", (code) => {
              worker.terminate();
              if (code !== 0) {
                errors.push(`Worker cho tài khoản ${currentIndex} thoát với mã: ${code}`);
              }
              resolve();
            });
          })
        );

        currentIndex++;
      }

      await Promise.all(workerPromises);

      if (errors.length > 0) {
        errors.length = 0;
      }

      if (currentIndex < data.length) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    await sleep(3);
    console.log(`=============${new Date().toLocaleString()} | Hoàn thành tất cả tài khoản | Chờ ${settings.TIME_SLEEP} phút=============`.magenta);
    showBanner();
    await sleep(settings.TIME_SLEEP * 60);
  }
}

if (isMainThread) {
  main().catch((error) => {
    console.log("Lỗi rồi:", error);
    process.exit(1);
  });
} else {
  runWorker(workerData);
}
