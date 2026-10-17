#pragma once
#include <QJsonObject>
#include "app/ui/editor/EditorController.h"

class WebEditor final
{
public:
    QJsonObject command(const QJsonObject& request, int difficultyId, quint64 documentOpenGeneration);
private:
    miacode::ui::EditorController controller_;
    quint64 documentOpenGeneration_ = 0;
};
