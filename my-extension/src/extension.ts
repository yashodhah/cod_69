import * as vscode from 'vscode';
import * as path from 'path';

// TODO: Replace with real documentation search logic
async function searchDocs(query: string): Promise<string> {
  return `Search results for: ${query}`;
}

/** Merges a new entry into an existing global config array, avoiding duplicates by `file` key. */
async function mergeConfigArray(
  config: vscode.WorkspaceConfiguration,
  key: string,
  entry: { file: string }
): Promise<void> {
  const existing: { file: string }[] = config.get(key) ?? [];
  const alreadyPresent = existing.some((e) => e.file === entry.file);
  if (!alreadyPresent) {
    await config.update(
      key,
      [...existing, entry],
      vscode.ConfigurationTarget.Global
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  const extPath = context.extensionPath;
  const config = vscode.workspace.getConfiguration('github.copilot.chat');

  // ── INSTRUCTIONS ──────────────────────────────────────────
  // Append bundled instructions without overwriting user settings
  mergeConfigArray(
    config,
    'codeGeneration.instructions',
    { file: path.join(extPath, 'copilot/instructions/general.md') }
  ).catch((err) => console.error('[my-extension] Failed to update instructions:', err));

  // ── AGENTS ────────────────────────────────────────────────
  // Append bundled agent definition without overwriting user settings
  mergeConfigArray(
    config,
    'agents',
    { file: path.join(extPath, 'copilot/agents/myagent.agent.md') }
  ).catch((err) => console.error('[my-extension] Failed to update agents:', err));

  // ── PROMPTS ───────────────────────────────────────────────
  // Append bundled prompt without overwriting user settings
  mergeConfigArray(
    config,
    'prompts',
    { file: path.join(extPath, 'copilot/prompts/write-tests.prompt.md') }
  ).catch((err) => console.error('[my-extension] Failed to update prompts:', err));

  // ── SKILLS ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.lm.registerTool('my-extension.searchDocs', {
      async invoke(options, _token) {
        const { query } = options.input as { query: string };
        const result = await searchDocs(query);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(result)
        ]);
      }
    })
  );
}

export function deactivate() {}
