// Mirrors the pinned Scintilla DSL styles while retaining UTF-16 text offsets.
export function styleSourceLines(source) {
  const stack = [];
  return source.split("\n").map(text => {
    const spans = [];
    let comment = false;
    const append = (kind, value) => {
      const previous = spans.at(-1);
      if (previous?.kind === kind) previous.text += value;
      else spans.push({ kind, text: value });
    };
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (character === "|" && text[index + 1] === "|") comment = true;
      if (comment) { append("comment", character); continue; }
      if (text.startsWith("<HS*", index)) {
        const close = text.indexOf(">", index + 1);
        if (close >= 0) { append("keyword", text.slice(index, close + 1)); index = close; continue; }
      }
      let kind = stack.length ? stack.at(-1) === "]" ? "duration" : "keyword" : null;
      if ("({[".includes(character)) {
        stack.push({ "(": ")", "{": "}", "[": "]" }[character]);
        kind = character === "[" ? "duration" : "keyword";
      } else if (")}]".includes(character)) {
        kind = character === "]" ? "duration" : "keyword";
        const matching = stack.lastIndexOf(character);
        if (matching >= 0) stack.length = matching;
      }
      append(kind, character);
    }
    return spans;
  });
}
