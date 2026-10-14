#pragma once

#include <QJsonObject>
#include <QQmlEngine>
#include <QQuickItem>
#include "export/cover_export/CoverLayoutModel.h"

class WebCoverScene final : public QObject
{
    Q_OBJECT
public:
    explicit WebCoverScene(QQuickItem* parent);
    ~WebCoverScene() override;
    QJsonObject configure(const QJsonObject& values);
    QJsonObject snapshot() const;
    QSize outputSize() const;
    void setOutputSize(const QSize& size);
    void setVisible(bool visible);
    Q_INVOKABLE void selectLayerKey(const QString& key);
    Q_INVOKABLE void commitActiveLayerGeometry();
signals:
    void compositionChanged(const QJsonObject& value);
private:
    miacode::cover_export::CoverLayoutModel layout_;
    QQmlEngine engine_;
    QQuickItem* item_ = nullptr;
    QString selectedKey_ = QStringLiteral("card");
    QString error_;
};
