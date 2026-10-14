#pragma once

#include <QJsonObject>
#include "app/services/ChartWorkspace.h"

class WebDocument final
{
public:
    miacode::ChartWorkspace workspace;
    QJsonObject snapshot() const;
    QJsonObject command(const QJsonObject& request);
};
