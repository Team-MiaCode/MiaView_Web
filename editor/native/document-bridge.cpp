#include "document-bridge.h"
#include <QJsonArray>

using namespace miacode;

QJsonObject WebDocument::snapshot() const
{
    const auto state = workspace.snapshot();
    const auto& document = workspace.document();
    const auto* difficulty = document.difficulty(state.activeDifficultyId);
    QJsonArray dirty, charts, designers;
    for (const int id : state.dirtyDifficultyIds) dirty.append(id);
    for (const int id : document.difficultyIds()) {
        const auto* chart = document.difficulty(id);
        charts.append(QJsonObject{{"id", id}, {"level", chart->level}, {"designer", chart->designer}, {"hasChart", true}});
    }
    for (int id = 1; id <= 7; ++id)
        designers.append(QJsonObject{{"id", id}, {"name", SimaiDocument::difficultyName(id)},
            {"designer", document.designerForSlot(id)}, {"hasChart", document.difficulty(id) != nullptr}});
    QString clockCount = "4";
    QVector<SimaiRawField> extra;
    for (const auto& field : document.extraFields) {
        if (field.key == QLatin1String("clock_count")) clockCount = field.value;
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
        {"unifiedDesignerEnabled", workspace.unifiedDesignerEnabled()},
        {"currentDifficultyLevel", difficulty ? difficulty->level : QString()},
        {"currentDifficultyDesigner", difficulty ? difficulty->designer : QString()}, {"currentDifficultyOffset", document.first}};
}

QJsonObject WebDocument::command(const QJsonObject& request)
{
    const QString id = request.value("id").toString();
    const auto args = request.value("args").toObject();
    const QString value = args.value("value").toString();
    const int difficulty = args.value("difficulty").toInt(workspace.snapshot().activeDifficultyId);
    bool accepted = true;
    if (id == "document.replaceActiveDifficultyChart") accepted = workspace.replaceActiveDifficultyChart(value).accepted;
    else if (id == "document.metadataTitle") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::Title, value);
    else if (id == "document.metadataArtist") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::Artist, value);
    else if (id == "document.metadataDesigner") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::Designer, value);
    else if (id == "document.metadataFirst" || id == "document.currentDifficultyOffset") accepted = workspace.updateDocumentField(ChartWorkspaceDocumentField::First, value);
    else if (id == "document.metadataClockCount") accepted = workspace.upsertExtraField("clock_count", value);
    else if (id == "document.metadataExtraText") {
        QString clockCount = "4";
        for (const auto& field : workspace.document().extraFields) if (field.key == "clock_count") clockCount = field.value;
        accepted = workspace.replaceExtraFields(value, clockCount).accepted;
    }
    else if (id == "document.currentDifficultyLevel") accepted = workspace.updateDifficultyField(difficulty, ChartWorkspaceDifficultyField::Level, value);
    else if (id == "document.currentDifficultyDesigner") accepted = workspace.updateDifficultyField(difficulty, ChartWorkspaceDifficultyField::Designer, value);
    else if (id == "document.selectDifficulty") accepted = workspace.selectDifficulty(difficulty);
    else if (id == "document.addDifficulty") accepted = workspace.addDifficulty(difficulty);
    else if (id == "document.removeDifficulty") accepted = workspace.removeDifficulty(difficulty);
    else if (id == "document.revertDifficulty") accepted = workspace.revertDifficultyChart(difficulty).accepted;
    else if (id == "document.markSectionSaved") accepted = workspace.markSectionSaved(args.value("section").toInt(), args.value("filePath").toString());
    else if (id == "document.close") accepted = workspace.closeDocument().accepted;
    else return {{"error", "Unknown document command: " + id}};
    return {{"accepted", accepted}, {"document", snapshot()}};
}
