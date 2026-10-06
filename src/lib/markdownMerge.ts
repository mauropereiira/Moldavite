/**
 * Carries an edit made in the editor back onto a block's original Markdown.
 *
 * A block is known three ways: `source`, as the note spelled it; `before`, as
 * the editor would have written it when the note was opened; and `after`, as
 * the editor writes it now. The edits that turn `before` into `after` are
 * replayed onto `source`, so the parts of the block the user did not touch
 * keep their original spelling. The result is only a candidate: the caller
 * keeps it only if it reads back exactly as `after` does.
 */

type Run = [from: number, to: number, length: number];

/** Over this many differences the inputs are not two spellings of one block. */
const MAX_EDITS = 1000;

/** The runs `a` and `b` share, in order, by Myers' algorithm; null past `MAX_EDITS`. */
export function commonRuns<T>(a: ArrayLike<T>, b: ArrayLike<T>): Run[] | null {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const slice = (x: ArrayLike<T>) => Array.prototype.slice.call(x, head, x.length - tail) as T[];
  const middle = myers(slice(a), slice(b));
  if (!middle) return null;
  const runs: Run[] = middle.map(([from, to, length]) => [from + head, to + head, length]);
  if (head) runs.unshift([0, 0, head]);
  if (tail) runs.push([a.length - tail, b.length - tail, tail]);
  return runs;
}

function myers<T>(a: T[], b: T[]): Run[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], edits: number, n: number, m: number): Run[] {
  const runs: Run[] = [];
  let x = n;
  let y = m;
  for (let d = edits; d >= 0; d--) {
    const at = (k: number) => trace[d][k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previous = down ? k + 1 : k - 1;
    const start = down ? at(previous) : at(previous) + 1;
    if (x > start) runs.push([start, start - k, x - start]);
    x = at(previous);
    y = x - previous;
  }
  return runs.reverse();
}

/**
 * `source` with each changed stretch of `before` replaced by what `after` has
 * there. `anchor[i]` is where unit `i` of `before` sits in `source`, or -1 when
 * the two spell it differently; a change is widened until both its ends rest on
 * anchored units, so it never splits a spelling `source` has and `before` lacks.
 */
function replay(
  source: ArrayLike<string>,
  before: ArrayLike<string>,
  after: ArrayLike<string>,
  anchor: Int32Array
): string[] | null {
  const edits = commonRuns(before, after);
  if (!edits) return null;
  const hunks: Array<[number, number, number, number]> = [];
  let a = 0;
  let b = 0;
  for (const [from, to, length] of [...edits, [before.length, after.length, 0] as Run]) {
    if (from > a || to > b) hunks.push([a, from, b, to]);
    a = from + length;
    b = to + length;
  }

  const out: string[] = [];
  let copied = 0;
  for (let i = 0; i < hunks.length; i++) {
    let [start, end, from, to] = hunks[i];
    while (start > 0 && anchor[start - 1] < 0) {
      start--;
      from--;
    }
    for (;;) {
      const limit = i + 1 < hunks.length ? hunks[i + 1][0] : before.length;
      while (end < limit && anchor[end] < 0) {
        end++;
        to++;
      }
      if (end < limit || i + 1 === hunks.length) break;
      i++;
      end = hunks[i][1];
      to = hunks[i][3];
    }
    const sourceStart = start === 0 ? 0 : anchor[start - 1] + 1;
    let sourceEnd = end === before.length ? source.length : anchor[end];
    // A backslash only the source has, right before the unit the change stops
    // at, escapes that unit rather than belonging to the change.
    if (sourceEnd > sourceStart && end < before.length && source[sourceEnd - 1] === '\\') {
      sourceEnd--;
    }
    if (sourceStart < copied) return null;
    for (let at = copied; at < sourceStart; at++) out.push(source[at]);
    for (let at = from; at < to; at++) out.push(after[at]);
    copied = sourceEnd;
  }
  for (let at = copied; at < source.length; at++) out.push(source[at]);
  return out;
}

/**
 * Line by line, when `source` and `before` have the same number of lines and so
 * spell the same lines differently: a table's padding, a list's markers.
 */
export function replayLines(source: string, before: string, after: string): string | null {
  const sourceLines = source.split('\n');
  const beforeLines = before.split('\n');
  if (sourceLines.length !== beforeLines.length) return null;
  const anchor = Int32Array.from(beforeLines, (_line, i) => i);
  return replay(sourceLines, beforeLines, after.split('\n'), anchor)?.join('\n') ?? null;
}

/** Character by character, for a block whose lines were wrapped or escaped differently. */
export function replayCharacters(source: string, before: string, after: string): string | null {
  const shared = commonRuns(before, source);
  if (!shared) return null;
  const anchor = new Int32Array(before.length).fill(-1);
  for (const [from, to, length] of shared) {
    for (let i = 0; i < length; i++) anchor[from + i] = to + i;
  }
  return replay(source, before, after, anchor)?.join('') ?? null;
}
