#include "export-bridge.h"
#include "core/chart/IntroConfig.h"
#include "core/scene/PreviewSfxAssets.h"
#include "export/video_export/FontLibrary.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QCryptographicHash>
#include <QQmlComponent>
#include <QtMath>

using namespace miacode::video_export;
using namespace miacode::preview::scene;
static_assert(miacode::intro::kPvPreviewHoldFrames == 510);
static_assert(miacode::intro::kPvPreviewAudioFadeOutSeconds == 3.0);
namespace {
QJsonObject trackJson(const BackgroundTrackRenderPlan& track) {
    return {{"enabled",track.enabled},{"mixStartSecond",track.mixStartSecond},{"sourceStartSecond",track.sourceStartSecond},
        {"durationSeconds",track.durationSeconds},{"gain",track.gain},{"fadeInSeconds",track.fadeInSeconds},{"fadeOutSeconds",track.fadeOutSeconds}};
}
QString soundFile(const QString& kind) {
    return QFileInfo(miacode::preview_sfx::assetFilePathForKind(miacode::preview_sfx::resolveSfxDirectory(),kind)).fileName();
}
}
WebExportScene::~WebExportScene(){delete intro_;}
QJsonObject WebExportScene::storeAsset(const QString& kind,const QString& name,const QByteArray& data) {
    const bool sound=kind=="sfx";
    if(!sound && kind!="track" && kind!="cover" && kind!="intro_background")return {{"error","导出素材种类无效"}};
    const QString directory=sound?"/assets/SFX":"/web-export";
    const QString path=directory+"/"+(sound?QFileInfo(name).fileName():kind+"-"+QString::fromLatin1(QCryptographicHash::hash(data,QCryptographicHash::Sha256).toHex()));
    QFile file(path);
    if(!QDir().mkpath(directory) || !file.open(QIODevice::WriteOnly) || file.write(data)!=data.size())return {{"error","导出素材写入失败"}};
    if(!sound && assets_.contains(kind) && assets_.value(kind)!=path)QFile::remove(assets_.value(kind));
    assets_.insert(kind,path);return {{"path",path}};
}
QJsonObject WebExportScene::configure(const QJsonObject& options,const PreviewFrameState& state,const QJsonObject& document,const PreviewAudioSettings& audio) {
    const double duration=options.value("duration").toDouble(),start=options.value("exportStartSeconds").toDouble(),end=options.value("exportEndSeconds").toDouble(duration);
    const int fps=options.value("fps").toInt(60);
    const bool emptyPreview = options.value("previewMode").toBool() && duration == 0 && start == 0 && end == 0;
    if(!qIsFinite(duration)||!qIsFinite(start)||!qIsFinite(end)||start<0||(!emptyPreview && end<=start)||end>duration+0.001||fps<1||fps>120)
        return {{"error","导出区间或帧率无效"}};
    task_={};task_.fps=fps;task_.exportStartSeconds=start;task_.contentDurationSeconds=end-start;
    task_.fullRangeExport=start<=0.01;
    task_.trackPath=options.value("audioAvailable").toBool()?assets_.value("track"):QString();task_.noteMarkers=state.noteMarkers;task_.audioSettings=audio;
    task_.clockCountEnabled=options.value("clockCountEnabled").toBool();task_.clockCount=document.value("clockCount").toInt(4);task_.clockBpm=document.value("bpm").toDouble(120);
    task_.showTimestamp=options.value("showTimestamp").toBool(state.render.showTimestamp);
    task_.showChartInfoHud=options.value("showChartInfoHud").toBool(state.render.showChartInfoHud);
    task_.showObjectStatsHud=options.value("showObjectStatsHud").toBool(state.render.showObjectStatsHud);
    task_.backgroundBrightnessOuter=state.render.backgroundBrightnessOuter;task_.backgroundBrightnessInner=state.render.backgroundBrightnessInner;
    auto& intro=task_.intro;
    intro.enabled=options.value("introEnabled").toBool()&&task_.fullRangeExport;
    intro.pvPreview=options.value("introPvPreview").toBool();
    intro.pvPreviewStartSeconds=qBound(0.0, options.value("introPvStartSeconds").toDouble(), qMax(0.0, duration-miacode::intro::kPvPreviewHoldSeconds));
    intro.title=state.chartTitle;intro.artist=state.chartArtist;intro.designer=state.chartDesigner;
    intro.level=document.value("currentDifficultyLevel").toString();intro.bpm=QString::number(task_.clockBpm,'g',6);
    const QStringList difficulties{"EASY","BASIC","ADVANCED","EXPERT","MASTER","ReMASTER","UTAGE"};
    const int difficultyId = options.value("selectedDifficultyId").toInt(document.value("activeDifficultyId").toInt());
    intro.difficulty=difficulties.value(difficultyId-1,"MASTER");
    for (const auto& item : document.value("charts").toArray()) {
        const auto chart = item.toObject();
        if (chart.value("id").toInt() == difficultyId) intro.level = chart.value("level").toString();
    }
    const int mode=options.value("introModeIndex").toInt();intro.mode=mode==1?"DX":mode==2?"Standard":detectedIntroBannerMode(state.noteMarkers);
    intro.jacketPath=assets_.value("cover");intro.backgroundMode=options.value("introBackgroundModeIndex").toInt()==1?"custom":"jacket";
    intro.customBackgroundPath=assets_.value("intro_background");intro.blurBackground=options.value("introBlurBackground").toBool(true);
    intro.cardShadow=options.value("introCardShadow").toBool();intro.lvRenderMode=options.value("introLevelTextRender").toBool()?"text":"atlas";
    intro.fontDisplayPath=options.value("introFontDisplayPath").toString();intro.fontBodyPath=options.value("introFontBodyPath").toString();
    QString error;
    if(!buildVideoExportAudioRenderPlan(task_,&plan_,&error))return {{"error",error}};
    delete intro_;intro_=nullptr;
    if(intro.enabled) {
        QFile source(":/intro/templates/maimai_banner.json");if(!source.open(QIODevice::ReadOnly))return {{"error",source.errorString()}};
        auto templateMap=QJsonDocument::fromJson(source.readAll()).object().toVariantMap();
        applyBannerFontOverride(templateMap,intro.fontDisplayPath,intro.fontBodyPath);
        QQmlComponent component(&engine_,QUrl("qrc:/intro/qml/IntroOverlay.qml"));
        QVariantMap properties=introBannerStyleMap(intro,options.value("videoAvailable").toBool());
        properties.insert("pvPreviewHoldFrames", miacode::intro::kPvPreviewHoldFrames);
        properties.insert("bannerTrack",introBannerTrackMap(intro));properties.insert("bannerTemplateData",templateMap);
        properties.insert("backgroundImage",intro.jacketPath.isEmpty()?QUrl():QUrl::fromLocalFile(intro.jacketPath));
        intro_=qobject_cast<QQuickItem*>(component.createWithInitialProperties(properties));
        if(!intro_){QStringList errors;for(const auto& item:component.errors())errors<<item.toString();return {{"error",errors.join('\n')}};}
        intro_->setParentItem(parent_);intro_->setParent(parent_);intro_->setSize(parent_->size());intro_->setZ(3);intro_->setVisible(false);
    }
    QJsonArray sounds,spans;
    for(const auto& item:plan_.scheduledSfxPlaybacks)sounds.append(QJsonObject{{"kind",item.kind},{"file",soundFile(item.assetKind)},
        {"mixSecond",item.mixSecond},{"gain",item.gain},{"maxDurationSeconds",item.maxDurationSeconds}});
    for(const auto& item:plan_.touchholdSpanPlaybacks)spans.append(QJsonObject{{"kind",item.kind},{"file",soundFile(item.assetKind)},
        {"mixSecond",item.mixSecond},{"sourceStartSecond",item.sourceStartSecond},{"durationSeconds",item.durationSeconds},{"gain",item.gain}});
    if(intro.enabled&&!intro.pvPreview)sounds.append(QJsonObject{{"kind","track_start"},{"file","track_start.wav"},{"mixSecond",0},{"gain",previewSfxVolumeForKind(audio,"track_start")},{"maxDurationSeconds",-1}});
    return {{"fps",task_.fps},{"frameCount",plan_.frameCount},{"totalSeconds",plan_.alignedTotalSeconds},{"leadInSeconds",plan_.leadInSeconds},
        {"introAuditionSeconds",miacode::intro::kPvPreviewHoldSeconds+miacode::intro::kPvPreviewAudioTailSeconds},
        {"introPvStartSeconds", intro.pvPreviewStartSeconds}, {"introPvSegmentSeconds", miacode::intro::kPvPreviewHoldSeconds},
        {"clockCount", task_.clockCount}, {"clockBpm", task_.clockBpm},
        {"introLeadSeconds",plan_.introLeadSeconds},{"introFrameCount",plan_.introFrameCount},{"timelineOriginSecond",plan_.timelineOriginSecond},
        {"segmentStartSecond",plan_.segmentStartSecond},{"segmentEndSecond",plan_.segmentEndSecond},{"fullRangeExport",task_.fullRangeExport},
        {"backgroundTrack",trackJson(plan_.backgroundTrack)},{"introPreviewTrack",trackJson(plan_.introPreviewTrack)},
        {"scheduledSfxPlaybacks",sounds},{"touchholdSpanPlaybacks",spans}};
}
QJsonObject WebExportScene::frame(int index,PreviewFrameState& state) {
    const auto info=frameInfo(index);
    if(info.contains("error"))return info;
    const int authoring=miacode::intro::authoringFrameForOutputFrame(index,task_.fps);
    const bool introActive=task_.intro.enabled&&index<plan_.introFrameCount;
    const int reveal=task_.intro.pvPreview?miacode::intro::kPvPreviewDurationFrames:miacode::intro::kHudRevealFrame;
    const bool introCover=task_.intro.enabled&&authoring<reveal;
    state.playheadSeconds=info.value("chartSecond").toDouble();
    state.render.showTimestamp=task_.showTimestamp&&!introCover;state.render.showChartInfoHud=task_.showChartInfoHud&&!introCover;
    state.render.showObjectStatsHud=task_.showObjectStatsHud&&!introCover;state.render.fixHudTextLayout=true;
    const double fade=task_.intro.enabled?qBound(0.0,state.playheadSeconds+miacode::intro::kBgFadeDurationSeconds,1.0):1.0;
    state.render.backgroundBrightnessOuter=task_.backgroundBrightnessOuter*fade;state.render.backgroundBrightnessInner=task_.backgroundBrightnessInner*fade;
    if(intro_){intro_->setVisible(introActive);intro_->setProperty("frame",authoring);intro_->setSize(parent_->size());}
    return info;
}
QJsonObject WebExportScene::frameInfo(int index) const {
    if(index<0||index>=plan_.frameCount)return {{"error","导出帧序号无效"}};
    const double outputSecond=double(index)/task_.fps;
    const bool partialLead=!task_.fullRangeExport&&outputSecond<plan_.leadInSeconds;
    const double chartSecond=partialLead?plan_.segmentStartSecond:plan_.timelineOriginSecond+outputSecond;
    const int authoring=miacode::intro::authoringFrameForOutputFrame(index,task_.fps);
    const bool introPv=task_.intro.enabled&&task_.intro.pvPreview&&index<plan_.introFrameCount&&authoring<miacode::intro::kPvPreviewHoldFrames;
    return {{"chartSecond",chartSecond},{"outputSecond",outputSecond},{"pauseOverlay",partialLead},
        {"chartVisible",!introPv},{"mediaSecond",introPv?task_.intro.pvPreviewStartSeconds+outputSecond:qMax(0.0,chartSecond)},
        {"mediaOpacity",introPv?qBound(0.0,outputSecond/0.4,1.0):1.0}};
}
QJsonObject WebExportScene::previewFrame(double second, PreviewFrameState& state) {
    const double outputSecond = second < 0 ? second + plan_.introLeadSeconds : second - plan_.timelineOriginSecond;
    auto result = frame(qBound(0, int(qRound64(outputSecond * task_.fps)), plan_.frameCount - 1), state);
    state.playheadSeconds = second;
    const double fade = task_.intro.enabled ? qBound(0.0, second + miacode::intro::kBgFadeDurationSeconds, 1.0) : 1.0;
    state.render.backgroundBrightnessOuter = task_.backgroundBrightnessOuter * fade;
    state.render.backgroundBrightnessInner = task_.backgroundBrightnessInner * fade;
    result.insert("chartSecond", second);
    return result;
}
void WebExportScene::finish(){
    if(intro_)intro_->setVisible(false);
    for(const QString& kind:{QString("track"),QString("cover"),QString("intro_background")})QFile::remove(assets_.take(kind));
}
void WebExportScene::setStillFrame(bool still){if(intro_)intro_->setProperty("stillFrame",still);}
void WebExportScene::updateRenderSettings(const PreviewFrameState& state) {
    task_.backgroundBrightnessOuter = state.render.backgroundBrightnessOuter;
    task_.backgroundBrightnessInner = state.render.backgroundBrightnessInner;
    task_.showTimestamp = state.render.showTimestamp;
}
void WebExportScene::setCardDimmed(bool dimmed) { if (intro_) intro_->setProperty("cardDimmed", dimmed); }
