import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "zh-CN",
    resources: {
      "zh-CN": {
        translation: {
          stack: "技术栈",
          appName: "Little Peanut",
          sidebar: {
            newChat: "新建对话",
            search: "搜索",
            plugins: "插件",
            extensions: "扩展功能",
            automation: "自动化",
            projects: "项目",
            localOne: "本地 1",
            conversations: "对话",
            emptyConversations: "暂无对话",
            newProject: "New Project",
            newConversation: "New Conversation",
            theme: "切换主题",
            settings: "系统设置",
            help: "帮助",
            switchToEnglish: "切换英文",
            switchToChinese: "切换中文",
            themeSettings: "主题设置",
            agoOneHour: "1小时前",
            chatMode: "对话模式",
            modelConfig: "AI配置"
          },
          modeMenu: {
            title: "添加到对话",
            addPhotos: "添加图片或文件",
            commands: "命令",
            skills: "技能",
            mcpServers: "MCP 服务器"
          },
          home: {
            pageTitle: "新建对话",
            heroTitle: "想聊些什么？",
            heroSubtitle: "随意提问，也可以使用搜索与已选择的 MCP 工具。",
            inputPlaceholder: "输入消息...",
            modeChat: "对话",
            start: "开始",
            suggestions: {
              async: "解释 async/await 的工作原理",
              rest: "比较 REST 和 GraphQL",
              regex: "写一个邮箱验证正则表达式"
            }
          },
          appearance: {
            title: "主题设置",
            close: "关闭",
            mode: "模式",
            dark: "深色",
            light: "浅色",
            background: "背景色",
            text: "字体色",
            save: "保存",
            colors: {
              roast: "深烘焙",
              "peanut-dark": "花生深棕",
              walnut: "胡桃",
              cocoa: "可可",
              latte: "拿铁",
              espresso: "浓缩",
              sand: "沙色",
              caramel: "焦糖",
              honey: "蜂蜜",
              toffee: "太妃糖",
              almond: "杏仁",
              bronze: "古铜",
              clay: "陶土",
              stone: "岩石",
              moss: "苔绿",
              forest: "森林",
              night: "夜幕",
              midnight: "午夜",
              obsidian: "黑曜石",
              ivory: "象牙白",
              "warm-white": "暖白",
              cream: "奶油白",
              "soft-gold": "浅金",
              charcoal: "炭黑",
              snow: "雪白",
              linen: "亚麻白",
              pearl: "珍珠白",
              "sand-ink": "沙墨",
              hazel: "榛褐",
              coffee: "咖啡",
              ember: "余烬",
              graphite: "石墨",
              slate: "板岩",
              sage: "鼠尾草",
              "olive-ink": "橄榄墨",
              "teal-ink": "蓝绿墨",
              "midnight-ink": "深夜墨",
              "plum-ink": "梅墨"
            }
          },
          modelConfig: {
            subtitle: "偏好与模型设置",
            aiCapabilities: "AI 能力",
            aiProvider: "AI 服务商配置",
            aiProviderDesc: "为每个服务商配置 API Key 和模型",
            modelManage: "模型管理",
            modelSettings: "模型配置",
            comingSoon: "功能开发中，敬请期待...",
            searchProvider: "搜索服务商...",
            addProvider: "添加",
            enabled: "已启用",
            disabled: "已禁用",
            apiKey: "API Key",
            getApiKey: "获取 API Key",
            apiProxy: "API 代理地址",
            apiProxyHint: "自定义端点，用于代理或第三方兼容服务",
            connectTest: "连通性检查",
            check: "检查",
            modelList: "模型列表",
            totalModels: "共 {{total}} 个模型",
            searchModel: "搜索模型...",
            enableAll: "全部启用",
            disableAll: "全部禁用",
            fetchModels: "获取模型列表"
          },
          settingsPanel: {
            title: "设置",
            description: "这里将放置更多系统设置。"
          }
        }
      },
      en: {
        translation: {
          stack: "Tech stack",
          appName: "Little Peanut",
          sidebar: {
            newChat: "New Chat",
            search: "Search",
            plugins: "Plugins",
            extensions: "Extensions",
            automation: "Automation",
            projects: "Projects",
            localOne: "Local 1",
            conversations: "Conversations",
            emptyConversations: "No conversations yet",
            newProject: "New Project",
            newConversation: "New Conversation",
            theme: "Toggle theme",
            settings: "Settings",
            help: "Help",
            switchToEnglish: "Switch to English",
            switchToChinese: "Switch to Chinese",
            themeSettings: "Theme settings",
            agoOneHour: "1 hour ago",
            chatMode: "Chat Mode",
            modelConfig: "AI Config"
          },
          modeMenu: {
            title: "Add to conversation",
            addPhotos: "Add photos and files",
            commands: "Commands",
            skills: "Skills",
            mcpServers: "MCP Servers"
          },
          home: {
            pageTitle: "New Chat",
            heroTitle: "What do you want to talk about?",
            heroSubtitle: "Ask anything, or use search with your selected MCP tools.",
            inputPlaceholder: "Type a message...",
            modeChat: "Chat",
            start: "Start",
            suggestions: {
              async: "Explain how async/await works",
              rest: "Compare REST and GraphQL",
              regex: "Write an email validation regex"
            }
          },
          appearance: {
            title: "Theme settings",
            close: "Close",
            mode: "Mode",
            dark: "Dark",
            light: "Light",
            background: "Background",
            text: "Text color",
            save: "Save",
            colors: {
              roast: "Roast",
              "peanut-dark": "Peanut Dark",
              walnut: "Walnut",
              cocoa: "Cocoa",
              latte: "Latte",
              espresso: "Espresso",
              sand: "Sand",
              caramel: "Caramel",
              honey: "Honey",
              toffee: "Toffee",
              almond: "Almond",
              bronze: "Bronze",
              clay: "Clay",
              stone: "Stone",
              moss: "Moss",
              forest: "Forest",
              night: "Night",
              midnight: "Midnight",
              obsidian: "Obsidian",
              ivory: "Ivory",
              "warm-white": "Warm White",
              cream: "Cream",
              "soft-gold": "Soft Gold",
              charcoal: "Charcoal",
              snow: "Snow",
              linen: "Linen",
              pearl: "Pearl",
              "sand-ink": "Sand Ink",
              hazel: "Hazel",
              coffee: "Coffee",
              ember: "Ember",
              graphite: "Graphite",
              slate: "Slate",
              sage: "Sage",
              "olive-ink": "Olive Ink",
              "teal-ink": "Teal Ink",
              "midnight-ink": "Midnight Ink",
              "plum-ink": "Plum Ink"
            }
          },
          modelConfig: {
            subtitle: "Preferences & Model settings",
            aiCapabilities: "AI Capabilities",
            aiProvider: "AI Provider Config",
            aiProviderDesc: "Configure API Key and models for each provider",
            modelManage: "Model Management",
            modelSettings: "Model Settings",
            comingSoon: "Coming soon...",
            searchProvider: "Search providers...",
            addProvider: "Add",
            enabled: "Enabled",
            disabled: "Disabled",
            apiKey: "API Key",
            getApiKey: "Get API Key",
            apiProxy: "API Proxy URL",
            apiProxyHint: "Custom endpoint for proxy or 3rd-party compatible services",
            connectTest: "Connection Test",
            check: "Check",
            modelList: "Model List",
            totalModels: "{{total}} models total",
            searchModel: "Search models...",
            enableAll: "Enable All",
            disableAll: "Disable All",
            fetchModels: "Fetch Model List"
          },
          settingsPanel: {
            title: "Settings",
            description: "More system preferences will appear here."
          }
        }
      }
    }
  });

export default i18n;
