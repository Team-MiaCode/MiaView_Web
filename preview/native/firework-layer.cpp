#include "firework-layer.h"
#include "upstream-firework-layer.h"
#include "preview/quick_scene/PreviewQuickJudgeFireworkLayer.h"

#include "core/scene/PreviewFireworkWarmupPolicy.h"
#include "core/scene/PreviewJudgeFireworkLayerState.h"
#include "core/scene/PreviewSceneGeometry.h"

#include <QQuickWindow>
#include <QSGNode>
#include <QtMath>

#include <atomic>

namespace {

using namespace miacode::preview::scene;

// Each renderer document owns one WASM instance and one preview window.
std::atomic<bool> fireworkPresented{false};

class RetainedFireworkNode final : public QSGNode
{
public:
    explicit RetainedFireworkNode(QQuickWindow* window)
    {
        fireworkPresented.store(false, std::memory_order_release);
        presentConnection_ = QObject::connect(window, &QQuickWindow::frameSwapped, window,
            [this, window]() {
                if (pendingDraw_ && !blocked_) {
                    pendingDraw_ = false;
                    if (!presented_) {
                        presented_ = true;
                        fireworkPresented.store(true, std::memory_order_release);
                        window->update();
                    }
                }
            }, Qt::DirectConnection);
    }

    ~RetainedFireworkNode() override
    {
        QObject::disconnect(presentConnection_);
        fireworkPresented.store(false, std::memory_order_release);
    }

    bool isSubtreeBlocked() const override { return blocked_; }

    void setBlocked(bool blocked)
    {
        if (blocked_ != blocked) {
            blocked_ = blocked;
            markDirty(QSGNode::DirtySubtreeBlocked);
        }
        if (blocked) pendingDraw_ = false;
    }

    void beginFrame(qint64 sourceImageKey)
    {
        if (sourceImageKey_ != sourceImageKey) {
            presented_ = false;
            fireworkPresented.store(false, std::memory_order_release);
        }
    }

    bool canIdle(qint64 sourceImageKey) const
    {
        return presented_ && fireworkNode_ != nullptr && sourceImageKey_ == sourceImageKey;
    }

    bool needsBurstRestart() const { return hasRealBurst_ && !wasActive_; }
    void endBurst() { wasActive_ = false; }

    void noteDraw(qint64 sourceImageKey, bool realBurst)
    {
        sourceImageKey_ = sourceImageKey;
        pendingDraw_ = true;
        wasActive_ = realBurst;
        hasRealBurst_ |= realBurst;
        setBlocked(false);
    }

    bool updateUpstream(
        const PreviewFrameState& state,
        const PreviewPreparedSceneCache* preparedCache,
        const PreviewLayerWindowCursor* cursor,
        const QSize& renderSize,
        QQuickWindow* window,
        PreviewTextureRepository* textures)
    {
        QSGNode* updated = upstream_.updateNode(
            fireworkNode_, state, preparedCache, cursor, renderSize, window, textures);
        // Upstream returns null when inactive; its caller normally retires the
        // previous node. Keep ownership here so idle gaps retain its textures.
        if (updated == nullptr) return false;
        if (updated != fireworkNode_) {
            if (fireworkNode_ != nullptr) {
                removeChildNode(fireworkNode_);
                delete fireworkNode_;
            }
            fireworkNode_ = updated;
            appendChildNode(fireworkNode_);
        }
        return true;
    }

private:
    MiaViewUpstreamJudgeFireworkLayer upstream_;
    QSGNode* fireworkNode_ = nullptr;
    QMetaObject::Connection presentConnection_;
    qint64 sourceImageKey_ = -1;
    bool blocked_ = true;
    bool pendingDraw_ = false;
    bool presented_ = false;
    bool wasActive_ = false;
    bool hasRealBurst_ = false;
};

PreviewFrameState warmupStateFor(const PreviewFrameState& state, qreal elapsedToAvoid = -1.0)
{
    PreviewFrameState warmup = state;
    TimelineNoteMarker marker;
    marker.type = QStringLiteral("touch");
    marker.isFirework = true;
    marker.second = fireworkWarmupMarkerSecond(state.playheadSeconds);
    marker.touchPoint = QPointF(kFireworkWarmupOffscreenCoordinate, kFireworkWarmupOffscreenCoordinate);
    // A transparent update between independent bursts lets upstream's own
    // trigger-change logic choose a fresh random star angle on the next draw.
    // Avoid equal triggers when restarting at exactly the warm-up lead time.
    if (qFuzzyCompare(elapsedToAvoid + 1.0, kFireworkWarmupLeadSeconds + 1.0)) {
        marker.second += kFireworkWarmupLeadSeconds * 0.5;
    }
    warmup.noteMarkers = {marker};
    return warmup;
}

}  // namespace

bool miaview::firework::ready()
{
    return fireworkPresented.load(std::memory_order_acquire);
}

QSGNode* PreviewQuickJudgeFireworkLayer::updateNode(
    QSGNode* oldNode,
    const PreviewFrameState& state,
    const PreviewPreparedSceneCache* preparedCache,
    const PreviewLayerWindowCursor* cursor,
    const QSize& renderSize,
    QQuickWindow* window,
    PreviewTextureRepository* textures
) const
{
    if (window == nullptr || textures == nullptr) return nullptr;

    auto* root = dynamic_cast<RetainedFireworkNode*>(oldNode);
    if (root == nullptr) root = new RetainedFireworkNode(window);
    const qint64 sourceImageKey = state.judgeEffect.fireworkColorBallImage.cacheKey();
    root->beginFrame(sourceImageKey);

    const PreviewActiveMarkerView activeMarkers = preparedCache != nullptr && cursor != nullptr
        ? PreviewActiveMarkerView(state.noteMarkers, preparedCache->judgeFireworkLayer(), *cursor)
        : PreviewActiveMarkerView(state.noteMarkers);
    const PreviewJudgeFireworkLayerState layerState = buildPreviewJudgeFireworkLayerState(
        state, activeMarkers,
        playfieldRectForStage(stageRectForSize(renderSize), state.render.layoutSquareScale));

    if (layerState.active) {
        if (root->needsBurstRestart()) {
            root->updateUpstream(warmupStateFor(state, layerState.clipTimeSeconds),
                nullptr, nullptr, renderSize, window, textures);
        }
        if (root->updateUpstream(state, preparedCache, cursor, renderSize, window, textures)) {
            root->noteDraw(sourceImageKey, true);
        } else {
            root->setBlocked(true);
        }
        return root;
    }

    root->endBurst();
    if (root->canIdle(sourceImageKey)) {
        root->setBlocked(true);
        return root;
    }

    if (root->updateUpstream(warmupStateFor(state), nullptr, nullptr, renderSize, window, textures)) {
        root->noteDraw(sourceImageKey, false);
    } else {
        root->setBlocked(true);
    }
    return root;
}
