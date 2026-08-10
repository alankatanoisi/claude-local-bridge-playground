'use strict';

/**
 * starlark-lint.js — deterministic pre-lint for model-generated Starlark (R6).
 *
 * LLMs write Starlark as if it were Python. The live campaigns hit exactly
 * this: two models produced adjacent string literals (Python implicitly
 * concatenates; Starlark does not) and each burned a repair round-trip on it.
 * This linter runs before the Go evaluator:
 *
 * - Mechanical Python-isms are AUTO-REPAIRED (currently: adjacent string
 *   literals get an explicit `+`). The repaired source is what gets evaluated;
 *   the repair is recorded on the run ledger.
 * - Non-mechanical Python-isms (f-strings, while, try/except, class, import,
 *   load, yield/async/global/nonlocal) return precise line-numbered
 *   diagnostics. The coordinator feeds those to the model's repair attempt
 *   instead of spending a Go-evaluator round on a predictable failure.
 *
 * Deliberately NOT linted: recursion. Detecting it statically without false
 * positives needs real scope analysis, and the evaluator already rejects it
 * at runtime with a precise message — so the runtime stays the authority.
 *
 * The scanner masks string/comment contents first, so a keyword inside a
 * string ("this while that") can never trigger a rule.
 */

const QUOTES = new Set(['"', "'"]);

/**
 * Single pass over the source. Returns:
 * - masked: source with every comment and string LITERAL (including quotes)
 *   replaced by spaces, newlines preserved — safe for keyword regexes.
 * - strings: each literal's span, line, bracket depth, and prefix.
 */
function scan(source) {
  const masked = source.split('');
  const strings = [];
  let index = 0;
  let line = 1;
  let depth = 0;

  const blank = (from, to) => {
    for (let i = from; i < to; i += 1) {
      if (masked[i] !== '\n') masked[i] = ' ';
    }
  };

  while (index < source.length) {
    const char = source[index];
    if (char === '\n') {
      line += 1;
      index += 1;
      continue;
    }
    if (char === '#') {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (QUOTES.has(char)) {
      // Collect any r/b/f-style prefix immediately before the quote.
      let prefixStart = index;
      while (prefixStart > 0 && /[a-zA-Z]/.test(source[prefixStart - 1])) prefixStart -= 1;
      const prefix = source.slice(prefixStart, index);
      const isPrefix = /^[rbfRBF]{0,3}$/.test(prefix) && prefix.length <= 3;
      const literalStart = isPrefix && prefix.length > 0 ? prefixStart : index;

      const triple = source.startsWith(char.repeat(3), index);
      const closer = triple ? char.repeat(3) : char;
      let cursor = index + closer.length;
      const startLine = line;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source.startsWith(closer, cursor)) {
          cursor += closer.length;
          break;
        }
        if (source[cursor] === '\n') {
          if (!triple) break; // unterminated single-line string: stop at EOL
          line += 1;
        }
        cursor += 1;
      }
      strings.push({
        start: literalStart,
        quoteStart: index,
        end: cursor,
        line: startLine,
        depth,
        prefix: isPrefix ? prefix.toLowerCase() : '',
      });
      blank(literalStart, cursor);
      index = cursor;
      continue;
    }
    index += 1;
  }
  return { masked: masked.join(''), strings };
}

function lineOfIndex(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

const KEYWORD_RULES = [
  {
    rule: 'while-loop',
    pattern: /\bwhile\b/g,
    message: 'Starlark has no while loops; use a bounded for loop over a list or range().',
  },
  {
    rule: 'import',
    pattern: /^[ \t]*(?:import\s|from\s+\w[\w.]*\s+import\b)/gm,
    message: 'Starlark has no import statement; use only built-ins and the supplied ctx.',
  },
  {
    rule: 'load-disabled',
    pattern: /\bload\s*\(/g,
    message: 'load() is disabled in this evaluator; define everything in one program.',
  },
  {
    rule: 'exceptions',
    pattern: /^[ \t]*(?:try\s*:|except\b|raise\b|finally\s*:)/gm,
    message: 'Starlark has no exceptions (try/except/raise/finally); validate values with if instead.',
  },
  {
    rule: 'class',
    pattern: /\bclass\b/g,
    message: 'Starlark has no classes; return plain dicts and lists.',
  },
  {
    rule: 'unsupported-keyword',
    pattern: /\b(?:yield|async|await|global|nonlocal)\b/g,
    message: 'Starlark supports none of yield/async/await/global/nonlocal.',
  },
];

/**
 * Lint (and mechanically repair) one generated program.
 * Returns { source, applied, diagnostics }:
 * - source: the possibly-repaired program (use THIS for evaluation),
 * - applied: auto-repairs performed, e.g. [{ rule: 'adjacent-strings', line }],
 * - diagnostics: remaining blockers with rule, line, and repair guidance.
 */
function lintStarlark(source) {
  const { masked, strings } = scan(source);
  const diagnostics = [];
  const applied = [];

  // f-string prefixes (diagnostic — rewriting format semantics is not mechanical).
  for (const literal of strings) {
    if (literal.prefix.includes('f')) {
      diagnostics.push({
        rule: 'f-string',
        line: literal.line,
        message: `line ${literal.line}: Starlark has no f-strings; build the string with + or .format().`,
      });
    }
  }

  // Keyword rules against the masked source.
  for (const { rule, pattern, message } of KEYWORD_RULES) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(masked)) !== null) {
      const line = lineOfIndex(masked, match.index);
      diagnostics.push({ rule, line, message: `line ${line}: ${message}` });
    }
  }

  // Adjacent string literals (auto-repair): a literal followed by another
  // literal with nothing but whitespace between them — on one line, or across
  // lines while inside brackets (the two shapes Python implicitly joins).
  const insertions = [];
  for (let i = 0; i + 1 < strings.length; i += 1) {
    const current = strings[i];
    const next = strings[i + 1];
    const between = source.slice(current.end, next.start);
    if (/^[ \t]*$/.test(between)) {
      insertions.push({ at: current.end, line: current.line });
    } else if (/^[ \t]*\n[ \t\n]*$/.test(between) && next.depth > 0) {
      insertions.push({ at: current.end, line: current.line });
    }
  }
  let repaired = source;
  for (const insertion of [...insertions].reverse()) {
    repaired = `${repaired.slice(0, insertion.at)} +${repaired.slice(insertion.at)}`;
    applied.push({ rule: 'adjacent-strings', line: insertion.line });
  }
  applied.reverse();

  diagnostics.sort((a, b) => a.line - b.line);
  return { source: repaired, applied, diagnostics };
}

module.exports = { lintStarlark };
