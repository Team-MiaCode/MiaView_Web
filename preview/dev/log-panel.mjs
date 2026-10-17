// The panel forwards exact backend text; it does not collect or format logs.
export function createBackendLogPanel(getPreview) {
  const output = document.getElementById("performance-output");
  const status = document.getElementById("performance-log-status");
  return {
    attach(instance) {
      const lines = [];
      output.textContent = "等待后台日志…";
      status.textContent = "显示播放器后台返回的日志";
      instance.on("performance", (report) => {
        if (instance !== getPreview()) return;
        const log = report.backendLog;
        if (!log?.ok) {
          status.textContent = `后台日志不可用：${log?.message ?? "未连接"}`;
          return;
        }
        const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
        lines.push(log.text);
        if (lines.length > 120) lines.shift();
        output.textContent = lines.join("\n\n");
        if (follow) output.scrollTop = output.scrollHeight;
        status.textContent = `后台终端：${log.terminalEnabled ? "开启" : "关闭"} · 文件输出：${log.fileEnabled ? "开启" : "关闭"}`;
      });
    },
  };
}
