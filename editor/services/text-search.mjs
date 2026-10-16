export function searchRanges(text, { query, caseSensitive = false, wholeWord = false }) {
  if (!query) return [];
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = "[\\p{L}\\p{N}\\p{M}_]";
  const pattern = wholeWord ? `(?<!${word})${literal}(?!${word})` : literal;
  return [...text.matchAll(new RegExp(pattern, caseSensitive ? "gu" : "giu"))].map(match => ({ start: match.index, end: match.index + match[0].length }));
}

export function findRange(ranges, start, end, backwards = false) {
  return backwards ? ranges.findLast(range => range.end <= start) || ranges.at(-1)
    : ranges.find(range => range.start >= end) || ranges[0];
}

export function replaceRanges(text, ranges, replacement, selection) {
  const pieces = [];
  let previous = 0;
  for (const range of ranges) {
    pieces.push(text.slice(previous, range.start), replacement);
    previous = range.end;
  }
  pieces.push(text.slice(previous));
  const mapPosition = position => {
    let shift = 0;
    for (const range of ranges) {
      if (position < range.start) break;
      if (position <= range.end) return range.start + shift + Math.min(position - range.start, replacement.length);
      shift += replacement.length - (range.end - range.start);
    }
    return position + shift;
  };
  return { text: pieces.join(""), anchor: mapPosition(selection.anchor), position: mapPosition(selection.position) };
}
