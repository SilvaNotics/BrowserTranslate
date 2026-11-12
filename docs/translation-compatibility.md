# v0.3.1 翻译兼容性与效率

## 参考源码

2026-11-12 查阅以下开源插件的实现，借鉴正文与非正文分离、局部增量扫描的设计；本次修改在现有代码上独立实现，没有复制第三方代码或新增运行时依赖。

- [KISS Translator：translationTargets.js](https://github.com/fishjar/kiss-translator/blob/9287bfd57c57e21fa26fd10703c2368e81dc3151/src/libs/translationTargets.js)：将节点布局、正文过滤和只读遍历分开；忽略非正文节点时继续处理同级正文。
- [KISS Translator：translator.js](https://github.com/fishjar/kiss-translator/blob/9287bfd57c57e21fa26fd10703c2368e81dc3151/src/libs/translator.js)：重叠扫描范围合并、忽略自身 DOM 变更，以及分离译文写入。
- [Translate Web Pages：pageTranslator.js](https://github.com/FilipePS/Traduzir-paginas-web/blob/master/src/contentScript/pageTranslator.js)：聚合文字片段、分开记录新增与移除节点，增量处理动态正文。

## 实现

`dom.ts` 读取当前容器的正文，跳过独立子段落和媒体；子段落另行提取。图片、SVG 或按钮不再使其所在段落整体被丢弃。译文插在当前正文之后、尾随的图片或嵌套段落之前。仅译文模式只隐藏正文，保留媒体及按钮；填空输入框继续作为原文的一部分隐藏，原值不会发送给模型。恢复时移动回原节点，保留事件和输入值。

`controller.ts` 将变化按正文容器归并，去掉包含关系重复的扫描范围，仅复查有关段落及已移除节点。观察器在写入前收走待处理的网页变更，写入后丢弃扩展自身同步变更，避免模式切换与译文插入触发全页重扫。150ms 定时器不因新变更反复重置，持续追加的内容也能取得进展；浏览器忙碌或后台标签页节流仍可能使实际执行延后。

同一模拟场景中，在 200 个已有段落旁追加一段：原控制器重新读取已有段落 **200 次**，修改后 **0 次**；新段落仍完成翻译。对比使用相同 DOM 提取实现和模拟响应，隔离控制器改动的影响。这衡量扫描开销，不代表真实供应商翻译耗时的同比改善。永久回归测试同时覆盖局部扫描和持续追加内容。

## 悬浮球

在 TopAPI 的独立 Chromium 会话中复现：WXT 默认注入的 `:host { all:initial !important }` 覆盖普通内联定位，宿主实际变成 `position:static; z-index:auto`，被网站 `z-index:50` 的公告遮罩挡住。

宿主现挂载到 `html`，以重要内联样式保护固定定位和层级，隔离 UI 事件。修复后公告仍打开时，命中测试返回 `YIJING-TRANSLATE`，真实点击和拖动成功。真实网站未配置模型，这次实站验证只证明交互恢复；翻译、OCR、恢复、模式切换由本机模拟模型的扩展端到端测试验证。
