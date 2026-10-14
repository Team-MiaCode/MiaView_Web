#include "editor-reference.h"
#include "app/ui/editor/ScintillaDocumentAdapter.h"
#include "app/ui/editor/ScintillaDslStyler.h"
#include <QColor>
#include <QFontDatabase>
#include <QJsonDocument>
#include <QQuickRenderControl>
#include <QQuickWindow>

int captureEditor(const QJsonObject& fixture, const QSize& size, const QString& path)
{
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
    QQuickRenderControl control;
    QQuickWindow window(&control);
    window.setGeometry(0, 0, size.width(), size.height());
    QFontDatabase::addApplicationFont(fixture.value("fontPath").toString());
    ScintillaQuick_item item(window.contentItem());
    item.setSize(size);
    QFont font(QStringLiteral("Maple Mono Normal NL CN"));
    font.setPointSizeF(fixture.value("fontSize").toDouble(14));
    item.setProperty("font", QVariant::fromValue(font));
    miacode::ui::ScintillaDocumentAdapter document(item);
    document.activate(QStringLiteral("difficulty:5"), fixture.value("text").toString());
    document.refresh();
    miacode::ui::ScintillaDslStyler styler(item, document);
    QVariantMap colors;
    const auto palette = fixture.value("colors").toObject();
    for (auto it = palette.begin(); it != palette.end(); ++it)
        colors.insert(it.key(), QColor(it.value().toString()));
    colors.insert("followOpacity", .25);
    styler.setAppearance(font, colors);
    styler.style();
    const int spacing = fixture.value("blockSpacing").toInt(3);
    item.send(SCI_SETEXTRAASCENT, spacing / 2);
    item.send(SCI_SETEXTRADESCENT, spacing - spacing / 2);
    item.send(SCI_SETWRAPMODE, fixture.value("wrap").toBool() ? SC_WRAP_WORD : SC_WRAP_NONE);
    item.send(SCI_SETCARETSTYLE, CARETSTYLE_INVISIBLE);
    item.update();
    const int result = captureSurface(window, control, size, path);
    int textLeft = item.send(SCI_GETMARGINLEFT);
    for (int margin = 0; margin < item.send(SCI_GETMARGINS); ++margin)
        textLeft += item.send(SCI_GETMARGINWIDTHN, margin);
    const QJsonObject metrics{{"textLeft", textLeft}, {"lineHeight", int(item.send(SCI_TEXTHEIGHT, 0))},
        {"lineCount", int(item.send(SCI_GETLINECOUNT))}};
    qInfo().noquote() << "MIACODE_EDITOR_REFERENCE " << QJsonDocument(metrics).toJson(QJsonDocument::Compact);
    return result;
}
