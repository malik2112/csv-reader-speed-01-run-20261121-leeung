// Fast drop-in for csv-reader 1.0.0 (make.fun's reference reader).
// run(input) returns exactly csv-reader's {columns, rows, errors} for
// {text, header}: same broken-row policy, byte-identical answers.
// Speed: fields are sliced out of the input once instead of being built
// character by character, and field results travel in locals (no object
// allocated per field).

const AT_COMMA = 0;
const AT_BREAK = 1;
const AT_END = 2;

export function run(input) {
  const text = String(input.text);
  const wantHeader = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let p = 0;
  let lineNo = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) p = 1;

  let recLine = 1;
  let recRow = null;
  let fVal = '';
  let fEnd = AT_END;
  let fKept = 0;

  // Unquoted scan from p: keep everything up to the next comma or line
  // break, dropping lone CRs (one stray_cr error each, in order) and
  // appending the kept text to prefix. Sets fVal/fEnd/fKept, advances p.
  function scanPlain(prefix) {
    let chunks = null;
    let seg = p;
    let i = p;
    let kept = 0;
    for (;;) {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i += 1;
      }
      if (i >= n) {
        kept += i - seg;
        fVal = chunks === null ? prefix + text.slice(seg, i) : prefix + chunks.join('') + text.slice(seg, i);
        p = i;
        fEnd = AT_END;
        fKept = kept;
        return;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        kept += i - seg;
        fVal = chunks === null ? prefix + text.slice(seg, i) : prefix + chunks.join('') + text.slice(seg, i);
        p = i + 1;
        fEnd = AT_COMMA;
        fKept = kept;
        return;
      }
      if (c === 10) {
        kept += i - seg;
        fVal = chunks === null ? prefix + text.slice(seg, i) : prefix + chunks.join('') + text.slice(seg, i);
        p = i + 1;
        lineNo += 1;
        fEnd = AT_BREAK;
        fKept = kept;
        return;
      }
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        kept += i - seg;
        fVal = chunks === null ? prefix + text.slice(seg, i) : prefix + chunks.join('') + text.slice(seg, i);
        p = i + 2;
        lineNo += 1;
        fEnd = AT_BREAK;
        fKept = kept;
        return;
      }
      if (chunks === null) chunks = [];
      chunks.push(text.slice(seg, i));
      kept += i - seg;
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      i += 1;
      seg = i;
    }
  }

  function lfsIn(from, to) {
    let count = 0;
    let idx = text.indexOf('\n', from);
    while (idx !== -1 && idx < to) {
      count += 1;
      idx = text.indexOf('\n', idx + 1);
    }
    return count;
  }

  function lfsInStr(s) {
    let count = 0;
    let idx = s.indexOf('\n');
    while (idx !== -1) {
      count += 1;
      idx = s.indexOf('\n', idx + 1);
    }
    return count;
  }

  // Read one field at p. Sets fVal/fEnd, advances p.
  function readOneField() {
    if (p >= n || text.charCodeAt(p) !== 34) {
      // Plain unquoted field, scanned inline: walk to the delimiter with
      // charCodeAt and slice the field out once. Only a lone CR (rare)
      // drops into scanPlain, which rescans from the field start.
      let i = p;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i += 1;
      }
      if (i >= n) {
        fVal = text.slice(p, i);
        p = i;
        fEnd = AT_END;
        return;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        fVal = text.slice(p, i);
        p = i + 1;
        fEnd = AT_COMMA;
        return;
      }
      if (c === 10) {
        fVal = text.slice(p, i);
        p = i + 1;
        lineNo += 1;
        fEnd = AT_BREAK;
        return;
      }
      if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
        fVal = text.slice(p, i);
        p = i + 2;
        lineNo += 1;
        fEnd = AT_BREAK;
        return;
      }
      scanPlain('');
      return;
    }
    const openAt = p;
    const openLine = lineNo;
    let cur = p + 1;
    let pieces = null;
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        p = openAt + 1;
        lineNo = openLine;
        errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
        scanPlain('"');
        return;
      }
      const r = text.indexOf('\r', cur);
      const hasCR = r !== -1 && r < q;
      let chunk = null;
      if (hasCR) {
        chunk = text.slice(cur, q).replace(/\r\n|\r/g, '\n');
        lineNo += lfsInStr(chunk);
      } else {
        lineNo += lfsIn(cur, q);
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        if (pieces === null) pieces = [];
        pieces.push(chunk === null ? text.slice(cur, q) : chunk, '"');
        cur = q + 2;
        continue;
      }
      if (pieces === null) {
        fVal = chunk === null ? text.slice(openAt + 1, q) : chunk;
      } else {
        pieces.push(chunk === null ? text.slice(cur, q) : chunk);
        fVal = pieces.join('');
      }
      p = q + 1;
      break;
    }
    if (p >= n) {
      fEnd = AT_END;
      return;
    }
    const c = text.charCodeAt(p);
    if (c === 44) {
      p += 1;
      fEnd = AT_COMMA;
      return;
    }
    if (c === 10) {
      p += 1;
      lineNo += 1;
      fEnd = AT_BREAK;
      return;
    }
    if (c === 13 && p + 1 < n && text.charCodeAt(p + 1) === 10) {
      p += 2;
      lineNo += 1;
      fEnd = AT_BREAK;
      return;
    }
    const quotedVal = fVal;
    scanPlain(quotedVal);
    if (fKept > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
  }

  for (;;) {
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 10) {
        p += 1;
        lineNo += 1;
      } else if (c === 13 && p + 1 < n && text.charCodeAt(p + 1) === 10) {
        p += 2;
        lineNo += 1;
      } else {
        break;
      }
    }
    if (p >= n) break;

    recLine = lineNo;
    recRow = wantHeader && columns === null ? null : rows.length;
    const fields = [];
    let lastWasQuoted = false;
    do {
      lastWasQuoted = p < n && text.charCodeAt(p) === 34;
      readOneField();
      fields.push(fVal);
    } while (fEnd === AT_COMMA);

    if (fields.length === 1 && fields[0] === '' && !lastWasQuoted) continue;

    if (width < 0) width = fields.length;
    if (wantHeader && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: wantHeader ? (columns ?? []) : null, rows, errors };
}
