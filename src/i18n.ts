import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      title: 'Dataset Annotation Program',
      help: 'Help',
      language: '中文/EN',
      manualMode: 'Manual Mode',
      agentMode: 'LLM Agent Mode',
      llmConfig: 'LLM Configuration',
      mode: 'Mode',
      settingsBlock: 'Settings',
      problemsBlock: 'Problems',
      apiKey: 'API Key',
      baseUrl: 'Base URL (required)',
      model: 'Model',
      provider: 'Provider',
      provider_openai: 'OpenAI-compatible',
      provider_gemini: 'Gemini',
      provider_claude: 'Claude',
      save: 'Save',
      saved: 'Saved',
      problemText: 'Problem Text',
      uploadImage: 'Upload image to auto-extract text',
      ocrExtract: 'Auto recognize text in image',
      confirmText: 'Confirm Text',
      targetType: 'Target Problem Type',
      type_mc: 'Multiple Choice',
      type_fitb: 'Fill-in-the-blank',
      type_proof: 'Proof',
      type_hint: 'It is better not to include proof questions for now. They can be collected later in bulk without manual annotation.',
      generate: 'Generate with LLM',
      latexFix: 'LaTeX Correction',
      latexFixHint: 'Normalize expressions so they render correctly in MathJax (e.g., ℤ → \\mathbb{Z}).',
      mathJaxPreviewLabel: 'MathJax preview',
      mathJaxPreviewEmpty: 'Nothing to render yet.',
      mathJaxPreviewError: 'MathJax render error: {{error}}',
      subfield: 'Subfield',
      subfield_others: 'Others (custom)',
      source: 'Source',
      academic: 'Academic Level',
      k12: 'K12',
      professional: 'Professional',
      difficulty: 'Difficulty (1=easy, 3=hard)',
      options: 'Options',
      answer: 'Solution / Proof Outline',
      imageBlock: 'Images',
      singleBlock: 'Single-image block',
      optionBlock: 'Option-image block (A–E)',
      customBlock: 'Custom multi-image block',
      addBlock: 'Add Block',
      compose: 'Compose Image',
      preview: 'Preview',
      regenerate: 'Regenerate',
      confirmImage: 'Confirm Image',
      imageAttached: 'Image attached',
      imageDependencyLabel: 'Image_Dependency=1',
      clearImageAttachment: 'Remove image',
      selectedFile: 'Selected:',
      count: 'Count',
      lettersLower: 'letters: a b c',
      numbersParen: 'numbers: (1) (2) (3)',
      exportXlsx: 'Export XLSX',
      exportDatasets: 'Export Datasets',
      exportImages: 'Export Images',
      importXlsx: 'Import XLSX',
      importXlsxFolder: 'Import XLSX (Folder)',
      importSuccess: 'Imported successfully, total {{count}} rows',
      importXlsxHint: 'Drag & drop .xlsx files to import. Right-click or press Ctrl+V to paste.',
      importFirstRowPreviewLabel: 'First row preview',
      importFirstRowPreviewEmpty: 'Question is empty',
      importImages: 'Import Images',
      importImagesHint: 'Drag & drop image folders to import (filenames must be ID.xxx). Right-click or press Ctrl+V to paste.',
      importImagesSuccess: 'Imported images successfully, total {{count}} images',
      paste: 'Paste',
      pasteFromClipboard: 'Paste from clipboard',
      generatedNameLabel: 'Generated name',
      clipboardReadDenied: 'Clipboard access denied. Please allow permission and try again.',
      clipboardReadUnsupported: 'Clipboard read is not supported in this browser.',
      rightClickForPaste: 'Right-click or press Ctrl+V to paste',
      noFilesFromClipboard: 'No compatible files found in clipboard.',
      storage: 'Storage',
      usage: 'Usage',
      quota: 'Quota',
      notAvailable: 'N/A',
      clearCache: 'Clear Cache',
      clearBank: 'Clear Question Bank',
      resultLabel: 'Result',
      prev: 'Previous',
      next: 'Next',
      helpTitle: 'Program Overview',
      helpError: 'Help content failed to render. Please close this dialog.',
      newProblem: 'New Problem',
      saveProblem: 'Save Problem',
      previewProblem: 'Preview Problem',
      previewTitle: 'Problem Preview',
      previewFieldId: 'Problem_Id',
      previewFieldQuestion: 'Question',
      previewFieldQuestionType: 'Question_Type',
      previewFieldOptions: 'Options',
      previewFieldAnswer: 'Answer',
      previewFieldSubfield: 'Subfield',
      previewFieldSource: 'Source',
      previewFieldAcademicLevel: 'Academic_Level',
      previewFieldDifficulty: 'Difficulty',
      previewFieldImage: 'Image',
      previewEmpty: 'Nothing to preview yet.',
      previewImageSection: 'Image',
      previewImageDependency: 'Image_Dependency',
      previewImageNone: 'No image attached.',
      previewImageLoading: 'Image attached but preview is still loading.',
      collapseSection: 'Collapse',
      expandSection: 'Expand',
      selectSubfieldHint: 'Select multiple subfields; they will be joined with semicolons.',
      testLLM: 'Test LLM',
      llmTestOverall: 'Overall settings',
      llmTestNotice: 'This feature verifies connectivity with your LLM. Requests made here do not affect dataset annotations.',
      llmAssist: 'Assist tools',
      llmAssistGenerateHint: '',
      assistToolsTitle: 'ASSIST TOOLS',
      questionInfoTitle: 'Question Information',
      assistToolGenerator: 'LLM-assisted problem generation',
      assistToolGeneratorHint: 'Let the generator rephrase the current draft to match the selected problem type, add missing definitions, and autofill structured fields.',
      assistToolGeneratorAction: 'Run generation',
      assistToolTranslation: 'Translation assistant',
      assistToolOcr: 'Image text extraction',
      assistToolLatex: 'MathJax correction',
      assistToolLatexHint: 'Paste LaTeX or load current text, then iteratively call the LLM to fix MathJax issues based on the feedback you provide. Each round should incorporate the latest render errors or reviewer comments.',
      assistToolLatexPlaceholder: 'Paste LaTeX code here...',
      assistToolLatexLoadQuestion: 'Load question text',
      assistToolLatexLoadAnswer: 'Load answer text',
      assistToolLatexClear: 'Clear content',
      assistToolLatexFix: 'Fix with LLM',
      assistToolLatexErrorsTitle: 'MathJax parser issues',
      assistToolLatexNoIssues: 'No MathJax parser errors detected.',
      assistToolLatexLoading: 'MathJax is still loading…',
      assistToolLatexUnavailable: 'MathJax is unavailable in this environment.',
      assistToolLatexRenderError: 'Render failed: {{error}}',
      yourMessage: 'Your message',
      send: 'Send',
      waitingLLMResponse: 'Waiting for LLM response',
      waitingLLMThinking: 'Waiting for LLM thinking',
        llmGeneratorInProgress: 'Problem generation in progress',
        llmReviewerInProgress: 'Problem review in progress',
      llmReply: 'LLM Reply',
        reviewerReply: 'Review response',
        reviewerStatusLabel: 'Review status',
        reviewerStatusPass: 'Passed',
        reviewerStatusFail: 'Failed',
        reviewerAttemptsLabel: 'Review rounds: {{count}}',
        reviewerIssuesLabel: 'Issues',
        reviewerNoIssues: 'No issues reported.',
        reviewerForcedAcceptNotice: 'Reached the max review rounds ({{count}}); accepting the latest draft even if review still fails.',
        reviewerForcedAcceptShort: 'forced accept',
      llmConversationHistory: 'Conversation history',
      llmConversationHistoryHint: 'Previous prompts, model replies, and saved feedback are sent to the generator to refine future results.',
      llmConversationHistoryEmpty: 'No LLM runs yet. Add feedback now to guide the first generation.',
      llmTurnLabel: 'Round {{index}}',
      llmPromptLabel: 'Prompt',
      llmResponseLabel: 'Model reply',
      llmUserFeedbackLabel: 'User feedback',
      llmFeedbackPlaceholder: 'Describe what you want improved in the next draft',
      llmSubmitFeedback: 'Save feedback',
      llmEmptyValue: '(empty)',
      llmError: 'LLM Error',
      requiredMarkNote: 'Fields marked * are required.',
      requiredMissing: 'The following required fields are incomplete: {{fields}}. Continue?',
      llmMissingTitle: 'LLM configuration required',
      llmMissingBody: 'Please enter API Key, Model, and Base URL in the LLM Configuration.',
      openLLMConfig: 'Open LLM Configuration',
      dismiss: 'Dismiss',
      footerContact: 'If you encounter any issues or have suggestions, contact chengyinzhu@bimsa.cn',
      browse: 'Browse',
      folder: 'Folder',
      dragDropOrPaste: 'Drag & drop or paste screenshot (Ctrl+V supported)',
      dragDropOrChooseImage: 'Drag & drop, choose, or paste an image (Ctrl+V supported)',
      dragDropMultipleOrPickFolder: 'Drag & drop multiple images (A–E) or pick a folder; Ctrl+V also works',
      dragDropMultiple: 'Drag & drop or paste multiple images (Ctrl+V supported)',
      dragDropMultipleCustom: 'Drag & drop or paste images to auto-fill slots (Ctrl+V supported)',
      viewLarge: 'View large',
      back: 'Back'
      , zoomHint: 'Ctrl + Wheel to zoom • Drag to pan • Double-click to reset'
      , defaultValues: 'Default Values'
      , editDefaults: 'Adjust Default Values'
      , defaultOptionsCount: 'Default choices count (Multiple Choice)'
      , cancel: 'Cancel'
      , confirm: 'Confirm'
      , clearBankTitle: 'Clear Question Bank'
      , clearBankInstruction: 'If you want to clear the current question bank cache, please type below: "CONFIRM CLEAR BANK". Before clearing, please be sure to download the question bank to your local device.'
      , clearConfirmPhrase_en: 'CONFIRM CLEAR BANK'
      , clearConfirmPhrase_zh: '确认清空题库'
      , llmConfigHint: 'Configure all agents together, then refine specifics in detailed settings if needed.'
      , llmGlobalSettings: 'Overall LLM Settings'
      , llmGlobalSettingsHint: 'Apply the same provider, API Key, model, and base URL to every agent.'
      , llmGlobalMixedWarning: 'Some agents currently use different settings. Saving will overwrite them.'
      , llmShowDetails: 'Detailed Settings'
      , llmHideDetails: 'Back to Overall'
      , llmDetailSettingsTitle: 'Agent-specific configuration'
      , llmDetailSettingsHint: 'Override the shared settings or adjust prompts for individual agents here.'
      , agentOcr: 'OCR Agent'
      , agentOcrDesc: 'Handles OCR tasks for image-to-text extraction.'
      , agentLatex: 'LaTeX Correction Agent'
      , agentLatexDesc: 'Normalizes mathematical expressions into MathJax-compatible LaTeX.'
      , agentGenerator: 'Problem Generation Agent'
      , agentGeneratorDesc: 'Creates draft problems and solutions.'
        , agentReviewer: 'Review Agent'
        , agentReviewerDesc: 'Audits questions for clarity, unique answers, and formatting compliance.'
      , agentTranslator: 'Translation Agent'
      , agentTranslatorDesc: 'Translates questions or answers between English and Chinese.'
      , agentEditPrompt: 'Set Prompt'
      , agentCopyPlaceholder: 'Copy config from…'
      , agentPromptEditorTitle: 'Edit prompt for {{agent}}'
      , llmAgentMissingBody: 'Please configure {{agent}} in the LLM section.'
      , defaultsAdminPrompt: 'Admin access required'
      , defaultsAdminHint: 'Enter the administrator password to adjust default options.'
      , defaultsAdminPasswordPlaceholder: 'Password'
      , defaultsAdminSubmit: 'Enter'
      , defaultsAdminError: 'Incorrect password'
      , defaultsListHint: 'These options appear in the editor dropdown.'
      , defaultsAddPlaceholder: 'Add a new option'
      , defaultsAddButton: 'Add'
      , defaultsRemoveItem: 'Remove {{item}}'
      , defaultsAcademicHint: 'Define the academic levels available when annotating.'
      , defaultsDifficultyHint: 'These values populate the difficulty selector.'
      , defaultsDifficultyPromptLabel: 'Difficulty label shown in the editor'
      , defaultsOptionsCountHint: 'Applies to newly created multiple choice problems.'
        , defaultsMaxReviewRoundsLabel: 'Max review rounds (auto QA)'
        , defaultsMaxReviewRoundsHint: 'Number of automated audit retries after generation; after this limit the draft is accepted even if still failing.'
      , translationHelper: 'Translation assistant'
      , translationLoadQuestion: 'Load question'
      , translationLoadAnswer: 'Load answer'
      , translationTargetZh: 'Translate to Chinese'
      , translationTargetEn: 'Translate to English'
      , translationRun: 'Run translation'
      , translationInputLabel: 'Source text'
      , translationOutputLabel: 'Translated text'
      , translationApplyQuestion: 'Replace question with translation'
      , translationApplyAnswer: 'Replace answer with translation'
      , translationInputMissing: 'Provide text before translating.'
    }
  },
  zh: {
    translation: {
      title: '数据集标注程序',
      help: '帮助',
      language: '中文/EN',
      manualMode: '手动模式',
      agentMode: 'LLM 代理模式',
      llmConfig: 'LLM 配置',
      mode: '模式',
      settingsBlock: '设置',
      problemsBlock: '题目',
      apiKey: 'API Key（仅保存在本地）',
      baseUrl: 'Base URL（必填）',
      model: '模型',
      provider: '服务商',
      provider_openai: 'OpenAI 兼容',
      provider_gemini: 'Gemini',
      provider_claude: 'Claude',
      save: '保存',
      saved: '已保存',
      problemText: '题目文本',
      uploadImage: '上传图片以自动提取文字',
      ocrExtract: '自动识别图中文字',
      confirmText: '确认文本',
      targetType: '目标题型',
      type_mc: '选择题',
      type_fitb: '填空题',
      type_proof: '证明题',
      type_hint: '目前不建议包含证明题，后续可从题库批量收集。',
      generate: '使用 LLM 生成',
      latexFix: 'LaTeX 纠正',
      latexFixHint: '将表达式规范化以确保可在 MathJax 中正确渲染（例如 ℤ → \\mathbb{Z}）。',
      mathJaxPreviewLabel: 'MathJax 预览',
      mathJaxPreviewEmpty: '暂无可渲染内容。',
      mathJaxPreviewError: 'MathJax 渲染错误：{{error}}',
      subfield: '分支领域',
      subfield_others: '其他（自定义）',
      source: '来源',
      academic: '学术水平',
      k12: 'K12',
      professional: '专业',
      difficulty: '难度（1=最易，3=最难）',
      options: '选项',
      answer: '解答 / 证明过程',
      imageBlock: '图片',
      singleBlock: '单图块',
      optionBlock: '选项图块（A–E）',
      customBlock: '自定义多图块',
      addBlock: '添加图片块',
      compose: '合成图片',
      preview: '预览',
      regenerate: '重新生成',
      confirmImage: '确认图片',
      imageAttached: '已添加图片',
      imageDependencyLabel: '图像依赖=1',
      clearImageAttachment: '移除图片',
      selectedFile: '已选：',
      count: '数量',
      lettersLower: '小写字母：a b c',
      numbersParen: '数字括号：(1) (2) (3)',
      exportXlsx: '导出 XLSX',
      exportDatasets: '导出数据集',
      exportImages: '导出图片',
      importXlsx: '导入 XLSX',
      importXlsxFolder: '导入 XLSX（文件夹）',
      importSuccess: '读取成功，共{{count}}条数据',
      importXlsxHint: '拖拽 .xlsx 文件导入，支持右键或 Ctrl+V 粘贴',
      importFirstRowPreviewLabel: '首条数据预览',
      importFirstRowPreviewEmpty: '题干为空',
      importImages: '导入图片',
      importImagesHint: '仅支持拖拽图片文件夹导入（文件名需为 ID.xxx），支持右键或 Ctrl+V 粘贴',
      importImagesSuccess: '读取成功，共{{count}}张图片',
      paste: '粘贴',
      pasteFromClipboard: '从剪贴板粘贴',
      generatedNameLabel: '生成文件名',
      clipboardReadDenied: '无法访问剪贴板，请授权后重试。',
      clipboardReadUnsupported: '当前浏览器不支持读取剪贴板。',
      rightClickForPaste: '右键或 Ctrl+V 可粘贴',
      noFilesFromClipboard: '剪贴板中没有可用的文件。',
      storage: '存储',
      usage: '已用',
      quota: '配额',
      notAvailable: '不可用',
      clearCache: '清理缓存',
      clearBank: '清空题库',
      resultLabel: '结果',
      prev: '上一题',
      next: '下一题',
      helpTitle: '功能概览',
      helpError: '帮助内容渲染失败，请关闭此对话框。',
      newProblem: '新建题目',
      saveProblem: '保存题目',
      collapseSection: '收起',
      expandSection: '展开',
      selectSubfieldHint: '可多次选择多个分支领域，最终以分号拼接。',
      testLLM: '测试 LLM',
      llmTestOverall: '整体设置',
      llmTestNotice: '该功能用于测试与LLM是否正确建立连接，所请求的内容不会影响数据集标注。',
      llmAssist: '辅助工具',
      llmAssistGenerateHint: '',
      assistToolsTitle: '辅助工具',
      previewProblem: '问题预览',
      previewTitle: '题目预览',
      previewFieldId: '题目编号',
      previewFieldQuestion: '题目文本',
      previewFieldQuestionType: '题目类型',
      previewFieldOptions: '选项',
      previewFieldAnswer: '解答',
      previewFieldSubfield: '分支领域',
      previewFieldSource: '来源',
      previewFieldAcademicLevel: '学术水平',
      previewFieldDifficulty: '难度',
      previewFieldImage: '图片',
      previewEmpty: '暂无可预览内容。',
      previewImageSection: '图片',
      previewImageDependency: '图像依赖',
      previewImageNone: '暂无图片。',
      previewImageLoading: '已关联图片，预览加载中。',
      questionInfoTitle: '题目信息',
      assistToolGenerator: 'LLM辅助问题生成',
      assistToolGeneratorHint: '引导大语言模型重写题干、补全结构化字段并保持目标题型一致。',
      assistToolGeneratorAction: '运行生成',
      assistToolTranslation: '翻译助手',
      assistToolOcr: '图片提取文字',
      assistToolLatex: 'LaTeX渲染',
      assistToolLatexHint: '粘贴 LaTeX 代码或载入题目/解答文本，查看 MathJax 渲染效果。',
      assistToolLatexPlaceholder: '在此粘贴 LaTeX 代码...',
      assistToolLatexLoadQuestion: '载入题目文本',
      assistToolLatexLoadAnswer: '载入答案文本',
      assistToolLatexClear: '清空内容',
      assistToolLatexFix: '使用 LLM 校正',
      assistToolLatexErrorsTitle: 'MathJax 解析问题',
      assistToolLatexNoIssues: 'MathJax 未报告解析错误。',
      assistToolLatexLoading: 'MathJax 正在加载…',
      assistToolLatexUnavailable: '当前环境无法使用 MathJax。',
      assistToolLatexRenderError: '渲染失败：{{error}}',
      yourMessage: '你的消息',
      send: '发送',
      waitingLLMResponse: '等待 LLM 响应',
      waitingLLMThinking: '等待 LLM 思考',
        llmGeneratorInProgress: '问题生成中',
        llmReviewerInProgress: '问题审核中',
      llmReply: 'LLM 回复',
        reviewerReply: '审核回复',
        reviewerStatusLabel: '审核状态',
        reviewerStatusPass: '已通过',
        reviewerStatusFail: '未通过',
        reviewerAttemptsLabel: '审核轮次：{{count}}',
        reviewerIssuesLabel: '问题列表',
        reviewerNoIssues: '未发现问题。',
        reviewerForcedAcceptNotice: '已达到最大审核轮次（{{count}}），即使未通过也将直接放行当前草稿。',
        reviewerForcedAcceptShort: '强制放行',
      llmConversationHistory: '多轮会话记录',
      llmConversationHistoryHint: '历史提问、模型回复和用户反馈会一并传递给 LLM，帮助改进下一轮生成。',
      llmConversationHistoryEmpty: '尚未运行 LLM，可先写下反馈为首轮生成提供指引。',
      llmTurnLabel: '第 {{index}} 轮',
      llmPromptLabel: '提问',
      llmResponseLabel: '模型回复',
      llmUserFeedbackLabel: '用户反馈',
      llmFeedbackPlaceholder: '请描述希望下一轮改进的要点',
      llmSubmitFeedback: '保存反馈',
      llmEmptyValue: '（无）',
      llmError: 'LLM 错误',
      requiredMarkNote: '标*代表必填。',
      requiredMissing: '{{fields}}未填写完毕，是否继续？',
      llmMissingTitle: '需要配置 LLM',
      llmMissingBody: '请在 LLM 配置中填写 API Key、模型与 Base URL。',
      openLLMConfig: '打开 LLM 配置',
      dismiss: '关闭',
      footerContact: '若遇到任何问题或有任何建议，请联系chengyinzhu@bimsa.cn',
      browse: '选择文件',
      folder: '文件夹',
      dragDropOrPaste: '拖拽或粘贴截图（支持 Ctrl+V）',
      dragDropOrChooseImage: '拖拽、选择或粘贴图片（支持 Ctrl+V）',
      dragDropMultipleOrPickFolder: '拖拽多张图片（A–E）或选择文件夹，也支持 Ctrl+V 粘贴',
      dragDropMultiple: '拖拽或粘贴多张图片（支持 Ctrl+V）',
      dragDropMultipleCustom: '拖拽或粘贴图片以自动填充槽位（支持 Ctrl+V）',
      viewLarge: '看大图',
      back: '返回',
      zoomHint: '按住 Ctrl 滚轮缩放 • 拖拽平移 • 双击重置'
      , defaultValues: '默认值'
      , editDefaults: '调整默认值'
      , defaultOptionsCount: '默认选项数量（选择题）'
      , cancel: '取消'
      , confirm: '确认'
      , clearBankTitle: '清空题库'
      , clearBankInstruction: '若想清空目前的题库缓存，请在下方输入：“确认清空题库”。在清空题库前请务必把题库下载到本地。'
      , clearConfirmPhrase_en: 'CONFIRM CLEAR BANK'
      , clearConfirmPhrase_zh: '确认清空题库'
      , llmConfigHint: '先统一设置参数，如需单独调整请进入详细设置。'
      , llmGlobalSettings: '整体设置'
      , llmGlobalSettingsHint: '统一配置所有代理的服务商、API Key、模型与 URL。'
      , llmGlobalMixedWarning: '当前各代理配置不一致，保存后将被整体设置覆盖。'
      , llmShowDetails: '详细设置'
      , llmHideDetails: '返回整体设置'
      , llmDetailSettingsTitle: '代理详细配置'
      , llmDetailSettingsHint: '在此覆盖整体设置或调整各代理的提示词。'
      , agentOcr: 'OCR 代理'
      , agentOcrDesc: '用于图像文字识别。'
      , agentLatex: 'LaTeX 校正代理'
      , agentLatexDesc: '将数学表达式标准化为适配 MathJax 的 LaTeX。'
      , agentGenerator: '题目生成代理'
      , agentGeneratorDesc: '负责生成题目与解答草稿。'
        , agentReviewer: '审核代理'
        , agentReviewerDesc: '对生成结果进行质检，确保描述清晰、答案唯一且格式符合规范。'
      , agentTranslator: '翻译代理'
      , agentTranslatorDesc: '用于在中英文之间转换题目或答案。'
      , agentEditPrompt: '设置提示词'
      , agentCopyPlaceholder: '从其他代理复制配置…'
      , agentPromptEditorTitle: '编辑 {{agent}} 的提示词'
      , llmAgentMissingBody: '请在 LLM 配置中完善 {{agent}} 的参数。'
      , defaultsAdminPrompt: '需要管理员验证'
      , defaultsAdminHint: '请输入管理员密码后才能调整默认候选项。'
      , defaultsAdminPasswordPlaceholder: '密码'
      , defaultsAdminSubmit: '确认'
      , defaultsAdminError: '密码错误'
      , defaultsListHint: '这些选项会出现在编辑器下拉列表中。'
      , defaultsAddPlaceholder: '新增候选项'
      , defaultsAddButton: '添加'
      , defaultsRemoveItem: '移除 {{item}}'
      , defaultsAcademicHint: '设置可选的学术水平。'
      , defaultsDifficultyHint: '这些值将用于难度选择。'
      , defaultsDifficultyPromptLabel: '难度标签（编辑器显示）'
      , defaultsOptionsCountHint: '影响新建选择题的默认选项数。'
        , defaultsMaxReviewRoundsLabel: '最大审核轮次'
        , defaultsMaxReviewRoundsHint: '每次生成后自动审核的次数，超过该次数仍未通过则直接放行。'
      , translationHelper: '翻译助手'
      , translationLoadQuestion: '载入题目文本'
      , translationLoadAnswer: '载入答案文本'
      , translationTargetZh: '翻译为中文'
      , translationTargetEn: '翻译为英文'
      , translationRun: '执行翻译'
      , translationInputLabel: '原始文本'
      , translationOutputLabel: '译文'
      , translationApplyQuestion: '将译文写入题目'
      , translationApplyAnswer: '将译文写入答案'
      , translationInputMissing: '请先输入需要翻译的内容。'
    }
  }
};

export function initI18n() {
  const saved = typeof window !== 'undefined' ? (localStorage.getItem('lang') || 'en') : 'en';
  return i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: saved,
      fallbackLng: 'en',
      interpolation: { escapeValue: false }
    });
}

export default i18n;
