# Chrome / Edge 扩展安装说明

这是原用户脚本的 Manifest V3 扩展版，不需要安装 Tampermonkey 或 ScriptCat。

## 安装

1. 解压本目录，或者直接解压配套的 `bilibili-local-timeline-extension.zip`。
2. 在 Chrome / Edge 地址栏打开：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展”，选择本目录。
5. 打开或刷新 `https://www.bilibili.com/video/...`。

## 使用

- 右侧“时间轴”面板：导入 `.srt`、`.ass` 或 `.json`。
- 默认快捷键为 `Ctrl + Alt + C`，点击“设置”可以自定义 Ctrl、Alt、Shift 和按键。
- 截图管理支持悬停删除，点击“正序/倒序”按钮即可切换排列；从放大预览跳转视频后会自动关闭管理页面。
- 大图预览支持左右箭头、点击图片左右边缘和键盘方向键切换；点击播放器蓝色进度条可跳转到对应视频位置。
- 时间轴组件位于 Bilibili 右侧栏的弹幕列表与视频合集之间；导入后可收起/展开，也可以删除当前导入的时间轴。
- 第一次点击“目录”或播放栏相机按钮时，选择本地保存根目录。
- 播放栏右侧相机按钮：保存当前视频画面，并写入当前播放时间。
- “截图管理”：全屏网格查看、点击看大图、跳转视频、批量删除；右上角 `×` 可关闭。
- 删除的图片会移动到当前视频文件夹的 `_deleted` 子目录。

扩展版使用 Chrome / Edge 的 File System Access API，因此可以真实创建视频文件夹并写入 `timeline.md`。浏览器会在第一次使用时请求目录权限。
