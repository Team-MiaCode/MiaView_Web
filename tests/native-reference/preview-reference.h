#pragma once
#include <QJsonObject>
#include <QSize>
#include <QString>

int capturePreview(const QJsonObject& fixture, const QSize& size, const QString& path);
