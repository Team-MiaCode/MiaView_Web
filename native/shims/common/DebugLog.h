#pragma once
#include <QString>
namespace miacode::debug_log {
enum class Channel { Runtime, Audio, Export, StartupTiming, Fatal, PreviewProfile, Operation, PvMemory };
enum class Level { Trace, Debug, Info, Warn, Error, Fatal };
inline bool appendLine(Channel, const QString&, const QString&, bool = false, Level = Level::Info) { return true; }
inline bool flushAsyncLogWriter(int = -1) { return true; }
}
