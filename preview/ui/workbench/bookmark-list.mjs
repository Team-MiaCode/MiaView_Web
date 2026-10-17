import { element as h, button } from "../components/dom.mjs";
import { translate, formatMessage } from "../components/translate.mjs";

export function createBookmarkList(bookmarks, command, language) {
  const list = h("div", { id: "sidebar-bookmarks", className: "bookmark-list", role: "list", "aria-label": translate("qml.bookmarks", language) });
  for (const bookmark of bookmarks) {
    const label = formatMessage(translate("qml.line_1_2", language), bookmark.line, bookmark.title);
    const node = button(label, () => command("edit.jumpToLine", { line: bookmark.line }), { className: "bookmark-row", dataset: { line: bookmark.line } });
    node.addEventListener("keydown", event => {
      if (event.key === "Delete") { event.preventDefault(); command("edit.deleteBookmarkAtLine", { line: bookmark.line }); }
      else if (event.key === "F2") { event.preventDefault(); command("edit.promptRenameBookmark", { line: bookmark.line }); }
    });
    list.append(h("div", { role: "listitem" }, node));
  }
  return list;
}
