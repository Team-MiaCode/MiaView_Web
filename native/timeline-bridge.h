#pragma once

#include <QJsonObject>
#include "timeline/TimelineQuickModel.h"
#include "timeline/TimelineSceneStateBuilder.h"
#include "timeline/TimelineNoteAssets.h"

class WebTimeline final
{
public:
    void load(const QString& text, double first, const miacode::simai::SimaiTimingMetadata& timing);
    void beginWaveform(int sampleCount, double duration);
    void addWaveformSamples(const float* samples, int count);
    double finishWaveform();
    void invalidateSkin() { skin_.clear(); }
    QJsonObject build(const QJsonObject& options);
    QJsonObject navigate(double x, double y) const;
    QJsonObject follow(double second) const;
private:
    QString text_;
    TimelineQuickModel model_;
    std::shared_ptr<miacode::waveform::WaveformData> waveform_;
    int waveformSampleCount_ = 0;
    int waveformSampleIndex_ = 0;
    int waveformLastBucket_ = -1;
    miacode::timeline::TimelineSceneState state_;
    QString skin_;
    miacode::timeline::TimelineNoteAssetSet assets_;
    QHash<QString, QJsonObject> images_;
};
