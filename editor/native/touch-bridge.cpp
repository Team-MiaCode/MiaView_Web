#include "touch-bridge.h"
#include "core/scene/PreviewSceneGeometry.h"
#include "core/scene/PreviewSceneMath.h"
#include "core/scene/PreviewSceneConstants.h"
#include "core/scene/TouchPadAuthoringState.h"

using namespace miacode::preview::scene;

bool WebTouchInput::reset() {
    const bool changed = state_.touchPadAuthoringEnabled || !state_.hoveredTouchPad.isEmpty() || !state_.pressedTouchPad.isEmpty();
    state_.touchPadAuthoringEnabled = false;
    state_.hoveredTouchPad.clear(); state_.pressedTouchPad.clear(); pressedButton_ = Qt::NoButton;
    return changed;
}

QJsonObject WebTouchInput::pointer(const QJsonObject& request, const QSize& size, bool available, quint64 generation, int difficulty) {
    bool documentChanged = false;
    if (generation_ != generation || difficulty_ != difficulty) {
        documentChanged = reset(); generation_ = generation; difficulty_ = difficulty;
    }
    const auto phase = request.value("phase").toString();
    if (!available || !request.value("ctrl").toBool() || phase == "leave") return {{"changed", reset() || documentChanged}};
    const auto previousHover = state_.hoveredTouchPad, previousPress = state_.pressedTouchPad;
    const bool previousEnabled = state_.touchPadAuthoringEnabled;
    state_.touchPadAuthoringEnabled = true;
    const QPointF point(request.value("x").toDouble(), request.value("y").toDouble());
    const auto playfield = playfieldRectForStage(stageRectForSize(size), state_.render.layoutSquareScale);
    const double scale = kLogicalCanvasSize / playfield.width();
    const auto pad = playfield.contains(point)
        ? touchPadTokenAtLogicalPoint((point - playfield.topLeft()) * scale) : QString();
    const auto button = request.value("button").toInt() == 2 ? Qt::RightButton : Qt::LeftButton;
    QJsonObject result;
    if (phase == "press") {
        if (beginTouchPadAuthoringGesture(&state_.hoveredTouchPad, &state_.pressedTouchPad, pad)) pressedButton_ = button;
    } else if (phase == "move") {
        moveTouchPadAuthoringGesture(&state_.hoveredTouchPad, &state_.pressedTouchPad, pad);
    } else if (phase == "release") {
        const auto completed = finishTouchPadAuthoringGesture(&state_.hoveredTouchPad, &state_.pressedTouchPad, pad);
        if (!completed.isEmpty() && button == pressedButton_) {
            const Qt::KeyboardModifiers modifiers = Qt::ControlModifier
                | (request.value("shift").toBool() ? Qt::ShiftModifier : Qt::NoModifier);
            result.insert("action", QJsonObject{{"pad", completed}, {"separator", QString(touchPadAuthoringSeparator(button, modifiers))}});
        }
        pressedButton_ = Qt::NoButton;
    }
    result.insert("changed", !previousEnabled || previousHover != state_.hoveredTouchPad || previousPress != state_.pressedTouchPad);
    return result;
}
