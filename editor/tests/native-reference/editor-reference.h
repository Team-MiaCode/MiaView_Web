#pragma once
#include <QJsonObject>
#include <QSize>
#include <QString>
class QQuickWindow;
class QQuickRenderControl;
int captureSurface(QQuickWindow& window, QQuickRenderControl& control, const QSize& size, const QString& path);
int captureEditor(const QJsonObject& fixture, const QSize& size, const QString& path);
