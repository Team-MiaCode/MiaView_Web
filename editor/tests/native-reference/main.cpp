#include <QCommandLineParser>
#include <QFile>
#include <QGuiApplication>
#include <QFontDatabase>
#include <QJsonArray>
#include <QJsonDocument>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQmlExtensionPlugin>
#include <QQuickStyle>
#include <QQuickRenderControl>
#include <QQuickRenderTarget>
#include <QQuickWindow>
#include <rhi/qrhi.h>
#include <QTranslator>
#include <cmath>
#include "editor-reference.h"
#include "preview-reference.h"

#include "export/cover_export/CoverLayoutModel.h"
#include "timeline/TimelineQuickModel.h"
#include "timeline/quick/TimelineQuickItem.h"
#include "timeline/quick/TimelineQuickStateBridge.h"

Q_IMPORT_QML_PLUGIN(MiaCode_PreviewPlugin)

int captureSurface(QQuickWindow& window, QQuickRenderControl& control, const QSize& size, const QString& path)
{
    if (!control.initialize()) return 2;
    auto* rhi = control.rhi();
    std::unique_ptr<QRhiTexture> texture(rhi->newTexture(QRhiTexture::RGBA8, size, 1,
        QRhiTexture::RenderTarget | QRhiTexture::UsedAsTransferSource));
    std::unique_ptr<QRhiRenderBuffer> depth(rhi->newRenderBuffer(QRhiRenderBuffer::DepthStencil, size));
    if (!texture->create() || !depth->create()) return 2;
    QRhiTextureRenderTargetDescription description{QRhiColorAttachment(texture.get())};
    description.setDepthStencilBuffer(depth.get());
    std::unique_ptr<QRhiTextureRenderTarget> target(rhi->newTextureRenderTarget(description));
    std::unique_ptr<QRhiRenderPassDescriptor> pass(target->newCompatibleRenderPassDescriptor());
    target->setRenderPassDescriptor(pass.get());
    if (!target->create()) return 2;
    window.setRenderTarget(QQuickRenderTarget::fromRhiRenderTarget(target.get()));
    QRhiReadbackResult result;
    bool completed = false;
    result.completed = [&completed] { completed = true; };
    for (int frame = 0; frame < 4; ++frame) {
        QCoreApplication::processEvents();
        control.polishItems();
        control.beginFrame();
        control.sync();
        control.render();
        if (frame == 3) {
            auto* updates = rhi->nextResourceUpdateBatch();
            updates->readBackTexture(QRhiReadbackDescription(texture.get()), &result);
            control.commandBuffer()->resourceUpdate(updates);
        }
        control.endFrame();
    }
    rhi->finish();
    if (!completed) return 2;
    QImage image(reinterpret_cast<const uchar*>(result.data.constData()), size.width(), size.height(), QImage::Format_RGBA8888_Premultiplied);
    const bool saved = (rhi->isYUpInFramebuffer() ? image.flipped(Qt::Vertical) : image).save(path);
    window.setRenderTarget(QQuickRenderTarget());
    target.reset(); pass.reset(); depth.reset(); texture.reset();
    control.invalidate();
    return saved ? 0 : 2;
}
int captureTimeline(TimelineQuickStateBridge* bridge, const QSize& size, const QString& path)
{
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Direct3D11);
    QQuickRenderControl control;
    QQuickWindow window(&control);
    window.setGeometry(0, 0, size.width(), size.height());
    TimelineQuickItem item(window.contentItem());
    item.setSize(size);
    item.setStateBridge(bridge);
    const int result = captureSurface(window, control, size, path);
    item.setStateBridge(nullptr);
    return result;
}

int main(int argc, char** argv)
{
    QGuiApplication application(argc, argv);
    QQuickStyle::setStyle(QStringLiteral("Basic"));
    QCommandLineParser arguments;
    arguments.addHelpOption();
    arguments.addOption({"I", "QML import path", "path"});
    arguments.addOption({"translation", "Translation catalogue", "file"});
    arguments.addOption({"layout", "Cover layout fixture", "file"});
    arguments.addOption({"timeline", "Timeline fixture", "file"});
    arguments.addOption({"editor", "Editor appearance fixture", "file"});
    arguments.addOption({"preview", "Preview scene fixture", "file"});
    arguments.addOption({"capture", "Offscreen timeline capture", "file"});
    arguments.addOption({"viewport", "Timeline viewport size", "size", "800x240"});
    arguments.addPositionalArgument("scene", "Original QML reference scene");
    arguments.process(application);
    if (arguments.isSet("preview")) {
        QFile fixture(arguments.value("preview"));
        const auto dimensions = arguments.value("viewport").split('x');
        if (!fixture.open(QIODevice::ReadOnly) || dimensions.size() != 2 || !arguments.isSet("capture")) return 2;
        const auto value = QJsonDocument::fromJson(fixture.readAll());
        if (!value.isObject()) return 2;
        return capturePreview(value.object(), QSize(dimensions[0].toInt(), dimensions[1].toInt()), arguments.value("capture"));
    }
    if (arguments.positionalArguments().size() != 1 && !arguments.isSet("capture"))
        arguments.showHelp(2);

    if (arguments.isSet("editor")) {
#ifdef MIACODE_REFERENCE_EDITOR
        QFile fixture(arguments.value("editor"));
        if (!fixture.open(QIODevice::ReadOnly)) return 2;
        const auto value = QJsonDocument::fromJson(fixture.readAll());
        const auto dimensions = arguments.value("viewport").split('x');
        if (!value.isObject() || dimensions.size() != 2) return 2;
        return captureEditor(value.object(), QSize(dimensions[0].toInt(), dimensions[1].toInt()), arguments.value("capture"));
#else
        qCritical("Initialize the pinned editor reference sources and rebuild the reference host");
        return 2;
#endif
    }

    QTranslator translator;
    if (!arguments.value("translation").isEmpty()) {
        if (!translator.load(arguments.value("translation")))
            return 2;
        application.installTranslator(&translator);
    }
    miacode::cover_export::CoverLayoutModel layout;
    if (!arguments.value("layout").isEmpty()) {
        QFile fixture(arguments.value("layout"));
        if (!fixture.open(QIODevice::ReadOnly))
            return 2;
        const auto value = QJsonDocument::fromJson(fixture.readAll());
        if (!value.isObject())
            return 2;
        layout.fromJson(value.object());
    }

    QFontDatabase::addApplicationFont(QStringLiteral(":/fonts/maple_mono_cn.ttf"));
    QFont timelineFont(QStringLiteral("Maple Mono Normal NL CN"));
    timelineFont.setPointSizeF(14);
    TimelineQuickStateBridge timeline(nullptr, timelineFont);
    TimelineQuickModel timelineModel;
    if (!arguments.value("timeline").isEmpty()) {
        QFile fixture(arguments.value("timeline"));
        if (!fixture.open(QIODevice::ReadOnly)) return 2;
        const auto document = QJsonDocument::fromJson(fixture.readAll());
        if (!document.isObject()) return 2;
        const auto value = document.object();
        if (value.value("documentLoaded").toBool()) {
            timelineModel.rebuildFromText(value.value("text").toString(), 0);
            timeline.setTimelineData(timelineModel.snapshot());
        }
        timeline.setSkinDirectory(value.value("skinDirectory").toString());
        timeline.setZoomScale(value.value("zoomScale").toDouble(.5));
        timeline.setHorizontalScrollValue(value.value("horizontalScrollValue").toDouble(0));
        timeline.setPlayheadSeconds(value.value("playheadSeconds").toDouble(0), false);
        const auto colors = value.value("colors").toObject();
        miacode::timeline::TimelineChromeColors chrome;
        for (const auto& entry : {
            std::pair{"window", &miacode::timeline::TimelineChromeColors::window}, {"header", &miacode::timeline::TimelineChromeColors::header},
            {"sidebar", &miacode::timeline::TimelineChromeColors::sidebar}, {"base", &miacode::timeline::TimelineChromeColors::base},
            {"border", &miacode::timeline::TimelineChromeColors::border}, {"axis", &miacode::timeline::TimelineChromeColors::axis},
            {"gridMajor", &miacode::timeline::TimelineChromeColors::gridMajor}, {"gridSubdivision", &miacode::timeline::TimelineChromeColors::gridSubdivision},
            {"gridMinor", &miacode::timeline::TimelineChromeColors::gridMinor}, {"laneEven", &miacode::timeline::TimelineChromeColors::laneEven},
            {"laneOdd", &miacode::timeline::TimelineChromeColors::laneOdd}, {"label", &miacode::timeline::TimelineChromeColors::label},
            {"textSecondary", &miacode::timeline::TimelineChromeColors::textSecondary}, {"waveStroke", &miacode::timeline::TimelineChromeColors::waveStroke}}) {
            const auto channels = colors.value(QLatin1String(entry.first)).toArray();
            chrome.*entry.second = channels.isEmpty() ? QColor(colors.value(QLatin1String(entry.first)).toString())
                : QColor(channels[0].toInt(), channels[1].toInt(), channels[2].toInt(), qRound(channels[3].toDouble(1) * 255));
        }
        miacode::timeline::setTimelineChromeColors(chrome);
        if (value.value("waveform").toBool()) {
            QVector<float> samples(24000 * 12);
            for (int index = 0; index < samples.size(); ++index)
                samples[index] = std::sin(index / 24000.0 * 2 * 3.141592653589793 * 440) * .0244140625f;
            timeline.setWaveformData(miacode::waveform::buildWaveformDataFromSamples(QStringLiteral("/track"), samples.size() * sizeof(float), 0, samples, 12));
        }
    }
    qmlRegisterType<TimelineQuickItem>("MiaCode.Timeline", 1, 0, "TimelineQuickItem");
    if (arguments.isSet("capture")) {
        const auto dimensions = arguments.value("viewport").split('x');
        if (dimensions.size() != 2) return 2;
        return captureTimeline(&timeline, QSize(dimensions[0].toInt(), dimensions[1].toInt()), arguments.value("capture"));
    }
    QQmlApplicationEngine engine;
    for (const auto& path : arguments.values("I"))
        engine.addImportPath(path);
    engine.rootContext()->setContextProperty("referenceCoverLayout", &layout);
    engine.rootContext()->setContextProperty("referenceTimeline", &timeline);
    engine.rootContext()->setContextProperty("referenceSceneUrl", QUrl::fromLocalFile(arguments.positionalArguments().first()));
    const auto viewport = arguments.isSet("viewport") ? arguments.value("viewport").split('x') : QStringList{"1200", "720"};
    if (viewport.size() != 2) return 2;
    engine.rootContext()->setContextProperty("referenceWindowWidth", viewport[0].toInt());
    engine.rootContext()->setContextProperty("referenceWindowHeight", viewport[1].toInt());
    QObject::connect(&engine, &QQmlEngine::quit, &application, &QGuiApplication::quit);
    engine.loadData(R"(
        import QtQuick
        Window {
            id: window
            visible: true
            width: referenceWindowWidth
            height: referenceWindowHeight
            Loader {
                anchors.fill: parent
                source: referenceSceneUrl
            }
        }
    )");
    if (engine.rootObjects().isEmpty())
        return 2;
    return application.exec();
}
