#include "latency-bridge.h"
#include <QJsonArray>
#include <QtMath>
#include <algorithm>

using namespace miacode::latency_analysis;

void WebLatency::setSamples(const float* samples, int count, int rate) {
    onset_ = {}; transient_ = {}; bpm_ = {}; duration_ = 0;
    if (!samples || count <= 0 || rate <= 0) return;
    QVector<float> mono(count);
    std::copy(samples, samples + count, mono.begin());
    duration_ = double(count) / rate;
    onset_ = buildOnsetEnvelope(mono, rate);
    transient_ = buildTransientEnvelope(mono, rate);
}
QJsonObject WebLatency::detect(const QJsonObject& request) {
    if (onset_.isEmpty() || transient_.isEmpty()) return {{"error", "请导入可解码的音乐"}};
    const auto kind = request.value("kind").toString();
    if (kind == "bpm") {
        bpm_ = detectBpm(onset_);
        if (!(bpm_.bpm > 0)) return {{"error", "音乐中未检测到稳定 BPM"}};
        QJsonArray candidates;
        for (const auto& candidate : bpm_.candidates) candidates.append(QJsonObject{{"bpm", candidate.first}, {"score", candidate.second}});
        return {{"bpm", bpm_.bpm}, {"meterId", bpm_.meterId}, {"meterPhaseSeconds", bpm_.meterPhaseSeconds}, {"candidates", candidates}};
    }
    if (kind != "offset") return {{"error", "Unknown latency detection kind"}};
    OffsetDetectionInputs inputs;
    inputs.bpm = request.value("bpm").toDouble(); inputs.offsetAnchorSeconds = request.value("offsetSeconds").toDouble();
    if (!qIsFinite(inputs.bpm) || inputs.bpm <= 0 || !qIsFinite(inputs.offsetAnchorSeconds)) return {{"error", "BPM 与偏移需要有效数值"}};
    inputs.trackDurationSeconds = duration_;
    inputs.lastDetectedMeterPhase = bpm_.meterPhaseSeconds; inputs.hasLastDetectedMeterPhase = bpm_.meterPhaseValid;
    inputs.lastDetectedMeterId = bpm_.meterId;
    return {{"offsetSeconds", detectOffset(onset_, transient_, inputs)}};
}
