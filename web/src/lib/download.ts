/** 触发浏览器逐个下载（间隔触发避免被拦截），仅文件节点 */
export function downloadNodes(files: { id: string; name: string }[]): void {
  files.forEach((f, i) => {
    setTimeout(() => {
      const a = document.createElement('a')
      a.href = `/api/nodes/${f.id}/content?dl=1`
      a.download = f.name
      document.body.appendChild(a)
      a.click()
      a.remove()
    }, i * 400)
  })
}
