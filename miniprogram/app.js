App({
  globalData: {
    theme: "light",
  },

  onLaunch() {
    this.globalData.theme = readTheme();
  },

  onThemeChange({ theme }) {
    this.globalData.theme = theme;
  },
});

/** 读取当前系统主题；失败时回退到浅色，任何情况下都不阻塞启动。 */
function readTheme() {
  try {
    if (typeof wx.getAppBaseInfo === "function") {
      const info = wx.getAppBaseInfo();
      if (info && info.theme) return info.theme;
    }
  } catch (error) {
    // 忽略：不同基础库的接口可用性不一致
  }
  try {
    const info = wx.getSystemInfoSync();
    if (info && info.theme) return info.theme;
  } catch (error) {
    // 忽略
  }
  return "light";
}
