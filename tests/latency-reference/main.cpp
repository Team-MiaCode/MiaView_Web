#include <QCoreApplication>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <cstdio>
#include "app/runtime/latency/LatencyAnalysis.h"

int main(int argc, char** argv) {
    QCoreApplication app(argc, argv);
    QJsonArray results;
    for (int argument = 1; argument < argc; ++argument) {
        using namespace miacode::latency_analysis;
        const QString fileName = QString::fromLocal8Bit(argv[argument]);
        const auto decoded = decodeMonoTrack(fileName, kAnalysisSampleRate);
        if (decoded.samples.isEmpty()) return 2;
        const auto onset = buildOnsetEnvelope(decoded.samples, decoded.sampleRate);
        const auto transient = buildTransientEnvelope(decoded.samples, decoded.sampleRate);
        const auto bpm = detectBpm(onset);
        OffsetDetectionInputs inputs;
        inputs.bpm = bpm.bpm; inputs.trackDurationSeconds = decoded.durationSeconds;
        inputs.lastDetectedMeterPhase = bpm.meterPhaseSeconds; inputs.hasLastDetectedMeterPhase = bpm.meterPhaseValid;
        inputs.lastDetectedMeterId = bpm.meterId;
        results.append(QJsonObject{{"file", fileName}, {"bpm", bpm.bpm}, {"meterId", bpm.meterId},
            {"offsetSeconds", detectOffset(onset, transient, inputs)}});
    }
    const auto json = QJsonDocument(results).toJson(QJsonDocument::Compact);
    std::puts(json.constData());
}
