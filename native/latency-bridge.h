#pragma once
#include <QJsonObject>
#include "app/runtime/latency/LatencyAnalysis.h"

class WebLatency final {
public:
    void setSamples(const float* samples, int count, int rate);
    QJsonObject detect(const QJsonObject& request);
private:
    miacode::latency_analysis::Envelope onset_, transient_;
    miacode::latency_analysis::BpmDetectionResult bpm_;
    double duration_ = 0;
};
