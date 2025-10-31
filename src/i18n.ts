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
      latexFixHint: 'This will convert nonstandard symbols (e.g., ℤ) into LaTeX (e.g., \\mathbb{Z}).',
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
      importXlsxHint: 'Drag & drop .xlsx files or folders to import',
      importImages: 'Import Images',
      importImagesHint: 'Drag & drop image files or folders to import (filenames: <id>.jpg)',
      importImagesSuccess: 'Imported images successfully, total {{count}} images',
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
      selectSubfieldHint: 'Select multiple subfields; they will be joined with semicolons.',
      testLLM: 'Test LLM',
      llmTestOverall: 'Overall settings',
      llmTestNotice: 'This feature verifies connectivity with your LLM. Requests made here do not affect dataset annotations.',
      llmAssist: 'LLM assist tools',
      llmAssistGenerateHint: 'Use the helper below to have the LLM draft or complete the problem based on current inputs.',
      yourMessage: 'Your message',
      send: 'Send',
      waitingLLMResponse: 'Waiting for LLM response',
      waitingLLMThinking: 'Waiting for LLM thinking',
      llmReply: 'LLM Reply',
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
      dragDropOrPaste: 'Drag & drop or paste screenshot',
      dragDropOrChooseImage: 'Drag & drop or choose an image',
      dragDropMultipleOrPickFolder: 'Drag & drop multiple images (A–E) or pick a folder',
      dragDropMultiple: 'Drag & drop multiple images',
      dragDropMultipleCustom: 'Drag & drop images to auto-fill slots',
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
      , agentLatexDesc: 'Normalizes mathematical expressions into LaTeX.'
      , agentGenerator: 'Problem Generation Agent'
      , agentGeneratorDesc: 'Creates draft problems and solutions.'
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
      latexFixHint: '该操作会把非标准符号（如 ℤ）转换为合法 LaTeX（如 \\mathbb{Z}）。',
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
      selectedFile: '已选：',
      count: '数量',
      lettersLower: '小写字母：a b c',
      numbersParen: '数字括号：(1) (2) (3)',
      exportXlsx: '导出 XLSX',
      exportDatasets: '导出数据集',
      exportImages: '导出图片',
      importXlsx: '导入 XLSX',
      importXlsxFolder: '导入 XLSX（文件夹）',
      importSuccess: '读取成功，共有{{count}}条数据',
      importXlsxHint: '拖拽 .xlsx 文件或文件夹导入',
      importImages: '导入图片',
      importImagesHint: '拖拽图片文件或文件夹导入（文件名需为ID.jpg）',
      importImagesSuccess: '读取成功，共{{count}}张图片',
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
      selectSubfieldHint: '可多次选择多个分支领域，最终以分号拼接。',
      testLLM: '测试 LLM',
      llmTestOverall: '整体设置',
      llmTestNotice: '该功能用于测试与LLM是否正确建立连接，所请求的内容不会影响数据集标注。',
      llmAssist: 'LLM 辅助工具',
      llmAssistGenerateHint: '使用下方按钮可调用 LLM 基于当前信息生成或完善题目。',
      yourMessage: '你的消息',
      send: '发送',
      waitingLLMResponse: '等待 LLM 响应',
      waitingLLMThinking: '等待 LLM 思考',
      llmReply: 'LLM 回复',
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
      dragDropOrPaste: '拖拽或粘贴截图',
      dragDropOrChooseImage: '拖拽或选择图片',
      dragDropMultipleOrPickFolder: '拖拽多张图片（A–E）或选择文件夹',
      dragDropMultiple: '拖拽多张图片',
      dragDropMultipleCustom: '拖拽图片以自动填充槽位',
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
      , agentLatexDesc: '将数学表达式标准化为 LaTeX。'
      , agentGenerator: '题目生成代理'
      , agentGeneratorDesc: '负责生成题目与解答草稿。'
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
