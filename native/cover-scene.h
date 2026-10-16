#pragma once

#include <QJsonObject>
#include <QQmlEngine>
#include <QQuickItem>
#include <QElapsedTimer>
#include <QPointer>
#include <map>
#include <memory>
#include "core/scene/PreviewFrameState.h"
#include "preview/quick_scene/PreviewQuickSceneRoot.h"
#include "export/cover_export/CoverFramePlaybackController.h"
#include "export/cover_export/CoverLayoutModel.h"

class WebCoverScene final : public QObject
{
    Q_OBJECT
public:
    explicit WebCoverScene(QQuickItem* parent);
    ~WebCoverScene() override;
    QJsonObject configure(const QJsonObject& values);
    QJsonObject command(const QString& id, const QJsonObject& args);
    QJsonObject snapshot();
    QJsonObject layoutFile() const;
    QSize outputSize() const;
    void setOutputSize(const QSize& size);
    void setVisible(bool visible);
    void setEditable(bool editable);
    void setChartState(const miacode::preview::scene::PreviewFrameState& state, double duration);
    bool setPvFrame(const QString& key, const QImage& image, double seconds);
    bool isVisible() const { return item_ && item_->isVisible(); }
    Q_INVOKABLE void selectLayerKey(const QString& key);
    Q_INVOKABLE void commitActiveLayerGeometry();
signals:
    void compositionChanged(const QJsonObject& value);
    void playbackChanged(const QJsonObject& value);
private slots:
    void syncFrames();
private:
    struct ChartFrame {
        miacode::preview::scene::PreviewFrameState state;
        QPointer<PreviewQuickSceneRoot> root;
        ~ChartFrame() { delete root.data(); }
    };
    void syncSelection();
    void updateFrame(miacode::cover_export::CoverLayer* layer);
    void publishPlayback(bool force = false);
    void synchronizePlayback();
    miacode::cover_export::CoverLayoutModel layout_;
    QQmlEngine engine_;
    QQuickItem* item_ = nullptr;
    QString selectedKey_ = QStringLiteral("card");
    QString error_;
    QJsonObject values_;
    QJsonObject template_;
    QString modeSource_;
    int modeDifficulty_ = 0;
    QString detectedMode_ = QStringLiteral("Standard");
    miacode::preview::scene::PreviewFrameState chartState_;
    miacode::cover_export::CoverFramePlaybackController playback_;
    QElapsedTimer playbackPublishClock_;
    QElapsedTimer playbackClock_;
    bool synchronizingPlayback_ = false;
    std::map<QString, std::unique_ptr<ChartFrame>> frames_;
    bool chartAvailable_ = false;
    QString playbackLayerKey_;
};

QJsonObject webImportCoverImage(const QByteArray& data);
