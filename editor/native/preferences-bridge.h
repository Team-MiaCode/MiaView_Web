#pragma once
#include <QByteArray>
#include <QJsonObject>
#include "core/scene/PreviewHudState.h"

QJsonObject webBackgroundSettings(const QJsonObject& values);
QJsonObject webImportFont(const QByteArray& bytes, const QString& name);
QJsonObject webHudFontPaths(const miacode::preview::scene::PreviewHudFontSettings& settings);
bool webSetHudFontPaths(const QJsonObject& values, miacode::preview::scene::PreviewHudFontSettings& settings, QString& error);
