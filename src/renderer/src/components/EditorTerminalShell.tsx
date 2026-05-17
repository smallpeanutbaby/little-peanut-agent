import { useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

export function EditorTerminalShell() {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!terminalHostRef.current) {
      return;
    }

    const terminal = new Terminal({
      theme: {
        background: "#0f1115"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();
    terminal.writeln("Little Peanut terminal scaffold");

    return () => {
      terminal.dispose();
    };
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-white/10 overflow-hidden">
        <Editor
          height="320px"
          defaultLanguage="typescript"
          defaultValue={"// Monaco Editor scaffold\nexport const ready = true;\n"}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14
          }}
        />
      </div>
      <div
        ref={terminalHostRef}
        className="min-h-[320px] rounded-2xl border border-white/10 bg-[#0f1115] p-2"
      />
    </div>
  );
}
