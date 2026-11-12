#include "firework-layer.h"
#include "upstream-firework-layer.h"
#include "preview/quick_scene/PreviewQuickJudgeFireworkLayer.h"

#include "core/scene/PreviewFireworkWarmupPolicy.h"
#include "core/scene/PreviewJudgeFireworkLayerState.h"
#include "core/scene/PreviewSceneGeometry.h"

#include <QQuickWindow>
#include <QSGNode>

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

    void beginFrame(const PreviewFrameState& state)
    {
        const auto style = state.render.fireworkStyle;
        const auto& effect = state.judgeEffect.standardFirework.effect;
        const auto colorBallKey = style == PreviewFireworkStyle::Modern
            ? state.judgeEffect.modernFireworkColorBallImage.cacheKey() : 0;
        if (style_ != style || effect_ != effect || colorBallKey_ != colorBallKey) {
            style_ = style;
            effect_ = effect;
            colorBallKey_ = colorBallKey;
            pendingDraw_ = false;
            presented_ = false;
            fireworkPresented.store(false, std::memory_order_release);
        }
    }

    bool canIdle() const { return presented_; }

    void noteDraw()
    {
        pendingDraw_ = true;
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
    PreviewFireworkStyle style_ = PreviewFireworkStyle::Standard;
    std::shared_ptr<const PreviewStandardFireworkEffect> effect_;
    qint64 colorBallKey_ = 0;
    bool blocked_ = true;
    bool pendingDraw_ = false;
    bool presented_ = false;
};

PreviewFrameState warmupStateFor(const PreviewFrameState& state)
{
    PreviewFrameState warmup = state;
    TimelineNoteMarker marker;
    marker.type = QStringLiteral("touch");
    marker.isFirework = true;
    marker.second = fireworkWarmupMarkerSecond(state.playheadSeconds);
    marker.touchPoint = QPointF(kFireworkWarmupOffscreenCoordinate, kFireworkWarmupOffscreenCoordinate);
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
    root->beginFrame(state);

    const PreviewActiveMarkerView activeMarkers = preparedCache != nullptr && cursor != nullptr
        ? PreviewActiveMarkerView(state.noteMarkers, preparedCache->judgeFireworkLayer(), *cursor)
        : PreviewActiveMarkerView(state.noteMarkers);
    const PreviewJudgeFireworkLayerState layerState = buildPreviewJudgeFireworkLayerState(
        state, activeMarkers,
        playfieldRectForStage(stageRectForSize(renderSize), state.render.layoutSquareScale));

    if (!layerState.active && root->canIdle()) {
        root->setBlocked(true);
        return root;
    }

    const bool updated = layerState.active
        ? root->updateUpstream(state, preparedCache, cursor, renderSize, window, textures)
        : root->updateUpstream(warmupStateFor(state), nullptr, nullptr, renderSize, window, textures);
    if (updated) {
        root->noteDraw();
    } else {
        root->setBlocked(true);
    }
    return root;
}
