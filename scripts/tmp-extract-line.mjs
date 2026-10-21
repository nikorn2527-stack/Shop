import fs from "node:fs";
const [file, lineNo, out] = process.argv.slice(2);
const lines = fs.readFileSync(file, "utf8").split("\n");
const idx = Number(lineNo) - 1;
fs.writeFileSync(out, lines[idx].replace(/></g, ">\n<"));
console.log("wrote", out, "chars", lines[idx].length);
