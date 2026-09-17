/* 首帧前应用主题，避免暗色模式闪白（CSP: script-src 'self'，故为独立文件） */
(function () {
  try {
    var pref = localStorage.getItem('md.theme') || 'system'
    var dark =
      pref === 'dark' ||
      (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  } catch (e) {
    document.documentElement.dataset.theme = 'light'
  }
})()
