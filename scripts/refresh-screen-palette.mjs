import fs from 'node:fs';
import postcss from 'postcss';

const file = 'D:/Shop-v2/client/src/index.css';
const marker = '/* Unified iris screen palette — generated from legacy green declarations. */';
const source = fs.readFileSync(file, 'utf8').split(marker)[0].trimEnd();
const output = [];
function replaceColor(hex) {
  const text = hex.slice(1);
  if (![3, 6].includes(text.length)) return hex;
  const expanded = text.length === 3 ? [...text].map(c => c + c).join('') : text;
  const rgb = [0, 2, 4].map(i => parseInt(expanded.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  if (!delta) return hex;
  const light = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * light - 1));
  const hue = ((max === rgb[0] ? (rgb[1] - rgb[2]) / delta : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4) * 60 + 360) % 360;
  if (hue < 65 || hue > 180 || saturation < .045) return hex;
  if (light > .87) return 'var(--teal-mist)';
  if (light > .73) return 'var(--teal-soft)';
  if (light > .53) return '#66708b';
  if (light > .34) return '#424b65';
  return '#20263c';
}
postcss.parse(source).walkRules(rule => {
  let parent = rule.parent;
  const wrappers = [];
  while (parent?.type !== 'root') {
    if (parent.type === 'atrule') {
      if (parent.name !== 'media' || /print/.test(parent.params)) return;
      wrappers.unshift(`@media ${parent.params} {`);
    }
    parent = parent.parent;
  }
  if (/data-style|receipt|print|document|sheet|card-art|report-doc/.test(rule.selector)) return;
  const declarations = [];
  rule.walkDecls(decl => {
    if (!/color|background|border|shadow|outline|fill|stroke/.test(decl.prop)) return;
    const value = decl.value.replace(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, replaceColor);
    if (value !== decl.value) declarations.push(`    ${decl.prop}: ${value}${decl.important ? ' !important' : ''};`);
  });
  if (!declarations.length) return;
  const excluded = ':not(.print-preview-paper *, .receipt-paper *, .member-card-document *, .stock-count-sheet *)';
  const selectors = rule.selectors.map(s => s.includes('::') ? s.replace(/(::[\w-]+)/, `${excluded}$1`) : s + excluded);
  output.push(`${wrappers.join('\n')}\n  ${selectors.join(',\n  ')} {\n${declarations.join('\n')}\n  }\n${'}'.repeat(wrappers.length)}`);
});
fs.writeFileSync(file, `${source}\n\n${marker}\n@media screen {\n${output.join('\n')}\n}\n`);
console.log(`Refreshed ${output.length} legacy screen rules`);