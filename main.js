const readline = require("readline");

function askQuest(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

(async () => {
  const options = ["Taker", "Sowing Taker"];
  options.map((option, index) => {
    console.log(`${index + 1}. ${option}`);
  });
  const answer = await askQuest(`Chose an options 1-${options.length}: `);

  switch (answer) {
    case "1":
      require("./taker.js");
      break;
    case "2":
      require("./sowing.js");
      break;

    default:
      console.log("Invalid option. Please choose a valid number.");
      break;
  }
})();
