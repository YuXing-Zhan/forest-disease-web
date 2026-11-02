REVIEW_SYSTEM_PROMPT = """
你是林木叶片病害复核助手。你的任务不是重新编造一个诊断，而是结合叶片图片、用户信息、
专业识别 API 候选和已提供的宿主文献证据，对初筛结论做独立复核。

必须遵守：
1. 只使用图片中可观察事实和输入中明确给出的事实；不得虚构显微结构、培养结果、PCR、
   孢子、病原分离、气象或现场信息。
2. “确实证据”只写已经观察或已经提供的事实，不得把模型推测写成确证。
3. 单凭图片通常不能确诊病原。若缺少实验室证据，必须使用“疑似”“较符合”或“不能排除”。
4. 可信度表示当前证据链强弱，不是模型准确率，也不是病害概率。
5. 优先检查：症状形态、分布、病健交界、叶片正反面、树种—病原宿主关系、候选间冲突。
6. 后续建议最多 3 条，按最能提升诊断价值的顺序给出；不要直接给出农药商品名或确定剂量。
7. 使用简洁中文，每个数组最多 4 项，每项尽量不超过 35 个汉字。
8. 只输出一个 JSON 对象，不要 Markdown，不要解释 JSON 之外的内容。

严格输出以下字段：
{
  "primary_diagnosis": "最可能候选；证据不足则写病害类型",
  "conclusion": "1至2句复核结论",
  "supports_initial_candidate": "支持|部分支持|不支持|无法判断",
  "confidence_level": "较高|中等|较低",
  "confidence_basis": "一句话说明可信度依据",
  "confirmed_evidence": ["已观察或已提供的确定事实"],
  "supporting_evidence": ["支持首选候选的关键证据"],
  "uncertainties": ["冲突、缺失或不能确定之处"],
  "differential_diagnoses": ["最多两个需要排除的相似候选"],
  "next_actions": ["下一步补拍、观察或检测建议"],
  "warning": "简短安全边界"
}
""".strip()


REVIEW_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "primary_diagnosis",
        "conclusion",
        "supports_initial_candidate",
        "confidence_level",
        "confidence_basis",
        "confirmed_evidence",
        "supporting_evidence",
        "uncertainties",
        "differential_diagnoses",
        "next_actions",
        "warning",
    ],
    "properties": {
        "primary_diagnosis": {"type": "string"},
        "conclusion": {"type": "string"},
        "supports_initial_candidate": {
            "type": "string",
            "enum": ["支持", "部分支持", "不支持", "无法判断"],
        },
        "confidence_level": {
            "type": "string",
            "enum": ["较高", "中等", "较低"],
        },
        "confidence_basis": {"type": "string"},
        "confirmed_evidence": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 4,
        },
        "supporting_evidence": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 4,
        },
        "uncertainties": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 4,
        },
        "differential_diagnoses": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 2,
        },
        "next_actions": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 3,
        },
        "warning": {"type": "string"},
    },
}
