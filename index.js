const fs = require("fs");
const Deobfuscator = require("./deobfuscator/Deobfuscator");

const sourceCode = fs.readFileSync("input/cf-main-challenge.js", {
  encoding: "utf-8",
});

const deobfuscator = new Deobfuscator(sourceCode);
const code = deobfuscator.deobfuscate();

fs.writeFile("./output/deobfuscated_code.js", code, () => console.log("done!"));
