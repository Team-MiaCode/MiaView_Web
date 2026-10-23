#include "document-bridge.h"
#include <QJsonArray>
#include "editor/BookmarkCommentSyntax.h"
#include "core/chart/document/ChartClockCount.h"
#include "core/chart/model/TimelineMarkerOffset.h"

using namespace miacode;

QJsonArray WebDocument::bookmarksForDifficulty(int id, const QString& text) const
{
    const auto cached = bookmarkCache_.constFind(id);
    if (cached != bookmarkCache_.cend() && cached->first == text) return cached->second;
    QJsonArray bookmarks;
    const auto lines = text.split(QLatin1Char('\n'));
    for (int index = 0; index < lines.size(); ++index) {
        const auto bookmark = miacode::editor::parseBookmarkComment(lines.at(index));
        if (bookmark && !bookmark->control) bookmarks.append(QJsonObject{{"line", index + 1}, {"title", bookmark->title}});
    }
    bookmarkCache_.insert(id, {text, bookmarks});
    return bookmarks;
}

QJsonObject WebDocument::snapshot() const
{
    const auto state = workspace.snapshot();
    const auto& document = workspace.document();
    const auto* difficulty = document.difficulty(state.activeDifficultyId);
    QJsonArray dirty, charts, designers;
    for (const int id : state.dirtyDifficultyIds) dirty.append(id);
    for (const int id : document.difficultyIds()) {
        const auto* chart = document.difficulty(id);
        charts.append(QJsonObject{{"id", id}, {"level", chart->level}, {"designer", chart->designer}, {"hasChart", true},
            {"bookmarks", bookmarksForDifficulty(id, chart->chart)}});
    }
    for (int id = 1; id <= 7; ++id)
        designers.append(QJsonObject{{"id", id}, {"name", SimaiDocument::difficultyName(id)},
            {"designer", document.designerForSlot(id)}, {"hasChart", document.difficulty(id) != nullptr}});
    QString clockCount;
    QString wholeBpm;
    const double bpm = miacode::chart_clock::clockBpmForChart(document, difficulty ? difficulty->chart : QString());
    const int count = miacode::chart_clock::clockCountFromDocument(document);
    QVector<SimaiRawField> extra;
    for (const auto& field : document.extraFields) {
        if (field.key.compare(QLatin1String("wholebpm"), Qt::CaseInsensitive) == 0) wholeBpm = field.value.trimmed();
        if (field.key.compare(QLatin1String("clock_count"), Qt::CaseInsensitive) == 0) clockCount = field.value;
        else extra.append(field);
    }
    return {{"sourceText", state.sourceText}, {"chartText", difficulty ? difficulty->chart : QString()},
        {"filePath", state.filePath}, {"activeDifficultyId", state.activeDifficultyId},
        {"revision", double(state.revision)}, {"dirty", state.dirty}, {"metadataDirty", workspace.metadataDirty()},
        {"hasDocument", state.hasDocument}, {"dirtyDifficultyIds", dirty}, {"documentOpenGeneration", double(state.documentOpenGeneration)},
        {"title", document.title}, {"artist", document.artist}, {"designer", document.designer}, {"first", document.first},
        {"metadataTitle", document.title}, {"metadataArtist", document.artist}, {"metadataDesigner", document.designer},
        {"metadataFirst", document.first}, {"metadataClockCount", clockCount}, {"metadataExtraText", SimaiDocument::serializeRawFields(extra)},
        {"metadataVideoPath", document.videoPath}, {"charts", charts}, {"designerSlots", designers},
        {"unifiedDesignerEnabled", workspace.unifiedDesignerEnabled()}, {"wholeBpm", wholeBpm},
        {"bpm", bpm}, {"clockCount", count},
        {"offsetSeconds", miacode::timeline::offset::parsedFirstSeconds(document.first)},
        {"currentDifficultyLevel", difficulty ? difficulty->level : QString()},
        {"currentDifficultyDesigner", difficulty ? difficulty->designer : QString()}, {"currentDifficultyOffset", document.first}};
}

QJsonObject WebDocument::command(const QJsonObject& request)
{
    const QString id = request.value("id").toString();
    const auto args = request.value("args").toObject();
    const QString value = args.value("value").toString();
    const auto state = workspace.snapshot();
    const int difficulty = args.value("difficulty").toInt(state.activeDifficultyId);
    if (args.contains("documentOpenGeneration") && args.value("documentOpenGeneration").toDouble() != double(state.documentOpenGeneration))
        return {{"error", "The document changed during editing"}};
    if (id == "document.replaceActiveDifficultyChart" && difficulty != state.activeDifficultyId)
        return {{"error", "The active difficulty changed during editing"}};
    bool accepted = true;
    if (id == "document.replaceActiveDifficultyChart") accepted = workspace.replaceActiveDifficultyChart(value).accepted;
    else if (id == "document.metadataTitle") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::Title, value);
    else if (id == "document.metadataArtist") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::Artist, value);
    else if (id == "document.metadataVideoPath") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::VideoPath, value);
    else if (id == "document.metadataDesigner") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::Designer, value);
    else if (id == "document.metadataFirst" || id == "document.currentDifficultyOffset") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::First, value);
    else if (id == "document.metadataClockCount") accepted = workspace.upsertExtraField("clock_count", value);
    else if (id == "document.wholeBpm") accepted = workspace.upsertExtraField("wholebpm", value);
    else if (id == "document.metadataExtraText") {
        QString clockCount;
        for (const auto& field : workspace.document().extraFields)
            if (field.key.compare(QLatin1String("clock_count"), Qt::CaseInsensitive) == 0) clockCount = field.value;
        accepted = workspace.replaceExtraFields(value, clockCount).accepted;
    }
    else if (id == "document.applyDesignerSlots") {
        const bool modeWas = workspace.unifiedDesignerEnabled();
        const bool unified = args.value("unified").toBool();
        if (modeWas) workspace.setUnifiedDesignerEnabled(false);
        bool changed = false;
        for (const auto& value : args.value("slots").toArray()) {
            const auto slot = value.toObject();
            const int slotId = slot.value("id").toInt();
            if (slotId >= 1 && slotId <= 7)
                changed = workspace.setDesignerForSlot(slotId, slot.value("designer").toString()) || changed;
        }
        if (unified) {
            workspace.setUnifiedDesignerEnabled(true);
            changed = workspace.unifyDesigners(args.value("canonicalName").toString()) || changed;
        }
        accepted = changed || modeWas != unified;
    }
    else if (id == "document.restorePreferences") {
        workspace.setUnifiedDesignerEnabled(args.value("unifiedDesignerEnabled").toBool() && workspace.document().isUnifiedDesignerTriviallySafe());
    }
    else if (id == "document.currentDifficultyLevel") accepted = workspace.updateDifficultyField(difficulty, ChartWorkspaceDifficultyField::Level, value);
    else if (id == "document.currentDifficultyDesigner") accepted = workspace.updateDifficultyField(difficulty, ChartWorkspaceDifficultyField::Designer, value);
    else if (id == "document.selectDifficulty") accepted = workspace.selectDifficulty(difficulty);
    else if (id == "document.addDifficulty") accepted = workspace.addDifficulty(difficulty);
    else if (id == "document.removeDifficulty") accepted = workspace.removeDifficulty(difficulty);
    else if (id == "document.revertDifficulty") accepted = workspace.revertDifficultyChart(difficulty).accepted;
    else if (id == "document.markSectionSaved") {
        const auto filePath = args.value("filePath").toString();
        if (args.contains("sourceText")) {
            if (!filePath.isEmpty() && filePath != state.filePath) workspace.markSaved(filePath);
            accepted = workspace.rebindSavePoint(args.value("sourceText").toString());
        } else accepted = workspace.markSectionSaved(args.value("section").toInt(), filePath);
    }
    else if (id == "document.replaceSource") accepted = workspace.replaceSource(args.value("sourceText").toString()).accepted;
    else if (id == "document.close") accepted = workspace.closeDocument().accepted;
    else return {{"error", "Unknown document command: " + id}};
    return {{"accepted", accepted}, {"document", snapshot()}};
}
