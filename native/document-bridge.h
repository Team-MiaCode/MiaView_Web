#pragma once

#include <QJsonObject>
#include <QJsonArray>
#include <QHash>
#include "app/services/ChartWorkspace.h"

class WebDocument final
{
public:
    miacode::ChartWorkspace workspace;
    QJsonObject snapshot() const;
    QJsonObject command(const QJsonObject& request);
private:
    QJsonArray bookmarksForDifficulty(int id, const QString& text) const;
    mutable QHash<int, QPair<QString, QJsonArray>> bookmarkCache_;
};
