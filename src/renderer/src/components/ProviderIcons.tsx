/**
 * AI Provider brand icons as inline SVG components.
 * Each icon is 20x20 by default, colored to match the brand.
 */

export function OpenAIIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

export function AnthropicIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M17.304 3.541h-3.483l6.15 16.918h3.483l-6.15-16.918z" fill="currentColor" />
      <path d="M6.696 3.541L.546 20.459h3.483l1.263-3.474h6.416l1.263 3.474h3.483L10.304 3.541H6.696zm-.405 10.903l2.209-6.074 2.209 6.074H6.291z" fill="currentColor" />
    </svg>
  );
}

export function GoogleGeminiIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 24C12 22.4 11.55 20.85 10.725 19.5C9.9 18.15 8.775 17.025 7.425 16.2C6.075 15.375 4.5 14.925 2.925 14.925C1.35 14.925 0 14.925 0 14.925V12C0 12 1.35 12 2.925 12C4.5 12 6.075 11.55 7.425 10.725C8.775 9.9 9.9 8.775 10.725 7.425C11.55 6.075 12 4.5 12 2.925V0C12 0 12 1.35 12 2.925C12 4.5 12.45 6.075 13.275 7.425C14.1 8.775 15.225 9.9 16.575 10.725C17.925 11.55 19.5 12 21.075 12C22.65 12 24 12 24 12V14.925C24 14.925 22.65 14.925 21.075 14.925C19.5 14.925 17.925 15.375 16.575 16.2C15.225 17.025 14.1 18.15 13.275 19.5C12.45 20.85 12 22.4 12 24Z"
        fill="#4285F4"
      />
    </svg>
  );
}

export function DeepSeekIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#4D6BFE" />
      <path d="M8 12a4 4 0 1 1 8 0 4 4 0 0 1-8 0z" fill="white" />
    </svg>
  );
}

export function OpenRouterIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 8l4-4 4 4M4 16l4 4 4-4M14 6h6M14 12h6M14 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OllamaIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C8.5 2 6 4.5 6 7.5c0 1.5.5 2.8 1.5 3.8-.5 1-1 2.2-1 3.7 0 3 2.5 5.5 5.5 5.5s5.5-2.5 5.5-5.5c0-1.5-.5-2.7-1-3.7 1-1 1.5-2.3 1.5-3.8C18 4.5 15.5 2 12 2z"
        fill="currentColor"
      />
      <circle cx="10" cy="8" r="1.2" fill="var(--lp-bg, #1a1a1a)" />
      <circle cx="14" cy="8" r="1.2" fill="var(--lp-bg, #1a1a1a)" />
    </svg>
  );
}

export function AzureOpenAIIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M2 5.5L11.5 3v8.5H2V5.5z" fill="#F25022" />
      <path d="M12.5 3L22 5.5v6H12.5V3z" fill="#7FBA00" />
      <path d="M2 12.5h9.5V21L2 18.5v-6z" fill="#00A4EF" />
      <path d="M12.5 12.5H22v6L12.5 21v-8.5z" fill="#FFB900" />
    </svg>
  );
}

export function MoonshotIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 0 16c-2.5 0-4.5-1-6-3 1.5.5 3 .5 4.5-.5 2-1.5 2.5-4 1.5-6s-3.5-3-5.5-2.5A8 8 0 0 1 12 4z"
        fill="#5B45E0"
      />
    </svg>
  );
}

export function TongyiIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#6236FF" />
      <path d="M7 12h10M12 7v10" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MiniMaxIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#1A1A2E" />
      <path d="M6 16V8l4 4 4-4v8M18 8v8" stroke="#00D4AA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiliconFlowIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 18L12 4l8 14H4z" fill="none" stroke="#7C3AED" strokeWidth="2" />
      <path d="M8 14l4-7 4 7" fill="#7C3AED" />
    </svg>
  );
}

export function GiteeAIIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#C71D23" />
      <path d="M6 12.5h6.5a2 2 0 0 0 2-2V8.5H8a2 2 0 0 0-2 2v2z" fill="white" />
      <circle cx="14.5" cy="8.5" r="1" fill="white" />
    </svg>
  );
}

export function CodexIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#10A37F" />
      <path d="M8 9l3 3-3 3M13 15h4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XiaomiIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#FF6900" />
      <path d="M6 8h5v8H8v-5H6V8zm7 0h5v3h-3v5h-2V8z" fill="white" />
    </svg>
  );
}

export function ZhipuIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" fill="#1A56DB" />
      <path d="M7 8.5h10v1.5H7zM7 11.5h7v1.5H7zM7 14.5h4v1.5H7z" fill="white" />
      <circle cx="17" cy="8.5" r="1.5" fill="#4ADE80" />
    </svg>
  );
}

export function LongCatIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C9 2 7 4 7 6v2c-1 0-2 1-2 2v4c0 1 1 2 2 2v2c0 2 2 4 5 4s5-2 5-4v-2c1 0 2-1 2-2v-4c0-1-1-2-2-2V6c0-2-2-4-5-4z"
        fill="#F59E0B"
      />
      <circle cx="10" cy="9" r="1.2" fill="#1a1a1a" />
      <circle cx="14" cy="9" r="1.2" fill="#1a1a1a" />
      <path d="M10 12.5c0 0 1 1.5 2 1.5s2-1.5 2-1.5" stroke="#1a1a1a" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function GitHubCopilotIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Map provider id to its icon component */
export const PROVIDER_ICON_MAP: Record<string, React.FC<{ size?: number }>> = {
  openai: OpenAIIcon,
  anthropic: AnthropicIcon,
  google: GoogleGeminiIcon,
  deepseek: DeepSeekIcon,
  openrouter: OpenRouterIcon,
  ollama: OllamaIcon,
  azure: AzureOpenAIIcon,
  moonshot: MoonshotIcon,
  tongyi: TongyiIcon,
  minimax: MiniMaxIcon,
  siliconflow: SiliconFlowIcon,
  gitee: GiteeAIIcon,
  codex: CodexIcon,
  xiaomi: XiaomiIcon,
  zhipu: ZhipuIcon,
  longcat: LongCatIcon,
  "github-copilot": GitHubCopilotIcon
};
