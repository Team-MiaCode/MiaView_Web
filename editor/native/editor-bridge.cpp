#include "editor-bridge.h"
#include "app/ui/document/ChartTransformCommands.h"
#include "core/chart/selection/ChartSelectionBeatSummary.h"
#include "app/services/ChartNormalizationPreferences.h"
#include <QJsonArray>

QJsonObject WebEditor::command(const QJsonObject& request, int difficultyId, quint64 documentOpenGeneration)
{
    const auto id = request.value("id").toString();
    const auto args = request.value("args").toObject();
    const auto text = args.value("text").toString();
    const int anchor = qBound(0, args.value("anchor").toInt(), int(text.size()));
    const int position = qBound(0, args.value("position").toInt(anchor), int(text.size()));
    const int begin = qMin(anchor, position), end = qMax(anchor, position);
    if (documentOpenGeneration_ != documentOpenGeneration) {
        controller_.closeCompletion();
        documentOpenGeneration_ = documentOpenGeneration;
    }
    controller_.setDifficulty(difficultyId);
    const auto settings = args.value("settings").toObject();
    if (settings.contains("halfWidthInputEnabled")) controller_.setHalfWidthInputEnabled(settings.value("halfWidthInputEnabled").toBool());
    if (settings.contains("overwriteMode")) controller_.setOverwriteMode(settings.value("overwriteMode").toBool());
    if (settings.contains("autoCompletionEnabled")) controller_.setAutoCompletionEnabled(settings.value("autoCompletionEnabled").toBool());
    if (settings.contains("wholeBpm")) controller_.setWholeBpm(settings.value("wholeBpm").toString());
    if (id == "edit.selectionBeats") {
        const auto summary = miacode::chart_selection::summarizeChartSelectionBeats(text, begin, end);
        QJsonArray parts;
        for (const auto& part : summary.parts) parts.append(QJsonObject{{"count", part.count}, {"denominator", part.denominator}});
        return {{"totalCommaCount", summary.totalCommaCount}, {"exact", summary.exact}, {"parts", parts}};
    }
    miacode::editor::SimaiTextEditResult result;
    result.transaction.anchor = anchor;
    result.transaction.position = position;
    if (id == "edit.processKey") result = controller_.processKey(text, anchor, position, args.value("input").toString(), args.value("key").toInt(), args.value("modifiers").toInt());
    else if (id == "edit.acceptCompletion") result = controller_.acceptCompletion(text, anchor, position);
    else if (id == "edit.selectCompletionIndex") { controller_.selectCompletionIndex(args.value("index").toInt()); result.consumed = true; }
    else if (id == "edit.dismissCompletion") { controller_.closeCompletion(); result.consumed = true; }
    else if (id == "edit.updateCompletion") controller_.updateCompletion(text, position);
    else if (id == "edit.triggerCompletion") {
        const auto glyph = args.value("glyph").toString();
        if (glyph.size() != 1) return {{"error", "Completion glyph must contain one character"}};
        controller_.triggerCompletion(glyph.at(0), text, position, args.value("closingPresent").toBool());
    }
    else if (id == "edit.touchPadAuthoring") {
        const auto separator = args.value("separator").toString(",");
        if (separator.size() != 1) return {{"error", "Touch separator must contain one character"}};
        result = controller_.touchPadAuthoring(text, anchor, position, args.value("pad").toString(), separator.at(0));
    }
    else if (id == "edit.createBookmark" || id == "edit.renameBookmark" || id == "edit.deleteBookmark") {
        const int offset = text.left(position).lastIndexOf(QLatin1Char('\n')) + 1;
        const int newline = text.indexOf(QLatin1Char('\n'), offset);
        const auto line = text.mid(offset, newline < 0 ? -1 : newline - offset);
        const auto title = args.value("title").toString();
        if (id == "edit.createBookmark") result = controller_.createBookmark(line, offset, title);
        else if (id == "edit.renameBookmark") result = controller_.renameBookmark(line, offset, title);
        else result = controller_.deleteBookmark(line, offset);
    }
    else if (id == "edit.normalizeChart") {
        using namespace miacode::chart_transform;
        const auto options = miacode::app_preferences::chartNormalizationOptionsFromPreferences(args.value("preferences").toObject());
        const auto timing = miacode::simai::buildTimingMetadataFromRawText(args.value("sourceText").toString());
        const bool selected = begin != end;
        const auto normalized = selected ? normalizeChartSelectionText(text, begin, end, timing, options) : normalizeChartText(text, timing, options);
        if (!normalized.ok) return {{"error", normalized.errorMessage}};
        const QString replacement = selected ? composeNormalizedSelectionReplacement(text, begin, end, normalized.text) : normalized.text;
        result.consumed = true;
        result.transaction.hasEdit = replacement != (selected ? text.mid(begin, end - begin) : text);
        result.transaction.replacementStart = selected ? begin : 0;
        result.transaction.replacementEnd = selected ? end : text.size();
        result.transaction.replacementText = replacement;
        result.transaction.anchor = result.transaction.replacementStart;
        result.transaction.position = result.transaction.anchor + replacement.size();
    }
    else if (id.startsWith("transform.")) {
        int changed = 0;
        QString replacement;
        bool known = false;
        for (const auto& spec : miacode::ui::chartTransformSpecs()) {
            if (spec.id != id) continue;
            known = true;
            if (spec.apply) replacement = spec.apply(text.mid(begin, end - begin), {text.left(begin), text.mid(end)}, &changed);
            else {
                const auto whole = id == "transform.reset_tap_notes"
                    ? miacode::chart_transform::resetTapNotesInSelection(text, begin, end, &changed)
                    : miacode::chart_transform::clearCompleteElementsInSelection(text, begin, end, &changed);
                replacement = whole.mid(begin, whole.size() - text.size() + end - begin);
            }
            break;
        }
        if (!known) return {{"error", "Unknown chart transform: " + id}};
        result.consumed = true;
        result.transaction.hasEdit = replacement != text.mid(begin, end - begin);
        result.transaction.replacementStart = begin;
        result.transaction.replacementEnd = end;
        result.transaction.replacementText = replacement;
        result.transaction.anchor = begin;
        result.transaction.position = begin + replacement.size();
    }
    else return {{"error", "Unknown editor command: " + id}};
    const auto& tx = result.transaction;
    return {{"consumed", result.consumed}, {"error", result.error}, {"suppressFallbackInsert", result.suppressFallbackInsert},
        {"transaction", QJsonObject{{"hasEdit", tx.hasEdit}, {"replacementStart", tx.replacementStart}, {"replacementEnd", tx.replacementEnd},
            {"replacementText", tx.replacementText}, {"anchor", tx.anchor}, {"position", tx.position}, {"touchTokenStart", tx.touchTokenStart}}},
        {"completionActive", controller_.completionActive()}, {"completionCandidates", QJsonArray::fromStringList(controller_.completionCandidates())},
        {"completionIndex", controller_.completionIndex()}};
}
