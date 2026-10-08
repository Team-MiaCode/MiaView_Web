#pragma once
#include <QObject>
#include <QSize>
#include <memory>
#include "core/scene/PreviewFrameState.h"
class QQuickWindow;
struct PreviewTextureStats;
// The browser host supplies frame state directly. Desktop authoring/device hooks
// remain disabled; this shim lets the original scene and HUD compile unchanged.
class PreviewRuntime : public QObject {
    Q_OBJECT
public:
    using QObject::QObject;
    std::shared_ptr<const miacode::preview::scene::PreviewFrameState> frameStateSnapshot() const { return {}; }
    void setFrameSize(const QSize&) {}
    void setHoveredTouchPad(const QString&) {}
    void setVisibleHostWindow(QQuickWindow*) {}
    void clearVisibleHostWindow(QQuickWindow*) {}
    void notifyVisibleFramePresented() {}
    void notifyFireworkLayerPresentedNode() {}
    template<class T> void notePresentedTextureStats(const T&) {}
    bool touchPadAuthoringEnabled() const { return false; }
    bool touchPadAuthoringPressActive() const { return false; }
    bool beginTouchPadAuthoringPress(const QString&) { return false; }
    bool finishTouchPadAuthoringPress(const QString&, QChar) { return false; }
    void cancelTouchPadAuthoringPress() {}
signals:
    void frameStateChanged();
};
