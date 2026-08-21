# GPT Obsidian

Small desktop-only companion plugin for ChatGPT tabs opened in Obsidian's core Web viewer.

## Behaviour

- Obsidian-assigned keyboard shortcuts take priority while a ChatGPT Web viewer is focused.
- Normal text-editing shortcuts that are not assigned to an Obsidian command remain inside ChatGPT.
- Returning to an existing ChatGPT tab automatically focuses the prompt field.
- Visible ChatGPT dialogs and menus block autofocus so the plugin does not steal focus from them.
- ChatGPT text color can be set to pure white or to Obsidian's current theme text color.
- Theme text color refreshes automatically when the Obsidian theme or its CSS settings change.
- Code blocks keep their own syntax-highlighting colors.
- Works with ChatGPT tabs opened by Home Tab or by any other method.
