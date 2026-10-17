#pragma once

#include <QJsonObject>
#include "timeline/TimelineQuickModel.h"
#include "timeline/TimelineSceneStateBuilder.h"
#include "timeline/TimelineNoteAssets.h"

class WebTimeline final
{
public:
    void load(const QString& text, double first, const miacode::simai::SimaiTimingMetadata& timing);
    void setWaveform(const float* samples, int count, double duration);
    QJsonObject build(const QJsonObject& options);
    QJsonObject navigate(double x, double y) const;
    QJsonObject follow(double second) const;
private:
    QString text_;
    TimelineQuickModel model_;
    miacode::waveform::WaveformDataPtr waveform_;
    miacode::timeline::TimelineSceneState state_;
    QString skin_;
    miacode::timeline::TimelineNoteAssetSet assets_;
    QHash<QString, QJsonObject> images_;
};
