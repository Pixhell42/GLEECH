import ts from 'typescript';
import { ESLint } from 'eslint';
import prettier from 'prettier';
import { readFile, writeFile } from 'node:fs/promises';
const source = ts.createSourceFile(
  'materials.ts',
  await readFile('packages/effects/src/set2-advanced.kernel', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
if (source.parseDiagnostics.length)
  throw Error(ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, '\n'));
const functions = source.statements.filter(ts.isFunctionDeclaration);
const names = new Set(functions.map((fn) => fn.name.text));
const math = {
  SIN: 'sin',
  COS: 'cos',
  SQRT: 'sqrt',
  ABS: 'abs',
  MIN: 'min',
  MAX: 'max',
  FLOOR: 'floor',
  CEIL: 'ceil',
  ATAN: 'a_ATAN',
  EXP: 'exp',
  POW: 'pow',
  LOG: 'log',
  CLAMP: 'clamp',
  MIX: 'mix',
  SIGN: 'sign',
};
const external = ['P', 'U', 'H', 'N', 'R', 'T', 'D', 'M', 'I', 'O', 'AA'];
let specializedKind;
function constant(node) {
  if (ts.isParenthesizedExpression(node)) return constant(node.expression);
  if (ts.isIdentifier(node) && node.text === 'kind') return specializedKind;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isBinaryExpression(node)) {
    const a = constant(node.left),
      b = constant(node.right),
      op = node.operatorToken.getText(source);
    if (op === '&&') {
      if (a === false || b === false) return false;
      if (a === true && b === true) return true;
    }
    if (op === '||') {
      if (a === true || b === true) return true;
      if (a === false && b === false) return false;
    }
    if (a !== undefined && b !== undefined) {
      if (op === '==' || op === '===') return a === b;
      if (op === '!=' || op === '!==') return a !== b;
    }
  }
}
function expression(node, gpu) {
  if (ts.isNumericLiteral(node))
    return gpu ? (node.text.includes('.') ? node.text : `${node.text}.0`) : `F(${node.text})`;
  if (ts.isIdentifier(node))
    return node.text === 'kind' && specializedKind !== undefined
      ? gpu
        ? `${specializedKind}.0`
        : `F(${specializedKind})`
      : node.text;
  if (ts.isParenthesizedExpression(node)) return `(${expression(node.expression, gpu)})`;
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.getText(source),
      a = expression(node.left, gpu),
      b = expression(node.right, gpu);
    if (op === '=') return `${a} = ${b}`;
    if (op === '+=') return gpu ? `${a} += ${b}` : `${a} = F(${a} + ${b})`;
    if (op === '-=') return gpu ? `${a} -= ${b}` : `${a} = F(${a} - ${b})`;
    if (op === '*=') return gpu ? `${a} *= ${b}` : `${a} = F(${a} * ${b})`;
    const normalized = gpu ? op.replace('===', '==').replace('!==', '!=') : op;
    const result = `(${a} ${normalized} ${b})`;
    return !gpu && ['+', '-', '*', '/', '%'].includes(op) ? `F(${result})` : result;
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const result = `${node.operator === ts.SyntaxKind.MinusToken ? '-' : node.operator === ts.SyntaxKind.ExclamationToken ? '!' : '+'}${expression(node.operand, gpu)}`;
    return !gpu && node.operator === ts.SyntaxKind.MinusToken ? `F(${result})` : result;
  }
  if (ts.isPostfixUnaryExpression(node))
    return gpu ? `${expression(node.operand, gpu)} += 1.0` : `${expression(node.operand, gpu)}++`;
  if (ts.isCallExpression(node)) {
    const name = node.expression.getText(source),
      args = node.arguments.map((arg) => expression(arg, gpu));
    if (gpu && name === 'O') return `advancedOut[u32(${args[0]})] = ${args[1]}`;
    if (gpu) return `${math[name] ?? 'a_' + name}(${args.join(',')})`;
    if (names.has(name)) return `${name}(env,${args.join(',')})`;
    return `${external.includes(name) ? 'env.' : ''}${name}(${args.join(',')})`;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  throw Error('Unsupported shader expression: ' + node.getText(source));
}
function declarations(list, gpu) {
  return list.declarations
    .map(
      (d) => `${gpu ? 'var' : 'let'} ${d.name.getText(source)} = ${expression(d.initializer, gpu)}`,
    )
    .join(';');
}
function statement(node, gpu) {
  if (ts.isBlock(node)) return `{\n${node.statements.map((s) => statement(s, gpu)).join('\n')}\n}`;
  if (ts.isVariableStatement(node)) return declarations(node.declarationList, gpu) + ';';
  if (ts.isExpressionStatement(node)) return expression(node.expression, gpu) + ';';
  if (ts.isReturnStatement(node))
    return `return${node.expression ? ' ' + expression(node.expression, gpu) : ''};`;
  if (ts.isIfStatement(node)) {
    if (specializedKind !== undefined) {
      const value = constant(node.expression);
      if (value === true) return statement(node.thenStatement, gpu);
      if (value === false) return node.elseStatement ? statement(node.elseStatement, gpu) : '';
    }
    const thenBody = statement(node.thenStatement, gpu);
    const elseBody = node.elseStatement ? statement(node.elseStatement, gpu) : '';
    return `if (${expression(node.expression, gpu)}) ${gpu && !ts.isBlock(node.thenStatement) ? '{' + thenBody + '}' : thenBody}${node.elseStatement ? ' else ' + (gpu && !ts.isBlock(node.elseStatement) && !ts.isIfStatement(node.elseStatement) ? '{' + elseBody + '}' : elseBody) : ''}`;
  }
  if (ts.isForStatement(node)) {
    const body = statement(node.statement, gpu);
    return `for (${declarations(node.initializer, gpu)};${expression(node.condition, gpu)};${expression(node.incrementor, gpu)}) ${gpu && !ts.isBlock(node.statement) ? '{' + body + '}' : body}`;
  }
  if (node.kind === ts.SyntaxKind.BreakStatement) return 'break;';
  if (node.kind === ts.SyntaxKind.ContinueStatement) return 'continue;';
  throw Error('Unsupported shader statement: ' + node.getText(source));
}
const header = '// Generated from set2-advanced.kernel by tooling/generate-advanced-shaders.mjs.\n';
const cpuMath = `/* eslint-disable no-useless-assignment, @typescript-eslint/no-unused-vars -- Specialized kernels retain shared declarations for CPU/GPU parity. */
const F=Math.fround;
const SIN=(x:number)=>F(Math.sin(x)), COS=(x:number)=>F(Math.cos(x)), SQRT=(x:number)=>F(Math.sqrt(x)), ABS=Math.abs, MIN=Math.min, MAX=Math.max, FLOOR=Math.floor, ATAN=(y:number,x:number)=>Math.abs(x)+Math.abs(y)<0.000001?0:F(Math.atan2(y,x)), EXP=(x:number)=>F(Math.exp(x)), POW=(x:number,y:number)=>F(Math.pow(x,y)), SIGN=Math.sign;
const CLAMP=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const MIX=(a:number,b:number,t:number)=>F(F(a*F(1-t))+F(b*t));
export interface AdvancedEnvironment {P(i:number):number; U(i:number):number; H(u:number,v:number):number; N(x:number,y:number):number; R(x:number,y:number,lane:number):number; T(u:number,v:number,ch:number):number; D(u:number,v:number,ch:number):number; M(x:number,y:number,limit:number):number; I(ch:number):number; O(ch:number,value:number):void; AA():number;}
`;
let cpu = functions
  .filter((fn) => fn.name.text !== 'Shade')
  .map(
    (fn) =>
      `${fn.name.text === 'Shade' ? 'export ' : ''}function ${fn.name.text}(env:AdvancedEnvironment, ${fn.parameters.map((p) => `${p.name.text}:number`).join(',')})${fn.name.text === 'Shade' ? ':void' : ':number'} ${statement(fn.body, false).replace('{', `{\nvoid env;${fn.parameters.map((p) => `void ${p.name.text};`).join('')}`)}`,
  )
  .join('\n');
let gpu = functions
  .filter((fn) => fn.name.text !== 'Shade')
  .map(
    (fn) =>
      `fn a_${fn.name.text}(${fn.parameters.map((p) => `${p.name.text}:f32`).join(',')})${fn.name.text === 'Shade' ? '' : '->f32'} ${statement(fn.body, true)}`,
  )
  .join('\n');
const shade = functions.find((fn) => fn.name.text === 'Shade');
for (let kind = 0; kind < 12; kind++) {
  specializedKind = kind;
  gpu += `\nfn a_Shade${kind}(${shade.parameters
    .filter((p) => p.name.text !== 'kind')
    .map((p) => `${p.name.text}:f32`)
    .join(',')}) ${statement(shade.body, true)}`;
  const parameters = shade.parameters.filter((p) => p.name.text !== 'kind');
  cpu += `\nfunction Shade${kind}(env:AdvancedEnvironment, ${parameters.map((p) => `${p.name.text}:number`).join(',')}):void ${statement(shade.body, false).replace('{', `{\n${parameters.map((p) => `void ${p.name.text};`).join('')}`)}`;
}
specializedKind = undefined;
cpu += `\nexport const ADVANCED_CPU_MATERIALS = [${Array.from({ length: 12 }, (_, i) => `Shade${i}`).join(',')}] as const;\n`;
const cpuPath = 'packages/effects/src/set2-advanced-cpu.ts';
const linted = await new ESLint({ fix: true }).lintText(header + cpuMath + cpu + '\n', {
  filePath: cpuPath,
});
const formatted = await prettier.format(linted[0].output ?? header + cpuMath + cpu + '\n', {
  ...(await prettier.resolveConfig(cpuPath)),
  filepath: cpuPath,
});
await writeFile(cpuPath, formatted);
await writeFile(
  'packages/renderer-core/src/set2-advanced-kernel.ts',
  header + 'export const ADVANCED_KERNEL_WGSL = `\n' + gpu + '\n`;\n',
);
console.log('Generated shared CPU and WebGPU material kernels.');
