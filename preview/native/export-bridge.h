#pragma once
#include <QJsonObject>
#include <QHash>
#include <QQmlEngine>
#include <QQuickItem>
#include "core/scene/PreviewFrameState.h"
#include "export/video_export/VideoExportAudioRenderPlan.h"
#include "export/video_export/VideoExportController.h"

class WebExportScene {
public:
    explicit WebExportScene(QQuickItem* parent):parent_(parent){}
    ~WebExportScene();
    QJsonObject storeAsset(const QString& kind,const QString& name,const QByteArray& data);
    QJsonObject configure(const QJsonObject& options,const miacode::preview::scene::PreviewFrameState& state,
        const QJsonObject& document,const PreviewAudioSettings& audio);
    QJsonObject frame(int index,miacode::preview::scene::PreviewFrameState& state);
    QJsonObject frameInfo(int index) const;
    void setStillFrame(bool still);
    void finish();
private:
    QQuickItem* parent_;
    QQmlEngine engine_;
    QQuickItem* intro_ = nullptr;
    VideoExportTask task_;
    miacode::video_export::VideoExportAudioRenderPlan plan_;
    QHash<QString,QString> assets_;
};
