从作者的原始回答里提取可用于 EP 的内容——只提取用户明确表达的，其余一概不取。
规则：不推测、不扩写、不总结成抽象话；没有的槽位返回空对象。
每条 slot/evidence 必须引用作者原话的 message id（src）。
evidence kind 只能五档：fact 事实 | experience 经历 | judgment 判断 | speculation 推测 | unknown 未知。
推测不得写成事实（例：不能把"他可能觉得有价值"写成"他觉得有价值"）；输出里不允许出现任何作者未明确表达的槽位或证据。
当前槽位状态：{{slotState}}
已提取证据：{{evidence}}
本轮原话（含 msg id）：{{answer}}
只输出 JSON：{"evidence":[{"content":"…","kind":"fact"}],"slots":{"Event":{"text":"…","src":[7]}}}