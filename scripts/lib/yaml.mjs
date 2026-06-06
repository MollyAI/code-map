// scripts/lib/yaml.mjs — a minimal YAML reader for code-map's own files:
// templates/*.yml and .code-map/architecture.yml. NOT a general YAML parser.
//
// Supported subset (validated byte-for-byte against PyYAML on all templates):
//   - block mappings (key: value / key:\n  nested)
//   - block sequences (- item)
//   - flow sequences [a, b, c] and flow mappings {k: v, k2: v2}
//   - scalars: bare, double-quoted (with \" \\ escapes), integers
//   - `#` comments (full-line and inline, outside quotes)
// Unsupported (absent from our files): block scalars | >, anchors/aliases,
// single-quoted strings, multi-document streams, complex keys.

export function parse(text) {
  // 1) strip comments, drop blank lines
  const stripped = [];
  for (const raw of text.split('\n')) {
    const s = stripComment(raw);
    if (s.trim() !== '') stripped.push(s);
  }
  // 2) merge continuation lines for multi-line flow collections [...] / {...}
  const merged = [];
  for (let i = 0; i < stripped.length; i++) {
    let line = stripped[i];
    let depth = bracketDepth(line);
    while (depth > 0 && i + 1 < stripped.length) {
      i++;
      line = line + ' ' + stripped[i].trim();
      depth += bracketDepth(stripped[i]);
    }
    merged.push(line);
  }
  const lines = merged.map((l) => ({ indent: indentOf(l), content: l.trim() }));
  if (lines.length === 0) return null;
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
}

// Net bracket depth of a line (open [ { minus close ] }), ignoring quoted text.
function bracketDepth(line) {
  let inQ = false, depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (inQ) continue;
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
  }
  return depth;
}

function indentOf(s) {
  let n = 0;
  while (n < s.length && s[n] === ' ') n++;
  return n;
}

// Remove a `#` comment: a # at line start (after indent) or preceded by a space,
// when not inside a double-quoted string. Leaves #s inside quotes intact.
function stripComment(line) {
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // count preceding backslashes to respect escaping
      let bs = 0, j = i - 1;
      while (j >= 0 && line[j] === '\\') { bs++; j--; }
      if (bs % 2 === 0) inQ = !inQ;
    } else if (c === '#' && !inQ && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

// Parse a block (mapping or sequence) whose items sit at exactly `indent`.
// Returns [value, nextLineIndex].
function parseBlock(lines, i, indent) {
  if (lines[i].content.startsWith('- ') || lines[i].content === '-') {
    return parseSequence(lines, i, indent);
  }
  return parseMapping(lines, i, indent);
}

function parseSequence(lines, i, indent) {
  const out = [];
  while (i < lines.length && lines[i].indent === indent &&
         (lines[i].content.startsWith('- ') || lines[i].content === '-')) {
    const rest = lines[i].content === '-' ? '' : lines[i].content.slice(2);
    if (rest === '') {
      // nested block on following more-indented lines
      const childIndent = (i + 1 < lines.length && lines[i + 1].indent > indent)
        ? lines[i + 1].indent : indent + 2;
      const [val, ni] = parseBlock(lines, i + 1, childIndent);
      out.push(val);
      i = ni;
    } else if (isFlow(rest)) {
      out.push(parseScalar(rest));
      i++;
    } else if (looksLikeMapEntry(rest)) {
      // sequence item is a mapping starting inline after "- "
      const mapIndent = indent + 2;
      // Treat the inline entry as the first line of the map by rewriting it.
      const synthetic = { indent: mapIndent, content: rest };
      const slice = [synthetic, ...lines.slice(i + 1)];
      const [val, niRel] = parseMapping(slice, 0, mapIndent);
      out.push(val);
      i = i + 1 + (niRel - 1); // niRel counts the synthetic line as index 0
    } else {
      out.push(parseScalar(rest));
      i++;
    }
  }
  return [out, i];
}

function parseMapping(lines, i, indent) {
  const out = {};
  while (i < lines.length && lines[i].indent === indent && !lines[i].content.startsWith('- ')) {
    const { key, value } = splitKeyValue(lines[i].content);
    if (value === '') {
      // nested block follows (mapping or sequence) at greater indent
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [val, ni] = parseBlock(lines, i + 1, lines[i + 1].indent);
        out[key] = val;
        i = ni;
      } else if (i + 1 < lines.length && lines[i + 1].indent === indent &&
                 lines[i + 1].content.startsWith('- ')) {
        // block sequence at the SAME indent as the key (valid YAML)
        const [val, ni] = parseSequence(lines, i + 1, indent);
        out[key] = val;
        i = ni;
      } else {
        out[key] = null;
        i++;
      }
    } else {
      out[key] = parseScalar(value);
      i++;
    }
  }
  return [out, i];
}

function isFlow(s) {
  return s.startsWith('[') || s.startsWith('{');
}

function looksLikeMapEntry(s) {
  const c = topLevelColon(s);
  return c !== -1;
}

// Index of the first top-level ": " or trailing ":" separator (not in quotes/brackets).
function topLevelColon(s) {
  let inQ = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (inQ) continue;
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    else if (ch === ':' && depth === 0) {
      if (i + 1 >= s.length || s[i + 1] === ' ') return i;
    }
  }
  return -1;
}

function splitKeyValue(s) {
  const c = topLevelColon(s);
  if (c === -1) return { key: parseScalar(s), value: '' };
  const key = unquote(s.slice(0, c).trim());
  const value = s.slice(c + 1).trim();
  return { key, value };
}

function parseScalar(s) {
  s = s.trim();
  if (s.startsWith('[')) return parseFlowSeq(s);
  if (s.startsWith('{')) return parseFlowMap(s);
  if (s.startsWith('"')) return unquote(s);
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  return s;
}

function unquote(s) {
  s = s.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  return s;
}

// Split a flow collection body by top-level commas (respect quotes + nesting).
function splitFlow(body) {
  const parts = [];
  let buf = '', inQ = false, depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') { inQ = !inQ; buf += ch; continue; }
    if (inQ) { buf += ch; continue; }
    if (ch === '[' || ch === '{') { depth++; buf += ch; }
    else if (ch === ']' || ch === '}') { depth--; buf += ch; }
    else if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; }
    else buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf);
  return parts;
}

function parseFlowSeq(s) {
  const body = s.slice(1, s.lastIndexOf(']'));
  if (body.trim() === '') return [];
  return splitFlow(body).map((p) => parseScalar(p.trim()));
}

function parseFlowMap(s) {
  const body = s.slice(1, s.lastIndexOf('}'));
  const out = {};
  if (body.trim() === '') return out;
  for (const part of splitFlow(body)) {
    const c = topLevelColon(part);
    const key = unquote(part.slice(0, c).trim());
    out[key] = parseScalar(part.slice(c + 1).trim());
  }
  return out;
}
