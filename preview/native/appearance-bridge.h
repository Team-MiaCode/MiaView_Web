#pragma once

#include <QByteArray>
#include <QJsonObject>
#include <QString>

QJsonObject webImportAppearanceImage(const QJsonObject& request, const QByteArray& data);
QString webSkinDirectory(const QString& name);
QJsonObject webSkinImport(const QString& operation, const QString& name);
