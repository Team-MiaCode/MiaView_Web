export const DATABASE_UPGRADE_MESSAGE = "本地数据等待升级，请关闭使用旧版本的 MiaCode 标签页";

export function openDatabase(factory, name, version, upgrade, onBlocked) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    let blocked = false;
    request.onupgradeneeded = upgrade;
    request.onblocked = () => {
      blocked = true;
      onBlocked?.(name, true);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
      if (blocked) onBlocked?.(name, false);
    };
    request.onerror = () => {
      reject(request.error);
      if (blocked) onBlocked?.(name, false);
    };
  });
}
