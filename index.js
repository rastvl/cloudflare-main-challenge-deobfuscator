const fs = require("fs");
const Deobfuscator = require("./deobfuscator/Deobfuscator");

const sourceCode = fs.readFileSync("input/cf-main-challenge.js", {
  encoding: "utf-8",
});

const deobfuscator = new Deobfuscator(sourceCode);
const code = deobfuscator.deobfuscate();

// const t = require('@babel/types');
// const generate = require('@babel/generator').default;
// console.log(JSON.parse(generate(t.arrayExpression([t.numericLiteral(1), t.numericLiteral(2)])).code));

fs.writeFile("./output/deobfuscated_code.js", code, () => console.log("done!"));
