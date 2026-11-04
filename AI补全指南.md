# 九分词汇 AI 补全指南

这是给外部 AI 和维护者阅读的资料格式说明。补全对象是词汇学习资料，不能修改学习进度、个人笔记、熟知状态或复习日期。

用户入口为“词库与笔记 → 交给 AI 补全”。软件导出的任务包含项目专用提示词和返回格式示例；无法访问本机文件的 AI 直接读取该任务即可。每批默认最多 50 个词，结果由用户预览并采用后才保存。

## 任务与身份

任务为 `jiufen-ai-task`、`schema: 1`。保留 `id` 和每条词的 `id`、`word`、`baseFingerprint`。每条记录的 `meaning` 是用户指定的目标义项，`requested` 是允许补的字段。`existing` 是导出时已有的词汇资料。

任务不包含学习反馈、档案身份、本机目录、个人笔记或个人联想。不要请求这些内容。不要把提示词中的示例当作实际词条补全结果。

## 返回格式

只返回纯 JSON，可以放在一个 JSON 代码块中。以下 `taskId`、词条编号和资料版本必须换成当前任务中的实际值：

```json
{
  "format": "jiufen-ai-result",
  "schema": 1,
  "taskId": "task:实际任务编号",
  "items": [
    {
      "id": "custom:实际词条编号",
      "word": "newspaper",
      "baseFingerprint": "m1-实际的16位十六进制资料版本",
      "status": "candidate",
      "fields": {
        "schemes": [
          {
            "id": "scheme:news-paper",
            "label": "熟词搭桥",
            "kind": "熟词组合",
            "anchor": "news（新闻）＋ paper（纸）",
            "parts": [
              {"text": "news", "cue": "新闻"},
              {"text": "paper", "cue": "纸"}
            ],
            "scene": "把新闻印在纸上，拿在手里读的就是报纸。",
            "focus": "news + paper = newspaper",
            "reference": "原创助记，用熟词组合辅助理解。"
          }
        ],
        "sentence": "She reads a newspaper every morning.",
        "translation": "她每天早晨读报纸。",
        "collocations": ["read a newspaper"]
      },
      "note": "请核对这条巧记是否适合你。"
    }
  ]
}
```

`fields` 只能包含任务要求的字段：`schemes`、`sentence`、`translation`、`collocations`、`phonetic`、`partOfSpeech`、`source`。不能新增 `word`、`meaning`、卡片或历史字段。

`status` 可为 `candidate`（供预览的候选）、`review`（需要核查）或 `unavailable`（无法补全）。`unavailable` 的 `fields` 必须为空对象 `{}`。可以只返回本批中已处理的词，遗漏词不会被删除；不能重复编号或发回其他任务的词。

## 巧记要求

- 优先熟词直接组合、清楚的增删换字母和基础词变形；提示词给出简单中文释义。
- `parts.text` 按顺序拼接，必须严格等于目标英文，包含大小写、空格和连接符。短语空格可写为 `{"text":" ","cue":""}`，界面不会为空格单独制作提示卡。
- `anchor` 写熟悉线索，`scene` 要把线索联系到指定中文义项，`focus` 说明如何还原拼写。场景不能只复述词义或与线索无关。
- 可以填写 `from`、`change` 和 `operations` 说明借词变换。`operations` 按原借词连续位置排列，每项有 `kind`（equal/delete/insert/replace）、`start`、`end`、`before`、`after`，覆盖全部借词并还原实际片段。
- 每词最多五个方案，方案 `id` 唯一。外部 AI 返回的方案必须带可检查的实际字母片段；软件内人工填写的简单联想可以不拆分。
- 人为近音、拼音、形状或字母编码注明为助记，不作为英语标准读音或真实词源。原创方案注明原创；事实引用提供实际核查过的来源，未查到就说明待核查，不伪造网址。

程序校验只能确认结构和拼写还原，不能证明语言准确或记忆有效。需要用户核对后采用。

## 导回与过期资料

默认只勾选空缺字段；已有资料需要用户明确选择替换。标为 `review` 的内容需要逐字段明确选择。导出后词条又被修改时，软件会提示任务过期；应重新导出任务，不能用旧结果覆盖新修改。

原任务随本机资料保存，退出后仍可导回。重复采用同一份结果不会重复增加方案。词义或拼写改变、未知编号、错误拆分、额外字段和无效格式会被拒绝，不修改当前词库。

资料版本用于发现任务导出后的内容变化，不是来源认证或安全签名。匹配版本的输入仍须通过字段白名单、词条编号、英文、指定词义、数据结构和拼写还原检查，并由用户核对采用。
