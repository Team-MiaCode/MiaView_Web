#include "timeline-bridge.h"
#include <QBuffer>
#include <QFontDatabase>
#include <QFontMetricsF>
#include <QJsonArray>
#include <algorithm>

using namespace miacode::timeline;
namespace {
QString cssColor(const QColor& value)
{
    return QStringLiteral("rgba(%1,%2,%3,%4)").arg(value.red()).arg(value.green()).arg(value.blue()).arg(value.alphaF());
}
QColor inputColor(const QJsonValue& value)
{
    if (value.isString()) return QColor(value.toString());
    const auto channels = value.toArray();
    return QColor(channels[0].toInt(), channels[1].toInt(), channels[2].toInt(), qRound(channels[3].toDouble(1) * 255));
}
QJsonObject point(const QPointF& value) { return {{"x", value.x()}, {"y", value.y()}}; }
QJsonObject rect(const QRectF& value) { return {{"x", value.x()}, {"y", value.y()}, {"width", value.width()}, {"height", value.height()}}; }
QJsonObject rectangle(const TimelineSceneRect& value) { return {{"rect", rect(value.rect)}, {"color", cssColor(value.color)}}; }
QJsonObject line(const TimelineSceneLine& value) { return {{"start", point(value.start)}, {"end", point(value.end)}, {"color", cssColor(value.color)}, {"width", value.width}}; }
QJsonObject triangle(const TimelineSceneTriangle& value) { return {{"a", point(value.a)}, {"b", point(value.b)}, {"c", point(value.c)}, {"color", cssColor(value.color)}}; }
QJsonObject label(const TimelineSceneTextLabel& value)
{
    const double size = value.font.pixelSize() > 0 ? value.font.pixelSize() : value.font.pointSizeF() * 96.0 / 72.0;
    return {{"text", value.text}, {"topLeft", point(value.topLeft)}, {"color", cssColor(value.color)},
        {"font", QJsonObject{{"family", value.font.family()}, {"pixelSize", size}, {"ascent", QFontMetricsF(value.font).ascent()}}}};
}
template<class T, class F> QJsonArray list(const QVector<T>& values, F convert)
{
    QJsonArray result;
    for (const auto& value : values) result.append(convert(value));
    return result;
}
QJsonObject image(const QImage& value)
{
    QByteArray bytes;
    QBuffer buffer(&bytes);
    buffer.open(QIODevice::WriteOnly);
    value.save(&buffer, "PNG");
    return {{"url", QStringLiteral("data:image/png;base64,") + QString::fromLatin1(bytes.toBase64())},
        {"width", value.width()}, {"height", value.height()}};
}
}

void WebTimeline::load(const QString& text, double first, const miacode::simai::SimaiTimingMetadata& timing)
{
    text_ = text;
    text_.replace(QStringLiteral("\r\n"), QStringLiteral("\n"));
    text_.replace(QLatin1Char('\r'), QLatin1Char('\n'));
    model_.rebuildFromText(text_, first, timing);
}

void WebTimeline::setWaveform(const float* samples, int count, double duration)
{
    if (!samples || count <= 0) { waveform_.reset(); return; }
    QVector<float> mono(count);
    std::copy(samples, samples + count, mono.begin());
    waveform_ = miacode::waveform::buildWaveformDataFromSamples(QStringLiteral("/track"), count * sizeof(float), 0, mono, duration);
}

QJsonObject WebTimeline::build(const QJsonObject& options)
{
    const auto colors = options.value("colors").toObject();
    TimelineChromeColors chrome;
    for (const auto& entry : {
        std::pair{"window", &TimelineChromeColors::window}, {"header", &TimelineChromeColors::header},
        {"sidebar", &TimelineChromeColors::sidebar}, {"base", &TimelineChromeColors::base},
        {"border", &TimelineChromeColors::border}, {"axis", &TimelineChromeColors::axis},
        {"gridMajor", &TimelineChromeColors::gridMajor}, {"gridSubdivision", &TimelineChromeColors::gridSubdivision},
        {"gridMinor", &TimelineChromeColors::gridMinor}, {"laneEven", &TimelineChromeColors::laneEven},
        {"laneOdd", &TimelineChromeColors::laneOdd}, {"label", &TimelineChromeColors::label},
        {"textSecondary", &TimelineChromeColors::textSecondary}, {"waveStroke", &TimelineChromeColors::waveStroke}})
        chrome.*entry.second = inputColor(colors.value(QLatin1String(entry.first)));
    setTimelineChromeColors(chrome);
    TimelineSceneBuildRequest request;
    request.snapshot = model_.snapshot();
    request.waveformData = waveform_;
    const int width = options.value("width").toInt();
    const int height = options.value("height").toInt();
    if (width < 1 || height < 1) return {{"error", "时间轴视口尺寸无效"}};
    request.viewportSize = QSize(width, height);
    request.headerLeftLimit = options.value("headerLeftLimit").toInt(0);
    request.headerRightLimit = options.value("headerRightLimit").toInt(width);
    request.headerMarkerLeftLimit = request.headerLeftLimit;
    request.headerMarkerRightLimit = request.headerRightLimit;
    request.fitViewportHeight = true;
    request.horizontalCullPaddingPx = width;
    request.zoomScale = options.value("zoomScale").toDouble(.5);
    request.contentScale = options.value("contentScale").toDouble(1);
    request.horizontalScrollValue = options.value("horizontalScrollValue").toDouble(0);
    request.playbackEntrySeconds = options.value("playbackEntrySeconds").toDouble(0);
    request.playheadSeconds = options.value("playheadSeconds").toDouble(0);
    request.cursorSeconds = options.value("cursorSeconds").toDouble(0);
    request.showSlideTracks = options.value("showSlideTracks").toBool(true);
    request.waveformBrightness = options.value("waveformBrightness").toDouble(.5);
    request.measureLineBrightness = options.value("measureLineBrightness").toDouble(1);
    request.waveformPhaseCompensationSeconds = options.value("waveformPhaseCompensationSeconds").toDouble(0);
    static const int font = QFontDatabase::addApplicationFont(QStringLiteral(":/fonts/maple_mono_cn.ttf"));
    Q_UNUSED(font);
    request.headerLineNumberFont = QFont(QStringLiteral("Maple Mono Normal NL CN"));
    request.headerLineNumberFont.setPointSize(11);
    request.skinDirectory = QStringLiteral("/assets/skin/skin") + options.value("noteSkin").toString("DX");
    if (skin_ != request.skinDirectory) {
        skin_ = request.skinDirectory;
        assets_ = loadTimelineNoteAssets(skin_);
        images_.clear();
    }
    state_ = TimelineSceneStateBuilder::build(request);
    QJsonObject result{
        {"viewportSize", QJsonObject{{"width", width}, {"height", height}}},
        {"timelineLeft", state_.timelineLeft}, {"timelineTop", state_.timelineTop}, {"timelineHeight", state_.timelineHeight},
        {"laneHeight", state_.laneHeight}, {"laneCount", state_.laneCount}, {"horizontalScrollValue", state_.horizontalScrollValue},
        {"contentWidth", state_.contentWidth}, {"displayStartSeconds", state_.displayStartSeconds},
        {"pixelsPerSecond", state_.pixelsPerSecond}, {"leadingCenteringPadding", state_.leadingCenteringPadding},
        {"maxNavigableSecond", state_.maxNavigableSecond},
        {"baseBackgroundRects", list(state_.baseBackgroundRects, rectangle)}, {"laneOverlayRects", list(state_.laneOverlayRects, rectangle)},
        {"waveformBars", list(state_.waveformBars, rectangle)}, {"gridLines", list(state_.gridLines, line)},
        {"frameRects", list(state_.frameRects, rectangle)}, {"frameLines", list(state_.frameLines, line)},
        {"laneLabels", list(state_.laneLabels, label)}, {"headerLabels", list(state_.headerLabels, label)},
        {"headerMarkers", list(state_.headerMarkers, triangle)}, {"fireworkBands", list(state_.fireworkBands, rectangle)},
        {"trackLines", list(state_.trackLines, line)}, {"touchHoldLines", list(state_.touchHoldLines, line)},
        {"hasEntryMarker", state_.hasEntryMarker}, {"entryMarker", triangle(state_.entryMarker)},
        {"hasCursorMarker", state_.hasCursorMarker}, {"cursorMarker", triangle(state_.cursorMarker)},
        {"hasCursorLine", state_.hasCursorLine}, {"cursorLine", line(state_.cursorLine)},
        {"hasPlayheadLine", state_.hasPlayheadLine}, {"playheadLine", line(state_.playheadLine)},
        {"hasDragCenterLine", state_.hasDragCenterLine}, {"dragCenterLine", line(state_.dragCenterLine)}};
    QJsonObject usedImages;
    const auto asset = [&](const QString& key, const QImage& value) {
        if (!images_.contains(key)) images_.insert(key, image(value));
        usedImages.insert(key, images_.value(key));
        return key;
    };
    const auto sprite = [&](const TimelineSceneSprite& value) {
        const auto size = targetSizeForNoteType(assets_, value.spriteType, value.scale);
        const auto key = transformedPixmapCacheKey(value.spriteType, size, value.rotationDegrees, value.mirrorX);
        if (!images_.contains(key)) {
            const auto pixels = transformNotePixmapToTargetSize(assets_, value.spriteType, size, value.rotationDegrees, value.mirrorX);
            asset(key, pixels.toImage());
        } else usedImages.insert(key, images_.value(key));
        return QJsonObject{{"center", point(value.center)}, {"spriteType", value.spriteType}, {"scale", value.scale},
            {"rotationDegrees", value.rotationDegrees}, {"mirrorX", value.mirrorX}, {"imageKey", key}};
    };
    result.insert("noteSprites", list(state_.noteSprites, sprite));
    result.insert("trackSprites", list(state_.trackSprites, sprite));
    result.insert("holdSpans", list(state_.holdSpans, [&](const TimelineSceneHoldSpan& value) {
        const auto scale = holdScaleForBaseIconScale(assets_, value.spriteType, value.baseIconScale);
        const auto key = holdPixmapCacheKey(value.spriteType, scale);
        const auto leftKey = key + ":left", rightKey = key + ":right", bodyKey = key + ":body";
        if (!images_.contains(leftKey)) {
            const auto parts = buildHoldPixmapParts(assets_, value.spriteType, scale);
            images_.insert(leftKey, image(parts.leftCap.toImage()));
            images_.insert(rightKey, image(parts.rightCap.toImage()));
            images_.insert(bodyKey, image(parts.bodySlice));
        }
        for (const auto& name : {leftKey, rightKey, bodyKey}) usedImages.insert(name, images_.value(name));
        return QJsonObject{{"startX", value.startX}, {"endX", value.endX}, {"rowTop", value.rowTop}, {"laneHeight", value.laneHeight},
            {"spriteType", value.spriteType}, {"baseIconScale", value.baseIconScale},
            {"leftKey", leftKey}, {"rightKey", rightKey}, {"bodyKey", bodyKey}};
    }));
    result.insert("muriDots", list(state_.muriDots, [](const TimelineSceneGlyph& value) {
        return QJsonObject{{"rect", rect(value.rect)}, {"shape", int(value.shape)}, {"fillColor", cssColor(value.fillColor)},
            {"strokeColor", cssColor(value.strokeColor)}, {"strokeWidth", value.strokeWidth}, {"radius", value.radius}, {"tooltipText", value.tooltipText}};
    }));
    result.insert("images", usedImages);
    return result;
}

QJsonObject WebTimeline::navigate(double x, double y) const
{
    const double second = TimelineSceneStateBuilder::sceneXToSecond(state_, x);
    const int lane = state_.laneHeight > 0 ? qBound(1, int((y - state_.timelineTop) / state_.laneHeight) + 1, 9) : 1;
    int sourceLine = 1, column = 1;
    double selectedSecond = second;
    bool resolved = y >= state_.timelineTop && model_.resolveNearestTimelineNote(second, lane, &sourceLine, &column, &selectedSecond);
    if (!resolved) resolved = model_.resolveTimelineNavigateCursor(second, &sourceLine, &column, &selectedSecond);
    int position = 0;
    for (int current = 1; current < sourceLine; ++current) position = text_.indexOf(QLatin1Char('\n'), position) + 1;
    position += column - 1;
    return {{"second", selectedSecond}, {"line", sourceLine}, {"column", column}, {"position", position}, {"resolved", resolved}};
}

QJsonObject WebTimeline::follow(double second) const
{
    TimelineQuickModel::PreviewFollowBinding binding;
    if (!model_.resolvePreviewFollowBinding(qMax(0.0, second), &binding) || !binding.resolved)
        return {{"active", false}};
    return {{"active", true}, {"start", binding.span.startPosition}, {"end", binding.span.endPositionExclusive},
        {"caret", binding.span.cursorPosition}, {"second", binding.anchorSecond}};
}
