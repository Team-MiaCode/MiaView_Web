#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <emscripten/emscripten.h>
#include <memory>
#include "core/chart/document/SimaiDocument.h"
#include "core/chart/parser/SimaiParser.h"
#include "core/chart/model/TimelineMarkerOffset.h"
#include "core/analysis/MuriAnalyzer.h"
#include "core/analysis/MuriPanelEntries.h"
#include "core/analysis/MuriStaticChecker.h"

namespace {
std::unique_ptr<QCoreApplication> application;
QByteArray response;
}

extern "C" EMSCRIPTEN_KEEPALIVE const char* miacode_analysis(const char* source) {
    const auto input = QJsonDocument::fromJson(QByteArray(source)).object();
    const auto doc = SimaiDocument::fromText(input.value("sourceText").toString());
    const int difficultyId = input.value("difficultyId").toInt();
    const double revision = input.value("revision").toDouble();
    const double generation = input.value("documentOpenGeneration").toDouble();
    const QString localeToken = input.value("language").toString();
    const auto* difficulty = doc.difficulty(difficultyId);
    MuriRenderOptions options;
    options.renderMode = muriRenderModeFromToken(input.value("renderMode").toString());
    QJsonArray validationRows, muriRows;
    int errors = 0, warnings = 0;
    const auto locale = localeToken.startsWith("zh") ? SimaiValidationLocale::Chinese
        : localeToken.startsWith("ja") ? SimaiValidationLocale::Japanese : SimaiValidationLocale::English;
    if (input.value("hasDocument").toBool() && difficulty) {
        const auto timing = miacode::simai::buildTimingMetadata(doc);
        const auto parsed = SimaiParser::parseForTimeline(difficulty->chart, timing);
        const auto validation = SimaiParser::buildValidationReport(difficulty->chart, locale, &parsed, timing);
        errors = validation.errorCount;
        warnings = validation.warningCount;
        for (const auto& issue : validation.issues) {
            validationRows.append(QJsonObject{{"line", issue.line}, {"column", issue.col}, {"endColumn", issue.endCol},
                {"second", -1}, {"severity", issue.severity == SimaiValidationSeverity::Warning ? "warning" : "error"},
                {"detail", issue.displayMessage}, {"difficultyId", difficultyId},
                {"revision", double(revision)}, {"documentOpenGeneration", double(generation)}});
        }
        if (parsed.ok) {
            bool firstOk = false;
            const double first = miacode::timeline::offset::parsedFirstSeconds(doc.first, &firstOk);
            if (firstOk && qIsFinite(first)) {
                const auto markers = miacode::timeline::offset::shiftedNoteMarkers(parsed.noteMarkers, first,
                    miacode::timeline::offset::NonFiniteHandling::Propagate);
                const auto report = MuriAnalyzer::analyze(markers, options);
                const auto references = miacode::muri::buildStaticMuriReferences(markers,
                    miacode::muri::kStaticTapOnSlideThresholdDefaultMs / 1000.0);
                for (const auto& entry : miacode::muri::buildVisibleMuriPanelEntries(report, references)) {
                    const bool warning = entry.alertLevel == MuriAlertLevel::Warning;
                    QString detail = renderMuriDetail(entry.detailKind, entry.detailArgs, locale).trimmed();
                    if (detail.isEmpty()) detail = entry.rawDetail;
                    muriRows.append(QJsonObject{{"line", qMax(1, entry.line)}, {"column", qMax(1, entry.col)},
                        {"endColumn", qMax(1, entry.col)}, {"second", entry.second}, {"severity", warning ? "warning" : "error"},
                        {"alert", warning ? "warning" : "muri"}, {"title", muriKindDisplayName(entry.kind, locale == SimaiValidationLocale::Chinese)},
                        {"detail", detail}, {"difficultyId", difficultyId}, {"revision", double(revision)},
                        {"documentOpenGeneration", double(generation)}});
                }
            }
        }
    }
    const QJsonObject result{{"available", input.value("hasDocument").toBool() && difficulty != nullptr}, {"pending", false},
        {"revision", double(revision)}, {"documentOpenGeneration", double(generation)},
        {"difficultyId", difficultyId}, {"validationRows", validationRows}, {"muriRows", muriRows},
        {"syntaxErrorCount", errors}, {"syntaxWarningCount", warnings}};
    response = QJsonDocument(result).toJson(QJsonDocument::Compact);
    return response.constData();
}

int main(int argc, char** argv) {
    application = std::make_unique<QCoreApplication>(argc, argv);
    return 0;
}
