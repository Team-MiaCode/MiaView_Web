#pragma once

#include <QJsonObject>
#include <QSize>
#include "core/scene/PreviewFrameState.h"

class WebTouchInput final {
public:
    explicit WebTouchInput(miacode::preview::scene::PreviewFrameState& state) : state_(state) {}
    QJsonObject pointer(const QJsonObject& request, const QSize& size, bool available, quint64 generation, int difficulty);
    bool reset();
private:
    miacode::preview::scene::PreviewFrameState& state_;
    Qt::MouseButton pressedButton_ = Qt::NoButton;
    quint64 generation_ = 0;
    int difficulty_ = 0;
};
