# BB Local Timeline

适用于 Chrome 和 Microsoft Edge 的 Bilibili 本地时间轴与截图扩展。

## 功能

- 导入本地 `.srt`、`.ass` 或 `.json` 时间轴，并按视频与分 P 保存。
- 点击时间轴项目跳转到视频对应位置。
- 播放栏相机按钮截取当前画面，并保存截图与 `timeline.md`。
- 在截图管理页面预览、跳转、删除截图；点击图片外的区域可关闭放大预览。
- 默认截图快捷键为 `Ctrl + Alt + C`，可在“设置”中自定义 Ctrl、Alt、Shift 和按键。

## 安装

1. 下载或克隆本仓库。
2. 打开 Chrome/Edge 的扩展管理页面，并开启“开发者模式”。
3. 选择“加载已解压的扩展”，选中本仓库目录。

首次点击“目录”或相机按钮时，扩展会请求选择一个本地保存根目录。截图和时间线文档会写入按视频命名的子文件夹。

## 说明

本仓库只包含 Chrome/Edge 扩展源码，不包含个人截图、时间轴存档或 ZIP 压缩包。

本项目借鉴了 [AliubYiero/Yiero_WebScripts](https://github.com/AliubYiero/Yiero_WebScripts) 中 Bilibili 视频时间轴相关的页面结构思路，并由 ChatGPT 协助完成扩展化、截图管理和交互调整。
